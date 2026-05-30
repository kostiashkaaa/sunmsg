import SwiftUI

struct ChatTopBarView: View {
    let contact: Contact
    let statusText: String
    let isSavedMessages: Bool
    let isTyping: Bool
    let onBack: () -> Void
    let onOpenProfile: () -> Void

    private typealias Metrics = ChatDesignMetrics.TopBar

    var body: some View {
        HStack(spacing: 0) {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 21, weight: .semibold))
                    .foregroundStyle(Color.smAccent)
                    .frame(width: Metrics.backTouchSize, height: Metrics.backTouchSize)
                    .contentShape(Circle())
            }
            .buttonStyle(PressableStyle(scale: 0.88))
            .frame(width: Metrics.sideWidth, height: Metrics.barHeight)
            .accessibilityLabel("Back")

            ChatHeaderView(
                contact: contact,
                statusText: statusText,
                isSavedMessages: isSavedMessages,
                isTyping: isTyping,
                onOpenProfile: onOpenProfile
            )
            .frame(maxWidth: .infinity, alignment: .center)

            Color.clear
                .frame(width: Metrics.sideWidth, height: Metrics.barHeight)
                .accessibilityHidden(true)
        }
        .frame(height: Metrics.barHeight)
        .background(.regularMaterial)
        .background(Color.smBg.opacity(0.92))
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Color.smBorderSoft)
                .frame(height: 0.5)
        }
    }
}

struct ChatHeaderView: View {
    let contact: Contact
    let statusText: String
    let isSavedMessages: Bool
    let isTyping: Bool
    let onOpenProfile: () -> Void

    private var displayName: String {
        isSavedMessages ? "Избранное" : contact.displayName
    }

    private var statusColor: Color {
        if isTyping { return Color.smAccent }
        if contact.isOnline && !isSavedMessages { return Color.smOnline }
        return Color.smFaint
    }

    var body: some View {
        Button(action: onOpenProfile) {
            HStack(spacing: 9) {
                avatar

                VStack(alignment: .leading, spacing: ChatDesignMetrics.TopBar.titleStatusSpacing) {
                    HStack(spacing: 4) {
                        Text(displayName)
                            .font(.headline.weight(.semibold))
                            .foregroundStyle(Color.smText)
                            .lineLimit(1)
                            .minimumScaleFactor(0.82)
                            .layoutPriority(1)

                        if !contact.isGroup && !isSavedMessages {
                            Image(systemName: "lock.fill")
                                .font(.system(size: 9, weight: .medium))
                                .foregroundStyle(Color.smOnline.opacity(0.85))
                                .accessibilityHidden(true)
                        }
                    }

                    Text(statusText)
                        .font(isTyping ? .caption.italic() : .caption)
                        .foregroundStyle(statusColor)
                        .lineLimit(1)
                        .minimumScaleFactor(0.86)
                }
                .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, ChatDesignMetrics.TopBar.contentHorizontalPadding)
            .frame(minWidth: 0, maxWidth: .infinity, alignment: .center)
            .frame(height: ChatDesignMetrics.TopBar.headerHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(displayName), \(statusText)")
    }

    @ViewBuilder
    private var avatar: some View {
        ZStack(alignment: .bottomTrailing) {
            if isSavedMessages {
                ZStack {
                    Circle()
                        .fill(Color.smAccent)
                    Image(systemName: "bookmark.fill")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(Color.smSurface)
                }
                .frame(width: ChatDesignMetrics.TopBar.avatarSize, height: ChatDesignMetrics.TopBar.avatarSize)
            } else {
                SmAvatarView(
                    name: contact.displayName,
                    avatarUrl: contact.avatarUrl,
                    isGroup: contact.isGroup,
                    size: ChatDesignMetrics.TopBar.avatarSize
                )
            }

            if contact.isOnline && !isSavedMessages {
                Circle()
                    .fill(Color.smOnline)
                    .frame(width: 10, height: 10)
                    .overlay(Circle().stroke(Color.smBg, lineWidth: 2))
                    .accessibilityHidden(true)
            }
        }
    }
}
