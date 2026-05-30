import SwiftUI

enum ChatDesignMetrics {
    enum TopBar {
        static let barHeight: CGFloat = 54
        static let sideWidth: CGFloat = 52
        static let backTouchSize: CGFloat = 44
        static let avatarSize: CGFloat = 36
        static let headerHeight: CGFloat = 48
        static let contentHorizontalPadding: CGFloat = 4
        static let titleStatusSpacing: CGFloat = 1
    }

    enum Timeline {
        static let horizontalPadding: CGFloat = 10
        static let topPadding: CGFloat = 6
        static let bottomPadding: CGFloat = 5
        static let selectionReserve: CGFloat = 36
        static let maxBubbleWidth: CGFloat = 340
        static let maxBubbleFraction: CGFloat = 0.80
        static let bottomPinTolerance: CGFloat = 72
        static let dateTopPadding: CGFloat = 10
        static let dateBottomPadding: CGFloat = 5
    }

    enum Bubble {
        static let cornerRadius: CGFloat = 18
        static let tailRadius: CGFloat = 6
        static let sideGutter: CGFloat = 44
        static let rowVerticalPadding: CGFloat = 1.5
        static let tailRowVerticalPadding: CGFloat = 3
        static let textHorizontalPadding: CGFloat = 12
        static let textVerticalPadding: CGFloat = 7
        static let minTextBubbleWidth: CGFloat = 56
        static let minReactedTextBubbleWidth: CGFloat = 100
        static let contentSpacing: CGFloat = 5
        static let metaSpacing: CGFloat = 3
        static let metaHorizontalPadding: CGFloat = 4
        static let replyHorizontalPadding: CGFloat = 8
        static let replyVerticalPadding: CGFloat = 6
        static let replyRadius: CGFloat = 9
        static let reactionSpacing: CGFloat = 4
        static let reactionGridMinWidth: CGFloat = 44
        static let reactionGridMaxWidth: CGFloat = 76
        static let reactionHorizontalPadding: CGFloat = 7
        static let reactionVerticalPadding: CGFloat = 3
        static let reactionMinHeight: CGFloat = 22
        static let reactionEdgeInset: CGFloat = 4
        static let fallbackHorizontalPadding: CGFloat = 12
        static let fallbackTopPadding: CGFloat = 7
        static let fallbackBottomPadding: CGFloat = 8
        static let cardHorizontalPadding: CGFloat = 12
        static let cardVerticalPadding: CGFloat = 9
        static let callHorizontalPadding: CGFloat = 12
        static let callVerticalPadding: CGFloat = 9
        static let iconSize: CGFloat = 32
        static let fileIconSize: CGFloat = 36
        static let mediaMaxWidth: CGFloat = 268
        static let callMaxWidth: CGFloat = 228
        static let mediaAspectRatio: CGFloat = 0.727
        static let audioMinWidth: CGFloat = 152
        static let fileMinWidth: CGFloat = 184
        static let outgoingShadowOpacity: Double = 0.08
        static let incomingShadowOpacity: Double = 0.045
        static let shadowRadius: CGFloat = 1
        static let shadowY: CGFloat = 1
        static let mediaShadowOpacity: Double = 0.10
        static let mediaShadowRadius: CGFloat = 2
    }

    enum Reaction {
        static let pickerHeight: CGFloat = 50
        static let pickerHorizontalPadding: CGFloat = 7
        static let buttonSize: CGFloat = 38
        static let emojiSize: CGFloat = 25
        static let spacing: CGFloat = 4
        static let toggleSize: CGFloat = 38
        static let toggleIconSize: CGFloat = 22
        static let activeOpacity: Double = 0.18
        static let shadowOpacity: Double = 0.13
        static let shadowRadius: CGFloat = 12
        static let shadowY: CGFloat = 6

        static func pickerWidth(reactionCount: Int) -> CGFloat {
            let reactionCount = max(0, reactionCount)
            let reactionSpacing = CGFloat(max(0, reactionCount - 1)) * spacing
            let toggleSpacing = reactionCount > 0 ? spacing : 0
            return CGFloat(reactionCount) * buttonSize
                + reactionSpacing
                + toggleSpacing
                + toggleSize
                + pickerHorizontalPadding * 2
        }
    }

