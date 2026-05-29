import SwiftUI

struct ReactionPicker: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let primaryReactions: [String]
    let additionalReactions: [String]
    let currentReactions: [MessageReaction]
    let onSelect: (String) -> Void

    @State private var showsAdditionalReactions = false

    private var visibleReactions: [String] {
        showsAdditionalReactions ? primaryReactions + additionalReactions : primaryReactions
    }

    var body: some View {
        HStack(spacing: 6) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(visibleReactions, id: \.self) { emoji in
                        reactionButton(emoji)
                    }
                }
                .padding(.leading, 8)
            }

            Button(action: toggleAdditionalReactions) {
                Image(systemName: showsAdditionalReactions ? "chevron.up.circle.fill" : "chevron.down.circle.fill")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(Color.smMuted)
                    .frame(width: 38, height: 38)
                    .contentShape(Circle())
            }
            .buttonStyle(PressableStyle(scale: 0.9))
            .accessibilityLabel(showsAdditionalReactions ? "Скрыть дополнительные реакции" : "Показать дополнительные реакции")
            .padding(.trailing, 8)
        }
        .frame(height: 52)
        .background(Color.smSurface, in: Capsule())
        .overlay(Capsule().stroke(Color.smBorder, lineWidth: 0.6))
        .shadow(color: Color.black.opacity(0.18), radius: 16, x: 0, y: 8)
    }

    private func reactionButton(_ emoji: String) -> some View {
        let isActive = currentReactions.contains { $0.emoji == emoji && $0.reactedByMe }

        return Button(action: {
            ChatHaptics.lightImpact()
            onSelect(emoji)
        }) {
            Text(emoji)
                .font(.system(size: 25))
                .frame(width: 38, height: 38)
                .background(isActive ? Color.smAccent.opacity(0.22) : Color.clear, in: Circle())
                .contentShape(Circle())
        }
        .buttonStyle(PressableStyle(scale: 0.86))
        .accessibilityLabel("Реакция \(emoji)")
    }

    private func toggleAdditionalReactions() {
        ChatHaptics.lightImpact()
        if reduceMotion {
            showsAdditionalReactions.toggle()
        } else {
            withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) {
                showsAdditionalReactions.toggle()
            }
        }
    }
}
