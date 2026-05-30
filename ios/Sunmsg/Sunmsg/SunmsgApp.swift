import SwiftUI

extension Notification.Name {
    static let smDidRegisterAPNsAlertToken = Notification.Name("smDidRegisterAPNsAlertToken")
    static let smDidFailToRegisterAPNsAlertToken = Notification.Name("smDidFailToRegisterAPNsAlertToken")
}

final class SunmsgAppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(token, forKey: "sun_alert_apns_token_v1")
        NotificationCenter.default.post(
            name: .smDidRegisterAPNsAlertToken,
            object: nil,
            userInfo: ["token": token]
        )
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(
            name: .smDidFailToRegisterAPNsAlertToken,
            object: nil,
            userInfo: ["error": error.localizedDescription]
        )
    }
}

@main
struct SunmsgApp: App {
    @UIApplicationDelegateAdaptor(SunmsgAppDelegate.self) private var appDelegate
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var session = SessionStore()

    init() {
        setupAppearance()
        NativeCallManager.shared.configure()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .inAppBannerOverlay()
                .environmentObject(session)
                .onAppear { NativeCallManager.shared.bind(session: session) }
                .onChange(of: scenePhase) { _, phase in
                    Task { await session.handleScenePhase(phase) }
                }
        }
    }

    private func setupAppearance() {
        // Navigation bar — parchment background
        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = adaptiveUIColor(light: "#f3f0e8", dark: "#1c1a14")
        nav.shadowColor = adaptiveUIColor(light: "#d9d2bf", dark: "#332f24")
        nav.titleTextAttributes = [
            .font: scaledFont(name: "Inter-SemiBold", size: 17, weight: .semibold, textStyle: .headline),
            .foregroundColor: adaptiveUIColor(light: "#15140e", dark: "#f5f0e4"),
        ]
        nav.largeTitleTextAttributes = [
            .font: scaledFont(name: "Inter-Bold", size: 34, weight: .bold, textStyle: .largeTitle),
            .foregroundColor: adaptiveUIColor(light: "#15140e", dark: "#f5f0e4"),
        ]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav
        UINavigationBar.appearance().tintColor = UIColor(hex: "#c4943c")

        // Tab bar - follows the app colour scheme while keeping the amber tint.
        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = adaptiveUIColor(light: "#f3f0e8", dark: "#1c1a14")
        tab.shadowColor = adaptiveUIColor(light: "#d9d2bf", dark: "#332f24")
        let normal = UITabBarItemAppearance()
        normal.normal.iconColor = adaptiveUIColor(light: "#aba493", dark: "#6f6a5b")
        normal.normal.titleTextAttributes = [
            .foregroundColor: adaptiveUIColor(light: "#aba493", dark: "#6f6a5b"),
            .font: scaledFont(size: 10.5, weight: .medium, textStyle: .caption2),
        ]
        normal.selected.iconColor = UIColor(hex: "#c4943c")
        normal.selected.titleTextAttributes = [
            .foregroundColor: UIColor(hex: "#c4943c"),
            .font: scaledFont(size: 10.5, weight: .semibold, textStyle: .caption2),
        ]
        tab.stackedLayoutAppearance = normal
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab

        // List
        UITableView.appearance().backgroundColor = .clear
    }

    private func adaptiveUIColor(light: String, dark: String) -> UIColor {
        UIColor { traits in
            traits.userInterfaceStyle == .dark
                ? UIColor(hex: dark)
                : UIColor(hex: light)
        }
    }

    private func scaledFont(
        name: String? = nil,
        size: CGFloat,
        weight: UIFont.Weight,
        textStyle: UIFont.TextStyle
    ) -> UIFont {
        let baseFont = name.flatMap { UIFont(name: $0, size: size) }
            ?? UIFont.systemFont(ofSize: size, weight: weight)
        return UIFontMetrics(forTextStyle: textStyle).scaledFont(for: baseFont)
    }
}
