import SwiftUI
import Combine
import PhotosUI
import UniformTypeIdentifiers
import UserNotifications

// MARK: - Session store

enum AppRoute: Hashable { case loading, login, register, main }

// Call state models
struct IncomingCallData: Equatable, Sendable {
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
    private var presenceTask: Task<Void, Never>?

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
                senderUsername: payload["sender_username"] as? String,
                replyToId: payload["reply_to_id"] as? Int,
                replyMessage: payload["reply_message"] as? String,
                replySenderPub: payload["reply_sender_pub"] as? String,
                forwardFromName: payload["forward_from_name"] as? String,
                forwardFromUserId: payload["forward_from_user_id"] as? Int
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
            let incoming = IncomingCallData(
                callId: callId,
                chatId: chatId,
                callType: callType,
                callerName: initiator["display_name"] as? String ?? "Unknown",
                callerAvatarUrl: initiator["avatar_url"] as? String,
                callerUserId: initiator["user_id"] as? Int ?? 0
            )
            incomingCall = incoming
            NativeCallManager.shared.reportIncomingCall(incoming) { [weak self] fallback in
                self?.incomingCall = fallback
            }

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
                NativeCallManager.shared.endSystemCall(callId: callId, reason: .declinedElsewhere)
                if let call = activeCall {
                    addCallRecord(name: call.partnerName, callType: call.callType, isOutgoing: call.isOutgoing, missed: false, durationSec: nil, chatId: call.chatId)
                }
                teardownActiveCall()
            }
            incomingCall = nil

        case "call_cancelled":
            let cancelledCallId = payload["call_id"] as? String
            let systemIncoming = cancelledCallId.flatMap {
                NativeCallManager.shared.pendingIncomingCall(callId: $0)
            }
            if let callId = cancelledCallId {
                NativeCallManager.shared.endSystemCall(callId: callId, reason: .remoteEnded)
            }
            // The caller hung up before we answered → missed incoming call.
            if let inc = incomingCall ?? systemIncoming,
               let cancelledCallId,
               inc.callId == cancelledCallId {
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
            if let callId = payload["call_id"] as? String {
                NativeCallManager.shared.endSystemCall(callId: callId, reason: .remoteEnded)
            }
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

    func acceptCall(callId: String, incomingOverride: IncomingCallData? = nil) {
        connectSocket()
        let requestId = UUID().uuidString
        SocketClient.shared.emit("call_accept", [
            "call_id": callId,
            "request_id": requestId,
            "csrf_token": api.csrfToken,
        ])
        let incoming = incomingOverride?.callId == callId ? incomingOverride : incomingCall
        if let incoming, incoming.callId == callId {
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
            NativeCallManager.shared.markSystemCallConnected(callId: callId)
        }
        incomingCall = nil
    }

    func rejectCall(callId: String, incomingOverride: IncomingCallData? = nil) {
        connectSocket()
        SocketClient.shared.emit("call_reject", ["call_id": callId, "csrf_token": api.csrfToken])
        let incoming = incomingOverride?.callId == callId ? incomingOverride : incomingCall
        if let inc = incoming, inc.callId == callId {
            addCallRecord(name: inc.callerName, callType: inc.callType, isOutgoing: false, missed: false, durationSec: nil, chatId: inc.chatId)
        }
        NativeCallManager.shared.endSystemCall(callId: callId, reason: .declinedElsewhere)
        incomingCall = nil
    }

    func endCall() {
        guard let call = activeCall else { return }
        connectSocket()
        // Outgoing calls (we are the initiator) use call_cancel, which the
        // server honours for both ringing AND active states. Incoming/answered
        // calls must use call_end (only the non-initiator side). Sending the
        // wrong event leaves the call ringing forever on the server and blocks
        // the chat with `call_already_active`.
        let event = call.isOutgoing ? "call_cancel" : "call_end"
        SocketClient.shared.emit(event, ["call_id": call.callId, "csrf_token": api.csrfToken])
        NativeCallManager.shared.endSystemCall(callId: call.callId, reason: .remoteEnded)
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
            Task { await NativeCallManager.shared.registerCurrentVoipTokenIfPossible() }
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
        await NativeCallManager.shared.unregisterCurrentVoipToken()
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

    func handleScenePhase(_ phase: ScenePhase) async {
        switch phase {
        case .active:
            connectSocket()
            markActive()
            await refreshContacts()
            await recoverActiveChatSync()
        case .background:
            markInactive()
        case .inactive:
            break
        @unknown default:
            break
        }
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
            stopPresenceTask()
        case .connecting:
            break
        }
    }

    private func markActive() {
        guard route == .main, SocketClient.shared.state == .connected else { return }
        SocketClient.shared.emit("activity_update", ["active": true])
        startPresenceTask()
    }

    private func markInactive() {
        stopPresenceTask()
        guard SocketClient.shared.state == .connected else { return }
        SocketClient.shared.emit("activity_update", ["active": false])
    }

    private func startPresenceTask() {
        presenceTask?.cancel()
        presenceTask = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 45_000_000_000)
                guard !Task.isCancelled,
                      let self,
                      self.route == .main,
                      SocketClient.shared.state == .connected else { return }
                SocketClient.shared.emit("activity_update", ["active": true])
            }
        }
    }

    private func stopPresenceTask() {
        presenceTask?.cancel()
        presenceTask = nil
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
                    .font(.largeTitle.weight(.bold))
                    .foregroundStyle(Color.smText)

                Text("тихие сообщения, тёплый свет")
                    .font(.custom("Georgia", size: 16, relativeTo: .subheadline).italic())
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
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private static let stepInterval: TimeInterval = 0.18

    var body: some View {
        if reduceMotion {
            dots(dotPhase: nil)
        } else {
            TimelineView(.periodic(from: .now, by: Self.stepInterval)) { timeline in
                dots(dotPhase: timeline.date.timeIntervalSinceReferenceDate / Self.stepInterval * 0.20)
            }
        }
    }

    private func dots(dotPhase: Double?) -> some View {
        HStack(spacing: 8) {
            ForEach(0..<4, id: \.self) { i in
                let phase = dotPhase.map { (sin($0 + Double(i) * 0.7) + 1) / 2 } ?? 1
                Circle()
                    .fill(Color.smAccent)
                    .frame(width: 6, height: 6)
                    .opacity(dotPhase == nil ? 0.75 : 0.25 + phase * 0.75)
                    .scaleEffect(dotPhase == nil ? 1 : 0.85 + phase * 0.30)
            }
        }
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

            Group {
                // Incoming call overlay (top of stack)
                if let incoming = session.incomingCall {
                    IncomingCallView(call: incoming, session: session)
                        .transition(.opacity)
                        .zIndex(10)
                }
            }
            .animation(.easeInOut(duration: 0.25), value: session.incomingCall)

            Group {
                // Call error toast
                if let err = session.callError {
                    VStack {
                        Spacer()
                        HStack(spacing: 10) {
                            Image(systemName: "phone.slash.fill")
                                .font(.system(size: 14))
                                .foregroundStyle(Color.smDanger)
                            Text(err)
                                .font(.caption.weight(.medium))
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
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .zIndex(5)
                }
            }
            .animation(.spring(response: 0.35, dampingFraction: 0.86), value: session.callError)
        }
    }
}

// MARK: - Settings view (matches prototype "Настройки" home exactly)

extension View {
    func smSettingsScreenStyle(
        titleDisplayMode: NavigationBarItem.TitleDisplayMode = .inline
    ) -> some View {
        self
            .navigationBarTitleDisplayMode(titleDisplayMode)
            .scrollContentBackground(.hidden)
            .background(Color.smBg.ignoresSafeArea())
            .toolbarBackground(Color.smBg, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .tint(Color.smAccent2)
    }
}

private enum SettingsSheet: String, Identifiable {
    case profile
    case userQR

    var id: String { rawValue }
}

struct SettingsView: View {
    @EnvironmentObject var session: SessionStore
    @State private var isLoadingSettings = false
    @State private var settingsError: String?
    @State private var selectedLanguage = "ru"
    @State private var activeSheet: SettingsSheet?
    @State private var showLogoutConfirm = false

    private var user: BootstrapUser? { session.bootstrap?.user }

    var body: some View {
        Form {
            Section {
                Button {
                    activeSheet = .profile
                } label: {
                    HStack(spacing: 12) {
                        SmAvatarView(name: user?.displayName ?? "?", avatarUrl: user?.avatarUrl, size: 54)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(user?.displayName ?? "—")
                                .font(.headline)
                                .foregroundStyle(.primary)
                            Text("@\(user?.username ?? "—")")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Image(systemName: "chevron.right")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(.tertiary)
                    }
                    .padding(.vertical, 4)
                }
                .buttonStyle(.plain)

                Button {
                    activeSheet = .userQR
                } label: {
                    Label("Мой QR-код и публичный ключ", systemImage: "qrcode")
                }
            }

            Section {
                NavigationLink { NotificationSettingsView() } label: {
                    Label("Уведомления", systemImage: "bell")
                }
                NavigationLink { DataMemorySettingsView() } label: {
                    Label("Данные и память", systemImage: "externaldrive")
                }
                NavigationLink { PrivacySettingsView() } label: {
                    Label("Конфиденциальность", systemImage: "hand.raised")
                }
                NavigationLink { SecuritySettingsView() } label: {
                    Label("Безопасность", systemImage: "lock.shield")
                }
            } header: {
                Text("Основные")
            }

            Section {
                NavigationLink { AppearanceSettingsView() } label: {
                    Label("Внешний вид и темы", systemImage: "paintpalette")
                }
                NavigationLink { LanguageSettingsView(selectedLanguage: selectedLanguage) } label: {
                    Label {
                        HStack {
                            Text("Язык")
                            Spacer()
                            Text(languageLabel(selectedLanguage))
                                .foregroundStyle(.secondary)
                        }
                    } icon: {
                        Image(systemName: "globe")
                    }
                }
                NavigationLink { ChatBehaviorSettingsView() } label: {
                    Label("Настройки чата", systemImage: "message")
                }
                NavigationLink { CallSettingsView() } label: {
                    Label("Настройки звонков", systemImage: "phone")
                }
                NavigationLink { SidebarLabelSettingsView() } label: {
                    Label("Метка и погода в списке", systemImage: "cloud.sun")
                }
            } header: {
                Text("Интерфейс")
            }

            Section {
                NavigationLink { DevicesView() } label: {
                    Label("Устройства", systemImage: "iphone")
                }
                NavigationLink { SettingsTransferView() } label: {
                    Label("Экспорт и импорт настроек", systemImage: "square.and.arrow.up")
                }
                NavigationLink { IntegrationsSettingsView() } label: {
                    Label("Подключения", systemImage: "link")
                }
                NavigationLink { AccountSettingsView() } label: {
                    Label("Аккаунт", systemImage: "person.crop.circle")
                }
            } header: {
                Text("Аккаунт")
            }

            Section {
                NavigationLink { SupportSettingsView() } label: {
                    Label("Поддержка", systemImage: "questionmark.circle")
                }
                Button(role: .destructive) {
                    showLogoutConfirm = true
                } label: {
                    Label("Выйти из аккаунта", systemImage: "rectangle.portrait.and.arrow.right")
                }
            }

            if let settingsError {
                Section {
                    Text(settingsError)
                        .font(.footnote)
                        .foregroundStyle(Color.smDanger)
                }
            }
        }
        .navigationTitle("Настройки")
        .smSettingsScreenStyle(titleDisplayMode: .large)
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .profile:
                ProfileSettingsView()
                    .presentationBackground(Color.smBg)
            case .userQR:
                UserQRSheet()
            }
        }
        .confirmationDialog("Выйти из аккаунта?", isPresented: $showLogoutConfirm, titleVisibility: .visible) {
            Button("Выйти", role: .destructive) { Task { await session.logout() } }
            Button("Отмена", role: .cancel) { }
        } message: {
            Text("Сообщения останутся зашифрованными на устройстве, пока вы снова не войдёте.")
        }
        .task { await loadSettingsIfNeeded() }
    }

    private func languageLabel(_ language: String) -> String {
        language == "en" ? "English" : "Русский"
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
            selectedLanguage = current.language
        } catch {
            settingsError = error.localizedDescription
        }
        isLoadingSettings = false
    }

}