    enum ContextMenu {
        static let gap: CGFloat = 9
        static let horizontalMargin: CGFloat = 10
        static let safeVerticalPadding: CGFloat = 10
        static let rowHeight: CGFloat = 46
        static let menuWidth: CGFloat = 304
        static let menuCornerRadius: CGFloat = 16
        static let dividerLeadingPadding: CGFloat = 16
        static let rowHorizontalPadding: CGFloat = 16
        static let rowIconWidth: CGFloat = 24
        static let maxDisabledOpacity: Double = 0.42
        static let backdropOpacity: Double = 0.10
        static let previewShadowOpacity: Double = 0.14
        static let menuShadowOpacity: Double = 0.16
        static let shadowRadius: CGFloat = 14
        static let shadowY: CGFloat = 7
        static let minReactionWidth: CGFloat = 232
    }

    enum Composer {
        static let sideButtonSize: CGFloat = 38
        static let sendButtonSize: CGFloat = 34
        static let inputMinHeight: CGFloat = 38
        static let inputRadius: CGFloat = 19
        static let rowSpacing: CGFloat = 6
        static let horizontalPadding: CGFloat = 10
        static let topPadding: CGFloat = 7
        static let bottomPadding: CGFloat = 7
        static let iconSize: CGFloat = 21
        static let innerButtonSize: CGFloat = 32
        static let inputLeadingPadding: CGFloat = 14
        static let inputTrailingPadding: CGFloat = 4
        static let inputVerticalPadding: CGFloat = 5
    }
}

extension View {
    func chatBubbleChrome(
        isFromMe: Bool,
        isTail: Bool,
        fill: Color,
        stroke: Color? = nil,
        outgoingShadowOpacity: Double = ChatDesignMetrics.Bubble.outgoingShadowOpacity,
        incomingShadowOpacity: Double = ChatDesignMetrics.Bubble.incomingShadowOpacity
    ) -> some View {
        modifier(
            ChatBubbleChromeModifier(
                isFromMe: isFromMe,
                isTail: isTail,
                fill: fill,
                stroke: stroke,
                outgoingShadowOpacity: outgoingShadowOpacity,
                incomingShadowOpacity: incomingShadowOpacity
            )
        )
    }

    func chatMediaChrome(isFromMe: Bool, isTail: Bool) -> some View {
        modifier(ChatMediaChromeModifier(isFromMe: isFromMe, isTail: isTail))
    }
}

private struct ChatBubbleChromeModifier: ViewModifier {
    let isFromMe: Bool
    let isTail: Bool
    let fill: Color
    let stroke: Color?
    let outgoingShadowOpacity: Double
    let incomingShadowOpacity: Double

    func body(content: Content) -> some View {
        let shape = BubbleShape(isFromMe: isFromMe, isTail: isTail)
        let strokeColor = stroke ?? (isFromMe ? Color.clear : Color.smBorderSoft)
        let shadowOpacity = isFromMe ? outgoingShadowOpacity : incomingShadowOpacity

        content
            .background(fill)
            .clipShape(shape)
            .overlay(shape.stroke(strokeColor, lineWidth: 0.5))
            .shadow(
                color: Color.black.opacity(shadowOpacity),
                radius: ChatDesignMetrics.Bubble.shadowRadius,
                x: 0,
                y: ChatDesignMetrics.Bubble.shadowY
            )
    }
}

private struct ChatMediaChromeModifier: ViewModifier {
    let isFromMe: Bool
    let isTail: Bool

    func body(content: Content) -> some View {
        let shape = BubbleShape(isFromMe: isFromMe, isTail: isTail)

        content
            .clipShape(shape)
            .overlay(shape.stroke(Color.smBorderSoft, lineWidth: 0.5))
            .shadow(
                color: Color.black.opacity(ChatDesignMetrics.Bubble.mediaShadowOpacity),
                radius: ChatDesignMetrics.Bubble.mediaShadowRadius,
                x: 0,
                y: ChatDesignMetrics.Bubble.shadowY
            )
    }
}
