import Foundation
import SwiftUI
import Observation
import PhotosUI
import AVKit
import AVFoundation
import ImageIO

private struct ChatProfileDestination: Hashable {
    let contact: Contact

    static func == (lhs: ChatProfileDestination, rhs: ChatProfileDestination) -> Bool {
        lhs.contact.chatId == rhs.contact.chatId
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(contact.chatId)
    }
}

struct ChatView: View {
    let contact: Contact
    @EnvironmentObject var session: SessionStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(SettingsClientPreferences.chatAppearanceModeKey) private var chatAppearanceMode = "default"
    @AppStorage(SettingsClientPreferences.chatBackgroundColorKey) private var chatBackgroundColor = "#f2ede2"
    @AppStorage(SettingsClientPreferences.chatGradientAKey) private var chatGradientA = "#f2ede2"
    @AppStorage(SettingsClientPreferences.chatGradientBKey) private var chatGradientB = "#d8ecff"
    @AppStorage(SettingsClientPreferences.chatBackgroundImageKey) private var chatBackgroundImageDataURL = ""
    @AppStorage(SettingsClientPreferences.chatBackgroundDarkenKey) private var chatBackgroundDarken = 0.0
    @AppStorage(SettingsClientPreferences.chatBackgroundBlurKey) private var chatBackgroundBlur = 0.0
    @AppStorage(SettingsClientPreferences.chatBackgroundImageOpacityKey) private var chatBackgroundImageOpacity = 1.0
    @AppStorage(SettingsClientPreferences.chatBackgroundScaleKey) private var chatBackgroundScale = 1.0
    @AppStorage(SettingsClientPreferences.chatBackgroundPositionXKey) private var chatBackgroundPositionX = 50.0
    @AppStorage(SettingsClientPreferences.chatBackgroundPositionYKey) private var chatBackgroundPositionY = 50.0
    @AppStorage(SettingsClientPreferences.chatBackgroundRepeatKey) private var chatBackgroundRepeat = false

    @State private var messages: [ChatMessage] = []
    @State private var decryptedTexts: [Int: String] = [:]
    @State private var timelineVersion = 0
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
    @State private var recordingStartToken = UUID()
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
    @State private var replyTarget: ReplyTarget? = nil
    @State private var forwardTargetMessage: ChatMessage? = nil
    @State private var infoTargetMessage: ChatMessage? = nil
    @State private var selectedMessageIds: Set<Int> = []
    @State private var isSelectionMode = false
    @State private var pinnedMessageIds: Set<Int> = []
    // Pending delete confirmation.
    @State private var pendingDelete: PendingDelete? = nil
    // A short, transient toast (e.g. "Скопировано").
    @State private var toast: String? = nil
    @State private var decodedChatBackgroundImage: UIImage?

    /// Quick-pick reactions (subset of the server's allowed set, top-ranked).
    private let reactionEmojis = ["😀", "❤️", "👍", "💯", "👌", "🔥", "😎"]
    private let additionalReactionEmojis = ["😂", "😮", "😢", "👏", "🙏", "🤯", "🎉", "🤔"]
    private let composerEmojiSuggestions = [
        "\u{1F642}", "\u{1F604}", "\u{1F605}", "\u{1F972}",
        "\u{1F60A}", "\u{1F60D}", "\u{1F914}", "\u{1F44D}",
        "\u{2764}\u{FE0F}", "\u{1F525}", "\u{1F389}", "\u{2600}\u{FE0F}",
    ]

    struct PendingDelete: Identifiable {
        let id: Int
        let isFromMe: Bool
    }

    struct ReplyTarget: Equatable {
        let id: Int
        let senderName: String
        let preview: String
    }

    private struct VoiceRecordingStartResult: @unchecked Sendable {
        let recorder: AVAudioRecorder
        let url: URL
        let didStart: Bool
    }

    @FocusState private var composerFocused: Bool
    @State private var contactProfileDestination: ChatProfileDestination?

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
            .navigationBarBackButtonHidden(true)
            .toolbar(.hidden, for: .navigationBar)
            // The bottom tab bar must not show while a chat is open.
            .toolbar(.hidden, for: .tabBar)
            .navigationDestination(item: $contactProfileDestination) { destination in
                ContactProfileView(contact: destination.contact)
                    .toolbar(.visible, for: .navigationBar)
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
                ChatHaptics.prepare()
                refreshPrivateKeyState()
                session.activeChatId = contact.chatId
                session.clearUnread(chatId: contact.chatId)
            }
            .onDisappear {
                if session.activeChatId == contact.chatId {
                    session.activeChatId = nil
                }
                typingDebounceTask?.cancel()
                typingDebounceTask = nil
                draftSaveTask?.cancel()
                deleteDialogTask?.cancel()
                deleteDialogTask = nil
                editFocusTask?.cancel()
                editFocusTask = nil
                toastDismissTask?.cancel()
                toastDismissTask = nil
                flushDraftSave(force: true)
                partnerStopTypingTask?.cancel()
                partnerStopTypingTask = nil
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
            .onChange(of: scenePhase) { _, phase in
                guard phase == .active else { return }
                refreshPrivateKeyState()
            }
    }

    // MARK: - Native layout