// MARK: - Profile Settings View

private struct AvatarEditorDraft: Identifiable {
    let id = UUID()
    let image: UIImage
}

private enum ProfileSettingsSheet: Identifiable {
    case userQR
    case avatarEditor(AvatarEditorDraft)

    var id: String {
        switch self {
        case .userQR:
            return "userQR"
        case .avatarEditor(let draft):
            return "avatarEditor-\(draft.id.uuidString)"
        }
    }
}

struct ProfileSettingsView: View {
    @EnvironmentObject var session: SessionStore
    @Environment(\.dismiss) private var dismiss
    @State private var displayName = ""
    @State private var username = ""
    @State private var statusText = ""
    @State private var bio = ""
    @State private var currentSettings: AppSettings?
    @State private var selectedAvatarItem: PhotosPickerItem?
    @State private var isUploadingAvatar = false
    @State private var isSaving = false
    @State private var saveError: String?
    @State private var activeSheet: ProfileSettingsSheet?

    private var user: BootstrapUser? { session.bootstrap?.user }
    private var trimmedDisplayName: String { displayName.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedStatusText: String { statusText.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedBio: String { bio.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var normalizedUsername: String {
        var value = username.trimmingCharacters(in: .whitespacesAndNewlines)
        while value.hasPrefix("@") { value.removeFirst() }
        return value.lowercased()
    }
    private var canSaveProfile: Bool {
        let baselineName = currentSettings?.displayName ?? user?.displayName ?? ""
        let baselineUsername = currentSettings?.username ?? user?.username ?? ""
        let baselineStatus = currentSettings?.statusText ?? ""
        let baselineBio = currentSettings?.bio ?? ""
        return !isSaving
            && !trimmedDisplayName.isEmpty
            && !normalizedUsername.isEmpty
            && (
                trimmedDisplayName != baselineName ||
                normalizedUsername != baselineUsername ||
                trimmedStatusText != baselineStatus ||
                trimmedBio != baselineBio
            )
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: 16) {
                        SmAvatarView(name: user?.displayName ?? "?", avatarUrl: user?.avatarUrl, size: 76)
                        VStack(alignment: .leading, spacing: 4) {
                            Text(user?.displayName ?? "—")
                                .font(.headline)
                            Text("@\(user?.username ?? "—")")
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                            if isUploadingAvatar {
                                ProgressView()
                                    .controlSize(.small)
                            }
                        }
                    }

                    PhotosPicker(selection: $selectedAvatarItem, matching: .images) {
                        Label("Изменить фото профиля", systemImage: "camera")
                    }
                    .disabled(isUploadingAvatar)
                }

                Section {
                    LabeledContent {
                        TextField("Имя", text: $displayName)
                            .multilineTextAlignment(.trailing)
                            .textInputAutocapitalization(.words)
                            .textContentType(.name)
                            .onChange(of: displayName) { _, value in
                                if value.count > 50 { displayName = String(value.prefix(50)) }
                            }
                    } label: {
                        Text("Имя")
                    }

                    LabeledContent {
                        TextField("username", text: $username)
                            .multilineTextAlignment(.trailing)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled(true)
                            .textContentType(.username)
                            .onChange(of: username) { _, value in
                                username = normalizeHandleInput(value)
                            }
                    } label: {
                        Text("Username")
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Статус")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        TextField("Короткий статус", text: $statusText, axis: .vertical)
                            .lineLimit(1...3)
                            .onChange(of: statusText) { _, value in
                                if value.count > 100 { statusText = String(value.prefix(100)) }
                            }
                        Text("\(statusText.count)/100")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("О себе")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        TextEditor(text: $bio)
                            .frame(minHeight: 96)
                            .scrollContentBackground(.hidden)
                            .onChange(of: bio) { _, value in
                                if value.count > 280 { bio = String(value.prefix(280)) }
                            }
                        Text("\(bio.count)/280")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Профиль")
                }

                Section {
                    Button { activeSheet = .userQR } label: {
                        Label("Мой QR-код", systemImage: "qrcode")
                    }
                }

                if let err = saveError {
                    Section {
                        Text(err)
                            .font(.footnote)
                            .foregroundStyle(Color.smDanger)
                    }
                }
            }
            .navigationTitle("Профиль")
            .smSettingsScreenStyle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Сохранение…" : "Сохранить") {
                        Task { await saveProfile() }
                    }
                    .disabled(!canSaveProfile)
                }
            }
            .sheet(item: $activeSheet) { sheet in
                switch sheet {
                case .userQR:
                    UserQRSheet()
                case .avatarEditor(let draft):
                    AvatarEditorView(image: draft.image) { jpegData in
                        await uploadAvatar(jpegData)
                    }
                    .presentationBackground(Color.smBg)
                }
            }
            .task { await loadProfileSettings() }
            .onChange(of: selectedAvatarItem) { _, item in
                Task { await prepareAvatarEditor(from: item) }
            }
        }
    }

    private func hydrateFieldsFromUser() {
        displayName = user?.displayName ?? ""
        username = user?.username ?? ""
    }

    private func loadProfileSettings() async {
        do {
            let settings = try await session.api.getSettings()
            currentSettings = settings
            displayName = settings.displayName
            username = settings.username
            statusText = settings.statusText
            bio = settings.bio
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            hydrateFieldsFromUser()
            saveError = error.localizedDescription
        }
    }

    private func normalizeHandleInput(_ value: String) -> String {
        let withoutAt = value.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "@", with: "")
        let allowedCharacters = Set("abcdefghijklmnopqrstuvwxyz0123456789_")
        let allowed = withoutAt.lowercased().filter { allowedCharacters.contains($0) }
        return String(allowed.prefix(50))
    }

    private func saveProfile() async {
        let name = trimmedDisplayName
        let handle = normalizedUsername
        let status = trimmedStatusText
        let about = trimmedBio
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
        guard status.count <= 100 else {
            saveError = "Статус не должен превышать 100 символов."
            return
        }
        guard about.count <= 280 else {
            saveError = "Bio не должно превышать 280 символов."
            return
        }

        isSaving = true
        saveError = nil
        do {
            try await session.api.saveSettings([
                "display_name": name,
                "username": handle,
                "status_text": status,
                "bio": about,
            ])
            await session.loadBootstrap()
            await loadProfileSettings()
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            saveError = error.localizedDescription
        }
        isSaving = false
    }

    private func prepareAvatarEditor(from item: PhotosPickerItem?) async {
        guard let item else { return }
        do {
            if let data = try await item.loadTransferable(type: Data.self),
               let image = await Self.makeAvatarEditorImage(from: data) {
                activeSheet = .avatarEditor(AvatarEditorDraft(image: image))
            }
        } catch {
            saveError = error.localizedDescription
        }
        selectedAvatarItem = nil
    }

    private static func makeAvatarEditorImage(from data: Data) async -> UIImage? {
        await Task.detached(priority: .userInitiated) {
            UIImage(data: data)
        }.value
    }

    private func uploadAvatar(_ data: Data) async {
        isUploadingAvatar = true
        saveError = nil
        do {
            _ = try await session.api.uploadAvatar(data: data, mimeType: "image/jpeg")
            await session.loadBootstrap()
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            saveError = error.localizedDescription
        }
        isUploadingAvatar = false
    }
}

private struct AvatarEditorView: View {
    @Environment(\.dismiss) private var dismiss
    let image: UIImage
    let onSave: (Data) async -> Void

    @State private var zoom = 1.0
    @State private var rotation = 0.0
    @State private var isSaving = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    ZStack {
                        Color.black.opacity(0.92)
                        Image(uiImage: image)
                            .resizable()
                            .scaledToFill()
                            .scaleEffect(CGFloat(zoom))
                            .rotationEffect(.degrees(rotation))
                            .frame(width: 260, height: 260)
                            .clipShape(Rectangle())
                            .overlay(Rectangle().stroke(.white.opacity(0.85), lineWidth: 1))
                    }
                    .frame(maxWidth: .infinity, minHeight: 300)
                }

                Section {
                    HStack {
                        Button { rotation -= 90 } label: {
                            Label("Влево", systemImage: "rotate.left")
                        }
                        Spacer()
                        Button { rotation += 90 } label: {
                            Label("Вправо", systemImage: "rotate.right")
                        }
                    }
                    Slider(value: $zoom, in: 1.0...3.0, step: 0.05) {
                        Text("Масштаб")
                    }
                    Button("Сбросить") {
                        zoom = 1
                        rotation = 0
                    }
                } header: {
                    Text("Кадр")
                }
            }
            .navigationTitle("Фото профиля")
            .smSettingsScreenStyle()
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Загрузка…" : "Готово") {
                        save()
                    }
                    .disabled(isSaving)
                }
            }
        }
    }

    private func save() {
        guard let data = renderCroppedJPEG() else { return }
        isSaving = true
        Task {
            await onSave(data)
            isSaving = false
            dismiss()
        }
    }

    private func renderCroppedJPEG() -> Data? {
        let outputSize = CGSize(width: 768, height: 768)
        let renderer = UIGraphicsImageRenderer(size: outputSize)
        let rendered = renderer.image { context in
            UIColor.clear.setFill()
            context.fill(CGRect(origin: .zero, size: outputSize))
            context.cgContext.translateBy(x: outputSize.width / 2, y: outputSize.height / 2)
            context.cgContext.rotate(by: rotation * .pi / 180)
            let base = max(outputSize.width / image.size.width, outputSize.height / image.size.height)
            let fitted = CGSize(width: image.size.width * base * zoom, height: image.size.height * base * zoom)
            image.draw(in: CGRect(x: -fitted.width / 2, y: -fitted.height / 2, width: fitted.width, height: fitted.height))
        }
        return rendered.jpegData(compressionQuality: 0.88)
    }
}

