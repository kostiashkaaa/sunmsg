import Foundation
import SwiftUI

// MARK: - Design tokens

extension Color {
    // Backgrounds — exactly matches web CSS dark-mode variables
    static var smBg:         Color { adaptive("#f3f0e8", "#1c1a14") }  // --bg / --sidebar-bg
    static var smBg2:        Color { adaptive("#f2ede2", "#100e09") }  // --chat-bg
    static var smSurface:    Color { adaptive("#fbf8f1", "#221f17") }  // --surface / --paper
    static var smSurface2:   Color { adaptive("#efeae0", "#2a261c") }  // --surface-2 / --paper-alt
    static var smText:       Color { adaptive("#15140e", "#ece6d5") }  // --text
    static var smMuted:      Color { adaptive("#7a7363", "#9b9586") }  // --sub-text / --ink-mute
    static var smFaint:      Color { adaptive("#aba493", "#6f6a5b") }  // --text-muted / --ink-faint
    static var smAccent:     Color { Color(hex: "#c4943c") }           // --accent (same both modes)
    static var smAccent2:    Color { adaptive("#b78428", "#d6a553") }  // --accent-deep
    static var smBorder:     Color { adaptive("#d9d2bf", "#332f24") }  // --border
    static var smBorderSoft: Color { adaptive("#e8e1cd", "#2a261c") }  // --rule-soft
    static var smBubbleOut:  Color { adaptive("#15140e", "#ece6d5") }  // --bubble-out
    static var smBubbleOutText: Color { adaptive("#f3f0e8", "#15140e") }
    static var smBubbleIn:   Color { adaptive("#fbf8f1", "#2a261c") }  // --bubble-in
    static var smBubbleInText: Color { adaptive("#15140e", "#ece6d5") }
    static var smOnline:     Color { Color(hex: "#5a9b6a") }           // --online-dot-color
    static var smDanger:     Color { Color(hex: "#dc2626") }
    static var smReqBg:      Color { adaptive("#fefce8", "#1c1500") }  // --req-bg (amber alert)
    static var smReqBorder:  Color { adaptive("#fde68a", "#3d2e00") }  // --req-border

    init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "#", with: "")
        if s.count == 3 { s = String(s.flatMap { [$0, $0] }) }
        var v: UInt64 = 0
        Scanner(string: s).scanHexInt64(&v)
        self.init(
            red:   Double((v >> 16) & 0xFF) / 255,
            green: Double((v >> 8)  & 0xFF) / 255,
            blue:  Double( v        & 0xFF) / 255
        )
    }

    private static func adaptive(_ light: String, _ dark: String) -> Color {
        Color(UIColor { tc in
            tc.userInterfaceStyle == .dark
                ? UIColor(hex: dark)
                : UIColor(hex: light)
        })
    }
}

extension UIColor {
    convenience init(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespacesAndNewlines).replacingOccurrences(of: "#", with: "")
        if s.count == 3 { s = String(s.flatMap { [$0, $0] }) }
        var v: UInt64 = 0
        Scanner(string: s).scanHexInt64(&v)
        self.init(
            red:   CGFloat((v >> 16) & 0xFF) / 255,
            green: CGFloat((v >> 8)  & 0xFF) / 255,
            blue:  CGFloat( v        & 0xFF) / 255,
            alpha: 1
        )
    }
}

// MARK: - Bootstrap

struct BootstrapResponse: Decodable {
    let success: Bool
    let csrfToken: String
    let user: BootstrapUser
    let session: BootstrapSession
    let contacts: [Contact]
    let hasMoreContacts: Bool

    enum CodingKeys: String, CodingKey {
        case success, user, session, contacts
        case csrfToken = "csrf_token"
        case hasMoreContacts = "has_more_contacts"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        success = (try? c.decodeIfPresent(Bool.self, forKey: .success)) ?? false
        csrfToken = (try? c.decodeIfPresent(String.self, forKey: .csrfToken)) ?? ""
        user = (try? c.decodeIfPresent(BootstrapUser.self, forKey: .user)) ?? BootstrapUser.empty
        session = (try? c.decodeIfPresent(BootstrapSession.self, forKey: .session)) ?? BootstrapSession.empty
        contacts = (try? c.decodeIfPresent(LossyArray<Contact>.self, forKey: .contacts)?.elements) ?? []
        hasMoreContacts = (try? c.decodeIfPresent(Bool.self, forKey: .hasMoreContacts)) ?? false
    }
}

