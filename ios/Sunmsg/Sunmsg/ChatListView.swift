import SwiftUI
import AVFoundation

// MARK: - Chat list (mirrors web sidebar design)

struct ChatListView: View {
    @EnvironmentObject var session: SessionStore
    @State private var searchText = ""
    @State private var activeFilter = "all"
    @State private var showMnemonicUnlock = false
    @State private var showQRSheet = false
    @State private var pinningChatIds: Set<String> = []

    private var hasPrivateKey: Bool { KeychainService.loadPrivateKey() != nil }

    private var filters: [(id: String, label: String)] {
        let reqCount = session.pendingRequests.count
        return [
            ("all",      "Все"),
            ("requests", reqCount > 0 ? "Запросы \(reqCount)" : "Запросы"),
            ("groups",   "Группы"),
            ("archive",  "Архив"),
        ]
    }

    private var filtered: [Contact] {
        var list = session.contacts
        switch activeFilter {
        case "requests": list = list.filter { _ in false } // shown via pendingRequests below
        case "groups":   list = list.filter { $0.isGroup }
        case "archive":  list = []
        default: break
        }
        if !searchText.isEmpty {
            let q = searchText.lowercased()
            list = list.filter {
                $0.displayName.lowercased().contains(q) ||
                $0.username.lowercased().contains(q)
            }
        }
        return list
    }

