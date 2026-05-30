import SwiftUI

// MARK: - People (user search) tab

private struct PeopleChatDestination: Hashable {
    let contact: Contact

    static func == (lhs: PeopleChatDestination, rhs: PeopleChatDestination) -> Bool {
        lhs.contact.chatId == rhs.contact.chatId
    }

    func hash(into hasher: inout Hasher) {
        hasher.combine(contact.chatId)
    }
}

private enum PeopleSheetDestination: String, Identifiable {
    case groupCreate

    var id: String { rawValue }
}

struct PeopleView: View {
    @EnvironmentObject var session: SessionStore
    @State private var query = ""
    @State private var results: [SearchUserResult] = []
    @State private var isSearching = false
    @State private var requestSent: Set<Int> = []
    @State private var pendingRequestUserIds: Set<Int> = []
    @State private var handlingRequestIds: Set<String> = []
    @State private var navigateToContact: PeopleChatDestination?
    @State private var activeSheet: PeopleSheetDestination?
    @State private var actionError: String?
    @FocusState private var searchFocused: Bool

    var body: some View {
        ZStack {
            Color.smBg.ignoresSafeArea()

            VStack(spacing: 0) {
                headerRow
                if !session.pendingRequests.isEmpty && query.trimmingCharacters(in: .whitespaces).isEmpty {
                    requestsSection
                }
                searchBar
                Divider().background(Color.smBorderSoft)

                if query.trimmingCharacters(in: .whitespaces).isEmpty {
                    promptView
                } else if isSearching && results.isEmpty {
                    ProgressView()
                        .tint(Color.smAccent)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if !results.isEmpty {
                    resultsList
                } else {
                    emptyResults
                }
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .scrollDismissesKeyboard(.interactively)
        .task { await session.refreshDialogRequests() }
        .task(id: query) {
            await performSearch(query)
        }
        .navigationDestination(item: $navigateToContact) { destination in
            ChatView(contact: destination.contact)
        }
        .sheet(item: $activeSheet) { sheet in
            switch sheet {
            case .groupCreate:
                GroupCreateView { contact in
                    navigateToContact = PeopleChatDestination(contact: contact)
                }
            }
        }
        .alert("Не удалось выполнить действие", isPresented: Binding(
            get: { actionError != nil },
            set: { isPresented in
                if !isPresented { actionError = nil }
            }
        )) {
            Button("OK", role: .cancel) { actionError = nil }
        } message: {
            Text(actionError ?? "")
        }
    }

    // MARK: - Header (matches "Новый чат" prototype: Cancel · Title · Create in amber)

    private var headerRow: some View {
        HStack {
            Text("Контакты")
                .font(.title3.weight(.bold))
                .foregroundStyle(Color.smText)
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 6)
    }

    // MARK: - Search bar (rounded, matches prototype)

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.smMuted)

            TextField("Поиск по имени или @username", text: $query)
                .focused($searchFocused)
                .font(.body)
                .foregroundStyle(Color.smText)
                .tint(Color.smAccent)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)

            if !query.isEmpty {
                Button(action: {
                    query = ""
                }) {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.smFaint)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.smBorder, lineWidth: 0.5))
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }

    // MARK: - Prompt (action cards + contacts list matching prototype)

    private var promptView: some View {
        let previewContacts = session.contacts.prefix(20)

        return ScrollView(showsIndicators: false) {
            VStack(spacing: 10) {
                // Big action cards
                Button(action: { activeSheet = .groupCreate }) {
                    actionCard(
                        icon: "person.3.fill",
                        title: "Новая группа",
                        subtitle: "до 200 участников"
                    )
                }
                .buttonStyle(.plain)

                Button(action: { searchFocused = true }) {
                    actionCard(
                        icon: "at",
                        title: "Найти по @username",
                        subtitle: "введите имя пользователя"
                    )
                }
                .buttonStyle(.plain)

                // Contacts section header
                if !session.contacts.isEmpty {
                    HStack {
                        Text("КОНТАКТЫ · \(session.contacts.count)")
                            .font(.caption2.weight(.semibold))
                            .foregroundStyle(Color.smFaint)
                            .tracking(0.7)
                        Spacer()
                    }
                    .padding(.horizontal, 4)
                    .padding(.top, 14)

                    // Contact rows
                    VStack(spacing: 0) {
                        ForEach(previewContacts) { contact in
                            Button(action: { navigateToContact = PeopleChatDestination(contact: contact) }) {
                                contactRow(contact)
                            }
                            .buttonStyle(.plain)
                            if contact.id != previewContacts.last?.id {
                                Divider().padding(.leading, 64).background(Color.smBorderSoft)
                            }
                        }
                    }
                    .background(Color.smSurface)
                    .clipShape(RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
                    .shadow(color: Color(hex: "#281e0f").opacity(0.05), radius: 4, x: 0, y: 2)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 4)
            .padding(.bottom, 20)
        }
    }

    private func actionCard(icon: String, title: String, subtitle: String?) -> some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.smAccent.opacity(0.12))
                    .frame(width: 38, height: 38)
                Image(systemName: icon)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundStyle(Color.smAccent2)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.smText)
                if let subtitle {
                    Text(subtitle)
                        .font(.caption)
                        .foregroundStyle(Color.smMuted)
                }
            }
            Spacer()
            Image(systemName: "chevron.right")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color.smFaint)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
        .shadow(color: Color(hex: "#281e0f").opacity(0.04), radius: 3, x: 0, y: 1)
    }

    private func contactRow(_ contact: Contact) -> some View {
        HStack(spacing: 12) {
            SmAvatarView(name: contact.displayName, avatarUrl: contact.avatarUrl, isGroup: contact.isGroup, size: 40)
            VStack(alignment: .leading, spacing: 2) {
                Text(contact.displayName)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Color.smText)
                    .lineLimit(1)
                if !contact.username.isEmpty {
                    Text("@\(contact.username)")
                        .font(.caption)
                        .foregroundStyle(Color.smAccent)
                        .lineLimit(1)
                }
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(Color.smSurface)
        .contentShape(Rectangle())
    }

    private var emptyResults: some View {
        VStack(spacing: 12) {
            Spacer()
            Image(systemName: "person.slash")
                .font(.system(size: 40))
                .foregroundStyle(Color.smFaint)
            Text("Пользователей не найдено")
                .font(.headline)
                .foregroundStyle(Color.smMuted)
            Text("Попробуйте другое имя или @username")
                .font(.subheadline)
                .foregroundStyle(Color.smFaint)
            Spacer()
        }
    }

    // MARK: - Results list

    private var resultsList: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                ForEach(results) { user in
                    UserResultRow(
                        user: user,
                        requestSent: requestSent.contains(user.userId),
                        requestInFlight: pendingRequestUserIds.contains(user.userId),
                        onTap: { handleTap(user) },
                        onAction: { handleAction(user) }
                    )
                    if user.id != results.last?.id {
                        Divider()
                            .padding(.leading, 72)
                            .background(Color.smBorderSoft)
                    }
                }
            }
            .background(Color.smSurface)
            .clipShape(RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.smBorder, lineWidth: 0.5))
            .shadow(color: Color(hex: "#281e0f").opacity(0.06), radius: 8, x: 0, y: 2)
            .padding(.horizontal, 16)
            .padding(.top, 12)
            .padding(.bottom, 20)
        }
    }

    // MARK: - Requests section

    private var requestsSection: some View {
        let pendingRequests = session.pendingRequests

        return VStack(alignment: .leading, spacing: 8) {
            Text("ЗАПРОСЫ")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Color.smFaint)
                .tracking(0.6)
                .padding(.horizontal, 20)
                .padding(.top, 4)

            VStack(spacing: 0) {
                ForEach(pendingRequests) { req in
                    DialogRequestRow(
                        request: req,
                        isActing: handlingRequestIds.contains(req.id),
                        onAccept: { acceptRequest(req) },
                        onDecline: { declineRequest(req) }
                    )
                    if req.id != pendingRequests.last?.id {
                        Divider().padding(.leading, 72).background(Color.smBorderSoft)
                    }
                }
            }
            .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 16))
            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.smBorder, lineWidth: 0.5))
            .shadow(color: Color(hex: "#281e0f").opacity(0.05), radius: 6, x: 0, y: 2)
            .padding(.horizontal, 16)
            .padding(.bottom, 4)
        }
    }

    private func acceptRequest(_ req: DialogRequest) {
        guard !handlingRequestIds.contains(req.id) else { return }
        handlingRequestIds.insert(req.id)
        Task {
            defer { handlingRequestIds.remove(req.id) }
            do {
                let acceptedChatId = try await APIClient.shared.acceptDialogRequest(req)
                await session.refreshDialogRequests()
                await session.refreshContacts()
                if req.isGroupInvite,
                   let contact = session.contacts.first(where: { $0.chatId == acceptedChatId }) {
                    navigateToContact = PeopleChatDestination(contact: contact)
                }
            } catch APIError.unauthorized {
                session.route = .login
            } catch {
                actionError = error.localizedDescription
                await session.refreshDialogRequests()
            }
        }
    }

    private func declineRequest(_ req: DialogRequest) {
        guard !handlingRequestIds.contains(req.id) else { return }
        handlingRequestIds.insert(req.id)
        Task {
            defer { handlingRequestIds.remove(req.id) }
            do {
                try await APIClient.shared.declineDialogRequest(req)
                await session.refreshDialogRequests()
            } catch APIError.unauthorized {
                session.route = .login
            } catch {
                actionError = error.localizedDescription
                await session.refreshDialogRequests()
            }
        }
    }

    // MARK: - Actions

    @MainActor
    private func performSearch(_ q: String) async {
        let trimmed = q.trimmingCharacters(in: .whitespacesAndNewlines)

        guard trimmed.count >= 3 else {
            results = []
            isSearching = false
            return
        }

        actionError = nil
        isSearching = true
        do {
            try await Task.sleep(nanoseconds: 320_000_000)
            try Task.checkCancellation()
            let found = try await APIClient.shared.searchUsers(query: trimmed)
            try Task.checkCancellation()
            guard query.trimmingCharacters(in: .whitespacesAndNewlines) == trimmed else { return }
            results = found
            isSearching = false
        } catch is CancellationError {
            if query.trimmingCharacters(in: .whitespacesAndNewlines) == trimmed {
                isSearching = false
            }
        } catch APIError.unauthorized {
            if query.trimmingCharacters(in: .whitespacesAndNewlines) == trimmed {
                isSearching = false
                session.route = .login
            }
        } catch {
            if query.trimmingCharacters(in: .whitespacesAndNewlines) == trimmed {
                isSearching = false
                actionError = error.localizedDescription
            }
        }
    }

    private func handleTap(_ user: SearchUserResult) {
        if let chatId = user.chatId {
            let contact = Contact(
                userId: user.userId,
                chatId: chatId,
                displayName: user.displayName,
                username: user.username,
                publicKey: user.publicKey ?? "",
                lastMessage: nil,
                lastMessageTime: nil,
                initialLastMessagePreview: nil,
                unreadCount: 0,
                avatarUrl: user.avatarUrl,
                isOnline: false,
                isPinned: false,
                isGroup: false
            )
            navigateToContact = PeopleChatDestination(contact: contact)
        } else {
            handleAction(user)
        }
    }

    private func handleAction(_ user: SearchUserResult) {
        guard user.chatId == nil,
              !requestSent.contains(user.userId),
              !pendingRequestUserIds.contains(user.userId) else { return }
        let username = user.username.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !username.isEmpty else {
            actionError = "У этого пользователя нет username для начала чата."
            return
        }
        pendingRequestUserIds.insert(user.userId)
        Task {
            defer { pendingRequestUserIds.remove(user.userId) }
            do {
                if user.pendingIncomingRequest {
                    let senderPublicKey = (user.publicKey ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                    guard !senderPublicKey.isEmpty else {
                        throw NSError(
                            domain: "SUNmessenger.PeopleView",
                            code: 0,
                            userInfo: [NSLocalizedDescriptionKey: "Не удалось принять запрос: ключ отправителя не найден."]
                        )
                    }
                    let acceptedChatId = try await APIClient.shared.acceptDialogRequest(senderPublicKey: senderPublicKey)
                    await session.refreshDialogRequests()
                    await session.refreshContacts()
                    await MainActor.run {
                        if let acceptedChatId,
                           let contact = session.contacts.first(where: { $0.chatId == acceptedChatId }) {
                            navigateToContact = PeopleChatDestination(contact: contact)
                        }
                    }
                    return
                }
                let resp = try await APIClient.shared.startChat(username: username)
                await MainActor.run {
                    if resp.status == "existing", let sc = resp.contact {
                        let chatId = resp.chatId ?? sc.chatId
                        let contact = Contact(
                            userId: sc.userId,
                            chatId: chatId,
                            displayName: sc.displayName,
                            username: sc.username,
                            publicKey: sc.publicKey,
                            lastMessage: nil,
                            lastMessageTime: nil,
                            initialLastMessagePreview: nil,
                            unreadCount: 0,
                            avatarUrl: user.avatarUrl,
                            isOnline: false,
                            isPinned: false,
                            isGroup: false
                        )
                        navigateToContact = PeopleChatDestination(contact: contact)
                    } else {
                        requestSent.insert(user.userId)
                    }
                }
            } catch APIError.unauthorized {
                await MainActor.run {
                    session.route = .login
                }
            } catch {
                await MainActor.run {
                    actionError = error.localizedDescription
                }
            }
        }
    }
}