struct BootstrapUser: Decodable {
    let id: Int
    let username: String
    let displayName: String
    let publicKey: String
    let avatarUrl: String?
    let uiLanguage: String

    static let empty = BootstrapUser(
        id: 0,
        username: "",
        displayName: "",
        publicKey: "",
        avatarUrl: nil,
        uiLanguage: "ru"
    )

    enum CodingKeys: String, CodingKey {
        case id, username
        case displayName = "display_name"
        case publicKey = "public_key"
        case avatarUrl = "avatar_url"
        case uiLanguage = "ui_language"
    }

    init(id: Int, username: String, displayName: String, publicKey: String, avatarUrl: String?, uiLanguage: String) {
        self.id = id
        self.username = username
        self.displayName = displayName
        self.publicKey = publicKey
        self.avatarUrl = avatarUrl
        self.uiLanguage = uiLanguage
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decodeIfPresent(Int.self, forKey: .id)) ?? 0
        username = (try? c.decodeIfPresent(String.self, forKey: .username)) ?? ""
        displayName = (try? c.decodeIfPresent(String.self, forKey: .displayName)) ?? username
        publicKey = (try? c.decodeIfPresent(String.self, forKey: .publicKey)) ?? ""
        avatarUrl = try? c.decodeIfPresent(String.self, forKey: .avatarUrl)
        uiLanguage = (try? c.decodeIfPresent(String.self, forKey: .uiLanguage)) ?? "ru"
    }
}

struct BootstrapSession: Decodable {
    let autoLogoutSeconds: Int
    let expiresAt: Int

    static let empty = BootstrapSession(autoLogoutSeconds: 0, expiresAt: 0)

    enum CodingKeys: String, CodingKey {
        case autoLogoutSeconds = "auto_logout_seconds"
        case expiresAt = "expires_at"
    }

    init(autoLogoutSeconds: Int, expiresAt: Int) {
        self.autoLogoutSeconds = autoLogoutSeconds
        self.expiresAt = expiresAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        autoLogoutSeconds = (try? c.decodeIfPresent(Int.self, forKey: .autoLogoutSeconds)) ?? 0
        expiresAt = (try? c.decodeIfPresent(Int.self, forKey: .expiresAt)) ?? 0
    }
}

// MARK: - Flexible decoding helpers

struct LossyArray<Element: Decodable>: Decodable {
    let elements: [Element]

    init(from decoder: Decoder) throws {
        var container = try decoder.unkeyedContainer()
        var decoded: [Element] = []
        while !container.isAtEnd {
            if let item = try? container.decode(Element.self) {
                decoded.append(item)
            } else {
                _ = try? container.decode(DiscardedValue.self)
            }
        }
        elements = decoded
    }
}

private struct DiscardedValue: Decodable {}

enum SunDateParser {
    static func decodeTimestamp<K: CodingKey>(_ container: KeyedDecodingContainer<K>, forKey key: K) -> Double? {
        if let value = try? container.decodeIfPresent(Double.self, forKey: key) {
            return value
        }
        if let value = try? container.decodeIfPresent(Int.self, forKey: key) {
            return Double(value)
        }
        guard let raw = try? container.decodeIfPresent(String.self, forKey: key) else {
            return nil
        }
        return timestamp(from: raw)
    }

