import Foundation
import SwiftUI
import Combine
import PhotosUI
import AVKit
import AVFoundation
import ImageIO

struct ChatView: View {
    let contact: Contact
    @EnvironmentObject var session: SessionStore

    @State private var messages: [ChatMessage] = []
    @State private var decryptedTexts: [Int: String] = [:]
    @State private var decryptionSummary: String?
    @State private var isLoading = true
    @State private var loadError: String?
    @State private var sendError: String?
    @State private var composerText = ""
    @State private var isSending = false
    @State private var isLoadingOlder = false
    @State private var hasOlderMessages = true
    @State private var partnerIsTyping = false
    @State private var typingDebounceTask: Task<Void, Never>? = nil
    @State private var partnerStopTypingTask: Task<Void, Never>? = nil
    @State private var showAttachmentPicker = false
    @State private var selectedPhotoItem: PhotosPickerItem? = nil
    @State private var isUploadingMedia = false
    @State private var isRecording = false
    @State private var audioRecorder: AVAudioRecorder? = nil
    @State private var recordingURL: URL? = nil
    @State private var recordingDuration: TimeInterval = 0
    @State private var recordingTimerTask: Task<Void, Never>? = nil
    @State private var scrollIntent: ChatScrollIntent = .bottom(animated: false)
    @State private var isPinnedToBottom = true
    @State private var draftSaveTask: Task<Void, Never>? = nil
    @State private var draftSaveSequence = 0
    @State private var lastSavedDraftText = ""
    @State private var lastDraftUpdatedAt: Double = 0
    @State private var isApplyingDraftText = false
    @State private var hasPrivateKeyLoaded = false
    @State private var deleteDialogTask: Task<Void, Never>? = nil
    @State private var editFocusTask: Task<Void, Never>? = nil
    @State private var toastDismissTask: Task<Void, Never>? = nil

    // Long-press context menu (Telegram-style: reaction bar + actions).
    @State private var menuTargetId: Int? = nil
    // Inline edit state.
    @State private var editingMessageId: Int? = nil
    // Pending delete confirmation.
    @State private var pendingDelete: PendingDelete? = nil
    // A short, transient toast (e.g. "Скопировано").
    @State private var toast: String? = nil

    /// Quick-pick reactions (subset of the server's allowed set, top-ranked).
    private let reactionEmojis = ["👍", "❤️", "😂", "😮", "😢", "🔥"]
    private let composerEmojiSuggestions = [
        "\u{1F642}", "\u{1F604}", "\u{1F605}", "\u{1F972}",
        "\u{1F60A}", "\u{1F60D}", "\u{1F914}", "\u{1F44D}",
        "\u{2764}\u{FE0F}", "\u{1F525}", "\u{1F389}", "\u{2600}\u{FE0F}",
    ]

    struct PendingDelete: Identifiable {
        let id: Int
        let isFromMe: Bool
    }

    @FocusState private var composerFocused: Bool
    @State private var showContactProfile = false

    private var myId: Int { session.bootstrap?.user.id ?? 0 }
    private var myPublicKey: String { session.bootstrap?.user.publicKey ?? "" }
    private var liveContact: Contact {
        session.contacts.first(where: { $0.chatId == contact.chatId }) ?? contact
    }
    /// True for the "Saved Messages" self-chat — calls make no sense there.
    private var isSavedMessages: Bool {
        let uid = liveContact.userId ?? contact.userId
        return uid != nil && uid == session.bootstrap?.user.id
    }
    private var statusText: String {
        let current = liveContact
        let isSavedMessages = current.userId != nil && current.userId == session.bootstrap?.user.id
        if isSavedMessages { return "сохранённые сообщения" }
        if partnerIsTyping || current.isTyping { return "печатает…" }
        if current.isOnline { return "в сети" }
        if current.isGroup { return "групповой чат" }
        return smFormatLastSeen(current.lastSeen)
    }
    private var hasPrivateKey: Bool { hasPrivateKeyLoaded }
    private var canSendEncrypted: Bool {
        hasPrivateKey && !myPublicKey.isEmpty && !contact.publicKey.isEmpty && !contact.isGroup
    }
    private var canSendSecureMessage: Bool {
        if contact.isGroup {
            return hasPrivateKey && !myPublicKey.isEmpty
        }
        return canSendEncrypted
    }
    var body: some View {
        nativeChatLayout
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { toolbarContent }
            .toolbarBackground(Color.smBg, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            // The bottom tab bar must not show while a chat is open.
            .toolbar(.hidden, for: .tabBar)
            .navigationDestination(isPresented: $showContactProfile) {
                ContactProfileView(contact: liveContact)
            }
            .confirmationDialog("Удалить сообщение?", isPresented: deleteDialogBinding, titleVisibility: .visible) {
                if let target = pendingDelete {
                    if target.isFromMe {
                        Button("Удалить у всех", role: .destructive) { deleteMessage(id: target.id, mode: "for_both") }
                    }
                    Button("Удалить у меня", role: .destructive) { deleteMessage(id: target.id, mode: "for_me") }
                    Button("Отмена", role: .cancel) { pendingDelete = nil }
                }
            }
            .onReceive(NotificationCenter.default.publisher(for: .smPreparedIncomingMessage)) { note in
                handlePreparedIncomingMessage(note)
            }
            .onReceive(NotificationCenter.default.publisher(for: .smSocketMessage)) { note in
                handleSocketNotification(note)
            }
            .task {
                await loadMessages()
                await loadDraft()
                await slowPollLoop()
            }
            .onAppear {
                refreshPrivateKeyState()
                session.activeChatId = contact.chatId
                session.clearUnread(chatId: contact.chatId)
            }
            .onDisappear {
                if session.activeChatId == contact.chatId {
                    session.activeChatId = nil
                }
                typingDebounceTask?.cancel()
                draftSaveTask?.cancel()
                deleteDialogTask?.cancel()
                deleteDialogTask = nil
                editFocusTask?.cancel()
                editFocusTask = nil
                toastDismissTask?.cancel()
                toastDismissTask = nil
                flushDraftSave(force: true)
                partnerStopTypingTask?.cancel()
                if isRecording { cancelRecording() }
                SocketClient.shared.emit("stop_typing", ["chat_id": contact.chatId])
            }
            .onChange(of: composerText) { _, text in
                if !isApplyingDraftText {
                    scheduleDraftSave(text)
                }
                guard SocketClient.shared.state == .connected, !text.isEmpty else { return }
                typingDebounceTask?.cancel()
                typingDebounceTask = Task {
                    try? await Task.sleep(nanoseconds: 500_000_000)
                    guard !Task.isCancelled else { return }
                    SocketClient.shared.emit("typing", ["chat_id": contact.chatId, "typing_kind": "text"])
                }
            }
            .onChange(of: selectedPhotoItem) { _, item in
                guard let item else { return }
                Task { await handleSelectedPhoto(item) }
            }
            .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
                refreshPrivateKeyState()
            }
    }

    // MARK: - Native layout

