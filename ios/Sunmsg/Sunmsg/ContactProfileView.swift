import SwiftUI

struct ContactProfileView: View {
    let contact: Contact
    private let keyFingerprint: String
    @EnvironmentObject var session: SessionStore
    @Environment(\.dismiss) private var dismiss
    @State private var showBlockAlert = false
    @State private var isBlocking = false
    @State private var blockError: String?
    @State private var isLoadingSharedContent = false
    @State private var sharedContentLoadingChatId: String?
    @State private var sharedContentError: String?
    @State private var sharedContentSnapshot = ProfileSharedContentSnapshot.empty
    @State private var selectedSharedContentKind: ProfileSharedContentKind = .media

    private struct ProfileSharedContentSnapshot {
        let items: [ProfileSharedContentItem]
        let itemsByKind: [ProfileSharedContentKind: [ProfileSharedContentItem]]
        let kinds: [ProfileSharedContentKind]
        let hasMore: Bool

        static let empty = ProfileSharedContentSnapshot(
            items: [],
            itemsByKind: [:],
            kinds: [],
            hasMore: false
        )
    }

    init(contact: Contact) {
        self.contact = contact
        self.keyFingerprint = Self.makeKeyFingerprint(contact.publicKey)
    }

    private static func makeKeyFingerprint(_ publicKey: String) -> String {
        guard !publicKey.isEmpty else { return "—" }
        let hash = publicKey
            .components(separatedBy: .newlines)
            .filter { !$0.hasPrefix("-----") && !$0.isEmpty }
            .joined()
        let bytes = Array(hash.utf8.prefix(24))
        return bytes.chunks(4).map { chunk in
            chunk.map { String(format: "%02x", $0) }.joined()
        }.prefix(6).joined(separator: " · ")
    }

    private var isMuted: Bool {
        session.isChatMuted(contact.chatId)
    }

