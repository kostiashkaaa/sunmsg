import SwiftUI
import Combine

// MARK: - Session store

enum AppRoute: Hashable { case loading, login, register, main }

// Call state models
struct IncomingCallData: Equatable {
    let callId: String
    let chatId: String
    let callType: String    // "audio" | "video"
    let callerName: String
    let callerAvatarUrl: String?
    let callerUserId: Int
}

struct ActiveCallState: Equatable, Identifiable {
    var id: String { callId }
    let callId: String
    let chatId: String
    let callType: String
    let partnerName: String
    let partnerAvatarUrl: String?
    let partnerUserId: Int
    let isOutgoing: Bool
    /// Becomes true once the call is answered (active), so call history only
    /// records a duration for calls that actually connected.
    var isActive: Bool = false
    /// Set to the moment the call became active — used to compute duration.
    var startedAt: Date = Date()
    var isMuted: Bool = false
    var isSpeaker: Bool = true
    var isCameraOff: Bool = false
    // Remote peer's reported media state (via call_media_state)
    var remoteAudioMuted: Bool = false
    var remoteVideoEnabled: Bool = false

    /// Seconds since the call connected, or nil if it never became active.
    var elapsedSeconds: Int? {
        isActive ? max(0, Int(Date().timeIntervalSince(startedAt))) : nil
    }
}

@MainActor
final class SessionStore: ObservableObject {
    @Published var route: AppRoute = .loading
    @Published var bootstrap: BootstrapResponse?
    @Published var contacts: [Contact] = []
    @Published var pendingRequests: [DialogRequest] = []
    @Published var errorMessage: String?

    // Socket state is surfaced through smSocketStateChanged; publishing it here
    // would invalidate every EnvironmentObject consumer on each reconnect.
    var socketState: SocketClient.State = .disconnected

    // Call history
    @Published var callHistory: [CallRecord] = []

    // Call state
    @Published var incomingCall: IncomingCallData? = nil
    @Published var activeCall: ActiveCallState? = nil
    @Published var callError: String? = nil

    /// Currently selected bottom tab (0: чаты, 1: звонки, 2: контакты, 3: настройки)
    @Published var selectedTab: Int = 0

    /// chat_id of the currently open ChatView (nil when no chat is open).
    var activeChatId: String? = nil

    let api = APIClient.shared
    private let syncEngine = ChatSyncEngine(api: APIClient.shared)
    private let mutedChatIdsDefaultsKey = "sun_chat_muted_v1"
    private var mutedChatIds: Set<String> = []
    private var cancellables = Set<AnyCancellable>()
    private var typingTimers: [String: Task<Void, Never>] = [:]
    private var callErrorClearTask: Task<Void, Never>?
    private var presenceTimer: Timer?

    init() {
        loadCallHistory()
        loadMutedChatIds()
        NotificationCenter.default.publisher(for: .smSocketMessage)
            .sink { [weak self] note in
                guard let userInfo = note.userInfo else { return }
                Task { @MainActor [weak self] in await self?.handleSocketEvent(userInfo) }
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: .smSocketStateChanged)
            .sink { [weak self] _ in
                Task { @MainActor [weak self] in self?.handleSocketStateChanged() }
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)
            .sink { [weak self] _ in
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    self.connectSocket()
                    self.markActive()
                    await self.refreshContacts()
                    await self.recoverActiveChatSync()
                }
            }
            .store(in: &cancellables)

