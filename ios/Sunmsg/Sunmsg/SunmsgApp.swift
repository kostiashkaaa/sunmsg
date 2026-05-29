import SwiftUI

@main
struct SunmsgApp: App {
    @StateObject private var session = SessionStore()

    init() { setupAppearance() }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .inAppBannerOverlay()
                .environmentObject(session)
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

        // Tab bar — parchment background, amber tint
        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = UIColor(hex: "#f3f0e8")
        tab.shadowColor = UIColor(hex: "#d9d2bf")
        let normal = UITabBarItemAppearance()
        normal.normal.iconColor = UIColor(hex: "#aba493")
        normal.normal.titleTextAttributes = [
            .foregroundColor: UIColor(hex: "#aba493"),
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
}
