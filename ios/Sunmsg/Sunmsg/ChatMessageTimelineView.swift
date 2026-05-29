import Foundation
import SwiftUI

enum ChatScrollIntent {
    case bottom(animated: Bool)
    case preserve(id: Int)
    case none
}

struct ChatMessageTimelineView: View {
    let messages: [ChatMessage]
    let decryptedTexts: [Int: String]
    let myId: Int
    let isGroup: Bool
    let hasOlderMessages: Bool
    let isLoading: Bool
    let isLoadingOlder: Bool
    let partnerIsTyping: Bool
    let menuTargetId: Int?
    @Binding var scrollIntent: ChatScrollIntent
    @Binding var isPinnedToBottom: Bool
    let onLoadOlder: () -> Void
    let onToggleReaction: (Int, String) -> Void
    let onRequestMenu: (Int) -> Void

    @State private var viewportHeight: CGFloat = 0

    private struct MessageRenderRow: Identifiable {
        let id: Int
        let message: ChatMessage
        let decryptedText: String?
        let isFromMe: Bool
        let showSender: Bool
        let isTail: Bool
        let showsDate: Bool
    }

    private let rows: [MessageRenderRow]

    init(
        messages: [ChatMessage],
        decryptedTexts: [Int: String],
        myId: Int,
        isGroup: Bool,
        hasOlderMessages: Bool,
        isLoading: Bool,
        isLoadingOlder: Bool,
        partnerIsTyping: Bool,
        menuTargetId: Int?,
        scrollIntent: Binding<ChatScrollIntent>,
        isPinnedToBottom: Binding<Bool>,
        onLoadOlder: @escaping () -> Void,
        onToggleReaction: @escaping (Int, String) -> Void,
        onRequestMenu: @escaping (Int) -> Void
    ) {
        self.messages = messages
        self.decryptedTexts = decryptedTexts
        self.myId = myId
        self.isGroup = isGroup
        self.hasOlderMessages = hasOlderMessages
        self.isLoading = isLoading
        self.isLoadingOlder = isLoadingOlder
        self.partnerIsTyping = partnerIsTyping
        self.menuTargetId = menuTargetId
        self._scrollIntent = scrollIntent
        self._isPinnedToBottom = isPinnedToBottom
        self.onLoadOlder = onLoadOlder
        self.onToggleReaction = onToggleReaction
        self.onRequestMenu = onRequestMenu
        self.rows = Self.makeRows(
            messages: messages,
            decryptedTexts: decryptedTexts,
            myId: myId,
            isGroup: isGroup
        )
    }

