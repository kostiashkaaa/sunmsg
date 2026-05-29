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

    private let gap: CGFloat = 10
    private let reactionHeight: CGFloat = 54
    private let rowHeight: CGFloat = 48
    private let horizontalMargin: CGFloat = 12

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
                .fill(.ultraThinMaterial)
                .opacity(0.96)
                .ignoresSafeArea()
                .overlay(Color.black.opacity(0.20).ignoresSafeArea())
                .onTapGesture(perform: onDismiss)

            preview()
                .frame(width: targetRect.width)
                .scaleEffect(reduceMotion ? 1 : 1.035)
                .shadow(color: Color.black.opacity(0.22), radius: 18, x: 0, y: 8)
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
                ForEach(actions.indices, id: \.self) { index in
                    actionRow(actions[index])
                    if index < actions.count - 1 {
                        Rectangle()
                            .fill(Color.smBorderSoft)
                            .frame(height: 0.5)
                            .padding(.leading, 16)
                    }
                }
            }
        }
        .scrollDisabled(CGFloat(actions.count) * rowHeight <= maxHeight)
        .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 15, style: .continuous)
                .stroke(Color.smBorder, lineWidth: 0.6)
        )
        .shadow(color: Color.black.opacity(0.20), radius: 18, x: 0, y: 9)
        .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
    }

    private func actionRow(_ action: MessageContextMenuAction) -> some View {
        let foreground = action.role == .destructive ? Color.smDanger : Color.smText

        return Button(action: {
            ChatHaptics.lightImpact()
            action.perform()
        }) {
            HStack(spacing: 12) {
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

                Spacer(minLength: 12)

                Image(systemName: action.systemImage)
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(foreground)
                    .frame(width: 24)
            }
            .padding(.horizontal, 16)
            .frame(minHeight: rowHeight)
            .contentShape(Rectangle())
            .opacity(action.isEnabled ? 1 : 0.42)
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
        let safeTop = safeAreaInsets.top + 10
        let safeBottom = containerSize.height - safeAreaInsets.bottom - 10
        let availableHeight = max(1, safeBottom - safeTop)
        let availableWidth = max(1, containerSize.width - horizontalMargin * 2)
        let reactionWidth = min(availableWidth, max(232, CGFloat(primaryReactions.count + 1) * 44 + 18))
        let menuWidth = min(availableWidth, 300)
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
