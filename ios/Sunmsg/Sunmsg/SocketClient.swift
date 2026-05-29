import Foundation

// MARK: - Notification names

extension Notification.Name {
    /// Fired when a Socket.IO event is received. UserInfo keys: SocketEventKey.*
    static let smSocketMessage       = Notification.Name("smSocketMessage")
    /// Fired after SessionStore has normalized and gap-checked an incoming message.
    static let smPreparedIncomingMessage = Notification.Name("smPreparedIncomingMessage")
    /// Fired when connection state changes (no extra payload — read SocketClient.shared.state).
    static let smSocketStateChanged  = Notification.Name("smSocketStateChanged")
}

struct SocketEventKey {
    static let eventName = "event"   // String
    static let data      = "data"    // Any? (dict, array, etc.)
    static let replay    = "replay"  // Bool
}

struct PreparedIncomingMessageKey {
    static let chatId  = "chat_id"  // String
    static let message = "message"  // ChatMessage
}

// MARK: - SocketClient
//
// Lightweight Socket.IO v4 (Engine.IO v4) client built on top of
// URLSessionWebSocketTask. No external dependencies.
//
// Protocol summary:
//   WebSocket frame format: "<EIO_type>[<SIO_type><json>]"
//
//   EIO types (Engine.IO v4):
//     0 OPEN   — server sends after upgrade, contains sid + timing config
//     1 CLOSE
//     2 PING   — server-initiated; we reply with 3 PONG
//     3 PONG
//     4 MESSAGE — wraps a Socket.IO packet
//     6 NOOP
//
//   SIO types (Socket.IO v5, inside EIO MESSAGE "4"):
//     0 CONNECT      — sent by client to join namespace; server echoes to confirm
//     1 DISCONNECT
//     2 EVENT        — e.g. 42["receive_message",{…}]
//     3 ACK
//     4 ERROR        — server rejected our connect (e.g. bad CSRF)
//
// Connect sequence:
//   Client: opens WS to /socket.io/?EIO=4&transport=websocket
//   Server: "0{…}"                                   (EIO OPEN)
//   Client: "40{"auth":{"csrf_token":"…"}}"           (SIO CONNECT with auth)
//   Server: "40{"sid":"…"}"                           (SIO CONNECT confirmed)
//   Server: "42["receive_message",{…}]"               (SIO EVENT)
//   Server: "2"                                       (EIO PING every ~25 s)
//   Client: "3"                                       (EIO PONG)

@MainActor
final class SocketClient: NSObject, @unchecked Sendable {

    static let shared = SocketClient()

    private struct QueuedEmit {
        let event: String
        let data: [String: Any]
    }

    // MARK: - State

    enum State: Equatable { case disconnected, connecting, connected }

    private(set) var state: State = .disconnected {
        didSet {
            guard state != oldValue else { return }
            NotificationCenter.default.post(name: .smSocketStateChanged, object: nil)
        }
    }

    // MARK: - Private

    private var csrfToken: String = ""
    private var reconnectAttempts = 0
    private let maxReconnectDelay: TimeInterval = 32  // 2^5

    private var webSocketTask: URLSessionWebSocketTask?
    private var pingTask: Task<Void, Never>?
    private var reconnectTask: Task<Void, Never>?
    private var queuedEmits: [QueuedEmit] = []
    private let maxQueuedEmits = 100
    private let volatileEvents: Set<String> = [
        "typing",
        "stop_typing",
        "activity_update",
        "call_sync",
        "call_media_state",
        "call_ice_candidate",
    ]