    private var nativeChatLayout: some View {
        ZStack {
            Color.smBg2.ignoresSafeArea()
            if isLoading {
                ProgressView()
                    .tint(Color.smAccent)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let err = loadError {
                VStack(spacing: 14) {
                    Image(systemName: "exclamationmark.triangle")
                        .font(.system(size: 36)).foregroundStyle(Color.smAccent)
                    Text(err).font(.callout).foregroundStyle(Color.smMuted)
                        .multilineTextAlignment(.center)
                    Button("Повторить") { Task { await loadMessages() } }
                        .foregroundStyle(Color.smAccent)
                }
                .padding(32)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if messages.isEmpty {
                emptyHistoryView
            } else {
                messageScrollView
            }
        }
        .background(Color.smBg2)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            composerBar
        }
        .overlayPreferenceValue(BubbleAnchorKey.self) { anchors in
            if menuTargetId != nil {
                GeometryReader { geo in
                    contextMenuOverlay(anchors: anchors, geo: geo)
                }
                .ignoresSafeArea()
            }
        }
        .overlay(alignment: .top) { toastView }
    }

    private var deleteDialogBinding: Binding<Bool> {
        Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })
    }

    // MARK: - Transient toast

    @ViewBuilder
    private var toastView: some View {
        if let toast {
            Text(toast)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(Color.smText)
                .padding(.horizontal, 16)
                .padding(.vertical, 9)
                .background(Color.smSurface, in: Capsule())
                .overlay(Capsule().stroke(Color.smBorder, lineWidth: 0.5))
                .shadow(color: Color.black.opacity(0.14), radius: 10, x: 0, y: 4)
                .padding(.top, 8)
                .transition(.move(edge: .top).combined(with: .opacity))
        }
    }

    private func showToast(_ text: String) {
        toastDismissTask?.cancel()
        withAnimation(.spring(response: 0.32, dampingFraction: 0.8)) { toast = text }
        toastDismissTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            guard !Task.isCancelled, toast == text else { return }
            toastDismissTask = nil
            withAnimation(.easeOut(duration: 0.25)) { toast = nil }
        }
    }

    // MARK: - Context menu (long-press) overlay — reaction bar + actions

    @ViewBuilder
    private func contextMenuOverlay(anchors: [Int: Anchor<CGRect>], geo: GeometryProxy) -> some View {
        if let mid = menuTargetId,
           let msg = messages.first(where: { $0.id == mid }),
           let anchor = anchors[mid] {

            let rect = geo[anchor]
            let isFromMe = msg.senderUserId == myId
            let actions = menuActions(for: msg, isFromMe: isFromMe)

            // Layout geometry
            let topInset = geo.safeAreaInsets.top + 8
            let bottomInset = geo.size.height - geo.safeAreaInsets.bottom - 8
            let gap: CGFloat = 10
            let barH: CGFloat = 50
            let menuH = CGFloat(actions.count) * 44 + 10
            let menuW: CGFloat = 232
            let barW: CGFloat = CGFloat(reactionEmojis.count) * 44 + 20

            // Vertical positions (pre-shift): bar above bubble, menu below.
            let barCenterY = rect.minY - gap - barH / 2
            let bubbleCenterY = rect.midY
            let menuCenterY = rect.maxY + gap + menuH / 2

            // Shift the whole group so it fits between the insets.
            let groupTop = barCenterY - barH / 2
            let groupBottom = menuCenterY + menuH / 2
            let shift: CGFloat = {
                if groupTop < topInset { return topInset - groupTop }
                if groupBottom > bottomInset { return bottomInset - groupBottom }
                return 0
            }()

            // Horizontal anchoring to the bubble's side.
            let barX = clamp(isFromMe ? rect.maxX - barW / 2 : rect.minX + barW / 2,
                             min: barW / 2 + 8, max: geo.size.width - barW / 2 - 8)
            let menuX = clamp(isFromMe ? rect.maxX - menuW / 2 : rect.minX + menuW / 2,
                              min: menuW / 2 + 8, max: geo.size.width - menuW / 2 - 8)

            ZStack {
                // Dimmed, blurred backdrop
                Rectangle()
                    .fill(.ultraThinMaterial)
                    .opacity(0.96)
                    .ignoresSafeArea()
                    .overlay(Color.black.opacity(0.18).ignoresSafeArea())
                    .onTapGesture { dismissMenu() }

                // Floating copy of the pressed bubble (lifted above the dim)
                MessageBubbleView(
                    message: msg,
                    decryptedText: decryptedTexts[msg.id],
                    isFromMe: isFromMe,
                    showSender: !isFromMe && contact.isGroup,
                    isTail: true,
                    isPreview: true
                )
                .frame(width: rect.width)
                .position(x: rect.midX, y: bubbleCenterY + shift)

                // Reaction quick-bar
                reactionBar(messageId: mid, current: msg.reactions)
                    .frame(width: barW, height: barH)
                    .position(x: barX, y: barCenterY + shift)

                // Action menu
                actionMenu(actions)
                    .frame(width: menuW)
                    .position(x: menuX, y: menuCenterY + shift)
            }
            .transition(.opacity)
        }
    }

    private func clamp(_ v: CGFloat, min lo: CGFloat, max hi: CGFloat) -> CGFloat {
        guard hi > lo else { return v }
        return Swift.max(lo, Swift.min(hi, v))
    }

    private func reactionBar(messageId: Int, current: [MessageReaction]) -> some View {
        HStack(spacing: 2) {
            ForEach(reactionEmojis, id: \.self) { emoji in
                let active = current.contains { $0.emoji == emoji && $0.reactedByMe }
                Button(action: {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    toggleReaction(messageId: messageId, emoji: emoji)
                    dismissMenu()
                }) {
                    Text(emoji)
                        .font(.system(size: 27))
                        .frame(width: 42, height: 42)
                        .background(active ? Color.smAccent.opacity(0.22) : Color.clear, in: Circle())
                }
                .buttonStyle(PressableStyle())
            }
        }
        .padding(.horizontal, 8)
        .frame(height: 50)
        .background(Color.smSurface, in: Capsule())
        .overlay(Capsule().stroke(Color.smBorder, lineWidth: 0.5))
        .shadow(color: Color.black.opacity(0.18), radius: 16, x: 0, y: 6)
    }

    private struct MenuAction: Identifiable {
        let id = UUID()
        let label: String
        let icon: String
        let role: ButtonRole?
        let perform: () -> Void
    }

    private func menuActions(for msg: ChatMessage, isFromMe: Bool) -> [MenuAction] {
        var items: [MenuAction] = []
        let resolved = decryptedTexts[msg.id] ?? msg.message ?? ""
        let isMedia = ["photo", "video", "audio", "file"].contains(msg.messageType)
        let isCopyable = !isMedia && msg.messageType != "call" && !resolved.isEmpty
            && !resolved.hasPrefix("{") && !resolved.hasPrefix("[")

        if isCopyable {
            items.append(MenuAction(label: "Копировать", icon: "doc.on.doc", role: nil) {
                UIPasteboard.general.string = resolved
                dismissMenu()
                showToast("Скопировано")
            })
        }
        // Edit: own plain-text messages, within the server's 48h window.
        let withinEditWindow = (Date().timeIntervalSince1970 - msg.createdAt) < 48 * 3600
        if isFromMe && isCopyable && withinEditWindow {
            items.append(MenuAction(label: "Изменить", icon: "pencil", role: nil) {
                beginEdit(message: msg, currentText: resolved)
            })
        }
        items.append(MenuAction(label: "Удалить", icon: "trash", role: .destructive) {
            let isMine = isFromMe
            dismissMenu()
            deleteDialogTask?.cancel()
            deleteDialogTask = Task { @MainActor in
                try? await Task.sleep(nanoseconds: 180_000_000)
                guard !Task.isCancelled else { return }
                deleteDialogTask = nil
                pendingDelete = PendingDelete(id: msg.id, isFromMe: isMine)
            }
        })
        return items
    }

    private func actionMenu(_ actions: [MenuAction]) -> some View {
        VStack(spacing: 0) {
            ForEach(actions.indices, id: \.self) { index in
                menuActionRow(actions[index])
                if index < actions.count - 1 {
                    menuDivider
                }
            }
        }
        .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
        .shadow(color: Color.black.opacity(0.18), radius: 18, x: 0, y: 8)
        .clipShape(RoundedRectangle(cornerRadius: 14))
    }

    private func menuActionRow(_ action: MenuAction) -> some View {
        let foregroundColor = action.role == .destructive ? Color.smDanger : Color.smText

        return Button(action: action.perform) {
            HStack {
                Text(action.label)
                    .font(.system(size: 15.5))
                    .foregroundStyle(foregroundColor)
                Spacer()
                Image(systemName: action.icon)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(foregroundColor)
            }
            .padding(.horizontal, 16)
            .frame(height: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(MenuRowStyle())
    }

    private var menuDivider: some View {
        Rectangle().fill(Color.smBorderSoft).frame(height: 0.5)
    }

    private func presentMenu(for messageId: Int) {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        composerFocused = false
        withAnimation(.spring(response: 0.34, dampingFraction: 0.82)) {
            menuTargetId = messageId
        }
    }

    private func dismissMenu() {
        withAnimation(.easeOut(duration: 0.18)) { menuTargetId = nil }
    }

    private func toggleReaction(messageId: Int, emoji: String) {
        if SocketClient.shared.state != .connected {
            sendError = "Нет соединения — реакция будет отправлена после переподключения."
        }
        // Optimistic, animated local update so the reaction appears instantly.
        if let i = messages.firstIndex(where: { $0.id == messageId }) {
            withAnimation(.spring(response: 0.3, dampingFraction: 0.7)) {
                applyLocalReactionToggle(index: i, emoji: emoji)
            }
            let updated = messages[i]
            Task { await ChatLocalStore.shared.mergeMessages([updated], chatId: contact.chatId) }
        }
        SocketClient.shared.emit("toggle_reaction", [
            "chat_id": contact.chatId,
            "message_id": messageId,
            "emoji": emoji,
            "request_id": UUID().uuidString,
            "csrf_token": APIClient.shared.csrfToken,
        ])
    }

    /// Mutates the local reaction array for instant feedback; the authoritative
    /// state arrives via `message_reactions_updated`.
    private func applyLocalReactionToggle(index i: Int, emoji: String) {
        var reactions = messages[i].reactions
        if let r = reactions.firstIndex(where: { $0.emoji == emoji }) {
            if reactions[r].reactedByMe {
                reactions[r].count = max(0, reactions[r].count - 1)
                reactions[r].reactedByMe = false
                if reactions[r].count == 0 { reactions.remove(at: r) }
            } else {
                reactions[r].count += 1
                reactions[r].reactedByMe = true
            }
        } else {
            reactions.append(MessageReaction(emoji: emoji, count: 1, reactedByMe: true))
        }
        messages[i].reactions = reactions
    }

    private func parseReactions(_ raw: Any?) -> [MessageReaction] {
        guard let arr = raw as? [[String: Any]] else { return [] }
        return arr.compactMap { d in
            guard let emoji = d["emoji"] as? String, !emoji.isEmpty else { return nil }
            return MessageReaction(
                emoji: emoji,
                count: d["count"] as? Int ?? 0,
                reactedByMe: d["reacted_by_me"] as? Bool ?? false
            )
        }
    }

    // MARK: - Messages

    private var emptyHistoryView: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: contact.isGroup ? "person.2.fill" : "bubble.left.and.bubble.right")
                .font(.system(size: 42))
                .foregroundStyle(Color.smFaint)
            Text("Нет сообщений")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(Color.smMuted)
            Text(contact.isGroup ? "Группа создана. Начните общение." : "Напишите первое сообщение.")
                .font(.system(size: 13.5))
                .foregroundStyle(Color.smFaint)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 34)
            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var messageScrollView: some View {
        ChatMessageTimelineView(
            messages: messages,
            decryptedTexts: decryptedTexts,
            myId: myId,
            isGroup: contact.isGroup,
            hasOlderMessages: hasOlderMessages,
            isLoading: isLoading,
            isLoadingOlder: isLoadingOlder,
            partnerIsTyping: partnerIsTyping,
            menuTargetId: menuTargetId,
            scrollIntent: $scrollIntent,
            isPinnedToBottom: $isPinnedToBottom,
            onLoadOlder: { Task { await loadOlderMessages() } },
            onToggleReaction: { messageId, emoji in toggleReaction(messageId: messageId, emoji: emoji) },
            onRequestMenu: { messageId in presentMenu(for: messageId) }
        )
    }

    private func shouldAutoScroll(for msg: ChatMessage) -> Bool {
        msg.senderUserId == myId || isPinnedToBottom
    }

    // MARK: - Composer bar

    private var composerBar: some View {
        ChatComposerBar(
            sendError: $sendError,
            decryptionSummary: $decryptionSummary,
            composerText: $composerText,
            selectedPhotoItem: $selectedPhotoItem,
            composerFocused: $composerFocused,
            isComposerFocused: composerFocused,
            editingMessageId: editingMessageId,
            isSending: isSending,
            isUploadingMedia: isUploadingMedia,
            isRecording: isRecording,
            recordingDuration: recordingDuration,
            placeholder: composerPlaceholder,
            canSendSecureMessage: canSendSecureMessage,
            emojiSuggestions: composerEmojiSuggestions,
            formatRecordingTime: formatRecordingTime,
            onCancelEdit: cancelEdit,
            onSend: handleSend,
            onStartVoiceRecording: startVoiceRecording,
            onCancelRecording: cancelRecording,
            onStopAndSendRecording: stopAndSendRecording
        )
    }

    private var composerPlaceholder: String {
        if contact.isGroup { return "Групповые сообщения" }
        if !hasPrivateKey { return "Войдите для расшифровки ключа" }
        if contact.publicKey.isEmpty { return "Ключ получателя не найден" }
        return "Сообщение…"
    }

    private func refreshPrivateKeyState() {
        hasPrivateKeyLoaded = KeychainService.hasPrivateKey()
    }

    // MARK: - Toolbar

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .principal) {
            let current = liveContact
            ChatHeaderView(
                contact: current,
                statusText: statusText,
                isSavedMessages: isSavedMessages,
                isTyping: partnerIsTyping || current.isTyping,
                onOpenProfile: { showContactProfile = true }
            )
        }
        // Call buttons live in the contact profile (open via the avatar), not here.
    }

    // MARK: - Data loading

    private func loadMessages() async {
        isLoading = true; loadError = nil
        decryptedTexts = [:]
        decryptionSummary = nil
        let cached = await ChatLocalStore.shared.cachedMessages(chatId: contact.chatId)
            .map(normalizedMessage)
        if !cached.isEmpty {
            scrollIntent = .bottom(animated: false)
            messages = cached
            hasOlderMessages = cached.count >= 40
            isLoading = false
            await decryptMessages(cached)
        }
        do {
            await session.primeChatSync(chatId: contact.chatId)
            let fresh = try await APIClient.shared.getChatHistory(chatId: contact.chatId)
                .map(normalizedMessage)
            scrollIntent = .bottom(animated: false)
            messages = fresh
            hasOlderMessages = messages.count >= 40
            await ChatLocalStore.shared.mergeMessages(messages, chatId: contact.chatId)
            await markRead()
            await decryptMessages(messages)
            await session.recoverChatSync(chatId: contact.chatId)
        } catch {
            if messages.isEmpty {
                loadError = error.localizedDescription
            }
        }
        isLoading = false
    }

    private func markRead() async {
        let ids = messages.compactMap { $0.senderUserId != myId ? $0.id : nil }
        guard !ids.isEmpty else { return }
        try? await APIClient.shared.markMessagesRead(chatId: contact.chatId, messageIds: ids)
    }

    // MARK: - New message from SessionStore (gap-checked path)

    private func handlePreparedIncomingMessage(_ notification: Notification) {
        guard let chatId = notification.userInfo?[PreparedIncomingMessageKey.chatId] as? String,
              chatId == contact.chatId,
              let msg = notification.userInfo?[PreparedIncomingMessageKey.message] as? ChatMessage,
              !messages.contains(where: { $0.id == msg.id })
        else { return }
        let normalized = normalizedMessage(msg)
        scrollIntent = shouldAutoScroll(for: normalized) ? .bottom(animated: true) : .none
        messages.append(normalized)
        if msg.senderUserId != myId {
            Task { try? await APIClient.shared.markMessagesRead(chatId: contact.chatId, messageIds: [msg.id]) }
        }
        Task {
            await ChatLocalStore.shared.mergeMessages([normalized], chatId: contact.chatId)
            await decryptMessages([normalized])
        }
    }

    // MARK: - Socket event handler (secondary path for events SessionStore doesn't relay)

    private func handleSocketNotification(_ notification: Notification) {
        guard
            let event = notification.userInfo?[SocketEventKey.eventName] as? String,
            let payload = notification.userInfo?[SocketEventKey.data] as? [String: Any]
        else { return }

        if event == "error" {
            handleSocketError(payload)
            return
        }

        guard
            let chatId = payload["chat_id"] as? String,
            chatId == contact.chatId
        else { return }

        switch event {
        case "message_sent":
            // Our own sent message echoed back — deduplicate
            guard let msgId = payload["id"] as? Int else { return }
            if messages.contains(where: { $0.id == msgId }) { return }
            let msg = buildMessageFromPayload(payload, chatId: chatId)
            scrollIntent = shouldAutoScroll(for: msg) ? .bottom(animated: true) : .none
            messages.append(msg)
            Task {
                await ChatLocalStore.shared.mergeMessages([msg], chatId: contact.chatId)
                await decryptMessages([msg])
            }

        case "partner_typing":
            partnerIsTyping = true
            partnerStopTypingTask?.cancel()
            partnerStopTypingTask = Task {
                try? await Task.sleep(nanoseconds: 6_000_000_000)
                guard !Task.isCancelled else { return }
                await MainActor.run {
                    guard !Task.isCancelled else { return }
                    partnerIsTyping = false
                }
            }

        case "partner_stop_typing":
            partnerIsTyping = false
            partnerStopTypingTask?.cancel()

        case "messages_read":
            var changed: [ChatMessage] = []
            for i in messages.indices where messages[i].senderUserId == myId && !messages[i].isRead {
                messages[i].isRead = true
                changed.append(messages[i])
            }
            if !changed.isEmpty {
                Task { await ChatLocalStore.shared.mergeMessages(changed, chatId: contact.chatId) }
            }

        case "message_reactions_updated":
            guard let mid = payload["message_id"] as? Int,
                  let i = messages.firstIndex(where: { $0.id == mid })
            else { return }
            messages[i].reactions = parseReactions(payload["reactions"])
            let updated = messages[i]
            Task { await ChatLocalStore.shared.mergeMessages([updated], chatId: contact.chatId) }

        case "message_edited":
            guard let mid = payload["msg_id"] as? Int,
                  let i = messages.firstIndex(where: { $0.id == mid }),
                  let newContent = payload["new_content"] as? String
            else { return }
            messages[i].message = newContent
            messages[i].messageType = payload["message_type"] as? String ?? messages[i].messageType
            messages[i].isEdited = true
            decryptedTexts[mid] = nil
            let edited = messages[i]
            Task {
                await ChatLocalStore.shared.mergeMessages([edited], chatId: contact.chatId)
                await decryptMessages([edited])
            }

        case "messages_deleted":
            let ids = parseDeletedIds(payload)
            guard !ids.isEmpty else { return }
            scrollIntent = .none
            withAnimation(.easeInOut(duration: 0.22)) {
                messages.removeAll { ids.contains($0.id) }
            }
            Task { await ChatLocalStore.shared.deleteMessages(ids: ids, chatId: contact.chatId) }

        case "chat_draft_updated":
            applyRealtimeDraft(payload)

        default:
            break
        }
    }

    private func handleSocketError(_ payload: [String: Any]) {
        if let chatId = payload["chat_id"] as? String,
           !chatId.isEmpty,
           chatId != contact.chatId {
            return
        }
        let code = (payload["code"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if code == "duplicate_request" { return }

        let ignoredMessages = [
            "Message not found.",
            "Invalid reaction payload.",
            "Failed to update reaction.",
        ]
        let message = (payload["message"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !message.isEmpty, !ignoredMessages.contains(message) else { return }
        sendError = message
        if payload["request_id"] != nil {
            isSending = false
            isUploadingMedia = false
        }
    }

    private func parseDeletedIds(_ payload: [String: Any]) -> [Int] {
        if let arr = payload["msg_ids"] as? [Int] { return arr }
        if let arr = payload["msg_ids"] as? [Any] { return arr.compactMap { $0 as? Int } }
        if let single = payload["msg_id"] as? Int { return [single] }
        return []
    }

    private func buildMessageFromPayload(_ payload: [String: Any], chatId: String) -> ChatMessage {
        normalizedMessage(ChatMessage(
            id: payload["id"] as? Int ?? 0,
            chatId: chatId,
            message: payload["message"] as? String,
            messageType: payload["message_type"] as? String ?? "text",
            createdAt: SunDateParser.timestamp(fromAny: payload["created_at"]) ?? Date().timeIntervalSince1970,
            senderUserId: payload["sender_user_id"] as? Int,
            senderPublicKey: payload["sender_public_key"] as? String,
            senderDisplayName: payload["sender_display_name"] as? String,
            senderUsername: payload["sender_username"] as? String
        ))
    }

    // MARK: - 15-second fallback sync

    private func slowPollLoop() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 15_000_000_000)
            guard !Task.isCancelled else { return }
            await session.recoverChatSync(chatId: contact.chatId)
        }
    }

    private func loadOlderMessages() async {
        guard hasOlderMessages, !isLoadingOlder, let firstId = messages.first?.id else { return }
        isLoadingOlder = true
        do {
            let older = try await APIClient.shared.getChatHistory(chatId: contact.chatId, limit: 30, beforeId: firstId)
            if older.count < 30 { hasOlderMessages = false }
            if !older.isEmpty {
                let normalized = older.map(normalizedMessage)
                scrollIntent = .preserve(id: firstId)
                messages.insert(contentsOf: normalized, at: 0)
                await ChatLocalStore.shared.mergeMessages(normalized, chatId: contact.chatId)
                await decryptMessages(normalized)
            }
        } catch { }
        isLoadingOlder = false
    }

    // MARK: - Decryption

    private func decryptMessages(_ msgs: [ChatMessage]) async {
        guard let pem = KeychainService.loadPrivateKey() else {
            // Mark every encrypted message with a clear sentinel so the UI never
            // gets stuck on the default "🔐 Encrypted message" placeholder.
            await MainActor.run {
                for msg in msgs where msg.isEncrypted {
                    if decryptedTexts[msg.id] == nil {
                        decryptedTexts[msg.id] = "🔒 Введите 24 слова для расшифровки"
                    }
                }
                decryptionSummary = "Ключ не загружен. Войдите заново по секретной фразе."
            }
            return
        }
        var unresolvedCount = 0
        var v3Msgs: [ChatMessage] = []
        var decryptedUpdates: [Int: String] = [:]

        for msg in msgs where msg.isEncrypted {
            guard decryptedTexts[msg.id] == nil, let json = msg.message else { continue }
            if V3CryptoService.isV3Message(json) {
                v3Msgs.append(msg)
                continue
            }
            let text = SunCrypto.decryptMessageForDisplay(json, isSelf: msg.senderUserId == myId, privateKeyPEM: pem)
            let id = msg.id

            // ── Critical: ALWAYS populate decryptedTexts so the UI never shows the
            // default "🔐 Encrypted message" fallback.
            if text.isEmpty {
                // Decryption returned nothing — write an unambiguous placeholder.
                decryptedUpdates[id] = "[пустое сообщение]"
                unresolvedCount += 1
            } else if text == json {
                // Payload didn't match v2 schema and isn't v3. Common causes:
                // unknown envelope format, or unencrypted JSON (e.g. raw __sunfile)
                // that happens to start with `{`. Show the raw content if it parses
                // as a sunfile, otherwise mark as unrecognized.
                if let _ = parseLegacySunfileMarker(json) {
                    decryptedUpdates[id] = json
                } else {
                    decryptedUpdates[id] = "[неизвестный формат]"
                    unresolvedCount += 1
                }
            } else {
                if text.hasPrefix("[") { unresolvedCount += 1 }
                decryptedUpdates[id] = text
            }
        }

        if !decryptedUpdates.isEmpty {
            await MainActor.run {
                decryptedTexts.merge(decryptedUpdates) { _, new in new }
            }
        }

        if !v3Msgs.isEmpty {
            let chatId = contact.chatId
            let peerUserId = contact.userId
            let failed = await decryptV3Messages(v3Msgs, chatId: chatId, peerUserId: peerUserId)
            unresolvedCount += failed
        }

        if unresolvedCount > 0 {
            await MainActor.run { decryptionSummary = "\(unresolvedCount) сообщ. не удалось расшифровать." }
        } else {
            await MainActor.run { decryptionSummary = nil }
        }
    }

    /// Quick check: is this JSON a __sunfile envelope (regardless of encryption)?
    private func parseLegacySunfileMarker(_ text: String) -> Bool? {
        guard let data = text.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        if obj["__sunfile"] != nil { return true }
        if obj["url"] is String, obj["mime"] is String { return true }
        return nil
    }

    private func decryptV3Messages(_ msgs: [ChatMessage], chatId: String, peerUserId: Int?) async -> Int {
        let sessionJSON: String?
        do { sessionJSON = try await session.api.getDRSession(chatId: chatId) }
        catch { sessionJSON = nil }

        let iosIkPriv  = KeychainService.loadX25519PrivateKey()
        var failedCount = 0
        let sorted = msgs.sorted { $0.id < $1.id }
        var decryptedUpdates: [Int: String] = [:]

        if let sj = sessionJSON, var drState = try? V3CryptoService.parseDRState(sj) {
            var stateChanged = false
            var unhandled: [ChatMessage] = []

            for msg in sorted {
                guard decryptedTexts[msg.id] == nil,
                      decryptedUpdates[msg.id] == nil,
                      let json = msg.message else { continue }
                let proto = V3CryptoService.v3Proto(json)

                if proto == "dr" {
                    do {
                        let plaintext = try V3CryptoService.decryptDR(json: json, state: &drState)
                        stateChanged = true
                        let id = msg.id
                        decryptedUpdates[id] = plaintext
                    } catch {
                        unhandled.append(msg)
                    }
                } else {
                    unhandled.append(msg)
                }
            }

            if stateChanged, let puid = peerUserId,
               let newJSON = V3CryptoService.serializeDRState(drState) {
                try? await session.api.saveDRSession(chatId: chatId, peerUserId: puid, stateJSON: newJSON)
            }

            for msg in unhandled {
                guard let json = msg.message else { continue }
                let proto = V3CryptoService.v3Proto(json)
                if proto == "x3dh", let ikPriv = iosIkPriv {
                    if let spkId = x3dhSpkId(from: json),
                        let spkPriv = KeychainService.loadSignedPrekeyPrivateKey(id: spkId),
                        let plaintext = try? V3CryptoService.decryptX3DH(json: json, ikPrivRaw: ikPriv, spkPrivRaw: spkPriv) {
                        let id = msg.id
                        decryptedUpdates[id] = plaintext
                        continue
                    }
                }
                failedCount += 1
                let id = msg.id
                decryptedUpdates[id] = proto == "mls" ? "[групповое шифрование v3]" : "[зашифровано · откройте в браузере]"
            }
        } else {
            for msg in sorted {
                guard decryptedTexts[msg.id] == nil,
                      decryptedUpdates[msg.id] == nil,
                      let json = msg.message else { continue }
                let proto = V3CryptoService.v3Proto(json)
                if proto == "x3dh", let ikPriv = iosIkPriv {
                    if let spkId = x3dhSpkId(from: json),
                       let spkPriv = KeychainService.loadSignedPrekeyPrivateKey(id: spkId),
                       let plaintext = try? V3CryptoService.decryptX3DH(json: json, ikPrivRaw: ikPriv, spkPrivRaw: spkPriv) {
                        let id = msg.id
                        decryptedUpdates[id] = plaintext
                        continue
                    }
                }
                failedCount += 1
                let id = msg.id
                decryptedUpdates[id] = proto == "mls" ? "[групповое шифрование v3]" : "[зашифровано · откройте в браузере]"
            }
        }
        if !decryptedUpdates.isEmpty {
            await MainActor.run {
                decryptedTexts.merge(decryptedUpdates) { _, new in new }
            }
        }
        return failedCount
    }

    private func x3dhSpkId(from json: String) -> Int? {
        guard let data = json.data(using: .utf8),
              let obj  = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return obj["spk_id"] as? Int
    }

    private func normalizedMessage(_ msg: ChatMessage) -> ChatMessage {
        ChatMessage(
            id: msg.id,
            chatId: msg.chatId.isEmpty ? contact.chatId : msg.chatId,
            message: msg.message,
            messageType: msg.messageType,
            createdAt: msg.createdAt,
            senderUserId: msg.senderUserId,
            senderPublicKey: msg.senderPublicKey,
            senderDisplayName: msg.senderDisplayName,
            senderUsername: msg.senderUsername,
            isRead: msg.isRead,
            isDelivered: msg.isDelivered,
            reactions: msg.reactions,
            isEdited: msg.isEdited
        )
    }

    // MARK: - Chat drafts

    private func normalizeDraftText(_ value: String) -> String {
        value.replacingOccurrences(of: "\r\n", with: "\n")
    }

    private func hasMeaningfulDraft(_ value: String) -> Bool {
        !normalizeDraftText(value).trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func scheduleDraftSave(_ text: String) {
        guard editingMessageId == nil else { return }
        let normalized = normalizeDraftText(text)
        draftSaveTask?.cancel()
        draftSaveTask = Task {
            try? await Task.sleep(nanoseconds: 700_000_000)
            guard !Task.isCancelled else { return }
            await saveDraft(normalized)
        }
    }

    private func flushDraftSave(force: Bool = false) {
        guard editingMessageId == nil else { return }
        let normalized = normalizeDraftText(composerText)
        draftSaveTask?.cancel()
        draftSaveTask = nil
        Task { await saveDraft(normalized, force: force) }
    }

    private func clearDraftAfterSend() {
        draftSaveTask?.cancel()
        draftSaveTask = nil
        lastSavedDraftText = ""
        session.applyDraftUpdate(
            chatId: contact.chatId,
            draftText: "",
            updatedAtRaw: SunDateFormatters.isoInternetDateTime(from: Date()),
            hasDraft: false
        )
        Task { await saveDraft("", force: true) }
    }

    private func loadDraft() async {
        guard editingMessageId == nil else { return }
        let beforeLoadValue = normalizeDraftText(composerText)
        do {
            let response = try await session.api.getChatDraft(chatId: contact.chatId)
            let draftText = response.hasDraft ? decryptDraftForLocalDisplay(response.draftText) : ""
            guard normalizeDraftText(composerText) == beforeLoadValue || !composerFocused else { return }
            lastSavedDraftText = draftText
            lastDraftUpdatedAt = SunDateParser.timestamp(from: response.updatedAt) ?? lastDraftUpdatedAt
            session.applyDraftUpdate(
                chatId: contact.chatId,
                draftText: draftText,
                updatedAtRaw: response.updatedAt,
                hasDraft: response.hasDraft
            )
            applyDraftText(draftText)
        } catch {
            let fallback = liveContact.hasDraft ? decryptDraftForLocalDisplay(liveContact.draftText ?? "") : ""
            guard !fallback.isEmpty, normalizeDraftText(composerText) == beforeLoadValue || !composerFocused else { return }
            lastSavedDraftText = fallback
            applyDraftText(fallback)
        }
    }

    private func saveDraft(_ text: String, force: Bool = false) async {
        guard editingMessageId == nil else { return }
        let normalized = normalizeDraftText(text)
        let savedPlaintext = hasMeaningfulDraft(normalized) ? normalized : ""
        if !force && savedPlaintext == lastSavedDraftText { return }

        draftSaveSequence += 1
        let sequence = draftSaveSequence
        do {
            let encryptedDraft = try await encryptDraftForServer(normalized)
            guard sequence == draftSaveSequence else { return }
            let response = try await session.api.saveChatDraft(chatId: contact.chatId, draftText: encryptedDraft)
            guard sequence == draftSaveSequence else { return }
            let serverDraft = response.hasDraft ? decryptDraftForLocalDisplay(response.draftText) : ""
            lastSavedDraftText = serverDraft
            lastDraftUpdatedAt = SunDateParser.timestamp(from: response.updatedAt) ?? lastDraftUpdatedAt
            session.applyDraftUpdate(
                chatId: contact.chatId,
                draftText: serverDraft,
                updatedAtRaw: response.updatedAt,
                hasDraft: response.hasDraft
            )
        } catch {
            // Draft sync is best-effort; the composer text stays local and will retry on the next change.
        }
    }

    private func encryptDraftForServer(_ draftText: String) async throws -> String {
        let normalized = normalizeDraftText(draftText)
        guard hasMeaningfulDraft(normalized) else { return "" }
        guard let privateKey = KeychainService.loadPrivateKey(), !myPublicKey.isEmpty else {
            throw NSError(domain: "sunmsg.draft", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing encryption key."])
        }
        if contact.isGroup {
            let profile = try await session.api.getGroupInfo(chatId: contact.chatId)
            let memberKeys = profile.members.map { $0.publicKey }.filter { !$0.isEmpty }
            guard !memberKeys.isEmpty else {
                throw NSError(domain: "sunmsg.draft", code: 2, userInfo: [NSLocalizedDescriptionKey: "No group recipient keys."])
            }
            return try SunCrypto.encryptMessageForRecipients(
                normalized,
                recipientPEMs: memberKeys,
                senderPEM: myPublicKey,
                privateKeyPEM: privateKey
            )
        }
        guard !contact.publicKey.isEmpty else {
            throw NSError(domain: "sunmsg.draft", code: 3, userInfo: [NSLocalizedDescriptionKey: "Missing recipient key."])
        }
        return try SunCrypto.encryptMessage(
            normalized,
            receiverPEM: contact.publicKey,
            senderPEM: myPublicKey,
            privateKeyPEM: privateKey
        )
    }

    private func decryptDraftForLocalDisplay(_ rawDraft: String) -> String {
        let normalized = normalizeDraftText(rawDraft)
        guard !normalized.isEmpty else { return "" }
        guard normalized.hasPrefix("{") else { return normalized }
        guard let privateKey = KeychainService.loadPrivateKey() else { return "" }
        let decrypted = SunCrypto.decryptMessageForDisplay(normalized, isSelf: true, privateKeyPEM: privateKey)
        guard decrypted != "__v3__", !decrypted.hasPrefix("[") else { return "" }
        return normalizeDraftText(decrypted)
    }

    private func applyRealtimeDraft(_ payload: [String: Any]) {
        let hasDraft = (payload["has_draft"] as? Bool) ?? false
        let rawDraft = (payload["draft_text"] as? String) ?? ""
        let updatedAt = (payload["updated_at"] as? String) ?? ""
        let draftText = hasDraft ? decryptDraftForLocalDisplay(rawDraft) : ""
        guard shouldApplyDraftUpdate(updatedAt: updatedAt, draftText: draftText) else { return }

        let previousSavedDraftText = lastSavedDraftText
        lastSavedDraftText = draftText
        lastDraftUpdatedAt = SunDateParser.timestamp(from: updatedAt) ?? lastDraftUpdatedAt
        session.applyDraftUpdate(
            chatId: contact.chatId,
            draftText: draftText,
            updatedAtRaw: updatedAt,
            hasDraft: hasDraft
        )

        let currentValue = normalizeDraftText(composerText)
        if composerFocused && currentValue != previousSavedDraftText { return }
        applyDraftText(draftText)
    }

    private func shouldApplyDraftUpdate(updatedAt: String, draftText: String) -> Bool {
        guard let nextTimestamp = SunDateParser.timestamp(from: updatedAt), nextTimestamp > 0 else {
            return true
        }
        if nextTimestamp > lastDraftUpdatedAt { return true }
        if nextTimestamp < lastDraftUpdatedAt { return false }
        return normalizeDraftText(draftText) == lastSavedDraftText
    }

    private func applyDraftText(_ text: String) {
        isApplyingDraftText = true
        composerText = normalizeDraftText(text)
        isApplyingDraftText = false
    }

    // MARK: - Edit & delete

    private func beginEdit(message: ChatMessage, currentText: String) {
        dismissMenu()
        editFocusTask?.cancel()
        withAnimation(.spring(response: 0.32, dampingFraction: 0.82)) {
            editingMessageId = message.id
            composerText = currentText
        }
        editFocusTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 200_000_000)
            guard !Task.isCancelled else { return }
            editFocusTask = nil
            composerFocused = true
        }
    }

    private func cancelEdit() {
        editFocusTask?.cancel()
        editFocusTask = nil
        editingMessageId = nil
        composerText = ""
        composerFocused = false
    }

    private func saveEdit() {
        guard let mid = editingMessageId else { return }
        let text = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        guard let privateKey = KeychainService.loadPrivateKey(),
              !contact.publicKey.isEmpty, !myPublicKey.isEmpty else {
            sendError = "Ключ шифрования не загружен."
            return
        }
        if SocketClient.shared.state != .connected {
            sendError = "Нет соединения — изменение будет отправлено после переподключения."
        }
        do {
            let encrypted = try SunCrypto.encryptMessage(
                text, receiverPEM: contact.publicKey,
                senderPEM: myPublicKey, privateKeyPEM: privateKey
            )
            SocketClient.shared.emit("edit_message", [
                "msg_id": mid,
                "new_content": encrypted,
                "chat_id": contact.chatId,
                "message_type": "text",
                "request_id": UUID().uuidString,
            ])
            // Optimistic local update.
            if let i = messages.firstIndex(where: { $0.id == mid }) {
                messages[i].message = encrypted
                messages[i].isEdited = true
                decryptedTexts[mid] = text
                let updated = messages[i]
                Task { await ChatLocalStore.shared.mergeMessages([updated], chatId: contact.chatId) }
            }
        } catch {
            sendError = error.localizedDescription
            return
        }
        cancelEdit()
    }

    private func deleteMessage(id: Int, mode: String) {
        if SocketClient.shared.state != .connected {
            sendError = "Нет соединения — удаление будет отправлено после переподключения."
        }
        SocketClient.shared.emit("delete_messages", [
            "msg_ids": [id],
            "chat_id": contact.chatId,
            "mode": mode,
            "request_id": UUID().uuidString,
        ])
        // Optimistic local removal.
        scrollIntent = .none
        withAnimation(.easeInOut(duration: 0.22)) {
            messages.removeAll { $0.id == id }
        }
        Task { await ChatLocalStore.shared.deleteMessages(ids: [id], chatId: contact.chatId) }
        pendingDelete = nil
    }

    // MARK: - Send text message

    private func handleSend() {
        if editingMessageId != nil { saveEdit(); return }
        let text = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending else { return }
        if contact.isGroup {
            sendGroupText(text)
            return
        }
        guard let privateKey = KeychainService.loadPrivateKey(), !contact.publicKey.isEmpty, !myPublicKey.isEmpty else {
            sendError = "Ключ шифрования не загружен. Войдите заново по секретной фразе."
            return
        }

        isSending = true
        let requestId = UUID().uuidString
        composerText = ""
        clearDraftAfterSend()
        typingDebounceTask?.cancel()
        SocketClient.shared.emit("stop_typing", ["chat_id": contact.chatId])

        Task {
            do {
                let encrypted = try SunCrypto.encryptMessage(
                    text,
                    receiverPEM: contact.publicKey,
                    senderPEM: myPublicKey,
                    privateKeyPEM: privateKey
                )
                let sent = try await APIClient.shared.sendMessage(
                    chatId: contact.chatId,
                    message: encrypted,
                    requestId: requestId
                )
                await MainActor.run {
                    let normalized = normalizedMessage(sent)
                    if !messages.contains(where: { $0.id == sent.id }) {
                        scrollIntent = .bottom(animated: true)
                        messages.append(normalized)
                    }
                    decryptedTexts[sent.id] = text
                    sendError = nil
                    isSending = false
                    Task { await ChatLocalStore.shared.mergeMessages([normalized], chatId: contact.chatId) }
                }
            } catch {
                await MainActor.run {
                    composerText = text
                    sendError = error.localizedDescription
                    isSending = false
                }
            }
        }
    }

    private func sendGroupText(_ text: String) {
        guard let privateKey = KeychainService.loadPrivateKey(), !myPublicKey.isEmpty else {
            sendError = "Ключ шифрования не загружен. Войдите заново по секретной фразе."
            return
        }

        isSending = true
        let requestId = UUID().uuidString
        composerText = ""
        clearDraftAfterSend()
        typingDebounceTask?.cancel()
        SocketClient.shared.emit("stop_typing", ["chat_id": contact.chatId])

        Task {
            do {
                try await emitEncryptedGroupPayload(
                    text,
                    messageType: "text",
                    requestId: requestId,
                    privateKey: privateKey,
                    mentionedUsernames: mentionedUsernames(in: text)
                )
                await MainActor.run { isSending = false }
            } catch {
                await MainActor.run {
                    composerText = text
                    sendError = error.localizedDescription
                    isSending = false
                }
            }
        }
    }

    private func emitEncryptedGroupPayload(
        _ plaintext: String,
        messageType: String,
        requestId: String,
        privateKey: String,
        mentionedUsernames: [String] = []
    ) async throws {
        let profile = try await session.api.getGroupInfo(chatId: contact.chatId)
        let memberKeys = profile.members.map { $0.publicKey }.filter { !$0.isEmpty }
        guard !memberKeys.isEmpty else {
            throw NSError(domain: "sunmsg.group", code: 0, userInfo: [NSLocalizedDescriptionKey: "Не найдены ключи участников группы."])
        }
        let encrypted = try SunCrypto.encryptMessageForRecipients(
            plaintext,
            recipientPEMs: memberKeys,
            senderPEM: myPublicKey,
            privateKeyPEM: privateKey
        )
        let payload: [String: Any] = [
            "message": encrypted,
            "chat_id": contact.chatId,
            "message_type": messageType,
            "client_id": requestId,
            "request_id": requestId,
            "mentioned_usernames": mentionedUsernames,
        ]
        await MainActor.run {
            if SocketClient.shared.state != .connected {
                sendError = "Нет соединения — сообщение будет отправлено после переподключения."
            } else {
                sendError = nil
            }
            SocketClient.shared.emit("send_message", payload)
        }
    }

    private func mentionedUsernames(in text: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: #"(^|[\s([{])@([A-Za-z0-9_.-]{1,64})"#) else {
            return []
        }
        let nsText = text as NSString
        let range = NSRange(location: 0, length: nsText.length)
        var result: [String] = []
        var seen = Set<String>()
        regex.enumerateMatches(in: text, range: range) { match, _, _ in
            guard let match, match.numberOfRanges > 2 else { return }
            let username = nsText.substring(with: match.range(at: 2)).lowercased()
            guard !seen.contains(username) else { return }
            seen.insert(username)
            result.append(username)
        }
        return result
    }

    // MARK: - Voice recording

    private func startVoiceRecording() {
        // AVAudioApplication.requestRecordPermission is the iOS 17+ API.
        AVAudioApplication.requestRecordPermission { granted in
            DispatchQueue.main.async {
                guard granted else {
                    self.sendError = "Нет доступа к микрофону. Разрешите в Настройках."
                    return
                }
                self.beginRecording()
            }
        }
    }

    private func beginRecording() {
        let tmpURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("voice_\(UUID().uuidString)")
            .appendingPathExtension("m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64000,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        do {
            try AVAudioSession.sharedInstance().setCategory(.record, mode: .default)
            try AVAudioSession.sharedInstance().setActive(true)
            let recorder = try AVAudioRecorder(url: tmpURL, settings: settings)
            recorder.record()
            audioRecorder = recorder
            recordingURL = tmpURL
            recordingDuration = 0
            isRecording = true
            recordingTimerTask?.cancel()
            recordingTimerTask = Task { @MainActor in
                while isRecording && !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                    if isRecording && !Task.isCancelled { recordingDuration += 1 }
                }
            }
        } catch {
            sendError = "Не удалось начать запись."
        }
    }

    private func stopAndSendRecording() {
        audioRecorder?.stop()
        audioRecorder = nil
        isRecording = false
        recordingTimerTask?.cancel()
        recordingTimerTask = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        guard let url = recordingURL else { return }
        recordingURL = nil
        Task { await sendAudioMessage(url: url) }
    }

    private func cancelRecording() {
        audioRecorder?.stop()
        audioRecorder = nil
        isRecording = false
        recordingTimerTask?.cancel()
        recordingTimerTask = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if let url = recordingURL {
            try? FileManager.default.removeItem(at: url)
        }
        recordingURL = nil
    }

    private func sendAudioMessage(url: URL) async {
        guard let privateKey = KeychainService.loadPrivateKey(),
              !myPublicKey.isEmpty,
              (contact.isGroup || !contact.publicKey.isEmpty) else {
            sendError = "Ключ шифрования не загружен."
            try? FileManager.default.removeItem(at: url)
            return
        }
        defer { try? FileManager.default.removeItem(at: url) }

        isUploadingMedia = true
        sendError = nil

        do {
            let data = try await Task.detached(priority: .userInitiated) {
                try Data(contentsOf: url)
            }.value
            let uploadResult = try await APIClient.shared.uploadMedia(
                data: data,
                mimeType: "audio/mp4",
                chatId: contact.chatId
            )

            let sunfilePayload: [String: Any] = [
                "__sunfile": true,
                "url": uploadResult.url,
                "mime": uploadResult.mime,
                "name": uploadResult.name,
                "size": uploadResult.size,
                "media_type": "audio",
            ]
            let sunfileJSON = String(data: try JSONSerialization.data(withJSONObject: sunfilePayload), encoding: .utf8) ?? ""

            if contact.isGroup {
                try await emitEncryptedGroupPayload(
                    sunfileJSON,
                    messageType: "audio",
                    requestId: UUID().uuidString,
                    privateKey: privateKey
                )
                await MainActor.run {
                    isUploadingMedia = false
                }
                return
            }

            let encrypted = try SunCrypto.encryptMessage(
                sunfileJSON,
                receiverPEM: contact.publicKey,
                senderPEM: myPublicKey,
                privateKeyPEM: privateKey
            )

            let sent = try await APIClient.shared.sendMessage(
                chatId: contact.chatId,
                message: encrypted,
                messageType: "audio",
                requestId: UUID().uuidString
            )

            await MainActor.run {
                let normalized = normalizedMessage(sent)
                if !messages.contains(where: { $0.id == sent.id }) {
                    scrollIntent = .bottom(animated: true)
                    messages.append(normalized)
                }
                decryptedTexts[sent.id] = sunfileJSON
                isUploadingMedia = false
                Task { await ChatLocalStore.shared.mergeMessages([normalized], chatId: contact.chatId) }
            }
        } catch {
            await MainActor.run {
                sendError = error.localizedDescription
                isUploadingMedia = false
            }
        }
    }

    private func formatRecordingTime(_ t: TimeInterval) -> String {
        let m = Int(t) / 60
        let s = Int(t) % 60
        return String(format: "%d:%02d", m, s)
    }

    // MARK: - Send media message

    private func handleSelectedPhoto(_ item: PhotosPickerItem) async {
        guard let privateKey = KeychainService.loadPrivateKey(),
              !myPublicKey.isEmpty,
              (contact.isGroup || !contact.publicKey.isEmpty) else {
            sendError = "Ключ шифрования не загружен."
            selectedPhotoItem = nil
            return
        }

        isUploadingMedia = true
        sendError = nil
        selectedPhotoItem = nil

        do {
            // Load image data — convert to JPEG so the server always gets a known format
            // (raw PhotosPickerItem data may be HEIC which some server-side validators reject)
            guard let rawData = try await item.loadTransferable(type: Data.self) else {
                throw NSError(domain: "media", code: 0, userInfo: [NSLocalizedDescriptionKey: "Не удалось загрузить изображение"])
            }
            let prepared = preparePhotoUpload(rawData)
            let uploadData = prepared.data
            let uploadMime = prepared.mime

            // Upload to server
            let uploadResult = try await APIClient.shared.uploadMedia(
                data: uploadData,
                mimeType: uploadMime,
                chatId: contact.chatId
            )

            // Build encrypted sunfile payload
            let sunfilePayload: [String: Any] = [
                "__sunfile": true,
                "url": uploadResult.url,
                "mime": uploadResult.mime,
                "name": uploadResult.name,
                "size": uploadResult.size,
                "media_type": uploadResult.mediaType,
            ]
            let sunfileJSON = String(data: try JSONSerialization.data(withJSONObject: sunfilePayload), encoding: .utf8) ?? ""

            if contact.isGroup {
                try await emitEncryptedGroupPayload(
                    sunfileJSON,
                    messageType: "photo",
                    requestId: UUID().uuidString,
                    privateKey: privateKey
                )
                await MainActor.run {
                    isUploadingMedia = false
                }
                return
            }

            // Encrypt the sunfile JSON like a regular message
            let encrypted = try SunCrypto.encryptMessage(
                sunfileJSON,
                receiverPEM: contact.publicKey,
                senderPEM: myPublicKey,
                privateKeyPEM: privateKey
            )

            let requestId = UUID().uuidString
            let sent = try await APIClient.shared.sendMessage(
                chatId: contact.chatId,
                message: encrypted,
                messageType: "photo",
                requestId: requestId
            )

            await MainActor.run {
                let normalized = normalizedMessage(sent)
                if !messages.contains(where: { $0.id == sent.id }) {
                    scrollIntent = .bottom(animated: true)
                    messages.append(normalized)
                }
                // Store the decrypted sunfile JSON so the bubble renders it
                decryptedTexts[sent.id] = sunfileJSON
                isUploadingMedia = false
                Task { await ChatLocalStore.shared.mergeMessages([normalized], chatId: contact.chatId) }
            }
        } catch {
            await MainActor.run {
                sendError = error.localizedDescription
                isUploadingMedia = false
            }
        }
    }

    private func preparePhotoUpload(_ rawData: Data) -> (data: Data, mime: String) {
        let maxPixelSize = 2048
        guard let source = CGImageSourceCreateWithData(rawData as CFData, nil) else {
            return (rawData, "image/jpeg")
        }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        ]
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
              let jpeg = UIImage(cgImage: cgImage).jpegData(compressionQuality: 0.82)
        else {
            return (rawData, "image/jpeg")
        }
        return (jpeg, "image/jpeg")
    }
}

