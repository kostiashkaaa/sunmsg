import SwiftUI

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
                            .font(.system(size: 16.5, weight: .semibold))
                            .foregroundStyle(Color.smText)
                            .lineLimit(1)

                        if !contact.isGroup && !isSavedMessages {
                            Image(systemName: "lock.fill")
                                .font(.system(size: 9, weight: .medium))
                                .foregroundStyle(Color.smOnline.opacity(0.85))
                                .accessibilityHidden(true)
                        }
                    }

                    HStack(spacing: 5) {
                        if contact.isOnline && !isTyping && !isSavedMessages {
                            Circle()
                                .fill(Color.smOnline)
                                .frame(width: 6, height: 6)
                                .accessibilityHidden(true)
                        }

                        Text(statusText)
                            .font(isTyping ? .system(size: 12).italic() : .system(size: 12))
                            .foregroundStyle(statusColor)
                            .lineLimit(1)
                    }
                }
            }
            .frame(maxWidth: 230, alignment: .leading)
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
