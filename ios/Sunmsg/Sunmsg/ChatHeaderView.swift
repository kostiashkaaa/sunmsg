import SwiftUI

struct ChatTopBarView: View {
    let contact: Contact
    let statusText: String
    let isSavedMessages: Bool
    let isTyping: Bool
    let onBack: () -> Void
    let onOpenProfile: () -> Void

    var body: some View {
        HStack(spacing: 4) {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    .font(.system(size: 21, weight: .semibold))
                    .foregroundStyle(Color.smAccent)
                    .frame(width: 42, height: 48)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PressableStyle(scale: 0.88))
            .accessibilityLabel("Back")

            ChatHeaderView(
                contact: contact,
                statusText: statusText,
                isSavedMessages: isSavedMessages,
                isTyping: isTyping,
                onOpenProfile: onOpenProfile
            )
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.leading, 2)
        .padding(.trailing, 12)
        .frame(height: 50)
        .background(Color.smBg)
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
            HStack(spacing: 8) {
                avatar

                VStack(alignment: .leading, spacing: 1) {
                    HStack(spacing: 4) {
                        Text(displayName)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.smText)
                            .lineLimit(1)
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
                }
                .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
            }
            .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
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
                .frame(width: 32, height: 32)
            } else {
                SmAvatarView(
                    name: contact.displayName,
                    avatarUrl: contact.avatarUrl,
                    isGroup: contact.isGroup,
                    size: 32
                )
            }

            if contact.isOnline && !isSavedMessages {
                Circle()
                    .fill(Color.smOnline)
                    .frame(width: 9, height: 9)
                    .overlay(Circle().stroke(Color.smBg, lineWidth: 2))
                    .accessibilityHidden(true)
            }
        }
    }
}