    static func timestamp(from raw: String?) -> Double? {
        let value = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        if let numeric = Double(value) { return numeric }

        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = iso.date(from: value) { return date.timeIntervalSince1970 }
        iso.formatOptions = [.withInternetDateTime]
        if let date = iso.date(from: value) { return date.timeIntervalSince1970 }

        for format in [
            "yyyy-MM-dd HH:mm:ss.SSSSSSZ",
            "yyyy-MM-dd HH:mm:ssZ",
            "yyyy-MM-dd HH:mm:ss.SSSSSS",
            "yyyy-MM-dd HH:mm:ss",
            "yyyy-MM-dd'T'HH:mm:ss.SSSSSSZ",
            "yyyy-MM-dd'T'HH:mm:ssZ",
        ] {
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.timeZone = TimeZone(secondsFromGMT: 0)
            formatter.dateFormat = format
            if let date = formatter.date(from: value) {
                return date.timeIntervalSince1970
            }
        }
        return nil
    }

    static func timestamp(fromAny value: Any?) -> Double? {
        if let value = value as? Double { return value }
        if let value = value as? Int { return Double(value) }
        if let value = value as? String { return timestamp(from: value) }
        return nil
    }
}

func smFormatLastSeen(_ timestamp: Double?) -> String {
    guard let timestamp else { return "не в сети" }
    let date = Date(timeIntervalSince1970: timestamp)
    let now = Date()
    let seconds = max(0, now.timeIntervalSince(date))
    if seconds < 60 { return "был(а) в сети только что" }
    if seconds < 3600 {
        let minutes = Int(seconds / 60)
        let suffix = minutes == 1 ? "минуту" : (minutes < 5 ? "минуты" : "минут")
        return "был(а) в сети \(minutes) \(suffix) назад"
    }
    if Calendar.current.isDateInToday(date) {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        formatter.locale = Locale(identifier: "ru_RU")
        return "был(а) в сети сегодня в \(formatter.string(from: date))"
    }
    if Calendar.current.isDateInYesterday(date) {
        let formatter = DateFormatter()
        formatter.dateFormat = "HH:mm"
        formatter.locale = Locale(identifier: "ru_RU")
        return "был(а) в сети вчера в \(formatter.string(from: date))"
    }
    let formatter = DateFormatter()
    formatter.dateFormat = "dd.MM HH:mm"
    formatter.locale = Locale(identifier: "ru_RU")
    return "был(а) в сети \(formatter.string(from: date))"
}

// MARK: - Contact

struct Contact: Decodable, Identifiable {
    let userId: Int?
    let chatId: String
    var displayName: String
    var username: String
    let publicKey: String
    var lastMessage: String?
    var lastMessageTime: Double?
    var initialLastMessagePreview: String?
    var lastSenderId: Int?
    var unreadCount: Int
    var avatarUrl: String?
    var isOnline: Bool
    var lastSeen: Double?
    let isPinned: Bool
    let isGroup: Bool

    var id: String { chatId }

    // Memberwise init used when constructing from search results
    init(userId: Int?, chatId: String, displayName: String, username: String,
         publicKey: String, lastMessage: String?, lastMessageTime: Double?,
         initialLastMessagePreview: String?, lastSenderId: Int? = nil,
         unreadCount: Int, avatarUrl: String?,
         isOnline: Bool, lastSeen: Double? = nil, isPinned: Bool, isGroup: Bool) {
        self.userId = userId; self.chatId = chatId; self.displayName = displayName
        self.username = username; self.publicKey = publicKey; self.lastMessage = lastMessage
        self.lastMessageTime = lastMessageTime
        self.initialLastMessagePreview = initialLastMessagePreview
        self.lastSenderId = lastSenderId
        self.unreadCount = unreadCount; self.avatarUrl = avatarUrl
        self.isOnline = isOnline; self.lastSeen = lastSeen; self.isPinned = isPinned; self.isGroup = isGroup
    }
    
    var lastMessagePreview: String {
        let p = initialLastMessagePreview ?? ""
        if p == "__SUN_ENCRYPTED_LOADING__" { return "🔐 Encrypted message" }
        if !p.isEmpty { return p }
        let raw = lastMessage ?? ""
        if raw.hasPrefix("{") { return "🔐 Encrypted message" }
        return raw
    }

    var isTyping: Bool = false