    private var identitySubtitle: String? {
        if !contact.username.isEmpty {
            return "@\(contact.username)"
        }
        return contact.isGroup ? "Группа" : nil
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

                    if !contact.isGroup {
                        dangerGroup
                            .padding(.horizontal, 16)
                            .padding(.bottom, 40)
                    }
                }
            }
        }
        .navigationBarTitleDisplayMode(.inline)
        .navigationTitle("")
        .toolbarBackground(Color.smBg, for: .navigationBar)
        .toolbarBackground(.visible, for: .navigationBar)
        .toolbar {
            if !contact.isGroup {
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
                    .disabled(isBlocking)
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
        .task(id: contact.chatId) {
            await loadSharedContent()
        }
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
                    .font(.title3.weight(.bold))
                    .foregroundStyle(Color.smText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)

                if let identitySubtitle {
                    Text(identitySubtitle)
                        .font(.subheadline.weight(.medium))
                        .foregroundStyle(Color.smAccent2)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                }

                if contact.isOnline {
                    HStack(spacing: 5) {
                        Circle().fill(Color.smOnline).frame(width: 7, height: 7)
                        Text("в сети")
                            .font(.caption)
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
                if session.initiateCall(chatId: contact.chatId, callType: "audio") {
                    dismiss()
                }
            })
            profileActionButton(icon: "video.fill", label: "Видео", action: {
                if session.initiateCall(chatId: contact.chatId, callType: "video") {
                    dismiss()
                }
            })
            profileActionButton(icon: isMuted ? "bell.fill" : "bell.slash.fill", label: isMuted ? "Вкл. звук" : "Без звука", action: {
                session.toggleChatMuted(chatId: contact.chatId)
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
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(Color.smText)
                    .lineLimit(1)
                    .minimumScaleFactor(0.72)
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
                detail: isMuted ? "Без звука" : "Включены"
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
                .font(.subheadline)
                .foregroundStyle(Color.smText)
            Spacer()
            Text(detail)
                .font(detail.count > 20 ? .system(.caption, design: .monospaced) : .caption)
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

    // MARK: - Shared media

    private var mediaSection: some View {
        let snapshot = sharedContentSnapshot
        let kinds = snapshot.kinds
        let activeKind = kinds.contains(selectedSharedContentKind) ? selectedSharedContentKind : kinds.first
        let visibleItems = activeKind.flatMap { snapshot.itemsByKind[$0] } ?? []
        let previewItems = visibleItems.prefix(6)

        return VStack(alignment: .leading, spacing: 8) {
            Text("ОБЩИЙ КОНТЕНТ")
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Color.smFaint)
                .tracking(0.6)
                .padding(.horizontal, 4)

            VStack(spacing: 0) {
                if isLoadingSharedContent {
                    HStack(spacing: 10) {
                        ProgressView()
                            .tint(Color.smAccent)
                        Text("Ищем медиа и ссылки…")
                            .font(.subheadline)
                            .foregroundStyle(Color.smMuted)
                        Spacer()
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 16)
                } else if let sharedContentError {
                    sharedContentStateRow(
                        icon: "exclamationmark.triangle.fill",
                        text: sharedContentError,
                        color: Color.smDanger
                    )
                } else if snapshot.items.isEmpty {
                    sharedContentStateRow(
                        icon: "folder",
                        text: "Здесь пока пусто",
                        color: Color.smFaint
                    )
                } else {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(kinds) { kind in
                                sharedContentTab(kind, isActive: kind == activeKind)
                            }
                        }
                        .padding(.horizontal, 12)
                        .padding(.top, 12)
                        .padding(.bottom, 8)
                    }

                    VStack(spacing: 0) {
                        ForEach(previewItems) { item in
                            if item.id != previewItems.first?.id {
                                Divider().padding(.leading, 54).background(Color.smBorderSoft)
                            }
                            sharedContentRow(item)
                        }
                        if snapshot.hasMore {
                            Divider().padding(.leading, 54).background(Color.smBorderSoft)
                            HStack(spacing: 8) {
                                Image(systemName: "clock.arrow.circlepath")
                                    .font(.system(size: 12, weight: .medium))
                                Text("Показаны последние элементы")
                                    .font(.caption)
                            }
                            .foregroundStyle(Color.smFaint)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 10)
                        }
                    }
                }
            }
            .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
            .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
        }
    }

    private func sharedContentTab(_ kind: ProfileSharedContentKind, isActive: Bool) -> some View {
        Button {
            selectedSharedContentKind = kind
        } label: {
            HStack(spacing: 5) {
                Text(kind.title)
                Text("\(sharedContentSnapshot.itemsByKind[kind]?.count ?? 0)")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(isActive ? Color.smAccent2 : Color.smFaint)
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(isActive ? Color.smText : Color.smMuted)
            .padding(.horizontal, 10)
            .padding(.vertical, 7)
            .background(isActive ? Color.smAccent.opacity(0.13) : Color.smText.opacity(0.05), in: Capsule())
            .overlay(Capsule().stroke(isActive ? Color.smAccent.opacity(0.28) : Color.smBorder, lineWidth: 0.5))
        }
        .buttonStyle(.plain)
    }

    private func sharedContentRow(_ item: ProfileSharedContentItem) -> some View {
        HStack(spacing: 12) {
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(item.color.opacity(0.12))
                    .frame(width: 32, height: 32)
                Image(systemName: item.icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(item.color)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.subheadline.weight(.medium))
                    .foregroundStyle(Color.smText)
                    .lineLimit(1)
                Text(item.subtitle)
                    .font(.caption)
                    .foregroundStyle(Color.smMuted)
                    .lineLimit(1)
            }
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
    }

    private func sharedContentStateRow(icon: String, text: String, color: Color) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 21))
                .foregroundStyle(color)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(color)
            Spacer()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 16)
    }

    @MainActor
    private func loadSharedContent() async {
        let chatId = contact.chatId
        guard sharedContentLoadingChatId != chatId else { return }
        sharedContentLoadingChatId = chatId
        isLoadingSharedContent = true
        sharedContentError = nil
        defer {
            if sharedContentLoadingChatId == chatId {
                isLoadingSharedContent = false
                sharedContentLoadingChatId = nil
            }
        }
        do {
            let page = try await session.api.getSharedContentCandidates(chatId: chatId, limit: 80)
            let myId = session.bootstrap?.user.id ?? 0
            let messages = page.messages
            let sharedBodies = await Task.detached(priority: .userInitiated) {
                let privateKey = KeychainService.loadPrivateKey()
                var bodies: [Int: String] = [:]
                bodies.reserveCapacity(messages.count)
                for message in messages {
                    bodies[message.id] = Self.sharedContentBody(for: message, privateKey: privateKey, myId: myId)
                }
                return bodies
            }.value
            let items = messages.compactMap { message -> ProfileSharedContentItem? in
                let body = sharedBodies[message.id] ?? (message.message ?? "")
                return ProfileSharedContentItem(message: message, body: body)
            }
            let itemsByKind = Dictionary(grouping: items, by: \.kind)
            let kinds = ProfileSharedContentKind.allCases.filter { !(itemsByKind[$0]?.isEmpty ?? true) }
            guard !Task.isCancelled, contact.chatId == chatId, sharedContentLoadingChatId == chatId else { return }
            sharedContentSnapshot = ProfileSharedContentSnapshot(
                items: items,
                itemsByKind: itemsByKind,
                kinds: kinds,
                hasMore: page.hasMoreBefore
            )
            if !kinds.contains(selectedSharedContentKind) {
                selectedSharedContentKind = kinds.first ?? .media
            }
        } catch APIError.unauthorized {
            guard !Task.isCancelled, contact.chatId == chatId, sharedContentLoadingChatId == chatId else { return }
            session.route = .login
        } catch {
            guard !Task.isCancelled, contact.chatId == chatId, sharedContentLoadingChatId == chatId else { return }
            sharedContentSnapshot = .empty
            sharedContentError = error.localizedDescription
        }
    }

    private nonisolated static func sharedContentBody(for message: ChatMessage, privateKey: String?, myId: Int) -> String {
        let raw = message.message ?? ""
        guard raw.hasPrefix("{"), let privateKey else { return raw }
        if ProfileSharedContentItem.jsonObject(from: raw)?["__suncall"] != nil {
            return raw
        }
        let decrypted = SunCrypto.decryptMessageForDisplay(
            raw,
            isSelf: message.senderUserId == myId,
            privateKeyPEM: privateKey
        )
        return decrypted == "__v3__" ? raw : decrypted
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
                        .font(.subheadline)
                        .foregroundStyle(Color.smDanger)
                    Spacer()
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .buttonStyle(.plain)
            .disabled(isBlocking)
        }
        .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 14))
        .overlay(RoundedRectangle(cornerRadius: 14).stroke(Color.smBorder, lineWidth: 0.5))
    }
}

