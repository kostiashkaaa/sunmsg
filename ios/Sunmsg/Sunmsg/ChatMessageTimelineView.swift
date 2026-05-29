import Foundation
import SwiftUI

enum ChatScrollIntent: Equatable {
    case bottom(animated: Bool)
    case preserve(id: Int)
    case none
}

struct ChatMessageTimelineView: View, Equatable {
    let messages: [ChatMessage]
    let decryptedTexts: [Int: String]
    let myId: Int
    let isGroup: Bool
    let hasOlderMessages: Bool
    let isLoading: Bool
    let isLoadingOlder: Bool
    let partnerIsTyping: Bool
    let menuTargetId: Int?
    let selectedMessageIds: Set<Int>
    let isSelectionMode: Bool
    let pinnedMessageIds: Set<Int>
    let reduceMotion: Bool
    let timelineVersion: Int
    @Binding var scrollIntent: ChatScrollIntent
    @Binding var isPinnedToBottom: Bool
    let onLoadOlder: () -> Void
    let onToggleReaction: (Int, String) -> Void
    let onRequestMenu: (Int) -> Void
    let onToggleSelection: (Int) -> Void

    private struct MessageRenderRow: Identifiable, Equatable {
        let id: Int
        let message: ChatMessage
        let decryptedText: String?
        let isFromMe: Bool
        let showSender: Bool
        let isTail: Bool
        let showsDate: Bool

        static func == (lhs: MessageRenderRow, rhs: MessageRenderRow) -> Bool {
            lhs.id == rhs.id
                && lhs.decryptedText == rhs.decryptedText
                && lhs.isFromMe == rhs.isFromMe
                && lhs.showSender == rhs.showSender
                && lhs.isTail == rhs.isTail
                && lhs.showsDate == rhs.showsDate
                && lhs.message.message == rhs.message.message
                && lhs.message.messageType == rhs.message.messageType
                && lhs.message.createdAt == rhs.message.createdAt
                && lhs.message.senderUserId == rhs.message.senderUserId
                && lhs.message.senderDisplayName == rhs.message.senderDisplayName
                && lhs.message.senderUsername == rhs.message.senderUsername
                && lhs.message.replyToId == rhs.message.replyToId
                && lhs.message.replyMessage == rhs.message.replyMessage
                && lhs.message.forwardFromName == rhs.message.forwardFromName
                && lhs.message.reactions == rhs.message.reactions
                && lhs.message.isEdited == rhs.message.isEdited
                && lhs.message.isRead == rhs.message.isRead
                && lhs.message.isDelivered == rhs.message.isDelivered
        }
    }

    private struct TimelineMessageRowView: View, Equatable {
        let row: MessageRenderRow
        let maxBubbleWidth: CGFloat
        let isPinned: Bool
        let isSelectionMode: Bool
        let isSelected: Bool
        let isMenuTarget: Bool
        let onToggleReaction: (Int, String) -> Void
        let onRequestMenu: (Int) -> Void
        let onToggleSelection: (Int) -> Void

        static func == (lhs: TimelineMessageRowView, rhs: TimelineMessageRowView) -> Bool {
            lhs.row == rhs.row
                && lhs.maxBubbleWidth == rhs.maxBubbleWidth
                && lhs.isPinned == rhs.isPinned
                && lhs.isSelectionMode == rhs.isSelectionMode
                && lhs.isSelected == rhs.isSelected
                && lhs.isMenuTarget == rhs.isMenuTarget
        }