        NotificationCenter.default.publisher(for: UIApplication.didEnterBackgroundNotification)
            .sink { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.markInactive()
                }
            }
            .store(in: &cancellables)
    }

    // MARK: - Global socket event handler

    private func handleSocketEvent(_ userInfo: [AnyHashable: Any]) async {
        guard let event = userInfo[SocketEventKey.eventName] as? String else { return }
        let payload = userInfo[SocketEventKey.data] as? [String: Any] ?? [:]
        let isReplay = (userInfo[SocketEventKey.replay] as? Bool) == true

        if !isReplay {
            let sync = await syncEngine.prepareLiveEvent(eventName: event, payload: payload)
            for replay in sync.replays {
                postReplayEvent(replay)
            }
            guard sync.shouldApplyCurrent else { return }
        }

        applySocketEvent(event, payload: payload)
    }

    private func postReplayEvent(_ replay: SocketReplayEvent) {
        NotificationCenter.default.post(
            name: .smSocketMessage,
            object: nil,
            userInfo: [
                SocketEventKey.eventName: replay.eventName,
                SocketEventKey.data: replay.payload,
                SocketEventKey.replay: true,
            ]
        )
    }

    private func applySocketEvent(_ event: String, payload: [String: Any]) {
        switch event {
        case "receive_message":
            guard let chatId = payload["chat_id"] as? String,
                  let msgId  = payload["id"] as? Int else { return }
            // Update sidebar contact preview
            handleIncomingSocketMessage(payload)
            let msg = ChatMessage(
                id: msgId,
                chatId: chatId,
                message: payload["message"] as? String,
                messageType: payload["message_type"] as? String ?? "text",
                createdAt: SunDateParser.timestamp(fromAny: payload["created_at"]) ?? Date().timeIntervalSince1970,
                senderUserId: payload["sender_user_id"] as? Int,
                senderPublicKey: payload["sender_public_key"] as? String,
                senderDisplayName: payload["sender_display_name"] as? String,
                senderUsername: payload["sender_username"] as? String
            )
            NotificationCenter.default.post(
                name: .smPreparedIncomingMessage,
                object: nil,
                userInfo: [
                    PreparedIncomingMessageKey.chatId: chatId,
                    PreparedIncomingMessageKey.message: msg,
                ]
            )

        case "user_status":
            if let pubKey = payload["public_key"] as? String,
               let online = payload["online"] as? Bool,
               let idx = contacts.firstIndex(where: { $0.publicKey == pubKey }) {
                contacts[idx].isOnline = online
                contacts[idx].lastSeen = online ? nil : SunDateParser.timestamp(fromAny: payload["last_seen"])
            }

        case "profile_updated":
            if let pubKey = payload["public_key"] as? String,
               let idx = contacts.firstIndex(where: { $0.publicKey == pubKey }) {
                contacts[idx].displayName = (payload["display_name"] as? String) ?? contacts[idx].displayName
                contacts[idx].username = (payload["username"] as? String) ?? contacts[idx].username
                if payload.keys.contains("avatar_url") {
                    contacts[idx].avatarUrl = payload["avatar_url"] as? String
                }
            }

        case "partner_typing":
            if let chatId = payload["chat_id"] as? String,
               let idx = contacts.firstIndex(where: { $0.chatId == chatId }) {
                contacts[idx].isTyping = true
                typingTimers[chatId]?.cancel()
                typingTimers[chatId] = Task { [weak self] in
                    try? await Task.sleep(nanoseconds: 6_000_000_000)
                    guard !Task.isCancelled else { return }
                    await MainActor.run { [weak self] in
                        guard let self,
                              let i = self.contacts.firstIndex(where: { $0.chatId == chatId })
                        else { return }
                        self.contacts[i].isTyping = false
                        self.typingTimers[chatId] = nil
                    }
                }
            }

        case "partner_stop_typing":
            if let chatId = payload["chat_id"] as? String,
               let idx = contacts.firstIndex(where: { $0.chatId == chatId }) {
                contacts[idx].isTyping = false
                typingTimers[chatId]?.cancel()
                typingTimers[chatId] = nil
            }

        case "chat_draft_updated":
            applyDraftUpdate(payload)

        case "dialog_request_updated":
            Task { await self.refreshDialogRequests() }

        case "group_chat_created":
            Task { await self.refreshContacts() }

        case "new_group_invite_request":
            Task { await self.refreshDialogRequests() }

        // MARK: - Call signaling

        case "call_incoming":
            guard let callId   = payload["call_id"]   as? String,
                  let chatId   = payload["chat_id"]   as? String,
                  let callType = payload["call_type"] as? String,
                  let initiator = payload["initiator"] as? [String: Any]
            else { return }
            incomingCall = IncomingCallData(
                callId: callId,
                chatId: chatId,
                callType: callType,
                callerName: initiator["display_name"] as? String ?? "Unknown",
                callerAvatarUrl: initiator["avatar_url"] as? String,
                callerUserId: initiator["user_id"] as? Int ?? 0
            )

        case "call_initiated":
            guard let callId   = payload["call_id"]   as? String,
                  let chatId   = payload["chat_id"]   as? String,
                  let callType = payload["call_type"] as? String
            else { return }
            // Find contact for this chat
            let contact = contacts.first(where: { $0.chatId == chatId })
            var state = ActiveCallState(
                callId: callId,
                chatId: chatId,
                callType: callType,
                partnerName: contact?.displayName ?? "Unknown",
                partnerAvatarUrl: contact?.avatarUrl,
                partnerUserId: contact?.userId ?? 0,
                isOutgoing: true
            )
            state.isCameraOff = (callType != "video")  // audio calls start camera-off
            activeCall = state
            incomingCall = nil
            // Prepare WebRTC as initiator. Offer is sent when remote accepts.
            WebRTCService.shared.startCall(callId: callId, callType: callType, isInitiator: true)

        case "call_accepted":
            // Remote peer accepted our outgoing call. The *initiator* now
            // creates the SDP offer and sends it via call_offer.
            if let callId = payload["call_id"] as? String, activeCall?.callId == callId {
                incomingCall = nil
                if var c = activeCall, !c.isActive {
                    c.isActive = true
                    c.startedAt = Date()
                    activeCall = c
                }
                if WebRTCService.shared.isInitiator {
                    WebRTCService.shared.createAndSendOffer()
                }
            }

        case "call_rejected":
            // Our outgoing call was declined by the callee.
            if let callId = payload["call_id"] as? String, activeCall?.callId == callId {
                if let call = activeCall {
                    addCallRecord(name: call.partnerName, callType: call.callType, isOutgoing: call.isOutgoing, missed: false, durationSec: nil, chatId: call.chatId)
                }
                teardownActiveCall()
            }
            incomingCall = nil

        case "call_cancelled":
            // The caller hung up before we answered → missed incoming call.
            if let inc = incomingCall, inc.callId == payload["call_id"] as? String {
                addCallRecord(name: inc.callerName, callType: inc.callType, isOutgoing: false, missed: true, durationSec: nil, chatId: inc.chatId)
            }
            incomingCall = nil
            if let callId = payload["call_id"] as? String, activeCall?.callId == callId {
                if let call = activeCall {
                    addCallRecord(name: call.partnerName, callType: call.callType, isOutgoing: call.isOutgoing, missed: false, durationSec: call.elapsedSeconds, chatId: call.chatId)
                }
                teardownActiveCall()
            }

        case "call_ended":
            incomingCall = nil
            if let callId = payload["call_id"] as? String, activeCall?.callId == callId {
                if let call = activeCall {
                    let serverDuration = payload["duration_sec"] as? Int
                    addCallRecord(name: call.partnerName, callType: call.callType, isOutgoing: call.isOutgoing, missed: false, durationSec: serverDuration ?? call.elapsedSeconds, chatId: call.chatId)
                }
                teardownActiveCall()
            }

        case "call_media_state":
            if let callId = payload["call_id"] as? String, activeCall?.callId == callId, var c = activeCall {
                c.remoteAudioMuted = payload["audio_muted"] as? Bool ?? c.remoteAudioMuted
                c.remoteVideoEnabled = payload["video_enabled"] as? Bool ?? c.remoteVideoEnabled
                activeCall = c
            }

        case "call_sync":
            // Server's authoritative view of the user's live call. If it reports
            // no active call but we still show one, the call ended elsewhere —
            // tear our UI down so it can't get stuck.
            if payload["active_call"] is NSNull || payload["active_call"] == nil {
                if activeCall != nil { teardownActiveCall() }
            }

        // ── WebRTC SDP / ICE relay ──────────────────────────────────────────

        case "call_offer":
            guard let sdp = payload["sdp"] as? [String: Any],
                  let sdpText = sdp["sdp"] as? String else { break }
            WebRTCService.shared.handleRemoteOffer(sdpText)

        case "call_answer":
            guard let sdp = payload["sdp"] as? [String: Any],
                  let sdpText = sdp["sdp"] as? String else { break }
            WebRTCService.shared.handleRemoteAnswer(sdpText)

        case "call_ice_candidate":
            if let cand = payload["candidate"] as? [String: Any] {
                WebRTCService.shared.handleRemoteCandidate(cand)
            }

        case "call_error":
            let code = payload["error"] as? String ?? "server_error"
            let messages: [String: String] = [
                "user_busy":                    "Вы уже в другом звонке.",
                "callee_busy":                  "Собеседник сейчас занят.",
                "call_privacy_restricted":      "Пользователь ограничил входящие звонки.",
                "calls_feature_disabled":       "Звонки временно недоступны.",
                "no_recipients":                "Нет доступных получателей.",
                "not_member":                   "Вы не участник этого чата.",
                "call_not_found_or_expired":    "Звонок не найден или истёк.",
                "call_already_active":          "В этом чате уже идёт звонок.",
                "unsupported_call_topology":    "Групповые звонки пока не поддерживаются.",
                "invalid_chat_id":              "Неверный идентификатор чата.",
            ]
            showCallError(messages[code] ?? "Ошибка звонка.")

        case "contact_added":
            Task { await self.refreshContacts() }

        case "contact_removed":
            if let chatId = payload["chat_id"] as? String {
                contacts.removeAll { $0.chatId == chatId }
            }

        case "chat_deleted":
            guard let chatId = payload["chat_id"] as? String, !chatId.isEmpty else {
                Task { await self.refreshContacts() }
                break
            }
            contacts.removeAll { $0.chatId == chatId }
            typingTimers[chatId]?.cancel()
            typingTimers[chatId] = nil
            if activeChatId == chatId {
                activeChatId = nil
            }
            Task {
                await ChatLocalStore.shared.deleteChat(chatId: chatId)
                await self.refreshContacts()
            }

        default:
            break
        }
    }

    // MARK: - Call actions

    func initiateCall(chatId: String, callType: String) {
        guard SocketClient.shared.state == .connected else {
            showCallError("Нет соединения с сервером. Проверьте интернет и попробуйте переподключиться.")
            return
        }
        let requestId = UUID().uuidString
        SocketClient.shared.emit("call_initiate", [
            "chat_id": chatId,
            "call_type": callType,
            "request_id": requestId,
            "csrf_token": api.csrfToken,
        ])
    }

    func acceptCall(callId: String) {
        guard SocketClient.shared.state == .connected else { return }
        let requestId = UUID().uuidString
        SocketClient.shared.emit("call_accept", [
            "call_id": callId,
            "request_id": requestId,
            "csrf_token": api.csrfToken,
        ])
        if let incoming = incomingCall, incoming.callId == callId {
            var state = ActiveCallState(
                callId: callId,
                chatId: incoming.chatId,
                callType: incoming.callType,
                partnerName: incoming.callerName,
                partnerAvatarUrl: incoming.callerAvatarUrl,
                partnerUserId: incoming.callerUserId,
                isOutgoing: false
            )
            // We answered, so the call is active from our perspective.
            state.isActive = true
            state.startedAt = Date()
            state.isCameraOff = (incoming.callType != "video")  // audio calls start camera-off
            activeCall = state
            // Prepare WebRTC as callee. Will create answer when offer arrives.
            WebRTCService.shared.startCall(callId: callId, callType: incoming.callType, isInitiator: false)
        }
        incomingCall = nil
    }

    func rejectCall(callId: String) {
        guard SocketClient.shared.state == .connected else { return }
        SocketClient.shared.emit("call_reject", ["call_id": callId, "csrf_token": api.csrfToken])
        if let inc = incomingCall, inc.callId == callId {
            addCallRecord(name: inc.callerName, callType: inc.callType, isOutgoing: false, missed: false, durationSec: nil, chatId: inc.chatId)
        }
        incomingCall = nil
    }

    func endCall() {
        guard let call = activeCall else { return }
        if SocketClient.shared.state == .connected {
            // Outgoing calls (we are the initiator) use call_cancel, which the
            // server honours for both ringing AND active states. Incoming/answered
            // calls must use call_end (only the non-initiator side). Sending the
            // wrong event leaves the call ringing forever on the server and blocks
            // the chat with `call_already_active`.
            let event = call.isOutgoing ? "call_cancel" : "call_end"
            SocketClient.shared.emit(event, ["call_id": call.callId, "csrf_token": api.csrfToken])
        }
        addCallRecord(name: call.partnerName, callType: call.callType, isOutgoing: call.isOutgoing, missed: false, durationSec: call.elapsedSeconds, chatId: call.chatId)
        teardownActiveCall()
    }

    /// Idempotent local teardown: stop WebRTC and clear call UI state.
    /// Safe to call multiple times (e.g. both the local end action and the
    /// server's echoed call_ended event may reach us).
    func teardownActiveCall() {
        WebRTCService.shared.endCall()
        activeCall = nil
        incomingCall = nil
    }

    /// Toggle local microphone and report the new state to the peer.
    func toggleMute() {
        guard var c = activeCall else { return }
        c.isMuted.toggle()
        activeCall = c
        WebRTCService.shared.setMuted(c.isMuted)
        emitMediaState()
    }

    /// Toggle the local camera and report the new state to the peer. Works even
    /// on calls that started as audio-only (enableLocalVideo renegotiates).
    func toggleCamera() {
        guard var c = activeCall else { return }
        c.isCameraOff.toggle()
        activeCall = c
        if c.isCameraOff {
            WebRTCService.shared.setCameraOff(true)
        } else {
            WebRTCService.shared.enableLocalVideo()
        }
        emitMediaState()
    }

    /// Toggle the loudspeaker route.
    func toggleSpeaker() {
        guard var c = activeCall else { return }
        c.isSpeaker.toggle()
        activeCall = c
        WebRTCService.shared.setSpeakerOn(c.isSpeaker)
    }

    private func emitMediaState() {
        guard let call = activeCall, SocketClient.shared.state == .connected else { return }
        SocketClient.shared.emit("call_media_state", [
            "call_id": call.callId,
            "audio_muted": call.isMuted,
            "video_enabled": !call.isCameraOff,
            "csrf_token": api.csrfToken,
        ])
    }

    func loadBootstrap() async {
        do {
            let data = try await api.bootstrap()
            syncEngine.reset()
            bootstrap = data
            contacts = applyStoredMuteState(to: data.contacts)
            decryptContactPreviews()
            route = .main
            connectSocket()
            Task { await refreshDialogRequests() }
            if data.hasMoreContacts {
                Task { await refreshContacts() }
            }
            // Register iOS X25519/Ed25519 keys if not yet done (background, non-blocking)
            Task { await registerV3KeysIfNeeded() }
        } catch APIError.unauthorized {
            route = .login
        } catch {
            errorMessage = error.localizedDescription
            route = .login
        }
    }

    // Generate and register iOS-specific X25519 + Ed25519 keys with the server.
    // Only runs once — if keys already exist in Keychain, skips the server call.
    // This lets the web client send X3DH-encrypted messages addressed to iOS.
    func registerV3KeysIfNeeded() async {
        // Skip if already registered (both keys in Keychain)
        guard KeychainService.loadX25519PrivateKey() == nil ||
              KeychainService.loadEd25519PrivateKey() == nil else { return }
        let serverHasIdentityKeys = !(bootstrap?.crypto.x25519PublicKey ?? "").isEmpty ||
            !(bootstrap?.crypto.ed25519PublicKey ?? "").isEmpty
        guard !serverHasIdentityKeys else { return }

        let (ikPrivRaw, ikPubRaw)   = V3CryptoService.generateX25519KeyPair()
        let (edPrivRaw, edPubRaw)   = V3CryptoService.generateEd25519KeyPair()

        let ikPubB64u  = V3CryptoService.b64uEncode(ikPubRaw)
        let edPubB64u  = V3CryptoService.b64uEncode(edPubRaw)

        // Challenge: sign the identity key public bytes with the Ed25519 key
        let challenge = ikPubB64u
        guard let sig = try? V3CryptoService.ed25519Sign(privateRaw: edPrivRaw, message: challenge) else { return }
        let sigB64u = V3CryptoService.b64uEncode(sig)

        do {
            try await api.registerV3Keys(
                x25519Pub: ikPubB64u,
                ed25519Pub: edPubB64u,
                challenge: challenge,
                signature: sigB64u
            )
        } catch {
            return  // Network/auth error — will retry on next launch
        }

        // Persist private keys to Keychain only after successful server registration
        try? KeychainService.saveX25519PrivateKey(ikPrivRaw)
        try? KeychainService.saveEd25519PrivateKey(edPrivRaw)

        // Generate and upload a signed prekey (id=1)
        let (spkPrivRaw, spkPubRaw) = V3CryptoService.generateX25519KeyPair()
        let spkPubB64u = V3CryptoService.b64uEncode(spkPubRaw)
        if let spkSig = try? V3CryptoService.ed25519Sign(privateRaw: edPrivRaw, message: spkPubB64u) {
            let spkSigB64u = V3CryptoService.b64uEncode(spkSig)
            if (try? await api.uploadSignedPrekey(id: 1, publicKey: spkPubB64u, signature: spkSigB64u)) != nil {
                try? KeychainService.saveSignedPrekeyPrivateKey(spkPrivRaw, id: 1)
            }
        }
    }

    /// Block a contact and drop them from the local list.
    /// Returns nil on success, or a user-facing error message on failure.
    func blockContact(_ contact: Contact) async -> String? {
        guard let uid = contact.userId else { return "Не удалось определить пользователя." }
        do {
            try await api.blockUser(userId: uid)
            contacts.removeAll { $0.chatId == contact.chatId }
            return nil
        } catch APIError.unauthorized {
            route = .login
            return nil
        } catch {
            return error.localizedDescription
        }
    }

    func refreshContacts() async {
        do {
            contacts = applyStoredMuteState(to: try await api.getContacts())
            decryptContactPreviews()
        }
        catch APIError.unauthorized { route = .login }
        catch { errorMessage = error.localizedDescription }
    }

    private func showCallError(_ message: String) {
        callErrorClearTask?.cancel()
        callError = message
        callErrorClearTask = Task { @MainActor [weak self] in
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard !Task.isCancelled, self?.callError == message else { return }
            self?.callErrorClearTask = nil
            self?.callError = nil
        }
    }

    func logout() async {
        disconnectSocket()
        try? await api.logout()
        KeychainService.deleteAllLocalSecrets()
        syncEngine.reset()
        await ChatLocalStore.shared.resetAll()
        bootstrap = nil; contacts = []; pendingRequests = []; route = .login
    }

    func isChatMuted(_ chatId: String) -> Bool {
        mutedChatIds.contains(normalizedChatId(chatId))
    }

    @discardableResult
    func toggleChatMuted(chatId: String) -> Bool {
        let chatId = normalizedChatId(chatId)
        guard !chatId.isEmpty else { return false }

        if let contact = contacts.first(where: { $0.chatId == chatId }),
           isChatMuteRestricted(contact) {
            mutedChatIds.remove(chatId)
            setContactMuted(chatId: chatId, muted: false)
            saveMutedChatIds()
            return false
        }

        let muted: Bool
        if mutedChatIds.contains(chatId) {
            mutedChatIds.remove(chatId)
            muted = false
        } else {
            mutedChatIds.insert(chatId)
            muted = true
        }
        setContactMuted(chatId: chatId, muted: muted)
        saveMutedChatIds()
        return muted
    }

    func refreshDialogRequests() async {
        do { pendingRequests = try await api.getDialogRequests() }
        catch APIError.unauthorized { route = .login }
        catch { }
    }

    // MARK: - Socket lifecycle

    func connectSocket() {
        let token = api.csrfToken.isEmpty ? (bootstrap?.csrfToken ?? "") : api.csrfToken
        guard !token.isEmpty else { return }
        SocketClient.shared.connect(csrfToken: token)
        if SocketClient.shared.state == .connected {
            markActive()
        }
    }

    func disconnectSocket() {
        markInactive()
        SocketClient.shared.disconnect()
    }

    func reconnectRealtime() async {
        SocketClient.shared.disconnect()
        try? await Task.sleep(nanoseconds: 350_000_000)
        connectSocket()
        await refreshContacts()
        await recoverActiveChatSync()
    }

    private func handleSocketStateChanged() {
        socketState = SocketClient.shared.state
        switch SocketClient.shared.state {
        case .connected:
            markActive()
            // Reconcile call state with the server: if we still show a call the
            // server no longer knows about, call_sync tears our UI down.
            SocketClient.shared.emit("call_sync", ["csrf_token": api.csrfToken])
            Task {
                await refreshContacts()
                await recoverActiveChatSync()
            }
        case .disconnected:
            stopPresenceTimer()
        case .connecting:
            break
        }
    }

    private func markActive() {
        guard route == .main, SocketClient.shared.state == .connected else { return }
        SocketClient.shared.emit("activity_update", ["active": true])
        startPresenceTimer()
    }

    private func markInactive() {
        stopPresenceTimer()
        guard SocketClient.shared.state == .connected else { return }
        SocketClient.shared.emit("activity_update", ["active": false])
    }

    private func startPresenceTimer() {
        presenceTimer?.invalidate()
        presenceTimer = Timer.scheduledTimer(withTimeInterval: 45, repeats: true) { _ in
            Task { @MainActor in
                guard SocketClient.shared.state == .connected else { return }
                SocketClient.shared.emit("activity_update", ["active": true])
            }
        }
    }

    private func stopPresenceTimer() {
        presenceTimer?.invalidate()
        presenceTimer = nil
    }

    func primeChatSync(chatId: String) async {
        await syncEngine.prime(chatId: chatId)
    }

    func recoverChatSync(chatId: String) async {
        let events = await syncEngine.recoverChat(chatId: chatId)
        for event in events {
            postReplayEvent(event)
        }
    }

    private func recoverActiveChatSync() async {
        guard let chatId = activeChatId else { return }
        await recoverChatSync(chatId: chatId)
    }

    // MARK: - Incoming message from socket

    /// Called by ChatListView and ChatView when a socket event carries a new message.
    /// Updates the contact row in the sidebar (preview text, time, unread badge).
    func handleIncomingSocketMessage(_ payload: [String: Any]) {
        guard let chatId = payload["chat_id"] as? String else { return }

        // Find contact index
        guard let idx = contacts.firstIndex(where: { $0.chatId == chatId }) else { return }

        let preview = (payload["message"] as? String).map { msg -> String in
            // Call log message
            if msg.hasPrefix("{"),
               let data = msg.data(using: .utf8),
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               obj["__suncall"] != nil {
                let ct = obj["call_type"] as? String ?? "audio"
                return ct == "video" ? "📹 Видеозвонок" : "📞 Звонок"
            }
            // Raw encrypted blob → show placeholder
            if msg.hasPrefix("{") || msg.count > 200 { return "🔐 Encrypted message" }
            return msg
        } ?? "New message"

        let ts = SunDateParser.timestamp(fromAny: payload["created_at"]) ?? Date().timeIntervalSince1970

        contacts[idx].lastMessage = preview
        contacts[idx].lastMessageTime = ts
        contacts[idx].initialLastMessagePreview = preview
        contacts[idx].lastSenderId = payload["sender_user_id"] as? Int

        if let rawMessage = payload["message"] as? String {
            contacts[idx].initialLastMessagePreview = decryptPreview(
                rawMessage,
                isSelf: (payload["sender_user_id"] as? Int) == bootstrap?.user.id
            )
        }

        // Only bump unread when this chat is not currently open
        if activeChatId != chatId {
            contacts[idx].unreadCount += 1
        }

        // Re-sort: pinned first, then by lastMessageTime descending
        contacts.sort {
            if $0.isPinned != $1.isPinned { return $0.isPinned }
            return ($0.previewTimestamp ?? 0) > ($1.previewTimestamp ?? 0)
        }
    }

    /// Called when the user opens a chat — clears the unread badge.
    func clearUnread(chatId: String) {
        guard let idx = contacts.firstIndex(where: { $0.chatId == chatId }) else { return }
        contacts[idx].unreadCount = 0
    }

    func applyDraftUpdate(chatId: String, draftText: String, updatedAtRaw: String, hasDraft: Bool) {
        let targetChatId = normalizedChatId(chatId)
        guard !targetChatId.isEmpty else { return }
        guard let idx = contacts.firstIndex(where: { normalizedChatId($0.chatId) == targetChatId }) else {
            Task { await refreshContacts() }
            return
        }
        let normalizedDraft = draftText.replacingOccurrences(of: "\r\n", with: "\n")
        let hasMeaningfulDraft = hasDraft && !normalizedDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        contacts[idx].draftText = hasMeaningfulDraft ? normalizedDraft : nil
        contacts[idx].draftUpdatedAt = SunDateParser.timestamp(from: updatedAtRaw)
        contacts[idx].hasDraft = hasMeaningfulDraft
        contacts.sort {
            if $0.isPinned != $1.isPinned { return $0.isPinned }
            return ($0.previewTimestamp ?? 0) > ($1.previewTimestamp ?? 0)
        }
    }

    private func applyDraftUpdate(_ payload: [String: Any]) {
        let chatId = (payload["chat_id"] as? String) ?? ""
        let hasDraft = (payload["has_draft"] as? Bool) ?? false
        let rawDraft = (payload["draft_text"] as? String) ?? ""
        let updatedAt = (payload["updated_at"] as? String) ?? ""
        applyDraftUpdate(
            chatId: chatId,
            draftText: hasDraft ? draftPreviewText(rawDraft) : "",
            updatedAtRaw: updatedAt,
            hasDraft: hasDraft
        )
    }

    private func normalizedChatId(_ chatId: String) -> String {
        chatId.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func isChatMuteRestricted(_ contact: Contact) -> Bool {
        guard let myId = bootstrap?.user.id else { return false }
        return contact.userId == myId
    }

    private func applyStoredMuteState(to loadedContacts: [Contact]) -> [Contact] {
        loadedContacts.map { contact in
            var next = contact
            next.isMuted = !isChatMuteRestricted(next) && mutedChatIds.contains(normalizedChatId(next.chatId))
            return next
        }
    }

    private func setContactMuted(chatId: String, muted: Bool) {
        guard let idx = contacts.firstIndex(where: { $0.chatId == chatId }) else { return }
        contacts[idx].isMuted = muted
    }

    private func loadMutedChatIds() {
        guard let raw = UserDefaults.standard.string(forKey: mutedChatIdsDefaultsKey),
              let data = raw.data(using: .utf8),
              let decoded = try? JSONDecoder().decode([String].self, from: data) else {
            mutedChatIds = []
            return
        }
        mutedChatIds = Set(decoded.map(normalizedChatId).filter { !$0.isEmpty })
    }

    private func saveMutedChatIds() {
        let ids = Array(mutedChatIds).sorted()
        guard let data = try? JSONEncoder().encode(ids),
              let raw = String(data: data, encoding: .utf8) else { return }
        UserDefaults.standard.set(raw, forKey: mutedChatIdsDefaultsKey)
    }

    private func decryptContactPreviews() {
        let myId = bootstrap?.user.id ?? 0
        let privateKeyPEM = KeychainService.loadPrivateKey()
        for index in contacts.indices {
            if contacts[index].hasDraft, let draft = contacts[index].draftText, !draft.isEmpty {
                contacts[index].draftText = draftPreviewText(draft, privateKeyPEM: privateKeyPEM)
            }
            guard let raw = contacts[index].lastMessage, raw.hasPrefix("{") else { continue }
            // Call messages can be labelled without a decryption key
            if let data = raw.data(using: .utf8),
               let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               obj["__suncall"] != nil {
                let ct = obj["call_type"] as? String ?? "audio"
                contacts[index].initialLastMessagePreview = ct == "video" ? "📹 Видеозвонок" : "📞 Звонок"
                continue
            }
            guard let privateKeyPEM else { continue }
            let text = decryptPreview(raw, isSelf: contacts[index].lastSenderId == myId, privateKeyPEM: privateKeyPEM)
            if !text.isEmpty, text != raw {
                contacts[index].initialLastMessagePreview = text
            }
        }
    }

    private func draftPreviewText(_ raw: String, privateKeyPEM: String? = nil) -> String {
        let normalized = raw.replacingOccurrences(of: "\r\n", with: "\n")
        guard normalized.hasPrefix("{") else { return normalized }
        return decryptPreview(normalized, isSelf: true, privateKeyPEM: privateKeyPEM)
    }

    private func decryptPreview(_ raw: String, isSelf: Bool, privateKeyPEM: String? = nil) -> String {
        guard raw.hasPrefix("{") else { return raw }
        // Unencrypted call/media envelopes can be labelled without a key.
        if let label = mediaPreviewLabel(raw) { return label }
        guard let pem = privateKeyPEM ?? KeychainService.loadPrivateKey() else { return "🔐 Зашифровано" }
        let result = SunCrypto.decryptMessageForDisplay(raw, isSelf: isSelf, privateKeyPEM: pem)
        if result == "__v3__" { return "🔐 Зашифровано" }
        // Decrypted payloads are often media/call envelopes — show a friendly
        // label instead of leaking raw __sunfile / __suncall JSON.
        if let label = mediaPreviewLabel(result) { return label }
        if result.isEmpty { return "🔐 Зашифровано" }
        return result
    }

    /// Maps a __suncall / __sunfile JSON envelope to a short, human label.
    /// Returns nil for anything that isn't a recognised media/call envelope
    /// (e.g. encrypted v2 ciphertext or plain text), so it's safe to call on
    /// both raw and decrypted strings.
    private func mediaPreviewLabel(_ text: String) -> String? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("{"),
              let data = trimmed.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }

        if obj["__suncall"] != nil {
            let ct = obj["call_type"] as? String ?? "audio"
            return ct == "video" ? "📹 Видеозвонок" : "📞 Звонок"
        }

        let mime = ((obj["mime"] as? String) ?? (obj["mime_type"] as? String) ?? "").lowercased()
        let hasURL = (obj["url"] as? String)?.isEmpty == false
            || (obj["file_url"] as? String)?.isEmpty == false
            || (obj["src"] as? String)?.isEmpty == false
        // Require a real media signal — never trip on v2 ciphertext (which has
        // a "data" field but no __sunfile / mime / url).
        guard obj["__sunfile"] != nil || !mime.isEmpty || hasURL else { return nil }

        let mediaType = (obj["media_type"] as? String ?? "").lowercased()
        let name = (obj["name"] as? String ?? "").lowercased()
        if mediaType == "audio" || mime.hasPrefix("audio/") || name.hasPrefix("voice") {
            return "🎤 Голосовое сообщение"
        }
        if mediaType == "photo" || mediaType == "image" || mime.hasPrefix("image/") {
            return "📷 Фото"
        }
        if mediaType == "video" || mime.hasPrefix("video/") {
            return "🎥 Видео"
        }
        return "📎 Файл"
    }

    // MARK: - Call History Local Storage

    func saveCallHistory() {
        if let data = try? JSONEncoder().encode(callHistory) {
            UserDefaults.standard.set(data, forKey: "sunmsg_call_history")
        }
    }

    private func loadCallHistory() {
        if let data = UserDefaults.standard.data(forKey: "sunmsg_call_history"),
           let history = try? JSONDecoder().decode([CallRecord].self, from: data) {
            self.callHistory = history
        }
    }

    private func addCallRecord(name: String, callType: String, isOutgoing: Bool, missed: Bool, durationSec: Int?, chatId: String?) {
        let duration: String?
        if let sec = durationSec, sec > 0, !missed {
            if sec >= 3600 {
                duration = String(format: "%d:%02d:%02d", sec / 3600, (sec % 3600) / 60, sec % 60)
            } else {
                duration = String(format: "%02d:%02d", sec / 60, sec % 60)
            }
        } else {
            duration = nil
        }
        let record = CallRecord(
            name: name,
            callType: callType == "video" ? .video : .audio,
            direction: isOutgoing ? .outgoing : .incoming,
            missed: missed,
            when: smFormatTime(Date().timeIntervalSince1970),
            duration: duration,
            isOnline: false,
            chatId: chatId
        )
        callHistory.insert(record, at: 0)
        saveCallHistory()
    }
}

