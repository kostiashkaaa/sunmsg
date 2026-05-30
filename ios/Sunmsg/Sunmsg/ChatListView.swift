import SwiftUI
import AVFoundation

// MARK: - Chat list (mirrors web sidebar design)

private enum ChatListSheet: String, Identifiable {
    case mnemonicUnlock
    case userQR

    var id: String { rawValue }
}

struct ChatListView: View {
    @EnvironmentObject var session: SessionStore
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase
    @State private var searchText = ""
    @State private var activeFilter = "all"
    @State private var activeSheet: ChatListSheet?
    @State private var pinningChatIds: Set<String> = []
    @State private var pendingRemovalContact: Contact?
    @State private var removingChatIds: Set<String> = []
    @State private var handlingRequestIds: Set<String> = []
    @State private var removalError: String?
    @State private var hasPrivateKeyLoaded = false
    @State private var privateKeyRefreshTask: Task<Void, Never>?

    private var hasPrivateKey: Bool { hasPrivateKeyLoaded }

    private var filters: [(id: String, label: String)] {
        let reqCount = session.pendingRequests.count
        return [
            ("all",      "Все"),
            ("requests", reqCount > 0 ? "Запросы \(reqCount)" : "Запросы"),
            ("groups",   "Группы"),
            ("archive",  "Архив"),
        ]
    }

