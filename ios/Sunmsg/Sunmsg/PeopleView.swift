import SwiftUI

// MARK: - People (user search) tab

struct PeopleView: View {
    @EnvironmentObject var session: SessionStore
    @State private var query = ""
    @State private var results: [SearchUserResult] = []
    @State private var isSearching = false
    @State private var searchTask: Task<Void, Never>?
    @State private var searchSequence = 0
    @State private var requestSent: Set<Int> = []
    @State private var navigateToContact: Contact? = nil
    @State private var showGroupCreate = false
    @State private var showUsernameAlert = false
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
        .navigationBarHidden(true)
        .task { await session.refreshDialogRequests() }
        .navigationDestination(isPresented: Binding(
            get: { navigateToContact != nil },
            set: { if !$0 { navigateToContact = nil } }
        )) {
            if let contact = navigateToContact {
                ChatView(contact: contact)
            }
        }
        .sheet(isPresented: $showGroupCreate) {
            GroupCreateView { contact in
                navigateToContact = contact
            }
        }
        .onDisappear {
            cancelSearch(clearResults: false)
        }
    }

    // MARK: - Header (matches "Новый чат" prototype: Cancel · Title · Create in amber)

    private var headerRow: some View {
        HStack {
            Text("Контакты")
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(Color.smText)
                .tracking(-0.6)
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
                .font(.system(size: 15))
                .foregroundStyle(Color.smText)
                .tint(Color.smAccent)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .onChange(of: query) { _, q in performSearch(q) }

            if !query.isEmpty {
                Button(action: {
                    query = ""
                    cancelSearch(clearResults: true)
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
        ScrollView(showsIndicators: false) {
            VStack(spacing: 10) {
                // Big action cards
                Button(action: { showGroupCreate = true }) {
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
                            .font(.system(size: 10.5, weight: .semibold))
                            .foregroundStyle(Color.smFaint)
                            .tracking(0.7)
                        Spacer()
                    }
                    .padding(.horizontal, 4)
                    .padding(.top, 14)

                    // Contact rows
                    VStack(spacing: 0) {
                        ForEach(Array(session.contacts.prefix(20).enumerated()), id: \.element.id) { idx, contact in
                            Button(action: { navigateToContact = contact }) {
                                contactRow(contact)
                            }
                            .buttonStyle(.plain)
                            if idx < min(session.contacts.count, 20) - 1 {
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
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color.smText)
                if let subtitle {
                    Text(subtitle)
                        .font(.system(size: 11.5))
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
                    .font(.system(size: 14.5, weight: .semibold))
                    .foregroundStyle(Color.smText)
                    .lineLimit(1)
                if !contact.username.isEmpty {
                    Text("@\(contact.username)")
                        .font(.system(size: 12))
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
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(Color.smMuted)
            Text("Попробуйте другое имя или @username")
                .font(.system(size: 13))
                .foregroundStyle(Color.smFaint)
            Spacer()
        }
    }

    // MARK: - Results list

    private var resultsList: some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 0) {
                ForEach(Array(results.enumerated()), id: \.element.id) { idx, user in
                    UserResultRow(
                        user: user,
                        requestSent: requestSent.contains(user.userId),
                        onTap: { handleTap(user) },
                        onAction: { handleAction(user) }
                    )
                    if idx < results.count - 1 {
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
        VStack(alignment: .leading, spacing: 8) {
            Text("ЗАПРОСЫ")
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(Color.smFaint)
                .tracking(0.6)
                .padding(.horizontal, 20)
                .padding(.top, 4)

            VStack(spacing: 0) {
                ForEach(Array(session.pendingRequests.enumerated()), id: \.element.id) { idx, req in
                    DialogRequestRow(
                        request: req,
                        onAccept: { acceptRequest(req) },
                        onDecline: { declineRequest(req) }
                    )
                    if idx < session.pendingRequests.count - 1 {
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
        Task {
            let acceptedChatId = try? await APIClient.shared.acceptDialogRequest(req)
            await session.refreshDialogRequests()
            await session.refreshContacts()
            if req.isGroupInvite, let acceptedChatId,
               let contact = session.contacts.first(where: { $0.chatId == acceptedChatId }) {
                navigateToContact = contact
            }
        }
    }

    private func declineRequest(_ req: DialogRequest) {
        Task {
            try? await APIClient.shared.declineDialogRequest(req)
            await session.refreshDialogRequests()
        }
    }

    // MARK: - Actions

    private func performSearch(_ q: String) {
        let trimmed = q.trimmingCharacters(in: .whitespacesAndNewlines)
        searchTask?.cancel()
        searchSequence += 1
        let sequence = searchSequence

        guard trimmed.count >= 3 else {
            results = []
            isSearching = false
            return
        }

        isSearching = true
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 320_000_000)
            guard !Task.isCancelled else { return }
            do {
                let found = try await APIClient.shared.searchUsers(query: trimmed)
                await MainActor.run {
                    guard sequence == searchSequence,
                          query.trimmingCharacters(in: .whitespacesAndNewlines) == trimmed
                    else { return }
                    results = found
                    isSearching = false
                    searchTask = nil
                }
            } catch {
                await MainActor.run {
                    guard sequence == searchSequence else { return }
                    isSearching = false
                    searchTask = nil
                }
            }
        }
    }

    private func cancelSearch(clearResults: Bool) {
        searchTask?.cancel()
        searchTask = nil
        searchSequence += 1
        if clearResults {
            results = []
        }
        isSearching = false
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
            navigateToContact = contact
        } else {
            handleAction(user)
        }
    }

    private func handleAction(_ user: SearchUserResult) {
        guard user.chatId == nil, !requestSent.contains(user.userId) else { return }
        Task {
            do {
                let resp = try await APIClient.shared.startChat(username: user.username)
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
                        navigateToContact = contact
                    } else {
                        requestSent.insert(user.userId)
                    }
                }
            } catch { }
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
    @State private var searchSeq = 0
    @State private var searchTask: Task<Void, Never>?
    @State private var isSearching = false
    @State private var isCreating = false
    @State private var error: String?

    private var selectedIds: Set<Int> {
        Set(selected.map { $0.userId })
    }

    private var localCandidates: [GroupMemberCandidate] {
        let currentUserId = session.bootstrap?.user.id
        return session.contacts
            .compactMap(GroupMemberCandidate.from)
            .filter { $0.userId != currentUserId }
    }

    private var visibleCandidates: [GroupMemberCandidate] {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        let local = filter(candidates: localCandidates, query: trimmed)
        let remote = remoteResults
            .map(GroupMemberCandidate.from)
            .filter { $0.userId != session.bootstrap?.user.id }

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
                            .font(.system(size: 12.5))
                            .foregroundStyle(Color.smDanger)
                            .multilineTextAlignment(.center)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                    }
                    createButton
                }
            }
            .navigationTitle("Новая группа")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Отмена") { dismiss() }
                }
            }
            .onDisappear {
                searchTask?.cancel()
                searchTask = nil
            }
        }
    }

    private var formHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("НАЗВАНИЕ")
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(Color.smFaint)
                .tracking(0.6)
            TextField("Название группы", text: $title)
                .font(.system(size: 16, weight: .medium))
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
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundStyle(Color.smFaint)
                    .tracking(0.6)
                Spacer()
            }

            if selected.isEmpty {
                Text("Выберите хотя бы одного участника.")
                    .font(.system(size: 13))
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
        } label: {
            HStack(spacing: 7) {
                SmAvatarView(name: member.displayName, avatarUrl: member.avatarUrl, size: 24)
                Text(member.displayName)
                    .font(.system(size: 12.5, weight: .semibold))
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
                .font(.system(size: 15))
                .foregroundStyle(Color.smText)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .tint(Color.smAccent)
                .onChange(of: query) { _, value in searchMembers(value) }
            if isSearching {
                ProgressView()
                    .tint(Color.smAccent)
            } else if !query.isEmpty {
                Button {
                    query = ""
                    remoteResults = []
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
        let candidates = visibleCandidates
        Group {
            if candidates.isEmpty {
                VStack(spacing: 10) {
                    Spacer()
                    Image(systemName: "person.2.slash")
                        .font(.system(size: 34))
                        .foregroundStyle(Color.smFaint)
                    Text(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "Нет доступных контактов" : "Пользователи не найдены")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(Color.smMuted)
                    Spacer()
                }
                .frame(maxWidth: .infinity)
            } else {
                ScrollView(showsIndicators: false) {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(candidates.enumerated()), id: \.element.id) { index, candidate in
                            candidateRow(candidate)
                            if index < candidates.count - 1 {
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
            error = nil
        } label: {
            HStack(spacing: 12) {
                SmAvatarView(name: candidate.displayName, avatarUrl: candidate.avatarUrl, size: 42)
                VStack(alignment: .leading, spacing: 2) {
                    Text(candidate.displayName)
                        .font(.system(size: 14.5, weight: .semibold))
                        .foregroundStyle(Color.smText)
                        .lineLimit(1)
                    Text(candidate.username.isEmpty ? "@user" : "@\(candidate.username)")
                        .font(.system(size: 12))
                        .foregroundStyle(Color.smMuted)
                }
                Spacer()
                Text(candidate.actionLabel)
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(candidate.isDenied ? Color.smFaint : Color.smAccent2)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
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
                        .font(.system(size: 15, weight: .semibold))
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

    private func searchMembers(_ raw: String) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        searchTask?.cancel()
        error = nil
        guard trimmed.count >= 3 else {
            remoteResults = []
            isSearching = false
            searchTask = nil
            return
        }
        isSearching = true
        searchSeq += 1
        let seq = searchSeq
        searchTask = Task {
            try? await Task.sleep(nanoseconds: 320_000_000)
            guard !Task.isCancelled else { return }
            do {
                let found = try await session.api.searchUsers(query: trimmed, limit: 40)
                await MainActor.run {
                    guard seq == searchSeq,
                          query.trimmingCharacters(in: .whitespacesAndNewlines) == trimmed
                    else { return }
                    remoteResults = found
                    isSearching = false
                    searchTask = nil
                }
            } catch {
                await MainActor.run {
                    guard seq == searchSeq else { return }
                    isSearching = false
                    searchTask = nil
                }
            }
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
    let onAccept: () -> Void
    let onDecline: () -> Void
    @State private var isActing = false

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
                    .font(.system(size: 15.5, weight: .medium))
                    .foregroundStyle(Color.smText)
                    .lineLimit(1)
                Text(requestSubtitle)
                    .font(.system(size: 13))
                    .foregroundStyle(Color.smAccent)
                    .lineLimit(1)
            }

            Spacer()

            HStack(spacing: 8) {
                Button(action: { isActing = true; onDecline() }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(Color.smMuted)
                        .frame(width: 32, height: 32)
                        .background(Color.smBorder.opacity(0.5), in: Circle())
                }
                .buttonStyle(.plain)
                .disabled(isActing)

                Button(action: { isActing = true; onAccept() }) {
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
        let username = request.senderUsername.isEmpty ? "user" : request.senderUsername
        if request.isGroupInvite {
            return "приглашение от @\(username)"
        }
        return "@\(username)"
    }
}

// MARK: - User result row

struct UserResultRow: View {
    let user: SearchUserResult
    let requestSent: Bool
    let onTap: () -> Void
    let onAction: () -> Void

    private var statusLabel: String {
        if user.chatId != nil { return "Написать" }
        if requestSent || user.pendingOutgoingRequest { return "Отправлено" }
        if user.pendingIncomingRequest { return "Принять" }
        if user.isContact { return "Написать" }
        return "Написать"
    }

    private var statusColor: Color {
        if requestSent || user.pendingOutgoingRequest { return Color.smFaint }
        return Color.smAccent
    }

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 12) {
                SmAvatarView(name: user.displayName, avatarUrl: user.avatarUrl, size: 44)

                VStack(alignment: .leading, spacing: 3) {
                    Text(user.displayName)
                        .font(.system(size: 15.5, weight: .medium))
                        .foregroundStyle(Color.smText)
                        .lineLimit(1)
                    Text("@\(user.username)")
                        .font(.system(size: 13))
                        .foregroundStyle(Color.smAccent)
                        .lineLimit(1)
                }

                Spacer()

                if user.chatId != nil || user.isContact {
                    Image(systemName: "message.fill")
                        .font(.system(size: 17))
                        .foregroundStyle(Color.smAccent)
                } else {
                    Button(action: onAction) {
                        Text(statusLabel)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(requestSent || user.pendingOutgoingRequest ? Color.smFaint : Color(hex: "#fbf8f1"))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 6)
                            .background(
                                requestSent || user.pendingOutgoingRequest
                                    ? Color.smBorder.opacity(0.5)
                                    : Color.smAccent,
                                in: Capsule()
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(requestSent || user.pendingOutgoingRequest)
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