// MARK: - Message bubble

struct MessageBubbleView: View {
    let message: ChatMessage
    var decryptedText: String? = nil
    let isFromMe: Bool
    let showSender: Bool
    let isTail: Bool
    let maxBubbleWidth: CGFloat
    /// When true, this is a lifted copy shown inside the context-menu overlay:
    /// it neither publishes its anchor nor reacts to long-press.
    var isPreview: Bool = false
    var onToggleReaction: (String) -> Void = { _ in }
    var onRequestMenu: () -> Void = { }
    private let resolvedBodyText: String
    private let parsedSunfile: SunfileInfo?
    private let parsedCallInfo: SunCallInfo?
    private let resolvedMediaType: String?

    init(
        message: ChatMessage,
        decryptedText: String? = nil,
        isFromMe: Bool,
        showSender: Bool,
        isTail: Bool,
        maxBubbleWidth: CGFloat = 306,
        isPreview: Bool = false,
        onToggleReaction: @escaping (String) -> Void = { _ in },
        onRequestMenu: @escaping () -> Void = { }
    ) {
        self.message = message
        self.decryptedText = decryptedText
        self.isFromMe = isFromMe
        self.showSender = showSender
        self.isTail = isTail
        self.maxBubbleWidth = maxBubbleWidth
        self.isPreview = isPreview
        self.onToggleReaction = onToggleReaction
        self.onRequestMenu = onRequestMenu

        let resolved = Self.resolveBodyText(message: message, decryptedText: decryptedText)
        self.resolvedBodyText = resolved.text
        self.parsedSunfile = resolved.sunfile
        self.parsedCallInfo = message.messageType == "call"
            ? Self.parseSunCallRaw(message.message ?? "")
            : nil
        self.resolvedMediaType = Self.resolveMediaType(
            messageType: message.messageType,
            sunfile: resolved.sunfile
        )
    }