    var body: some View {
        ZStack {
            Color.smBg.ignoresSafeArea()

            VStack(spacing: 0) {
                topCard
                lockBanner
                if filtered.isEmpty && !searchText.isEmpty {
                    emptySearch
                } else if session.contacts.isEmpty {
                    emptyContacts
                } else {
                    contactList
                }
                profileFooter
            }
        }
        .navigationBarHidden(true)
        .sheet(isPresented: $showMnemonicUnlock) {
            MnemonicUnlockSheet()
        }
        .sheet(isPresented: $showQRSheet) {
            UserQRSheet()
        }
        .refreshable { await session.refreshContacts() }
        .onReceive(NotificationCenter.default.publisher(for: UIApplication.willEnterForegroundNotification)) { _ in
            Task { await session.refreshContacts() }
        }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                guard !Task.isCancelled else { return }
                await session.refreshContacts()
            }
        }
    }

    // MARK: - Top card: brand + search + tabs

    private var topCard: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                // Sun brand mark
                HStack(spacing: 7) {
                    SunMarkView(size: 18)
                    Text("sun")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(Color.smText)
                        .tracking(-0.4)
                }

                Rectangle()
                    .fill(Color.smBorder)
                    .frame(width: 0.5, height: 18)

                // Search input
                HStack(spacing: 7) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.smMuted)
                    TextField("Поиск", text: $searchText)
                        .font(.system(size: 14))
                        .foregroundStyle(Color.smText)
                        .tint(Color.smAccent)
                        .autocorrectionDisabled()
                    if !searchText.isEmpty {
                        Button(action: { searchText = "" }) {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 13))
                                .foregroundStyle(Color.smFaint)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(Color.smBorder.opacity(0.3), in: RoundedRectangle(cornerRadius: 10))
                .frame(maxWidth: .infinity)

                // Compose button — opens Contacts tab (search/start dialog)
                Button(action: { session.selectedTab = 2 }) {
                    Image(systemName: "square.and.pencil")
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(Color.smAccent2)
                        .frame(width: 32, height: 32)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 12)
            .padding(.top, 8)
            .padding(.bottom, 8)

            // Filter tabs
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    ForEach(filters, id: \.id) { f in
                        let active = activeFilter == f.id
                        Button(action: {
                            withAnimation(.easeInOut(duration: 0.14)) { activeFilter = f.id }
                        }) {
                            Text(f.label)
                                .font(.system(size: 13, weight: active ? .semibold : .medium))
                                .foregroundStyle(active ? Color.smBg : Color.smMuted)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 6)
                                .background(active ? Color.smText : Color.clear, in: RoundedRectangle(cornerRadius: 8))
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 8)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(Color.smSurface)
                .shadow(color: Color.black.opacity(0.06), radius: 1, x: 0, y: 1)
                .overlay(
                    RoundedRectangle(cornerRadius: 14)
                        .stroke(Color.smBorder, lineWidth: 0.5)
                )
        )
        .padding(.horizontal, 12)
        .padding(.top, 6)
        .padding(.bottom, 8)
    }

    // MARK: - E2E lock banner

    @ViewBuilder
    private var lockBanner: some View {
        if !hasPrivateKey {
            Button(action: { showMnemonicUnlock = true }) {
                HStack(spacing: 10) {
                    Image(systemName: "lock.open.fill")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.smAccent2)
                        .frame(width: 14)

                    VStack(alignment: .leading, spacing: 1) {
                        Text("История заблокирована — нажмите для восстановления")
                            .font(.system(size: 12.5, weight: .semibold))
                            .foregroundStyle(Color.smText)
                            .tracking(-0.1)
                        Text("Введите 24 слова, чтобы расшифровать сообщения")
                            .font(.system(size: 11))
                            .foregroundStyle(Color.smMuted)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(Color.smFaint)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .background(Color.smReqBg, in: RoundedRectangle(cornerRadius: 12))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(Color.smReqBorder, lineWidth: 0.5)
                )
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 12)
            .padding(.bottom, 8)
        }
    }

    // MARK: - Contact list

    private var contactList: some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(spacing: 0) {
                ForEach(filtered) { contact in
                    NavigationLink(destination: ChatView(contact: contact)) {
                        SidebarContactRow(contact: contact)
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button {
                            togglePinned(contact)
                        } label: {
                            Label(contact.isPinned ? "Открепить" : "Закрепить", systemImage: contact.isPinned ? "pin.slash" : "pin")
                        }
                        .disabled(pinningChatIds.contains(contact.chatId))
                    }
                }
            }
        }
    }

    private func togglePinned(_ contact: Contact) {
        guard !pinningChatIds.contains(contact.chatId) else { return }
        pinningChatIds.insert(contact.chatId)
        Task {
            do {
                if contact.isPinned {
                    try await session.api.unpinChat(chatId: contact.chatId)
                } else {
                    try await session.api.pinChat(chatId: contact.chatId)
                }
                await session.refreshContacts()
            } catch APIError.unauthorized {
                session.route = .login
            } catch {
                await session.refreshContacts()
            }
            pinningChatIds.remove(contact.chatId)
        }
    }

    // MARK: - Profile footer (QR / Status only)

    private var profileFooter: some View {
        let user = session.bootstrap?.user
        return VStack(spacing: 0) {
            Button(action: { showQRSheet = true }) {
                HStack(spacing: 12) {
                    ZStack(alignment: .bottomTrailing) {
                        SmAvatarView(name: user?.displayName ?? "?", avatarUrl: user?.avatarUrl, size: 40)
                        Circle()
                            .fill(Color.smOnline)
                            .frame(width: 11, height: 11)
                            .overlay(Circle().stroke(Color.smSurface, lineWidth: 2))
                            .offset(x: 1, y: 1)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        Text(user?.displayName ?? "—")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(Color.smText)
                            .tracking(-0.2)
                            .lineLimit(1)
                        HStack(spacing: 6) {
                            Text("@\(user?.username ?? "—")")
                                .font(.system(size: 12))
                                .foregroundStyle(Color.smAccent)
                            SyncChipView()
                        }
                    }

                    Spacer()

                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(Color.smAccent.opacity(0.10))
                            .frame(width: 34, height: 34)
                        Image(systemName: "qrcode")
                            .font(.system(size: 16))
                            .foregroundStyle(Color.smAccent2)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
            }
            .buttonStyle(.plain)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(Color.smSurface)
                    .shadow(color: Color.black.opacity(0.06), radius: 1, x: 0, y: 1)
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(Color.smBorder, lineWidth: 0.5)
                    )
            )
            .padding(.horizontal, 12)
            .padding(.top, 8)
            .padding(.bottom, 6)
        }
    }

    // MARK: - Empty states

    private var emptySearch: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "magnifyingglass")
                .font(.system(size: 36))
                .foregroundStyle(Color.smFaint)
            Text("Нет результатов для «\(searchText)»")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(Color.smMuted)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private var emptyContacts: some View {
        VStack(spacing: 0) {
            Spacer()

            AmberOrb(size: 84)
                .padding(.bottom, 22)

            Text("добро пожаловать в sun")
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(Color.smText)
                .tracking(-0.4)

            Text("тихие сообщения, тёплый свет –\nначните разговор, когда будет настроение")
                .font(.custom("Georgia", size: 14).italic())
                .foregroundStyle(Color.smMuted)
                .multilineTextAlignment(.center)
                .lineSpacing(3)
                .padding(.horizontal, 36)
                .padding(.top, 8)

            Button(action: {
                // Open new chat / people view
                NotificationCenter.default.post(name: .openNewChat, object: nil)
            }) {
                HStack(spacing: 8) {
                    Image(systemName: "square.and.pencil")
                        .font(.system(size: 14, weight: .semibold))
                    Text("начать диалог")
                        .font(.system(size: 14, weight: .semibold))
                        .tracking(-0.1)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .foregroundStyle(Color(hex: "#fbf8f1"))
                .background(Color.smText, in: Capsule())
                .shadow(color: Color.smText.opacity(0.25), radius: 10, x: 0, y: 4)
            }
            .buttonStyle(.plain)
            .padding(.top, 28)

            HStack(spacing: 6) {
                Image(systemName: "lock.fill")
                    .font(.system(size: 11))
                Text("сообщения зашифрованы сквозным шифрованием")
                    .font(.system(size: 11.5, weight: .medium))
            }
            .foregroundStyle(Color.smOnline)
            .padding(.top, 22)

            Spacer()
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}

extension Notification.Name {
    static let openNewChat = Notification.Name("openNewChat")
}

// MARK: - Sidebar contact row

struct SidebarContactRow: View {
    let contact: Contact
    @EnvironmentObject var session: SessionStore

    var body: some View {
        let isSavedMessages = contact.userId != nil && contact.userId == session.bootstrap?.user.id
        let displayName = isSavedMessages ? "Избранное" : contact.displayName

        HStack(spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                if isSavedMessages {
                    ZStack {
                        Circle()
                            .fill(Color.smAccent)
                            .frame(width: 44, height: 44)
                            .shadow(color: .black.opacity(0.10), radius: 1, x: 0, y: 1)
                        Image(systemName: "bookmark.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(Color.smSurface)
                    }
                } else {
                    SmAvatarView(
                        name: contact.displayName,
                        avatarUrl: contact.avatarUrl,
                        isGroup: contact.isGroup,
                        size: 44
                    )
                }
                if contact.isOnline && !isSavedMessages {
                    Circle()
                        .fill(Color.smOnline)
                        .frame(width: 12, height: 12)
                        .overlay(Circle().stroke(Color.smBg, lineWidth: 2))
                        .offset(x: 1, y: 1)
                }
            }

            VStack(alignment: .leading, spacing: 3) {
                HStack(alignment: .firstTextBaseline) {
                    Text(displayName)
                        .font(.system(size: 15, weight: contact.unreadCount > 0 ? .semibold : .medium))
                        .foregroundStyle(Color.smText)
                        .lineLimit(1)
                        .tracking(-0.2)
                    if contact.isPinned {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Color.smFaint)
                    }
                    Spacer(minLength: 4)
                    if let ts = contact.lastMessageTime {
                        Text(smFormatTime(ts))
                            .font(.system(size: 11.5, weight: contact.unreadCount > 0 ? .semibold : .regular))
                            .foregroundStyle(contact.unreadCount > 0 ? Color.smAccent2 : Color.smFaint)
                    }
                }

                HStack(alignment: .center) {
                    Text(contact.lastMessagePreview)
                        .font(contact.isTyping ? .system(size: 13.5).italic() : .system(size: 13.5))
                        .foregroundStyle(contact.isTyping ? Color.smAccent : Color.smMuted)
                        .lineLimit(1)
                        .tracking(-0.1)
                    Spacer(minLength: 4)
                    if contact.unreadCount > 0 {
                        SmBadge(count: contact.unreadCount)
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
        .background(Color.smBg)
        .contentShape(Rectangle())
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(Color.smBorderSoft)
                .frame(height: 0.5)
                .padding(.leading, 70)
        }
    }
}

// MARK: - Sun mark view

struct SunMarkView: View {
    var size: CGFloat = 22

    var body: some View {
        Canvas { ctx, sz in
            let c = CGPoint(x: sz.width / 2, y: sz.height / 2)
            let r1 = sz.width * 0.485
            let r2 = sz.width * 0.36
            // Outer ring
            ctx.stroke(
                Path(ellipseIn: CGRect(x: c.x - r1, y: c.y - r1, width: r1 * 2, height: r1 * 2)),
                with: .color(Color.smAccent.opacity(0.55)),
                lineWidth: size * 0.045
            )
            // Filled disk
            ctx.fill(
                Path(ellipseIn: CGRect(x: c.x - r2, y: c.y - r2, width: r2 * 2, height: r2 * 2)),
                with: .color(Color.smAccent)
            )
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Sync chip view

struct SyncChipView: View {
    @EnvironmentObject var session: SessionStore

    var body: some View {
        let state = session.socketState
        let label = state == .connected ? "СИНХ" : (state == .connecting ? "ПОДКЛ" : "ОФФ")
        let color = state == .connected ? Color.smOnline : (state == .connecting ? Color.smAccent2 : Color.smMuted)

        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
            Text(label)
                .font(.system(size: 9.5, weight: .bold))
                .foregroundStyle(color)
                .tracking(0.5)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(color.opacity(0.10), in: Capsule())
        .overlay(Capsule().stroke(color.opacity(0.22), lineWidth: 0.5))
    }
}

// MARK: - Mnemonic unlock sheet

struct MnemonicUnlockSheet: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject var session: SessionStore
    @State private var mnemonic = ""
    @State private var username = ""
    @State private var isLoading = false
    @State private var errorMsg: String?
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            ZStack {
                Color.smBg.ignoresSafeArea()

                ScrollView(showsIndicators: false) {
                    VStack(spacing: 24) {
                        // Hero
                        VStack(spacing: 12) {
                            ZStack {
                                RoundedRectangle(cornerRadius: 16)
                                    .fill(Color.smAccent.opacity(0.14))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 16)
                                            .stroke(Color.smAccent.opacity(0.30), lineWidth: 0.5)
                                    )
                                    .frame(width: 56, height: 56)
                                Image(systemName: "lock.open.fill")
                                    .font(.system(size: 26))
                                    .foregroundStyle(Color.smAccent2)
                            }

                            Text("Введите 24 слова")
                                .font(.system(size: 22, weight: .bold))
                                .foregroundStyle(Color.smText)
                                .tracking(-0.6)

                            Text("восстановите доступ к зашифрованным сообщениям")
                                .font(.system(size: 15).italic())
                                .foregroundStyle(Color.smMuted)
                                .multilineTextAlignment(.center)
                        }
                        .padding(.top, 8)

                        // Username field
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Имя пользователя")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Color.smMuted)
                                .textCase(.uppercase)
                                .tracking(0.5)
                            TextField("@username", text: $username)
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                                .font(.system(size: 15))
                                .foregroundStyle(Color.smText)
                                .tint(Color.smAccent)
                                .padding(.horizontal, 14)
                                .padding(.vertical, 12)
                                .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 12))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 12)
                                        .stroke(Color.smBorder, lineWidth: 0.75)
                                )
                        }

                        // Mnemonic field
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Секретная фраза (24 слова)")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(Color.smMuted)
                                .textCase(.uppercase)
                                .tracking(0.5)

                            ZStack(alignment: .topLeading) {
                                if mnemonic.isEmpty {
                                    Text("слово1 слово2 слово3 … слово24")
                                        .font(.system(size: 14, design: .monospaced))
                                        .foregroundStyle(Color.smFaint)
                                        .padding(.horizontal, 16)
                                        .padding(.top, 14)
                                        .allowsHitTesting(false)
                                }
                                TextEditor(text: $mnemonic)
                                    .focused($focused)
                                    .font(.system(size: 14, design: .monospaced))
                                    .foregroundStyle(Color.smText)
                                    .tint(Color.smAccent)
                                    .autocorrectionDisabled()
                                    .textInputAutocapitalization(.never)
                                    .scrollContentBackground(.hidden)
                                    .frame(minHeight: 100, maxHeight: 140)
                                    .padding(.horizontal, 10)
                                    .padding(.vertical, 6)
                            }
                            .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 12))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(focused ? Color.smAccent.opacity(0.6) : Color.smBorder, lineWidth: 0.75)
                            )

                            HStack(spacing: 5) {
                                Image(systemName: "doc.on.doc")
                                    .font(.system(size: 11))
                                    .foregroundStyle(Color.smAccent2)
                                Text("Вставить все слова из буфера")
                                    .font(.system(size: 12))
                                    .foregroundStyle(Color.smAccent2)
                            }
                            .onTapGesture {
                                if let str = UIPasteboard.general.string { mnemonic = str }
                            }
                        }

                        if let err = errorMsg {
                            HStack(spacing: 6) {
                                Image(systemName: "exclamationmark.circle.fill")
                                Text(err).font(.system(size: 13.5)).fixedSize(horizontal: false, vertical: true)
                            }
                            .foregroundStyle(Color.smDanger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        // Unlock button
                        Button(action: handleUnlock) {
                            HStack(spacing: 8) {
                                if isLoading {
                                    ProgressView().tint(Color(hex: "#fbf8f1")).scaleEffect(0.85)
                                } else {
                                    Image(systemName: "lock.open.fill").font(.system(size: 15))
                                }
                                Text(isLoading ? "Разблокировка…" : "Разблокировать · нужно ещё \(24 - wordCount)")
                                    .font(.system(size: 15, weight: .semibold))
                                    .tracking(-0.2)
                            }
                            .frame(maxWidth: .infinity)
                            .padding(.vertical, 14)
                            .foregroundStyle(Color(hex: "#fbf8f1"))
                            .background(isReady ? Color.smAccent : Color.smBorder, in: RoundedRectangle(cornerRadius: 12))
                            .shadow(color: isReady ? Color.smAccent.opacity(0.35) : .clear, radius: 8, x: 0, y: 4)
                        }
                        .buttonStyle(.plain)
                        .disabled(!isReady || isLoading)

                        Text("ключи никогда не покидают устройство · sun не имеет доступа к вашей фразе")
                            .font(.system(size: 11))
                            .foregroundStyle(Color.smFaint)
                            .multilineTextAlignment(.center)
                            .padding(.bottom, 20)
                    }
                    .padding(.horizontal, 24)
                }
            }
            .navigationTitle("Восстановление доступа")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Отмена") { dismiss() }
                        .foregroundStyle(Color.smMuted)
                }
            }
        }
    }

    private var wordCount: Int {
        mnemonic.trimmingCharacters(in: .whitespacesAndNewlines)
            .components(separatedBy: .whitespaces)
            .filter { !$0.isEmpty }.count
    }

    private var isReady: Bool {
        let u = username.trimmingCharacters(in: .whitespaces)
        return !u.isEmpty && wordCount == 24 && !isLoading
    }

    private func handleUnlock() {
        let trimmedUser = username.trimmingCharacters(in: .whitespaces).lowercased()
            .trimmingCharacters(in: CharacterSet(charactersIn: "@"))
        let trimmedMnemonic = mnemonic.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedUser.isEmpty, wordCount == 24 else { return }
        isLoading = true
        errorMsg = nil
        focused = false

        Task {
            do {
                let api = APIClient.shared
                api.resetAuthSession()
                let csrfTok = try await api.getCsrfToken()
                api.csrfToken = csrfTok
                let challengeResp = try await api.getChallenge(username: trimmedUser)
                let (privateKeyPEM, signature): (String, String) = try await Task.detached(priority: .userInitiated) {
                    let pem = try SunCrypto.decryptVault(challengeResp.loginVault, mnemonic: trimmedMnemonic)
                    let sig = try SunCrypto.rsaSign(challengeResp.challenge, privateKeyPEM: pem)
                    return (pem, sig)
                }.value
                _ = try await api.loginChallenge(signature: signature)
                try? KeychainService.savePrivateKey(privateKeyPEM)
                await session.loadBootstrap()
                await MainActor.run { dismiss() }
            } catch SunCryptoError.noDecryptionKey {
                await MainActor.run {
                    errorMsg = "Неверная фраза — не удалось расшифровать хранилище."
                    isLoading = false
                }
            } catch let apiErr as APIError {
                await MainActor.run { errorMsg = apiErr.localizedDescription; isLoading = false }
            } catch {
                await MainActor.run { errorMsg = error.localizedDescription; isLoading = false }
            }
        }
    }
}