enum SettingsClientPreferences {
    static let messageScaleKey = "sun_chat_message_scale_v1"
    static let sendShortcutKey = "sun_send_shortcut_mode_v1"
    static let timeFormatKey = "sun_time_format_v1"
    static let performanceModeKey = "sun_performance_mode"
    static let motionLevelKey = "sun_motion_level"
    static let interfaceSurfaceModeKey = "sun_interface_surface_mode"
    static let themePresetKey = "sun_theme_preset_v1"
    static let accentColorKey = "sun_accent_color_v1"
    static let chatAppearanceModeKey = "sun_chat_appearance_mode_v1"
    static let chatBackgroundColorKey = "sun_chat_background_color_v1"
    static let chatGradientAKey = "sun_chat_gradient_a_v1"
    static let chatGradientBKey = "sun_chat_gradient_b_v1"
    static let chatBackgroundImageKey = "sun_chat_background_image_data_url_v1"
    static let chatBackgroundDarkenKey = "sun_chat_background_darken_v1"
    static let chatBackgroundBlurKey = "sun_chat_background_blur_v1"
    static let chatBackgroundImageOpacityKey = "sun_chat_background_image_opacity_v1"
    static let chatBackgroundScaleKey = "sun_chat_background_scale_v1"
    static let chatBackgroundPositionXKey = "sun_chat_background_position_x_v1"
    static let chatBackgroundPositionYKey = "sun_chat_background_position_y_v1"
    static let chatBackgroundRepeatKey = "sun_chat_background_repeat_v1"
    static let bubbleOutKey = "sun_bubble_out_color_v1"
    static let bubbleInKey = "sun_bubble_in_color_v1"
    static let bubbleOutTextKey = "sun_bubble_out_text_color_v1"
    static let bubbleInTextKey = "sun_bubble_in_text_color_v1"
    static let bubbleOpacityKey = "sun_bubble_opacity_v1"
    static let animationsEnabledKey = "sun_animations_enabled_v1"
    static let sidebarWeatherEnabledKey = "sun_sidebar_weather_enabled_v1"
    static let sidebarWeatherSourceKey = "sun_sidebar_weather_source_v1"
    static let sidebarWeatherCityKey = "sun_sidebar_weather_city_v1"
    static let sidebarWeatherRotateKey = "sun_sidebar_weather_rotate_v1"
    static let sidebarWeatherMetricsKey = "sun_sidebar_weather_metrics_v1"
    static let dataAutoDownloadMediaKey = "sun_data_auto_media_v1"
    static let dataAutoDownloadPhotosKey = "sun_data_auto_photos_v1"
    static let dataAutoDownloadVideosKey = "sun_data_auto_videos_v1"
    static let dataFilesLimitMbKey = "sun_data_files_limit_mb_v1"
    static let dataRetentionDaysKey = "sun_data_retention_days_v1"
    static let dataMaxCacheMbKey = "sun_data_max_cache_mb_v1"

    static let weatherMetricKeys = [
        "temperature", "feels_like", "humidity", "wind", "precip", "uv", "aqi", "pressure", "sun_cycle",
    ]

    static func localClientPreferences() -> [String: Any] {
        let defaults = UserDefaults.standard
        let language = defaults.string(forKey: "sun_ui_language") ?? "ru"
        return [
            "darkMode": defaults.string(forKey: "appColorScheme") == AppColorScheme.dark.rawValue,
            "language": language == "en" ? "en" : "ru",
            "messageScale": normalizedDouble(defaults.object(forKey: messageScaleKey) as? Double, min: 0.9, max: 1.3, fallback: 1.0),
            "performanceMode": normalized(defaults.string(forKey: performanceModeKey), allowed: ["auto", "full", "lite"], fallback: "auto"),
            "motionLevel": normalized(defaults.string(forKey: motionLevelKey), allowed: ["auto", "full", "balanced", "lite"], fallback: "auto"),
            "sendShortcut": normalized(defaults.string(forKey: sendShortcutKey), allowed: ["enter", "ctrl_enter"], fallback: "enter"),
            "timeFormat": normalized(defaults.string(forKey: timeFormatKey), allowed: ["24h", "12h"], fallback: "24h"),
            "interfaceSurfaceMode": normalized(defaults.string(forKey: interfaceSurfaceModeKey), allowed: ["glass", "solid"], fallback: "glass"),
            "sidebarWeatherEnabled": defaults.bool(forKey: sidebarWeatherEnabledKey),
            "sidebarWeatherSource": normalized(defaults.string(forKey: sidebarWeatherSourceKey), allowed: ["auto", "city"], fallback: "auto"),
            "sidebarWeatherCity": String((defaults.string(forKey: sidebarWeatherCityKey) ?? "").prefix(80)),
            "sidebarWeatherRotateSeconds": defaults.integer(forKey: sidebarWeatherRotateKey) == 30 ? 30 : 60,
            "sidebarWeatherMetrics": localWeatherMetrics(),
            "interfaceThemeStore": [
                "activePreset": defaults.string(forKey: themePresetKey) ?? "light-classic",
                "accentColor": defaults.string(forKey: accentColorKey) ?? "#c4943c",
            ],
            "chatAppearanceStore": [
                "mode": defaults.string(forKey: chatAppearanceModeKey) ?? "default",
                "backgroundColor": defaults.string(forKey: chatBackgroundColorKey) ?? "#f2ede2",
                "gradientA": defaults.string(forKey: chatGradientAKey) ?? "#f2ede2",
                "gradientB": defaults.string(forKey: chatGradientBKey) ?? "#d8ecff",
                "customImageDataUrl": defaults.string(forKey: chatBackgroundImageKey) ?? "",
                "customImageDarken": normalizedDouble(defaults.object(forKey: chatBackgroundDarkenKey) as? Double, min: 0, max: 0.85, fallback: 0),
                "customImageBlur": normalizedDouble(defaults.object(forKey: chatBackgroundBlurKey) as? Double, min: 0, max: 24, fallback: 0),
                "customImageOpacity": normalizedDouble(defaults.object(forKey: chatBackgroundImageOpacityKey) as? Double, min: 0.2, max: 1.0, fallback: 1.0),
                "customImageScale": normalizedDouble(defaults.object(forKey: chatBackgroundScaleKey) as? Double, min: 0.5, max: 3.0, fallback: 1.0),
                "customImagePositionX": normalizedDouble(defaults.object(forKey: chatBackgroundPositionXKey) as? Double, min: 0, max: 100, fallback: 50),
                "customImagePositionY": normalizedDouble(defaults.object(forKey: chatBackgroundPositionYKey) as? Double, min: 0, max: 100, fallback: 50),
                "customImageRepeat": defaults.bool(forKey: chatBackgroundRepeatKey),
                "bubbleOut": defaults.string(forKey: bubbleOutKey) ?? "#c4943c",
                "bubbleIn": defaults.string(forKey: bubbleInKey) ?? "#ffffff",
                "bubbleOutText": defaults.string(forKey: bubbleOutTextKey) ?? "#15140e",
                "bubbleInText": defaults.string(forKey: bubbleInTextKey) ?? "#1f1b14",
                "bubbleOpacity": normalizedDouble(defaults.object(forKey: bubbleOpacityKey) as? Double, min: 0.45, max: 1.0, fallback: 1.0),
            ],
            "dataMemoryStore": [
                "autoDownloadMedia": defaults.object(forKey: dataAutoDownloadMediaKey) as? Bool ?? true,
                "autoDownloadPhotos": defaults.object(forKey: dataAutoDownloadPhotosKey) as? Bool ?? true,
                "autoDownloadVideos": defaults.object(forKey: dataAutoDownloadVideosKey) as? Bool ?? true,
                "autoDownloadFilesMaxMb": normalizedDouble(defaults.object(forKey: dataFilesLimitMbKey) as? Double, min: 0.1, max: 50, fallback: 3),
                "cacheRetentionDays": defaults.object(forKey: dataRetentionDaysKey) as? Int ?? 7,
                "maxCacheMb": defaults.object(forKey: dataMaxCacheMbKey) as? Int ?? 0,
            ],
            "updatedAt": SunDateFormatters.isoInternetDateTime(from: Date()),
        ]
    }

    static func apply(_ preferences: [String: Any]) {
        let defaults = UserDefaults.standard
        if let darkMode = preferences["darkMode"] as? Bool {
            defaults.set(darkMode ? AppColorScheme.dark.rawValue : AppColorScheme.light.rawValue, forKey: "appColorScheme")
        }
        if let language = preferences["language"] as? String {
            defaults.set(language == "en" ? "en" : "ru", forKey: "sun_ui_language")
        }
        if let value = preferences["messageScale"] as? Double {
            defaults.set(normalizedDouble(value, min: 0.9, max: 1.3, fallback: 1.0), forKey: messageScaleKey)
        } else if let value = preferences["messageScale"] as? Int {
            defaults.set(normalizedDouble(Double(value), min: 0.9, max: 1.3, fallback: 1.0), forKey: messageScaleKey)
        }
        if let value = preferences["performanceMode"] as? String { defaults.set(normalized(value, allowed: ["auto", "full", "lite"], fallback: "auto"), forKey: performanceModeKey) }
        if let value = preferences["motionLevel"] as? String { defaults.set(normalized(value, allowed: ["auto", "full", "balanced", "lite"], fallback: "auto"), forKey: motionLevelKey) }
        if let value = preferences["sendShortcut"] as? String { defaults.set(normalized(value, allowed: ["enter", "ctrl_enter"], fallback: "enter"), forKey: sendShortcutKey) }
        if let value = preferences["timeFormat"] as? String { defaults.set(normalized(value, allowed: ["24h", "12h"], fallback: "24h"), forKey: timeFormatKey) }
        if let value = preferences["interfaceSurfaceMode"] as? String { defaults.set(normalized(value, allowed: ["glass", "solid"], fallback: "glass"), forKey: interfaceSurfaceModeKey) }
        if let enabled = preferences["sidebarWeatherEnabled"] as? Bool { defaults.set(enabled, forKey: sidebarWeatherEnabledKey) }
        if let value = preferences["sidebarWeatherSource"] as? String { defaults.set(normalized(value, allowed: ["auto", "city"], fallback: "auto"), forKey: sidebarWeatherSourceKey) }
        if let value = preferences["sidebarWeatherCity"] as? String { defaults.set(String(value.prefix(80)), forKey: sidebarWeatherCityKey) }
        if let value = preferences["sidebarWeatherRotateSeconds"] as? Int { defaults.set(value == 30 ? 30 : 60, forKey: sidebarWeatherRotateKey) }
        if let metrics = preferences["sidebarWeatherMetrics"] as? [String] { defaults.set(metrics.filter { weatherMetricKeys.contains($0) }, forKey: sidebarWeatherMetricsKey) }
        if let theme = preferences["interfaceThemeStore"] as? [String: Any] {
            if let preset = theme["activePreset"] as? String { defaults.set(preset, forKey: themePresetKey) }
            if let accent = theme["accentColor"] as? String { defaults.set(accent, forKey: accentColorKey) }
        }
        if let chat = preferences["chatAppearanceStore"] as? [String: Any] {
            if let value = chat["mode"] as? String { defaults.set(value, forKey: chatAppearanceModeKey) }
            if let value = chat["backgroundColor"] as? String { defaults.set(value, forKey: chatBackgroundColorKey) }
            if let value = chat["gradientA"] as? String { defaults.set(value, forKey: chatGradientAKey) }
            if let value = chat["gradientB"] as? String { defaults.set(value, forKey: chatGradientBKey) }
            if let value = chat["customImageDataUrl"] as? String { defaults.set(value, forKey: chatBackgroundImageKey) }
            if let value = chat["customImageDarken"] as? Double { defaults.set(normalizedDouble(value, min: 0, max: 0.85, fallback: 0), forKey: chatBackgroundDarkenKey) }
            if let value = chat["customImageBlur"] as? Double { defaults.set(normalizedDouble(value, min: 0, max: 24, fallback: 0), forKey: chatBackgroundBlurKey) }
            if let value = chat["customImageOpacity"] as? Double { defaults.set(normalizedDouble(value, min: 0.2, max: 1.0, fallback: 1.0), forKey: chatBackgroundImageOpacityKey) }
            if let value = chat["customImageScale"] as? Double { defaults.set(normalizedDouble(value, min: 0.5, max: 3.0, fallback: 1.0), forKey: chatBackgroundScaleKey) }
            if let value = chat["customImagePositionX"] as? Double { defaults.set(normalizedDouble(value, min: 0, max: 100, fallback: 50), forKey: chatBackgroundPositionXKey) }
            if let value = chat["customImagePositionY"] as? Double { defaults.set(normalizedDouble(value, min: 0, max: 100, fallback: 50), forKey: chatBackgroundPositionYKey) }
            if let value = chat["customImageRepeat"] as? Bool { defaults.set(value, forKey: chatBackgroundRepeatKey) }
            if let value = chat["bubbleOut"] as? String { defaults.set(value, forKey: bubbleOutKey) }
            if let value = chat["bubbleIn"] as? String { defaults.set(value, forKey: bubbleInKey) }
            if let value = chat["bubbleOutText"] as? String { defaults.set(value, forKey: bubbleOutTextKey) }
            if let value = chat["bubbleInText"] as? String { defaults.set(value, forKey: bubbleInTextKey) }
            if let value = chat["bubbleOpacity"] as? Double { defaults.set(normalizedDouble(value, min: 0.45, max: 1.0, fallback: 1.0), forKey: bubbleOpacityKey) }
        }
        if let dataMemory = preferences["dataMemoryStore"] as? [String: Any] {
            if let value = dataMemory["autoDownloadMedia"] as? Bool { defaults.set(value, forKey: dataAutoDownloadMediaKey) }
            if let value = dataMemory["autoDownloadPhotos"] as? Bool { defaults.set(value, forKey: dataAutoDownloadPhotosKey) }
            if let value = dataMemory["autoDownloadVideos"] as? Bool { defaults.set(value, forKey: dataAutoDownloadVideosKey) }
            if let value = dataMemory["autoDownloadFilesMaxMb"] as? Double { defaults.set(normalizedDouble(value, min: 0.1, max: 50, fallback: 3), forKey: dataFilesLimitMbKey) }
            if let value = dataMemory["cacheRetentionDays"] as? Int { defaults.set([0, 1, 3, 7, 30, 90].contains(value) ? value : 7, forKey: dataRetentionDaysKey) }
            if let value = dataMemory["maxCacheMb"] as? Int { defaults.set(Swift.min(1024, Swift.max(0, value)), forKey: dataMaxCacheMbKey) }
        }
    }