// MARK: - App colour scheme preference

enum AppColorScheme: String, CaseIterable {
    case system = "system"
    case light  = "light"
    case dark   = "dark"

    var label: String {
        switch self { case .system: "System"; case .light: "Light"; case .dark: "Dark" }
    }
    var icon: String {
        switch self { case .system: "circle.lefthalf.filled"; case .light: "sun.max"; case .dark: "moon.stars" }
    }
    var colorScheme: ColorScheme? {
        switch self { case .system: nil; case .light: .light; case .dark: .dark }
    }
}

// MARK: - Root router

struct ContentView: View {
    @EnvironmentObject var session: SessionStore
    @AppStorage("appColorScheme") private var schemePref: String = AppColorScheme.system.rawValue

    private var preferredScheme: ColorScheme? {
        AppColorScheme(rawValue: schemePref)?.colorScheme
    }

    var body: some View {
        ZStack {
            Color.smBg.ignoresSafeArea()
            Group {
                switch session.route {
                case .loading:
                    SplashView().task { await session.loadBootstrap() }
                case .login:
                    NativeLoginView()
                case .register:
                    NativeRegisterView()
                case .main:
                    MainTabView()
                }
            }
            .id(session.route)
            .transition(.opacity)
        }
        .preferredColorScheme(preferredScheme)
    }
}

