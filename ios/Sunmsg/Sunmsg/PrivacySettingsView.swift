import SwiftUI

struct PrivacySettingsView: View {
    @EnvironmentObject var session: SessionStore
    @State private var showOnlineStatus = true
    @State private var shareTyping = true
    @State private var sendReadReceipts = true
    @State private var muteDialogRequests = false
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var error: String?
    @State private var blockedCount = 0
    @State private var navigateToBlocked = false
    @State private var navigateToDevices = false
    @State private var showMnemonicInfo = false

    private var hasKey: Bool { KeychainService.loadPrivateKey() != nil }

    private var keyStatusText: String {
        hasKey ? "Сохранён в Keychain · RSA-2048" : "Не загружен — войдите заново"
    }

    var body: some View {
        ZStack {
            Color.smBg.ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 0) {
                    encryptionCard
                        .padding(.horizontal, 16)
                        .padding(.top, 16)
                        .padding(.bottom, 20)

                    privacySection
                        .padding(.horizontal, 16)
                        .padding(.bottom, 20)

                    keySection
                        .padding(.horizontal, 16)
                        .padding(.bottom, 20)

                    Text("Ключи генерируются на устройстве. sun не имеет доступа к содержимому ваших сообщений.")
                        .font(.system(size: 11.5))
                        .foregroundStyle(Color.smFaint)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                        .padding(.bottom, 40)
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .navigationTitle("Приватность")
        .toolbarBackground(Color.smBg, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { await loadSettings() }
        .task { await loadBlockedCount() }
        .navigationDestination(isPresented: $navigateToBlocked) { BlockedUsersView() }
        .navigationDestination(isPresented: $navigateToDevices) { DevicesView() }
        .alert("Секретная фраза", isPresented: $showMnemonicInfo) {
            Button("Понятно", role: .cancel) {}
        } message: {
            Text("Ваши 24 слова показываются один раз при создании аккаунта и нигде не сохраняются. Храните их в надёжном месте — это единственный способ восстановить доступ.")
        }
    }

    // MARK: - Encryption status card

    private var encryptionCard: some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(hasKey ? Color.smOnline.opacity(0.12) : Color.smDanger.opacity(0.12))
                        .frame(width: 36, height: 36)
                    Image(systemName: hasKey ? "checkmark.shield.fill" : "exclamationmark.shield.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(hasKey ? Color.smOnline : Color.smDanger)
                }

                VStack(alignment: .leading, spacing: 2) {
                    Text(hasKey ? "Сквозное шифрование активно" : "Ключ шифрования не загружен")
                        .font(.system(size: 14.5, weight: .semibold))
                        .foregroundStyle(Color.smText)
                    Text(keyStatusText)
                        .font(.system(size: 12))
                        .foregroundStyle(Color.smMuted)
                }
                Spacer()
            }
            .padding(14)

            if hasKey {
                Divider().background(Color.smBorderSoft)
                HStack {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 10))
                        .foregroundStyle(Color.smFaint)
                    Text("RSA-OAEP + AES-256-GCM · PKCS#8 Keychain")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(Color.smFaint)
                        .tracking(0.2)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
            }
        }
        .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
        .shadow(color: Color.black.opacity(0.04), radius: 4, x: 0, y: 2)
    }

    // MARK: - Privacy toggles

    private var privacySection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("КОНФИДЕНЦИАЛЬНОСТЬ")
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(Color.smFaint)
                .tracking(0.6)
                .padding(.horizontal, 4)
                .padding(.bottom, 6)

            VStack(spacing: 0) {
                privacyToggle(
                    icon: "circle.fill",
                    label: "Статус «в сети»",
                    detail: showOnlineStatus ? "Видно контактам" : "Скрыт",
                    isOn: $showOnlineStatus,
                    onChange: { v in saveSettings(["hide_online_status": !v, "last_seen_visibility": v ? "contacts" : "nobody"], reconnect: true) }
                )
                Divider().padding(.leading, 52).background(Color.smBorderSoft)
                privacyToggle(
                    icon: "text.bubble.fill",
                    label: "Индикатор набора",
                    detail: shareTyping ? "Отправлять контактам" : "Не отправлять",
                    isOn: $shareTyping,
                    onChange: { v in saveSettings(["typing_privacy": v ? "contacts" : "nobody"]) }
                )
                Divider().padding(.leading, 52).background(Color.smBorderSoft)
                privacyToggle(
                    icon: "checkmark.message.fill",
                    label: "Подтверждения прочтения",
                    detail: sendReadReceipts ? "Включены" : "Скрыты",
                    isOn: $sendReadReceipts,
                    onChange: { v in saveSettings(["read_receipts_privacy": v ? "contacts" : "nobody"]) }
                )
                Divider().padding(.leading, 52).background(Color.smBorderSoft)
                privacyToggle(
                    icon: "bell.slash.fill",
                    label: "Заглушить запросы на диалог",
                    detail: muteDialogRequests ? "Заглушены" : "Уведомлять",
                    isOn: $muteDialogRequests,
                    onChange: { v in saveSettings(["mute_dialog_requests": v]) }
                )
            }
            .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
        }
    }

    private func privacyToggle(icon: String, label: String, detail: String, isOn: Binding<Bool>, onChange: @escaping (Bool) -> Void) -> some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8).fill(Color.smAccent.opacity(0.12)).frame(width: 32, height: 32)
                Image(systemName: icon).font(.system(size: 14)).foregroundStyle(Color.smAccent)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(label).font(.system(size: 15)).foregroundStyle(Color.smText)
                Text(detail).font(.system(size: 12)).foregroundStyle(Color.smFaint)
            }
            Spacer()
            Toggle("", isOn: Binding(
                get: { isOn.wrappedValue },
                set: { v in isOn.wrappedValue = v; onChange(v) }
            ))
            .labelsHidden()
            .tint(Color.smAccent)
            .disabled(isSaving || isLoading)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
    }

    // MARK: - Key management

    private var keySection: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("КЛЮЧИ И УСТРОЙСТВА")
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(Color.smFaint)
                .tracking(0.6)
                .padding(.horizontal, 4)
                .padding(.bottom, 6)

            VStack(spacing: 0) {
                settingsNavRow(icon: "key.fill", label: "Секретная фраза (24 слова)", detail: "Резервная копия") { showMnemonicInfo = true }
                Divider().padding(.leading, 52).background(Color.smBorderSoft)
                settingsNavRow(icon: "iphone.and.ipad", label: "Активные устройства", detail: "1") { navigateToDevices = true }
                Divider().padding(.leading, 52).background(Color.smBorderSoft)
                settingsNavRow(icon: "hand.raised.fill", label: "Заблокированные", detail: "\(blockedCount)") { navigateToBlocked = true }
            }
            .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
        }
    }

    private func settingsNavRow(icon: String, label: String, detail: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8).fill(Color.smAccent.opacity(0.12)).frame(width: 32, height: 32)
                    Image(systemName: icon).font(.system(size: 14)).foregroundStyle(Color.smAccent)
                }
                Text(label).font(.system(size: 15)).foregroundStyle(Color.smText)
                Spacer()
                Text(detail).font(.system(size: 13)).foregroundStyle(Color.smFaint)
                Image(systemName: "chevron.right").font(.system(size: 12, weight: .semibold)).foregroundStyle(Color.smFaint)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - API

    private func loadBlockedCount() async {
        blockedCount = (try? await session.api.getBlockedUsers().count) ?? blockedCount
    }

    private func loadSettings() async {
        isLoading = true
        do {
            let s = try await session.api.getSettings()
            showOnlineStatus = !s.hideOnlineStatus && s.lastSeenVisibility != "nobody"
            shareTyping = s.typingPrivacy != "nobody"
            sendReadReceipts = s.readReceiptsPrivacy != "nobody"
            muteDialogRequests = s.muteDialogRequests
        } catch { self.error = error.localizedDescription }
        isLoading = false
    }

    private func saveSettings(_ payload: [String: Any], reconnect: Bool = false) {
        guard !isSaving else { return }
        isSaving = true
        Task {
            do {
                try await session.api.saveSettings(payload)
                if reconnect { await session.reconnectRealtime() }
            } catch { self.error = error.localizedDescription }
            isSaving = false
        }
    }
}