    private var nativeChatLayout: some View {
        ZStack {
            chatBackgroundView
                .ignoresSafeArea()
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
        .background(chatBackgroundView)
        .safeAreaInset(edge: .top, spacing: 0) {
            VStack(spacing: 0) {
                chatTopBar
                selectionToolbar
            }
        }
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
        .sheet(item: $forwardTargetMessage) { msg in
            ForwardMessageSheet(
                contacts: session.contacts,
                currentChatId: contact.chatId,
                onCancel: { forwardTargetMessage = nil },
                onSelect: { target in
                    forwardTargetMessage = nil
                    forwardMessage(msg, to: target)
                }
            )
        }
        .sheet(item: $infoTargetMessage) { msg in
            MessageInfoSheet(
                message: msg,
                isFromMe: msg.senderUserId == myId,
                displayText: resolvedPlainText(for: msg) ?? msg.displayText
            )
        }
        .task(id: chatBackgroundImageDataURL) {
            await refreshChatBackgroundImage(from: chatBackgroundImageDataURL)
        }
    }

    @ViewBuilder
    private var chatBackgroundView: some View {
        if chatAppearanceMode == "gradient" {
            LinearGradient(
                colors: [Color(hex: chatGradientA), Color(hex: chatGradientB)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        } else if chatAppearanceMode == "custom", let decodedChatBackgroundImage {
            GeometryReader { proxy in
                if chatBackgroundRepeat {
                    Rectangle()
                        .fill(ImagePaint(image: Image(uiImage: decodedChatBackgroundImage), scale: CGFloat(max(0.15, 1 / chatBackgroundScale))))
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .blur(radius: CGFloat(chatBackgroundBlur))
                        .opacity(chatBackgroundImageOpacity)
                        .overlay(Color.black.opacity(chatBackgroundDarken))
                } else {
                    Image(uiImage: decodedChatBackgroundImage)
                        .resizable()
                        .scaledToFill()
                        .scaleEffect(CGFloat(chatBackgroundScale))
                        .position(
                            x: proxy.size.width * CGFloat(chatBackgroundPositionX) / 100,
                            y: proxy.size.height * CGFloat(chatBackgroundPositionY) / 100
                        )
                        .frame(width: proxy.size.width, height: proxy.size.height)
                        .clipped()
                        .blur(radius: CGFloat(chatBackgroundBlur))
                        .opacity(chatBackgroundImageOpacity)
                        .overlay(Color.black.opacity(chatBackgroundDarken))
                }
            }
        } else if chatAppearanceMode == "color" || chatAppearanceMode == "preset" {
            Color(hex: chatBackgroundColor)
        } else {
            Color.smBg2
        }
    }

    private func refreshChatBackgroundImage(from dataURL: String) async {
        let image = await Task.detached(priority: .utility) {
            Self.decodeDataURLImage(dataURL)
        }.value
        guard !Task.isCancelled, chatBackgroundImageDataURL == dataURL else { return }
        decodedChatBackgroundImage = image
    }

    private static func decodeDataURLImage(_ value: String) -> UIImage? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let base64 = trimmed.components(separatedBy: ",").last ?? trimmed
        guard let data = Data(base64Encoded: base64) else { return nil }
        return UIImage(data: data)
    }

    private var chatTopBar: some View {
        let current = liveContact
        return ChatTopBarView(
            contact: current,
            statusText: statusText,
            isSavedMessages: isSavedMessages,
            isTyping: partnerIsTyping || current.isTyping,
            onBack: { dismiss() },
            onOpenProfile: { contactProfileDestination = ChatProfileDestination(contact: liveContact) }
        )
    }

    private var deleteDialogBinding: Binding<Bool> {
        Binding(get: { pendingDelete != nil }, set: { if !$0 { pendingDelete = nil } })
    }

    @ViewBuilder
    private var selectionToolbar: some View {
        if isSelectionMode {
            HStack(spacing: 12) {
                Button(action: clearSelection) {
                    Image(systemName: "xmark")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.smText)
                        .frame(width: 34, height: 34)
                        .background(Color.smSurface, in: Circle())
                        .overlay(Circle().stroke(Color.smBorder, lineWidth: 0.6))
                }
                .buttonStyle(PressableStyle(scale: 0.92))

                Text("\(selectedMessageIds.count) выбрано")
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.smText)

                Spacer(minLength: 8)

                Button(action: forwardSelectedMessages) {
                    Image(systemName: "arrowshape.turn.up.forward")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(selectedMessageIds.count == 1 ? Color.smText : Color.smFaint)
                        .frame(width: 34, height: 34)
                        .background(Color.smSurface, in: Circle())
                        .overlay(Circle().stroke(Color.smBorder, lineWidth: 0.6))
                }
                .buttonStyle(PressableStyle(scale: 0.92))
                .disabled(selectedMessageIds.count != 1)

                Button(role: .destructive, action: deleteSelectedMessages) {
                    Image(systemName: "trash")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(selectedMessageIds.isEmpty ? Color.smFaint : Color.smDanger)
                        .frame(width: 34, height: 34)
                        .background(Color.smSurface, in: Circle())
                        .overlay(Circle().stroke(Color.smBorder, lineWidth: 0.6))
                }
                .buttonStyle(PressableStyle(scale: 0.92))
                .disabled(selectedMessageIds.isEmpty)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(Color.smBg)
            .overlay(alignment: .bottom) {
                Rectangle()
                    .fill(Color.smBorderSoft)
                    .frame(height: 0.5)
            }
        }
    }

    // MARK: - Transient toast

    @ViewBuilder
    private var toastView: some View {
        if let toast {
            Text(toast)
                .font(.footnote.weight(.medium))
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
        updateWithMotion(.spring(response: 0.32, dampingFraction: 0.8)) { toast = text }
        toastDismissTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            guard !Task.isCancelled, toast == text else { return }
            toastDismissTask = nil
            updateWithMotion(.easeOut(duration: 0.25)) { toast = nil }
        }
    }

    private func updateWithMotion(_ animation: Animation, _ updates: () -> Void) {
        if reduceMotion {
            updates()
        } else {
            withAnimation(animation, updates)
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
            let previewGrouping = messagePreviewGrouping(for: msg, isFromMe: isFromMe)

            MessageContextMenu(
                targetRect: rect,
                containerSize: geo.size,
                safeAreaInsets: geo.safeAreaInsets,
                isFromMe: isFromMe,
                actions: actions,
                currentReactions: msg.reactions,
                primaryReactions: reactionEmojis,
                additionalReactions: additionalReactionEmojis,
                onSelectReaction: { emoji in
                    toggleReaction(messageId: mid, emoji: emoji)
                    dismissMenu()
                },
                onDismiss: dismissMenu
            ) {
                MessageBubbleView(
                    message: msg,
                    decryptedText: decryptedTexts[msg.id],
                    isFromMe: isFromMe,
                    showSender: previewGrouping.showSender,
                    isTail: previewGrouping.isTail,
                    maxBubbleWidth: rect.width,
                    isPreview: true
                )
            }
            .transition(.opacity)
        }
    }

    private func messagePreviewGrouping(
        for message: ChatMessage,
        isFromMe: Bool
    ) -> (showSender: Bool, isTail: Bool) {
        guard let index = messages.firstIndex(where: { $0.id == message.id }) else {
            return (showSender: !isFromMe && contact.isGroup, isTail: true)
        }

        let previous = index > messages.startIndex ? messages[messages.index(before: index)] : nil
        let next = index < messages.index(before: messages.endIndex) ? messages[messages.index(after: index)] : nil
        let showSender = contact.isGroup
            && !isFromMe
            && (previous == nil
                || previous?.senderUserId != message.senderUserId
                || isDifferentMessageDay(current: message, previous: previous))
        let isTail = next == nil
            || next?.senderUserId != message.senderUserId
            || (next?.senderUserId == myId) != isFromMe
            || isDifferentMessageDay(current: next, previous: message)

        return (showSender: showSender, isTail: isTail)
    }

    private func isDifferentMessageDay(current: ChatMessage?, previous: ChatMessage?) -> Bool {
        guard let current, let previous else { return false }
        return !Calendar.current.isDate(
            Date(timeIntervalSince1970: current.createdAt),
            inSameDayAs: Date(timeIntervalSince1970: previous.createdAt)
        )
    }

    private func menuActions(for msg: ChatMessage, isFromMe: Bool) -> [MessageContextMenuAction] {
        var items: [MessageContextMenuAction] = []
        let resolved = decryptedTexts[msg.id] ?? msg.message ?? ""
        let isMedia = ["photo", "video", "audio", "file"].contains(msg.messageType)
        let isCopyable = !isMedia && msg.messageType != "call" && !resolved.isEmpty
            && !resolved.hasPrefix("{") && !resolved.hasPrefix("[")
        let withinEditWindow = (Date().timeIntervalSince1970 - msg.createdAt) < 48 * 3600
        let canEdit = isFromMe && isCopyable && withinEditWindow

        items.append(MessageContextMenuAction(id: "reply", title: "Ответить", systemImage: "arrowshape.turn.up.left") {
            beginReply(message: msg, currentText: resolved)
        })

        items.append(
            MessageContextMenuAction(
                id: "copy",
                title: "Копировать",
                systemImage: "doc.on.doc",
                isEnabled: isCopyable
            ) {
                UIPasteboard.general.string = resolved
                dismissMenu()
                showToast("Скопировано")
            }
        )

        items.append(
            MessageContextMenuAction(
                id: "edit",
                title: "Изменить",
                subtitle: canEdit ? nil : "Недоступно для этого сообщения",
                systemImage: "pencil",
                isEnabled: canEdit
            ) {
                beginEdit(message: msg, currentText: resolved)
            }
        )

        let isPinned = pinnedMessageIds.contains(msg.id)
        items.append(MessageContextMenuAction(id: "pin", title: isPinned ? "Открепить" : "Закрепить", systemImage: isPinned ? "pin.slash" : "pin") {
            togglePin(messageId: msg.id)
        })

        items.append(MessageContextMenuAction(id: "forward", title: "Переслать", systemImage: "arrowshape.turn.up.forward") {
            dismissMenu()
            forwardTargetMessage = msg
        })

        items.append(MessageContextMenuAction(id: "select", title: "Выбрать", systemImage: "checkmark.circle") {
            dismissMenu()
            startSelection(with: msg.id)
        })

        if isFromMe {
            items.append(MessageContextMenuAction(id: "info", title: "Информация о сообщении", subtitle: "ID \(msg.id)", systemImage: "info.circle") {
                dismissMenu()
                infoTargetMessage = msg
            })

            items.append(MessageContextMenuAction(id: "edited_at", title: "Время изменения", subtitle: msg.isEdited ? "Изменено" : "Не изменялось", systemImage: "clock.arrow.circlepath") {
                dismissMenu()
                infoTargetMessage = msg
            })

            items.append(MessageContextMenuAction(id: "delivery", title: "Статус доставки", subtitle: msg.isDelivered ? "Доставлено" : "Отправляется", systemImage: "checkmark.circle") {
                dismissMenu()
                infoTargetMessage = msg
            })

            items.append(MessageContextMenuAction(id: "read", title: "Статус прочтения", subtitle: msg.isRead ? "Прочитано" : "Не прочитано", systemImage: "checkmark.circle.fill") {
                dismissMenu()
                infoTargetMessage = msg
            })
        }

        items.append(MessageContextMenuAction(id: "delete", title: "Удалить", systemImage: "trash", role: .destructive) {
            let isMine = isFromMe
            dismissMenu()
            deleteDialogTask?.cancel()
            deleteDialogTask = nil
            pendingDelete = PendingDelete(id: msg.id, isFromMe: isMine)
        })
        return items
    }

    private func presentMenu(for messageId: Int) {
        composerFocused = false
        updateWithMotion(.spring(response: 0.34, dampingFraction: 0.82)) {
            menuTargetId = messageId
        }
        ChatHaptics.mediumImpact()
    }

    private func dismissMenu() {
        updateWithMotion(.easeOut(duration: 0.18)) { menuTargetId = nil }
    }

    private func toggleReaction(messageId: Int, emoji: String) {
        if SocketClient.shared.state != .connected {
            sendError = "Нет соединения — реакция будет отправлена после переподключения."
        }
        // Optimistic local update so the reaction appears instantly.
        if let i = messages.firstIndex(where: { $0.id == messageId }) {
            updateWithMotion(.spring(response: 0.3, dampingFraction: 0.7)) {
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
                clearMyExistingReaction(in: &reactions, except: emoji)
                reactions[r].count += 1
                reactions[r].reactedByMe = true
            }
        } else {
            clearMyExistingReaction(in: &reactions, except: emoji)
            reactions.append(MessageReaction(emoji: emoji, count: 1, reactedByMe: true))
        }
        messages[i].reactions = reactions
        invalidateTimeline()
    }

    private func clearMyExistingReaction(in reactions: inout [MessageReaction], except emoji: String) {
        for index in reactions.indices where reactions[index].emoji != emoji && reactions[index].reactedByMe {
            reactions[index].count = max(0, reactions[index].count - 1)
            reactions[index].reactedByMe = false
        }
        reactions.removeAll { $0.count == 0 }
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
                .font(.headline.weight(.semibold))
                .foregroundStyle(Color.smMuted)
            Text(contact.isGroup ? "Группа создана. Начните общение." : "Напишите первое сообщение.")
                .font(.subheadline)
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
            selectedMessageIds: selectedMessageIds,
            isSelectionMode: isSelectionMode,
            pinnedMessageIds: pinnedMessageIds,
            reduceMotion: reduceMotion,
            timelineVersion: timelineVersion,
            scrollIntent: $scrollIntent,
            isPinnedToBottom: $isPinnedToBottom,
            onLoadOlder: { Task { await loadOlderMessages() } },
            onToggleReaction: { messageId, emoji in toggleReaction(messageId: messageId, emoji: emoji) },
            onRequestMenu: { messageId in presentMenu(for: messageId) },
            onToggleSelection: { messageId in toggleSelection(messageId) }
        )
        .equatable()
    }