    static func mergedClientPreferences(base: [String: Any], updates: [String: Any]) -> [String: Any] {
        var merged = base
        for (key, value) in localClientPreferences() {
            merged[key] = value
        }
        for (key, value) in updates {
            merged[key] = value
        }
        merged["updatedAt"] = SunDateFormatters.isoInternetDateTime(from: Date())
        return merged
    }

    static func normalized(_ value: String?, allowed: Set<String>, fallback: String) -> String {
        let normalized = (value ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return allowed.contains(normalized) ? normalized : fallback
    }

    static func normalizedDouble(_ value: Double?, min: Double, max: Double, fallback: Double) -> Double {
        guard let value, value.isFinite else { return fallback }
        return Swift.min(max, Swift.max(min, value))
    }

    static func localWeatherMetrics() -> [String] {
        let stored = UserDefaults.standard.stringArray(forKey: sidebarWeatherMetricsKey) ?? ["temperature"]
        let filtered = stored.filter { weatherMetricKeys.contains($0) }
        return filtered.isEmpty ? ["temperature"] : filtered
    }
}

private enum SettingsScreenError: LocalizedError, Sendable {
    case notificationDenied
    case notificationTokenTimeout
    case notificationRegistrationFailed(String)

    var errorDescription: String? {
        switch self {
        case .notificationDenied:
            return "Разрешение на уведомления не выдано в системных настройках iOS."
        case .notificationTokenTimeout:
            return "iOS не вернула APNs-токен за отведённое время."
        case .notificationRegistrationFailed(let message):
            return message
        }
    }
}

struct NotificationSettingsView: View {
    @EnvironmentObject var session: SessionStore
    @State private var authorizationStatus = UNAuthorizationStatus.notDetermined
    @State private var alertToken = UserDefaults.standard.string(forKey: "sun_alert_apns_token_v1") ?? ""
    @State private var isSaving = false
    @State private var error: String?

    private var permissionText: String {
        switch authorizationStatus {
        case .authorized, .ephemeral, .provisional: return "Разрешены"
        case .denied: return "Запрещены"
        case .notDetermined: return "Не запрошены"
        @unknown default: return "Неизвестно"
        }
    }

    var body: some View {
        Form {
            Section {
                LabeledContent {
                    Text(permissionText)
                } label: {
                    Text("Разрешение iOS")
                }
                LabeledContent {
                    Text(alertToken.isEmpty ? "Не активна" : "Активна")
                } label: {
                    Text("Подписка")
                }
                Button {
                    Task { await enableNotifications() }
                } label: {
                    Label("Включить push-уведомления", systemImage: "bell.badge")
                }
                .disabled(isSaving)
                Button(role: .destructive) {
                    Task { await disableNotifications() }
                } label: {
                    Label("Отключить push-уведомления", systemImage: "bell.slash")
                }
                .disabled(isSaving || alertToken.isEmpty)
            } header: {
                Text("Системные уведомления")
            } footer: {
                Text("Токен регистрируется через APNs и сохраняется на сервере как alert push для этого устройства.")
            }

            if isSaving {
                Section { ProgressView("Синхронизация…") }
            }
            if let error {
                Section { Text(error).font(.footnote).foregroundStyle(Color.smDanger) }
            }
        }
        .navigationTitle("Уведомления")
        .smSettingsScreenStyle()
        .task { await refreshPermission() }
    }

    private func refreshPermission() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        authorizationStatus = settings.authorizationStatus
        alertToken = UserDefaults.standard.string(forKey: "sun_alert_apns_token_v1") ?? ""
    }

    private func enableNotifications() async {
        isSaving = true
        error = nil
        do {
            let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            guard granted else { throw SettingsScreenError.notificationDenied }
            let token = try await waitForAPNSToken()
            let deviceId = UIDevice.current.identifierForVendor?.uuidString ?? "ios-\(UUID().uuidString)"
            try await session.api.registerAPNsToken(
                token: token,
                pushType: "alert",
                environment: apnsEnvironment,
                deviceId: deviceId
            )
            alertToken = token
            await refreshPermission()
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            self.error = error.localizedDescription
        }
        isSaving = false
    }

    private func disableNotifications() async {
        guard !alertToken.isEmpty else { return }
        isSaving = true
        error = nil
        do {
            try await session.api.unregisterAPNsToken(token: alertToken, pushType: "alert")
            UserDefaults.standard.removeObject(forKey: "sun_alert_apns_token_v1")
            alertToken = ""
            await refreshPermission()
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            self.error = error.localizedDescription
        }
        isSaving = false
    }