// MARK: - Shared components (SmAvatarView, SmBadge)

struct SmAvatarView: View {
    let name: String
    var avatarUrl: String? = nil
    var isGroup: Bool = false
    var size: CGFloat = 40

    private var initials: String {
        name.components(separatedBy: " ").prefix(2)
            .compactMap { $0.first.map(String.init) }
            .joined().uppercased()
    }

    private var gradient: LinearGradient {
        var h: UInt32 = 0
        for scalar in name.unicodeScalars { h = h &* 31 &+ scalar.value }
        let hue  = Double(18 + Int(h % 38)) / 360.0
        let hue2 = Double((18 + Int(h % 38) + 22) % 360) / 360.0
        return LinearGradient(
            colors: [
                Color(hue: hue,  saturation: 0.58, brightness: 0.82),
                Color(hue: hue2, saturation: 0.68, brightness: 0.64),
            ],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
    }

    var body: some View {
        ZStack {
            Circle()
                .fill(gradient)
                .frame(width: size, height: size)
                .shadow(color: .black.opacity(0.10), radius: 1, x: 0, y: 1)

            if let url = APIClient.shared.absoluteURL(from: avatarUrl) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image.resizable().scaledToFill()
                    default:
                        avatarFallback
                    }
                }
                .frame(width: size, height: size)
                .clipShape(Circle())
            } else {
                avatarFallback
            }
        }
    }

    @ViewBuilder
    private var avatarFallback: some View {
        if isGroup {
            Image(systemName: "person.2.fill")
                .font(.system(size: size * 0.36))
                .foregroundStyle(Color(hex: "#fbf8f1"))
        } else {
            Text(initials.isEmpty ? "?" : initials)
                .font(.system(size: size * 0.38, weight: .semibold))
                .foregroundStyle(Color(hex: "#fbf8f1"))
                .tracking(-0.3)
        }
    }
}