    private func shouldAutoScroll(for msg: ChatMessage) -> Bool {
        msg.senderUserId == myId || isPinnedToBottom
    }

    private func invalidateTimeline() {
        timelineVersion &+= 1
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
            replyPreview: replyTarget.map { ComposerReplyPreview(senderName: $0.senderName, text: $0.preview) },
            isSending: isSending,
            isUploadingMedia: isUploadingMedia,
            isRecording: isRecording,
            recordingDuration: recordingDuration,
            placeholder: composerPlaceholder,
            canSendSecureMessage: canSendSecureMessage,
            emojiSuggestions: composerEmojiSuggestions,
            formatRecordingTime: formatRecordingTime,
            onCancelEdit: cancelEdit,
            onCancelReply: cancelReply,
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

    // MARK: - Data loading

    private func loadMessages() async {
        isLoading = true; loadError = nil
        decryptedTexts = [:]
        invalidateTimeline()
        decryptionSummary = nil
        let cached = await ChatLocalStore.shared.cachedMessages(chatId: contact.chatId)
            .map(normalizedMessage)
        if !cached.isEmpty {
            scrollIntent = .bottom(animated: false)
            messages = cached
            invalidateTimeline()
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
            invalidateTimeline()
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
        invalidateTimeline()
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
            invalidateTimeline()
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
            partnerStopTypingTask = nil

        case "messages_read":
            var changed: [ChatMessage] = []
            for i in messages.indices where messages[i].senderUserId == myId && !messages[i].isRead {
                messages[i].isRead = true
                changed.append(messages[i])
            }
            if !changed.isEmpty {
                invalidateTimeline()
                Task { await ChatLocalStore.shared.mergeMessages(changed, chatId: contact.chatId) }
            }

        case "message_reactions_updated":
            guard let mid = payload["message_id"] as? Int,
                  let i = messages.firstIndex(where: { $0.id == mid })
            else { return }
            messages[i].reactions = parseReactions(payload["reactions"])
            let updated = messages[i]
            invalidateTimeline()
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
            invalidateTimeline()
            Task {
                await ChatLocalStore.shared.mergeMessages([edited], chatId: contact.chatId)
                await decryptMessages([edited])
            }

        case "message_pinned":
            if let mid = payload["message_id"] as? Int {
                pinnedMessageIds.insert(mid)
                invalidateTimeline()
            }

        case "message_unpinned":
            if let mid = payload["message_id"] as? Int {
                pinnedMessageIds.remove(mid)
                invalidateTimeline()
            }

        case "messages_deleted":
            let ids = parseDeletedIds(payload)
            guard !ids.isEmpty else { return }
            scrollIntent = .none
            updateWithMotion(.easeInOut(duration: 0.22)) {
                messages.removeAll { ids.contains($0.id) }
                invalidateTimeline()
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
            senderUsername: payload["sender_username"] as? String,
            replyToId: payload["reply_to_id"] as? Int,
            replyMessage: payload["reply_message"] as? String,
            replySenderPub: payload["reply_sender_pub"] as? String,
            forwardFromName: payload["forward_from_name"] as? String,
            forwardFromUserId: payload["forward_from_user_id"] as? Int
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
                invalidateTimeline()
                await ChatLocalStore.shared.mergeMessages(normalized, chatId: contact.chatId)
                await decryptMessages(normalized)
            }
        } catch { }
        isLoadingOlder = false
    }

    // MARK: - Decryption

    private func decryptMessages(_ msgs: [ChatMessage]) async {
        let pem = await Task.detached(priority: .userInitiated) {
            KeychainService.loadPrivateKey()
        }.value
        guard let pem else {
            // Mark every encrypted message with a clear sentinel so the UI never
            // gets stuck on the default "🔐 Encrypted message" placeholder.
            await MainActor.run {
                var didUpdateTimeline = false
                for msg in msgs where msg.isEncrypted {
                    if decryptedTexts[msg.id] == nil {
                        decryptedTexts[msg.id] = "🔒 Введите 24 слова для расшифровки"
                        didUpdateTimeline = true
                    }
                }
                if didUpdateTimeline {
                    invalidateTimeline()
                }
                decryptionSummary = "Ключ не загружен. Войдите заново по секретной фразе."
            }
            return
        }
        var unresolvedCount = 0
        var v3Msgs: [ChatMessage] = []
        var pendingV2: [(id: Int, json: String, isSelf: Bool)] = []

        for msg in msgs where msg.isEncrypted {
            guard decryptedTexts[msg.id] == nil, let json = msg.message else { continue }
            if V3CryptoService.isV3Message(json) {
                v3Msgs.append(msg)
                continue
            }
            pendingV2.append((id: msg.id, json: json, isSelf: msg.senderUserId == myId))
        }

        let v2Result = await Task.detached(priority: .userInitiated) {
            var updates: [Int: String] = [:]
            var failed = 0

            for item in pendingV2 {
                let text = SunCrypto.decryptMessageForDisplay(
                    item.json,
                    isSelf: item.isSelf,
                    privateKeyPEM: pem
                )

                // Critical: ALWAYS populate decryptedTexts so the UI never shows the
                // default "🔐 Encrypted message" fallback.
                if text.isEmpty {
                    updates[item.id] = "[пустое сообщение]"
                    failed += 1
                } else if text == item.json {
                    // Payload didn't match v2 schema and isn't v3. Common causes:
                    // unknown envelope format, or unencrypted JSON (e.g. raw __sunfile)
                    // that happens to start with `{`. Show the raw content if it parses
                    // as a sunfile, otherwise mark as unrecognized.
                    if Self.parseLegacySunfileMarker(item.json) != nil {
                        updates[item.id] = item.json
                    } else {
                        updates[item.id] = "[неизвестный формат]"
                        failed += 1
                    }
                } else {
                    if text.hasPrefix("[") { failed += 1 }
                    updates[item.id] = text
                }
            }

            return (updates: updates, failed: failed)
        }.value

        unresolvedCount += v2Result.failed

        if !v2Result.updates.isEmpty {
            await MainActor.run {
                decryptedTexts.merge(v2Result.updates) { _, new in new }
                invalidateTimeline()
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
    nonisolated private static func parseLegacySunfileMarker(_ text: String) -> Bool? {
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
                invalidateTimeline()
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
            replyToId: msg.replyToId,
            replyMessage: msg.replyMessage,
            replySenderPub: msg.replySenderPub,
            forwardFromName: msg.forwardFromName,
            forwardFromUserId: msg.forwardFromUserId,
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
        let chatId = contact.chatId
        let isGroup = contact.isGroup
        let receiverPEM = contact.publicKey
        let senderPEM = myPublicKey
        let privateKey = try await Task.detached(priority: .utility) { () throws -> String in
            guard let privateKey = KeychainService.loadPrivateKey(), !senderPEM.isEmpty else {
                throw NSError(domain: "sunmsg.draft", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing encryption key."])
            }
            return privateKey
        }.value

        if isGroup {
            let profile = try await session.api.getGroupInfo(chatId: chatId)
            let memberKeys = profile.members.map { $0.publicKey }.filter { !$0.isEmpty }
            guard !memberKeys.isEmpty else {
                throw NSError(domain: "sunmsg.draft", code: 2, userInfo: [NSLocalizedDescriptionKey: "No group recipient keys."])
            }
            return try await Task.detached(priority: .utility) { () throws -> String in
                try SunCrypto.encryptMessageForRecipients(
                    normalized,
                    recipientPEMs: memberKeys,
                    senderPEM: senderPEM,
                    privateKeyPEM: privateKey
                )
            }.value
        }
        guard !receiverPEM.isEmpty else {
            throw NSError(domain: "sunmsg.draft", code: 3, userInfo: [NSLocalizedDescriptionKey: "Missing recipient key."])
        }
        return try await Task.detached(priority: .utility) { () throws -> String in
            try SunCrypto.encryptMessage(
                normalized,
                receiverPEM: receiverPEM,
                senderPEM: senderPEM,
                privateKeyPEM: privateKey
            )
        }.value
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

    // MARK: - Reply, selection, pin, forward

    private func beginReply(message: ChatMessage, currentText: String) {
        dismissMenu()
        editingMessageId = nil
        replyTarget = ReplyTarget(
            id: message.id,
            senderName: senderName(for: message),
            preview: messagePreviewText(currentText)
        )
        composerFocused = true
    }

    private func cancelReply() {
        replyTarget = nil
    }

    private func startSelection(with messageId: Int) {
        selectedMessageIds = [messageId]
        isSelectionMode = true
    }

    private func toggleSelection(_ messageId: Int) {
        guard isSelectionMode else { return }
        if selectedMessageIds.contains(messageId) {
            selectedMessageIds.remove(messageId)
        } else {
            selectedMessageIds.insert(messageId)
        }
        if selectedMessageIds.isEmpty {
            isSelectionMode = false
        }
    }

    private func clearSelection() {
        selectedMessageIds.removeAll()
        isSelectionMode = false
    }

    private func forwardSelectedMessages() {
        guard selectedMessageIds.count == 1,
              let id = selectedMessageIds.first,
              let msg = messages.first(where: { $0.id == id })
        else { return }
        forwardTargetMessage = msg
    }

    private func deleteSelectedMessages() {
        let ids = Array(selectedMessageIds)
        guard !ids.isEmpty else { return }
        if SocketClient.shared.state != .connected {
            sendError = "Нет соединения — удаление будет отправлено после переподключения."
        }
        SocketClient.shared.emit("delete_messages", [
            "msg_ids": ids,
            "chat_id": contact.chatId,
            "mode": "for_me",
            "request_id": UUID().uuidString,
        ])
        scrollIntent = .none
        updateWithMotion(.easeInOut(duration: 0.22)) {
            messages.removeAll { ids.contains($0.id) }
            invalidateTimeline()
        }
        Task { await ChatLocalStore.shared.deleteMessages(ids: ids, chatId: contact.chatId) }
        clearSelection()
    }

    private func togglePin(messageId: Int) {
        dismissMenu()
        guard messageId > 0 else { return }
        let isPinned = pinnedMessageIds.contains(messageId)
        if SocketClient.shared.state != .connected {
            sendError = "Нет соединения — закрепление будет отправлено после переподключения."
        }
        SocketClient.shared.emit(isPinned ? "unpin_message" : "pin_message", [
            "chat_id": contact.chatId,
            "message_id": messageId,
            "request_id": UUID().uuidString,
            "csrf_token": APIClient.shared.csrfToken,
        ])
        updateWithMotion(.spring(response: 0.28, dampingFraction: 0.82)) {
            if isPinned {
                pinnedMessageIds.remove(messageId)
            } else {
                pinnedMessageIds.insert(messageId)
            }
            invalidateTimeline()
        }
        showToast(isPinned ? "Откреплено" : "Закреплено")
    }

    private func forwardMessage(_ message: ChatMessage, to target: Contact) {
        guard let plaintext = resolvedPlainText(for: message),
              !plaintext.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            showToast("Нечего переслать")
            return
        }
        let requestId = UUID().uuidString
        let messageType = message.messageType
        let forwardName = senderName(for: message)
        let forwardUserId = message.senderUserId
        Task {
            do {
                if target.isGroup {
                    try await forwardToGroup(
                        plaintext,
                        target: target,
                        messageType: messageType,
                        requestId: requestId,
                        forwardFromName: forwardName,
                        forwardFromUserId: forwardUserId
                    )
                } else {
                    try await forwardToDirect(
                        plaintext,
                        target: target,
                        messageType: messageType,
                        requestId: requestId,
                        forwardFromName: forwardName,
                        forwardFromUserId: forwardUserId
                    )
                }
                await MainActor.run {
                    clearSelection()
                    showToast("Переслано")
                }
            } catch {
                await MainActor.run { sendError = error.localizedDescription }
            }
        }
    }

    private func forwardToDirect(
        _ plaintext: String,
        target: Contact,
        messageType: String,
        requestId: String,
        forwardFromName: String,
        forwardFromUserId: Int?
    ) async throws {
        let receiverPEM = target.publicKey
        let senderPEM = myPublicKey
        let encrypted = try await Task.detached(priority: .userInitiated) { () throws -> String in
            guard let privateKey = KeychainService.loadPrivateKey(),
                  !receiverPEM.isEmpty,
                  !senderPEM.isEmpty else {
                throw NSError(domain: "sunmsg.crypto", code: 1, userInfo: [NSLocalizedDescriptionKey: "Ключ шифрования не загружен."])
            }
            return try SunCrypto.encryptMessage(
                plaintext,
                receiverPEM: receiverPEM,
                senderPEM: senderPEM,
                privateKeyPEM: privateKey
            )
        }.value
        _ = try await APIClient.shared.sendMessage(
            chatId: target.chatId,
            message: encrypted,
            messageType: messageType,
            requestId: requestId,
            forwardFromName: forwardFromName,
            forwardFromUserId: forwardFromUserId
        )
    }

    private func forwardToGroup(
        _ plaintext: String,
        target: Contact,
        messageType: String,
        requestId: String,
        forwardFromName: String,
        forwardFromUserId: Int?
    ) async throws {
        let senderPEM = myPublicKey
        let profile = try await session.api.getGroupInfo(chatId: target.chatId)
        let memberKeys = profile.members.map { $0.publicKey }.filter { !$0.isEmpty }
        let encrypted = try await Task.detached(priority: .userInitiated) { () throws -> String in
            guard let privateKey = KeychainService.loadPrivateKey(),
                  !senderPEM.isEmpty,
                  !memberKeys.isEmpty else {
                throw NSError(domain: "sunmsg.crypto", code: 1, userInfo: [NSLocalizedDescriptionKey: "Ключ шифрования не загружен."])
            }
            return try SunCrypto.encryptMessageForRecipients(
                plaintext,
                recipientPEMs: memberKeys,
                senderPEM: senderPEM,
                privateKeyPEM: privateKey
            )
        }.value
        await MainActor.run {
            var payload: [String: Any] = [
                "message": encrypted,
                "chat_id": target.chatId,
                "message_type": messageType,
                "client_id": requestId,
                "request_id": requestId,
                "forward_from_name": forwardFromName,
            ]
            if let forwardFromUserId {
                payload["forward_from_user_id"] = forwardFromUserId
            }
            SocketClient.shared.emit("send_message", payload)
        }
    }

    private func resolvedPlainText(for message: ChatMessage) -> String? {
        if let text = decryptedTexts[message.id], !text.isEmpty {
            return text
        }
        if let raw = message.message, !raw.isEmpty, !message.isEncrypted {
            return raw
        }
        if let raw = message.message,
           raw.hasPrefix("{"),
           Self.parseLegacySunfileMarker(raw) == true {
            return raw
        }
        return nil
    }

    private func senderName(for message: ChatMessage) -> String {
        if message.senderUserId == myId { return "Вы" }
        let name = (message.senderDisplayName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !name.isEmpty { return name }
        return contact.displayName
    }

    private func messagePreviewText(_ text: String) -> String {
        let normalized = text.replacingOccurrences(of: "\n", with: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if normalized.isEmpty { return "Сообщение" }
        return String(normalized.prefix(120))
    }

    // MARK: - Edit & delete

    private func beginEdit(message: ChatMessage, currentText: String) {
        dismissMenu()
        replyTarget = nil
        editFocusTask?.cancel()
        editFocusTask = nil
        updateWithMotion(.spring(response: 0.32, dampingFraction: 0.82)) {
            editingMessageId = message.id
            composerText = currentText
        }
        composerFocused = true
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
        guard !text.isEmpty, !isSending else { return }

        isSending = true
        let chatId = contact.chatId
        let receiverPEM = contact.publicKey
        let senderPEM = myPublicKey

        Task {
            do {
                let encrypted = try await Task.detached(priority: .userInitiated) { () throws -> String in
                    guard let privateKey = KeychainService.loadPrivateKey(),
                          !receiverPEM.isEmpty,
                          !senderPEM.isEmpty else {
                        throw NSError(
                            domain: "sunmsg.crypto",
                            code: 1,
                            userInfo: [NSLocalizedDescriptionKey: "Ключ шифрования не загружен."]
                        )
                    }
                    return try SunCrypto.encryptMessage(
                        text,
                        receiverPEM: receiverPEM,
                        senderPEM: senderPEM,
                        privateKeyPEM: privateKey
                    )
                }.value

                await MainActor.run {
                    if SocketClient.shared.state != .connected {
                        sendError = "Нет соединения — изменение будет отправлено после переподключения."
                    }
                    SocketClient.shared.emit("edit_message", [
                        "msg_id": mid,
                        "new_content": encrypted,
                        "chat_id": chatId,
                        "message_type": "text",
                        "request_id": UUID().uuidString,
                    ])
                    // Optimistic local update.
                    if let i = messages.firstIndex(where: { $0.id == mid }) {
                        messages[i].message = encrypted
                        messages[i].isEdited = true
                        decryptedTexts[mid] = text
                        let updated = messages[i]
                        invalidateTimeline()
                        Task { await ChatLocalStore.shared.mergeMessages([updated], chatId: chatId) }
                    }
                    isSending = false
                    cancelEdit()
                }
            } catch {
                await MainActor.run {
                    sendError = error.localizedDescription
                    isSending = false
                }
            }
        }
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
        updateWithMotion(.easeInOut(duration: 0.22)) {
            messages.removeAll { $0.id == id }
            invalidateTimeline()
        }
        Task { await ChatLocalStore.shared.deleteMessages(ids: [id], chatId: contact.chatId) }
        pendingDelete = nil
    }

    // MARK: - Send text message

    private func handleSend() {
        if editingMessageId != nil { saveEdit(); return }
        let text = composerText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isSending else { return }

        isSending = true
        let requestId = UUID().uuidString
        let replyToId = replyTarget?.id
        composerText = ""
        clearDraftAfterSend()
        typingDebounceTask?.cancel()
        typingDebounceTask = nil
        SocketClient.shared.emit("stop_typing", ["chat_id": contact.chatId])

        if contact.isGroup {
            sendGroupText(text, requestId: requestId, replyToId: replyToId)
            return
        }

        let chatId = contact.chatId
        let receiverPEM = contact.publicKey
        let senderPEM = myPublicKey

        Task {
            do {
                let encrypted = try await Task.detached(priority: .userInitiated) { () throws -> String in
                    guard let privateKey = KeychainService.loadPrivateKey(),
                          !receiverPEM.isEmpty,
                          !senderPEM.isEmpty else {
                        throw NSError(
                            domain: "sunmsg.crypto",
                            code: 1,
                            userInfo: [NSLocalizedDescriptionKey: "Ключ шифрования не загружен. Войдите заново по секретной фразе."]
                        )
                    }
                    return try SunCrypto.encryptMessage(
                        text,
                        receiverPEM: receiverPEM,
                        senderPEM: senderPEM,
                        privateKeyPEM: privateKey
                    )
                }.value
                let sent = try await APIClient.shared.sendMessage(
                    chatId: chatId,
                    message: encrypted,
                    requestId: requestId,
                    replyToId: replyToId
                )
                await MainActor.run {
                    let normalized = normalizedMessage(sent)
                    if !messages.contains(where: { $0.id == sent.id }) {
                        scrollIntent = .bottom(animated: true)
                        messages.append(normalized)
                    }
                    decryptedTexts[sent.id] = text
                    invalidateTimeline()
                    sendError = nil
                    isSending = false
                    replyTarget = nil
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

    private func sendGroupText(_ text: String, requestId: String, replyToId: Int?) {
        let senderPEM = myPublicKey

        Task {
            do {
                let privateKey = try await Task.detached(priority: .userInitiated) { () throws -> String in
                    guard let privateKey = KeychainService.loadPrivateKey(),
                          !senderPEM.isEmpty else {
                        throw NSError(
                            domain: "sunmsg.crypto",
                            code: 1,
                            userInfo: [NSLocalizedDescriptionKey: "Ключ шифрования не загружен. Войдите заново по секретной фразе."]
                        )
                    }
                    return privateKey
                }.value
                try await emitEncryptedGroupPayload(
                    text,
                    messageType: "text",
                    requestId: requestId,
                    privateKey: privateKey,
                    replyToId: replyToId,
                    mentionedUsernames: mentionedUsernames(in: text)
                )
                await MainActor.run {
                    replyTarget = nil
                    isSending = false
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

    private func emitEncryptedGroupPayload(
        _ plaintext: String,
        messageType: String,
        requestId: String,
        privateKey: String,
        replyToId: Int? = nil,
        forwardFromName: String? = nil,
        forwardFromUserId: Int? = nil,
        mentionedUsernames: [String] = []
    ) async throws {
        let chatId = contact.chatId
        let senderPEM = myPublicKey
        let profile = try await session.api.getGroupInfo(chatId: chatId)
        let memberKeys = profile.members.map { $0.publicKey }.filter { !$0.isEmpty }
        guard !memberKeys.isEmpty else {
            throw NSError(domain: "sunmsg.group", code: 0, userInfo: [NSLocalizedDescriptionKey: "Не найдены ключи участников группы."])
        }
        let encrypted = try await Task.detached(priority: .userInitiated) { () throws -> String in
            try SunCrypto.encryptMessageForRecipients(
                plaintext,
                recipientPEMs: memberKeys,
                senderPEM: senderPEM,
                privateKeyPEM: privateKey
            )
        }.value
        var payload: [String: Any] = [
            "message": encrypted,
            "chat_id": chatId,
            "message_type": messageType,
            "client_id": requestId,
            "request_id": requestId,
            "mentioned_usernames": mentionedUsernames,
        ]
        if let replyToId {
            payload["reply_to_id"] = replyToId
        }
        if let forwardFromName, !forwardFromName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            payload["forward_from_name"] = forwardFromName
        }
        if let forwardFromUserId {
            payload["forward_from_user_id"] = forwardFromUserId
        }
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
        guard !isRecording else { return }
        let token = UUID()
        recordingStartToken = token
        sendError = nil
        audioRecorder?.stop()
        audioRecorder = nil
        recordingURL = nil
        recordingDuration = 0
        composerFocused = true
        isRecording = true
        startRecordingTimer()

        // AVAudioApplication.requestRecordPermission is the iOS 17+ API.
        AVAudioApplication.requestRecordPermission { granted in
            Task { @MainActor in
                guard self.recordingStartToken == token, self.isRecording else { return }
                guard granted else {
                    self.failRecordingStart("Нет доступа к микрофону. Разрешите в Настройках.")
                    return
                }
                self.beginRecording(token: token)
            }
        }
    }

    private func beginRecording(token: UUID) {
        let tmpURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("voice_\(UUID().uuidString)")
            .appendingPathExtension("m4a")

        Task { @MainActor in
            do {
                let result = try await Task.detached(priority: .userInitiated) {
                    try Self.startVoiceRecorder(at: tmpURL)
                }.value

                guard self.recordingStartToken == token, self.isRecording else {
                    result.recorder.stop()
                    try? FileManager.default.removeItem(at: result.url)
                    return
                }
                guard result.didStart else {
                    result.recorder.stop()
                    try? FileManager.default.removeItem(at: result.url)
                    self.failRecordingStart("Не удалось начать запись.")
                    return
                }
                self.audioRecorder = result.recorder
                self.recordingURL = result.url
            } catch {
                guard self.recordingStartToken == token else {
                    try? FileManager.default.removeItem(at: tmpURL)
                    return
                }
                try? FileManager.default.removeItem(at: tmpURL)
                self.failRecordingStart("Не удалось начать запись.")
            }
        }
    }

    private nonisolated static func startVoiceRecorder(at url: URL) throws -> VoiceRecordingStartResult {
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 44100,
            AVNumberOfChannelsKey: 1,
            AVEncoderBitRateKey: 64000,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .default)
        try session.setActive(true)
        let recorder = try AVAudioRecorder(url: url, settings: settings)
        recorder.prepareToRecord()
        return VoiceRecordingStartResult(
            recorder: recorder,
            url: url,
            didStart: recorder.record()
        )
    }

    private func startRecordingTimer() {
        recordingTimerTask?.cancel()
        let startedAt = Date()
        recordingTimerTask = Task { @MainActor in
            while isRecording && !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 100_000_000)
                if isRecording && !Task.isCancelled {
                    recordingDuration = Date().timeIntervalSince(startedAt)
                }
            }
        }
    }

    private func stopRecordingTimer() {
        recordingTimerTask?.cancel()
        recordingTimerTask = nil
    }

    private func failRecordingStart(_ message: String) {
        recordingStartToken = UUID()
        audioRecorder?.stop()
        audioRecorder = nil
        if let url = recordingURL {
            try? FileManager.default.removeItem(at: url)
        }
        recordingURL = nil
        isRecording = false
        recordingDuration = 0
        stopRecordingTimer()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        sendError = message
    }

    private func stopAndSendRecording() {
        recordingStartToken = UUID()
        audioRecorder?.stop()
        audioRecorder = nil
        isRecording = false
        stopRecordingTimer()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        guard let url = recordingURL else { return }
        let durationSeconds = max(1, Int(recordingDuration.rounded(.down)))
        recordingURL = nil
        Task { await sendAudioMessage(url: url, durationSeconds: durationSeconds) }
    }

    private func cancelRecording() {
        recordingStartToken = UUID()
        audioRecorder?.stop()
        audioRecorder = nil
        isRecording = false
        recordingDuration = 0
        stopRecordingTimer()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        if let url = recordingURL {
            try? FileManager.default.removeItem(at: url)
        }
        recordingURL = nil
    }

    private func sendAudioMessage(url: URL, durationSeconds: Int) async {
        defer { try? FileManager.default.removeItem(at: url) }

        isUploadingMedia = true
        sendError = nil
        let chatId = contact.chatId
        let isGroup = contact.isGroup
        let receiverPEM = contact.publicKey
        let senderPEM = myPublicKey

        do {
            let privateKey = try await Task.detached(priority: .userInitiated) { () throws -> String in
                guard let privateKey = KeychainService.loadPrivateKey(),
                      !senderPEM.isEmpty,
                      (isGroup || !receiverPEM.isEmpty) else {
                    throw NSError(
                        domain: "sunmsg.crypto",
                        code: 1,
                        userInfo: [NSLocalizedDescriptionKey: "Ключ шифрования не загружен."]
                    )
                }
                return privateKey
            }.value
            let data = try await Task.detached(priority: .userInitiated) {
                try Data(contentsOf: url)
            }.value
            let uploadResult = try await APIClient.shared.uploadMedia(
                data: data,
                mimeType: "audio/mp4",
                chatId: chatId
            )

            let sunfilePayload: [String: Any] = [
                "__sunfile": true,
                "url": uploadResult.url,
                "data": uploadResult.url,
                "mime": uploadResult.mime,
                "name": uploadResult.name,
                "size": uploadResult.size,
                "media_type": "voice",
                "duration_seconds": durationSeconds,
                "voice": true,
            ]
            let sunfileJSON = String(data: try JSONSerialization.data(withJSONObject: sunfilePayload), encoding: .utf8) ?? ""

            if isGroup {
                try await emitEncryptedGroupPayload(
                    sunfileJSON,
                    messageType: "voice",
                    requestId: UUID().uuidString,
                    privateKey: privateKey
                )
                await MainActor.run {
                    isUploadingMedia = false
                }
                return
            }

            let encrypted = try await Task.detached(priority: .userInitiated) { () throws -> String in
                try SunCrypto.encryptMessage(
                    sunfileJSON,
                    receiverPEM: receiverPEM,
                    senderPEM: senderPEM,
                    privateKeyPEM: privateKey
                )
            }.value

            let sent = try await APIClient.shared.sendMessage(
                chatId: chatId,
                message: encrypted,
                messageType: "voice",
                requestId: UUID().uuidString
            )

            await MainActor.run {
                let normalized = normalizedMessage(sent)
                if !messages.contains(where: { $0.id == sent.id }) {
                    scrollIntent = .bottom(animated: true)
                    messages.append(normalized)
                }
                decryptedTexts[sent.id] = sunfileJSON
                invalidateTimeline()
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
        let cs = Int((t * 100).rounded(.down)) % 100
        return String(format: "%d:%02d,%02d", m, s, cs)
    }

    // MARK: - Send media message

    private func handleSelectedPhoto(_ item: PhotosPickerItem) async {
        isUploadingMedia = true
        sendError = nil
        selectedPhotoItem = nil
        let chatId = contact.chatId
        let isGroup = contact.isGroup
        let receiverPEM = contact.publicKey
        let senderPEM = myPublicKey

        do {
            let privateKey = try await Task.detached(priority: .userInitiated) { () throws -> String in
                guard let privateKey = KeychainService.loadPrivateKey(),
                      !senderPEM.isEmpty,
                      (isGroup || !receiverPEM.isEmpty) else {
                    throw NSError(
                        domain: "sunmsg.crypto",
                        code: 1,
                        userInfo: [NSLocalizedDescriptionKey: "Ключ шифрования не загружен."]
                    )
                }
                return privateKey
            }.value
            // Load image data — convert to JPEG so the server always gets a known format
            // (raw PhotosPickerItem data may be HEIC which some server-side validators reject)
            guard let rawData = try await item.loadTransferable(type: Data.self) else {
                throw NSError(domain: "media", code: 0, userInfo: [NSLocalizedDescriptionKey: "Не удалось загрузить изображение"])
            }
            let prepared = await Task.detached(priority: .userInitiated) {
                Self.preparePhotoUpload(rawData)
            }.value
            let uploadData = prepared.data
            let uploadMime = prepared.mime

            // Upload to server
            let uploadResult = try await APIClient.shared.uploadMedia(
                data: uploadData,
                mimeType: uploadMime,
                chatId: chatId
            )

            // Build encrypted sunfile payload
            let sunfilePayload: [String: Any] = [
                "__sunfile": true,
                "url": uploadResult.url,
                "data": uploadResult.url,
                "mime": uploadResult.mime,
                "name": uploadResult.name,
                "size": uploadResult.size,
                "media_type": uploadResult.mediaType,
            ]
            let sunfileJSON = String(data: try JSONSerialization.data(withJSONObject: sunfilePayload), encoding: .utf8) ?? ""

            if isGroup {
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
            let encrypted = try await Task.detached(priority: .userInitiated) { () throws -> String in
                try SunCrypto.encryptMessage(
                    sunfileJSON,
                    receiverPEM: receiverPEM,
                    senderPEM: senderPEM,
                    privateKeyPEM: privateKey
                )
            }.value

            let requestId = UUID().uuidString
            let sent = try await APIClient.shared.sendMessage(
                chatId: chatId,
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
                invalidateTimeline()
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

    nonisolated private static func preparePhotoUpload(_ rawData: Data) -> (data: Data, mime: String) {
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
    var isPinned: Bool = false
    var isSelectionMode: Bool = false
    var isSelected: Bool = false
    /// When true, this is a lifted copy shown inside the context-menu overlay:
    /// it neither publishes its anchor nor reacts to long-press.
    var isPreview: Bool = false
    var onToggleReaction: (String) -> Void = { _ in }
    var onRequestMenu: () -> Void = { }
    var onToggleSelection: () -> Void = { }
    private let resolvedBodyText: String
    private let parsedSunfile: SunfileInfo?
    private let parsedCallInfo: SunCallInfo?
    private let resolvedMediaType: String?
    @AppStorage(SettingsClientPreferences.messageScaleKey) private var messageScale = 1.0
    @ScaledMetric(relativeTo: .body) private var messageBodyBaseSize: CGFloat = 15
    @ScaledMetric(relativeTo: .body) private var fallbackBodyBaseSize: CGFloat = 14.5
    @AppStorage(SettingsClientPreferences.bubbleOutKey) private var bubbleOutHex = "#c4943c"
    @AppStorage(SettingsClientPreferences.bubbleInKey) private var bubbleInHex = "#ffffff"
    @AppStorage(SettingsClientPreferences.bubbleOutTextKey) private var bubbleOutTextHex = "#15140e"
    @AppStorage(SettingsClientPreferences.bubbleInTextKey) private var bubbleInTextHex = "#1f1b14"
    @AppStorage(SettingsClientPreferences.bubbleOpacityKey) private var bubbleOpacity = 1.0

    init(
        message: ChatMessage,
        decryptedText: String? = nil,
        isFromMe: Bool,
        showSender: Bool,
        isTail: Bool,
        maxBubbleWidth: CGFloat = 306,
        isPinned: Bool = false,
        isSelectionMode: Bool = false,
        isSelected: Bool = false,
        isPreview: Bool = false,
        onToggleReaction: @escaping (String) -> Void = { _ in },
        onRequestMenu: @escaping () -> Void = { },
        onToggleSelection: @escaping () -> Void = { }
    ) {
        self.message = message
        self.decryptedText = decryptedText
        self.isFromMe = isFromMe
        self.showSender = showSender
        self.isTail = isTail
        self.maxBubbleWidth = maxBubbleWidth
        self.isPinned = isPinned
        self.isSelectionMode = isSelectionMode
        self.isSelected = isSelected
        self.isPreview = isPreview
        self.onToggleReaction = onToggleReaction
        self.onRequestMenu = onRequestMenu
        self.onToggleSelection = onToggleSelection

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
    private var bubbleFill: Color {
        (isFromMe ? Color(hex: bubbleOutHex) : Color(hex: bubbleInHex)).opacity(bubbleOpacity)
    }
    private var bubbleTextColor: Color {
        isFromMe ? Color(hex: bubbleOutTextHex) : Color(hex: bubbleInTextHex)
    }

    var body: some View {
        Group {
            if isPreview {
                bubbleStack
                    .frame(maxWidth: maxBubbleWidth, alignment: bubbleAlignment)
            } else {
                HStack(alignment: .bottom, spacing: 0) {
                    if isSelectionMode && !isFromMe {
                        selectionIndicator
                            .padding(.trailing, 8)
                    }

                    if isFromMe { Spacer(minLength: 46) }

                    bubbleStack
                        .frame(maxWidth: maxBubbleWidth, alignment: bubbleAlignment)
                        .anchorPreference(key: BubbleAnchorKey.self, value: .bounds) {
                            [message.id: $0]
                        }

                    if !isFromMe { Spacer(minLength: 46) }

                    if isSelectionMode && isFromMe {
                        selectionIndicator
                            .padding(.leading, 8)
                    }
                }
            }
        }
        .padding(.vertical, isTail ? 3 : 1.5)
        .contentShape(Rectangle())
        .onTapGesture {
            if isSelectionMode && !isPreview {
                onToggleSelection()
            }
        }
    }

    private var bubbleStack: some View {
        VStack(alignment: stackAlignment, spacing: 3) {
            if showSender, let name = message.senderDisplayName, !name.isEmpty {
                Text(name)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(senderColor(name))
                    .padding(.leading, 4)
            }

            if let forwardFromName = message.forwardFromName?.trimmingCharacters(in: .whitespacesAndNewlines),
               !forwardFromName.isEmpty {
                forwardedLabel(forwardFromName)
            }

            if isPinned {
                pinnedLabel
            }

            if isTextBubble {
                textBubble
                    .contentShape(Rectangle())
                    .onLongPressGesture(minimumDuration: 0.3) { if !isPreview { onRequestMenu() } }
            } else {
                VStack(alignment: stackAlignment, spacing: 4) {
                    if message.messageType == "call" {
                        callContent
                    } else {
                        mediaContent
                    }

                    if !message.reactions.isEmpty {
                        reactionChips
                    }

                    HStack(spacing: 0) {
                        Spacer(minLength: 0)
                        timeRow
                    }
                }
                .contentShape(Rectangle())
                .onLongPressGesture(minimumDuration: 0.3) { if !isPreview { onRequestMenu() } }
            }
        }
    }

    private var selectionIndicator: some View {
        Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
            .font(.system(size: 22, weight: .semibold))
            .foregroundStyle(isSelected ? Color.smAccent : Color.smFaint)
            .frame(width: 28, height: 28)
            .contentShape(Circle())
    }

    private func forwardedLabel(_ name: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: "arrowshape.turn.up.forward.fill")
                .font(.system(size: 10, weight: .semibold))
            Text("Переслано от \(name)")
                .font(.caption2.weight(.semibold))
                .lineLimit(1)
        }
        .foregroundStyle(Color.smAccent2)
        .padding(isFromMe ? .trailing : .leading, 4)
    }

    private var pinnedLabel: some View {
        HStack(spacing: 4) {
            Image(systemName: "pin.fill")
                .font(.system(size: 9.5, weight: .semibold))
            Text("Закреплено")
                .font(.caption2.weight(.semibold))
        }
        .foregroundStyle(Color.smFaint)
        .padding(isFromMe ? .trailing : .leading, 4)
    }

    // MARK: - Time / read-receipt row

    private var timeRow: some View {
        HStack(spacing: 3) {
            if message.isEdited {
                Text("изменено")
                    .font(.caption2.weight(.medium))
                    .foregroundStyle(Color.smFaint)
                    .italic()
            }
            Text(formatBubbleTime(message.createdAt))
                .font(.caption2.monospacedDigit().weight(.medium))
                .foregroundStyle(Color.smFaint)
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
        VStack(alignment: message.reactions.isEmpty ? stackAlignment : .leading, spacing: 5) {
            if let replyText = replyPreviewText {
                replyQuote(replyText)
            }
            if message.reactions.isEmpty {
                textAndInlineMeta
            } else {
                messageText
                inlineReactions
                HStack(spacing: 0) {
                    Spacer(minLength: 0)
                    inlineTimeRow
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 7)
        .padding(.bottom, 7)
        .background(bubbleFill)
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
            .font(.system(size: messageBodyBaseSize * CGFloat(messageScale)))
            .foregroundStyle(bubbleTextColor)
            .lineSpacing(1.5)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var replyPreviewText: String? {
        guard message.replyToId != nil else { return nil }
        let raw = (message.replyMessage ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if raw.isEmpty { return "Сообщение" }
        if Self.parseSunfileRaw(raw) != nil { return "Медиа" }
        if raw.hasPrefix("{") { return "Зашифрованное сообщение" }
        return String(raw.replacingOccurrences(of: "\n", with: " ").prefix(96))
    }

    private func replyQuote(_ text: String) -> some View {
        HStack(spacing: 7) {
            Rectangle()
                .fill(isFromMe ? bubbleTextColor.opacity(0.45) : Color.smAccent)
                .frame(width: 3)
                .clipShape(Capsule())
            Text(text)
                .font(.caption.weight(.medium))
                .foregroundStyle(isFromMe ? bubbleTextColor.opacity(0.76) : Color.smMuted)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(isFromMe ? bubbleTextColor.opacity(0.12) : Color.smSurface.opacity(0.75), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }

    /// Time + edited + read tick, tinted for the bubble's own background.
    private var inlineTimeRow: some View {
        HStack(spacing: 3) {
            if message.isEdited {
                Text("изменено")
                    .font(.caption2.weight(.medium))
                    .italic()
                    .foregroundStyle((isFromMe ? bubbleTextColor : Color.smFaint).opacity(isFromMe ? 0.55 : 1))
            }
            Text(formatBubbleTime(message.createdAt))
                .font(.caption2.monospacedDigit().weight(.medium))
                .foregroundStyle(isFromMe ? bubbleTextColor.opacity(0.6) : Color.smFaint)
            if isFromMe {
                Image(systemName: deliveryIconName)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(message.isRead ? bubbleTextColor.opacity(0.95) : bubbleTextColor.opacity(0.55))
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
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// Reaction chips for media/call bubbles live inside the same message block.
    private var reactionChips: some View {
        ViewThatFits(in: .horizontal) {
            reactionRow(onBubble: false)
            reactionGrid(onBubble: false)
        }
        .fixedSize(horizontal: false, vertical: true)
        .frame(maxWidth: maxBubbleWidth, alignment: .leading)
        .padding(.leading, 4)
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
            columns: [GridItem(.adaptive(minimum: 48, maximum: 84), spacing: 5)],
            alignment: .leading,
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
            ? bubbleTextColor.opacity(0.9)
            : (r.reactedByMe ? Color.smAccent2 : Color.smMuted)

        return Button(action: {
            onToggleReaction(r.emoji)
            ChatHaptics.lightImpact()
        }) {
            HStack(spacing: 3) {
                Text(r.emoji)
                    .font(.body)
                if r.count > 1 {
                    Text("\(r.count)")
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(countColor)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
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
            .font(.system(size: fallbackBodyBaseSize * CGFloat(messageScale)))
            .foregroundStyle(bubbleTextColor)
            .lineSpacing(1)
            .padding(.horizontal, 12)
            .padding(.top, 7)
            .padding(.bottom, 8)
            .background(bubbleFill)
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
                PhotoBubbleView(url: sunfile.fullURL, isFromMe: isFromMe, isTail: isTail, maxWidth: maxBubbleWidth)
            case "video":
                VideoBubbleView(url: sunfile.fullURL, isFromMe: isFromMe, isTail: isTail, maxWidth: maxBubbleWidth)
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
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(isFromMe ? Color.smBubbleOutText : Color.smBubbleInText)
                    .lineLimit(1)
                if let dur = durationText {
                    HStack(spacing: 4) {
                        Image(systemName: "clock")
                            .font(.system(size: 9.5))
                            .foregroundStyle((isFromMe ? Color.smBubbleOutText : Color.smBubbleInText).opacity(0.55))
                        Text(dur)
                            .font(.caption2.monospacedDigit().weight(.medium))
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

private struct FullscreenPhotoDraft: Identifiable {
    let id = UUID()
    let image: UIImage
}

struct PhotoBubbleView: View {
    let url: URL?
    let isFromMe: Bool
    let isTail: Bool
    let maxWidth: CGFloat
    @State private var image: UIImage?
    @State private var loadFailed = false
    @State private var fullscreenPhoto: FullscreenPhotoDraft?

    private var mediaWidth: CGFloat {
        min(260, max(120, maxWidth))
    }

    var body: some View {
        Button(action: {
            if let image {
                fullscreenPhoto = FullscreenPhotoDraft(image: image)
            }
        }) {
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
            .frame(width: mediaWidth, height: mediaWidth * 0.727)
            .clipShape(BubbleShape(isFromMe: isFromMe, isTail: isTail))
            .overlay(
                BubbleShape(isFromMe: isFromMe, isTail: isTail)
                    .stroke(Color.smBorderSoft, lineWidth: 0.5)
            )
            .shadow(color: Color.black.opacity(0.12), radius: 2, x: 0, y: 1)
        }
        .buttonStyle(.plain)
        .task(id: url) { await loadImage() }
        .fullScreenCover(item: $fullscreenPhoto) { draft in
            FullscreenImageView(
                image: draft.image,
                onDismiss: { fullscreenPhoto = nil }
            )
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
    let onDismiss: () -> Void
    @State private var scale: CGFloat = 1

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .scaleEffect(scale)
                .gesture(
                    MagnifyGesture()
                        .onChanged { value in scale = max(1, min(4, value.magnification)) }
                        .onEnded { _ in withAnimation { scale = 1 } }
                )
                .ignoresSafeArea()
            VStack {
                HStack {
                    Spacer()
                    Button(action: onDismiss) {
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

private struct VideoPlayerDraft: Identifiable {
    let id = UUID()
    let url: URL
}

struct VideoBubbleView: View {
    let url: URL?
    let isFromMe: Bool
    let isTail: Bool
    let maxWidth: CGFloat
    @State private var playerDraft: VideoPlayerDraft?
    @State private var thumbnail: UIImage?
    /// Resolved playback URL (may be a local temp file if web-encrypted).
    @State private var effectiveURL: URL?
    @State private var decryptedTempURL: URL?

    private var mediaWidth: CGFloat {
        min(260, max(120, maxWidth))
    }

    var body: some View {
        Button(action: {
            if let effectiveURL {
                playerDraft = VideoPlayerDraft(url: effectiveURL)
            }
        }) {
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
            .frame(width: mediaWidth, height: mediaWidth * 0.727)
            .clipShape(BubbleShape(isFromMe: isFromMe, isTail: isTail))
            .overlay(
                BubbleShape(isFromMe: isFromMe, isTail: isTail)
                    .stroke(Color.smBorderSoft, lineWidth: 0.5)
            )
        }
        .buttonStyle(.plain)
        .task(id: url) { await resolveAndLoadThumbnail() }
        .onDisappear { removeDecryptedTempFile() }
        .fullScreenCover(item: $playerDraft) { draft in
            VideoPlayerSheet(
                url: draft.url,
                onDismiss: { playerDraft = nil }
            )
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
    let onDismiss: () -> Void
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
                    Button(action: onDismiss) {
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
    @State private var player = AudioPlayerController()
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
                    .font(.caption2.monospacedDigit().weight(.medium))
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
@Observable
final class AudioPlayerController {
    var isPlaying: Bool = false
    var elapsed: Double = 0
    var duration: Double = 0
    @ObservationIgnored
    private var player: AVPlayer?
    @ObservationIgnored
    private var timeObserver: Any?
    @ObservationIgnored
    private var endObserver: NSObjectProtocol?
    @ObservationIgnored
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
            guard preparedURL == url else { return }
            duration = d.isFinite ? d : 0
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

private struct ShareFileDraft: Identifiable {
    let id = UUID()
    let url: URL
}

struct FileBubbleView: View {
    let url: URL?
    let name: String
    let size: Int
    let isFromMe: Bool
    let isTail: Bool
    @State private var shareDraft: ShareFileDraft?
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
            if let resolvedURL {
                shareDraft = ShareFileDraft(url: resolvedURL)
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
                        .font(.caption.weight(.medium))
                        .foregroundStyle(isFromMe ? Color.smBubbleOutText : Color.smText)
                        .lineLimit(1)
                    if !sizeText.isEmpty {
                        Text(sizeText)
                            .font(.caption2)
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
        .sheet(item: $shareDraft, onDismiss: removeDecryptedTempFile) { draft in
            ShareSheet(items: [draft.url])
        }
        .onDisappear { removeDecryptedTempFile() }
    }

    private func resolveForShare(url: URL) async {
        guard self.url == url else { return }
        guard let e2ee = SunMediaE2EE.parse(url: url) else {
            resolvedURL = url
            shareDraft = ShareFileDraft(url: url)
            return
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
            shareDraft = ShareFileDraft(url: tmpURL)
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
