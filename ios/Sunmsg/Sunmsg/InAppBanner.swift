import SwiftUI

// MARK: - In-App Notification Banner
//
// Shows a Telegram-style banner at the top of the screen whenever a
// socket "receive_message" event arrives for a chat that is NOT currently open.
// No APNs / no permission required.

struct InAppBannerData: Identifiable {
    let id = UUID()
    let senderName: String
    let preview: String
    let chatId: String
}

@MainActor
final class InAppBannerController: ObservableObject {
    static let shared = InAppBannerController()

    @Published var current: InAppBannerData? = nil

    private var dismissTask: Task<Void, Never>?

    func show(_ data: InAppBannerData) {
        dismissTask?.cancel()
        withAnimation(.spring(response: 0.35, dampingFraction: 0.78)) {
            current = data
        }
        dismissTask = Task {
            try? await Task.sleep(nanoseconds: 4_000_000_000)
            guard !Task.isCancelled else { return }
            await MainActor.run {
                withAnimation(.easeInOut(duration: 0.25)) { self.current = nil }
            }
        }
    }

    func dismiss() {
        dismissTask?.cancel()
        withAnimation(.easeInOut(duration: 0.2)) { current = nil }
    }
}

// MARK: - Banner View

struct InAppBannerView: View {
    let data: InAppBannerData
    let onTap: (String) -> Void

    var body: some View {
        HStack(spacing: 12) {
            // Sun brand icon
            ZStack {
                Circle()
                    .fill(Color.smAccent)
                    .frame(width: 38, height: 38)
                Image(systemName: "bubble.left.fill")
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Color(hex: "#fbf8f1"))
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(data.senderName)
                    .font(.system(size: 13.5, weight: .semibold))
                    .foregroundStyle(Color.smText)
                    .lineLimit(1)
                    .tracking(-0.2)

                Text(data.preview)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.smMuted)
                    .lineLimit(1)
                    .tracking(-0.1)
            }

            Spacer(minLength: 0)

            Button(action: { InAppBannerController.shared.dismiss() }) {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.smFaint)
                    .frame(width: 22, height: 22)
                    .background(Color.smSurface2, in: Circle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(
            RoundedRectangle(cornerRadius: 16)
                .fill(Color.smSurface)
                .shadow(color: Color.black.opacity(0.14), radius: 12, x: 0, y: 4)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .stroke(Color.smBorder, lineWidth: 0.5)
        )
        .padding(.horizontal, 12)
        .onTapGesture { onTap(data.chatId) }
    }
}

// MARK: - View Modifier

struct InAppBannerOverlay: ViewModifier {
    @ObservedObject var ctrl = InAppBannerController.shared
    @EnvironmentObject var session: SessionStore

    func body(content: Content) -> some View {
        ZStack(alignment: .top) {
            content

            if let data = ctrl.current {
                InAppBannerView(data: data) { _ in
                    // Tapping opens the chat — for now just dismiss
                    // (full navigation would require a NavigationPath in SessionStore)
                    ctrl.dismiss()
                }
                .transition(.move(edge: .top).combined(with: .opacity))
                .zIndex(999)
                .padding(.top, 8)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .smSocketMessage)) { note in
            handleSocketNote(note)
        }
    }

    private func handleSocketNote(_ note: Notification) {
        guard
            let event = note.userInfo?[SocketEventKey.eventName] as? String,
            event == "receive_message",
            let payload = note.userInfo?[SocketEventKey.data] as? [String: Any],
            let chatId = payload["chat_id"] as? String,
            chatId != session.activeChatId   // don't show banner for the open chat
        else { return }

        let senderName = (payload["sender_display_name"] as? String)
                         ?? (payload["sender_username"] as? String)
                         ?? "New message"
        let rawMsg = payload["message"] as? String ?? ""
        let preview = rawMsg.hasPrefix("{") || rawMsg.count > 200
                      ? "🔐 Encrypted message"
                      : (rawMsg.isEmpty ? "New message" : String(rawMsg.prefix(80)))

        // Don't show banner if it's our own echo (message_sent)
        let myId = session.bootstrap?.user.id
        let senderId = payload["sender_user_id"] as? Int
        guard senderId != myId else { return }

        InAppBannerController.shared.show(
            InAppBannerData(senderName: senderName, preview: preview, chatId: chatId)
        )
    }
}

extension View {
    func inAppBannerOverlay() -> some View {
        modifier(InAppBannerOverlay())
    }
}
