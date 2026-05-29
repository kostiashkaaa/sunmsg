import SwiftUI

@main
struct SunmsgApp: App {
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
        }
    }

    private func setupAppearance() {
        // Navigation bar — parchment background
        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = UIColor(hex: "#f3f0e8")
        nav.shadowColor = UIColor(hex: "#d9d2bf")
        nav.titleTextAttributes = [
            .font: UIFont(name: "Inter-SemiBold", size: 17) ?? UIFont.systemFont(ofSize: 17, weight: .semibold),
            .foregroundColor: UIColor(hex: "#15140e"),
        ]
        nav.largeTitleTextAttributes = [
            .font: UIFont(name: "Inter-Bold", size: 34) ?? UIFont.systemFont(ofSize: 34, weight: .bold),
            .foregroundColor: UIColor(hex: "#15140e"),
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
            .font: UIFont.systemFont(ofSize: 10.5, weight: .medium),
        ]
        normal.selected.iconColor = UIColor(hex: "#c4943c")
        normal.selected.titleTextAttributes = [
            .foregroundColor: UIColor(hex: "#c4943c"),
            .font: UIFont.systemFont(ofSize: 10.5, weight: .semibold),
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
}
