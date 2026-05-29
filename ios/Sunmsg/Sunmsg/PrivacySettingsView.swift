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
    @State private var navigateToTotp = false
    @State private var showMnemonicInfo = false
    @State private var hasPrivateKeyLoaded = false

    private var hasKey: Bool { hasPrivateKeyLoaded }

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
        .onAppear {
            refreshPrivateKeyState()
        }
        .navigationDestination(isPresented: $navigateToBlocked) { BlockedUsersView() }
        .navigationDestination(isPresented: $navigateToDevices) { DevicesView() }
        .navigationDestination(isPresented: $navigateToTotp) { TotpSettingsView() }
        .alert("Секретная фраза", isPresented: $showMnemonicInfo) {
            Button("Понятно", role: .cancel) {}
        } message: {
            Text("Ваши 24 слова показываются один раз при создании аккаунта и нигде не сохраняются. Храните их в надёжном месте — это единственный способ восстановить доступ.")
        }
    }

    private func refreshPrivateKeyState() {
        hasPrivateKeyLoaded = KeychainService.hasPrivateKey()
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
                settingsNavRow(icon: "number.square.fill", label: "TOTP 2FA", detail: "Authenticator") { navigateToTotp = true }
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

private enum TotpPendingAction: Identifiable {
    case disable
    case regenerateSecret

    var id: String {
        switch self {
        case .disable: return "disable"
        case .regenerateSecret: return "regenerateSecret"
        }
    }

    var title: String {
        switch self {
        case .disable: return "Отключить TOTP?"
        case .regenerateSecret: return "Пересоздать TOTP-секрет?"
        }
    }

    var message: String {
        switch self {
        case .disable:
            return "Второй фактор будет отключён, резервные коды будут удалены, а сохранённые сессии сброшены."
        case .regenerateSecret:
            return "Текущий секрет перестанет подходить после подтверждения нового кода."
        }
    }

    var confirmTitle: String {
        switch self {
        case .disable: return "Отключить"
        case .regenerateSecret: return "Пересоздать"
        }
    }

    var apiAction: String {
        switch self {
        case .disable: return "disable"
        case .regenerateSecret: return "regenerate"
        }
    }
}

struct TotpSettingsView: View {
    @EnvironmentObject var session: SessionStore
    @State private var status: TotpResponse?
    @State private var isLoading = true
    @State private var isWorking = false
    @State private var error: String?
    @State private var setupCode = ""
    @State private var regenerateCode = ""
    @State private var showRegenerateBackup = false
    @State private var newBackupCodes: [String] = []
    @State private var pendingAction: TotpPendingAction?
    private static let enabledAtParser: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ru_RU")
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter
    }()

    var body: some View {
        ZStack {
            Color.smBg.ignoresSafeArea()

            ScrollView(showsIndicators: false) {
                VStack(spacing: 18) {
                    if isLoading {
                        ProgressView()
                            .tint(Color.smAccent)
                            .frame(maxWidth: .infinity, minHeight: 220)
                    } else if let status {
                        statusCard(status)
                        if status.setupPending {
                            setupPanel(status)
                        }
                        if status.enabled && !status.setupPending {
                            backupCodesPanel(status)
                        }
                        actionPanel(status)
                    }

                    if let error {
                        Text(error)
                            .font(.system(size: 12.5))
                            .foregroundStyle(Color.smDanger)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 8)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 16)
            }
            .refreshable { await loadStatus(showSpinner: false) }
        }
        .navigationTitle("TOTP 2FA")
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(Color.smBg, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .task { await loadStatus() }
        .confirmationDialog(pendingAction?.title ?? "Подтвердите действие", isPresented: pendingActionBinding, titleVisibility: .visible) {
            if let pendingAction {
                Button(pendingAction.confirmTitle, role: .destructive) {
                    Task { await performConfirmedAction(pendingAction) }
                }
            }
            Button("Отмена", role: .cancel) { pendingAction = nil }
        } message: {
            Text(pendingAction?.message ?? "")
        }
    }

    private var pendingActionBinding: Binding<Bool> {
        Binding(
            get: { pendingAction != nil },
            set: { if !$0 { pendingAction = nil } }
        )
    }

    private func statusCard(_ status: TotpResponse) -> some View {
        let enabled = status.enabled && !status.setupPending
        let pending = status.setupPending
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill((enabled ? Color.smOnline : pending ? Color.smAccent : Color.smDanger).opacity(0.12))
                        .frame(width: 38, height: 38)
                    Image(systemName: enabled ? "checkmark.shield.fill" : pending ? "clock.badge.checkmark" : "shield.slash.fill")
                        .font(.system(size: 18))
                        .foregroundStyle(enabled ? Color.smOnline : pending ? Color.smAccent : Color.smDanger)
                }
                VStack(alignment: .leading, spacing: 3) {
                    Text(enabled ? "TOTP включён" : pending ? "Ожидает подтверждения" : "TOTP выключен")
                        .font(.system(size: 15.5, weight: .semibold))
                        .foregroundStyle(Color.smText)
                    Text(enabled ? "Подключено: \(formatEnabledAt(status.totpEnabledAt))" : "Authenticator-код не требуется при входе")
                        .font(.system(size: 12.5))
                        .foregroundStyle(Color.smMuted)
                }
                Spacer()
            }
            Text("TOTP добавляет второй фактор к входу и работает с любым Authenticator-приложением.")
                .font(.system(size: 12.5))
                .foregroundStyle(Color.smFaint)
        }
        .padding(14)
        .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
    }

    private func setupPanel(_ status: TotpResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("ПОДТВЕРЖДЕНИЕ НАСТРОЙКИ")
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .top, spacing: 14) {
                    qrCodeView(uri: status.totpUri)
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Секрет")
                            .font(.system(size: 12.5, weight: .semibold))
                            .foregroundStyle(Color.smText)
                        Text(status.totpSecret)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundStyle(Color.smMuted)
                            .textSelection(.enabled)
                            .lineLimit(4)
                        Button("Скопировать секрет") {
                            UIPasteboard.general.string = status.totpSecret
                        }
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(Color.smAccent2)
                    }
                }

                codeInput(title: "6-значный код", text: $setupCode)
                primaryButton(title: "Подтвердить TOTP", disabled: setupCode.count != 6 || isWorking) {
                    Task { await verifySetup() }
                }
            }
            .padding(14)
            .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
        }
    }

    private func backupCodesPanel(_ status: TotpResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("РЕЗЕРВНЫЕ КОДЫ")
            VStack(alignment: .leading, spacing: 12) {
                Text("Осталось неиспользованных: \(status.backupCodesRemaining) из 10")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.smMuted)

                if !newBackupCodes.isEmpty {
                    backupCodesList(newBackupCodes)
                    HStack(spacing: 10) {
                        secondaryButton(title: "Скопировать") {
                            UIPasteboard.general.string = newBackupCodes.joined(separator: "\n")
                        }
                        secondaryButton(title: "Готово") {
                            newBackupCodes.removeAll()
                        }
                    }
                }

                Button(showRegenerateBackup ? "Скрыть обновление кодов" : "Получить новые резервные коды") {
                    showRegenerateBackup.toggle()
                    regenerateCode = ""
                }
                .font(.system(size: 13.5, weight: .semibold))
                .foregroundStyle(Color.smAccent2)

                if showRegenerateBackup {
                    codeInput(title: "Код из Authenticator", text: $regenerateCode)
                    primaryButton(title: "Обновить резервные коды", disabled: regenerateCode.count != 6 || isWorking) {
                        Task { await regenerateBackupCodes() }
                    }
                }
            }
            .padding(14)
            .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
        }
    }

    private func actionPanel(_ status: TotpResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("ДЕЙСТВИЯ")
            VStack(spacing: 0) {
                if status.enabled {
                    actionRow(icon: "arrow.triangle.2.circlepath", title: "Пересоздать TOTP-секрет", tint: Color.smAccent2) {
                        pendingAction = .regenerateSecret
                    }
                    Divider().padding(.leading, 52).background(Color.smBorderSoft)
                    actionRow(icon: "shield.slash.fill", title: "Отключить TOTP", tint: Color.smDanger) {
                        pendingAction = .disable
                    }
                } else {
                    actionRow(icon: "checkmark.shield.fill", title: status.setupPending ? "Сгенерировать новый секрет" : "Включить TOTP", tint: Color.smAccent2) {
                        Task { await manageTotp(action: "enable") }
                    }
                }
            }
            .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
        }
    }

    private func actionRow(icon: String, title: String, tint: Color, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 8)
                        .fill(tint.opacity(0.12))
                        .frame(width: 32, height: 32)
                    Image(systemName: icon)
                        .font(.system(size: 14))
                        .foregroundStyle(tint)
                }
                Text(title)
                    .font(.system(size: 15))
                    .foregroundStyle(tint)
                Spacer()
                if isWorking {
                    ProgressView()
                        .tint(Color.smAccent)
                } else {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(Color.smFaint)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(isWorking)
    }

    private func qrCodeView(uri: String) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.white)
                .frame(width: 150, height: 150)
            if let qr = generateQRCodeImage(from: uri) {
                Image(uiImage: qr)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 132, height: 132)
            } else {
                Text("QR недоступен")
                    .font(.system(size: 12))
                    .foregroundStyle(Color.smMuted)
            }
        }
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.smBorder, lineWidth: 0.5))
    }

    private func codeInput(title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 12.5, weight: .semibold))
                .foregroundStyle(Color.smText)
            TextField("000000", text: text)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .font(.system(size: 20, weight: .semibold, design: .monospaced))
                .multilineTextAlignment(.center)
                .foregroundStyle(Color.smText)
                .padding(.vertical, 10)
                .background(Color.smSurface2, in: RoundedRectangle(cornerRadius: 10))
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.smBorder, lineWidth: 0.5))
                .onChange(of: text.wrappedValue) { _, value in
                    let clean = sanitizedCode(value)
                    if clean != value {
                        text.wrappedValue = clean
                    }
                }
                .disabled(isWorking)
        }
    }

    private func backupCodesList(_ codes: [String]) -> some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 8) {
            ForEach(codes, id: \.self) { code in
                Text(code)
                    .font(.system(size: 13, weight: .semibold, design: .monospaced))
                    .foregroundStyle(Color.smText)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(Color.smSurface2, in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func primaryButton(title: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack {
                Spacer()
                if isWorking {
                    ProgressView().tint(.white)
                } else {
                    Text(title)
                        .font(.system(size: 14.5, weight: .semibold))
                }
                Spacer()
            }
            .foregroundStyle(.white)
            .padding(.vertical, 12)
            .background(disabled ? Color.smFaint : Color.smAccent2, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
    }

    private func secondaryButton(title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 13.5, weight: .semibold))
                .foregroundStyle(Color.smAccent2)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(Color.smAccent.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }

    private func sectionHeader(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11.5, weight: .semibold))
            .foregroundStyle(Color.smFaint)
            .tracking(0.6)
            .padding(.horizontal, 4)
    }

    private func loadStatus(showSpinner: Bool = true) async {
        if showSpinner { isLoading = true }
        error = nil
        do {
            status = try await session.api.getTotpStatus()
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            self.error = error.localizedDescription
        }
        isLoading = false
    }

    private func performConfirmedAction(_ action: TotpPendingAction) async {
        pendingAction = nil
        await manageTotp(action: action.apiAction)
    }

    private func manageTotp(action: String) async {
        guard !isWorking else { return }
        isWorking = true
        error = nil
        defer { isWorking = false }
        do {
            let payload = try await session.api.manageTotp(action: action)
            status = payload
            setupCode = ""
            regenerateCode = ""
            newBackupCodes.removeAll()
            showRegenerateBackup = false
            if action == "disable" {
                await session.reconnectRealtime()
            }
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func verifySetup() async {
        let code = sanitizedCode(setupCode)
        guard code.count == 6, !isWorking else { return }
        isWorking = true
        error = nil
        defer { isWorking = false }
        do {
            let payload = try await session.api.verifyTotpSetup(code: code)
            status = payload
            setupCode = ""
            newBackupCodes = payload.backupCodes
            showRegenerateBackup = false
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func regenerateBackupCodes() async {
        let code = sanitizedCode(regenerateCode)
        guard code.count == 6, !isWorking else { return }
        isWorking = true
        error = nil
        defer { isWorking = false }
        do {
            let payload = try await session.api.regenerateTotpBackupCodes(code: code)
            newBackupCodes = payload.backupCodes
            regenerateCode = ""
            showRegenerateBackup = false
            await loadStatus(showSpinner: false)
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func sanitizedCode(_ value: String) -> String {
        String(value.filter(\.isNumber).prefix(6))
    }

    private func formatEnabledAt(_ raw: String) -> String {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return "неизвестно" }
        if let date = Self.enabledAtParser.date(from: value) {
            return SunDateFormatters.ruFullDateTime(from: date)
        }
        return value
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