    enum CodingKeys: String, CodingKey {
        case userId = "userId"
        case chatId = "chatId"
        case displayName = "display_name"
        case username
        case publicKey = "public_key"
        case lastMessage = "last_message"
        case lastMessageTime = "last_message_time"
        case initialLastMessagePreview = "initial_last_message_preview"
        case lastSenderId = "last_sender_id"
        case unreadCount = "unreadCount"
        case avatarUrl = "avatar_url"
        case isOnline = "is_online"
        case lastSeen = "last_seen"
        case isPinned = "is_pinned"
        case isGroup = "is_group"
    }

    // Custom Decodable init: server may omit some Bool fields — use safe defaults
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        userId   = try? c.decodeIfPresent(Int.self,    forKey: .userId)
        chatId   = try c.decode(String.self, forKey: .chatId)
        displayName = (try? c.decodeIfPresent(String.self, forKey: .displayName)) ?? ""
        username    = (try? c.decodeIfPresent(String.self, forKey: .username))    ?? ""
        publicKey   = (try? c.decodeIfPresent(String.self, forKey: .publicKey))   ?? ""
        lastMessage             = try? c.decodeIfPresent(String.self, forKey: .lastMessage)
        lastMessageTime         = SunDateParser.decodeTimestamp(c, forKey: .lastMessageTime)
        initialLastMessagePreview = try? c.decodeIfPresent(String.self, forKey: .initialLastMessagePreview)
        lastSenderId = try? c.decodeIfPresent(Int.self, forKey: .lastSenderId)
        unreadCount = (try? c.decodeIfPresent(Int.self,  forKey: .unreadCount)) ?? 0
        avatarUrl   = try? c.decodeIfPresent(String.self, forKey: .avatarUrl)
        isOnline    = (try? c.decodeIfPresent(Bool.self, forKey: .isOnline))  ?? false
        lastSeen    = SunDateParser.decodeTimestamp(c, forKey: .lastSeen)
        isPinned    = (try? c.decodeIfPresent(Bool.self, forKey: .isPinned))  ?? false
        isGroup     = (try? c.decodeIfPresent(Bool.self, forKey: .isGroup))   ?? false
        isTyping    = false
    }
}

// MARK: - Settings

struct AppSettings: Decodable {
    var displayName: String
    var username: String
    var isPublic: Bool
    var muteDialogRequests: Bool
    var hideOnlineStatus: Bool
    var lastSeenVisibility: String
    var typingPrivacy: String
    var readReceiptsPrivacy: String
    var messagePrivacy: String
    var groupInvitePrivacy: String
    var online: Bool
    var lastSeen: Double?

    enum CodingKeys: String, CodingKey {
        case displayName = "display_name"
        case username
        case isPublic = "is_public"
        case muteDialogRequests = "mute_dialog_requests"
        case hideOnlineStatus = "hide_online_status"
        case lastSeenVisibility = "last_seen_visibility"
        case typingPrivacy = "typing_privacy"
        case readReceiptsPrivacy = "read_receipts_privacy"
        case messagePrivacy = "message_privacy"
        case groupInvitePrivacy = "group_invite_privacy"
        case online
        case lastSeen = "last_seen"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        displayName = (try? c.decodeIfPresent(String.self, forKey: .displayName)) ?? ""
        username = (try? c.decodeIfPresent(String.self, forKey: .username)) ?? ""
        isPublic = (try? c.decodeIfPresent(Bool.self, forKey: .isPublic)) ?? false
        muteDialogRequests = (try? c.decodeIfPresent(Bool.self, forKey: .muteDialogRequests)) ?? false
        hideOnlineStatus = (try? c.decodeIfPresent(Bool.self, forKey: .hideOnlineStatus)) ?? false
        lastSeenVisibility = (try? c.decodeIfPresent(String.self, forKey: .lastSeenVisibility)) ?? (hideOnlineStatus ? "nobody" : "contacts")
        typingPrivacy = (try? c.decodeIfPresent(String.self, forKey: .typingPrivacy)) ?? "contacts"
        readReceiptsPrivacy = (try? c.decodeIfPresent(String.self, forKey: .readReceiptsPrivacy)) ?? "contacts"
        messagePrivacy = (try? c.decodeIfPresent(String.self, forKey: .messagePrivacy)) ?? "contacts"
        groupInvitePrivacy = (try? c.decodeIfPresent(String.self, forKey: .groupInvitePrivacy)) ?? "contacts"
        online = (try? c.decodeIfPresent(Bool.self, forKey: .online)) ?? false
        lastSeen = SunDateParser.decodeTimestamp(c, forKey: .lastSeen)
    }
}