    /// Resolved display text. Three fallback layers:
    /// 1. Decrypted text from the chat view's decryption cache (preferred).
    /// 2. Raw message body if it parses as an unencrypted __sunfile envelope —
    ///    means it's a media message that was never wrapped in v2/v3 crypto.
    /// 3. `message.displayText` which yields "🔐 Encrypted message" for encrypted
    ///    payloads or the plain text body otherwise.
    private var bodyText: String {
        resolvedBodyText
    }

    /// Effective media type: prefer server-provided `messageType`, otherwise infer from
    /// `__sunfile` JSON payload (handles legacy/cross-client messages where the server
    /// sent `message_type: "text"` but the body contains a sunfile envelope).
    private var effectiveMediaType: String? {
        resolvedMediaType
    }

    private var isMediaMessage: Bool { effectiveMediaType != nil }
    /// A plain text/link bubble — reactions render inside it (Telegram-style).
    private var isTextBubble: Bool { message.messageType != "call" && !isMediaMessage }
    private var bubbleAlignment: Alignment { isFromMe ? .trailing : .leading }
    private var stackAlignment: HorizontalAlignment { isFromMe ? .trailing : .leading }

    var body: some View {
        HStack(alignment: .bottom, spacing: 0) {
            if isFromMe { Spacer(minLength: 46) }

            VStack(alignment: stackAlignment, spacing: 3) {
                if showSender, let name = message.senderDisplayName, !name.isEmpty {
                    Text(name)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(senderColor(name))
                        .padding(.leading, 4)
                }

                if isTextBubble {
                    textBubble
                        .contentShape(Rectangle())
                        .onLongPressGesture(minimumDuration: 0.3) { if !isPreview { onRequestMenu() } }
                } else {
                    VStack(alignment: stackAlignment, spacing: 2) {
                        if message.messageType == "call" {
                            callContent
                        } else {
                            mediaContent
                        }
                        if isTail { timeRow }
                    }
                    .contentShape(Rectangle())
                    .onLongPressGesture(minimumDuration: 0.3) { if !isPreview { onRequestMenu() } }

                    if !message.reactions.isEmpty {
                        reactionChips
                    }
                }
            }
            .frame(maxWidth: maxBubbleWidth, alignment: bubbleAlignment)

            if !isFromMe { Spacer(minLength: 46) }
        }
        .padding(.vertical, isTail ? 3 : 1.5)
        .anchorPreference(key: BubbleAnchorKey.self, value: .bounds) {
            isPreview ? [:] : [message.id: $0]
        }
    }

