import SwiftUI

/// Quick scale + dim on press for compact chat controls.
struct PressableStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var scale: CGFloat = 0.9

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(reduceMotion ? 1 : (configuration.isPressed ? scale : 1))
            .opacity(configuration.isPressed ? 0.85 : 1)
            .animation(
                reduceMotion ? nil : .spring(response: 0.22, dampingFraction: 0.55),
                value: configuration.isPressed
            )
    }
}

/// Full-width menu row that highlights its background while pressed.
struct MenuRowStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Color.smText.opacity(0.07) : Color.clear)
            .animation(reduceMotion ? nil : .easeOut(duration: 0.12), value: configuration.isPressed)
    }
}
