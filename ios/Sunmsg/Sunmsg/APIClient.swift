import Foundation

enum SunAppConfig {
    static var baseURLString: String {
        let fallback = "https://sun.445231.xyz"
        guard
            let raw = Bundle.main.object(forInfoDictionaryKey: "SUN_BASE_URL") as? String
        else { return fallback }
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard
            !value.isEmpty,
            !value.contains("$("),
            URL(string: value)?.scheme != nil
        else { return fallback }
        return value
    }
}

let kBaseURL = SunAppConfig.baseURLString

enum APIError: Error, LocalizedError {
    case unauthorized
    case decodingFailed(Error)
    case serverError(Int, String?)
    case networkError(Error)

    var errorDescription: String? {
        switch self {
        case .unauthorized: return "Session expired. Please log in again."
        case .decodingFailed(let e): return "Decode error: \(e.localizedDescription)"
        case .serverError(let code, let message):
            if let message, !message.isEmpty {
                return message
            }
            return "Server error \(code)"
        case .networkError(let e): return e.localizedDescription
        }
    }
}

private struct RefreshSessionResponse: Decodable {
    let success: Bool
    let csrfToken: String

    enum CodingKeys: String, CodingKey {
        case success
        case csrfToken = "csrf_token"
    }
}

final class APIClient: ObservableObject {
    static let shared = APIClient()

    let baseURL: URL
    var csrfToken: String = ""

    private let session: URLSession

    private init() {
        baseURL = URL(string: kBaseURL)!
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = HTTPCookieStorage.shared
        config.httpShouldSetCookies = true
        config.httpCookieAcceptPolicy = .always
        config.timeoutIntervalForRequest = 15
        config.timeoutIntervalForResource = 30
        session = URLSession(configuration: config)
    }

    // MARK: - Bootstrap

    func bootstrap() async throws -> BootstrapResponse {
        let url = baseURL.appendingPathComponent("/api/mobile/bootstrap")
        let req = URLRequest(url: url)
        let data = try await perform(req, expectedStatus: 200)
        let decoded = try decode(BootstrapResponse.self, from: data)
        csrfToken = decoded.csrfToken
        return decoded
    }

    // MARK: - Contacts

