import SwiftUI

struct PrivacySettingsView: View {
    @EnvironmentObject var session: SessionStore
    @State private var isPublic = false
    @State private var autoDeclineRequests = false
    @State private var muteDialogRequests = false
    @State private var hideOnlineStatus = false
    @State private var lastSeenVisibility = "contacts"
    @State private var avatarVisibility = "contacts"
    @State private var bioVisibility = "contacts"
    @State private var forwardLinkPrivacy = "contacts"
    @State private var groupInvitePrivacy = "contacts"
    @State private var voiceMessagePrivacy = "contacts"
    @State private var messagePrivacy = "contacts"
    @State private var readReceiptsPrivacy = "contacts"
    @State private var typingPrivacy = "contacts"
    @State private var voiceListenedPrivacy = "contacts"
    @State private var callPrivacy = "contacts"
    @State private var publicKeySearchPrivacy = "contacts"
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var error: String?
    @State private var blockedCount = 0
    @State private var showMnemonicInfo = false
    @State private var hasPrivateKeyLoaded = false

    private var hasKey: Bool { hasPrivateKeyLoaded }

    private var keyStatusText: String {
        hasKey ? "Сохранён в Keychain · RSA-2048" : "Не загружен — войдите заново"
    }

    var body: some View {
        Form {
            Section {
                HStack(spacing: 12) {
                    Image(systemName: hasKey ? "checkmark.shield.fill" : "exclamationmark.shield.fill")
                        .foregroundStyle(hasKey ? Color.smOnline : Color.smDanger)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(hasKey ? "Сквозное шифрование активно" : "Ключ шифрования не загружен")
                        Text(keyStatusText)
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }
            } footer: {
                Text("Ключи генерируются на устройстве. sun не имеет доступа к содержимому сообщений.")
            }

            Section {
                Toggle("Публичный профиль", isOn: Binding(
                    get: { isPublic },
                    set: { value in isPublic = value; saveSettings(["is_public": value]) }
                ))
                privacyPicker("Время последнего захода", selection: $lastSeenVisibility, key: "last_seen_visibility", reconnect: true)
                privacyPicker("Фото профиля", selection: $avatarVisibility, key: "avatar_visibility")
                privacyPicker("Bio", selection: $bioVisibility, key: "bio_visibility")
                privacyPicker("Поиск по публичному ключу", selection: $publicKeySearchPrivacy, key: "public_key_search_privacy")
            } header: {
                Text("Видимость профиля")
            }

            Section {
                Toggle("Автоматически отклонять запросы", isOn: Binding(
                    get: { autoDeclineRequests },
                    set: { value in autoDeclineRequests = value; saveSettings(["auto_decline_requests": value]) }
                ))
                Toggle("Без уведомлений о запросах", isOn: Binding(
                    get: { muteDialogRequests },
                    set: { value in muteDialogRequests = value; saveSettings(["mute_dialog_requests": value]) }
                ))
                privacyPicker("Приглашения в группы", selection: $groupInvitePrivacy, key: "group_invite_privacy")
                privacyPicker("Личные сообщения", selection: $messagePrivacy, key: "message_privacy")
                privacyPicker("Голосовые сообщения", selection: $voiceMessagePrivacy, key: "voice_message_privacy")
            } header: {
                Text("Запросы и доступ")
            }

            Section {
                privacyPicker("Ссылка при пересылке", selection: $forwardLinkPrivacy, key: "forward_link_privacy")
                privacyPicker("Отчёты о прочтении", selection: $readReceiptsPrivacy, key: "read_receipts_privacy")
                privacyPicker("Индикатор набора", selection: $typingPrivacy, key: "typing_privacy")
                privacyPicker("Прослушивание голосовых", selection: $voiceListenedPrivacy, key: "voice_listened_privacy")
                privacyPicker("Звонки", selection: $callPrivacy, key: "call_privacy")
                Toggle("Скрывать статус онлайн", isOn: Binding(
                    get: { hideOnlineStatus },
                    set: { value in
                        hideOnlineStatus = value
                        lastSeenVisibility = value ? "nobody" : "contacts"
                        saveSettings([
                            "hide_online_status": value,
                            "last_seen_visibility": lastSeenVisibility,
                        ], reconnect: true)
                    }
                ))
            } header: {
                Text("Активность")
            }

            Section {
                Button { showMnemonicInfo = true } label: {
                    Label("Секретная фраза восстановления", systemImage: "key")
                }
                NavigationLink { TotpSettingsView() } label: {
                    Label("TOTP 2FA", systemImage: "number.square")
                }
                NavigationLink { DevicesView() } label: {
                    Label("Активные устройства", systemImage: "iphone.and.ipad")
                }
                NavigationLink { BlockedUsersView() } label: {
                    HStack {
                        Label("Заблокированные пользователи", systemImage: "hand.raised.fill")
                        Spacer()
                        Text("\(blockedCount)")
                            .foregroundStyle(.secondary)
                    }
                }
            } header: {
                Text("Безопасность")
            }

            Section {
                externalLink("Политика конфиденциальности", path: "/privacy")
                externalLink("Пользовательское соглашение", path: "/terms")
                externalLink("FAQ по анонимности и безопасности", path: "/security-faq")
                externalLink("О проекте", path: "/about")
            } header: {
                Text("Документы и правила")
            }

            if let error {
                Section {
                    Text(error)
                        .font(.footnote)
                        .foregroundStyle(Color.smDanger)
                }
            }
        }
        .smSettingsScreenStyle()
        .navigationTitle("Приватность")
        .task { await loadSettings() }
        .task { await loadBlockedCount() }
        .onAppear {
            refreshPrivateKeyState()
        }
        .alert("Секретная фраза", isPresented: $showMnemonicInfo) {
            Button("Понятно", role: .cancel) {}
        } message: {
            Text("Ваши 24 слова показываются один раз при создании аккаунта и нигде не сохраняются. Храните их в надёжном месте — это единственный способ восстановить доступ.")
        }
    }