    private static func makeRows(
        messages: [ChatMessage],
        decryptedTexts: [Int: String],
        myId: Int,
        isGroup: Bool
    ) -> [MessageRenderRow] {
        var result: [MessageRenderRow] = []
        result.reserveCapacity(messages.count)

        for idx in messages.indices {
            let message = messages[idx]
            let previous = idx > messages.startIndex ? messages[messages.index(before: idx)] : nil
            let next = idx < messages.index(before: messages.endIndex) ? messages[messages.index(after: idx)] : nil
            let isFromMe = message.senderUserId == myId
            result.append(
                MessageRenderRow(
                    id: message.id,
                    message: message,
                    decryptedText: decryptedTexts[message.id],
                    isFromMe: isFromMe,
                    showSender: !isFromMe && isGroup,
                    isTail: Self.isTail(current: message, next: next, isFromMe: isFromMe, myId: myId),
                    showsDate: Self.shouldShowDate(current: message, previous: previous)
                )
            )
        }

        return result
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(spacing: 0) {
                    olderMessagesControl

                    ForEach(rows) { row in
                        if row.showsDate {
                            DateChipView(timestamp: row.message.createdAt)
                        }

                        MessageBubbleView(
                            message: row.message,
                            decryptedText: row.decryptedText,
                            isFromMe: row.isFromMe,
                            showSender: row.showSender,
                            isTail: row.isTail,
                            onToggleReaction: { emoji in onToggleReaction(row.id, emoji) },
                            onRequestMenu: { onRequestMenu(row.id) }
                        )
                        .id(row.id)
                        .opacity(menuTargetId == row.id ? 0 : 1)
                    }

                    if partnerIsTyping {
                        TypingBubbleView()
                            .id("typing")
                            .transition(.opacity.combined(with: .move(edge: .bottom)))
                    }

                    Color.clear
                        .frame(height: 1)
                        .id("bottom_anchor")
                        .background(
                            GeometryReader { proxy in
                                Color.clear.preference(
                                    key: MessageBottomOffsetKey.self,
                                    value: proxy.frame(in: .named("message_scroll")).maxY
                                )
                            }
                        )
                }
                .padding(.horizontal, 14)
                .padding(.top, 8)
                .padding(.bottom, 6)
            }
            .coordinateSpace(name: "message_scroll")
            .background(
                GeometryReader { proxy in
                    Color.clear.preference(key: MessageViewportHeightKey.self, value: proxy.size.height)
                }
            )
            .scrollIndicators(.hidden)
            .defaultScrollAnchor(.bottom)
            .scrollDismissesKeyboard(.interactively)
            .onAppear { scrollToBottom(proxy, animated: false) }
            .onPreferenceChange(MessageViewportHeightKey.self) { height in
                let changed = abs(viewportHeight - height) > 0.5
                guard changed else { return }
                viewportHeight = height
            }
            .onPreferenceChange(MessageBottomOffsetKey.self) { bottomY in
                updatePinnedToBottom(bottomY: bottomY)
            }
            .onChange(of: messages.count) { _, _ in
                applyScrollIntent(proxy)
            }
            .onChange(of: partnerIsTyping) { _, typing in
                if typing && isPinnedToBottom {
                    withAnimation { proxy.scrollTo("typing", anchor: .bottom) }
                }
            }
        }
    }

    @ViewBuilder
    private var olderMessagesControl: some View {
        if hasOlderMessages && !isLoading {
            Group {
                if isLoadingOlder {
                    ProgressView()
                        .tint(Color.smAccent)
                        .frame(maxWidth: .infinity, minHeight: 44)
                } else {
                    Button(action: onLoadOlder) {
                        Text("Загрузить ранние сообщения")
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Color.smAccent)
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.plain)
                }
            }
            .id("older_loader")
        }
    }

    private func applyScrollIntent(_ proxy: ScrollViewProxy) {
        switch scrollIntent {
        case .bottom(let animated):
            scrollToBottom(proxy, animated: animated)
        case .preserve(let id):
            proxy.scrollTo(id, anchor: .top)
        case .none:
            break
        }
        scrollIntent = .none
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy, animated: Bool) {
        if partnerIsTyping {
            if animated { withAnimation { proxy.scrollTo("typing", anchor: .bottom) } }
            else { proxy.scrollTo("typing", anchor: .bottom) }
            isPinnedToBottom = true
            return
        }

        guard let last = messages.last else { return }
        if animated { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
        else { proxy.scrollTo(last.id, anchor: .bottom) }
        isPinnedToBottom = true
    }

    private func updatePinnedToBottom(bottomY: CGFloat) {
        guard viewportHeight > 0, bottomY > 0 else { return }
        let pinned = bottomY <= viewportHeight + 72
        if pinned != isPinnedToBottom {
            isPinnedToBottom = pinned
        }
    }

    private static func shouldShowDate(current: ChatMessage, previous: ChatMessage?) -> Bool {
        guard let previous else { return true }
        let calendar = Calendar.current
        return !calendar.isDate(
            Date(timeIntervalSince1970: current.createdAt),
            inSameDayAs: Date(timeIntervalSince1970: previous.createdAt)
        )
    }

    private static func isTail(current: ChatMessage, next: ChatMessage?, isFromMe: Bool, myId: Int) -> Bool {
        guard let next else { return true }
        let nextIsMe = next.senderUserId == myId
        return nextIsMe != isFromMe || next.senderUserId != current.senderUserId
    }
}

private struct MessageViewportHeightKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct MessageBottomOffsetKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}