// MARK: - Splash (matches prototype exactly)

struct SplashView: View {
    var body: some View {
        ZStack {
            Color.smBg.ignoresSafeArea()

            // Warm radial wash
            RadialGradient(
                colors: [Color.smAccent.opacity(0.10), Color.clear],
                center: UnitPoint(x: 0.5, y: 0.40),
                startRadius: 0, endRadius: 300
            )
            .ignoresSafeArea()

            GeometryReader { geo in
                let cy = geo.size.height * 0.40
                Circle()
                    .strokeBorder(style: StrokeStyle(lineWidth: 0.5, dash: [3, 4]))
                    .foregroundStyle(Color.smAccent.opacity(0.30))
                    .frame(width: 260, height: 260)
                    .position(x: geo.size.width / 2, y: cy)
                Circle()
                    .strokeBorder(style: StrokeStyle(lineWidth: 0.5, dash: [3, 4]))
                    .foregroundStyle(Color.smAccent.opacity(0.15))
                    .frame(width: 340, height: 340)
                    .position(x: geo.size.width / 2, y: cy)
            }

            VStack(spacing: 0) {
                Spacer()
                AmberOrb(size: 120)
                    .padding(.bottom, 24)

                Text("sun")
                    .font(.system(size: 40, weight: .bold))
                    .foregroundStyle(Color.smText)
                    .tracking(-1.4)

                Text("тихие сообщения, тёплый свет")
                    .font(.custom("Georgia", size: 16).italic())
                    .foregroundStyle(Color.smMuted)
                    .padding(.top, 10)

                Spacer()
                Spacer()

                SplashLoadingDotsView()
                    .padding(.bottom, 110)
            }
        }
    }
}

private struct SplashLoadingDotsView: View {
    @State private var dotPhase: Double = 0
    private let timer = Timer.publish(every: 0.18, on: .main, in: .common).autoconnect()

    var body: some View {
        HStack(spacing: 8) {
            ForEach(0..<4, id: \.self) { i in
                let phase = (sin(dotPhase + Double(i) * 0.7) + 1) / 2
                Circle()
                    .fill(Color.smAccent)
                    .frame(width: 6, height: 6)
                    .opacity(0.25 + phase * 0.75)
                    .scaleEffect(0.85 + phase * 0.30)
            }
        }
        .onReceive(timer) { _ in dotPhase += 0.20 }
    }
}