    func getContacts(limit: Int? = nil) async throws -> [Contact] {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/get_contacts"), resolvingAgainstBaseURL: false)!
        if let limit {
            comps.queryItems = [URLQueryItem(name: "limit", value: "\(limit)")]
        }
        let req = URLRequest(url: comps.url!)
        let data = try await perform(req, expectedStatus: 200)
        struct R: Decodable {
            let success: Bool
            let contacts: [Contact]

            enum CodingKeys: String, CodingKey { case success, contacts }

            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                success = (try? c.decodeIfPresent(Bool.self, forKey: .success)) ?? false
                contacts = (try? c.decodeIfPresent(LossyArray<Contact>.self, forKey: .contacts)?.elements) ?? []
            }
        }
        return try decode(R.self, from: data).contacts
    }

    // MARK: - Chat history

    func getChatHistory(chatId: String, limit: Int = 40, beforeId: Int? = nil, afterId: Int? = nil) async throws -> [ChatMessage] {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/get_chat_history"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = [
            URLQueryItem(name: "chat_id", value: chatId),
            URLQueryItem(name: "limit", value: "\(limit)"),
        ]
        if let bid = beforeId { items.append(URLQueryItem(name: "before_id", value: "\(bid)")) }
        if let aid = afterId  { items.append(URLQueryItem(name: "after_id",  value: "\(aid)")) }
        comps.queryItems = items
        let req = URLRequest(url: comps.url!)
        let data = try await perform(req, expectedStatus: 200)
        return try decode(ChatHistoryResponse.self, from: data).messages
    }

    func getSharedContentCandidates(chatId: String, limit: Int = 80, beforeId: Int? = nil) async throws -> SharedContentCandidatesResponse {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/api/chats/shared-content-candidates"), resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = [
            URLQueryItem(name: "chat_id", value: chatId),
            URLQueryItem(name: "type", value: "all"),
            URLQueryItem(name: "limit", value: "\(max(1, min(limit, 120)))"),
        ]
        if let beforeId {
            items.append(URLQueryItem(name: "before_id", value: "\(beforeId)"))
        }
        comps.queryItems = items
        let req = URLRequest(url: comps.url!)
        let data = try await perform(req, expectedStatus: 200)
        return try decode(SharedContentCandidatesResponse.self, from: data)
    }

    func getUpdatesState(chatId: String) async throws -> ChatUpdateState {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/updates/state"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "chat_id", value: chatId)]
        let data = try await perform(URLRequest(url: comps.url!), expectedStatus: 200)
        let object = try jsonObject(from: data)
        return ChatUpdateState(
            chatId: object["chat_id"] as? String ?? chatId,
            chatPts: SunJSON.int(object["chat_pts"]) ?? 0
        )
    }

    func getUpdatesDifference(chatId: String, fromPts: Int, limit: Int = 100) async throws -> ChatUpdateDifference {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/updates/difference"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "chat_id", value: chatId),
            URLQueryItem(name: "from_pts", value: "\(max(0, fromPts))"),
            URLQueryItem(name: "limit", value: "\(max(1, min(limit, 500)))"),
        ]
        let data = try await perform(URLRequest(url: comps.url!), expectedStatus: 200)
        let object = try jsonObject(from: data)
        let events = (object["events"] as? [[String: Any]] ?? []).compactMap { SocketReplayEvent(rawPayload: $0) }
        return ChatUpdateDifference(
            chatId: object["chat_id"] as? String ?? chatId,
            fromPts: SunJSON.int(object["from_pts"]) ?? max(0, fromPts),
            chatPts: SunJSON.int(object["chat_pts"]) ?? 0,
            events: events,
            hasMore: object["has_more"] as? Bool ?? false,
            nextFromPts: SunJSON.int(object["next_from_pts"]) ?? max(0, fromPts)
        )
    }

    // MARK: - Read receipts

    func markMessagesRead(chatId: String, messageIds: [Int]) async throws {
        let url = baseURL.appendingPathComponent("/mark_messages_read")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "chat_id": chatId,
            "message_ids": messageIds,
        ])
        _ = try await perform(req, expectedStatus: 200)
    }

    // MARK: - People / Search

    func searchUsers(query: String, limit: Int = 20) async throws -> [SearchUserResult] {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/search_users"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [
            URLQueryItem(name: "q", value: query),
            URLQueryItem(name: "limit", value: "\(limit)"),
        ]
        let req = URLRequest(url: comps.url!)
        let data = try await perform(req, expectedStatus: 200)
        return try decode(SearchUsersResponse.self, from: data).users
    }

    func startChat(username: String) async throws -> StartChatResponse {
        let url = baseURL.appendingPathComponent("/api/mobile/start_chat")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["username": username])
        let data = try await perform(req, expectedStatus: 200)
        return try decode(StartChatResponse.self, from: data)
    }

    func pinChat(chatId: String) async throws {
        let url = baseURL.appendingPathComponent("/pin_chat")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["chat_id": chatId])
        _ = try await perform(req, expectedStatus: 200)
    }

    func unpinChat(chatId: String) async throws {
        let url = baseURL.appendingPathComponent("/unpin_chat")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["chat_id": chatId])
        _ = try await perform(req, expectedStatus: 200)
    }

    func deleteChat(chatId: String, mode: String) async throws {
        let url = baseURL.appendingPathComponent("/delete_chat")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "chat_id": chatId,
            "mode": mode,
        ])
        _ = try await perform(req, expectedStatus: 200)
    }

    func leaveGroupChat(chatId: String) async throws {
        let url = baseURL.appendingPathComponent("/api/chats/group/leave")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["chat_id": chatId])
        _ = try await perform(req, expectedStatus: 200)
    }

    func getGroupInfo(chatId: String) async throws -> GroupProfileResponse {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/api/chats/group/info"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "chat_id", value: chatId)]
        let req = URLRequest(url: comps.url!)
        let data = try await perform(req, expectedStatus: 200)
        return try decode(GroupProfileResponse.self, from: data)
    }

    func createGroupChat(title: String, memberUserIds: [Int]) async throws -> GroupCreateResponse {
        let url = baseURL.appendingPathComponent("/api/chats/group/create")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "title": title,
            "member_user_ids": memberUserIds,
        ])
        let data = try await perform(req, expectedStatus: 201)
        return try decode(GroupCreateResponse.self, from: data)
    }

    // MARK: - Auth

    func getCsrfToken() async throws -> String {
        let url = baseURL.appendingPathComponent("/api/mobile/csrf")
        let data = try await perform(URLRequest(url: url), expectedStatus: 200, allowsRefresh: false)
        struct R: Decodable { let csrf_token: String }
        return try decode(R.self, from: data).csrf_token
    }

    func resetAuthSession() {
        csrfToken = ""
        KeychainService.deleteAllLocalSecrets()
        Task { await ChatLocalStore.shared.resetAll() }
        guard let cookies = HTTPCookieStorage.shared.cookies(for: baseURL) else { return }
        for cookie in cookies {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
    }

    func getChallenge(username: String) async throws -> ChallengeResponse {
        let url = baseURL.appendingPathComponent("/api/get_challenge")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["username": username])
        let data = try await perform(req, expectedStatus: 200, allowsRefresh: false)
        return try decode(ChallengeResponse.self, from: data)
    }

    func loginChallenge(signature: String) async throws -> LoginChallengeResponse {
        let url = baseURL.appendingPathComponent("/api/login_challenge")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["signature": signature])
        let data = try await perform(req, expectedStatus: 200, allowsRefresh: false)
        return try decode(LoginChallengeResponse.self, from: data)
    }

    func getRegisterChallenge() async throws -> String {
        let url = baseURL.appendingPathComponent("/api/get_register_challenge")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: [:])
        let data = try await perform(req, expectedStatus: 200, allowsRefresh: false)
        struct R: Decodable { let success: Bool; let challenge: String }
        return try decode(R.self, from: data).challenge
    }

    func registerClient(username: String, displayName: String, publicKeyPEM: String,
                        loginVault: String, challenge: String, signature: String) async throws {
        let url = baseURL.appendingPathComponent("/api/register_client")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "username": username,
            "display_name": displayName,
            "public_key": publicKeyPEM,
            "login_vault": loginVault,
            "register_challenge": challenge,
            "register_signature": signature,
        ])
        _ = try await perform(req, expectedStatus: 200, allowsRefresh: false)
    }

    func loginTOTP(code: String) async throws -> Bool {
        let url = baseURL.appendingPathComponent("/api/login_totp")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["totp_code": code])
        let data = try await perform(req, expectedStatus: 200, allowsRefresh: false)
        struct R: Decodable { let success: Bool }
        return try decode(R.self, from: data).success
    }

    func getTotpStatus() async throws -> TotpResponse {
        let url = baseURL.appendingPathComponent("/api/totp_status")
        let data = try await perform(URLRequest(url: url), expectedStatus: 200)
        return try decode(TotpResponse.self, from: data)
    }

    func manageTotp(action: String) async throws -> TotpResponse {
        let url = baseURL.appendingPathComponent("/api/totp_manage")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["action": action])
        let data = try await perform(req, expectedStatus: 200)
        return try decode(TotpResponse.self, from: data)
    }

    func verifyTotpSetup(code: String) async throws -> TotpResponse {
        let url = baseURL.appendingPathComponent("/api/totp_setup/verify")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["totp_code": code])
        let data = try await perform(req, expectedStatus: 200)
        return try decode(TotpResponse.self, from: data)
    }

    func regenerateTotpBackupCodes(code: String) async throws -> TotpResponse {
        let url = baseURL.appendingPathComponent("/api/totp_backup_codes/regenerate")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["totp_code": code])
        let data = try await perform(req, expectedStatus: 200)
        return try decode(TotpResponse.self, from: data)
    }

    @discardableResult
    func refreshSession() async throws -> String {
        let url = baseURL.appendingPathComponent("/api/refresh")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(baseURL.absoluteString, forHTTPHeaderField: "Origin")
        req.setValue(baseURL.absoluteString + "/", forHTTPHeaderField: "Referer")
        if !csrfToken.isEmpty {
            req.setValue(csrfToken, forHTTPHeaderField: "X-CSRFToken")
        }
        req.httpBody = Data("{}".utf8)

        let data: Data
        do {
            data = try await send(req, expectedStatus: 200)
        } catch let error as APIError {
            if shouldAttemptSessionRefresh(for: error) {
                csrfToken = ""
                throw APIError.unauthorized
            }
            throw error
        }
        let decoded = try decode(RefreshSessionResponse.self, from: data)
        guard decoded.success, !decoded.csrfToken.isEmpty else {
            throw APIError.unauthorized
        }
        csrfToken = decoded.csrfToken
        await MainActor.run {
            SocketClient.shared.updateCsrfToken(decoded.csrfToken)
        }
        return decoded.csrfToken
    }

    // MARK: - Send message

    func sendMessage(chatId: String, message: String, messageType: String = "text", requestId: String) async throws -> ChatMessage {
        let url = baseURL.appendingPathComponent("/api/mobile/send")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "chat_id": chatId,
            "message": message,
            "message_type": messageType,
            "request_id": requestId,
        ])
        let data = try await perform(req, expectedStatus: 200)
        struct R: Decodable { let success: Bool; let message: ChatMessage }
        return try decode(R.self, from: data).message
    }

    // MARK: - Media upload

    struct MediaUploadResult {
        let url: String
        let mime: String
        let mediaType: String
        let name: String
        let size: Int
    }

    func uploadMedia(data: Data, mimeType: String, chatId: String) async throws -> MediaUploadResult {
        let url = baseURL.appendingPathComponent("/upload_chat_media")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"

        let boundary = "SunBoundary\(UUID().uuidString.replacingOccurrences(of: "-", with: ""))"
        req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        req.setValue(csrfToken, forHTTPHeaderField: "X-CSRFToken")
        req.setValue(baseURL.absoluteString, forHTTPHeaderField: "Origin")
        req.setValue(baseURL.absoluteString + "/", forHTTPHeaderField: "Referer")

        let ext = mimeType.contains("jpeg") ? "jpg" : mimeType.components(separatedBy: "/").last ?? "bin"
        let filename = "media_\(Int(Date().timeIntervalSince1970)).\(ext)"

        var body = Data()
        // chat_id field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"chat_id\"\r\n\r\n".data(using: .utf8)!)
        body.append("\(chatId)\r\n".data(using: .utf8)!)
        // file field
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n".data(using: .utf8)!)
        body.append("Content-Type: \(mimeType)\r\n\r\n".data(using: .utf8)!)
        body.append(data)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        req.httpBody = body

        let responseData = try await perform(req, expectedStatus: 200)

        struct R: Decodable {
            let success: Bool
            let url: String
            let mime: String
            let mediaType: String
            let name: String
            let size: Int
            enum CodingKeys: String, CodingKey {
                case success, url, mime, name, size
                case mediaType = "media_type"
            }
        }
        let r = try decode(R.self, from: responseData)
        return MediaUploadResult(url: r.url, mime: r.mime, mediaType: r.mediaType, name: r.name, size: r.size)
    }

    // MARK: - Authenticated media fetching

    /// Fetch raw bytes from an authenticated media URL using the same session
    /// (and therefore the same cookie jar) as all other API calls.
    /// Returns `nil` if the response status is not 200.
    func fetchMedia(_ url: URL) async throws -> Data? {
        var req = URLRequest(url: url)
        req.timeoutInterval = 30
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            return nil
        }
        return data
    }

    // MARK: - Calls (ICE / TURN config)

    struct ICEConfig {
        /// Raw ICE server dicts: {urls: String|[String], username?, credential?}
        let iceServers: [[String: Any]]
        let iceTransportPolicy: String
    }

    /// Fetch short-lived TURN credentials + STUN servers from the server.
    /// Used to improve P2P connectivity (the server's TURN relay is far more
    /// reliable than public fallbacks). Safe to call best-effort.
    func getICEConfig(callId: String?) async throws -> ICEConfig {
        var comps = URLComponents(url: baseURL.appendingPathComponent("/call/ice-config"), resolvingAgainstBaseURL: false)!
        if let callId, !callId.isEmpty {
            comps.queryItems = [URLQueryItem(name: "call_id", value: callId)]
        }
        let req = URLRequest(url: comps.url!)
        let data = try await perform(req, expectedStatus: 200)
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw APIError.serverError(0, "Invalid ICE config")
        }
        let servers = obj["ice_servers"] as? [[String: Any]] ?? []
        let policy = obj["ice_transport_policy"] as? String ?? "all"
        return ICEConfig(iceServers: servers, iceTransportPolicy: policy)
    }

    // MARK: - Settings

    func getSettings() async throws -> AppSettings {
        let url = baseURL.appendingPathComponent("/api/get_settings")
        let data = try await perform(URLRequest(url: url), expectedStatus: 200)
        return try decode(AppSettings.self, from: data)
    }

    func saveSettings(_ payload: [String: Any]) async throws {
        let url = baseURL.appendingPathComponent("/api/save_settings")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        _ = try await perform(req, expectedStatus: 200)
    }

    // MARK: - Session devices

    func getSessionDevices() async throws -> SessionDevicesResponse {
        let url = baseURL.appendingPathComponent("/api/session_devices")
        let data = try await perform(URLRequest(url: url), expectedStatus: 200)
        return try decode(SessionDevicesResponse.self, from: data)
    }

    func revokeSessionDevice(familyId: String) async throws -> SessionDeviceRevokeResponse {
        let url = baseURL.appendingPathComponent("/api/session_devices/revoke")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["family_id": familyId])
        let data = try await perform(req, expectedStatus: 200)
        return try decode(SessionDeviceRevokeResponse.self, from: data)
    }

    func revokeOtherSessionDevices() async throws -> SessionDevicesRevokeOthersResponse {
        let url = baseURL.appendingPathComponent("/api/session_devices/revoke_others")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: [:])
        let data = try await perform(req, expectedStatus: 200)
        return try decode(SessionDevicesRevokeOthersResponse.self, from: data)
    }

    func updateSessionAutoLogoutSeconds(_ seconds: Int) async throws -> SessionAutoLogoutUpdateResponse {
        let url = baseURL.appendingPathComponent("/api/session_devices/auto_logout")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["session_auto_logout_seconds": seconds])
        let data = try await perform(req, expectedStatus: 200)
        return try decode(SessionAutoLogoutUpdateResponse.self, from: data)
    }

    // MARK: - Dialog requests

    func getDialogRequests() async throws -> [DialogRequest] {
        let url = baseURL.appendingPathComponent("/get_dialog_requests")
        let data = try await perform(URLRequest(url: url), expectedStatus: 200)
        return try decode(DialogRequestsResponse.self, from: data).dialogRequests
    }

    func acceptDialogRequest(senderPublicKey: String) async throws -> String? {
        let url = baseURL.appendingPathComponent("/accept_request")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["sender_public_key": senderPublicKey])
        let data = try await perform(req, expectedStatus: 200)
        struct R: Decodable { let success: Bool; let chatId: String?
            enum CodingKeys: String, CodingKey { case success; case chatId = "chat_id" } }
        return try decode(R.self, from: data).chatId
    }

    func acceptDialogRequest(_ request: DialogRequest) async throws -> String? {
        let url = baseURL.appendingPathComponent("/accept_request")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        let payload: [String: Any]
        if request.isGroupInvite {
            payload = [
                "request_kind": "group_invite",
                "request_id": request.requestId ?? 0,
            ]
        } else {
            payload = ["sender_public_key": request.senderPublicKey]
        }
        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        let data = try await perform(req, expectedStatus: 200)
        struct R: Decodable { let success: Bool; let chatId: String?
            enum CodingKeys: String, CodingKey { case success; case chatId = "chat_id" } }
        return try decode(R.self, from: data).chatId
    }

    func declineDialogRequest(senderPublicKey: String) async throws {
        let url = baseURL.appendingPathComponent("/decline_request")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["sender_public_key": senderPublicKey])
        _ = try await perform(req, expectedStatus: 200)
    }

    func declineDialogRequest(_ request: DialogRequest) async throws {
        let url = baseURL.appendingPathComponent("/decline_request")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        let payload: [String: Any]
        if request.isGroupInvite {
            payload = [
                "request_kind": "group_invite",
                "request_id": request.requestId ?? 0,
            ]
        } else {
            payload = ["sender_public_key": request.senderPublicKey]
        }
        req.httpBody = try? JSONSerialization.data(withJSONObject: payload)
        _ = try await perform(req, expectedStatus: 200)
    }

    // MARK: - Blocking

    func blockUser(userId: Int) async throws {
        let url = baseURL.appendingPathComponent("/block_user")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["blocked_user_id": userId])
        _ = try await perform(req, expectedStatus: 200)
    }

    func unblockUser(userId: Int) async throws {
        let url = baseURL.appendingPathComponent("/unblock_user")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["blocked_user_id": userId])
        _ = try await perform(req, expectedStatus: 200)
    }

    func getBlockedUsers() async throws -> [BlockedUser] {
        let url = baseURL.appendingPathComponent("/get_blocked_users")
        let data = try await perform(URLRequest(url: url), expectedStatus: 200)
        struct R: Decodable {
            let blockedUsers: [BlockedUser]
            enum CodingKeys: String, CodingKey { case blockedUsers = "blocked_users" }
            init(from decoder: Decoder) throws {
                let c = try decoder.container(keyedBy: CodingKeys.self)
                blockedUsers = (try? c.decodeIfPresent(LossyArray<BlockedUser>.self, forKey: .blockedUsers)?.elements) ?? []
            }
        }
        return try decode(R.self, from: data).blockedUsers
    }

    // MARK: - v3 Crypto: DR sessions

    func getDRSession(chatId: String) async throws -> String? {
        let url = baseURL.appendingPathComponent("/api/crypto/dr-session/\(chatId)")
        let data = try await perform(URLRequest(url: url), expectedStatus: 200)
        struct R: Decodable { let session: String?; let session_state: String? }
        let r = try decode(R.self, from: data)
        return r.session ?? r.session_state
    }

    func saveDRSession(chatId: String, peerUserId: Int, stateJSON: String) async throws {
        let url = baseURL.appendingPathComponent("/api/crypto/dr-session/\(chatId)")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "session_state": stateJSON,
            "peer_user_id": peerUserId,
        ])
        _ = try await perform(req, expectedStatus: 200)
    }

    // MARK: - v3 Crypto: identity key registration

    func registerV3Keys(x25519Pub: String, ed25519Pub: String, challenge: String, signature: String) async throws {
        let url = baseURL.appendingPathComponent("/api/crypto/keys")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "x25519_public_key": x25519Pub,
            "ed25519_public_key": ed25519Pub,
            "challenge": challenge,
            "signature": signature,
        ])
        _ = try await perform(req, expectedStatus: 200)
    }

    func uploadSignedPrekey(id: Int, publicKey: String, signature: String) async throws {
        let url = baseURL.appendingPathComponent("/api/crypto/prekeys/signed")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: [
            "prekey_id": id,
            "public_key": publicKey,
            "signature": signature,
        ])
        _ = try await perform(req, expectedStatus: 200)
    }

    // MARK: - Logout

    func logout() async throws {
        let url = baseURL.appendingPathComponent("/api/logout")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: [:])
        _ = try? await session.data(for: req)
        csrfToken = ""
    }

    // MARK: - Helpers

    private func applyJSONPostHeaders(to request: inout URLRequest, csrfToken: String) {
        request.setValue(csrfToken, forHTTPHeaderField: "X-CSRFToken")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(baseURL.absoluteString, forHTTPHeaderField: "Origin")
        request.setValue(baseURL.absoluteString + "/", forHTTPHeaderField: "Referer")
    }

    func absoluteURL(from path: String?) -> URL? {
        let value = (path ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return nil }
        if let url = URL(string: value), url.scheme != nil {
            return url
        }
        return URL(string: value, relativeTo: baseURL)?.absoluteURL
    }

    private func perform(_ request: URLRequest, expectedStatus: Int, allowsRefresh: Bool = true) async throws -> Data {
        var req = request
        if req.httpMethod == nil { req.httpMethod = "GET" }
        do {
            do {
                return try await send(req, expectedStatus: expectedStatus)
            } catch let error as APIError {
                guard allowsRefresh, shouldAttemptSessionRefresh(for: error) else {
                    throw error
                }
                try await refreshSession()
                return try await send(requestByApplyingCurrentCsrf(to: req), expectedStatus: expectedStatus)
            }
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.networkError(error)
        }
    }

    private func send(_ request: URLRequest, expectedStatus: Int) async throws -> Data {
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.serverError(0, nil) }
        if http.statusCode == 401 {
            if let message = serverErrorMessage(from: data), !message.isEmpty {
                throw APIError.serverError(http.statusCode, message)
            }
            throw APIError.unauthorized
        }
        if http.statusCode != expectedStatus {
            throw APIError.serverError(http.statusCode, serverErrorMessage(from: data))
        }
        return data
    }

    private func shouldAttemptSessionRefresh(for error: APIError) -> Bool {
        switch error {
        case .unauthorized:
            return true
        case .serverError(let code, let message):
            if code == 401 { return true }
            if code == 400, (message ?? "").localizedCaseInsensitiveContains("csrf") {
                return true
            }
            return false
        case .decodingFailed, .networkError:
            return false
        }
    }

    private func requestByApplyingCurrentCsrf(to request: URLRequest) -> URLRequest {
        var req = request
        if req.value(forHTTPHeaderField: "X-CSRFToken") != nil {
            req.setValue(csrfToken, forHTTPHeaderField: "X-CSRFToken")
        }
        return req
    }

    private func serverErrorMessage(from data: Data) -> String? {
        if
            let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let message = object["error"] as? String,
            !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        {
            return message
        }

        guard let text = String(data: data, encoding: .utf8) else { return nil }
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return nil }
        if trimmed.localizedCaseInsensitiveContains("csrf") {
            return "CSRF/session token mismatch. Please try again."
        }
        return trimmed.count > 180 ? String(trimmed.prefix(180)) : trimmed
    }

    private func jsonObject(from data: Data) throws -> [String: Any] {
        guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw APIError.decodingFailed(NSError(domain: "SUNmessenger.APIClient", code: 0))
        }
        return object
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw APIError.decodingFailed(error)
        }
    }
}