    private var hasSearchQuery: Bool {
        !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var filteredContacts: [Contact] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        if activeFilter == "requests" || activeFilter == "archive" {
            return []
        }
        if activeFilter == "all" && query.isEmpty {
            return session.contacts
        }

        return session.contacts.filter { contact in
            switch activeFilter {
            case "groups":
                guard contact.isGroup else { return false }
            default:
                break
            }

            guard !query.isEmpty else { return true }
            return contact.displayName.localizedCaseInsensitiveContains(query) ||
                contact.username.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        let contacts = filteredContacts

        ZStack {
            Color.smBg.ignoresSafeArea()

            VStack(spacing: 0) {
                topCard
                lockBanner
                if activeFilter == "requests" {
                    requestsList
                } else if contacts.isEmpty && activeFilter == "archive" {
                    emptyFilteredContacts
                } else if contacts.isEmpty && hasSearchQuery {
                    emptySearch
                } else if contacts.isEmpty {
                    if activeFilter == "all" {
                        emptyContacts
                    } else {
                        emptyFilteredContacts
                    }
                } else {
                    contactList(contacts)
                }
                profileFooter
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .scrollDismissesKeyboard(.interactively)
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .mnemonicUnlock:
                MnemonicUnlockSheet()
                    .onDisappear { refreshPrivateKeyState() }
            case .userQR:
                UserQRSheet()
            }
        }
        .onAppear {
            refreshPrivateKeyState()
        }
        .onDisappear {
            privateKeyRefreshTask?.cancel()
            privateKeyRefreshTask = nil
        }
        .refreshable { await refreshSidebarData() }
        .onChange(of: scenePhase) { _, phase in
            guard phase == .active else { return }
            Task { await refreshSidebarData() }
        }
        .confirmationDialog(removalDialogTitle, isPresented: removalDialogBinding, titleVisibility: .visible) {
            if let contact = pendingRemovalContact {
                if contact.isGroup {
                    Button("Покинуть группу", role: .destructive) {
                        removeChat(contact, mode: nil)
                    }
                } else {
                    Button("Удалить только у меня", role: .destructive) {
                        removeChat(contact, mode: "for_me")
                    }
                    Button("Удалить у обоих участников", role: .destructive) {
                        removeChat(contact, mode: "for_both")
                    }
                }
            }
            Button("Отмена", role: .cancel) { pendingRemovalContact = nil }
        } message: {
            Text(removalDialogMessage)
        }
        .alert("Не удалось выполнить действие", isPresented: removalErrorBinding) {
            Button("OK", role: .cancel) { removalError = nil }
        } message: {
            Text(removalError ?? "")
        }
        .task {
            do {
                while !Task.isCancelled {
                    try await Task.sleep(nanoseconds: 30_000_000_000)
                    try Task.checkCancellation()
                    await refreshSidebarData()
                }
            } catch is CancellationError {
                return
            } catch {
                return
            }
        }
    }

    private func refreshPrivateKeyState() {
        privateKeyRefreshTask?.cancel()
        privateKeyRefreshTask = Task { @MainActor in
            let loaded = await Task.detached(priority: .userInitiated) {
                KeychainService.hasPrivateKey()
            }.value
            guard !Task.isCancelled else { return }
            hasPrivateKeyLoaded = loaded
            privateKeyRefreshTask = nil
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
                        .font(.headline.weight(.bold))
                        .foregroundStyle(Color.smText)
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
                        .font(.body)
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
                        Button(action: { selectFilter(f.id) }) {
                            Text(f.label)
                                .font(.caption.weight(active ? .semibold : .medium))
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

    private func selectFilter(_ id: String) {
        guard id != activeFilter else { return }
        guard !reduceMotion else {
            activeFilter = id
            return
        }
        withAnimation(.easeInOut(duration: 0.14)) {
            activeFilter = id
        }
    }

    // MARK: - E2E lock banner

    @ViewBuilder
    private var lockBanner: some View {
        if !hasPrivateKey {
            Button(action: { activeSheet = .mnemonicUnlock }) {
                HStack(spacing: 10) {
                    Image(systemName: "lock.open.fill")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(Color.smAccent2)
                        .frame(width: 14)

                    VStack(alignment: .leading, spacing: 1) {
                        Text("История заблокирована — нажмите для восстановления")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(Color.smText)
                        Text("Введите 24 слова, чтобы расшифровать сообщения")
                            .font(.caption2)
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

    private func contactList(_ contacts: [Contact]) -> some View {
        ScrollView(showsIndicators: false) {
            LazyVStack(spacing: 0) {
                ForEach(contacts) { contact in
                    NavigationLink {
                        ChatView(contact: contact)
                    } label: {
                        SidebarContactRow(
                            contact: contact,
                            isSavedMessages: contact.userId != nil && contact.userId == session.bootstrap?.user.id
                        )
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button {
                            togglePinned(contact)
                        } label: {
                            Label(contact.isPinned ? "Открепить" : "Закрепить", systemImage: contact.isPinned ? "pin.slash" : "pin")
                        }
                        .disabled(pinningChatIds.contains(contact.chatId))
                        if canRemoveChat(contact) {
                            Button(role: .destructive) {
                                pendingRemovalContact = contact
                            } label: {
                                Label(contact.isGroup ? "Покинуть группу" : "Удалить чат", systemImage: contact.isGroup ? "rectangle.portrait.and.arrow.right" : "trash")
                            }
                            .disabled(removingChatIds.contains(contact.chatId))
                        }
                    }
                }
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var requestsList: some View {
        let pendingRequests = session.pendingRequests

        return Group {
            if pendingRequests.isEmpty {
                emptyRequests
            } else {
                ScrollView(showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        ForEach(pendingRequests) { request in
                            DialogRequestRow(
                                request: request,
                                isActing: handlingRequestIds.contains(request.id),
                                onAccept: { acceptRequest(request) },
                                onDecline: { declineRequest(request) }
                            )
                            if request.id != pendingRequests.last?.id {
                                Divider()
                                    .padding(.leading, 72)
                                    .background(Color.smBorderSoft)
                            }
                        }
                    }
                    .background(Color.smSurface)
                    .clipShape(RoundedRectangle(cornerRadius: 16))
                    .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.smBorder, lineWidth: 0.5))
                    .shadow(color: Color(hex: "#281e0f").opacity(0.05), radius: 6, x: 0, y: 2)
                    .padding(.horizontal, 12)
                    .padding(.top, 4)
                    .padding(.bottom, 12)
                }
                .scrollDismissesKeyboard(.interactively)
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
                removalError = error.localizedDescription
                await session.refreshContacts()
            }
            pinningChatIds.remove(contact.chatId)
        }
    }

    private func acceptRequest(_ request: DialogRequest) {
        guard !handlingRequestIds.contains(request.id) else { return }
        handlingRequestIds.insert(request.id)
        Task {
            do {
                _ = try await session.api.acceptDialogRequest(request)
                await session.refreshDialogRequests()
                await session.refreshContacts()
            } catch APIError.unauthorized {
                session.route = .login
            } catch {
                await session.refreshDialogRequests()
            }
            handlingRequestIds.remove(request.id)
        }
    }

    private func declineRequest(_ request: DialogRequest) {
        guard !handlingRequestIds.contains(request.id) else { return }
        handlingRequestIds.insert(request.id)
        Task {
            do {
                try await session.api.declineDialogRequest(request)
                await session.refreshDialogRequests()
            } catch APIError.unauthorized {
                session.route = .login
            } catch {
                await session.refreshDialogRequests()
            }
            handlingRequestIds.remove(request.id)
        }
    }

    private func refreshSidebarData() async {
        await session.refreshContacts()
        await session.refreshDialogRequests()
    }

    private var removalDialogBinding: Binding<Bool> {
        Binding(
            get: { pendingRemovalContact != nil },
            set: { if !$0 { pendingRemovalContact = nil } }
        )
    }

    private var removalErrorBinding: Binding<Bool> {
        Binding(
            get: { removalError != nil },
            set: { if !$0 { removalError = nil } }
        )
    }

    private var removalDialogTitle: String {
        pendingRemovalContact?.isGroup == true ? "Покинуть группу?" : "Удалить чат?"
    }

    private var removalDialogMessage: String {
        guard let contact = pendingRemovalContact else { return "" }
        if contact.isGroup {
            return "Вы перестанете видеть эту группу. История у других участников останется."
        }
        return "Удаление только у меня скроет чат в вашем списке. Удаление у обоих участников удалит чат безвозвратно."
    }

    private func canRemoveChat(_ contact: Contact) -> Bool {
        guard let currentUserId = session.bootstrap?.user.id else { return true }
        return contact.userId != currentUserId
    }

    private func removeChat(_ contact: Contact, mode: String?) {
        guard !removingChatIds.contains(contact.chatId) else { return }
        let chatId = contact.chatId
        pendingRemovalContact = nil
        removingChatIds.insert(chatId)
        Task {
            do {
                if contact.isGroup {
                    try await session.api.leaveGroupChat(chatId: chatId)
                } else {
                    try await session.api.deleteChat(chatId: chatId, mode: mode ?? "for_me")
                }
                await ChatLocalStore.shared.deleteChat(chatId: chatId)
                await session.refreshContacts()
            } catch APIError.unauthorized {
                session.route = .login
            } catch {
                removalError = error.localizedDescription
                await session.refreshContacts()
            }
            removingChatIds.remove(chatId)
        }
    }

    // MARK: - Profile footer (QR / Status only)

    private var profileFooter: some View {
        let user = session.bootstrap?.user
        let username = (user?.username ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return VStack(spacing: 0) {
            Button(action: { activeSheet = .userQR }) {
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
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.smText)
                            .lineLimit(1)
                        HStack(spacing: 6) {
                            Text(username.isEmpty ? "пользователь" : "@\(username)")
                                .font(.caption)
                                .foregroundStyle(Color.smAccent)
                                .lineLimit(1)
                                .truncationMode(.middle)
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
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color.smMuted)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private var emptyRequests: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "tray")
                .font(.system(size: 36))
                .foregroundStyle(Color.smFaint)
            Text("Нет новых запросов")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color.smMuted)
            Text("Новые диалоги и приглашения появятся здесь.")
                .font(.caption)
                .foregroundStyle(Color.smFaint)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    private var emptyFilteredContacts: some View {
        let isArchive = activeFilter == "archive"
        return VStack(spacing: 12) {
            Spacer()
            Image(systemName: isArchive ? "archivebox" : "person.2")
                .font(.system(size: 36))
                .foregroundStyle(Color.smFaint)
            Text(isArchive ? "Архив пуст" : "Нет групп")
                .font(.subheadline.weight(.medium))
                .foregroundStyle(Color.smMuted)
            Text(isArchive ? "Скрытые диалоги появятся здесь." : "Групповые чаты появятся здесь после создания или приглашения.")
                .font(.caption)
                .foregroundStyle(Color.smFaint)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 32)
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
                .font(.title3.weight(.bold))
                .foregroundStyle(Color.smText)

            Text("тихие сообщения, тёплый свет –\nначните разговор, когда будет настроение")
                .font(.custom("Georgia", size: 14, relativeTo: .subheadline).italic())
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
                        .font(.subheadline.weight(.semibold))
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
                    .font(.caption2.weight(.medium))
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
    let isSavedMessages: Bool

    var body: some View {
        let displayName = isSavedMessages ? "Избранное" : contact.displayName
        let muted = contact.isMuted && !isSavedMessages

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
                        .font(.subheadline.weight(contact.unreadCount > 0 ? .semibold : .medium))
                        .foregroundStyle(Color.smText)
                        .lineLimit(1)
                    if contact.isPinned {
                        Image(systemName: "pin.fill")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Color.smFaint)
                    }
                    if muted {
                        Image(systemName: "bell.slash.fill")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(Color.smFaint)
                    }
                    Spacer(minLength: 4)
                    if let ts = contact.previewTimestamp {
                        Text(smFormatTime(ts))
                            .font(.caption2.weight(contact.unreadCount > 0 ? .semibold : .regular))
                            .foregroundStyle(contact.unreadCount > 0 && !muted ? Color.smAccent2 : Color.smFaint)
                            .fixedSize(horizontal: true, vertical: false)
                    }
                }

                HStack(alignment: .center) {
                    Text(contact.lastMessagePreview)
                        .font(contact.isTyping ? .caption.italic() : .caption)
                        .foregroundStyle(contact.isTyping ? Color.smAccent : Color.smMuted)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    if contact.unreadCount > 0 {
                        SmBadge(count: contact.unreadCount, muted: muted)
                            .fixedSize(horizontal: true, vertical: false)
                    }
                }
            }
            .layoutPriority(1)
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
    @State private var socketState = SocketClient.shared.state

    var body: some View {
        let state = socketState
        let label = state == .connected ? "СИНХ" : (state == .connecting ? "ПОДКЛ" : "ОФФ")
        let color = state == .connected ? Color.smOnline : (state == .connecting ? Color.smAccent2 : Color.smMuted)

        HStack(spacing: 4) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
            Text(label)
                .font(.caption2.weight(.bold))
                .foregroundStyle(color)
                .tracking(0.5)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(color.opacity(0.10), in: Capsule())
        .overlay(Capsule().stroke(color.opacity(0.22), lineWidth: 0.5))
        .onAppear {
            socketState = SocketClient.shared.state
        }
        .onReceive(NotificationCenter.default.publisher(for: .smSocketStateChanged)) { _ in
            socketState = SocketClient.shared.state
        }
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
                                .font(.title2.weight(.bold))
                                .foregroundStyle(Color.smText)

                            Text("восстановите доступ к зашифрованным сообщениям")
                                .font(.subheadline.italic())
                                .foregroundStyle(Color.smMuted)
                                .multilineTextAlignment(.center)
                        }
                        .padding(.top, 8)

                        // Username field
                        VStack(alignment: .leading, spacing: 6) {
                            Text("Имя пользователя")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Color.smMuted)
                                .textCase(.uppercase)
                                .tracking(0.5)
                            TextField("@username", text: $username)
                                .autocorrectionDisabled()
                                .textInputAutocapitalization(.never)
                                .font(.body)
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
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(Color.smMuted)
                                .textCase(.uppercase)
                                .tracking(0.5)

                            ZStack(alignment: .topLeading) {
                                if mnemonic.isEmpty {
                                    Text("слово1 слово2 слово3 … слово24")
                                        .font(.system(.subheadline, design: .monospaced))
                                        .foregroundStyle(Color.smFaint)
                                        .padding(.horizontal, 16)
                                        .padding(.top, 14)
                                        .allowsHitTesting(false)
                                }
                                TextEditor(text: $mnemonic)
                                    .focused($focused)
                                    .font(.system(.subheadline, design: .monospaced))
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
                                    .font(.caption)
                                    .foregroundStyle(Color.smAccent2)
                            }
                            .onTapGesture {
                                if let str = UIPasteboard.general.string { mnemonic = str }
                            }
                        }

                        if let err = errorMsg {
                            HStack(spacing: 6) {
                                Image(systemName: "exclamationmark.circle.fill")
                                Text(err).font(.subheadline).fixedSize(horizontal: false, vertical: true)
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
                                    .font(.subheadline.weight(.semibold))
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
                            .font(.caption2)
                            .foregroundStyle(Color.smFaint)
                            .multilineTextAlignment(.center)
                            .padding(.bottom, 20)
                    }
                    .padding(.horizontal, 24)
                }
                .scrollDismissesKeyboard(.interactively)
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
        guard !isLoading else { return }
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
                try await AuthKeychainPersistence.savePrivateKey(privateKeyPEM)
                await session.loadBootstrap()
                await MainActor.run {
                    guard session.route == .main else {
                        errorMsg = session.errorMessage ?? "Не удалось загрузить сессию. Попробуйте ещё раз."
                        session.errorMessage = nil
                        isLoading = false
                        return
                    }
                    dismiss()
                }
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
        .frame(width: size, height: size)
        .fixedSize()
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
        }
    }
}

struct SmBadge: View {
    let count: Int
    var muted: Bool = false

    var body: some View {
        Text(count > 99 ? "99+" : "\(count)")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(Color(hex: "#fbf8f1"))
            .padding(.horizontal, 7)
            .padding(.vertical, 2.5)
            .background(muted ? Color.smFaint : Color.smAccent, in: Capsule())
    }
}

// MARK: - User QR sheet (show own QR + scanner)

struct UserQRSheet: View {
    @EnvironmentObject var session: SessionStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var selectedTab = 0
    @State private var qrImage: UIImage?
    @State private var scannerRestartId = UUID()
    @State private var isHandlingScan = false
    @State private var scanStatus = "Наведите камеру на QR профиля или QR-входа."
    @State private var scanResultTitle = ""
    @State private var scanResultMessage = ""
    @State private var scanResultOpensPeople = false
    @State private var showScanResult = false

    private var user: BootstrapUser? { session.bootstrap?.user }

    private var username: String {
        (user?.username ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var displayHandle: String {
        username.isEmpty ? "пользователь" : "@\(username)"
    }

    private var qrContent: String {
        username.isEmpty ? "" : "su:\(username)"
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
                        scannerView
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
            .alert(scanResultTitle, isPresented: $showScanResult) {
                if scanResultOpensPeople {
                    Button("Открыть контакты") {
                        session.selectedTab = 2
                        dismiss()
                    }
                }
                Button("OK", role: .cancel) {
                    restartScanner()
                }
            } message: {
                Text(scanResultMessage)
            }
            .task(id: qrContent) {
                let content = qrContent
                guard !content.isEmpty else {
                    qrImage = nil
                    return
                }
                let image = await Task.detached(priority: .userInitiated) {
                    generateQRCodeImage(from: content)
                }.value
                guard !Task.isCancelled, qrContent == content else { return }
                qrImage = image
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
                            .font(.headline.weight(.semibold))
                            .foregroundStyle(Color.smText)
                            .lineLimit(1)
                            .minimumScaleFactor(0.82)
                        Text(displayHandle)
                            .font(.subheadline.weight(.medium))
                            .foregroundStyle(Color.smAccent2)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
                .padding(.horizontal, 24)
                .padding(.top, 8)

                Text("Покажите этот QR другому пользователю SUN: сканер откроет профиль и поможет начать чат.")
                    .font(.footnote)
                    .foregroundStyle(Color.smFaint)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 32)

                HStack(spacing: 5) {
                    Image(systemName: "lock.fill").font(.system(size: 11)).foregroundStyle(Color.smOnline)
                    Text("QR содержит только публичный @username")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(Color.smOnline)
                }
                .padding(.bottom, 24)
            }
        }
    }

    private var scannerView: some View {
        VStack(spacing: 14) {
            ZStack {
                QRScannerView(onScanned: handleScannedValue)
                    .id(scannerRestartId)

                QRScannerFrameOverlay(active: !isHandlingScan)

                if isHandlingScan {
                    Color.black.opacity(0.34)
                    VStack(spacing: 10) {
                        ProgressView()
                            .tint(.white)
                        Text(scanStatus)
                            .font(.footnote.weight(.medium))
                            .foregroundStyle(.white)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 24)
                    }
                }
            }
            .frame(height: 360)
            .clipShape(RoundedRectangle(cornerRadius: 22))
            .overlay(RoundedRectangle(cornerRadius: 22).stroke(Color.smBorder, lineWidth: 0.5))
            .padding(.horizontal, 18)

            VStack(spacing: 6) {
                Text(scanStatus)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(Color.smText)
                    .multilineTextAlignment(.center)
                Text("Поддерживаются QR профиля, QR-входа skl: и перенос ключа sun-key-transfer.")
                    .font(.caption2)
                    .foregroundStyle(Color.smFaint)
                    .multilineTextAlignment(.center)
            }
            .padding(.horizontal, 28)

            if isHandlingScan {
                Button(action: restartScanner) {
                    Text("Сканировать заново")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(Color.smAccent2)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .background(Color.smAccent.opacity(0.10), in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func tabButton(_ label: String, index: Int) -> some View {
        Button(action: {
            if reduceMotion {
                selectedTab = index
            } else {
                withAnimation(.easeInOut(duration: 0.18)) { selectedTab = index }
            }
        }) {
            Text(label)
                .font(.subheadline.weight(selectedTab == index ? .semibold : .medium))
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

    private func handleScannedValue(_ rawValue: String) {
        guard !isHandlingScan else { return }
        let code = QRTransferCode.parse(rawValue)
        switch code.kind {
        case .profile:
            handleProfileCode(code)
        case .login, .device:
            handleTransferCode(code)
        case .unknown:
            scanResultTitle = "QR не распознан"
            scanResultMessage = "Этот код не похож на QR профиля или QR-входа SUN."
            scanResultOpensPeople = false
            showScanResult = true
            isHandlingScan = true
        }
    }

    private func handleProfileCode(_ code: QRTransferCode) {
        guard !code.username.isEmpty else { return }
        isHandlingScan = true
        scanStatus = "Ищем @\(code.username)..."
        let api = session.api
        Task {
            do {
                let response = try await api.startChat(username: code.username)
                await session.refreshContacts()
                await MainActor.run {
                    scanResultTitle = response.status == "existing" ? "Чат найден" : "Запрос отправлен"
                    scanResultMessage = response.status == "existing"
                        ? "Чат с @\(code.username) уже доступен в контактах."
                        : "Мы отправили запрос @\(code.username). Ответ появится в разделе запросов."
                    scanResultOpensPeople = true
                    showScanResult = true
                    isHandlingScan = false
                }
            } catch APIError.unauthorized {
                await MainActor.run {
                    dismiss()
                    session.route = .login
                }
            } catch {
                await MainActor.run {
                    scanResultTitle = "Не удалось открыть профиль"
                    scanResultMessage = error.localizedDescription
                    scanResultOpensPeople = false
                    showScanResult = true
                    isHandlingScan = false
                }
            }
        }
    }

    private func handleTransferCode(_ code: QRTransferCode) {
        isHandlingScan = true
        scanStatus = code.kind == .login ? "Подтверждаем QR-вход..." : "Передаем ключ на новое устройство..."
        let api = session.api
        Task {
            do {
                try await QRTransferService.submitLocalPrivateKey(for: code, api: api)
                await MainActor.run {
                    scanResultTitle = "Готово"
                    scanResultMessage = code.kind == .login
                        ? "QR-вход подтвержден. Второе устройство завершит вход автоматически."
                        : "Ключ передан на новое устройство."
                    scanResultOpensPeople = false
                    showScanResult = true
                    isHandlingScan = false
                }
            } catch APIError.unauthorized {
                await MainActor.run {
                    dismiss()
                    session.route = .login
                }
            } catch {
                await MainActor.run {
                    scanResultTitle = "QR-вход не выполнен"
                    scanResultMessage = error.localizedDescription
                    scanResultOpensPeople = false
                    showScanResult = true
                    isHandlingScan = false
                }
            }
        }
    }

    private func restartScanner() {
        isHandlingScan = false
        scanStatus = "Наведите камеру на QR профиля или QR-входа."
        scannerRestartId = UUID()
    }
}

// MARK: - QR scanner (AVFoundation-based)

private struct QRScannerFrameOverlay: View {
    let active: Bool

    var body: some View {
        ZStack {
            Color.black.opacity(0.10)
            RoundedRectangle(cornerRadius: 24)
                .stroke(active ? Color.white.opacity(0.92) : Color.white.opacity(0.45), lineWidth: 2)
                .frame(width: 220, height: 220)
            Image(systemName: "qrcode.viewfinder")
                .font(.system(size: 32, weight: .medium))
                .foregroundStyle(Color.white.opacity(0.78))
        }
        .allowsHitTesting(false)
    }
}

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
            onScanned(value)
        }
    }
}

final class QRScannerViewController: UIViewController {
    var delegate: AVCaptureMetadataOutputObjectsDelegate?
    private var session: AVCaptureSession?
    private let sessionQueue = DispatchQueue(label: "sunmsg.qrscanner.session", qos: .userInitiated)
    private var previewLayer: AVCaptureVideoPreviewLayer?
    private var permissionDeniedLabel: UILabel?
    private var isTearingDown = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        checkPermission()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        previewLayer?.frame = view.bounds
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        isTearingDown = false
    }

    private func checkPermission() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: setupCamera()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { [weak self] granted in
                Task { @MainActor [weak self] in
                    guard let self, !self.isTearingDown else { return }
                    if granted {
                        self.setupCamera()
                    } else {
                        self.showPermissionDenied()
                    }
                }
            }
        default: showPermissionDenied()
        }
    }

    private func setupCamera() {
        let metadataDelegate = delegate
        sessionQueue.async { [weak self] in
            let session = AVCaptureSession()
            if session.canSetSessionPreset(.high) {
                session.sessionPreset = .high
            }
            guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
                    ?? AVCaptureDevice.default(for: .video),
                  let input = try? AVCaptureDeviceInput(device: device),
                  session.canAddInput(input) else {
                DispatchQueue.main.async { self?.showPermissionDenied() }
                return
            }
            session.addInput(input)
            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else { return }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(metadataDelegate, queue: .main)
            output.metadataObjectTypes = [.qr]

            DispatchQueue.main.async { [weak self] in
                guard let self, !self.isTearingDown else { return }
                let preview = AVCaptureVideoPreviewLayer(session: session)
                preview.videoGravity = .resizeAspectFill
                preview.frame = self.view.bounds
                self.view.layer.addSublayer(preview)
                self.previewLayer = preview
                self.session = session
                self.sessionQueue.async { session.startRunning() }
            }
        }
    }

    private func showPermissionDenied() {
        guard !isTearingDown, permissionDeniedLabel == nil else { return }
        let label = UILabel()
        label.text = "Нет доступа к камере.\nРазрешите доступ в Настройках."
        label.textColor = .white
        label.numberOfLines = 0
        label.textAlignment = .center
        label.font = .preferredFont(forTextStyle: .body)
        label.adjustsFontForContentSizeCategory = true
        label.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(label)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            label.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 32),
            label.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -32),
        ])
        permissionDeniedLabel = label
    }

    override func viewWillDisappear(_ animated: Bool) {
        super.viewWillDisappear(animated)
        isTearingDown = true
        let runningSession = session
        session = nil
        sessionQueue.async {
            runningSession?.stopRunning()
        }
    }
}