// MARK: - Sun mark (matches prototype BigSunMark exactly)
// Outer thin amber ring + inner filled amber disk. No bubble icon.

struct AmberOrb: View {
    let size: CGFloat

    var body: some View {
        ZStack {
            // Outer ring (stroke only, no fill)
            Circle()
                .stroke(Color(hex: "#d6a14a").opacity(0.9), lineWidth: size * 0.045)
                .frame(width: size * 0.97, height: size * 0.97)

            // Inner filled disk with radial amber gradient
            Circle()
                .fill(
                    RadialGradient(
                        colors: [
                            Color(hex: "#e6b772"),
                            Color(hex: "#c4943c"),
                            Color(hex: "#9b6e26"),
                        ],
                        center: UnitPoint(x: 0.5, y: 0.40),
                        startRadius: 0,
                        endRadius: size * 0.4
                    )
                )
                .frame(width: size * 0.72, height: size * 0.72)
                .shadow(color: Color.smAccent.opacity(0.32), radius: size * 0.12, x: 0, y: size * 0.04)

            // Subtle specular highlight
            Circle()
                .fill(
                    RadialGradient(
                        colors: [Color.white.opacity(0.35), Color.clear],
                        center: UnitPoint(x: 0.38, y: 0.32),
                        startRadius: 0, endRadius: size * 0.22
                    )
                )
                .frame(width: size * 0.55, height: size * 0.55)
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Main tab view (custom tab bar matching prototype exactly)

struct MainTabView: View {
    @EnvironmentObject var session: SessionStore

    var body: some View {
        ZStack {
            TabView(selection: $session.selectedTab) {
                NavigationStack { ChatListView() }
                    .tabItem { Label("Чаты", systemImage: "bubble.left.and.bubble.right") }
                    .tag(0)

                NavigationStack { CallsView() }
                    .tabItem { Label("Звонки", systemImage: "phone") }
                    .tag(1)

                NavigationStack { PeopleView() }
                    .tabItem { Label("Контакты", systemImage: "person.2") }
                    .badge(session.pendingRequests.count)
                    .tag(2)

                NavigationStack { SettingsView() }
                    .tabItem { Label("Настройки", systemImage: "gearshape") }
                    .tag(3)
            }
            .tint(Color.smAccent2)
            .onReceive(NotificationCenter.default.publisher(for: .openNewChat)) { _ in
                session.selectedTab = 2
            }
            // Present the in-call screen whenever there is an active call. The
            // binding is read-only in effect: dismissal is driven solely by
            // `session.activeCall` becoming nil (via the End button or a remote
            // call_ended/call_cancelled event), never by a side effect here — so
            // teardown happens exactly once.
            .fullScreenCover(item: $session.activeCall) { callItem in
                InCallView(providedCall: callItem, session: session)
            }

            // Incoming call overlay (top of stack)
            if let incoming = session.incomingCall {
                IncomingCallView(call: incoming, session: session)
                    .transition(.opacity.animation(.easeInOut(duration: 0.25)))
                    .zIndex(10)
            }

            // Call error toast
            if let err = session.callError {
                VStack {
                    Spacer()
                    HStack(spacing: 10) {
                        Image(systemName: "phone.slash.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(Color.smDanger)
                        Text(err)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Color.smText)
                            .lineLimit(2)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.smDanger.opacity(0.3), lineWidth: 0.5))
                    .shadow(color: Color.black.opacity(0.12), radius: 8, x: 0, y: 4)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 90)
                }
                .transition(.move(edge: .bottom).combined(with: .opacity).animation(.spring(duration: 0.35)))
                .zIndex(5)
            }
        }
    }
}

// MARK: - Settings view (matches prototype "Настройки" home exactly)

struct SettingsView: View {
    @EnvironmentObject var session: SessionStore
    @AppStorage("appColorScheme") private var schemePref: String = AppColorScheme.system.rawValue
    @State private var showMnemonicInfo = false
    @State private var isLoadingSettings = false
    @State private var isSavingSettings = false
    @State private var isSyncing = false
    @State private var settingsError: String?
    @State private var selectedLanguage = "ru"
    @State private var showOnlineStatus = true
    @State private var shareTyping = true
    @State private var sendReadReceipts = true
    @State private var muteDialogRequests = false
    @State private var socketState = SocketClient.State.disconnected
    @State private var navigateToPrivacy = false
    @State private var navigateToAppearance = false
    @State private var navigateToDevices = false
    @State private var showProfileSheet = false
    @State private var showQRSheet = false
    @State private var showLogoutConfirm = false
    @State private var showLanguageDialog = false
    @State private var showThemeSheet = false
    @State private var hasPrivateKeyLoaded = false

    private var user: BootstrapUser? { session.bootstrap?.user }