// MARK: - Blocked users list

struct BlockedUsersView: View {
    @EnvironmentObject var session: SessionStore
    @State private var blocked: [BlockedUser] = []
    @State private var isLoading = true
    @State private var error: String?
    @State private var unblocking: Set<Int> = []

    var body: some View {
        ZStack {
            Color.smBg.ignoresSafeArea()

            if isLoading {
                ProgressView().tint(Color.smAccent)
            } else if blocked.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "hand.raised.slash")
                        .font(.system(size: 42))
                        .foregroundStyle(Color.smFaint)
                    Text("Нет заблокированных")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(Color.smMuted)
                    Text("Заблокированные пользователи не смогут писать вам и звонить.")
                        .font(.system(size: 13.5))
                        .foregroundStyle(Color.smFaint)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 40)
                }
            } else {
                ScrollView(showsIndicators: false) {
                    VStack(spacing: 0) {
                        ForEach(blocked) { user in
                            blockedRow(user)
                            if user.id != blocked.last?.id {
                                Divider().padding(.leading, 64).background(Color.smBorderSoft)
                            }
                        }
                    }
                    .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
                    .padding(.horizontal, 16)
                    .padding(.top, 16)
                }
            }
        }
        .navigationTitle("Заблокированные")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.smBg, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { await load() }
    }

    private func blockedRow(_ user: BlockedUser) -> some View {
        HStack(spacing: 12) {
            SmAvatarView(name: user.displayName, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(user.displayName)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.smText)
                    .lineLimit(1)
                Text("@\(user.username)")
                    .font(.system(size: 12.5))
                    .foregroundStyle(Color.smMuted)
            }
            Spacer()
            Button(action: { unblock(user) }) {
                if unblocking.contains(user.id) {
                    ProgressView().tint(Color.smAccent)
                        .frame(width: 84, height: 30)
                } else {
                    Text("Разблок.")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.smAccent2)
                        .frame(width: 84, height: 30)
                        .background(Color.smAccent.opacity(0.12), in: Capsule())
                }
            }
            .buttonStyle(.plain)
            .disabled(unblocking.contains(user.id))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    private func load() async {
        isLoading = true
        do { blocked = try await session.api.getBlockedUsers() }
        catch { self.error = error.localizedDescription }
        isLoading = false
    }

    private func unblock(_ user: BlockedUser) {
        guard !unblocking.contains(user.id) else { return }
        unblocking.insert(user.id)
        Task {
            do {
                try await session.api.unblockUser(userId: user.id)
                blocked.removeAll { $0.id == user.id }
                await session.refreshContacts()
            } catch {
                self.error = error.localizedDescription
            }
            unblocking.remove(user.id)
        }
    }
}