// MARK: - Message reaction

struct MessageReaction: Decodable, Identifiable, Equatable {
    let emoji: String
    var count: Int
    var reactedByMe: Bool

    var id: String { emoji }

    init(emoji: String, count: Int, reactedByMe: Bool) {
        self.emoji = emoji; self.count = count; self.reactedByMe = reactedByMe
    }

    enum CodingKeys: String, CodingKey {
        case emoji, count
        case reactedByMe = "reacted_by_me"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        emoji = (try? c.decodeIfPresent(String.self, forKey: .emoji)) ?? ""
        count = (try? c.decodeIfPresent(Int.self, forKey: .count)) ?? 0
        reactedByMe = (try? c.decodeIfPresent(Bool.self, forKey: .reactedByMe)) ?? false
    }
}

// MARK: - Message

struct ChatMessage: Decodable, Identifiable {
    let id: Int
    let chatId: String
    // Mutable so edits (message_edited) can update the body in place.
    var message: String?
    // Mutable so edits can change a message's type (e.g. text → link).
    var messageType: String
    let createdAt: Double
    let senderUserId: Int?
    let senderPublicKey: String?
    let senderDisplayName: String?
    let senderUsername: String?
    var reactions: [MessageReaction]
    /// True once the message has been edited (server sets is_edited / emits message_edited).
    var isEdited: Bool

    // Explicit memberwise init so we can construct from socket payloads (bypasses Decodable).
    init(id: Int, chatId: String, message: String?, messageType: String,
         createdAt: Double, senderUserId: Int?, senderPublicKey: String?,
         senderDisplayName: String?, senderUsername: String?,
         isRead: Bool = false, isDelivered: Bool = false,
         reactions: [MessageReaction] = [], isEdited: Bool = false) {
        self.id = id; self.chatId = chatId; self.message = message
        self.messageType = messageType; self.createdAt = createdAt
        self.senderUserId = senderUserId; self.senderPublicKey = senderPublicKey
        self.senderDisplayName = senderDisplayName; self.senderUsername = senderUsername
        self.isRead = isRead; self.isDelivered = isDelivered
        self.reactions = reactions; self.isEdited = isEdited
    }

    var isRead: Bool
    var isDelivered: Bool

    var isEncrypted: Bool {
        guard let msg = message, !msg.isEmpty else { return false }
        if messageType == "call" { return false }
        return msg.hasPrefix("{")
    }

    var displayText: String {
        guard let msg = message, !msg.isEmpty else { return "" }
        return isEncrypted ? "🔐 Encrypted message" : msg
    }

    enum CodingKeys: String, CodingKey {
        case id
        case chatId        = "chat_id"
        case message
        case messageType   = "message_type"
        case createdAt     = "created_at"
        case senderUserId  = "sender_user_id"
        case senderPublicKey   = "sender_public_key"
        case senderDisplayName = "sender_display_name"
        case senderUsername    = "sender_username"
        case isRead      = "is_read"
        case isDelivered = "is_delivered"
        case reactions
        case isEdited    = "is_edited"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id               = try  c.decode(Int.self, forKey: .id)
        chatId           = (try? c.decodeIfPresent(String.self, forKey: .chatId)) ?? ""
        message          = try? c.decodeIfPresent(String.self, forKey: .message)
        messageType      = (try? c.decodeIfPresent(String.self, forKey: .messageType)) ?? "text"
        createdAt        = SunDateParser.decodeTimestamp(c, forKey: .createdAt) ?? Date().timeIntervalSince1970
        senderUserId     = try? c.decodeIfPresent(Int.self,    forKey: .senderUserId)
        senderPublicKey  = try? c.decodeIfPresent(String.self, forKey: .senderPublicKey)
        senderDisplayName = try? c.decodeIfPresent(String.self, forKey: .senderDisplayName)
        senderUsername   = try? c.decodeIfPresent(String.self, forKey: .senderUsername)
        isRead           = (try? c.decodeIfPresent(Bool.self,   forKey: .isRead))      ?? false
        isDelivered      = (try? c.decodeIfPresent(Bool.self,   forKey: .isDelivered)) ?? false
        reactions        = (try? c.decodeIfPresent(LossyArray<MessageReaction>.self, forKey: .reactions)?.elements) ?? []
        isEdited         = (try? c.decodeIfPresent(Bool.self, forKey: .isEdited)) ?? false
    }
}

