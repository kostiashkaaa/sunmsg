import SwiftUI
import UIKit

/// Quick scale + dim on press for compact chat controls.
struct PressableStyle: ButtonStyle {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var scale: CGFloat = 0.9
    var pressedOpacity: Double = 0.78

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(reduceMotion ? 1 : (configuration.isPressed ? scale : 1))
            .opacity(configuration.isPressed ? pressedOpacity : 1)
            .animation(nil, value: configuration.isPressed)
    }
}

/// Full-width menu row that highlights its background while pressed.
struct MenuRowStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? Color.smText.opacity(0.07) : Color.clear)
            .animation(nil, value: configuration.isPressed)
    }
}

@MainActor
enum ChatHaptics {
    private static let lightGenerator = UIImpactFeedbackGenerator(style: .light)
    private static let mediumGenerator = UIImpactFeedbackGenerator(style: .medium)

    static func prepare() {
        lightGenerator.prepare()
        mediumGenerator.prepare()
    }

    static func lightImpact() {
        lightGenerator.impactOccurred()
        lightGenerator.prepare()
    }

    static func mediumImpact() {
        mediumGenerator.impactOccurred()
        mediumGenerator.prepare()
    }
}