    private var apnsEnvironment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    private func waitForAPNSToken() async throws -> String {
        if let token = UserDefaults.standard.string(forKey: "sun_alert_apns_token_v1"), !token.isEmpty {
            return token
        }
        return try await withThrowingTaskGroup(of: String.self) { group in
            group.addTask {
                for await note in NotificationCenter.default.notifications(named: .smDidRegisterAPNsAlertToken) {
                    let token = (note.userInfo?["token"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !token.isEmpty else { throw SettingsScreenError.notificationTokenTimeout }
                    return token
                }
                throw SettingsScreenError.notificationTokenTimeout
            }
            group.addTask {
                for await note in NotificationCenter.default.notifications(named: .smDidFailToRegisterAPNsAlertToken) {
                    let message = note.userInfo?["error"] as? String ?? "Не удалось зарегистрировать APNs-токен."
                    throw SettingsScreenError.notificationRegistrationFailed(message)
                }
                throw SettingsScreenError.notificationTokenTimeout
            }
            group.addTask {
                try await Task.sleep(nanoseconds: 15_000_000_000)
                throw SettingsScreenError.notificationTokenTimeout
            }
            defer { group.cancelAll() }

            await MainActor.run {
                UIApplication.shared.registerForRemoteNotifications()
            }

            guard let token = try await group.next() else {
                throw SettingsScreenError.notificationTokenTimeout
            }
            return token
        }
    }
}

struct DataMemorySettingsView: View {
    @EnvironmentObject var session: SessionStore
    @AppStorage(SettingsClientPreferences.dataAutoDownloadMediaKey) private var autoDownloadMedia = true
    @AppStorage(SettingsClientPreferences.dataAutoDownloadPhotosKey) private var autoDownloadPhotos = true
    @AppStorage(SettingsClientPreferences.dataAutoDownloadVideosKey) private var autoDownloadVideos = true
    @AppStorage(SettingsClientPreferences.dataFilesLimitMbKey) private var filesLimitMb = 3.0
    @AppStorage(SettingsClientPreferences.dataRetentionDaysKey) private var retentionDays = 7
    @AppStorage(SettingsClientPreferences.dataMaxCacheMbKey) private var maxCacheMb = 0
    @State private var clientPreferences: [String: Any] = [:]
    @State private var storageBytes = 0
    @State private var isWorking = false
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                Toggle("Медиа", isOn: Binding(get: { autoDownloadMedia }, set: { autoDownloadMedia = $0; savePolicy() }))
                Toggle("Фото", isOn: Binding(get: { autoDownloadPhotos }, set: { autoDownloadPhotos = $0; savePolicy() }))
                Toggle("Видео", isOn: Binding(get: { autoDownloadVideos }, set: { autoDownloadVideos = $0; savePolicy() }))
                VStack(alignment: .leading) {
                    LabeledContent {
                        Text("\(String(format: "%.1f", filesLimitMb)) MB")
                    } label: {
                        Text("Лимит файла")
                    }
                    Slider(value: Binding(get: { filesLimitMb }, set: { filesLimitMb = $0; savePolicy() }), in: 0.1...50, step: 0.1)
                }
            } header: {
                Text("Автозагрузка")
            }

            Section {
                LabeledContent {
                    Text(ByteCountFormatter.string(fromByteCount: Int64(storageBytes), countStyle: .file))
                } label: {
                    Text("Локальный кэш")
                }
                Button("Обновить размер") { Task { await refreshStorageUsage() } }
                Button("Очистить кэш сообщений") { Task { await clearChatCache() } }
                Button("Очистить файловый кэш") { Task { await clearURLCache() } }
                Button(role: .destructive) { Task { await clearAllCaches() } } label: {
                    Text("Очистить всё")
                }
            } header: {
                Text("Хранилище")
            }

            Section {
                Picker("Хранить файлы", selection: Binding(get: { retentionDays }, set: { retentionDays = $0; savePolicy() })) {
                    Text("Не хранить").tag(0)
                    Text("1 день").tag(1)
                    Text("3 дня").tag(3)
                    Text("7 дней").tag(7)
                    Text("30 дней").tag(30)
                    Text("90 дней").tag(90)
                }
                Stepper("Максимум: \(cacheLimitLabel)", value: Binding(get: { maxCacheMb }, set: { maxCacheMb = $0; savePolicy() }), in: 0...1024, step: 32)
            } header: {
                Text("Автоочистка")
            }

            if isWorking {
                Section { ProgressView("Обработка…") }
            }
            if let error {
                Section { Text(error).font(.footnote).foregroundStyle(Color.smDanger) }
            }
        }
        .navigationTitle("Данные и память")
        .smSettingsScreenStyle()
        .task {
            await loadPreferences()
            await refreshStorageUsage()
        }
    }

    private var cacheLimitLabel: String {
        maxCacheMb == 0 ? "без лимита" : "\(maxCacheMb) MB"
    }

    private func loadPreferences() async {
        do {
            let settings = try await session.api.getSettings()
            clientPreferences = settings.clientPreferencesObject
            SettingsClientPreferences.apply(clientPreferences)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func savePolicy() {
        let updates: [String: Any] = [
            "dataMemoryStore": [
                "autoDownloadMedia": autoDownloadMedia,
                "autoDownloadPhotos": autoDownloadPhotos,
                "autoDownloadVideos": autoDownloadVideos,
                "autoDownloadFilesMaxMb": filesLimitMb,
                "cacheRetentionDays": retentionDays,
                "maxCacheMb": maxCacheMb,
            ],
        ]
        saveClientPreferences(updates)
    }

    private func saveClientPreferences(_ updates: [String: Any]) {
        let payload = SettingsClientPreferences.mergedClientPreferences(base: clientPreferences, updates: updates)
        clientPreferences = payload
        Task {
            do { try await session.api.saveSettings(["client_preferences": payload]) }
            catch APIError.unauthorized { session.route = .login }
            catch { self.error = error.localizedDescription }
        }
    }

    private func refreshStorageUsage() async {
        storageBytes = await Task.detached(priority: .utility) {
            let fm = FileManager.default
            let roots = [
                fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first?.appendingPathComponent("Sunmsg", isDirectory: true),
                fm.urls(for: .cachesDirectory, in: .userDomainMask).first,
                fm.temporaryDirectory,
            ].compactMap { $0 }
            return roots.reduce(0) { $0 + settingsDirectorySize(url: $1) }
        }.value
    }

    private func clearChatCache() async {
        isWorking = true
        await ChatLocalStore.shared.resetAll()
        await refreshStorageUsage()
        isWorking = false
    }

    private func clearURLCache() async {
        isWorking = true
        URLCache.shared.removeAllCachedResponses()
        await refreshStorageUsage()
        isWorking = false
    }

    private func clearAllCaches() async {
        isWorking = true
        await ChatLocalStore.shared.resetAll()
        URLCache.shared.removeAllCachedResponses()
        await refreshStorageUsage()
        isWorking = false
    }

}

private func settingsDirectorySize(url: URL) -> Int {
    let fm = FileManager.default
    guard let enumerator = fm.enumerator(at: url, includingPropertiesForKeys: [.fileSizeKey], options: [.skipsHiddenFiles]) else {
        return 0
    }
    var total = 0
    for case let fileURL as URL in enumerator {
        total += ((try? fileURL.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
    }
    return total
}

struct LanguageSettingsView: View {
    @EnvironmentObject var session: SessionStore
    @State private var language: String
    @State private var isSaving = false
    @State private var error: String?

    init(selectedLanguage: String) {
        _language = State(initialValue: selectedLanguage == "en" ? "en" : "ru")
    }

    var body: some View {
        Form {
            Section {
                Picker("Язык", selection: Binding(get: { language }, set: { setLanguage($0) })) {
                    Text("Русский").tag("ru")
                    Text("English").tag("en")
                }
                .pickerStyle(.inline)
            } footer: {
                Text("Используется то же поле language, что и в веб-настройках.")
            }
            if isSaving { Section { ProgressView("Сохранение…") } }
            if let error { Section { Text(error).font(.footnote).foregroundStyle(Color.smDanger) } }
        }
        .navigationTitle("Язык")
        .smSettingsScreenStyle()
        .task { await loadLanguage() }
    }

    private func loadLanguage() async {
        do {
            let settings = try await session.api.getSettings()
            language = settings.language
        } catch { self.error = error.localizedDescription }
    }

    private func setLanguage(_ value: String) {
        let normalized = value == "en" ? "en" : "ru"
        guard language != normalized else { return }
        language = normalized
        isSaving = true
        UserDefaults.standard.set(normalized, forKey: "sun_ui_language")
        Task {
            do {
                var prefs = SettingsClientPreferences.localClientPreferences()
                prefs["language"] = normalized
                try await session.api.saveSettings(["language": normalized, "client_preferences": prefs])
                await session.refreshContacts()
            } catch APIError.unauthorized {
                session.route = .login
            } catch {
                self.error = error.localizedDescription
            }
            isSaving = false
        }
    }
}

struct ChatBehaviorSettingsView: View {
    @EnvironmentObject var session: SessionStore
    @AppStorage(SettingsClientPreferences.sendShortcutKey) private var sendShortcut = "enter"
    @AppStorage(SettingsClientPreferences.timeFormatKey) private var timeFormat = "24h"
    @AppStorage(SettingsClientPreferences.animationsEnabledKey) private var animationsEnabled = true
    @AppStorage(SettingsClientPreferences.performanceModeKey) private var performanceMode = "auto"
    @AppStorage(SettingsClientPreferences.motionLevelKey) private var motionLevel = "auto"
    @State private var clientPreferences: [String: Any] = [:]
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                Picker("Отправка", selection: Binding(get: { sendShortcut }, set: { sendShortcut = $0; save() })) {
                    Text("Enter").tag("enter")
                    Text("Ctrl + Enter").tag("ctrl_enter")
                }
                Picker("Формат времени", selection: Binding(get: { timeFormat }, set: { timeFormat = $0; save() })) {
                    Text("24 часа").tag("24h")
                    Text("12 часов").tag("12h")
                }
            } header: {
                Text("Сообщения")
            }
            Section {
                Toggle("Анимации", isOn: Binding(get: { animationsEnabled }, set: { animationsEnabled = $0; motionLevel = $0 ? "auto" : "lite"; save() }))
                Picker("Режим производительности", selection: Binding(get: { performanceMode }, set: { performanceMode = $0; save() })) {
                    Text("Авто").tag("auto")
                    Text("Полный").tag("full")
                    Text("Лёгкий").tag("lite")
                }
                Picker("Движение интерфейса", selection: Binding(get: { motionLevel }, set: { motionLevel = $0; save() })) {
                    Text("Авто").tag("auto")
                    Text("Полное").tag("full")
                    Text("Сбалансированное").tag("balanced")
                    Text("Минимальное").tag("lite")
                }
            } header: {
                Text("Производительность")
            }
            if let error { Section { Text(error).font(.footnote).foregroundStyle(Color.smDanger) } }
        }
        .navigationTitle("Настройки чата")
        .smSettingsScreenStyle()
        .task { await load() }
    }

    private func load() async {
        do {
            let settings = try await session.api.getSettings()
            clientPreferences = settings.clientPreferencesObject
            SettingsClientPreferences.apply(clientPreferences)
        } catch { self.error = error.localizedDescription }
    }

    private func save() {
        let updates: [String: Any] = [
            "sendShortcut": sendShortcut == "ctrl_enter" ? "ctrl_enter" : "enter",
            "timeFormat": timeFormat == "12h" ? "12h" : "24h",
            "performanceMode": SettingsClientPreferences.normalized(performanceMode, allowed: ["auto", "full", "lite"], fallback: "auto"),
            "motionLevel": animationsEnabled ? SettingsClientPreferences.normalized(motionLevel, allowed: ["auto", "full", "balanced", "lite"], fallback: "auto") : "lite",
        ]
        let payload = SettingsClientPreferences.mergedClientPreferences(base: clientPreferences, updates: updates)
        clientPreferences = payload
        Task {
            do { try await session.api.saveSettings(["client_preferences": payload]) }
            catch APIError.unauthorized { session.route = .login }
            catch { self.error = error.localizedDescription }
        }
    }
}

struct CallSettingsView: View {
    @EnvironmentObject var session: SessionStore
    @State private var callPrivacy = "contacts"
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                Picker("Кто может звонить", selection: Binding(get: { callPrivacy }, set: { value in
                    callPrivacy = value
                    saveCallPrivacy(value)
                })) {
                    Text("Все").tag("all")
                    Text("Контакты").tag("contacts")
                    Text("Никто").tag("nobody")
                }
            } header: {
                Text("Входящие звонки")
            } footer: {
                Text("Настройка синхронизируется с полем call_privacy веб-версии.")
            }
            Section {
                Text("VoIP push регистрируется автоматически при входе в приложение.")
                    .foregroundStyle(.secondary)
            } header: {
                Text("Push для звонков")
            }
            if let error { Section { Text(error).font(.footnote).foregroundStyle(Color.smDanger) } }
        }
        .navigationTitle("Звонки")
        .smSettingsScreenStyle()
        .task { await load() }
    }

    private func load() async {
        do { callPrivacy = try await session.api.getSettings().callPrivacy }
        catch { self.error = error.localizedDescription }
    }

    private func saveCallPrivacy(_ value: String) {
        Task {
            do { try await session.api.saveSettings(["call_privacy": value]) }
            catch APIError.unauthorized { session.route = .login }
            catch { self.error = error.localizedDescription }
        }
    }
}

struct SidebarLabelSettingsView: View {
    @EnvironmentObject var session: SessionStore
    @AppStorage(SettingsClientPreferences.sidebarWeatherEnabledKey) private var enabled = false
    @AppStorage(SettingsClientPreferences.sidebarWeatherSourceKey) private var source = "auto"
    @AppStorage(SettingsClientPreferences.sidebarWeatherCityKey) private var city = ""
    @AppStorage(SettingsClientPreferences.sidebarWeatherRotateKey) private var rotateSeconds = 60
    @State private var metrics = Set(SettingsClientPreferences.localWeatherMetrics())
    @State private var clientPreferences: [String: Any] = [:]
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                Toggle("Показывать погоду", isOn: Binding(get: { enabled }, set: { enabled = $0; save() }))
                Picker("Источник", selection: Binding(get: { source }, set: { source = $0; save() })) {
                    Text("Авто").tag("auto")
                    Text("Город").tag("city")
                }
                if source == "city" {
                    TextField("Город", text: Binding(get: { city }, set: { city = String($0.prefix(80)); save() }))
                }
                Picker("Ротация", selection: Binding(get: { rotateSeconds }, set: { rotateSeconds = $0; save() })) {
                    Text("30 секунд").tag(30)
                    Text("60 секунд").tag(60)
                }
            } header: {
                Text("Метка списка чатов")
            }

            Section {
                ForEach(SettingsClientPreferences.weatherMetricKeys, id: \.self) { key in
                    Toggle(weatherMetricLabel(key), isOn: Binding(
                        get: { metrics.contains(key) },
                        set: { value in
                            if value { metrics.insert(key) } else { metrics.remove(key) }
                            save()
                        }
                    ))
                }
            } header: {
                Text("Метрики")
            }
            if let error { Section { Text(error).font(.footnote).foregroundStyle(Color.smDanger) } }
        }
        .navigationTitle("Метка и погода")
        .smSettingsScreenStyle()
        .task { await load() }
    }

    private func load() async {
        do {
            let settings = try await session.api.getSettings()
            clientPreferences = settings.clientPreferencesObject
            SettingsClientPreferences.apply(clientPreferences)
            metrics = Set(SettingsClientPreferences.localWeatherMetrics())
        } catch { self.error = error.localizedDescription }
    }

    private func save() {
        let selected = SettingsClientPreferences.weatherMetricKeys.filter { metrics.contains($0) }
        UserDefaults.standard.set(selected, forKey: SettingsClientPreferences.sidebarWeatherMetricsKey)
        let updates: [String: Any] = [
            "sidebarWeatherEnabled": enabled,
            "sidebarWeatherSource": source == "city" ? "city" : "auto",
            "sidebarWeatherCity": String(city.prefix(80)),
            "sidebarWeatherRotateSeconds": rotateSeconds == 30 ? 30 : 60,
            "sidebarWeatherMetrics": selected,
        ]
        let payload = SettingsClientPreferences.mergedClientPreferences(base: clientPreferences, updates: updates)
        clientPreferences = payload
        Task {
            do { try await session.api.saveSettings(["client_preferences": payload]) }
            catch APIError.unauthorized { session.route = .login }
            catch { self.error = error.localizedDescription }
        }
    }

    private func weatherMetricLabel(_ key: String) -> String {
        switch key {
        case "temperature": return "Температура"
        case "feels_like": return "Ощущается"
        case "humidity": return "Влажность"
        case "wind": return "Ветер"
        case "precip": return "Осадки"
        case "uv": return "UV"
        case "aqi": return "Качество воздуха"
        case "pressure": return "Давление"
        case "sun_cycle": return "Восход и закат"
        default: return key
        }
    }
}

struct SettingsExportDocument: FileDocument {
    static var readableContentTypes: [UTType] { [.json] }
    var data: Data

    init(data: Data = Data()) {
        self.data = data
    }