    var body: some View {
        ZStack {
            Color.smBg.ignoresSafeArea()

            VStack(spacing: 0) {
                // Header matching prototype: title + QR trailing
                HStack {
                    Text("Настройки")
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(Color.smText)
                        .tracking(-0.6)
                    Spacer()
                    Button(action: { showQRSheet = true }) {
                        Image(systemName: "qrcode")
                            .font(.system(size: 18, weight: .medium))
                            .foregroundStyle(Color.smAccent2)
                            .frame(width: 36, height: 36)
                            .background(Color.smAccent.opacity(0.10), in: Circle())
                    }
                    .buttonStyle(.plain)
                }
                .padding(.horizontal, 16)
                .padding(.top, 16)
                .padding(.bottom, 6)

                ScrollView(showsIndicators: false) {
                    VStack(spacing: 12) {
                        profileCard
                            .padding(.top, 12)

                        // Primary group — amber tints (key features)
                        settingsGroup {
                            settingsRow(
                                icon: "key.fill",
                                tint: .amber,
                                label: "Приватность и безопасность",
                                sub: "Ключи, устройства, блокировки",
                                badge: hasPrivateKeyLoaded ? nil : "!",
                                action: { navigateToPrivacy = true }
                            )
                            divider
                            settingsRow(
                                icon: "bell.fill",
                                tint: .amber,
                                label: "Уведомления",
                                sub: muteDialogRequests ? "Заглушены" : "Звуки, привью, тёплый режим",
                                action: {
                                    muteDialogRequests.toggle()
                                    saveSettings(["mute_dialog_requests": muteDialogRequests])
                                }
                            )
                            divider
                            settingsRow(
                                icon: "paintpalette.fill",
                                tint: .amber,
                                label: "Внешний вид",
                                sub: themeLabel,
                                action: { navigateToAppearance = true }
                            )
                            divider
                            settingsRow(
                                icon: "externaldrive.fill",
                                tint: .amber,
                                label: "Данные и память",
                                sub: "\(session.contacts.count) диалогов",
                                isLast: true,
                                action: {
                                    Task {
                                        isSyncing = true
                                        await session.loadBootstrap()
                                        isSyncing = false
                                    }
                                }
                            )
                        }

                        // Neutral group
                        settingsGroup {
                            settingsRow(
                                icon: "globe",
                                tint: .neutral,
                                label: "Язык",
                                trail: languageLabel(selectedLanguage),
                                action: { showLanguageDialog = true }
                            )
                            divider
                            settingsRow(
                                icon: "iphone",
                                tint: .neutral,
                                label: "Устройства",
                                trail: "1",
                                action: { navigateToDevices = true }
                            )
                            divider
                            settingsRow(
                                icon: "square.and.arrow.up",
                                tint: .neutral,
                                label: "Переподключить realtime",
                                sub: socketStatusText,
                                isLast: true,
                                action: {
                                    Task {
                                        isSyncing = true
                                        await session.reconnectRealtime()
                                        isSyncing = false
                                    }
                                }
                            )
                        }

                        // Privacy toggles
                        settingsGroup {
                            toggleSettingsRow(
                                label: "Статус «в сети»",
                                sub: showOnlineStatus ? "Видно контактам" : "Скрыт",
                                isOn: Binding(
                                    get: { showOnlineStatus },
                                    set: { v in
                                        showOnlineStatus = v
                                        saveSettings([
                                            "hide_online_status": !v,
                                            "last_seen_visibility": v ? "contacts" : "nobody",
                                        ], reconnect: true)
                                    }
                                )
                            )
                            divider
                            toggleSettingsRow(
                                label: "Индикатор набора",
                                sub: shareTyping ? "Отправлять" : "Не отправлять",
                                isOn: Binding(
                                    get: { shareTyping },
                                    set: { v in
                                        shareTyping = v
                                        saveSettings(["typing_privacy": v ? "contacts" : "nobody"])
                                    }
                                )
                            )
                            divider
                            toggleSettingsRow(
                                label: "Подтверждения прочтения",
                                sub: sendReadReceipts ? "Включены" : "Скрыты",
                                isOn: Binding(
                                    get: { sendReadReceipts },
                                    set: { v in
                                        sendReadReceipts = v
                                        saveSettings(["read_receipts_privacy": v ? "contacts" : "nobody"])
                                    }
                                ),
                                isLast: true
                            )
                        }

                        // Help + logout
                        settingsGroup {
                            settingsRow(
                                icon: "questionmark.circle.fill",
                                tint: .neutral,
                                label: "Помощь",
                                sub: "Открыть сайт поддержки",
                                action: {
                                    if let url = URL(string: kBaseURL) {
                                        UIApplication.shared.open(url)
                                    }
                                }
                            )
                            divider
                            settingsRow(
                                icon: "rectangle.portrait.and.arrow.right",
                                tint: .danger,
                                label: "Выйти из аккаунта",
                                isLast: true,
                                action: { showLogoutConfirm = true }
                            )
                        }

                        if let settingsError {
                            Text(settingsError)
                                .font(.system(size: 12.5))
                                .foregroundStyle(Color.smDanger)
                                .multilineTextAlignment(.center)
                                .padding(.horizontal, 18)
                        }

                        Text("sun · версия 1.0")
                            .font(.system(size: 10.5))
                            .foregroundStyle(Color.smFaint)
                            .padding(.top, 6)
                            .padding(.bottom, 28)
                    }
                    .padding(.horizontal, 12)
                }
            }
        }
        .navigationBarHidden(true)
        .navigationDestination(isPresented: $navigateToPrivacy) {
            PrivacySettingsView()
        }
        .navigationDestination(isPresented: $navigateToAppearance) {
            AppearanceSettingsView()
        }
        .navigationDestination(isPresented: $navigateToDevices) {
            DevicesView()
        }
        .sheet(isPresented: $showProfileSheet) {
            ProfileSettingsView()
        }
        .sheet(isPresented: $showQRSheet) {
            UserQRSheet()
        }
        .confirmationDialog("Выйти из аккаунта?", isPresented: $showLogoutConfirm, titleVisibility: .visible) {
            Button("Выйти", role: .destructive) { Task { await session.logout() } }
            Button("Отмена", role: .cancel) { }
        } message: {
            Text("Сообщения останутся зашифрованными на устройстве, пока вы снова не войдёте.")
        }
        .confirmationDialog("Язык интерфейса", isPresented: $showLanguageDialog, titleVisibility: .visible) {
            Button("Русский") { setLanguage("ru") }
            Button("English") { setLanguage("en") }
            Button("Отмена", role: .cancel) { }
        }
        .task { await loadSettingsIfNeeded() }
        .onAppear {
            socketState = SocketClient.shared.state
            refreshPrivateKeyState()
        }
        .onChange(of: navigateToPrivacy) { _, isPresented in
            if !isPresented {
                refreshPrivateKeyState()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
            refreshPrivateKeyState()
        }
        .onReceive(NotificationCenter.default.publisher(for: .smSocketStateChanged)) { _ in
            socketState = SocketClient.shared.state
        }
    }

    private var themeLabel: String {
        AppColorScheme(rawValue: schemePref)?.label ?? "Система"
    }

    private func languageLabel(_ language: String) -> String {
        language == "en" ? "English" : "Русский"
    }

    private func refreshPrivateKeyState() {
        hasPrivateKeyLoaded = KeychainService.hasPrivateKey()
    }

    private var divider: some View {
        Rectangle()
            .fill(Color.smBorderSoft)
            .frame(height: 0.5)
            .padding(.leading, 54)
    }

    // MARK: - Profile card (matches prototype exactly: 52×52 avatar, 16/600 name, amber @handle, sync chip)

    private var profileCard: some View {
        Button(action: { showProfileSheet = true }) {
            HStack(spacing: 12) {
                SmAvatarView(name: user?.displayName ?? "?", avatarUrl: user?.avatarUrl, size: 52)

                VStack(alignment: .leading, spacing: 2) {
                    Text(user?.displayName ?? "—")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color.smText)
                        .tracking(-0.3)
                        .lineLimit(1)
                    Text("@\(user?.username ?? "—")")
                        .font(.system(size: 12.5, weight: .medium))
                        .foregroundStyle(Color.smAccent2)
                    SyncChipView()
                        .padding(.top, 4)
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color.smFaint)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
            .shadow(color: Color(hex: "#281e0f").opacity(0.05), radius: 2, x: 0, y: 1)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Settings group helpers (prototype-aligned)

    private enum RowTint { case amber, neutral, danger }

    @ViewBuilder
    private func settingsGroup<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 0) { content() }
            .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
            .shadow(color: Color(hex: "#281e0f").opacity(0.04), radius: 2, x: 0, y: 1)
    }

    private func settingsRow(
        icon: String,
        tint: RowTint,
        label: String,
        sub: String? = nil,
        trail: String? = nil,
        badge: String? = nil,
        isLast: Bool = false,
        action: @escaping () -> Void
    ) -> some View {
        let tintBg: Color = {
            switch tint {
            case .amber:   return Color.smAccent.opacity(0.10)
            case .neutral: return Color.smText.opacity(0.06)
            case .danger:  return Color.smDanger.opacity(0.10)
            }
        }()
        let tintFg: Color = {
            switch tint {
            case .amber:   return Color.smAccent2
            case .neutral: return Color.smText.opacity(0.65)
            case .danger:  return Color.smDanger
            }
        }()
        let labelColor: Color = tint == .danger ? Color.smDanger : Color.smText

        return Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(tintBg)
                        .frame(width: 30, height: 30)
                    Image(systemName: icon)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(tintFg)
                }
                VStack(alignment: .leading, spacing: 1) {
                    Text(label)
                        .font(.system(size: 14.5, weight: .medium))
                        .foregroundStyle(labelColor)
                        .tracking(-0.2)
                    if let sub {
                        Text(sub)
                            .font(.system(size: 11.5))
                            .foregroundStyle(Color.smMuted)
                            .lineLimit(1)
                    }
                }
                Spacer()
                if let badge {
                    Text(badge)
                        .font(.system(size: 10.5, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 6)
                        .frame(minWidth: 18, minHeight: 18)
                        .background(Color.smAccent, in: Capsule())
                }
                if let trail {
                    Text(trail)
                        .font(.system(size: 13))
                        .foregroundStyle(Color.smMuted)
                }
                if tint != .danger {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.smFaint)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func toggleSettingsRow(
        label: String,
        sub: String? = nil,
        isOn: Binding<Bool>,
        isLast: Bool = false
    ) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text(label)
                    .font(.system(size: 14.5, weight: .medium))
                    .foregroundStyle(Color.smText)
                    .tracking(-0.2)
                if let sub {
                    Text(sub)
                        .font(.system(size: 11.5))
                        .foregroundStyle(Color.smMuted)
                }
            }
            Spacer()
            Toggle("", isOn: isOn)
                .labelsHidden()
                .tint(Color.smAccent)
                .disabled(isSavingSettings || isLoadingSettings)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 11)
    }

    private var socketStatusText: String {
        switch socketState {
        case .connected: "Подключено"
        case .connecting: "Подключение…"
        case .disconnected: "Отключено"
        }
    }

    private func loadSettingsIfNeeded() async {
        guard !isLoadingSettings else { return }
        await loadSettings()
    }

    private func loadSettings() async {
        isLoadingSettings = true
        settingsError = nil
        do {
            let current = try await session.api.getSettings()
            showOnlineStatus = !current.hideOnlineStatus && current.lastSeenVisibility != "nobody"
            shareTyping = current.typingPrivacy != "nobody"
            sendReadReceipts = current.readReceiptsPrivacy != "nobody"
            muteDialogRequests = current.muteDialogRequests
            selectedLanguage = current.language
        } catch {
            settingsError = error.localizedDescription
        }
        isLoadingSettings = false
    }

    private func setLanguage(_ language: String) {
        let normalized = language == "en" ? "en" : "ru"
        guard selectedLanguage != normalized, !isSavingSettings else { return }
        selectedLanguage = normalized
        saveSettings(["language": normalized])
    }

    private func saveSettings(_ payload: [String: Any], reconnect: Bool = false) {
        guard !isSavingSettings else { return }
        isSavingSettings = true
        settingsError = nil
        Task {
            do {
                try await session.api.saveSettings(payload)
                if reconnect {
                    await session.reconnectRealtime()
                }
                await session.refreshContacts()
            } catch {
                settingsError = error.localizedDescription
                await loadSettings()
            }
            isSavingSettings = false
        }
    }

}

// MARK: - Profile Settings View

struct ProfileSettingsView: View {
    @EnvironmentObject var session: SessionStore
    @Environment(\.dismiss) private var dismiss
    @State private var displayName = ""
    @State private var username = ""
    @State private var isSaving = false
    @State private var saveError: String?
    @State private var showQRSheet = false

    private var user: BootstrapUser? { session.bootstrap?.user }
    private var trimmedDisplayName: String { displayName.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var normalizedUsername: String {
        var value = username.trimmingCharacters(in: .whitespacesAndNewlines)
        while value.hasPrefix("@") { value.removeFirst() }
        return value.lowercased()
    }
    private var canSaveProfile: Bool {
        guard let user else { return false }
        return !isSaving
            && !trimmedDisplayName.isEmpty
            && !normalizedUsername.isEmpty
            && (trimmedDisplayName != user.displayName || normalizedUsername != user.username)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.smBg.ignoresSafeArea()
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 20) {
                        // Avatar section
                        VStack(spacing: 12) {
                            ZStack(alignment: .bottomTrailing) {
                                SmAvatarView(name: user?.displayName ?? "?", avatarUrl: user?.avatarUrl, size: 80)
                                ZStack {
                                    Circle()
                                        .fill(Color.smAccent)
                                        .frame(width: 26, height: 26)
                                    Image(systemName: "camera.fill")
                                        .font(.system(size: 12))
                                        .foregroundStyle(Color(hex: "#15140e"))
                                }
                                .offset(x: 2, y: 2)
                            }
                            Text(user?.displayName ?? "—")
                                .font(.system(size: 18, weight: .semibold))
                                .foregroundStyle(Color.smText)
                                .tracking(-0.3)
                            Text("@\(user?.username ?? "—")")
                                .font(.system(size: 14))
                                .foregroundStyle(Color.smAccent2)
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.top, 20)

                        // Info rows
                        VStack(spacing: 0) {
                            profileInfoRow(label: "Имя", value: user?.displayName ?? "—", icon: "person.fill")
                            Rectangle().fill(Color.smBorderSoft).frame(height: 0.5).padding(.leading, 52)
                            profileInfoRow(label: "Логин", value: "@\(user?.username ?? "—")", icon: "at")
                            Rectangle().fill(Color.smBorderSoft).frame(height: 0.5).padding(.leading, 52)
                            profileInfoRow(label: "Язык", value: user?.uiLanguage.uppercased() ?? "RU", icon: "globe")
                        }
                        .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))