// MARK: - Shared content models

private enum ProfileSharedContentKind: String, CaseIterable, Identifiable {
    case media
    case files
    case audio
    case voices
    case calls
    case links

    var id: String { rawValue }

    var title: String {
        switch self {
        case .media: return "Медиа"
        case .files: return "Файлы"
        case .audio: return "Аудио"
        case .voices: return "Голосовые"
        case .calls: return "Звонки"
        case .links: return "Ссылки"
        }
    }
}

private struct ProfileSharedContentItem: Identifiable {
    let id: Int
    let kind: ProfileSharedContentKind
    let title: String
    let subtitle: String
    let icon: String
    let color: Color

    init?(message: ChatMessage, body: String) {
        let type = message.messageType.lowercased()
        let json = Self.jsonObject(from: body)
        let sender = Self.senderLabel(message)
        let date = Self.formatDate(message.createdAt)
        let baseSubtitle = [sender, date].filter { !$0.isEmpty }.joined(separator: " • ")

        if type == "call" || json?["__suncall"] != nil {
            let callType = (json?["call_type"] as? String ?? "audio").lowercased()
            id = message.id
            kind = .calls
            title = callType == "video" ? "Видеозвонок" : "Звонок"
            subtitle = baseSubtitle
            icon = callType == "video" ? "video.fill" : "phone.fill"
            color = Color.smAccent2
            return
        }

        if type == "link" {
            id = message.id
            kind = .links
            title = Self.firstURL(in: body) ?? "Ссылка"
            subtitle = baseSubtitle
            icon = "link"
            color = Color.smAccent2
            return
        }

        let payload = json ?? [:]
        let mime = (payload["mime"] as? String ?? payload["mime_type"] as? String ?? "").lowercased()
        let name = (payload["name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let mediaType = (payload["media_type"] as? String ?? "").lowercased()
        let resolvedKind = Self.resolveKind(messageType: type, mediaType: mediaType, mime: mime, name: name, payload: payload)
        guard let resolvedKind else { return nil }

        id = message.id
        kind = resolvedKind
        let fallbackTitle: String = {
            switch resolvedKind {
            case .media:
                if type == "video" || mediaType == "video" || mime.hasPrefix("video/") { return "Видео" }
                return "Фото"
            case .files: return "Файл"
            case .audio: return "Аудио"
            case .voices: return "Голосовое сообщение"
            case .calls: return "Звонок"
            case .links: return "Ссылка"
            }
        }()
        title = name.isEmpty || resolvedKind == .voices ? fallbackTitle : name

        let details = [
            Self.formatDuration(payload["duration_seconds"]),
            Self.formatBytes(payload["size"]),
        ].compactMap { $0 }.joined(separator: " • ")
        subtitle = [baseSubtitle, details].filter { !$0.isEmpty }.joined(separator: " • ")
        icon = Self.icon(for: resolvedKind, messageType: type, mediaType: mediaType, mime: mime)
        color = Self.color(for: resolvedKind)
    }

    static func jsonObject(from text: String) -> [String: Any]? {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.hasPrefix("{"),
              let data = trimmed.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        return object
    }

    private static func resolveKind(messageType: String, mediaType: String, mime: String, name: String, payload: [String: Any]) -> ProfileSharedContentKind? {
        if messageType == "voice" || messageType == "voice_message" {
            return .voices
        }
        if messageType == "photo" || messageType == "video" {
            return .media
        }
        if messageType == "file" {
            return .files
        }
        if messageType == "audio" {
            return isVoicePayload(mime: mime, name: name, payload: payload) ? .voices : .audio
        }
        if mediaType == "photo" || mediaType == "image" || mediaType == "video" || mime.hasPrefix("image/") || mime.hasPrefix("video/") {
            return .media
        }
        if mime.hasPrefix("audio/") {
            return isVoicePayload(mime: mime, name: name, payload: payload) ? .voices : .audio
        }
        if payload["__sunfile"] != nil {
            return .files
        }
        return nil
    }

    private static func isVoicePayload(mime: String, name: String, payload: [String: Any]) -> Bool {
        let lowerName = name.lowercased()
        if lowerName.hasPrefix("voice") || lowerName.hasPrefix("recording") || lowerName.hasPrefix("голос") {
            return true
        }
        if (payload["waveform"] as? [Any])?.isEmpty == false, mime.hasPrefix("audio/") {
            return true
        }
        return false
    }

    private static func firstURL(in text: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: #"https?://[^\s<>"']+"#) else { return nil }
        let nsText = text as NSString
        let range = NSRange(location: 0, length: nsText.length)
        guard let match = regex.firstMatch(in: text, range: range) else { return nil }
        return nsText.substring(with: match.range)
            .trimmingCharacters(in: CharacterSet(charactersIn: ".,);:!?"))
    }

    private static func senderLabel(_ message: ChatMessage) -> String {
        let displayName = (message.senderDisplayName ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if !displayName.isEmpty { return displayName }
        let username = (message.senderUsername ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return username.isEmpty ? "" : "@\(username)"
    }

    private static func formatDate(_ timestamp: Double) -> String {
        SunDateFormatters.ruShortDateTime(from: Date(timeIntervalSince1970: timestamp))
    }

    private static func formatBytes(_ raw: Any?) -> String? {
        guard let number = raw as? NSNumber else { return nil }
        let bytes = number.doubleValue
        guard bytes > 0 else { return nil }
        if bytes < 1024 { return "\(Int(bytes)) B" }
        if bytes < 1024 * 1024 { return String(format: "%.1f KB", bytes / 1024) }
        return String(format: "%.1f MB", bytes / (1024 * 1024))
    }

    private static func formatDuration(_ raw: Any?) -> String? {
        let seconds: Int?
        if let number = raw as? NSNumber {
            seconds = number.intValue
        } else if let value = raw as? String, let parsed = Int(value) {
            seconds = parsed
        } else {
            seconds = nil
        }
        guard let seconds, seconds > 0 else { return nil }
        return String(format: "%02d:%02d", seconds / 60, seconds % 60)
    }

    private static func icon(for kind: ProfileSharedContentKind, messageType: String, mediaType: String, mime: String) -> String {
        switch kind {
        case .media:
            return messageType == "video" || mediaType == "video" || mime.hasPrefix("video/") ? "play.rectangle.fill" : "photo.fill"
        case .files: return "doc.fill"
        case .audio: return "music.note"
        case .voices: return "waveform"
        case .calls: return "phone.fill"
        case .links: return "link"
        }
    }

    private static func color(for kind: ProfileSharedContentKind) -> Color {
        switch kind {
        case .media: return Color.smAccent2
        case .files: return Color.smOnline
        case .audio, .voices: return Color.smAccent
        case .calls: return Color.smAccent2
        case .links: return Color.smAccent2
        }
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