struct SmBadge: View {
    let count: Int

    var body: some View {
        Text(count > 99 ? "99+" : "\(count)")
            .font(.system(size: 11.5, weight: .semibold))
            .foregroundStyle(Color(hex: "#fbf8f1"))
            .padding(.horizontal, 7)
            .padding(.vertical, 2.5)
            .background(Color.smAccent, in: Capsule())
    }
}

// MARK: - QR code helper

func generateQRCodeImage(from string: String) -> UIImage? {
    let data = Data(string.utf8)
    guard let filter = CIFilter(name: "CIQRCodeGenerator") else { return nil }
    filter.setValue(data, forKey: "inputMessage")
    filter.setValue("M", forKey: "inputCorrectionLevel")
    guard let output = filter.outputImage else { return nil }
    let scaled = output.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
    let context = CIContext()
    guard let cgImage = context.createCGImage(scaled, from: scaled.extent) else { return nil }
    return UIImage(cgImage: cgImage)
}

// MARK: - User QR sheet (show own QR + scanner)

struct UserQRSheet: View {
    @EnvironmentObject var session: SessionStore
    @Environment(\.dismiss) private var dismiss
    @State private var selectedTab = 0
    @State private var scannedValue: String?
    @State private var showScannedAlert = false

    private var user: BootstrapUser? { session.bootstrap?.user }

