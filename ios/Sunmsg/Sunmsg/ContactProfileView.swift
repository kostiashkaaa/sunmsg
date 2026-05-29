import SwiftUI

struct ContactProfileView: View {
    let contact: Contact
    @EnvironmentObject var session: SessionStore
    @Environment(\.dismiss) private var dismiss
    @State private var showBlockAlert = false
    @State private var isBlocking = false
    @State private var blockError: String?

    private var keyFingerprint: String {
        guard !contact.publicKey.isEmpty else { return "—" }
        let hash = contact.publicKey
            .components(separatedBy: .newlines)
            .filter { !$0.hasPrefix("-----") && !$0.isEmpty }
            .joined()
        let bytes = Array(hash.utf8.prefix(24))
        return bytes.chunks(4).map { chunk in
            chunk.map { String(format: "%02x", $0) }.joined()
        }.prefix(6).joined(separator: " · ")
    }

    var body: some View {
        ZStack {
            Color.smBg.ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    identitySection
                        .padding(.top, 12)
                        .padding(.bottom, 20)

                    actionButtons
                        .padding(.horizontal, 16)
                        .padding(.bottom, 20)

                    infoGroup
                        .padding(.horizontal, 16)
                        .padding(.bottom, 20)

                    mediaSection
                        .padding(.horizontal, 16)
                        .padding(.bottom, 20)

                    dangerGroup
                        .padding(.horizontal, 16)
                        .padding(.bottom, 40)
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .navigationTitle("")
        .toolbarBackground(Color.smBg, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .navigationBarTrailing) {
                Menu {
                    Button(role: .destructive, action: { showBlockAlert = true }) {
                        Label("Заблокировать", systemImage: "hand.raised")
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(Color.smAccent)
                }
            }
        }
        .alert("Заблокировать \(contact.displayName)?", isPresented: $showBlockAlert) {
            Button("Заблокировать", role: .destructive) { performBlock() }
            Button("Отмена", role: .cancel) {}
        } message: {
            Text("Этот пользователь не сможет отправлять вам сообщения.")
        }
        .alert("Не удалось заблокировать", isPresented: Binding(
            get: { blockError != nil },
            set: { if !$0 { blockError = nil } }
        )) {
            Button("OK", role: .cancel) { blockError = nil }
        } message: { Text(blockError ?? "") }
    }

    private func performBlock() {
        guard !isBlocking else { return }
        isBlocking = true
        Task {
            let err = await session.blockContact(contact)
            isBlocking = false
            if let err {
                blockError = err
            } else {
                dismiss()
            }
        }
    }

    // MARK: - Identity

    private var identitySection: some View {
        VStack(spacing: 10) {
            ZStack(alignment: .bottomTrailing) {
                SmAvatarView(
                    name: contact.displayName,
                    avatarUrl: contact.avatarUrl,
                    isGroup: contact.isGroup,
                    size: 96
                )
                if contact.isOnline {
                    Circle().fill(Color.smOnline)
                        .frame(width: 16, height: 16)
                        .overlay(Circle().stroke(Color.smBg, lineWidth: 3))
                }
            }

            VStack(spacing: 4) {
                Text(contact.displayName)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(Color.smText)
                    .tracking(-0.6)

                Text("@\(contact.username)")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(Color.smAccent2)

                if contact.isOnline {
                    HStack(spacing: 5) {
                        Circle().fill(Color.smOnline).frame(width: 7, height: 7)
                        Text("в сети")
                            .font(.system(size: 12))
                            .foregroundStyle(Color.smOnline)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Action buttons

    private var actionButtons: some View {
        HStack(spacing: 8) {
            profileActionButton(icon: "message.fill", label: "Сообщ.", action: { dismiss() })
            profileActionButton(icon: "phone.fill", label: "Звонок", action: {
                session.initiateCall(chatId: contact.chatId, callType: "audio")
                dismiss()
            })
            profileActionButton(icon: "video.fill", label: "Видео", action: {
                session.initiateCall(chatId: contact.chatId, callType: "video")
                dismiss()
            })
            profileActionButton(icon: "bell.slash.fill", label: "Без звука", action: {
                // Toggle local mute marker (server-side mute is on Settings → Notifications)
            })
        }
    }

    private func profileActionButton(icon: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 17))
                    .foregroundStyle(Color.smAccent2)
                    .frame(width: 44, height: 44)
                    .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 12))
                    .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.smBorder, lineWidth: 0.5))
                Text(label)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(Color.smText)
                    .tracking(-0.1)
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.plain)
    }

    // MARK: - Info group

    private var infoGroup: some View {
        VStack(spacing: 0) {
            infoRow(
                icon: "key.fill",
                tint: Color.smAccent.opacity(0.12),
                iconColor: Color.smAccent2,
                label: "Шифрование",
                detail: keyFingerprint.isEmpty ? "Ключ не загружен" : keyFingerprint,
                isFirst: true
            )
            Divider().padding(.leading, 52).background(Color.smBorderSoft)
            infoRow(
                icon: "bell.fill",
                tint: Color.smAccent.opacity(0.12),
                iconColor: Color.smAccent2,
                label: "Уведомления",
                detail: "По умолчанию"
            )
            Divider().padding(.leading, 52).background(Color.smBorderSoft)
            infoRow(
                icon: "photo.fill",
                tint: Color.smAccent.opacity(0.12),
                iconColor: Color.smAccent2,
                label: "Обои для чата",
                detail: "По умолчанию",
                isLast: true
            )
        }
        .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
        .shadow(color: Color.black.opacity(0.04), radius: 4, x: 0, y: 2)
    }

    private func infoRow(icon: String, tint: Color, iconColor: Color, label: String, detail: String, isFirst: Bool = false, isLast: Bool = false) -> some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8).fill(tint).frame(width: 32, height: 32)
                Image(systemName: icon).font(.system(size: 14)).foregroundStyle(iconColor)
            }
            Text(label)
                .font(.system(size: 15))
                .foregroundStyle(Color.smText)
            Spacer()
            Text(detail)
                .font(.system(size: 12, design: detail.count > 20 ? .monospaced : .default))
                .foregroundStyle(Color.smFaint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Image(systemName: "chevron.right")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color.smFaint)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    // MARK: - Shared media placeholder

    private var mediaSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("ОБЩИЕ МЕДИА")
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(Color.smFaint)
                .tracking(0.6)
                .padding(.horizontal, 4)

            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    Image(systemName: "photo.on.rectangle.angled")
                        .font(.system(size: 22))
                        .foregroundStyle(Color.smFaint)
                    Text("Нет общих медиафайлов")
                        .font(.system(size: 14))
                        .foregroundStyle(Color.smMuted)
                    Spacer()
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 16)
            }
            .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
        }
    }

    // MARK: - Danger zone

    private var dangerGroup: some View {
        VStack(spacing: 0) {
            Button(action: { showBlockAlert = true }) {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.smDanger.opacity(0.10))
                            .frame(width: 32, height: 32)
                        Image(systemName: "hand.raised.fill")
                            .font(.system(size: 14))
                            .foregroundStyle(Color.smDanger)
                    }
                    Text("Заблокировать")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.smDanger)
                    Spacer()
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .buttonStyle(.plain)
        }
        .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
    }
}

// MARK: - Array chunk helper

private extension Array {
    func chunks(_ size: Int) -> [[Element]] {
        stride(from: 0, to: count, by: size).map {
            Array(self[$0..<Swift.min($0 + size, count)])
        }
    }
}