        var body: some View {
            if row.showsDate {
                DateChipView(timestamp: row.message.createdAt)
            }

            MessageBubbleView(
                message: row.message,
                decryptedText: row.decryptedText,
                isFromMe: row.isFromMe,
                showSender: row.showSender,
                isTail: row.isTail,
                maxBubbleWidth: maxBubbleWidth,
                isPinned: isPinned,
                isSelectionMode: isSelectionMode,
                isSelected: isSelected,
                onToggleReaction: { emoji in onToggleReaction(row.id, emoji) },
                onRequestMenu: { onRequestMenu(row.id) },
                onToggleSelection: { onToggleSelection(row.id) }
            )
            .id(row.id)
            .opacity(isMenuTarget ? 0 : 1)
        }
    }

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
        selectedMessageIds: Set<Int>,
        isSelectionMode: Bool,
        pinnedMessageIds: Set<Int>,
        reduceMotion: Bool,
        timelineVersion: Int,
        scrollIntent: Binding<ChatScrollIntent>,
        isPinnedToBottom: Binding<Bool>,
        onLoadOlder: @escaping () -> Void,
        onToggleReaction: @escaping (Int, String) -> Void,
        onRequestMenu: @escaping (Int) -> Void,
        onToggleSelection: @escaping (Int) -> Void
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
        self.selectedMessageIds = selectedMessageIds
        self.isSelectionMode = isSelectionMode
        self.pinnedMessageIds = pinnedMessageIds
        self.reduceMotion = reduceMotion
        self.timelineVersion = timelineVersion
        self._scrollIntent = scrollIntent
        self._isPinnedToBottom = isPinnedToBottom
        self.onLoadOlder = onLoadOlder
        self.onToggleReaction = onToggleReaction
        self.onRequestMenu = onRequestMenu
        self.onToggleSelection = onToggleSelection
    }

    static func == (lhs: ChatMessageTimelineView, rhs: ChatMessageTimelineView) -> Bool {
        lhs.myId == rhs.myId
            && lhs.isGroup == rhs.isGroup
            && lhs.hasOlderMessages == rhs.hasOlderMessages
            && lhs.isLoading == rhs.isLoading
            && lhs.isLoadingOlder == rhs.isLoadingOlder
            && lhs.partnerIsTyping == rhs.partnerIsTyping
            && lhs.menuTargetId == rhs.menuTargetId
            && lhs.selectedMessageIds == rhs.selectedMessageIds
            && lhs.isSelectionMode == rhs.isSelectionMode
            && lhs.pinnedMessageIds == rhs.pinnedMessageIds
            && lhs.reduceMotion == rhs.reduceMotion
            && lhs.timelineVersion == rhs.timelineVersion
            && lhs.scrollIntent == rhs.scrollIntent
            && lhs.isPinnedToBottom == rhs.isPinnedToBottom
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
                    showSender: Self.shouldShowSender(
                        current: message,
                        previous: previous,
                        isFromMe: isFromMe,
                        isGroup: isGroup
                    ),
                    isTail: Self.isTail(current: message, next: next, isFromMe: isFromMe, myId: myId),
                    showsDate: Self.shouldShowDate(current: message, previous: previous)
                )
            )
        }

        return result
    }

    var body: some View {
        GeometryReader { viewportProxy in
            let rows = Self.makeRows(
                messages: messages,
                decryptedTexts: decryptedTexts,
                myId: myId,
                isGroup: isGroup
            )
            let maxBubbleWidth = Self.messageMaxBubbleWidth(forViewportWidth: viewportProxy.size.width)

            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 0) {
                        olderMessagesControl

                        ForEach(rows) { row in
                            TimelineMessageRowView(
                                row: row,
                                maxBubbleWidth: maxBubbleWidth,
                                isPinned: pinnedMessageIds.contains(row.id),
                                isSelectionMode: isSelectionMode,
                                isSelected: selectedMessageIds.contains(row.id),
                                isMenuTarget: menuTargetId == row.id,
                                onToggleReaction: onToggleReaction,
                                onRequestMenu: onRequestMenu,
                                onToggleSelection: onToggleSelection
                            )
                            .equatable()
                        }

                        if partnerIsTyping {
                            TypingBubbleView()
                                .id("typing")
                                .transition(reduceMotion ? .opacity : .opacity.combined(with: .move(edge: .bottom)))
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
                .scrollIndicators(.hidden)
                .defaultScrollAnchor(.bottom)
                .scrollDismissesKeyboard(.never)
                .onAppear { scrollToBottom(proxy, animated: false) }
                .onPreferenceChange(MessageBottomOffsetKey.self) { bottomY in
                    updatePinnedToBottom(
                        bottomY: bottomY,
                        viewportHeight: viewportProxy.size.height
                    )
                }
                .onChange(of: messages.count) { _, _ in
                    applyScrollIntent(proxy)
                }
                .onChange(of: decryptedTexts.count) { _, _ in
                    if isPinnedToBottom {
                        scrollToBottom(proxy, animated: false)
                    }
                }
                .onChange(of: partnerIsTyping) { _, typing in
                    if typing && isPinnedToBottom {
                        performScroll(proxy, target: "typing", anchor: .bottom, animated: true)
                    }
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
            performScroll(proxy, target: "typing", anchor: .bottom, animated: animated)
            isPinnedToBottom = true
            return
        }

        guard let last = messages.last else { return }
        performScroll(proxy, target: last.id, anchor: .bottom, animated: animated)
        isPinnedToBottom = true
    }

    private func performScroll<ID: Hashable>(
        _ proxy: ScrollViewProxy,
        target: ID,
        anchor: UnitPoint,
        animated: Bool
    ) {
        guard animated, !reduceMotion else {
            proxy.scrollTo(target, anchor: anchor)
            return
        }
        withAnimation(.easeOut(duration: 0.22)) {
            proxy.scrollTo(target, anchor: anchor)
        }
    }

    private func updatePinnedToBottom(bottomY: CGFloat, viewportHeight: CGFloat) {
        guard viewportHeight > 0, bottomY > 0 else { return }
        let pinned = bottomY <= viewportHeight + 72
        if pinned != isPinnedToBottom {
            isPinnedToBottom = pinned
        }
    }

    private static func messageMaxBubbleWidth(forViewportWidth width: CGFloat) -> CGFloat {
        let columnWidth = max(0, width - 28)
        guard columnWidth > 0 else { return 306 }
        return min(306, max(0, columnWidth - 46))
    }

    private static func shouldShowDate(current: ChatMessage, previous: ChatMessage?) -> Bool {
        guard let previous else { return true }
        let calendar = Calendar.current
        return !calendar.isDate(
            Date(timeIntervalSince1970: current.createdAt),
            inSameDayAs: Date(timeIntervalSince1970: previous.createdAt)
        )
    }

    private static func shouldShowSender(
        current: ChatMessage,
        previous: ChatMessage?,
        isFromMe: Bool,
        isGroup: Bool
    ) -> Bool {
        guard isGroup, !isFromMe else { return false }
        guard let previous else { return true }
        return previous.senderUserId != current.senderUserId
            || shouldShowDate(current: current, previous: previous)
    }

    private static func isTail(current: ChatMessage, next: ChatMessage?, isFromMe: Bool, myId: Int) -> Bool {
        guard let next else { return true }
        let nextIsMe = next.senderUserId == myId
        return nextIsMe != isFromMe
            || next.senderUserId != current.senderUserId
            || shouldShowDate(current: next, previous: current)
    }
}

private struct DateChipView: View {
    let timestamp: Double

    private var label: String {
        let date = Date(timeIntervalSince1970: timestamp)
        let calendar = Calendar.current
        if calendar.isDateInToday(date) { return "Сегодня" }
        if calendar.isDateInYesterday(date) { return "Вчера" }
        return SunDateFormatters.ruDayMonth(from: date)
    }

    var body: some View {
        HStack(spacing: 0) {
            Spacer(minLength: 0)
            Text(label)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(Color.smMuted)
                .padding(.horizontal, 9)
                .padding(.vertical, 3)
                .background(Color.smSurface.opacity(0.86), in: Capsule())
                .overlay(Capsule().stroke(Color.smBorderSoft, lineWidth: 0.5))
            Spacer(minLength: 0)
        }
        .padding(.vertical, 5)
    }
}

private struct TypingBubbleView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private static let stepInterval: TimeInterval = 0.18

    var body: some View {
        if reduceMotion {
            bubble(phase: 1, animated: false)
        } else {
            TimelineView(.periodic(from: .now, by: Self.stepInterval)) { timeline in
                bubble(phase: Self.phase(for: timeline.date), animated: true)
            }
        }
    }

    private func bubble(phase: Int, animated: Bool) -> some View {
        HStack(alignment: .bottom, spacing: 0) {
            HStack(spacing: 4) {
                ForEach(0..<3, id: \.self) { i in
                    Circle()
                        .fill(Color.smFaint)
                        .frame(width: 6, height: 6)
                        .scaleEffect(animated ? (phase == i ? 1.25 : 0.85) : 1.0)
                        .opacity(animated ? (phase == i ? 1.0 : 0.4) : 1.0)
                        .animation(animated ? .easeInOut(duration: Self.stepInterval) : nil, value: phase)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(Color.smBubbleIn)
            .clipShape(RoundedRectangle(cornerRadius: 18).corners(bottomLeft: 6))
            .overlay(
                RoundedRectangle(cornerRadius: 18).corners(bottomLeft: 6)
                    .stroke(Color.smBorderSoft, lineWidth: 0.5)
            )
            .shadow(color: Color(hex: "#281e0f").opacity(0.04), radius: 1, x: 0, y: 1)

            Spacer(minLength: 44)
        }
        .padding(.vertical, 3)
    }

    private static func phase(for date: Date) -> Int {
        Int((date.timeIntervalSinceReferenceDate / stepInterval).rounded(.down)) % 3
    }
}

private extension RoundedRectangle {
    func corners(bottomLeft: CGFloat = 18) -> some Shape {
        BubbleBottomLeftShape(cornerRadius: 18, tailRadius: bottomLeft)
    }
}

private struct BubbleBottomLeftShape: Shape {
    let cornerRadius: CGFloat
    let tailRadius: CGFloat

    func path(in rect: CGRect) -> Path {
        var path = Path()
        let radius = cornerRadius
        let tail = tailRadius

        path.move(to: CGPoint(x: rect.minX + radius, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX - radius, y: rect.minY))
        path.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.minY + radius), control: CGPoint(x: rect.maxX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY - radius))
        path.addQuadCurve(to: CGPoint(x: rect.maxX - radius, y: rect.maxY), control: CGPoint(x: rect.maxX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX + tail, y: rect.maxY))
        path.addQuadCurve(to: CGPoint(x: rect.minX, y: rect.maxY - tail), control: CGPoint(x: rect.minX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.minX, y: rect.minY + radius))
        path.addQuadCurve(to: CGPoint(x: rect.minX + radius, y: rect.minY), control: CGPoint(x: rect.minX, y: rect.minY))
        path.closeSubpath()
        return path
    }
}

private struct MessageBottomOffsetKey: PreferenceKey {
    static let defaultValue: CGFloat = 0
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}