    private var qrContent: String {
        "@\(user?.username ?? "unknown")"
    }

    private var qrImage: UIImage? {
        generateQRCodeImage(from: qrContent)
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.smBg.ignoresSafeArea()

                VStack(spacing: 0) {
                    // Tab selector
                    HStack(spacing: 0) {
                        tabButton("Мой QR", index: 0)
                        tabButton("Сканировать", index: 1)
                    }
                    .padding(3)
                    .background(Color.smBorder.opacity(0.30), in: RoundedRectangle(cornerRadius: 10))
                    .padding(.horizontal, 24)
                    .padding(.top, 8)
                    .padding(.bottom, 16)

                    if selectedTab == 0 {
                        myQRView
                    } else {
                        QRScannerView(onScanned: { value in
                            scannedValue = value
                            showScannedAlert = true
                        })
                        .ignoresSafeArea(edges: .bottom)
                    }

                    Spacer(minLength: 0)
                }
            }
            .navigationTitle("QR код")
            .navigationBarTitleDisplayMode(.inline)
            .toolbarBackground(Color.smBg, for: .navigationBar)
            .toolbarBackground(.visible, for: .navigationBar)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Закрыть") { dismiss() }
                        .foregroundStyle(Color.smMuted)
                }
            }
            .alert("QR код отсканирован", isPresented: $showScannedAlert) {
                if let val = scannedValue, val.hasPrefix("@") {
                    Button("Найти контакт") {
                        session.selectedTab = 2
                        dismiss()
                    }
                }
                Button("OK", role: .cancel) {}
            } message: {
                Text(scannedValue ?? "")
            }
        }
    }

    private var myQRView: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 20) {
                // QR card
                VStack(spacing: 16) {
                    if let img = qrImage {
                        Image(uiImage: img)
                            .interpolation(.none)
                            .resizable()
                            .scaledToFit()
                            .frame(width: 220, height: 220)
                            .padding(20)
                            .background(Color.white, in: RoundedRectangle(cornerRadius: 18))
                            .overlay(RoundedRectangle(cornerRadius: 18).stroke(Color.smBorder, lineWidth: 0.5))
                    } else {
                        RoundedRectangle(cornerRadius: 18)
                            .fill(Color.smBorder.opacity(0.3))
                            .frame(width: 260, height: 260)
                    }

                    VStack(spacing: 4) {
                        Text(user?.displayName ?? "—")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(Color.smText)
                            .tracking(-0.3)
                        Text(qrContent)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(Color.smAccent2)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 8)

                Text("Покажите этот QR другому пользователю sun, чтобы он смог добавить вас в контакты")
                    .font(.system(size: 13))
                    .foregroundStyle(Color.smFaint)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)

                HStack(spacing: 5) {
                    Image(systemName: "lock.fill").font(.system(size: 11)).foregroundStyle(Color.smOnline)
                    Text("Данные зашифрованы · sun")
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(Color.smOnline)
                }
                .padding(.bottom, 24)
            }
        }
    }

    private func tabButton(_ label: String, index: Int) -> some View {
        Button(action: { withAnimation(.easeInOut(duration: 0.18)) { selectedTab = index } }) {
            Text(label)
                .font(.system(size: 13, weight: selectedTab == index ? .semibold : .medium))
                .foregroundStyle(selectedTab == index ? Color.smText : Color.smMuted)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 7)
                .background(
                    selectedTab == index ? Color.smSurface : Color.clear,
                    in: RoundedRectangle(cornerRadius: 8)
                )
                .shadow(
                    color: selectedTab == index ? Color.black.opacity(0.06) : .clear,
                    radius: 2, y: 1
                )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - QR scanner (AVFoundation-based)

struct QRScannerView: UIViewControllerRepresentable {
    let onScanned: (String) -> Void

    func makeUIViewController(context: Context) -> QRScannerViewController {
        let vc = QRScannerViewController()
        vc.delegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ uiViewController: QRScannerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onScanned: onScanned) }

    class Coordinator: NSObject, AVCaptureMetadataOutputObjectsDelegate {
        let onScanned: (String) -> Void
        private var hasScanned = false
        init(onScanned: @escaping (String) -> Void) { self.onScanned = onScanned }

        func metadataOutput(_ output: AVCaptureMetadataOutput,
                            didOutput metadataObjects: [AVMetadataObject],
                            from connection: AVCaptureConnection) {
            guard !hasScanned,
                  let obj = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
                  obj.type == .qr,
                  let value = obj.stringValue else { return }
            hasScanned = true
            DispatchQueue.main.async { self.onScanned(value) }
        }
    }
}

