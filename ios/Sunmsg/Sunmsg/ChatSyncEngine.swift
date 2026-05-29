import Foundation

enum SunJSON {
    static func int(_ value: Any?) -> Int? {
        if let value = value as? Int { return value }
        if let value = value as? Double { return Int(value) }
        if let value = value as? String { return Int(value.trimmingCharacters(in: .whitespacesAndNewlines)) }
        return nil
    }

    static func string(_ value: Any?) -> String? {
        if let value = value as? String {
            let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
            return trimmed.isEmpty ? nil : trimmed
        }
        return nil
    }
}

struct ChatUpdateState {
    let chatId: String
    let chatPts: Int
}

struct ChatUpdateDifference {
    let chatId: String
    let fromPts: Int
    let chatPts: Int
    let events: [SocketReplayEvent]
    let hasMore: Bool
    let nextFromPts: Int
}

struct SocketReplayEvent {
    let eventName: String
    let payload: [String: Any]
    let chatId: String
    let chatPts: Int
    let eventId: String?

    init?(rawPayload: [String: Any]) {
        let envelope = rawPayload["envelope"] as? [String: Any]
        guard
            let name = SunJSON.string(rawPayload["event_type"]) ?? SunJSON.string(envelope?["event_type"]),
            let chatId = SunJSON.string(rawPayload["chat_id"]) ?? SunJSON.string(envelope?["chat_id"]),
            let chatPts = SunJSON.int(rawPayload["chat_pts"]) ?? SunJSON.int(envelope?["chat_pts"]),
            chatPts > 0
        else { return nil }

        self.eventName = name
        self.payload = rawPayload
        self.chatId = chatId
        self.chatPts = chatPts
        self.eventId = SunJSON.string(rawPayload["event_id"]) ?? SunJSON.string(envelope?["event_id"])
    }

    static func metadata(eventName: String, payload: [String: Any]) -> SocketReplayEvent? {
        var raw = payload
        if raw["event_type"] == nil {
            raw["event_type"] = eventName
        }
        return SocketReplayEvent(rawPayload: raw)
    }
}

@MainActor
final class ChatSyncEngine {
    private let api: APIClient
    private var chatPtsByChatId: [String: Int] = [:]
    private var seenEventIds = Set<String>()
    private var seenEventOrder: [String] = []
    private let seenEventLimit = 2_000

    init(api: APIClient) {
        self.api = api
    }

    func reset() {
        chatPtsByChatId.removeAll()
        seenEventIds.removeAll()
        seenEventOrder.removeAll()
    }

    func prime(chatId: String) async {
        do {
            let state = try await api.getUpdatesState(chatId: chatId)
            if state.chatPts > (chatPtsByChatId[chatId] ?? 0) {
                chatPtsByChatId[chatId] = state.chatPts
            }
        } catch {
        }
    }

    func recoverChat(chatId: String) async -> [SocketReplayEvent] {
        do {
            let state = try await api.getUpdatesState(chatId: chatId)
            let localPts = chatPtsByChatId[chatId] ?? 0
            guard localPts > 0 else {
                chatPtsByChatId[chatId] = max(localPts, state.chatPts)
                return []
            }
            guard state.chatPts > localPts else { return [] }
            return await recoverGap(chatId: chatId, fromPts: localPts, targetPts: state.chatPts)
        } catch {
            return []
        }
    }

    func prepareLiveEvent(eventName: String, payload: [String: Any]) async -> (replays: [SocketReplayEvent], shouldApplyCurrent: Bool) {
        guard let metadata = SocketReplayEvent.metadata(eventName: eventName, payload: payload) else {
            return ([], true)
        }
        if let eventId = metadata.eventId, seenEventIds.contains(eventId) {
            return ([], false)
        }

        let localPts = chatPtsByChatId[metadata.chatId] ?? 0
        if metadata.chatPts <= localPts {
            rememberEventId(metadata.eventId)
            return ([], false)
        }

        let replays: [SocketReplayEvent]
        if localPts > 0, metadata.chatPts > localPts + 1 {
            replays = await recoverGap(
                chatId: metadata.chatId,
                fromPts: localPts,
                targetPts: metadata.chatPts - 1
            )
        } else {
            replays = []
        }

        if metadata.chatPts <= (chatPtsByChatId[metadata.chatId] ?? 0) {
            rememberEventId(metadata.eventId)
            return (replays, false)
        }

        recordApplied(chatId: metadata.chatId, chatPts: metadata.chatPts, eventId: metadata.eventId)
        return (replays, true)
    }

    private func recoverGap(chatId: String, fromPts: Int, targetPts: Int) async -> [SocketReplayEvent] {
        guard targetPts > fromPts else { return [] }
        var cursor = max(0, fromPts)
        var recovered: [SocketReplayEvent] = []
        var pageCount = 0

        while cursor < targetPts, pageCount < 20 {
            pageCount += 1
            let diff: ChatUpdateDifference
            do {
                diff = try await api.getUpdatesDifference(chatId: chatId, fromPts: cursor, limit: 100)
            } catch {
                break
            }

            var advanced = false
            for event in diff.events.sorted(by: { $0.chatPts < $1.chatPts }) {
                guard event.chatId == chatId, event.chatPts > cursor else { continue }
                guard event.chatPts <= targetPts else { continue }
                if let eventId = event.eventId, seenEventIds.contains(eventId) {
                    cursor = max(cursor, event.chatPts)
                    advanced = true
                    continue
                }
                recovered.append(event)
                recordApplied(chatId: chatId, chatPts: event.chatPts, eventId: event.eventId)
                cursor = max(cursor, event.chatPts)
                advanced = true
            }

            guard diff.hasMore, advanced else { break }
        }

        return recovered
    }

    private func recordApplied(chatId: String, chatPts: Int, eventId: String?) {
        chatPtsByChatId[chatId] = max(chatPtsByChatId[chatId] ?? 0, chatPts)
        rememberEventId(eventId)
    }

    private func rememberEventId(_ eventId: String?) {
        guard let eventId, !eventId.isEmpty, !seenEventIds.contains(eventId) else { return }
        seenEventIds.insert(eventId)
        seenEventOrder.append(eventId)
        if seenEventOrder.count > seenEventLimit {
            let overflow = seenEventOrder.count - seenEventLimit
            let removed = Array(seenEventOrder.prefix(overflow))
            seenEventOrder.removeFirst(overflow)
            for eventId in removed {
                seenEventIds.remove(eventId)
            }
        }
    }
}