    init(configuration: ReadConfiguration) throws {
        data = configuration.file.regularFileContents ?? Data()
    }

    func fileWrapper(configuration: WriteConfiguration) throws -> FileWrapper {
        FileWrapper(regularFileWithContents: data)
    }
}

struct SettingsTransferView: View {
    @EnvironmentObject var session: SessionStore
    @State private var exportDocument = SettingsExportDocument()
    @State private var showExporter = false
    @State private var showImporter = false
    @State private var isWorking = false
    @State private var status: String?
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                Button {
                    Task { await exportSettings() }
                } label: {
                    Label("Экспортировать JSON", systemImage: "square.and.arrow.up")
                }
                .disabled(isWorking)
            } header: {
                Text("Экспорт")
            }
            Section {
                Button {
                    showImporter = true
                } label: {
                    Label("Импортировать JSON", systemImage: "square.and.arrow.down")
                }
                .disabled(isWorking)
            } header: {
                Text("Импорт")
            }
            if isWorking { Section { ProgressView("Обработка…") } }
            if let status { Section { Text(status).font(.footnote).foregroundStyle(Color.smOnline) } }
            if let error { Section { Text(error).font(.footnote).foregroundStyle(Color.smDanger) } }
        }
        .navigationTitle("Экспорт и импорт")
        .smSettingsScreenStyle()
        .fileExporter(isPresented: $showExporter, document: exportDocument, contentType: .json, defaultFilename: exportFilename) { result in
            if case .failure(let error) = result { self.error = error.localizedDescription }
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.json]) { result in
            Task { await importSettings(result) }
        }
    }

    private var exportFilename: String {
        "sun-settings-\(SunDateFormatters.fileDate(from: Date())).json"
    }

    private func exportSettings() async {
        isWorking = true
        error = nil
        status = nil
        do {
            let raw = try await session.api.getRawSettingsObject()
            var server = raw
            server.removeValue(forKey: "success")
            server.removeValue(forKey: "online")
            server.removeValue(forKey: "last_seen")
            let client = SettingsClientPreferences.mergedClientPreferences(
                base: (raw["client_preferences"] as? [String: Any]) ?? [:],
                updates: [:]
            )
            let payload: [String: Any] = [
                "exportedAt": SunDateFormatters.isoInternetDateTime(from: Date()),
                "version": 1,
                "serverSettings": server,
                "localAppearance": [
                    "darkMode": client["darkMode"] ?? false,
                    "messageScale": client["messageScale"] ?? 1.0,
                    "interfaceSurfaceMode": client["interfaceSurfaceMode"] ?? "glass",
                    "interfaceThemeStore": client["interfaceThemeStore"] ?? [:],
                    "chatAppearanceStore": client["chatAppearanceStore"] ?? [:],
                    "language": client["language"] ?? "ru",
                    "updatedAt": client["updatedAt"] ?? NSNull(),
                ],
                "clientPreferences": client,
            ]
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            exportDocument = SettingsExportDocument(data: data)
            showExporter = true
            status = "Настройки подготовлены к экспорту."
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            self.error = error.localizedDescription
        }
        isWorking = false
    }

    private func importSettings(_ result: Result<URL, Error>) async {
        isWorking = true
        error = nil
        status = nil
        do {
            let url = try result.get()
            let access = url.startAccessingSecurityScopedResource()
            defer { if access { url.stopAccessingSecurityScopedResource() } }
            let data = try await readImportData(from: url)
            guard
                let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                let server = object["serverSettings"] as? [String: Any]
            else {
                throw APIError.serverError(0, "Некорректный файл настроек: отсутствует serverSettings.")
            }
            let client = (object["clientPreferences"] as? [String: Any])
                ?? ((object["localAppearance"] as? [String: Any]) ?? [:])
            let payload = sanitizedImportPayload(server: server, clientPreferences: client)
            try await session.api.saveSettings(payload)
            if let prefs = payload["client_preferences"] as? [String: Any] {
                SettingsClientPreferences.apply(prefs)
            }
            await session.loadBootstrap()
            status = "Настройки импортированы."
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            self.error = error.localizedDescription
        }
        isWorking = false
    }

    private func readImportData(from url: URL) async throws -> Data {
        try await Task.detached(priority: .userInitiated) {
            try Data(contentsOf: url)
        }.value
    }

    private func sanitizedImportPayload(server: [String: Any], clientPreferences: [String: Any]) -> [String: Any] {
        func text(_ key: String, limit: Int) -> String {
            String((server[key] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines).prefix(limit))
        }
        func privacy(_ key: String, fallback: String = "all") -> String {
            let value = (server[key] as? String ?? "").lowercased()
            return ["all", "contacts", "nobody"].contains(value) ? value : fallback
        }
        let language = (server["language"] as? String ?? "ru").lowercased() == "en" ? "en" : "ru"
        var payload: [String: Any] = [
            "username": text("username", limit: 50),
            "display_name": text("display_name", limit: 50),
            "language": language,
            "bio": text("bio", limit: 280),
            "status_text": text("status_text", limit: 100),
            "is_public": server["is_public"] as? Bool ?? false,
            "auto_decline_requests": server["auto_decline_requests"] as? Bool ?? false,
            "mute_dialog_requests": server["mute_dialog_requests"] as? Bool ?? false,
            "hide_online_status": server["hide_online_status"] as? Bool ?? false,
            "last_seen_visibility": privacy("last_seen_visibility", fallback: (server["hide_online_status"] as? Bool ?? false) ? "nobody" : "all"),
            "avatar_visibility": privacy("avatar_visibility"),
            "bio_visibility": privacy("bio_visibility"),
            "forward_link_privacy": privacy("forward_link_privacy"),
            "group_invite_privacy": privacy("group_invite_privacy"),
            "voice_message_privacy": privacy("voice_message_privacy"),
            "message_privacy": privacy("message_privacy"),
            "read_receipts_privacy": privacy("read_receipts_privacy"),
            "typing_privacy": privacy("typing_privacy"),
            "voice_listened_privacy": privacy("voice_listened_privacy"),
            "call_privacy": privacy("call_privacy"),
            "public_key_search_privacy": privacy("public_key_search_privacy"),
        ]
        payload["client_preferences"] = SettingsClientPreferences.mergedClientPreferences(base: clientPreferences, updates: [:])
        return payload
    }
}

struct SecuritySettingsView: View {
    @EnvironmentObject var session: SessionStore
    @State private var hasPrivateKey = false
    @State private var copied = false
    @State private var recoveryPhrase = ""
    @State private var showRotateConfirm = false
    @State private var isRotating = false
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                LabeledContent {
                    Text(hasPrivateKey ? "В Keychain" : "Не загружен")
                } label: {
                    Text("Приватный ключ")
                }
                if let publicKey = session.bootstrap?.user.publicKey, !publicKey.isEmpty {
                    Button {
                        UIPasteboard.general.string = publicKey
                        copied = true
                    } label: {
                        Label(copied ? "Публичный ключ скопирован" : "Скопировать публичный ключ", systemImage: "doc.on.doc")
                    }
                    Text(publicKey)
                        .font(.caption.monospaced())
                        .textSelection(.enabled)
                }
            } header: {
                Text("Шифрование")
            }
            Section {
                SecureField("Текущие 24 слова", text: $recoveryPhrase)
                    .textContentType(.oneTimeCode)
                Button(role: .destructive) {
                    showRotateConfirm = true
                } label: {
                    Label("Перевыпустить ключ", systemImage: "arrow.triangle.2.circlepath")
                }
                .disabled(isRotating || recoveryPhrase.split(separator: " ").count < 12 || !hasPrivateKey)
            } header: {
                Text("Ротация ключа")
            } footer: {
                Text("После успешной ротации сервер завершит все сессии. Для восстановления сейфа используется та же recovery-фраза, что и в веб-версии.")
            }
            Section {
                NavigationLink { MnemonicRestoreSettingsView() } label: { Label("Секретная фраза", systemImage: "key") }
                NavigationLink { TotpSettingsView() } label: { Label("TOTP 2FA", systemImage: "number.square") }
                NavigationLink { DevicesView() } label: { Label("Устройства", systemImage: "iphone.and.ipad") }
                NavigationLink { BlockedUsersView() } label: { Label("Заблокированные", systemImage: "hand.raised") }
            } header: {
                Text("Доступ")
            }
            if isRotating {
                Section { ProgressView("Перевыпуск ключа…") }
            }
            if let error {
                Section { Text(error).font(.footnote).foregroundStyle(Color.smDanger) }
            }
        }
        .navigationTitle("Безопасность")
        .smSettingsScreenStyle()
        .onAppear { hasPrivateKey = KeychainService.hasPrivateKey() }
        .confirmationDialog("Перевыпустить ключ?", isPresented: $showRotateConfirm, titleVisibility: .visible) {
            Button("Перевыпустить", role: .destructive) { Task { await rotateKey() } }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Все устройства выйдут из аккаунта. Войти обратно можно будет с текущими словами восстановления.")
        }
    }

    private func rotateKey() async {
        let phrase = recoveryPhrase.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
        guard !phrase.isEmpty else { return }
        guard let oldPrivateKey = KeychainService.loadPrivateKey() else {
            error = "Текущий приватный ключ не найден в Keychain."
            return
        }
        guard let oldPublicKey = session.bootstrap?.user.publicKey, !oldPublicKey.isEmpty else {
            error = "Текущий публичный ключ не найден."
            return
        }

        isRotating = true
        error = nil
        do {
            let currentVault = try await session.api.getLoginVault()
            let decryptedCurrent = try SunCrypto.decryptVault(currentVault, mnemonic: phrase)
            let oldPKCS8 = SunCrypto.convertToPKCS8PEM(oldPrivateKey)
            guard stripPEM(decryptedCurrent) == stripPEM(oldPKCS8) || stripPEM(decryptedCurrent) == stripPEM(oldPrivateKey) else {
                throw APIError.serverError(0, "Recovery-фраза не соответствует текущему ключу.")
            }

            let material = try await Task.detached(priority: .userInitiated) {
                let pair = try SunCrypto.generateRSAKeyPair()
                let pkcs8 = SunCrypto.convertToPKCS8PEM(pair.privatePEM)
                let newVault = try SunCrypto.encryptVault(privateKeyPEM: pkcs8, mnemonic: phrase)
                return (privatePEM: pair.privatePEM, publicPEM: pair.publicPEM, loginVault: newVault)
            }.value

            let ts = Int(Date().timeIntervalSince1970)
            let canonical = rotationPayload(oldPublicKey: oldPublicKey, newPublicKey: material.publicPEM, ts: ts)
            let signature = try SunCrypto.rsaSign(canonical, privateKeyPEM: oldPrivateKey)
            try KeychainService.savePrivateKey(material.privatePEM)
            try await session.api.rotateKeys(
                newPublicKey: stripPEM(material.publicPEM),
                signature: signature,
                ts: ts,
                newLoginVault: material.loginVault
            )
            session.api.clearSessionCookiesOnly()
            session.bootstrap = nil
            session.contacts = []
            session.route = .login
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            self.error = error.localizedDescription
        }
        isRotating = false
    }

    private func stripPEM(_ pem: String) -> String {
        pem
            .replacingOccurrences(of: #"-----BEGIN [^-]+-----"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"-----END [^-]+-----"#, with: "", options: .regularExpression)
            .replacingOccurrences(of: #"\s+"#, with: "", options: .regularExpression)
    }

    private func rotationPayload(oldPublicKey: String, newPublicKey: String, ts: Int) -> String {
        "{\"new_public_key\":\"\(stripPEM(newPublicKey))\",\"old_public_key\":\"\(stripPEM(oldPublicKey))\",\"op\":\"key_rotation_v1\",\"ts\":\(ts)}"
    }
}

struct MnemonicRestoreSettingsView: View {
    @EnvironmentObject var session: SessionStore
    @State private var phrase = ""
    @State private var hasPrivateKey = KeychainService.hasPrivateKey()
    @State private var isWorking = false
    @State private var error: String?
    @State private var status: String?

    var body: some View {
        Form {
            Section {
                LabeledContent {
                    Text(hasPrivateKey ? "Разблокирован" : "Заблокирован")
                } label: {
                    Text("Приватный ключ")
                }
                Button(role: .destructive) {
                    KeychainService.deletePrivateKey()
                    hasPrivateKey = false
                    status = "Приватный ключ удалён из локального Keychain."
                } label: {
                    Label("Заблокировать локально", systemImage: "lock")
                }
                .disabled(!hasPrivateKey || isWorking)
            } header: {
                Text("Состояние")
            }

            Section {
                TextEditor(text: $phrase)
                    .frame(minHeight: 120)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                Button {
                    Task { await unlockVault() }
                } label: {
                    Label("Активировать расшифровку", systemImage: "checkmark.shield")
                }
                .disabled(isWorking || phrase.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            } header: {
                Text("Recovery-фраза")
            } footer: {
                Text("Фраза не отправляется на сервер. iOS скачивает login_vault и расшифровывает его локально, как веб-клиент.")
            }

            if isWorking { Section { ProgressView("Проверка…") } }
            if let status { Section { Text(status).font(.footnote).foregroundStyle(Color.smOnline) } }
            if let error { Section { Text(error).font(.footnote).foregroundStyle(Color.smDanger) } }
        }
        .navigationTitle("Секретная фраза")
        .smSettingsScreenStyle()
    }

    private func unlockVault() async {
        isWorking = true
        error = nil
        status = nil
        do {
            let normalized = phrase.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            let vault = try await session.api.getLoginVault()
            let privateKey = try SunCrypto.decryptVault(vault, mnemonic: normalized)
            try KeychainService.savePrivateKey(privateKey)
            hasPrivateKey = true
            phrase = ""
            status = "Приватный ключ сохранён в Keychain."
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            self.error = error.localizedDescription
        }
        isWorking = false
    }
}

struct IntegrationsSettingsView: View {
    @EnvironmentObject var session: SessionStore
    @Environment(\.openURL) private var openURL
    @State private var status: SpotifyStatusResponse?
    @State private var privacy = "contacts"
    @State private var hideExplicit = false
    @State private var isSaving = false
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                LabeledContent {
                    Text((status?.configured ?? false) ? "Да" : "Нет")
                } label: {
                    Text("Настроено на сервере")
                }
                LabeledContent {
                    Text((status?.connected ?? false) ? "Активно" : "Не подключено")
                } label: {
                    Text("Подключение")
                }
                if status?.configured == true {
                    Button {
                        if let url = URL(string: "/spotify/connect", relativeTo: URL(string: kBaseURL))?.absoluteURL {
                            openURL(url)
                        }
                    } label: {
                        Label("Подключить Spotify", systemImage: "music.note")
                    }
                    Picker("Кто видит статус", selection: Binding(get: { privacy }, set: { privacy = $0; savePrivacy() })) {
                        Text("Все").tag("all")
                        Text("Контакты").tag("contacts")
                        Text("Никто").tag("nobody")
                    }
                    Toggle("Скрывать explicit-треки", isOn: Binding(get: { hideExplicit }, set: { hideExplicit = $0; savePrivacy() }))
                    Button(role: .destructive) {
                        Task { await disconnect() }
                    } label: {
                        Label("Отключить Spotify", systemImage: "xmark.circle")
                    }
                    .disabled(!(status?.connected ?? false))
                }
            } header: {
                Text("Spotify")
            }
            if isSaving { Section { ProgressView("Сохранение…") } }
            if let error { Section { Text(error).font(.footnote).foregroundStyle(Color.smDanger) } }
        }
        .navigationTitle("Подключения")
        .smSettingsScreenStyle()
        .task { await load() }
    }

    private func load() async {
        do {
            let response = try await session.api.getSpotifyStatus()
            status = response
            privacy = response.spotifyPrivacy
            hideExplicit = response.hideExplicit
        } catch { self.error = error.localizedDescription }
    }

    private func savePrivacy() {
        isSaving = true
        Task {
            do {
                try await session.api.saveSpotifyPrivacy(privacy: privacy, hideExplicit: hideExplicit)
                await load()
            } catch APIError.unauthorized {
                session.route = .login
            } catch {
                self.error = error.localizedDescription
            }
            isSaving = false
        }
    }

    private func disconnect() async {
        isSaving = true
        do {
            try await session.api.disconnectSpotify()
            await load()
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            self.error = error.localizedDescription
        }
        isSaving = false
    }
}

