import Foundation

actor ChatLocalStore {
    static let shared = ChatLocalStore()

    private struct StoreState: Codable {
        var chatPtsByChatId: [String: Int] = [:]
        var seenEventIds: [String] = []
        var messagesByChatId: [String: [CachedChatMessage]] = [:]
    }

    private struct CachedReaction: Codable {
        let emoji: String
        let count: Int
        let reactedByMe: Bool

        init(_ reaction: MessageReaction) {
            emoji = reaction.emoji
            count = reaction.count
            reactedByMe = reaction.reactedByMe
        }

        var reaction: MessageReaction {
            MessageReaction(emoji: emoji, count: count, reactedByMe: reactedByMe)
        }
    }

    private struct CachedChatMessage: Codable {
        let id: Int
        let chatId: String
        let message: String?
        let messageType: String
        let createdAt: Double
        let senderUserId: Int?
        let senderPublicKey: String?
        let senderDisplayName: String?
        let senderUsername: String?
        let isRead: Bool
        let isDelivered: Bool
        let reactions: [CachedReaction]
        let isEdited: Bool

        init(_ message: ChatMessage) {
            id = message.id
            chatId = message.chatId
            self.message = message.message
            messageType = message.messageType
            createdAt = message.createdAt
            senderUserId = message.senderUserId
            senderPublicKey = message.senderPublicKey
            senderDisplayName = message.senderDisplayName
            senderUsername = message.senderUsername
            isRead = message.isRead
            isDelivered = message.isDelivered
            reactions = message.reactions.map(CachedReaction.init)
            isEdited = message.isEdited
        }

        var chatMessage: ChatMessage {
            ChatMessage(
                id: id,
                chatId: chatId,
                message: message,
                messageType: messageType,
                createdAt: createdAt,
                senderUserId: senderUserId,
                senderPublicKey: senderPublicKey,
                senderDisplayName: senderDisplayName,
                senderUsername: senderUsername,
                isRead: isRead,
                isDelivered: isDelivered,
                reactions: reactions.map(\.reaction),
                isEdited: isEdited
            )
        }
    }

    private let maxMessagesPerChat = 500
    private let maxSeenEventIds = 2_000
    private var cachedState: StoreState?

    private var storeURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        return base
            .appendingPathComponent("Sunmsg", isDirectory: true)
            .appendingPathComponent("chat-local-store.json", isDirectory: false)
    }

    func syncSnapshot() -> (chatPtsByChatId: [String: Int], seenEventIds: [String]) {
        let state = loadState()
        return (state.chatPtsByChatId, state.seenEventIds)
    }

    func chatPts(for chatId: String) -> Int {
        loadState().chatPtsByChatId[chatId] ?? 0
    }

    func setChatPts(_ chatPts: Int, for chatId: String) {
        mutateState { state in
            state.chatPtsByChatId[chatId] = max(state.chatPtsByChatId[chatId] ?? 0, chatPts)
        }
    }

    func rememberEventId(_ eventId: String?) {
        guard let eventId, !eventId.isEmpty else { return }
        mutateState { state in
            guard !state.seenEventIds.contains(eventId) else { return }
            state.seenEventIds.append(eventId)
            if state.seenEventIds.count > maxSeenEventIds {
                state.seenEventIds.removeFirst(state.seenEventIds.count - maxSeenEventIds)
            }
        }
    }

    func cachedMessages(chatId: String) -> [ChatMessage] {
        loadState().messagesByChatId[chatId]?.map(\.chatMessage) ?? []
    }

    func mergeMessages(_ messages: [ChatMessage], chatId: String) {
        guard !messages.isEmpty else { return }
        mutateState { state in
            var byId: [Int: CachedChatMessage] = [:]
            for cached in state.messagesByChatId[chatId] ?? [] {
                byId[cached.id] = cached
            }
            for message in messages {
                byId[message.id] = CachedChatMessage(message)
            }
            let ordered = byId.values.sorted {
                if $0.createdAt == $1.createdAt { return $0.id < $1.id }
                return $0.createdAt < $1.createdAt
            }
            state.messagesByChatId[chatId] = Array(ordered.suffix(maxMessagesPerChat))
        }
    }

    func deleteMessages(ids: [Int], chatId: String) {
        guard !ids.isEmpty else { return }
        let idSet = Set(ids)
        mutateState { state in
            state.messagesByChatId[chatId]?.removeAll { idSet.contains($0.id) }
        }
    }

    func resetAll() {
        let state = StoreState()
        cachedState = state
        persist(state)
    }

    private func mutateState(_ update: (inout StoreState) -> Void) {
        var state = loadState()
        update(&state)
        cachedState = state
        persist(state)
    }

    private func loadState() -> StoreState {
        if let cachedState { return cachedState }
        let url = storeURL
        guard
            let data = try? Data(contentsOf: url),
            let state = try? JSONDecoder().decode(StoreState.self, from: data)
        else {
            let state = StoreState()
            cachedState = state
            return state
        }
        cachedState = state
        return state
    }

    private func persist(_ state: StoreState) {
        let url = storeURL
        do {
            try FileManager.default.createDirectory(
                at: url.deletingLastPathComponent(),
                withIntermediateDirectories: true
            )
            let data = try JSONEncoder().encode(state)
            try data.write(to: url, options: [.atomic])
        } catch {
        }
    }
}