    // MARK: - Time / read-receipt row

    private var timeRow: some View {
        HStack(spacing: 3) {
            if message.isEdited {
                Text("изменено")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(Color.smFaint)
                    .italic()
            }
            Text(formatBubbleTime(message.createdAt))
                .font(.system(size: 10.5, weight: .medium))
                .foregroundStyle(Color.smFaint)
                .fontDesign(.monospaced)
            if isFromMe {
                Image(systemName: deliveryIconName)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(message.isRead ? Color.smAccent : Color.smFaint)
            }
        }
        .padding(.horizontal, 4)
    }

    // MARK: - Text bubble (reactions + time live INSIDE the bubble)

    private var textBubble: some View {
        VStack(alignment: stackAlignment, spacing: 5) {
            if message.reactions.isEmpty {
                textAndInlineMeta
            } else {
                messageText
                inlineReactions
                inlineTimeRow
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 7)
        .padding(.bottom, 7)
        .background(isFromMe ? Color.smBubbleOut : Color.smBubbleIn)
        .clipShape(BubbleShape(isFromMe: isFromMe, isTail: isTail))
        .overlay(
            BubbleShape(isFromMe: isFromMe, isTail: isTail)
                .stroke(isFromMe ? Color.clear : Color.smBorderSoft, lineWidth: 0.5)
        )
        .shadow(
            color: Color(hex: isFromMe ? "#000000" : "#281e0f").opacity(isFromMe ? 0.14 : 0.04),
            radius: 1, x: 0, y: 1
        )
    }

    @ViewBuilder
    private var textAndInlineMeta: some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .lastTextBaseline, spacing: 6) {
                messageText
                    .layoutPriority(1)
                inlineTimeRow
            }