                        VStack(spacing: 0) {
                            profileEditRow(label: "Имя", icon: "person.fill") {
                                TextField("Имя", text: $displayName)
                                    .textInputAutocapitalization(.words)
                                    .autocorrectionDisabled(false)
                                    .multilineTextAlignment(.trailing)
                            }
                            Rectangle().fill(Color.smBorderSoft).frame(height: 0.5).padding(.leading, 52)
                            profileEditRow(label: "Логин", icon: "at") {
                                TextField("username", text: $username)
                                    .textInputAutocapitalization(.never)
                                    .autocorrectionDisabled(true)
                                    .textContentType(.username)
                                    .multilineTextAlignment(.trailing)
                            }
                        }
                        .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))

                        // QR button
                        Button(action: { showQRSheet = true }) {
                            HStack(spacing: 12) {
                                ZStack {
                                    RoundedRectangle(cornerRadius: 8)
                                        .fill(Color.smAccent.opacity(0.10))
                                        .frame(width: 32, height: 32)
                                    Image(systemName: "qrcode")
                                        .font(.system(size: 15))
                                        .foregroundStyle(Color.smAccent2)
                                }
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Мой QR код")
                                        .font(.system(size: 14.5, weight: .medium))
                                        .foregroundStyle(Color.smText)
                                    Text("Покажите другим пользователям")
                                        .font(.system(size: 12))
                                        .foregroundStyle(Color.smMuted)
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundStyle(Color.smFaint)
                            }
                            .padding(.horizontal, 14)
                            .padding(.vertical, 12)
                        }
                        .buttonStyle(.plain)
                        .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))

                        if let err = saveError {
                            Text(err)
                                .font(.system(size: 12.5))
                                .foregroundStyle(Color.smDanger)
                                .multilineTextAlignment(.center)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.bottom, 24)
                }
                .scrollDismissesKeyboard(.interactively)
            }
            .navigationTitle("Профиль")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.smBg, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                        .foregroundStyle(Color.smMuted)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Сохранение…" : "Сохранить") {
                        Task { await saveProfile() }
                    }
                    .disabled(!canSaveProfile)
                    .foregroundStyle(canSaveProfile ? Color.smAccent2 : Color.smFaint)
                }
            }
            .sheet(isPresented: $showQRSheet) {
                UserQRSheet()
            }
            .onAppear { hydrateFieldsFromUser() }
        }
    }

    private func profileInfoRow(label: String, value: String, icon: String) -> some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.smAccent.opacity(0.10))
                    .frame(width: 32, height: 32)
                Image(systemName: icon)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.smAccent2)
            }
            Text(label)
                .font(.system(size: 14.5, weight: .medium))
                .foregroundStyle(Color.smText)
                .lineLimit(1)
            Spacer(minLength: 12)
            Text(value)
                .font(.system(size: 14))
                .foregroundStyle(Color.smMuted)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .multilineTextAlignment(.trailing)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private func profileEditRow<Content: View>(
        label: String,
        icon: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.smAccent.opacity(0.10))
                    .frame(width: 32, height: 32)
                Image(systemName: icon)
                    .font(.system(size: 14))
                    .foregroundStyle(Color.smAccent2)
            }
            Text(label)
                .font(.system(size: 14.5, weight: .medium))
                .foregroundStyle(Color.smText)
            content()
                .font(.system(size: 14))
                .foregroundStyle(Color.smText)
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private func hydrateFieldsFromUser() {
        displayName = user?.displayName ?? ""
        username = user?.username ?? ""
    }

    private func saveProfile() async {
        let name = trimmedDisplayName
        let handle = normalizedUsername
        guard !name.isEmpty else {
            saveError = "Имя не может быть пустым."
            return
        }
        guard name.count <= 50 else {
            saveError = "Имя не должно превышать 50 символов."
            return
        }
        guard handle.range(of: #"^[a-z0-9_]{1,50}$"#, options: .regularExpression) != nil else {
            saveError = "Логин может содержать только a-z, 0-9 и _."
            return
        }

        isSaving = true
        saveError = nil
        do {
            try await session.api.saveSettings([
                "display_name": name,
                "username": handle,
            ])
            await session.loadBootstrap()
            hydrateFieldsFromUser()
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            saveError = error.localizedDescription
        }
        isSaving = false
    }
}

// MARK: - Appearance Settings View

struct AppearanceSettingsView: View {
    @AppStorage("appColorScheme") private var schemePref: String = AppColorScheme.system.rawValue
    @EnvironmentObject var session: SessionStore

    var body: some View {
        ZStack {
            Color.smBg.ignoresSafeArea()
            ScrollView(showsIndicators: false) {
                VStack(spacing: 20) {
                    // Theme picker
                    VStack(alignment: .leading, spacing: 8) {
                        Text("ТЕМА ОФОРМЛЕНИЯ")
                            .font(.system(size: 11.5, weight: .semibold))
                            .foregroundStyle(Color.smFaint)
                            .tracking(0.6)
                            .padding(.horizontal, 4)

                        VStack(spacing: 0) {
                            ForEach(AppColorScheme.allCases, id: \.rawValue) { scheme in
                                let isSelected = schemePref == scheme.rawValue
                                Button(action: { schemePref = scheme.rawValue }) {
                                    HStack(spacing: 14) {
                                        ZStack {
                                            RoundedRectangle(cornerRadius: 8)
                                                .fill(isSelected ? Color.smAccent.opacity(0.14) : Color.smText.opacity(0.06))
                                                .frame(width: 32, height: 32)
                                            Image(systemName: scheme.icon)
                                                .font(.system(size: 14))
                                                .foregroundStyle(isSelected ? Color.smAccent2 : Color.smText.opacity(0.65))
                                        }
                                        Text(schemeRussian(scheme))
                                            .font(.system(size: 15, weight: isSelected ? .semibold : .regular))
                                            .foregroundStyle(Color.smText)
                                        Spacer()
                                        if isSelected {
                                            Image(systemName: "checkmark.circle.fill")
                                                .font(.system(size: 18))
                                                .foregroundStyle(Color.smAccent)
                                        }
                                    }
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 13)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                if scheme != AppColorScheme.allCases.last {
                                    Rectangle()
                                        .fill(Color.smBorderSoft)
                                        .frame(height: 0.5)
                                        .padding(.leading, 54)
                                }
                            }
                        }
                        .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
                    }
                    .padding(.top, 16)

                    // Preview card
                    VStack(alignment: .leading, spacing: 8) {
                        Text("ПРЕДПРОСМОТР")
                            .font(.system(size: 11.5, weight: .semibold))
                            .foregroundStyle(Color.smFaint)
                            .tracking(0.6)
                            .padding(.horizontal, 4)

                        VStack(spacing: 10) {
                            HStack {
                                AmberOrb(size: 28)
                                Text("sun messenger")
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(Color.smText)
                                Spacer()
                                Image(systemName: "lock.fill")
                                    .font(.system(size: 12))
                                    .foregroundStyle(Color.smOnline)
                            }
                            HStack {
                                Spacer()
                                Text("Привет! Как дела?")
                                    .font(.system(size: 13))
                                    .foregroundStyle(Color.smBubbleOutText)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 8)
                                    .background(Color.smBubbleOut, in: RoundedRectangle(cornerRadius: 14))
                            }
                            HStack {
                                Text("Всё отлично, спасибо!")
                                    .font(.system(size: 13))
                                    .foregroundStyle(Color.smBubbleInText)
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 8)
                                    .background(Color.smBubbleIn, in: RoundedRectangle(cornerRadius: 14))
                                Spacer()
                            }
                        }
                        .padding(16)
                        .background(Color(hex: "#f2ede2"), in: RoundedRectangle(cornerRadius: 14))
                        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
                        .environment(\.colorScheme, AppColorScheme(rawValue: schemePref)?.colorScheme ?? .light)
                    }

                    Spacer().frame(height: 20)
                }
                .padding(.horizontal, 16)
            }
        }
        .navigationTitle("Внешний вид")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.smBg, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
    }

    private func schemeRussian(_ scheme: AppColorScheme) -> String {
        switch scheme {
        case .system: return "Системная"
        case .light:  return "Светлая"
        case .dark:   return "Тёмная"
        }
    }
}

// MARK: - Devices View

struct DevicesView: View {
    @EnvironmentObject var session: SessionStore
    @State private var devicesResponse: SessionDevicesResponse?
    @State private var isLoading = true
    @State private var errorMessage: String?
    @State private var pendingRevokeDevice: SessionDevice?
    @State private var showRevokeOthersConfirm = false
    @State private var isMutating = false

    var body: some View {
        ZStack {
            Color.smBg.ignoresSafeArea()
            ScrollView(showsIndicators: false) {
                Group {
                    if isLoading {
                        ProgressView()
                            .tint(Color.smAccent)
                            .frame(maxWidth: .infinity, minHeight: 220)
                    } else if let errorMessage {
                        deviceErrorView(errorMessage)
                    } else if let devicesResponse {
                        devicesContent(devicesResponse)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 16)
            }
            .refreshable { await loadDevices() }
        }
        .navigationTitle("Устройства")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.smBg, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { await loadDevices() }
        .confirmationDialog(revokeDialogTitle, isPresented: revokeDialogBinding, titleVisibility: .visible) {
            if let device = pendingRevokeDevice {
                Button(revokeActionTitle, role: .destructive) {
                    Task { await revoke(device) }
                }
            }
            Button("Отмена", role: .cancel) { pendingRevokeDevice = nil }
        } message: {
            Text(revokeDialogMessage)
        }
        .confirmationDialog("Завершить другие сессии?", isPresented: $showRevokeOthersConfirm, titleVisibility: .visible) {
            Button("Завершить все другие", role: .destructive) {
                Task { await revokeOthers() }
            }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Текущая сессия останется активной.")
        }
    }

    private var revokeDialogBinding: Binding<Bool> {
        Binding(
            get: { pendingRevokeDevice != nil },
            set: { if !$0 { pendingRevokeDevice = nil } }
        )
    }

    private var revokeDialogTitle: String {
        pendingRevokeDevice?.isCurrent == true ? "Выйти с этого устройства?" : "Завершить эту сессию?"
    }

    private var revokeDialogMessage: String {
        pendingRevokeDevice?.isCurrent == true
            ? "Вы выйдете из аккаунта на этом устройстве."
            : "Устройство будет отключено от аккаунта."
    }

    private var revokeActionTitle: String {
        pendingRevokeDevice?.isCurrent == true ? "Выйти" : "Завершить"
    }

    private func devicesContent(_ response: SessionDevicesResponse) -> some View {
        let current = response.devices.first(where: { $0.isCurrent })
        let others = response.devices.filter { !$0.isCurrent }

        return VStack(spacing: 20) {
            VStack(alignment: .leading, spacing: 8) {
                sectionHeader("АКТИВНЫЕ УСТРОЙСТВА")
                VStack(spacing: 0) {
                    if let current {
                        deviceRow(current)
                    }
                    ForEach(others.indices, id: \.self) { index in
                        let device = others[index]
                        if current != nil || index > 0 {
                            Divider().padding(.leading, 58).background(Color.smBorderSoft)
                        }
                        deviceRow(device)
                    }
                    if response.devices.isEmpty {
                        Text("Активные сессии не найдены.")
                            .font(.system(size: 13))
                            .foregroundStyle(Color.smMuted)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(14)
                    }
                }
                .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
                .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
            }

            if !others.isEmpty {
                Button(action: { showRevokeOthersConfirm = true }) {
                    HStack {
                        Image(systemName: "rectangle.stack.badge.minus")
                        Text(isMutating ? "Завершение…" : "Завершить другие сессии")
                        Spacer()
                    }
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.smDanger)
                    .padding(14)
                    .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
                }
                .buttonStyle(.plain)
                .disabled(isMutating)
            }

            VStack(alignment: .leading, spacing: 8) {
                sectionHeader("ПОЛИТИКА СЕССИИ")
                sessionPolicyView(response)
            }

            Spacer().frame(height: 20)
        }
    }