    // Shared URLSession so the socket uses the same cookie jar as APIClient.
    private lazy var urlSession: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.httpCookieStorage    = HTTPCookieStorage.shared
        cfg.httpShouldSetCookies = true
        cfg.httpCookieAcceptPolicy = .always
        return URLSession(configuration: cfg, delegate: nil, delegateQueue: nil)
    }()

    // MARK: - Public API

    func connect(csrfToken: String) {
        self.csrfToken = csrfToken
        guard state == .disconnected else { return }
        state = .connecting
        openSocket()
    }

    func updateCsrfToken(_ csrfToken: String) {
        self.csrfToken = csrfToken
    }

    func disconnect() {
        reconnectTask?.cancel()
        reconnectTask = nil
        reconnectAttempts = 0
        queuedEmits.removeAll()
        closeSocket(reconnect: false)
    }

    // MARK: - Open / Close

    private func openSocket() {
        let wsBase = kBaseURL
            .replacingOccurrences(of: "https://", with: "wss://")
            .replacingOccurrences(of: "http://",  with: "ws://")

        guard let url = URL(string: "\(wsBase)/socket.io/?EIO=4&transport=websocket") else {
            state = .disconnected
            scheduleReconnect()
            return
        }

        var req = URLRequest(url: url)
        req.timeoutInterval = 20
        req.setValue("permessage-deflate; client_max_window_bits", forHTTPHeaderField: "Sec-WebSocket-Extensions")

        webSocketTask = urlSession.webSocketTask(with: req)
        webSocketTask?.resume()
        scheduleReceive()
    }

    private func closeSocket(reconnect: Bool) {
        pingTask?.cancel()
        pingTask = nil
        webSocketTask?.cancel(with: .normalClosure, reason: nil)
        webSocketTask = nil
        state = .disconnected
        if reconnect { scheduleReconnect() }
    }

    // MARK: - Reconnect with exponential back-off

    private func scheduleReconnect() {
        reconnectTask?.cancel()
        let delay = min(pow(2.0, Double(reconnectAttempts)), maxReconnectDelay)
        reconnectAttempts = min(reconnectAttempts + 1, 6)

        reconnectTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(delay * 1_000_000_000))
            guard !Task.isCancelled else { return }
            await MainActor.run { [weak self] in
                guard let self, self.state == .disconnected else { return }
                self.state = .connecting
                self.openSocket()
            }
        }
    }

    // MARK: - Receive loop

    private func scheduleReceive() {
        webSocketTask?.receive { [weak self] result in
            switch result {
            case .success(let msg):
                Task { @MainActor [weak self] in
                    self?.handle(msg)
                    self?.scheduleReceive()
                }
            case .failure:
                Task { @MainActor [weak self] in
                    self?.closeSocket(reconnect: true)
                }
            }
        }
    }

    // MARK: - Packet dispatch

    private func handle(_ msg: URLSessionWebSocketTask.Message) {
        guard case .string(let text) = msg, let first = text.first else { return }

        switch first {
        case "0":
            // EIO OPEN → send SIO CONNECT with auth
            sendSIOConnect()

        case "2":
            // EIO PING from server → reply with EIO PONG
            sendRaw("3")

        case "4":
            // EIO MESSAGE → contains SIO packet
            handleSIOPacket(String(text.dropFirst()))

        default:
            break
        }
    }

    // MARK: - SIO CONNECT

    private func sendSIOConnect() {
        let auth: [String: Any] = ["csrf_token": csrfToken]
        if let json = try? JSONSerialization.data(withJSONObject: auth),
           let jsonStr = String(data: json, encoding: .utf8) {
            sendRaw("40\(jsonStr)")
        } else {
            sendRaw("40")
        }
    }

    // MARK: - SIO packet handling

    private func handleSIOPacket(_ text: String) {
        guard let sioType = text.first else { return }
        let body = String(text.dropFirst())

        switch sioType {
        case "0":
            // SIO CONNECT confirmed
            reconnectAttempts = 0
            state = .connected
            startPingTask()
            flushQueuedEmits()

        case "1":
            // SIO DISCONNECT
            closeSocket(reconnect: true)

        case "2":
            // SIO EVENT
            dispatchEvent(body)

        case "4":
            // SIO ERROR (e.g. CSRF rejected, auth expired)
            // Don't auto-reconnect here — session is likely invalid.
            closeSocket(reconnect: false)

        default:
            break
        }
    }

    // MARK: - Event dispatch

    private func dispatchEvent(_ payload: String) {
        // Payload format: ["event_name", data]
        // Optionally prefixed by ack id (digits) before "["
        let trimmed: String
        if let bracket = payload.firstIndex(of: "[") {
            trimmed = String(payload[bracket...])
        } else {
            trimmed = payload
        }

        guard let raw = trimmed.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: raw) as? [Any],
              let eventName = arr.first as? String else { return }

        let eventData = arr.count > 1 ? arr[1] : nil

        NotificationCenter.default.post(
            name: .smSocketMessage,
            object: nil,
            userInfo: [
                SocketEventKey.eventName: eventName,
                SocketEventKey.data: eventData as Any
            ]
        )
    }

    // MARK: - Public emit (send a Socket.IO event to the server)
    //
    // Format: 42["event_name",{data}]
    //   4 = EIO MESSAGE, 2 = SIO EVENT

    func emit(_ event: String, _ data: [String: Any] = [:]) {
        var payload = data
        if payload["csrf_token"] == nil {
            payload["csrf_token"] = csrfToken
        }
        guard state == .connected else {
            queueEmit(event, payload)
            if state == .disconnected { scheduleReconnect() }
            return
        }
        sendEvent(event, payload)
    }

    private func sendEvent(_ event: String, _ payload: [String: Any]) {
        guard let jsonData = try? JSONSerialization.data(withJSONObject: payload),
              let jsonStr  = String(data: jsonData, encoding: .utf8) else { return }
        sendRaw("42[\"\(event)\",\(jsonStr)]")
    }

    private func queueEmit(_ event: String, _ payload: [String: Any]) {
        guard !volatileEvents.contains(event) else { return }
        queuedEmits.append(QueuedEmit(event: event, data: payload))
        if queuedEmits.count > maxQueuedEmits {
            queuedEmits.removeFirst(queuedEmits.count - maxQueuedEmits)
        }
    }

    private func flushQueuedEmits() {
        guard state == .connected, !queuedEmits.isEmpty else { return }
        let pending = queuedEmits
        queuedEmits.removeAll()
        for item in pending {
            sendEvent(item.event, item.data)
        }
    }

    // MARK: - Private send

    private func sendRaw(_ text: String) {
        webSocketTask?.send(.string(text)) { _ in }
    }

    // MARK: - Client-side ping task
    //
    // The server sends its own pings every ~25 s (we reply with "3").
    // This task additionally sends a native WebSocket ping to detect
    // silent TCP drops that Engine.IO wouldn't catch in time.

    private func startPingTask() {
        pingTask?.cancel()
        pingTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 20_000_000_000)
                guard !Task.isCancelled else { return }
                let didPing = await MainActor.run { () -> Bool in
                    guard let self, self.state == .connected, let webSocketTask = self.webSocketTask else { return false }
                    webSocketTask.sendPing { [weak self] error in
                        guard error != nil else { return }
                        Task { @MainActor [weak self] in
                            guard let self, self.state == .connected else { return }
                            self.closeSocket(reconnect: true)
                        }
                    }
                    return true
                }
                guard didPing else { return }
            }
        }
    }
}