            VStack(alignment: stackAlignment, spacing: 4) {
                messageText
                inlineTimeRow
            }
        }
    }

    private var messageText: some View {
        Text(bodyText)
            .font(.system(size: 15))
            .foregroundStyle(isFromMe ? Color.smBubbleOutText : Color.smBubbleInText)
            .lineSpacing(1.5)
            .fixedSize(horizontal: false, vertical: true)
    }

    /// Time + edited + read tick, tinted for the bubble's own background.
    private var inlineTimeRow: some View {
        HStack(spacing: 3) {
            if message.isEdited {
                Text("изменено")
                    .font(.system(size: 10, weight: .medium))
                    .italic()
                    .foregroundStyle((isFromMe ? Color.smBubbleOutText : Color.smFaint).opacity(isFromMe ? 0.55 : 1))
            }
            Text(formatBubbleTime(message.createdAt))
                .font(.system(size: 10.5, weight: .medium))
                .fontDesign(.monospaced)
                .foregroundStyle(isFromMe ? Color.smBubbleOutText.opacity(0.6) : Color.smFaint)
            if isFromMe {
                Image(systemName: deliveryIconName)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(message.isRead ? Color.smBubbleOutText.opacity(0.95) : Color.smBubbleOutText.opacity(0.55))
            }
        }
        .fixedSize(horizontal: true, vertical: false)
    }

    // MARK: - Inline reactions (inside the bubble)

    private var inlineReactions: some View {
        ViewThatFits(in: .horizontal) {
            reactionRow(onBubble: true)
            reactionGrid(onBubble: true)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    /// Reaction chips for media/call bubbles (rendered just under the bubble).
    private var reactionChips: some View {
        ViewThatFits(in: .horizontal) {
            reactionRow(onBubble: false)
            reactionGrid(onBubble: false)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(isFromMe ? .trailing : .leading, 4)
    }

    private func reactionRow(onBubble: Bool) -> some View {
        HStack(spacing: 4) {
            ForEach(message.reactions) { r in
                reactionPill(r, onBubble: onBubble)
            }
        }
    }

    private func reactionGrid(onBubble: Bool) -> some View {
        LazyVGrid(
            columns: [GridItem(.adaptive(minimum: 42, maximum: 80), spacing: 4)],
            alignment: stackAlignment,
            spacing: 4
        ) {
            ForEach(message.reactions) { r in
                reactionPill(r, onBubble: onBubble)
            }
        }
    }

    private func reactionPill(_ r: MessageReaction, onBubble: Bool) -> some View {
        // On the out-bubble (dark) background, use a lighter translucent fill.
        let bg: Color = onBubble && isFromMe
            ? (r.reactedByMe ? Color.white.opacity(0.28) : Color.white.opacity(0.14))
            : (r.reactedByMe ? Color.smAccent.opacity(0.18) : Color.smSurface)
        let stroke: Color = onBubble && isFromMe
            ? Color.white.opacity(0.18)
            : (r.reactedByMe ? Color.smAccent.opacity(0.55) : Color.smBorderSoft)
        let countColor: Color = onBubble && isFromMe
            ? Color.smBubbleOutText.opacity(0.9)
            : (r.reactedByMe ? Color.smAccent2 : Color.smMuted)

        return Button(action: {
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            onToggleReaction(r.emoji)
        }) {
            HStack(spacing: 3) {
                Text(r.emoji).font(.system(size: 12.5))
                if r.count > 1 {
                    Text("\(r.count)")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(countColor)
                }
            }
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(bg, in: Capsule())
            .overlay(Capsule().stroke(stroke, lineWidth: 0.5))
        }
        .buttonStyle(PressableStyle())
        .fixedSize()
    }

    private var deliveryIconName: String {
        if message.isRead { return "checkmark.circle.fill" }
        if message.isDelivered { return "checkmark.circle" }
        return "clock"
    }

    // MARK: - Call bubble content

    private struct SunCallInfo {
        let callType: String
        let status: String
        let durationSec: Int?
    }

    private static func parseSunCallRaw(_ text: String) -> SunCallInfo? {
        guard let data = text.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              obj["__suncall"] != nil
        else { return nil }
        return SunCallInfo(
            callType: obj["call_type"] as? String ?? "audio",
            status: obj["status"] as? String ?? "",
            durationSec: obj["duration_sec"] as? Int
        )
    }

    @ViewBuilder
    private var callContent: some View {
        if let call = parsedCallInfo {
            CallBubbleView(
                callType: call.callType,
                status: call.status,
                durationSec: call.durationSec,
                isFromMe: isFromMe,
                isTail: isTail
            )
        } else {
            textContent
        }
    }

    // MARK: - Text bubble content

    private var textContent: some View {
        Text(bodyText)
            .font(.system(size: 14.5))
            .foregroundStyle(isFromMe ? Color.smBubbleOutText : Color.smBubbleInText)
            .lineSpacing(1)
            .tracking(-0.15)
            .padding(.horizontal, 12)
            .padding(.top, 7)
            .padding(.bottom, 8)
            .background(isFromMe ? Color.smBubbleOut : Color.smBubbleIn)
            .clipShape(BubbleShape(isFromMe: isFromMe, isTail: isTail))
            .overlay(
                BubbleShape(isFromMe: isFromMe, isTail: isTail)
                    .stroke(isFromMe ? Color.clear : Color.smBorderSoft, lineWidth: 0.5)
            )
            .shadow(
                color: Color(hex: isFromMe ? "#000000" : "#281e0f").opacity(isFromMe ? 0.14 : 0.04),
                radius: 1, x: 0, y: 1
            )
    }

    // MARK: - Media bubble content

    @ViewBuilder
    private var mediaContent: some View {
        if let sunfile = parsedSunfile {
            switch resolvedMediaType ?? "file" {
            case "photo":
                PhotoBubbleView(url: sunfile.fullURL, isFromMe: isFromMe, isTail: isTail)
            case "video":
                VideoBubbleView(url: sunfile.fullURL, isFromMe: isFromMe, isTail: isTail)
            case "audio":
                AudioBubbleView(url: sunfile.fullURL, name: sunfile.name, isFromMe: isFromMe, isTail: isTail)
            case "file":
                FileBubbleView(url: sunfile.fullURL, name: sunfile.name, size: sunfile.size, isFromMe: isFromMe, isTail: isTail)
            default:
                textContent
            }
        } else {
            textContent
        }
    }

    private struct SunfileInfo {
        let fullURL: URL?
        let name: String
        let size: Int
        let mime: String
        let mediaType: String?
    }

    private static func resolveBodyText(message: ChatMessage, decryptedText: String?) -> (text: String, sunfile: SunfileInfo?) {
        if let text = decryptedText, !text.isEmpty {
            return (text, parseSunfileRaw(text))
        }
        if let raw = message.message,
           raw.hasPrefix("{"),
           let sunfile = parseSunfileRaw(raw) {
            return (raw, sunfile)
        }
        return (message.displayText, nil)
    }

    private static func resolveMediaType(messageType: String, sunfile: SunfileInfo?) -> String? {
        if ["photo", "video", "audio", "file"].contains(messageType) {
            return sunfile == nil ? nil : messageType
        }
        guard let sunfile else { return nil }
        let mime = sunfile.mime.lowercased()
        if mime.hasPrefix("image/") { return "photo" }
        if mime.hasPrefix("video/") { return "video" }
        if mime.hasPrefix("audio/") { return "audio" }
        if let mediaType = sunfile.mediaType,
           ["photo", "video", "audio", "file"].contains(mediaType) {
            return mediaType
        }
        return "file"
    }

    /// Robust __sunfile JSON parser. Accepts both wrapped (`{"__sunfile": true, ...}`)
    /// and direct payload formats; resolves relative URLs against `kBaseURL`.
    private static func parseSunfileRaw(_ text: String) -> SunfileInfo? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("{"),
              let data = trimmed.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        // Must be a sunfile envelope (either flag set, or has url+mime)
        let hasFlag = obj["__sunfile"] != nil
        // "url" is used by iOS-sent sunfiles; "data" is used by web-sent sunfiles
        // (chat-file-send.js stores the upload URL in the "data" field, possibly
        //  with a #sun_media_e2ee fragment if the file is client-side encrypted).
        let urlStr = (obj["url"] as? String)
            ?? (obj["file_url"] as? String)
            ?? (obj["src"] as? String)
            ?? (obj["data"] as? String)
            ?? ""
        let mime = (obj["mime"] as? String) ?? (obj["mime_type"] as? String) ?? ""
        guard hasFlag || (!urlStr.isEmpty && !mime.isEmpty) else { return nil }

        let fullURL: URL?
        if urlStr.hasPrefix("http://") || urlStr.hasPrefix("https://") {
            fullURL = URL(string: urlStr)
        } else if urlStr.hasPrefix("/") {
            fullURL = URL(string: "\(kBaseURL)\(urlStr)")
        } else if !urlStr.isEmpty {
            fullURL = URL(string: "\(kBaseURL)/\(urlStr)")
        } else {
            fullURL = nil
        }
        return SunfileInfo(
            fullURL: fullURL,
            name: (obj["name"] as? String) ?? (obj["filename"] as? String) ?? "file",
            size: (obj["size"] as? Int) ?? Int(obj["size"] as? Double ?? 0),
            mime: mime,
            mediaType: obj["media_type"] as? String
        )
    }

    private func formatBubbleTime(_ ts: Double) -> String {
        SunDateFormatters.time(from: Date(timeIntervalSince1970: ts))
    }

    private func senderColor(_ name: String) -> Color {
        var h: UInt32 = 0
        for s in name.unicodeScalars { h = h &* 31 &+ s.value }
        let hue = Double(18 + Int(h % 38)) / 360.0
        return Color(hue: hue, saturation: 0.65, brightness: 0.65)
    }
}

// MARK: - Call bubble

struct CallBubbleView: View {
    let callType: String    // "audio" | "video"
    let status: String      // "ended" | "cancelled" | "rejected" | "missed"
    let durationSec: Int?
    let isFromMe: Bool
    let isTail: Bool

    private var iconName: String { callType == "video" ? "video.fill" : "phone.fill" }

    private var wasMissed: Bool {
        switch status {
        case "missed": return true
        case "rejected": return true
        case "cancelled": return !isFromMe
        default: return false
        }
    }

    private var iconColor: Color { wasMissed ? Color.smDanger : Color.smOnline }

    private var label: String {
        let isVideo = callType == "video"
        let noun = isVideo ? "видеозвонок" : "звонок"
        switch status {
        case "ended":
            return isFromMe ? "Исходящий \(noun)" : "Входящий \(noun)"
        case "cancelled":
            return isFromMe ? "Отменённый вызов" : "Пропущенный \(noun)"
        case "missed":
            return isFromMe ? "Нет ответа" : "Пропущенный \(noun)"
        case "rejected":
            return isFromMe ? "Нет ответа" : "Отклонённый вызов"
        default:
            return isFromMe ? "Исходящий \(noun)" : "Входящий \(noun)"
        }
    }

    private var durationText: String? {
        guard status == "ended", let sec = durationSec, sec > 0 else { return nil }
        if sec >= 3600 {
            return String(format: "%d:%02d:%02d", sec / 3600, (sec % 3600) / 60, sec % 60)
        }
        return String(format: "%d:%02d", sec / 60, sec % 60)
    }

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(iconColor.opacity(0.15))
                    .frame(width: 32, height: 32)
                Image(systemName: iconName)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(iconColor)
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                    .font(.system(size: 13.5, weight: .semibold))
                    .foregroundStyle(isFromMe ? Color.smBubbleOutText : Color.smBubbleInText)
                    .lineLimit(1)
                if let dur = durationText {
                    HStack(spacing: 4) {
                        Image(systemName: "clock")
                            .font(.system(size: 9.5))
                            .foregroundStyle((isFromMe ? Color.smBubbleOutText : Color.smBubbleInText).opacity(0.55))
                        Text(dur)
                            .font(.system(size: 11.5, weight: .medium, design: .monospaced))
                            .foregroundStyle((isFromMe ? Color.smBubbleOutText : Color.smBubbleInText).opacity(0.70))
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(isFromMe ? Color.smBubbleOut : Color.smBubbleIn)
        .clipShape(BubbleShape(isFromMe: isFromMe, isTail: isTail))
        .overlay(
            BubbleShape(isFromMe: isFromMe, isTail: isTail)
                .stroke(isFromMe ? Color.clear : Color.smBorderSoft, lineWidth: 0.5)
        )
        .shadow(
            color: Color(hex: isFromMe ? "#000000" : "#281e0f").opacity(isFromMe ? 0.14 : 0.04),
            radius: 1, x: 0, y: 1
        )
    }
}

// MARK: - Photo bubble

struct PhotoBubbleView: View {
    let url: URL?
    let isFromMe: Bool
    let isTail: Bool
    @State private var image: UIImage?
    @State private var loadFailed = false
    @State private var showFullscreen = false

    var body: some View {
        Button(action: { if image != nil { showFullscreen = true } }) {
            ZStack {
                if let img = image {
                    Image(uiImage: img)
                        .resizable()
                        .scaledToFill()
                } else if loadFailed {
                    failPlaceholder
                } else {
                    loadingPlaceholder
                }
            }
            .frame(width: 220, height: 160)
            .clipShape(BubbleShape(isFromMe: isFromMe, isTail: isTail))
            .overlay(
                BubbleShape(isFromMe: isFromMe, isTail: isTail)
                    .stroke(Color.smBorderSoft, lineWidth: 0.5)
            )
            .shadow(color: Color.black.opacity(0.12), radius: 2, x: 0, y: 1)
        }
        .buttonStyle(.plain)
        .task(id: url) { await loadImage() }
        .fullScreenCover(isPresented: $showFullscreen) {
            if let img = image {
                FullscreenImageView(image: img, isPresented: $showFullscreen)
            }
        }
    }

    private func loadImage() async {
        guard let url else {
            await MainActor.run {
                image = nil
                loadFailed = true
            }
            return
        }
        if let cached = SunPhotoCache.image(for: url) {
            await MainActor.run {
                guard self.url == url else { return }
                loadFailed = false
                image = cached
            }
            return
        }
        await MainActor.run {
            guard self.url == url else { return }
            image = nil
            loadFailed = false
        }
        do {
            let imageData: Data
            if let e2ee = SunMediaE2EE.parse(url: url) {
                // Web-sent encrypted media: fetch + decrypt in memory
                imageData = try await e2ee.fetchAndDecrypt()
            } else {
                guard let data = try await APIClient.shared.fetchMedia(url) else {
                    await MainActor.run {
                        guard self.url == url else { return }
                        loadFailed = true
                    }
                    return
                }
                imageData = data
            }
            let img = await Task.detached(priority: .utility) {
                SunPhotoCache.makeDisplayImage(from: imageData)
            }.value
            if let img {
                SunPhotoCache.store(img, for: url)
                await MainActor.run {
                    guard self.url == url else { return }
                    self.image = img
                }
            } else {
                await MainActor.run {
                    guard self.url == url else { return }
                    loadFailed = true
                }
            }
        } catch {
            await MainActor.run {
                guard self.url == url else { return }
                loadFailed = true
            }
        }
    }

    private var loadingPlaceholder: some View {
        ZStack {
            Color.smBorderSoft
            ProgressView().tint(Color.smMuted)
        }
    }

    private var failPlaceholder: some View {
        ZStack {
            Color.smBorderSoft
            Image(systemName: "photo")
                .font(.system(size: 32))
                .foregroundStyle(Color.smFaint)
        }
    }
}

private enum SunPhotoCache {
    private static let maxPixelSize = 900
    private static let cache: NSCache<NSURL, UIImage> = {
        let cache = NSCache<NSURL, UIImage>()
        cache.countLimit = 160
        cache.totalCostLimit = 72 * 1024 * 1024
        return cache
    }()

    static func image(for url: URL) -> UIImage? {
        cache.object(forKey: url as NSURL)
    }

    static func store(_ image: UIImage, for url: URL) {
        let cost = image.cgImage.map { $0.bytesPerRow * $0.height } ?? 1
        cache.setObject(image, forKey: url as NSURL, cost: cost)
    }

    static func makeDisplayImage(from data: Data) -> UIImage? {
        let sourceOptions = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, sourceOptions) else {
            return UIImage(data: data)
        }
        let thumbnailOptions = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixelSize,
        ] as CFDictionary
        guard let cgImage = CGImageSourceCreateThumbnailAtIndex(source, 0, thumbnailOptions) else {
            return UIImage(data: data)
        }
        return UIImage(cgImage: cgImage)
    }
}