private struct GroupMemberCandidate: Identifiable, Equatable {
    let userId: Int
    let displayName: String
    let username: String
    let avatarUrl: String?
    let canGroupAddDirect: Bool
    let groupInviteAction: String

    var id: Int { userId }

    var isDenied: Bool {
        groupInviteAction == "deny"
    }

    var actionLabel: String {
        if groupInviteAction == "deny" { return "Недоступно" }
        if groupInviteAction == "request" || !canGroupAddDirect { return "Запрос" }
        return "Добавить"
    }

    static func from(contact: Contact) -> GroupMemberCandidate? {
        guard let userId = contact.userId, !contact.isGroup else { return nil }
        return GroupMemberCandidate(
            userId: userId,
            displayName: contact.displayName,
            username: contact.username,
            avatarUrl: contact.avatarUrl,
            canGroupAddDirect: contact.canGroupAddDirect,
            groupInviteAction: contact.canGroupAddDirect ? "add" : "request"
        )
    }

    static func from(searchResult: SearchUserResult) -> GroupMemberCandidate {
        GroupMemberCandidate(
            userId: searchResult.userId,
            displayName: searchResult.displayName,
            username: searchResult.username,
            avatarUrl: searchResult.avatarUrl,
            canGroupAddDirect: searchResult.canGroupAddDirect,
            groupInviteAction: searchResult.groupInviteAction
        )
    }
}

