import SwiftUI

struct ReactionPicker: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private typealias Metrics = ChatDesignMetrics.Reaction

    let primaryReactions: [String]
    let additionalReactions: [String]
    let onSelect: (String) -> Void
    private let expandedReactions: [String]
    private let reactedByMeEmojis: Set<String>

    @State private var showsAdditionalReactions = false

    init(
        primaryReactions: [String],
        additionalReactions: [String],
        currentReactions: [MessageReaction],
        onSelect: @escaping (String) -> Void
    ) {
        self.primaryReactions = primaryReactions
        self.additionalReactions = additionalReactions
        self.onSelect = onSelect
        self.expandedReactions = primaryReactions + additionalReactions
        self.reactedByMeEmojis = Set(currentReactions.filter { $0.reactedByMe }.map(\.emoji))
    }

    private var visibleReactions: [String] {
        showsAdditionalReactions ? expandedReactions : primaryReactions
    }

    var body: some View {
        HStack(spacing: Metrics.spacing) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Metrics.spacing) {
                    ForEach(visibleReactions, id: \.self) { emoji in
                        reactionButton(emoji)
                    }
                }
                .padding(.leading, Metrics.pickerHorizontalPadding)
            }

            Button(action: toggleAdditionalReactions) {
                Image(systemName: showsAdditionalReactions ? "chevron.up.circle.fill" : "chevron.down.circle.fill")
                    .font(.system(size: Metrics.toggleIconSize, weight: .semibold))
                    .foregroundStyle(Color.smMuted)
                    .frame(width: Metrics.toggleSize, height: Metrics.toggleSize)
                    .contentShape(Circle())
            }
            .buttonStyle(PressableStyle(scale: 0.9))
            .accessibilityLabel(showsAdditionalReactions ? "Скрыть дополнительные реакции" : "Показать дополнительные реакции")
            .padding(.trailing, Metrics.pickerHorizontalPadding)
        }
        .frame(height: Metrics.pickerHeight)
        .background(Color.smSurface, in: Capsule())
        .overlay(Capsule().stroke(Color.smBorder, lineWidth: 0.6))
        .shadow(
            color: Color.black.opacity(Metrics.shadowOpacity),
            radius: Metrics.shadowRadius,
            x: 0,
            y: Metrics.shadowY
        )
    }

    private func reactionButton(_ emoji: String) -> some View {
        let isActive = reactedByMeEmojis.contains(emoji)

        return Button(action: {
            ChatHaptics.lightImpact()
            onSelect(emoji)
        }) {
            Text(emoji)
                .font(.system(size: Metrics.emojiSize))
                .frame(width: Metrics.buttonSize, height: Metrics.buttonSize)
                .background(isActive ? Color.smAccent.opacity(Metrics.activeOpacity) : Color.clear, in: Circle())
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