// MARK: - Fullscreen image viewer

struct FullscreenImageView: View {
    let image: UIImage
    @Binding var isPresented: Bool
    @State private var scale: CGFloat = 1

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .scaleEffect(scale)
                .gesture(MagnificationGesture().onChanged { scale = max(1, min(4, $0)) }.onEnded { _ in withAnimation { scale = 1 } })
                .ignoresSafeArea()
            VStack {
                HStack {
                    Spacer()
                    Button(action: { isPresented = false }) {
                        Image(systemName: "xmark")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 36, height: 36)
                            .background(Color.black.opacity(0.5), in: Circle())
                    }
                    .buttonStyle(.plain)
                }
                .padding()
                Spacer()
            }
        }
    }
}

// MARK: - Video bubble (tap to play in full-screen AVPlayer)

struct VideoBubbleView: View {
    let url: URL?
    let isFromMe: Bool
    let isTail: Bool
    @State private var showPlayer = false
    @State private var thumbnail: UIImage?
    /// Resolved playback URL (may be a local temp file if web-encrypted).
    @State private var effectiveURL: URL?
    @State private var decryptedTempURL: URL?

    var body: some View {
        Button(action: { if effectiveURL != nil { showPlayer = true } }) {
            ZStack {
                if let thumb = thumbnail {
                    Image(uiImage: thumb)
                        .resizable()
                        .scaledToFill()
                } else {
                    Color.smBorderSoft
                    Image(systemName: "video.fill")
                        .font(.system(size: 32))
                        .foregroundStyle(Color.smMuted)
                }
                Circle()
                    .fill(Color.black.opacity(0.55))
                    .frame(width: 48, height: 48)
                    .overlay(
                        Image(systemName: "play.fill")
                            .font(.system(size: 18))
                            .foregroundStyle(.white)
                            .offset(x: 2)
                    )
            }
            .frame(width: 220, height: 160)
            .clipShape(BubbleShape(isFromMe: isFromMe, isTail: isTail))
            .overlay(
                BubbleShape(isFromMe: isFromMe, isTail: isTail)
                    .stroke(Color.smBorderSoft, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
        .task(id: url) { await resolveAndLoadThumbnail() }
        .onDisappear { removeDecryptedTempFile() }
        .fullScreenCover(isPresented: $showPlayer) {
            if let eu = effectiveURL {
                VideoPlayerSheet(url: eu, isPresented: $showPlayer)
            }
        }
    }

    private func resolveAndLoadThumbnail() async {
        removeDecryptedTempFile()
        guard let url else {
            effectiveURL = nil
            thumbnail = nil
            return
        }
        effectiveURL = nil
        thumbnail = nil
        // If the media is web-encrypted, decrypt to a temp file first so
        // both the thumbnail generator and the full-screen player can use it.
        if let e2ee = SunMediaE2EE.parse(url: url),
           let tmpURL = try? await e2ee.fetchAndDecryptToTempFile() {
            guard self.url == url else {
                if tmpURL.isFileURL {
                    try? FileManager.default.removeItem(at: tmpURL)
                }
                return
            }
            decryptedTempURL = tmpURL
            effectiveURL = tmpURL
            await generateThumbnail(from: AVURLAsset(url: tmpURL), expectedURL: url)
        } else {
            guard self.url == url else { return }
            effectiveURL = url
            await generateThumbnail(from: AuthenticatedAsset.make(url: url), expectedURL: url)
        }
    }

    private func removeDecryptedTempFile() {
        guard let url = decryptedTempURL else { return }
        decryptedTempURL = nil
        if url.isFileURL {
            try? FileManager.default.removeItem(at: url)
        }
    }

    private func generateThumbnail(from asset: AVAsset, expectedURL: URL) async {
        if let cached = SunVideoThumbnailCache.image(for: expectedURL) {
            await MainActor.run {
                guard self.url == expectedURL else { return }
                self.thumbnail = cached
            }
            return
        }

        let gen = AVAssetImageGenerator(asset: asset)
        gen.appliesPreferredTrackTransform = true
        do {
            let cg = try await gen.image(at: CMTime(seconds: 0.5, preferredTimescale: 600)).image
            let image = UIImage(cgImage: cg)
            SunVideoThumbnailCache.store(image, for: expectedURL)
            await MainActor.run {
                guard self.url == expectedURL else { return }
                self.thumbnail = image
            }
        } catch { }
    }
}

private enum SunVideoThumbnailCache {
    private static let cache: NSCache<NSURL, UIImage> = {
        let cache = NSCache<NSURL, UIImage>()
        cache.countLimit = 96
        cache.totalCostLimit = 32 * 1024 * 1024
        return cache
    }()

    static func image(for url: URL) -> UIImage? {
        cache.object(forKey: url as NSURL)
    }

    static func store(_ image: UIImage, for url: URL) {
        let cost = image.cgImage.map { $0.bytesPerRow * $0.height } ?? 1
        cache.setObject(image, forKey: url as NSURL, cost: cost)
    }
}

/// Builds an AVURLAsset that carries the user's session cookies so playback works
/// against authenticated `/chat_media/...` endpoints on the Sunmsg server.
enum AuthenticatedAsset {
    static func make(url: URL) -> AVURLAsset {
        // Pull cookies from the shared jar that APIClient uses.
        let storage = HTTPCookieStorage.shared
        let cookies = storage.cookies(for: url) ?? []
        let cookieHeader = cookies
            .map { "\($0.name)=\($0.value)" }
            .joined(separator: "; ")
        var headers: [String: String] = [:]
        if !cookieHeader.isEmpty { headers["Cookie"] = cookieHeader }
        let options: [String: Any] = [
            "AVURLAssetHTTPHeaderFieldsKey": headers,
            // Allow AVFoundation to use cookies for HLS/progressive downloads
            "AVURLAssetHTTPCookiesKey": cookies,
        ]
        return AVURLAsset(url: url, options: options)
    }
}

struct VideoPlayerSheet: View {
    let url: URL
    @Binding var isPresented: Bool
    // Hold a single AVPlayer instance — a computed property would rebuild it on
    // every body evaluation, resetting playback.
    @State private var player: AVPlayer?

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let player {
                VideoPlayer(player: player)
                    .ignoresSafeArea()
            } else {
                ProgressView().tint(.white)
            }
            VStack {
                HStack {
                    Spacer()
                    Button(action: { isPresented = false }) {
                        Image(systemName: "xmark")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(.white)
                            .frame(width: 36, height: 36)
                            .background(Color.black.opacity(0.5), in: Circle())
                    }
                    .buttonStyle(.plain)
                }
                .padding()
                Spacer()
            }
        }
        .onAppear {
            let p = AVPlayer(playerItem: AVPlayerItem(asset: AuthenticatedAsset.make(url: url)))
            player = p
            p.play()
        }
        .onDisappear { player?.pause() }
    }
}

// MARK: - Audio bubble (real playback via AVPlayer)

struct AudioBubbleView: View {
    let url: URL?
    let name: String
    let isFromMe: Bool
    let isTail: Bool
    @StateObject private var player = AudioPlayerController()
    /// Effective playback URL — may be a local temp file if the source is
    /// a web-encrypted media file (sun_media_e2ee fragment).
    @State private var effectiveURL: URL?
    @State private var decryptedTempURL: URL?
    @State private var isResolving = false