struct GroupCreateView: View {
    @EnvironmentObject var session: SessionStore
    @Environment(\.dismiss) private var dismiss

    let onCreated: (Contact) -> Void

    @State private var title = ""
    @State private var query = ""
    @State private var remoteResults: [SearchUserResult] = []
    @State private var selected: [GroupMemberCandidate] = []
    @State private var localCandidatesSnapshot: [GroupMemberCandidate] = []
    @State private var visibleCandidates: [GroupMemberCandidate]?
    @State private var isSearching = false
    @State private var isCreating = false
    @State private var error: String?

    private func makeLocalCandidates() -> [GroupMemberCandidate] {
        let currentUserId = session.bootstrap?.user.id
        return session.contacts
            .compactMap(GroupMemberCandidate.from)
            .filter { $0.userId != currentUserId }
            .sorted { $0.userId < $1.userId }
    }

    private func makeVisibleCandidates(localCandidates: [GroupMemberCandidate]? = nil) -> [GroupMemberCandidate] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let selectedIds = Set(selected.map { $0.userId })
        let localCandidates = localCandidates ?? makeLocalCandidates()
        let local = filter(candidates: localCandidates, query: trimmed)
        let currentUserId = session.bootstrap?.user.id
        let remote = remoteResults
            .map(GroupMemberCandidate.from)
            .filter { $0.userId != currentUserId }