struct AccountSettingsView: View {
    @EnvironmentObject var session: SessionStore
    @State private var showDeleteConfirm = false
    @State private var isDeleting = false
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                LabeledContent {
                    Text("@\(session.bootstrap?.user.username ?? "—")")
                } label: {
                    Text("Пользователь")
                }
                LabeledContent {
                    Text(session.bootstrap?.user.displayName ?? "—")
                } label: {
                    Text("Имя")
                }
                Button("Выйти") { Task { await session.logout() } }
            } header: {
                Text("Аккаунт")
            }
            Section {
                Button(role: .destructive) {
                    showDeleteConfirm = true
                } label: {
                    Label("Удалить аккаунт", systemImage: "trash")
                }
                .disabled(isDeleting)
            } footer: {
                Text("Удаление аккаунта запускает тот же серверный сценарий /api/delete_account, что и веб-версия.")
            }
            if isDeleting { Section { ProgressView("Удаление…") } }
            if let error { Section { Text(error).font(.footnote).foregroundStyle(Color.smDanger) } }
        }
        .navigationTitle("Аккаунт")
        .smSettingsScreenStyle()
        .confirmationDialog("Удалить аккаунт?", isPresented: $showDeleteConfirm, titleVisibility: .visible) {
            Button("Удалить аккаунт", role: .destructive) { Task { await deleteAccount() } }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Действие необратимо и удалит аккаунт, сессии и данные на сервере.")
        }
    }

    private func deleteAccount() async {
        isDeleting = true
        error = nil
        do {
            try await session.api.deleteAccount()
            session.api.resetAuthSession()
            session.bootstrap = nil
            session.contacts = []
            session.route = .login
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            self.error = error.localizedDescription
        }
        isDeleting = false
    }
}

struct SupportSettingsView: View {
    @EnvironmentObject var session: SessionStore
    @State private var category = "bug"
    @State private var contact = ""
    @State private var subject = ""
    @State private var message = ""
    @State private var isSubmitting = false
    @State private var submittedId: Int?
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                Picker("Категория", selection: $category) {
                    Text("Ошибка").tag("bug")
                    Text("Производительность").tag("performance")
                    Text("Функция").tag("feature")
                    Text("Безопасность").tag("security")
                    Text("Другое").tag("other")
                }
                TextField("Контакт для ответа", text: $contact)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled(true)
                TextField("Тема", text: $subject)
                    .onChange(of: subject) { _, value in
                        if value.count > 160 { subject = String(value.prefix(160)) }
                    }
                TextEditor(text: $message)
                    .frame(minHeight: 160)
                    .onChange(of: message) { _, value in
                        if value.count > 8000 { message = String(value.prefix(8000)) }
                    }
                Text("\(message.count)/8000")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } header: {
                Text("Заявка")
            }
            Section {
                Button {
                    Task { await submit() }
                } label: {
                    Label("Отправить", systemImage: "paperplane")
                }
                .disabled(isSubmitting || subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                Link(destination: URL(string: "/support/feedback", relativeTo: URL(string: kBaseURL))!.absoluteURL) {
                    Label("Открыть полную форму", systemImage: "safari")
                }
            }
            if isSubmitting { Section { ProgressView("Отправка…") } }
            if let submittedId { Section { Text("Заявка #\(submittedId) отправлена.").font(.footnote).foregroundStyle(Color.smOnline) } }
            if let error { Section { Text(error).font(.footnote).foregroundStyle(Color.smDanger) } }
        }
        .navigationTitle("Поддержка")
        .smSettingsScreenStyle()
    }

    private func submit() async {
        isSubmitting = true
        error = nil
        submittedId = nil
        do {
            let response = try await session.api.submitSupportRequest(
                category: category,
                contactHandle: contact.trimmingCharacters(in: .whitespacesAndNewlines),
                subject: subject.trimmingCharacters(in: .whitespacesAndNewlines),
                message: message.trimmingCharacters(in: .whitespacesAndNewlines)
            )
            submittedId = response.requestId
            subject = ""
            message = ""
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            self.error = error.localizedDescription
        }
        isSubmitting = false
    }
}

// MARK: - Appearance Settings View

