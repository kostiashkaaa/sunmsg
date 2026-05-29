import Foundation

// Change this to your server address before running.
// Simulator:   "http://127.0.0.1:5001"  ← use this, NOT "localhost" (IPv6 vs IPv4 issue)
// Real device: use your Mac's local IP (e.g. "http://192.168.1.x:5001")
// Production:  "https://your-domain.com"
let kBaseURL = "https://sun.445231.xyz"

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
        _ = try? await session.data(for: req)
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

    // MARK: - Auth

    func getCsrfToken() async throws -> String {
        let url = baseURL.appendingPathComponent("/api/mobile/csrf")
        let data = try await perform(URLRequest(url: url), expectedStatus: 200)
        struct R: Decodable { let csrf_token: String }
        return try decode(R.self, from: data).csrf_token
    }

    func resetAuthSession() {
        csrfToken = ""
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
        let data = try await perform(req, expectedStatus: 200)
        return try decode(ChallengeResponse.self, from: data)
    }

    func loginChallenge(signature: String) async throws -> LoginChallengeResponse {
        let url = baseURL.appendingPathComponent("/api/login_challenge")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["signature": signature])
        let data = try await perform(req, expectedStatus: 200)
        return try decode(LoginChallengeResponse.self, from: data)
    }

    func getRegisterChallenge() async throws -> String {
        let url = baseURL.appendingPathComponent("/api/get_register_challenge")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: [:])
        let data = try await perform(req, expectedStatus: 200)
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
        _ = try await perform(req, expectedStatus: 200)
    }

    func loginTOTP(code: String) async throws -> Bool {
        let url = baseURL.appendingPathComponent("/api/login_totp")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["totp_code": code])
        let data = try await perform(req, expectedStatus: 200)
        struct R: Decodable { let success: Bool }
        return try decode(R.self, from: data).success
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

    func declineDialogRequest(senderPublicKey: String) async throws {
        let url = baseURL.appendingPathComponent("/decline_request")
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        applyJSONPostHeaders(to: &req, csrfToken: csrfToken)
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["sender_public_key": senderPublicKey])
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

    private func perform(_ request: URLRequest, expectedStatus: Int) async throws -> Data {
        var req = request
        if req.httpMethod == nil { req.httpMethod = "GET" }
        do {
            let (data, response) = try await session.data(for: req)
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
        } catch let error as APIError {
            throw error
        } catch {
            throw APIError.networkError(error)
        }
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

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw APIError.decodingFailed(error)
        }
    }
}