struct ChatHistoryResponse: Decodable {
    let success: Bool
    let messages: [ChatMessage]

    enum CodingKeys: String, CodingKey {
        case success, messages
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        success = (try? c.decodeIfPresent(Bool.self, forKey: .success)) ?? false
        messages = (try? c.decodeIfPresent(LossyArray<ChatMessage>.self, forKey: .messages)?.elements) ?? []
    }
}

// MARK: - Dialog Request

struct DialogRequest: Decodable, Identifiable {
    let senderPublicKey: String
    let senderUsername: String
    let senderDisplayName: String

    var id: String { senderPublicKey }

    enum CodingKeys: String, CodingKey {
        case senderPublicKey  = "sender_public_key"
        case senderUsername   = "sender_username"
        case senderDisplayName = "sender_display_name"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        senderPublicKey   = (try? c.decodeIfPresent(String.self, forKey: .senderPublicKey))   ?? ""
        senderUsername    = (try? c.decodeIfPresent(String.self, forKey: .senderUsername))    ?? ""
        senderDisplayName = (try? c.decodeIfPresent(String.self, forKey: .senderDisplayName)) ?? ""
    }
}

struct DialogRequestsResponse: Decodable {
    let success: Bool
    let dialogRequests: [DialogRequest]

    enum CodingKeys: String, CodingKey {
        case success
        case dialogRequests = "dialog_requests"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        success = (try? c.decodeIfPresent(Bool.self, forKey: .success)) ?? false
        dialogRequests = (try? c.decodeIfPresent(LossyArray<DialogRequest>.self, forKey: .dialogRequests)?.elements) ?? []
    }
}

// MARK: - Blocked user

struct BlockedUser: Decodable, Identifiable {
    let userId: Int
    let username: String
    let displayName: String
    let publicKey: String

    var id: Int { userId }

    enum CodingKeys: String, CodingKey {
        case userId = "blocked_user_id"
        case username = "blocked_username"
        case displayName = "blocked_display_name"
        case publicKey = "blocked_public_key"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        userId = try c.decode(Int.self, forKey: .userId)
        username = (try? c.decodeIfPresent(String.self, forKey: .username)) ?? ""
        displayName = (try? c.decodeIfPresent(String.self, forKey: .displayName)) ?? username
        publicKey = (try? c.decodeIfPresent(String.self, forKey: .publicKey)) ?? ""
    }
}

// MARK: - Search users

struct SearchUserResult: Decodable, Identifiable {
    let userId: Int
    let username: String
    let displayName: String
    let avatarUrl: String?
    let isContact: Bool
    let chatId: String?
    let relationshipStatus: String
    let pendingIncomingRequest: Bool
    let pendingOutgoingRequest: Bool
    let publicKey: String?

    var id: Int { userId }