    var body: some View {
        HStack(spacing: 10) {
            Button(action: { player.toggle(url: effectiveURL) }) {
                ZStack {
                    if isResolving {
                        ProgressView().tint(isFromMe ? Color.smBubbleOutText : Color.smAccent2)
                            .scaleEffect(0.7)
                    } else {
                        Image(systemName: player.isPlaying ? "pause.fill" : "play.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(isFromMe ? Color.smBubbleOutText : Color.smAccent2)
                    }
                }
                .frame(width: 32, height: 32)
                .background(
                    Circle().fill(isFromMe ? Color.white.opacity(0.15) : Color.smAccent.opacity(0.12))
                )
            }
            .buttonStyle(.plain)
            .disabled(effectiveURL == nil || isResolving)

            VStack(alignment: .leading, spacing: 3) {
                // Waveform: animated when playing
                HStack(spacing: 2) {
                    let bars: [CGFloat] = [4, 8, 12, 6, 10, 14, 8, 5, 11, 7, 9, 13, 6, 10, 4, 8, 12, 7, 5, 9]
                    let progressIdx = player.duration > 0 ? Int(player.elapsed / player.duration * Double(bars.count)) : 0
                    ForEach(0..<bars.count, id: \.self) { i in
                        Capsule()
                            .fill((i < progressIdx ? Color.smAccent : (isFromMe ? Color.smBubbleOutText.opacity(0.7) : Color.smMuted)))
                            .frame(width: 2, height: bars[i])
                    }
                }
                Text(formatTime(player.isPlaying ? player.elapsed : player.duration))
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(isFromMe ? Color.smBubbleOutText.opacity(0.6) : Color.smFaint)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(isFromMe ? Color.smBubbleOut : Color.smBubbleIn)
        .clipShape(BubbleShape(isFromMe: isFromMe, isTail: isTail))
        .overlay(
            BubbleShape(isFromMe: isFromMe, isTail: isTail)
                .stroke(isFromMe ? Color.clear : Color.smBorderSoft, lineWidth: 0.5)
        )
        .shadow(color: Color.black.opacity(0.08), radius: 1, x: 0, y: 1)
        .task(id: url) { await resolveAndPrepare() }
        .onDisappear {
            player.stop()
            removeDecryptedTempFile()
        }
    }

    private func resolveAndPrepare() async {
        player.stop()
        removeDecryptedTempFile()
        effectiveURL = nil
        isResolving = false
        guard let url else { return }
        if let e2ee = SunMediaE2EE.parse(url: url) {
            // Web-encrypted file: fetch, decrypt, save to temp file
            isResolving = true
            defer {
                if self.url == url {
                    isResolving = false
                }
            }
            if let tmpURL = try? await e2ee.fetchAndDecryptToTempFile() {
                guard self.url == url else {
                    if tmpURL.isFileURL {
                        try? FileManager.default.removeItem(at: tmpURL)
                    }
                    return
                }
                decryptedTempURL = tmpURL
                effectiveURL = tmpURL
                await player.prepareDuration(url: tmpURL)
            }
        } else {
            guard self.url == url else { return }
            effectiveURL = url
            await player.prepareDuration(url: url)
        }
    }

    private func removeDecryptedTempFile() {
        guard let url = decryptedTempURL else { return }
        decryptedTempURL = nil
        if url.isFileURL {
            try? FileManager.default.removeItem(at: url)
        }
    }

    private func formatTime(_ t: Double) -> String {
        if t.isNaN || !t.isFinite || t <= 0 { return "0:00" }
        let m = Int(t) / 60, s = Int(t) % 60
        return String(format: "%d:%02d", m, s)
    }
}

@MainActor
final class AudioPlayerController: ObservableObject {
    @Published var isPlaying: Bool = false
    @Published var elapsed: Double = 0
    @Published var duration: Double = 0
    private var player: AVPlayer?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var preparedURL: URL?

    func prepareDuration(url: URL?) async {
        guard let url else {
            preparedURL = nil
            duration = 0
            return
        }
        preparedURL = url
        // For local file URLs (decrypted temp files) we can load directly.
        // For remote URLs we use an authenticated AVURLAsset.
        let asset: AVAsset = url.isFileURL
            ? AVURLAsset(url: url)
            : AuthenticatedAsset.make(url: url)
        do {
            let d = try await asset.load(.duration).seconds
            await MainActor.run {
                guard self.preparedURL == url else { return }
                self.duration = d.isFinite ? d : 0
            }
        } catch { }
    }

    func toggle(url: URL?) {
        guard let url else { return }
        if player == nil {
            try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default)
            try? AVAudioSession.sharedInstance().setActive(true)
            let asset: AVAsset = url.isFileURL
                ? AVURLAsset(url: url)
                : AuthenticatedAsset.make(url: url)
            let item = AVPlayerItem(asset: asset)
            let p = AVPlayer(playerItem: item)
            self.player = p
            timeObserver = p.addPeriodicTimeObserver(
                forInterval: CMTime(seconds: 0.1, preferredTimescale: 600),
                queue: .main
            ) { [weak self] t in
                // The callback is already on main queue — `assumeIsolated` avoids
                // Sendable warnings without spawning a new Task.
                MainActor.assumeIsolated { self?.elapsed = CMTimeGetSeconds(t) }
            }
            endObserver = NotificationCenter.default.addObserver(
                forName: .AVPlayerItemDidPlayToEndTime,
                object: item, queue: .main
            ) { [weak self] _ in
                MainActor.assumeIsolated {
                    self?.isPlaying = false
                    self?.elapsed = 0
                    self?.player?.seek(to: .zero)
                }
            }
        }
        if isPlaying { player?.pause(); isPlaying = false }
        else { player?.play(); isPlaying = true }
    }

    func stop() {
        let currentPlayer = player
        currentPlayer?.pause()
        if let t = timeObserver {
            currentPlayer?.removeTimeObserver(t)
            timeObserver = nil
        }
        if let o = endObserver {
            NotificationCenter.default.removeObserver(o)
            endObserver = nil
        }
        player = nil
        preparedURL = nil
        isPlaying = false
        elapsed = 0
        duration = 0
    }

    deinit {
        if let t = timeObserver { player?.removeTimeObserver(t) }
        if let o = endObserver { NotificationCenter.default.removeObserver(o) }
    }
}

// MARK: - File bubble (tap to open via system share sheet)

struct FileBubbleView: View {
    let url: URL?
    let name: String
    let size: Int
    let isFromMe: Bool
    let isTail: Bool
    @State private var showShare = false
    @State private var isDownloading = false
    /// Resolved URL (local temp file for web-encrypted files, original URL otherwise).
    @State private var resolvedURL: URL?
    @State private var decryptedTempURL: URL?

    private var sizeText: String {
        if size <= 0 { return "" }
        if size < 1024 { return "\(size) B" }
        if size < 1_048_576 { return "\(size / 1024) KB" }
        return String(format: "%.1f MB", Double(size) / 1_048_576)
    }

    var body: some View {
        Button(action: {
            guard let url else { return }
            if resolvedURL != nil {
                showShare = true
            } else {
                // Not yet resolved — trigger download + decrypt
                Task { await resolveForShare(url: url) }
            }
        }) {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(isFromMe ? Color.white.opacity(0.15) : Color.smAccent.opacity(0.12))
                        .frame(width: 36, height: 36)
                    if isDownloading {
                        ProgressView().tint(isFromMe ? Color.smBubbleOutText : Color.smAccent2)
                            .scaleEffect(0.7)
                    } else {
                        Image(systemName: "doc.fill")
                            .font(.system(size: 16))
                            .foregroundStyle(isFromMe ? Color.smBubbleOutText : Color.smAccent2)
                    }
                }
                VStack(alignment: .leading, spacing: 2) {
                    // Show the original name without .sunenc extension for web files
                    let displayName = name.hasSuffix(".sunenc")
                        ? String(name.dropLast(".sunenc".count))
                        : name
                    Text(displayName)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(isFromMe ? Color.smBubbleOutText : Color.smText)
                        .lineLimit(1)
                    if !sizeText.isEmpty {
                        Text(sizeText)
                            .font(.system(size: 11))
                            .foregroundStyle(isFromMe ? Color.smBubbleOutText.opacity(0.6) : Color.smFaint)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(minWidth: 180)
            .background(isFromMe ? Color.smBubbleOut : Color.smBubbleIn)
            .clipShape(BubbleShape(isFromMe: isFromMe, isTail: isTail))
            .overlay(
                BubbleShape(isFromMe: isFromMe, isTail: isTail)
                    .stroke(isFromMe ? Color.clear : Color.smBorderSoft, lineWidth: 0.5)
            )
            .shadow(color: Color.black.opacity(0.08), radius: 1, x: 0, y: 1)
        }
        .buttonStyle(.plain)
        .disabled(isDownloading)
        .task(id: url) {
            // Pre-resolve plain (non-encrypted) URLs immediately; encrypted files
            // are resolved on demand when the user taps.
            removeDecryptedTempFile()
            resolvedURL = nil
            guard let url else { return }
            if SunMediaE2EE.parse(url: url) == nil {
                resolvedURL = url
            } else {
                resolvedURL = nil
            }
        }
        .sheet(isPresented: $showShare) {
            if let resolved = resolvedURL { ShareSheet(items: [resolved]) }
        }
        .onChange(of: showShare) { _, shown in
            if !shown { removeDecryptedTempFile() }
        }
        .onDisappear { removeDecryptedTempFile() }
    }

    private func resolveForShare(url: URL) async {
        guard self.url == url else { return }
        guard let e2ee = SunMediaE2EE.parse(url: url) else {
            resolvedURL = url; showShare = true; return
        }
        removeDecryptedTempFile()
        isDownloading = true
        defer {
            if self.url == url {
                isDownloading = false
            }
        }
        if let tmpURL = try? await e2ee.fetchAndDecryptToTempFile() {
            guard self.url == url else {
                if tmpURL.isFileURL {
                    try? FileManager.default.removeItem(at: tmpURL)
                }
                return
            }
            decryptedTempURL = tmpURL
            resolvedURL = tmpURL
            showShare = true
        }
    }

    private func removeDecryptedTempFile() {
        guard let url = decryptedTempURL else { return }
        decryptedTempURL = nil
        if resolvedURL == url { resolvedURL = nil }
        if url.isFileURL {
            try? FileManager.default.removeItem(at: url)
        }
    }
}

struct ShareSheet: UIViewControllerRepresentable {
    let items: [Any]
    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: items, applicationActivities: nil)
    }
    func updateUIViewController(_ vc: UIActivityViewController, context: Context) {}
}

// MARK: - Custom bubble shape

struct BubbleShape: Shape {
    let isFromMe: Bool
    let isTail: Bool
    private let r: CGFloat = 18
    private let tailR: CGFloat = 6

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let (minX, maxX, minY, maxY) = (rect.minX, rect.maxX, rect.minY, rect.maxY)
        let bottomR = isTail ? tailR : r

        if isFromMe {
            path.move(to: CGPoint(x: minX + r, y: minY))
            path.addLine(to: CGPoint(x: maxX - r, y: minY))
            path.addQuadCurve(to: CGPoint(x: maxX, y: minY + r), control: CGPoint(x: maxX, y: minY))
            path.addLine(to: CGPoint(x: maxX, y: maxY - bottomR))
            path.addQuadCurve(to: CGPoint(x: maxX - bottomR, y: maxY), control: CGPoint(x: maxX, y: maxY))
            path.addLine(to: CGPoint(x: minX + r, y: maxY))
            path.addQuadCurve(to: CGPoint(x: minX, y: maxY - r), control: CGPoint(x: minX, y: maxY))
            path.addLine(to: CGPoint(x: minX, y: minY + r))
            path.addQuadCurve(to: CGPoint(x: minX + r, y: minY), control: CGPoint(x: minX, y: minY))
        } else {
            path.move(to: CGPoint(x: minX + r, y: minY))
            path.addLine(to: CGPoint(x: maxX - r, y: minY))
            path.addQuadCurve(to: CGPoint(x: maxX, y: minY + r), control: CGPoint(x: maxX, y: minY))
            path.addLine(to: CGPoint(x: maxX, y: maxY - r))
            path.addQuadCurve(to: CGPoint(x: maxX - r, y: maxY), control: CGPoint(x: maxX, y: maxY))
            path.addLine(to: CGPoint(x: minX + bottomR, y: maxY))
            path.addQuadCurve(to: CGPoint(x: minX, y: maxY - bottomR), control: CGPoint(x: minX, y: maxY))
            path.addLine(to: CGPoint(x: minX, y: minY + r))
            path.addQuadCurve(to: CGPoint(x: minX + r, y: minY), control: CGPoint(x: minX, y: minY))
        }
        path.closeSubpath()
        return path
    }
}

// MARK: - Bubble anchor preference (for the long-press context menu)

/// Collects each on-screen message bubble's frame so the context-menu overlay
/// can position itself relative to the pressed bubble.
struct BubbleAnchorKey: PreferenceKey {
    static let defaultValue: [Int: Anchor<CGRect>] = [:]
    static func reduce(value: inout [Int: Anchor<CGRect>], nextValue: () -> [Int: Anchor<CGRect>]) {
        value.merge(nextValue()) { _, new in new }
    }
}

// MARK: - Button styles (tactile press feedback)

/// Quick scale + dim on press — gives buttons an instant, springy response.
struct PressableStyle: ButtonStyle {
    var scale: CGFloat = 0.9
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? scale : 1)
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(.spring(response: 0.22, dampingFraction: 0.55), value: configuration.isPressed)
    }
}

/// Full-width menu row that highlights its background while pressed.
struct MenuRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Color.smText.opacity(0.07) : Color.clear)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