final class QRScannerViewController: UIViewController {
    var delegate: AVCaptureMetadataOutputObjectsDelegate?
    private var session: AVCaptureSession?
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var permissionDeniedLabel: UILabel?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        checkPermission()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    private func checkPermission() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: setupCamera()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                DispatchQueue.main.async { if granted { self?.setupCamera() } else { self?.showPermissionDenied() } }
            }
        default: showPermissionDenied()
        }
    }

    private func setupCamera() {
        let session = AVCaptureSession()
        guard let device = AVCaptureDevice.default(for: .video),
              let input = try? AVCaptureDeviceInput(device: device),
              session.canAddInput(input) else { showPermissionDenied(); return }
        session.addInput(input)
        let output = AVCaptureMetadataOutput()
        guard session.canAddOutput(output) else { return }
        session.addOutput(output)
        output.setMetadataObjectsDelegate(delegate, queue: .main)
        output.metadataObjectTypes = [.qr]
        let preview = AVCaptureVideoPreviewLayer(session: session)
        preview.videoGravity = .resizeAspectFill
        view.layer.addSublayer(preview)
        previewLayer = preview
        self.session = session
        DispatchQueue.global(qos: .userInitiated).async { session.startRunning() }
    }

    private func showPermissionDenied() {
        let label = UILabel()
        label.text = "Нет доступа к камере.\nРазрешите доступ в Настройках."
        label.textColor = .white
        label.numberOfLines = 0
        label.textAlignment = .center
        label.font = .systemFont(ofSize: 15)
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
        ])
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        session?.stopRunning()
    }
}