    enum CodingKeys: String, CodingKey {
        case userId = "userId"
        case username
        case displayName = "display_name"
        case avatarUrl = "avatar_url"
        case isContact = "is_contact"
        case chatId = "chat_id"
        case relationshipStatus = "relationship_status"
        case pendingIncomingRequest = "pending_incoming_request"
        case pendingOutgoingRequest = "pending_outgoing_request"
        case publicKey = "public_key"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        userId = try c.decode(Int.self, forKey: .userId)
        username = try c.decode(String.self, forKey: .username)
        displayName = (try? c.decodeIfPresent(String.self, forKey: .displayName)) ?? username
        avatarUrl = try? c.decodeIfPresent(String.self, forKey: .avatarUrl)
        isContact = (try? c.decodeIfPresent(Bool.self, forKey: .isContact)) ?? false
        chatId = try? c.decodeIfPresent(String.self, forKey: .chatId)
        relationshipStatus = (try? c.decodeIfPresent(String.self, forKey: .relationshipStatus)) ?? "none"
        pendingIncomingRequest = (try? c.decodeIfPresent(Bool.self, forKey: .pendingIncomingRequest)) ?? false
        pendingOutgoingRequest = (try? c.decodeIfPresent(Bool.self, forKey: .pendingOutgoingRequest)) ?? false
        publicKey = try? c.decodeIfPresent(String.self, forKey: .publicKey)
    }
}

struct SearchUsersResponse: Decodable {
    let success: Bool
    let users: [SearchUserResult]
    let hasMore: Bool

    enum CodingKeys: String, CodingKey {
        case success, users
        case hasMore = "has_more"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        success = try c.decode(Bool.self, forKey: .success)
        users = (try? c.decodeIfPresent(LossyArray<SearchUserResult>.self, forKey: .users)?.elements) ?? []
        hasMore = (try? c.decodeIfPresent(Bool.self, forKey: .hasMore)) ?? false
    }
}

struct StartChatResponse: Decodable {
    let success: Bool
    let status: String
    let chatId: String?
    let contact: StartChatContact?

    enum CodingKeys: String, CodingKey {
        case success, status
        case chatId = "chat_id"
        case contact
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        success = try c.decode(Bool.self, forKey: .success)
        status = (try? c.decodeIfPresent(String.self, forKey: .status)) ?? ""
        chatId = try? c.decodeIfPresent(String.self, forKey: .chatId)
        contact = try? c.decodeIfPresent(StartChatContact.self, forKey: .contact)
    }
}

struct StartChatContact: Decodable {
    let chatId: String
    let userId: Int
    let username: String
    let displayName: String
    let publicKey: String

    enum CodingKeys: String, CodingKey {
        case chatId = "chatId"
        case userId = "userId"
        case username
        case displayName = "display_name"
        case publicKey = "public_key"
    }
}

// MARK: - Auth

struct ChallengeResponse: Decodable {
    let success: Bool
    let challenge: String
    let loginVault: String

    enum CodingKeys: String, CodingKey {
        case success, challenge
        case loginVault = "login_vault"
    }
}

struct LoginChallengeResponse: Decodable {
    let success: Bool
    let requiresTotp: Bool
    let csrfToken: String?

    enum CodingKeys: String, CodingKey {
        case success
        case requiresTotp = "requires_totp"
        case csrfToken = "csrf_token"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        success = try c.decode(Bool.self, forKey: .success)
        requiresTotp = (try? c.decodeIfPresent(Bool.self, forKey: .requiresTotp)) ?? false
        csrfToken = try? c.decodeIfPresent(String.self, forKey: .csrfToken)
    }
}

// MARK: - Helpers

func smFormatTime(_ ts: Double) -> String {
    let date = Date(timeIntervalSince1970: ts)
    let cal = Calendar.current
    if cal.isDateInToday(date) {
        let f = DateFormatter(); f.dateFormat = "HH:mm"; return f.string(from: date)
    }
    if cal.isDateInYesterday(date) { return "Yesterday" }
    let days = cal.dateComponents([.day], from: date, to: .now).day ?? 0
    if days < 7 { let f = DateFormatter(); f.dateFormat = "EEE"; return f.string(from: date) }
    let f = DateFormatter(); f.dateFormat = "dd.MM.yy"; return f.string(from: date)
}

// MARK: - Call History Model

struct CallRecord: Identifiable, Codable {
    var id: String = UUID().uuidString
    let name: String
    let callType: CallType
    let direction: CallDirection
    let missed: Bool
    let when: String
    let duration: String?
    var isOnline: Bool = false
    let chatId: String?

    enum CallType: String, Codable { case audio, video }
    enum CallDirection: String, Codable { case incoming, outgoing }
}