struct AppearanceSettingsView: View {
    @AppStorage("appColorScheme") private var schemePref: String = AppColorScheme.system.rawValue
    @AppStorage(SettingsClientPreferences.themePresetKey) private var themePreset = "light-classic"
    @AppStorage(SettingsClientPreferences.accentColorKey) private var accentColor = "#c4943c"
    @AppStorage(SettingsClientPreferences.interfaceSurfaceModeKey) private var surfaceMode = "glass"
    @AppStorage(SettingsClientPreferences.chatAppearanceModeKey) private var chatMode = "default"
    @AppStorage(SettingsClientPreferences.chatBackgroundColorKey) private var chatBackgroundColor = "#f2ede2"
    @AppStorage(SettingsClientPreferences.chatGradientAKey) private var gradientA = "#f2ede2"
    @AppStorage(SettingsClientPreferences.chatGradientBKey) private var gradientB = "#d8ecff"
    @AppStorage(SettingsClientPreferences.chatBackgroundImageKey) private var backgroundImageDataURL = ""
    @AppStorage(SettingsClientPreferences.chatBackgroundDarkenKey) private var imageDarken = 0.0
    @AppStorage(SettingsClientPreferences.chatBackgroundBlurKey) private var imageBlur = 0.0
    @AppStorage(SettingsClientPreferences.chatBackgroundImageOpacityKey) private var imageOpacity = 1.0
    @AppStorage(SettingsClientPreferences.chatBackgroundScaleKey) private var imageScale = 1.0
    @AppStorage(SettingsClientPreferences.chatBackgroundPositionXKey) private var imagePositionX = 50.0
    @AppStorage(SettingsClientPreferences.chatBackgroundPositionYKey) private var imagePositionY = 50.0
    @AppStorage(SettingsClientPreferences.chatBackgroundRepeatKey) private var imageRepeat = false
    @AppStorage(SettingsClientPreferences.bubbleOutKey) private var bubbleOut = "#c4943c"
    @AppStorage(SettingsClientPreferences.bubbleInKey) private var bubbleIn = "#ffffff"
    @AppStorage(SettingsClientPreferences.bubbleOutTextKey) private var bubbleOutText = "#15140e"
    @AppStorage(SettingsClientPreferences.bubbleInTextKey) private var bubbleInText = "#1f1b14"
    @AppStorage(SettingsClientPreferences.bubbleOpacityKey) private var bubbleOpacity = 1.0
    @AppStorage(SettingsClientPreferences.messageScaleKey) private var messageScale = 1.0
    @EnvironmentObject var session: SessionStore
    @State private var clientPreferences: [String: Any] = [:]
    @State private var selectedBackgroundItem: PhotosPickerItem?
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                Picker("Схема iOS", selection: Binding(get: { schemePref }, set: { schemePref = $0; saveAppearance() })) {
                    ForEach(AppColorScheme.allCases, id: \.rawValue) { scheme in
                        Label(schemeRussian(scheme), systemImage: scheme.icon).tag(scheme.rawValue)
                    }
                }
                Picker("Пресет", selection: Binding(get: { themePreset }, set: { themePreset = $0; applyThemePreset($0); saveAppearance() })) {
                    Text("Light Classic").tag("light-classic")
                    Text("Light Sky").tag("light-sky")
                    Text("Light Mist").tag("light-mist")
                    Text("Dark Classic").tag("dark-classic")
                    Text("Dark Forest").tag("dark-forest")
                    Text("Dark Midnight").tag("dark-midnight")
                    Text("Dark Graphite").tag("dark-graphite")
                    Text("Custom Light").tag("custom-light")
                    Text("Custom Dark").tag("custom-dark")
                }
                Picker("Поверхности", selection: Binding(get: { surfaceMode }, set: { surfaceMode = $0; saveAppearance() })) {
                    Text("Liquid Glass").tag("glass")
                    Text("Solid").tag("solid")
                }
                hexField("Акцент", text: $accentColor)
            } header: {
                Text("Тема")
            }

            Section {
                Picker("Режим", selection: Binding(get: { chatMode }, set: { chatMode = $0; saveAppearance() })) {
                    Text("По умолчанию").tag("default")
                    Text("Пресет").tag("preset")
                    Text("Цвет").tag("color")
                    Text("Градиент").tag("gradient")
                    Text("Своё изображение").tag("custom")
                }
                hexField("Цвет", text: $chatBackgroundColor)
                hexField("Градиент A", text: $gradientA)
                hexField("Градиент B", text: $gradientB)
                PhotosPicker(selection: $selectedBackgroundItem, matching: .images) {
                    Label("Выбрать изображение", systemImage: "photo")
                }
                Button(role: .destructive) {
                    backgroundImageDataURL = ""
                    saveAppearance()
                } label: {
                    Label("Удалить изображение", systemImage: "trash")
                }
                .disabled(backgroundImageDataURL.isEmpty)
            } header: {
                Text("Фон чата")
            }

            Section {
                settingsSlider("Затемнение", value: $imageDarken, range: 0...0.85)
                settingsSlider("Размытие", value: $imageBlur, range: 0...24)
                settingsSlider("Прозрачность", value: $imageOpacity, range: 0.2...1.0)
                settingsSlider("Масштаб", value: $imageScale, range: 0.5...3.0)
                settingsSlider("Позиция X", value: $imagePositionX, range: 0...100)
                settingsSlider("Позиция Y", value: $imagePositionY, range: 0...100)
                Toggle("Повторять изображение", isOn: Binding(get: { imageRepeat }, set: { imageRepeat = $0; saveAppearance() }))
            } header: {
                Text("Параметры изображения")
            }

            Section {
                settingsSlider("Масштаб", value: $messageScale, range: 0.9...1.3)
                settingsSlider("Прозрачность пузырей", value: $bubbleOpacity, range: 0.45...1.0)
                hexField("Исходящий пузырь", text: $bubbleOut)
                hexField("Текст исходящего", text: $bubbleOutText)
                hexField("Входящий пузырь", text: $bubbleIn)
                hexField("Текст входящего", text: $bubbleInText)
            } header: {
                Text("Сообщения")
            }

            Section {
                appearancePreview
                Button("Сбросить цвета") {
                    resetColors()
                }
                Button(role: .destructive) {
                    resetAppearance()
                } label: {
                    Text("Сбросить внешний вид")
                }
            } header: {
                Text("Предпросмотр")
            }

            if let error {
                Section { Text(error).font(.footnote).foregroundStyle(Color.smDanger) }
            }
        }
        .navigationTitle("Внешний вид")
        .smSettingsScreenStyle()
        .task { await loadAppearance() }
        .onChange(of: selectedBackgroundItem) { _, item in
            Task { await importBackground(item) }
        }
    }

    private func schemeRussian(_ scheme: AppColorScheme) -> String {
        switch scheme {
        case .system: return "Системная"
        case .light:  return "Светлая"
        case .dark:   return "Тёмная"
        }
    }

    private func hexField(_ title: String, text: Binding<String>) -> some View {
        HStack {
            Text(title)
            Spacer()
            RoundedRectangle(cornerRadius: 4)
                .fill(Color(hex: text.wrappedValue))
                .frame(width: 28, height: 20)
            TextField("#RRGGBB", text: Binding(
                get: { text.wrappedValue },
                set: { value in
                    text.wrappedValue = normalizeHex(value)
                    saveAppearance()
                }
            ))
            .multilineTextAlignment(.trailing)
            .textInputAutocapitalization(.characters)
            .autocorrectionDisabled(true)
            .frame(maxWidth: 110)
        }
    }

    private func settingsSlider(_ title: String, value: Binding<Double>, range: ClosedRange<Double>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            LabeledContent {
                Text(String(format: "%.2f", value.wrappedValue))
            } label: {
                Text(title)
            }
            Slider(value: Binding(get: { value.wrappedValue }, set: { value.wrappedValue = $0; saveAppearance() }), in: range)
        }
    }

    private var appearancePreview: some View {
        VStack(spacing: 10) {
            HStack {
                Text("sun messenger")
                    .font(.headline)
                Spacer()
                Image(systemName: "lock.fill")
                    .foregroundStyle(Color.smOnline)
            }
            HStack {
                Spacer()
                Text("Привет! Как дела?")
                    .font(.body)
                    .scaleEffect(CGFloat(messageScale), anchor: .trailing)
                    .foregroundStyle(Color(hex: bubbleOutText))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color(hex: bubbleOut).opacity(bubbleOpacity), in: RoundedRectangle(cornerRadius: 14))
            }
            HStack {
                Text("Всё отлично, спасибо!")
                    .font(.body)
                    .scaleEffect(CGFloat(messageScale), anchor: .leading)
                    .foregroundStyle(Color(hex: bubbleInText))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color(hex: bubbleIn).opacity(bubbleOpacity), in: RoundedRectangle(cornerRadius: 14))
                Spacer()
            }
        }
        .padding(.vertical, 8)
        .background(previewBackground, in: RoundedRectangle(cornerRadius: 12))
    }

    private var previewBackground: some ShapeStyle {
        if chatMode == "gradient" {
            return AnyShapeStyle(LinearGradient(colors: [Color(hex: gradientA), Color(hex: gradientB)], startPoint: .topLeading, endPoint: .bottomTrailing))
        }
        return AnyShapeStyle(Color(hex: chatBackgroundColor))
    }

    private func loadAppearance() async {
        do {
            let settings = try await session.api.getSettings()
            clientPreferences = settings.clientPreferencesObject
            SettingsClientPreferences.apply(clientPreferences)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func saveAppearance() {
        let payload = SettingsClientPreferences.mergedClientPreferences(base: clientPreferences, updates: [:])
        clientPreferences = payload
        Task {
            do { try await session.api.saveSettings(["client_preferences": payload]) }
            catch APIError.unauthorized { session.route = .login }
            catch { self.error = error.localizedDescription }
        }
    }

    private func applyThemePreset(_ preset: String) {
        switch preset {
        case "light-sky":
            schemePref = AppColorScheme.light.rawValue; accentColor = "#2f7ed8"; chatBackgroundColor = "#eaf5ff"
        case "light-mist":
            schemePref = AppColorScheme.light.rawValue; accentColor = "#6f8f7b"; chatBackgroundColor = "#eef3ef"
        case "dark-classic":
            schemePref = AppColorScheme.dark.rawValue; accentColor = "#d6a553"; chatBackgroundColor = "#15140e"
        case "dark-forest":
            schemePref = AppColorScheme.dark.rawValue; accentColor = "#6fbf8f"; chatBackgroundColor = "#102016"
        case "dark-midnight":
            schemePref = AppColorScheme.dark.rawValue; accentColor = "#7897ff"; chatBackgroundColor = "#101426"
        case "dark-graphite":
            schemePref = AppColorScheme.dark.rawValue; accentColor = "#b9b9b9"; chatBackgroundColor = "#171717"
        default:
            if preset.hasPrefix("custom-dark") { schemePref = AppColorScheme.dark.rawValue }
            else { schemePref = AppColorScheme.light.rawValue }
        }
    }

    private func resetColors() {
        accentColor = "#c4943c"
        bubbleOut = "#c4943c"
        bubbleIn = "#ffffff"
        bubbleOutText = "#15140e"
        bubbleInText = "#1f1b14"
        saveAppearance()
    }

    private func resetAppearance() {
        schemePref = AppColorScheme.system.rawValue
        themePreset = "light-classic"
        accentColor = "#c4943c"
        surfaceMode = "glass"
        chatMode = "default"
        chatBackgroundColor = "#f2ede2"
        gradientA = "#f2ede2"
        gradientB = "#d8ecff"
        backgroundImageDataURL = ""
        imageDarken = 0
        imageBlur = 0
        imageOpacity = 1
        imageScale = 1
        imagePositionX = 50
        imagePositionY = 50
        imageRepeat = false
        bubbleOpacity = 1
        messageScale = 1
        resetColors()
    }

    private func importBackground(_ item: PhotosPickerItem?) async {
        guard let item else { return }
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else { return }
            guard let jpeg = await Task.detached(priority: .userInitiated) {
                Self.resizedJPEGData(from: data, maxDimension: 1440)
            }.value else { return }
            backgroundImageDataURL = "data:image/jpeg;base64,\(jpeg.base64EncodedString())"
            chatMode = "custom"
            saveAppearance()
        } catch {
            self.error = error.localizedDescription
        }
        selectedBackgroundItem = nil
    }

    private static func resizedJPEGData(from data: Data, maxDimension: CGFloat) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        let maxSide = max(image.size.width, image.size.height)
        let scale = maxSide > maxDimension ? maxDimension / maxSide : 1
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: size)
        let rendered = renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        return rendered.jpegData(compressionQuality: 0.82)
    }

    private func normalizeHex(_ raw: String) -> String {
        let hex = raw
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "#", with: "")
            .uppercased()
            .filter { "0123456789ABCDEF".contains($0) }
        return "#\(String(hex.prefix(6)))"
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
        .smSettingsScreenStyle()
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
                    ForEach(others) { device in
                        if current != nil || device.id != others.first?.id {
                            Divider().padding(.leading, 58).background(Color.smBorderSoft)
                        }
                        deviceRow(device)
                    }
                    if response.devices.isEmpty {
                        Text("Активные сессии не найдены.")
                            .font(.caption)
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
                    .font(.subheadline.weight(.semibold))
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
                .font(.caption)
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
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(Color.smText)
                            Text("Срок для всех сохранённых сессий")
                                .font(.caption)
                                .foregroundStyle(Color.smMuted)
                        }
                        Spacer()
                        if isMutating {
                            ProgressView()
                                .tint(Color.smAccent)
                        } else {
                            Text(sessionAutoLogoutLabel(response))
                                .font(.caption.weight(.semibold))
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
                .font(.caption)
                .foregroundStyle(Color.smMuted)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(14)
        .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
    }

    private func sectionHeader(_ text: String) -> some View {
        Text(text)
            .font(.caption2.weight(.semibold))
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
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.smText)
                        .lineLimit(1)
                    if device.isCurrent {
                        Text("Текущая")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Color.smOnline)
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(Color.smOnline.opacity(0.12), in: Capsule())
                    }
                }
                Text(deviceSubtitle(device))
                    .font(.caption)
                    .foregroundStyle(Color.smMuted)
                    .lineLimit(2)
            }

            Spacer()

            if device.isCurrent || !device.familyId.isEmpty {
                Button(device.isCurrent ? "Выйти" : "Завершить") {
                    pendingRevokeDevice = device
                }
                .font(.caption.weight(.semibold))
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