        var merged: [Int: GroupMemberCandidate] = [:]
        for candidate in local { merged[candidate.userId] = candidate }
        for candidate in remote where merged[candidate.userId] == nil {
            merged[candidate.userId] = candidate
        }

        return merged.values
            .filter { !selectedIds.contains($0.userId) }
            .sorted {
                $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending
            }
    }

    private var canCreate: Bool {
        let count = title.trimmingCharacters(in: .whitespacesAndNewlines).count
        return selected.count > 0 && count >= 2 && count <= 120 && !isCreating
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.smBg.ignoresSafeArea()

                VStack(spacing: 0) {
                    formHeader
                    selectedMembers
                    searchBar
                    candidateList
                    if let error {
                        Text(error)
                            .font(.caption)
                            .foregroundStyle(Color.smDanger)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                    }
                }
            }
            .safeAreaInset(edge: .bottom, spacing: 0) {
                createButton
                    .background(Color.smBg.ignoresSafeArea(edges: .bottom))
            }
            .scrollDismissesKeyboard(.interactively)
            .navigationTitle("Новая группа")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Отмена") { dismiss() }
                }
            }
            .onAppear { refreshVisibleCandidatesFromContacts(force: true) }
            .onReceive(session.$contacts) { _ in refreshVisibleCandidatesFromContacts() }
            .task(id: query) {
                await searchMembers(query)
            }
        }
    }

    private var formHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("НАЗВАНИЕ")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Color.smFaint)
                .tracking(0.6)
            TextField("Название группы", text: $title)
                .font(.body.weight(.medium))
                .foregroundStyle(Color.smText)
                .tint(Color.smAccent)
                .padding(.horizontal, 12)
                .padding(.vertical, 11)
                .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.smBorder, lineWidth: 0.5))
                .onChange(of: title) { _, value in
                    if value.count > 120 {
                        title = String(value.prefix(120))
                    }
                }
        }
        .padding(.horizontal, 16)
        .padding(.top, 16)
        .padding(.bottom, 10)
    }

    private var selectedMembers: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("УЧАСТНИКИ · \(selected.count)")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Color.smFaint)
                    .tracking(0.6)
                Spacer()
            }

            if selected.isEmpty {
                Text("Выберите хотя бы одного участника.")
                    .font(.subheadline)
                    .foregroundStyle(Color.smMuted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(12)
                    .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 12))
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(selected) { member in
                            selectedChip(member)
                        }
                    }
                    .padding(.vertical, 2)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
    }

    private func selectedChip(_ member: GroupMemberCandidate) -> some View {
        Button {
            selected.removeAll { $0.userId == member.userId }
            rebuildVisibleCandidates()
        } label: {
            HStack(spacing: 7) {
                SmAvatarView(name: member.displayName, avatarUrl: member.avatarUrl, size: 24)
                Text(member.displayName)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Color.smText)
                    .lineLimit(1)
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Color.smFaint)
            }
            .padding(.leading, 4)
            .padding(.trailing, 9)
            .padding(.vertical, 4)
            .background(Color.smSurface, in: Capsule())
            .overlay(Capsule().stroke(Color.smBorder, lineWidth: 0.5))
        }
        .buttonStyle(.plain)
    }

    private var searchBar: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(Color.smMuted)
            TextField("Найти по имени или @username", text: $query)
                .font(.body)
                .foregroundStyle(Color.smText)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .tint(Color.smAccent)
            if isSearching {
                ProgressView()
                    .tint(Color.smAccent)
            } else if !query.isEmpty {
                Button {
                    query = ""
                    remoteResults = []
                    rebuildVisibleCandidates()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15))
                        .foregroundStyle(Color.smFaint)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(Color.smBorder, lineWidth: 0.5))
        .padding(.horizontal, 16)
        .padding(.bottom, 10)
    }

    private var candidateList: some View {
        let candidates = visibleCandidates ?? makeVisibleCandidates()
        return Group {
            if candidates.isEmpty {
                VStack(spacing: 10) {
                    Spacer()
                    Image(systemName: "person.2.slash")
                        .font(.system(size: 34))
                        .foregroundStyle(Color.smFaint)
                    Text(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Нет доступных контактов" : "Пользователи не найдены")
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.smMuted)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else {
                ScrollView(showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        ForEach(candidates) { candidate in
                            candidateRow(candidate)
                            if candidate.id != candidates.last?.id {
                                Divider().padding(.leading, 68).background(Color.smBorderSoft)
                            }
                        }
                    }
                    .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
                    .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
                    .padding(.horizontal, 16)
                    .padding(.bottom, 12)
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func candidateRow(_ candidate: GroupMemberCandidate) -> some View {
        Button {
            guard !candidate.isDenied else { return }
            selected.append(candidate)
            rebuildVisibleCandidates()
            error = nil
        } label: {
            HStack(spacing: 12) {
                SmAvatarView(name: candidate.displayName, avatarUrl: candidate.avatarUrl, size: 42)
                VStack(alignment: .leading, spacing: 2) {
                    Text(candidate.displayName)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(Color.smText)
                        .lineLimit(1)
                    Text(candidate.username.isEmpty ? "пользователь" : "@\(candidate.username)")
                        .font(.caption)
                        .foregroundStyle(Color.smMuted)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .layoutPriority(1)
                Spacer()
                Text(candidate.actionLabel)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(candidate.isDenied ? Color.smFaint : Color.smAccent2)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .fixedSize(horizontal: true, vertical: false)
                    .background((candidate.isDenied ? Color.smBorder : Color.smAccent).opacity(0.12), in: Capsule())
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(candidate.isDenied)
    }

    private var createButton: some View {
        Button {
            Task { await createGroup() }
        } label: {
            HStack {
                Spacer()
                if isCreating {
                    ProgressView().tint(.white)
                } else {
                    Text("Создать")
                        .font(.subheadline.weight(.semibold))
                }
                Spacer()
            }
            .foregroundStyle(.white)
            .padding(.vertical, 13)
            .background(canCreate ? Color.smAccent2 : Color.smFaint, in: RoundedRectangle(cornerRadius: 12))
        }
        .buttonStyle(.plain)
        .disabled(!canCreate)
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private func filter(candidates: [GroupMemberCandidate], query: String) -> [GroupMemberCandidate] {
        guard !query.isEmpty else { return Array(candidates.prefix(80)) }
        return candidates.filter {
            $0.displayName.localizedCaseInsensitiveContains(query) ||
            $0.username.localizedCaseInsensitiveContains(query)
        }
    }

    @MainActor
    private func searchMembers(_ raw: String) async {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        error = nil
        guard trimmed.count >= 3 else {
            remoteResults = []
            isSearching = false
            rebuildVisibleCandidates()
            return
        }
        remoteResults = []
        isSearching = true
        rebuildVisibleCandidates()
        do {
            try await Task.sleep(nanoseconds: 320_000_000)
            try Task.checkCancellation()
            let found = try await session.api.searchUsers(query: trimmed, limit: 40)
            try Task.checkCancellation()
            guard query.trimmingCharacters(in: .whitespacesAndNewlines) == trimmed else { return }
            remoteResults = found
            isSearching = false
            rebuildVisibleCandidates()
        } catch is CancellationError {
            return
        } catch APIError.unauthorized {
            guard query.trimmingCharacters(in: .whitespacesAndNewlines) == trimmed else {
                return
            }
            isSearching = false
            session.route = .login
        } catch {
            guard !Task.isCancelled else {
                return
            }
            guard query.trimmingCharacters(in: .whitespacesAndNewlines) == trimmed else {
                return
            }
            isSearching = false
            self.error = error.localizedDescription
            rebuildVisibleCandidates()
        }
    }

    private func refreshVisibleCandidatesFromContacts(force: Bool = false) {
        let localCandidates = makeLocalCandidates()
        guard force || localCandidates != localCandidatesSnapshot else { return }
        localCandidatesSnapshot = localCandidates
        rebuildVisibleCandidates(localCandidates: localCandidates)
    }

    private func rebuildVisibleCandidates(localCandidates: [GroupMemberCandidate]? = nil) {
        let next = makeVisibleCandidates(localCandidates: localCandidates)
        if visibleCandidates != next {
            visibleCandidates = next
        }
    }

    private func createGroup() async {
        let normalizedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard selected.count > 0 else {
            error = "Добавьте хотя бы одного участника."
            return
        }
        guard normalizedTitle.count >= 2, normalizedTitle.count <= 120 else {
            error = "Название группы должно быть от 2 до 120 символов."
            return
        }

        isCreating = true
        error = nil
        defer { isCreating = false }

        do {
            let response = try await session.api.createGroupChat(
                title: normalizedTitle,
                memberUserIds: selected.map { $0.userId }
            )
            await session.refreshContacts()
            let created = session.contacts.first(where: { $0.chatId == response.chatId }) ?? Contact(
                userId: nil,
                chatId: response.chatId,
                displayName: response.chatName.isEmpty ? normalizedTitle : response.chatName,
                username: "",
                publicKey: "",
                lastMessage: nil,
                lastMessageTime: nil,
                initialLastMessagePreview: nil,
                unreadCount: 0,
                avatarUrl: response.chatAvatarUrl.isEmpty ? nil : response.chatAvatarUrl,
                isOnline: false,
                isPinned: false,
                isGroup: true
            )
            onCreated(created)
            dismiss()
        } catch APIError.unauthorized {
            session.route = .login
        } catch {
            self.error = error.localizedDescription
        }
    }
}

// MARK: - Dialog request row

struct DialogRequestRow: View {
    let request: DialogRequest
    let isActing: Bool
    let onAccept: () -> Void
    let onDecline: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            SmAvatarView(
                name: request.isGroupInvite ? requestTitle : request.senderDisplayName,
                avatarUrl: request.isGroupInvite ? request.chatAvatarUrl : request.senderAvatar,
                isGroup: request.isGroupInvite,
                size: 44
            )

            VStack(alignment: .leading, spacing: 3) {
                Text(requestTitle)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color.smText)
                    .lineLimit(1)
                Text(requestSubtitle)
                    .font(.caption)
                    .foregroundStyle(Color.smAccent)
                    .lineLimit(1)
            }
            .layoutPriority(1)

            Spacer()

            HStack(spacing: 8) {
                Button(action: { onDecline() }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.smMuted)
                        .frame(width: 32, height: 32)
                        .background(Color.smBorder.opacity(0.5), in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(isActing)

                Button(action: { onAccept() }) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color(hex: "#fbf8f1"))
                        .frame(width: 32, height: 32)
                        .background(Color.smAccent, in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(isActing)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(Color.smSurface)
        .contentShape(Rectangle())
    }

    private var requestTitle: String {
        if request.isGroupInvite {
            if let chatName = request.chatName, !chatName.isEmpty {
                return chatName
            }
            return "Группа"
        }
        return request.senderDisplayName
    }

    private var requestSubtitle: String {
        let username = request.senderUsername.trimmingCharacters(in: .whitespacesAndNewlines)
        let senderLabel = username.isEmpty ? "пользователя" : "@\(username)"
        if request.isGroupInvite {
            return "приглашение от \(senderLabel)"
        }
        return username.isEmpty ? "пользователь" : "@\(username)"
    }
}

// MARK: - User result row

struct UserResultRow: View {
    let user: SearchUserResult
    let requestSent: Bool
    let requestInFlight: Bool
    let onTap: () -> Void
    let onAction: () -> Void

    private var requestUnavailable: Bool {
        requestInFlight || requestSent || user.pendingOutgoingRequest
    }

    private var statusLabel: String {
        if user.chatId != nil { return "Написать" }
        if requestInFlight { return "Отправка…" }
        if requestSent || user.pendingOutgoingRequest { return "Отправлено" }
        if user.pendingIncomingRequest { return "Принять" }
        if user.isContact { return "Написать" }
        return "Написать"
    }

    private var statusColor: Color {
        if requestUnavailable { return Color.smFaint }
        return Color.smAccent
    }

    var body: some View {
        Button(action: {
            if user.chatId != nil || user.isContact {
                onTap()
            } else if !requestUnavailable {
                onAction()
            }
        }) {
            HStack(spacing: 12) {
                SmAvatarView(name: user.displayName, avatarUrl: user.avatarUrl, size: 44)

                VStack(alignment: .leading, spacing: 3) {
                    Text(user.displayName)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.smText)
                        .lineLimit(1)
                    Text(user.username.isEmpty ? "пользователь" : "@\(user.username)")
                        .font(.caption)
                        .foregroundStyle(Color.smAccent)
                        .lineLimit(1)
                }
                .layoutPriority(1)

                Spacer()

                if user.chatId != nil || user.isContact {
                    Image(systemName: "message.fill")
                        .font(.system(size: 17))
                        .foregroundStyle(Color.smAccent)
                } else {
                    Text(statusLabel)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(requestUnavailable ? Color.smFaint : Color(hex: "#fbf8f1"))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .fixedSize(horizontal: true, vertical: false)
                        .background(
                            requestUnavailable
                                ? Color.smBorder.opacity(0.5)
                                : Color.smAccent,
                            in: Capsule()
                        )
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(Color.smSurface)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
