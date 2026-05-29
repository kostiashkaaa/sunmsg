import SwiftUI

// MARK: - People (user search) tab

struct PeopleView: View {
    @EnvironmentObject var session: SessionStore
    @State private var query = ""
    @State private var results: [SearchUserResult] = []
    @State private var isSearching = false
    @State private var requestSent: Set<Int> = []
    @State private var navigateToContact: Contact? = nil
    @State private var showGroupAlert = false
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
        .alert("Группы", isPresented: $showGroupAlert) {
            Button("Понятно", role: .cancel) { }
        } message: {
            Text("Создание групп будет доступно в следующем обновлении.")
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
                Button(action: { query = ""; results = [] }) {
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
                Button(action: { showGroupAlert = true }) {
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
            _ = try? await APIClient.shared.acceptDialogRequest(senderPublicKey: req.senderPublicKey)
            await session.refreshDialogRequests()
            await session.refreshContacts()
        }
    }

    private func declineRequest(_ req: DialogRequest) {
        Task {
            try? await APIClient.shared.declineDialogRequest(senderPublicKey: req.senderPublicKey)
            await session.refreshDialogRequests()
        }
    }

    // MARK: - Actions

    private func performSearch(_ q: String) {
        let trimmed = q.trimmingCharacters(in: .whitespaces)
        guard trimmed.count >= 3 else {
            results = []
            isSearching = false
            return
        }
        isSearching = true
        Task {
            do {
                let found = try await APIClient.shared.searchUsers(query: trimmed)
                await MainActor.run {
                    results = found
                    isSearching = false
                }
            } catch {
                await MainActor.run { isSearching = false }
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

// MARK: - Dialog request row

struct DialogRequestRow: View {
    let request: DialogRequest
    let onAccept: () -> Void
    let onDecline: () -> Void
    @State private var isActing = false

    var body: some View {
        HStack(spacing: 12) {
            SmAvatarView(name: request.senderDisplayName, size: 44)

            VStack(alignment: .leading, spacing: 3) {
                Text(request.senderDisplayName)
                    .font(.system(size: 15.5, weight: .medium))
                    .foregroundStyle(Color.smText)
                    .lineLimit(1)
                Text("@\(request.senderUsername)")
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