    private func deviceErrorView(_ message: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "exclamationmark.triangle")
                .font(.system(size: 32))
                .foregroundStyle(Color.smAccent)
            Text(message)
                .font(.system(size: 13))
                .foregroundStyle(Color.smMuted)
                .multilineTextAlignment(.center)
            Button("Повторить") { Task { await loadDevices() } }
                .foregroundStyle(Color.smAccent2)
        }
        .frame(maxWidth: .infinity, minHeight: 220)
    }

    private func sessionPolicyView(_ response: SessionDevicesResponse) -> some View {
        let options = response.sessionAutoLogoutOptions.filter { $0.seconds > 0 }
        return VStack(alignment: .leading, spacing: 10) {
            if !options.isEmpty {
                Menu {
                    ForEach(options) { option in
                        Button(optionMenuLabel(option, currentSeconds: response.sessionAutoLogoutSeconds)) {
                            Task { await updateSessionAutoLogout(seconds: option.seconds) }
                        }
                        .disabled(option.seconds == response.sessionAutoLogoutSeconds || isMutating)
                    }
                } label: {
                    HStack(spacing: 10) {
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Автовыход")
                                .font(.system(size: 14.5, weight: .medium))
                                .foregroundStyle(Color.smText)
                            Text("Срок для всех сохранённых сессий")
                                .font(.system(size: 12))
                                .foregroundStyle(Color.smMuted)
                        }
                        Spacer()
                        if isMutating {
                            ProgressView()
                                .tint(Color.smAccent)
                        } else {
                            Text(sessionAutoLogoutLabel(response))
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(Color.smAccent2)
                            Image(systemName: "chevron.up.chevron.down")
                                .font(.system(size: 10, weight: .semibold))
                                .foregroundStyle(Color.smFaint)
                        }
                    }
                }
                .buttonStyle(.plain)
                .disabled(isMutating)
            }

            Text(sessionPolicyText(response))
                .font(.system(size: 13))
                .foregroundStyle(Color.smMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
    }

    private func sectionHeader(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11.5, weight: .semibold))
            .foregroundStyle(Color.smFaint)
            .tracking(0.6)
            .padding(.horizontal, 4)
    }

    private func deviceRow(_ device: SessionDevice) -> some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.smAccent.opacity(0.10))
                    .frame(width: 36, height: 36)
                Image(systemName: deviceIcon(device))
                    .font(.system(size: 16))
                    .foregroundStyle(Color.smAccent2)
            }

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(deviceTitle(device))
                        .font(.system(size: 14.5, weight: .medium))
                        .foregroundStyle(Color.smText)
                        .lineLimit(1)
                    if device.isCurrent {
                        Text("Текущая")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(Color.smOnline)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.smOnline.opacity(0.12), in: Capsule())
                    }
                }
                Text(deviceSubtitle(device))
                    .font(.system(size: 12))
                    .foregroundStyle(Color.smMuted)
                    .lineLimit(2)
            }

            Spacer()

            if device.isCurrent || !device.familyId.isEmpty {
                Button(device.isCurrent ? "Выйти" : "Завершить") {
                    pendingRevokeDevice = device
                }
                .font(.system(size: 12.5, weight: .semibold))
                .foregroundStyle(Color.smDanger)
                .disabled(isMutating)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private func loadDevices() async {
        isLoading = devicesResponse == nil
        errorMessage = nil
        do {
            devicesResponse = try await session.api.getSessionDevices()
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            errorMessage = error.localizedDescription
        }
        isLoading = false
    }

    private func revoke(_ device: SessionDevice) async {
        isMutating = true
        pendingRevokeDevice = nil
        defer { isMutating = false }
        guard !device.familyId.isEmpty else {
            if device.isCurrent {
                await session.logout()
            }
            return
        }
        do {
            let result = try await session.api.revokeSessionDevice(familyId: device.familyId)
            if result.signedOutCurrent {
                await session.logout()
            } else {
                await loadDevices()
            }
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func revokeOthers() async {
        isMutating = true
        showRevokeOthersConfirm = false
        defer { isMutating = false }
        do {
            _ = try await session.api.revokeOtherSessionDevices()
            await loadDevices()
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func updateSessionAutoLogout(seconds: Int) async {
        guard seconds > 0, seconds != devicesResponse?.sessionAutoLogoutSeconds else { return }
        isMutating = true
        errorMessage = nil
        defer { isMutating = false }
        do {
            _ = try await session.api.updateSessionAutoLogoutSeconds(seconds)
            await loadDevices()
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func deviceTitle(_ device: SessionDevice) -> String {
        let raw = device.userAgent.lowercased()
        let base: String
        if raw.contains("iphone") { base = "iPhone" }
        else if raw.contains("ipad") { base = "iPad" }
        else if raw.contains("android") { base = "Android" }
        else if raw.contains("mac os") || raw.contains("macintosh") { base = "macOS" }
        else if raw.contains("windows") { base = "Windows" }
        else if raw.contains("linux") { base = "Linux" }
        else if raw.contains("safari") || raw.contains("chrome") || raw.contains("firefox") || raw.contains("edge") || raw.contains("edg/") {
            base = "Браузер"
        }
        else if device.isCurrent { base = UIDevice.current.name }
        else { base = device.persistent ? "Сохранённое устройство" : "Веб-сессия" }

        let browser = browserName(from: raw)
        return browser.isEmpty ? base : "\(base) · \(browser)"
    }

    private func deviceIcon(_ device: SessionDevice) -> String {
        let raw = device.userAgent.lowercased()
        if raw.contains("iphone") { return "iphone" }
        if raw.contains("ipad") { return "ipad" }
        if raw.contains("android") && raw.contains("mobile") { return "iphone" }
        if raw.contains("android") { return "ipad" }
        return "laptopcomputer"
    }

    private func deviceSubtitle(_ device: SessionDevice) -> String {
        var parts = ["Активность: \(formatTimestamp(device.lastUsedAt))"]
        if !device.ip.isEmpty { parts.append("IP \(device.ip)") }
        parts.append(device.persistent ? "истекает через \(formatRemaining(device.expiresAt))" : "сессия")
        return parts.joined(separator: " · ")
    }

    private func sessionPolicyText(_ response: SessionDevicesResponse) -> String {
        return "Неактивные устройства будут отключены через: \(sessionAutoLogoutLabel(response))."
    }

    private func sessionAutoLogoutLabel(_ response: SessionDevicesResponse) -> String {
        let label = response.sessionAutoLogoutOptions
            .first(where: { $0.seconds == response.sessionAutoLogoutSeconds })
            .map(optionLabel)
        return label ?? formatDuration(response.sessionAutoLogoutSeconds)
    }

    private func optionMenuLabel(_ option: SessionAutoLogoutOption, currentSeconds: Int) -> String {
        option.seconds == currentSeconds ? "\(optionLabel(option)) (текущий)" : optionLabel(option)
    }

    private func optionLabel(_ option: SessionAutoLogoutOption) -> String {
        if !option.labelRu.isEmpty { return option.labelRu }
        if !option.labelEn.isEmpty { return option.labelEn }
        return formatDuration(option.seconds)
    }

    private func browserName(from raw: String) -> String {
        if raw.contains("edg/") { return "Edge" }
        if raw.contains("opr/") { return "Opera" }
        if raw.contains("crios") { return "Chrome iOS" }
        if raw.contains("fxios") { return "Firefox iOS" }
        if raw.contains("chrome") { return "Chrome" }
        if raw.contains("firefox") { return "Firefox" }
        if raw.contains("safari") { return "Safari" }
        return ""
    }

    private func formatTimestamp(_ ts: Double) -> String {
        guard ts > 0 else { return "неизвестно" }
        return SunDateFormatters.ruFullDateTime(from: Date(timeIntervalSince1970: ts))
    }

    private func formatRemaining(_ ts: Double) -> String {
        let seconds = Int(ts - Date().timeIntervalSince1970)
        if seconds <= 0 { return "истекает" }
        return formatDuration(seconds)
    }

    private func formatDuration(_ seconds: Int) -> String {
        let days = max(1, Int(ceil(Double(seconds) / 86_400.0)))
        if days >= 2 { return "\(days) дн." }
        let hours = Int(ceil(Double(seconds) / 3_600.0))
        if hours >= 2 { return "\(hours) ч." }
        return "< 1 ч."
    }
}
