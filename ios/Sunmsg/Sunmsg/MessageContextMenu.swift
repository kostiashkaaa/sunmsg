import SwiftUI

struct MessageContextMenuAction: Identifiable {
    let id: String
    let title: String
    let subtitle: String?
    let systemImage: String
    let role: ButtonRole?
    let isEnabled: Bool
    let perform: () -> Void

    init(
        id: String,
        title: String,
        subtitle: String? = nil,
        systemImage: String,
        role: ButtonRole? = nil,
        isEnabled: Bool = true,
        perform: @escaping () -> Void
    ) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.systemImage = systemImage
        self.role = role
        self.isEnabled = isEnabled
        self.perform = perform
    }
}

struct MessageContextMenu<Preview: View>: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    private typealias Metrics = ChatDesignMetrics.ContextMenu

    let targetRect: CGRect
    let containerSize: CGSize
    let safeAreaInsets: EdgeInsets
    let isFromMe: Bool
    let actions: [MessageContextMenuAction]
    let currentReactions: [MessageReaction]
    let primaryReactions: [String]
    let additionalReactions: [String]
    let onSelectReaction: (String) -> Void
    let onDismiss: () -> Void
    let preview: () -> Preview

    private let gap: CGFloat = Metrics.gap
    private let reactionHeight: CGFloat = ChatDesignMetrics.Reaction.pickerHeight
    private let rowHeight: CGFloat = Metrics.rowHeight
    private let horizontalMargin: CGFloat = Metrics.horizontalMargin

    init(
        targetRect: CGRect,
        containerSize: CGSize,
        safeAreaInsets: EdgeInsets,
        isFromMe: Bool,
        actions: [MessageContextMenuAction],
        currentReactions: [MessageReaction],
        primaryReactions: [String],
        additionalReactions: [String],
        onSelectReaction: @escaping (String) -> Void,
        onDismiss: @escaping () -> Void,
        @ViewBuilder preview: @escaping () -> Preview
    ) {
        self.targetRect = targetRect
        self.containerSize = containerSize
        self.safeAreaInsets = safeAreaInsets
        self.isFromMe = isFromMe
        self.actions = actions
        self.currentReactions = currentReactions
        self.primaryReactions = primaryReactions
        self.additionalReactions = additionalReactions
        self.onSelectReaction = onSelectReaction
        self.onDismiss = onDismiss
        self.preview = preview
    }

    var body: some View {
        let layout = makeLayout()

        ZStack {
            Rectangle()
                .fill(.regularMaterial)
                .opacity(0.90)
                .ignoresSafeArea()
                .overlay(Color.black.opacity(Metrics.backdropOpacity).ignoresSafeArea())
                .onTapGesture(perform: onDismiss)

            preview()
                .frame(width: targetRect.width)
                .shadow(
                    color: Color.black.opacity(Metrics.previewShadowOpacity),
                    radius: Metrics.shadowRadius,
                    x: 0,
                    y: Metrics.shadowY
                )
                .position(x: targetRect.midX, y: layout.previewCenterY)
                .transition(.opacity.combined(with: .scale(scale: 0.98)))

            ReactionPicker(
                primaryReactions: primaryReactions,
                additionalReactions: additionalReactions,
                currentReactions: currentReactions,
                onSelect: onSelectReaction
            )
            .frame(width: layout.reactionWidth, height: reactionHeight)
            .position(x: layout.reactionCenterX, y: layout.reactionCenterY)
            .transition(.opacity.combined(with: .move(edge: .top)))

            actionList(maxHeight: layout.menuHeight)
                .frame(width: layout.menuWidth, height: layout.menuHeight)
                .position(x: layout.menuCenterX, y: layout.menuCenterY)
                .transition(.opacity.combined(with: .move(edge: .bottom)))
        }
        .animation(reduceMotion ? nil : .spring(response: 0.34, dampingFraction: 0.84), value: actions.count)
    }

    private func actionList(maxHeight: CGFloat) -> some View {
        ScrollView(showsIndicators: actions.count > 8) {
            VStack(spacing: 0) {
                ForEach(actions) { action in
                    actionRow(action)
                    if action.id != actions.last?.id {
                        Rectangle()
                            .fill(Color.smBorderSoft)
                            .frame(height: Metrics.dividerHeight)
                            .padding(.leading, Metrics.dividerLeadingPadding)
                    }
                }
            }
        }
        .scrollDisabled(CGFloat(actions.count) * rowHeight <= maxHeight)
        .background(Color.smSurface, in: RoundedRectangle(cornerRadius: Metrics.menuCornerRadius, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: Metrics.menuCornerRadius, style: .continuous)
                .stroke(Color.smBorder, lineWidth: 0.6)
        )
        .shadow(
            color: Color.black.opacity(Metrics.menuShadowOpacity),
            radius: Metrics.shadowRadius,
            x: 0,
            y: Metrics.shadowY
        )
        .clipShape(RoundedRectangle(cornerRadius: Metrics.menuCornerRadius, style: .continuous))
    }

    private func actionRow(_ action: MessageContextMenuAction) -> some View {
        let foreground = action.role == .destructive ? Color.smDanger : Color.smText

        return Button(action: {
            ChatHaptics.lightImpact()
            action.perform()
        }) {
            HStack(spacing: Metrics.rowContentSpacing) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(action.title)
                        .font(.body.weight(.medium))
                        .foregroundStyle(foreground)
                        .lineLimit(1)

                    if let subtitle = action.subtitle {
                        Text(subtitle)
                            .font(.caption)
                            .foregroundStyle(action.role == .destructive ? Color.smDanger.opacity(0.75) : Color.smMuted)
                            .lineLimit(1)
                    }
                }

                Spacer(minLength: Metrics.rowTrailingSpacing)

                Image(systemName: action.systemImage)
                    .font(.system(size: Metrics.rowIconSize, weight: .medium))
                    .foregroundStyle(foreground)
                    .frame(width: Metrics.rowIconWidth)
            }
            .padding(.horizontal, Metrics.rowHorizontalPadding)
            .frame(minHeight: rowHeight)
            .contentShape(Rectangle())
            .opacity(action.isEnabled ? 1 : Metrics.maxDisabledOpacity)
        }
        .buttonStyle(MenuRowStyle())
        .disabled(!action.isEnabled)
    }

    private struct Layout {
        let previewCenterY: CGFloat
        let reactionCenterX: CGFloat
        let reactionCenterY: CGFloat
        let reactionWidth: CGFloat
        let menuCenterX: CGFloat
        let menuCenterY: CGFloat
        let menuWidth: CGFloat
        let menuHeight: CGFloat
    }

    private func makeLayout() -> Layout {
        let safeTop = safeAreaInsets.top + Metrics.safeVerticalPadding
        let safeBottom = containerSize.height - safeAreaInsets.bottom - Metrics.safeVerticalPadding
        let availableHeight = max(1, safeBottom - safeTop)
        let availableWidth = max(1, containerSize.width - horizontalMargin * 2)
        let reactionWidth = min(
            availableWidth,
            max(
                Metrics.minReactionWidth,
                ChatDesignMetrics.Reaction.pickerWidth(reactionCount: primaryReactions.count)
            )
        )
        let menuWidth = min(availableWidth, Metrics.menuWidth)
        let naturalMenuHeight = CGFloat(actions.count) * rowHeight
        let maxMenuHeight = max(96, availableHeight - targetRect.height - reactionHeight - gap * 4)
        let menuHeight = min(naturalMenuHeight, maxMenuHeight)

        let reactionCenterY = targetRect.minY - gap - reactionHeight / 2
        let previewCenterY = targetRect.midY
        let menuCenterY = targetRect.maxY + gap + menuHeight / 2
        let groupTop = reactionCenterY - reactionHeight / 2
        let groupBottom = menuCenterY + menuHeight / 2
        let shift: CGFloat = {
            if groupTop < safeTop { return safeTop - groupTop }
            if groupBottom > safeBottom { return safeBottom - groupBottom }
            return 0
        }()

        return Layout(
            previewCenterY: previewCenterY + shift,
            reactionCenterX: anchoredX(width: reactionWidth),
            reactionCenterY: reactionCenterY + shift,
            reactionWidth: reactionWidth,
            menuCenterX: anchoredX(width: menuWidth),
            menuCenterY: menuCenterY + shift,
            menuWidth: menuWidth,
            menuHeight: menuHeight
        )
    }

    private func anchoredX(width: CGFloat) -> CGFloat {
        let proposed = isFromMe ? targetRect.maxX - width / 2 : targetRect.minX + width / 2
        return min(
            max(proposed, width / 2 + horizontalMargin),
            containerSize.width - width / 2 - horizontalMargin
        )
    }
}