    private func refreshPrivateKeyState() {
        hasPrivateKeyLoaded = KeychainService.hasPrivateKey()
    }

    private func privacyPicker(_ title: String, selection: Binding<String>, key: String, reconnect: Bool = false) -> some View {
        Picker(title, selection: Binding(
            get: { selection.wrappedValue },
            set: { value in
                selection.wrappedValue = value
                saveSettings([key: value], reconnect: reconnect)
            }
        )) {
            Text("Все").tag("all")
            Text("Контакты").tag("contacts")
            Text("Никто").tag("nobody")
        }
        .disabled(isLoading || isSaving)
    }

    private func externalLink(_ title: String, path: String) -> some View {
        Link(destination: URL(string: path, relativeTo: URL(string: kBaseURL))!.absoluteURL) {
            Label(title, systemImage: "doc.text")
        }
    }

    // MARK: - API

    private func loadBlockedCount() async {
        blockedCount = (try? await session.api.getBlockedUsers().count) ?? blockedCount
    }

    private func loadSettings() async {
        isLoading = true
        do {
            let s = try await session.api.getSettings()
            isPublic = s.isPublic
            autoDeclineRequests = s.autoDeclineRequests
            muteDialogRequests = s.muteDialogRequests
            hideOnlineStatus = s.hideOnlineStatus
            lastSeenVisibility = s.lastSeenVisibility
            avatarVisibility = s.avatarVisibility
            bioVisibility = s.bioVisibility
            forwardLinkPrivacy = s.forwardLinkPrivacy
            groupInvitePrivacy = s.groupInvitePrivacy
            voiceMessagePrivacy = s.voiceMessagePrivacy
            messagePrivacy = s.messagePrivacy
            readReceiptsPrivacy = s.readReceiptsPrivacy
            typingPrivacy = s.typingPrivacy
            voiceListenedPrivacy = s.voiceListenedPrivacy
            callPrivacy = s.callPrivacy
            publicKeySearchPrivacy = s.publicKeySearchPrivacy
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
    @State private var setupQRImage: UIImage?
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
                            .font(.footnote)
                            .foregroundStyle(Color.smDanger)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 8)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 16)
            }
            .scrollDismissesKeyboard(.interactively)
            .refreshable { await loadStatus(showSpinner: false) }
        }
        .navigationTitle("TOTP 2FA")
        .smSettingsScreenStyle()
        .task { await loadStatus() }
        .task(id: status?.totpUri ?? "") {
            let uri = status?.totpUri ?? ""
            setupQRImage = uri.isEmpty
                ? nil
                : await Task.detached(priority: .userInitiated) {
                    generateQRCodeImage(from: uri)
                }.value
        }
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
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.smText)
                    Text(enabled ? "Подключено: \(formatEnabledAt(status.totpEnabledAt))" : "Authenticator-код не требуется при входе")
                        .font(.footnote)
                        .foregroundStyle(Color.smMuted)
                }
                Spacer()
            }
            Text("TOTP добавляет второй фактор к входу и работает с любым Authenticator-приложением.")
                .font(.footnote)
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
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .top, spacing: 14) {
                        qrCodeView
                        totpSecretBlock(status)
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        qrCodeView
                            .frame(maxWidth: .infinity, alignment: .center)
                        totpSecretBlock(status)
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

    private func totpSecretBlock(_ status: TotpResponse) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Секрет")
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Color.smText)
            Text(status.totpSecret)
                .font(.system(.footnote, design: .monospaced))
                .foregroundStyle(Color.smMuted)
                .textSelection(.enabled)
                .lineLimit(4)
            Button("Скопировать секрет") {
                UIPasteboard.general.string = status.totpSecret
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(Color.smAccent2)
        }
    }

    private func backupCodesPanel(_ status: TotpResponse) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            sectionHeader("РЕЗЕРВНЫЕ КОДЫ")
            VStack(alignment: .leading, spacing: 12) {
                Text("Осталось неиспользованных: \(status.backupCodesRemaining) из 10")
                    .font(.footnote)
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
                .font(.subheadline.weight(.semibold))
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
                    .font(.subheadline)
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

    private var qrCodeView: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10)
                .fill(Color.white)
                .frame(width: 150, height: 150)
            if let qr = setupQRImage {
                Image(uiImage: qr)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
                    .frame(width: 132, height: 132)
            } else {
                Text("QR недоступен")
                    .font(.caption)
                    .foregroundStyle(Color.smMuted)
            }
        }
        .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color.smBorder, lineWidth: 0.5))
    }

    private func codeInput(title: String, text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.footnote.weight(.semibold))
                .foregroundStyle(Color.smText)
            TextField("000000", text: text)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .font(.system(.title3, design: .monospaced, weight: .semibold))
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
                    .font(.system(.footnote, design: .monospaced, weight: .semibold))
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
                        .font(.subheadline.weight(.semibold))
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
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.smAccent2)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(Color.smAccent.opacity(0.12), in: RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
    }

    private func sectionHeader(_ text: String) -> some View {
        Text(text)
            .font(.caption2.weight(.semibold))
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
                        .font(.title3.weight(.semibold))
                        .foregroundStyle(Color.smMuted)
                    Text("Заблокированные пользователи не смогут писать вам и звонить.")
                        .font(.footnote)
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
        .smSettingsScreenStyle()
        .task { await load() }
    }

    private func blockedRow(_ user: BlockedUser) -> some View {
        HStack(spacing: 12) {
            SmAvatarView(name: user.displayName, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(user.displayName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.smText)
                    .lineLimit(1)
                Text("@\(user.username)")
                    .font(.footnote)
                    .foregroundStyle(Color.smMuted)
            }
            Spacer()
            Button(action: { unblock(user) }) {
                if unblocking.contains(user.id) {
                    ProgressView().tint(Color.smAccent)
                        .frame(minWidth: 84, minHeight: 30)
                } else {
                    Text("Разблок.")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.smAccent2)
                        .frame(minWidth: 84, minHeight: 30)
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
