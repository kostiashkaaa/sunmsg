import Foundation
@preconcurrency import CallKit
@preconcurrency import PushKit
import UIKit

@MainActor
final class NativeCallManager: NSObject, ObservableObject {
    static let shared = NativeCallManager()

    private let provider: CXProvider
    private let callController = CXCallController()
    private var pushRegistry: PKPushRegistry?
    private weak var session: SessionStore?
    private var voipToken: String?
    private var callByUUID: [UUID: IncomingCallData] = [:]
    private var uuidByCallId: [String: UUID] = [:]

    private override init() {
        let config = CXProviderConfiguration()
        config.localizedName = "SUN Messenger"
        config.supportsVideo = true
        config.maximumCallsPerCallGroup = 1
        config.maximumCallGroups = 1
        config.supportedHandleTypes = [.generic]
        provider = CXProvider(configuration: config)
        super.init()
        provider.setDelegate(self, queue: nil)
    }

    func configure() {
        guard Self.voipPushEnabled else { return }
        guard pushRegistry == nil else { return }
        let registry = PKPushRegistry(queue: .main)
        registry.delegate = self
        registry.desiredPushTypes = [.voIP]
        pushRegistry = registry
    }

    func bind(session: SessionStore) {
        self.session = session
        Task { await registerCurrentVoipTokenIfPossible() }
    }

    func registerCurrentVoipTokenIfPossible() async {
        guard let token = voipToken, !APIClient.shared.csrfToken.isEmpty else { return }
        try? await APIClient.shared.registerAPNsToken(
            token: token,
            pushType: "voip",
            environment: Self.apnsEnvironment,
            deviceId: UIDevice.current.identifierForVendor?.uuidString ?? ""
        )
    }

    func unregisterCurrentVoipToken() async {
        guard let token = voipToken, !APIClient.shared.csrfToken.isEmpty else { return }
        try? await APIClient.shared.unregisterAPNsToken(token: token, pushType: "voip")
    }

    func reportIncomingCall(_ call: IncomingCallData, fallbackToAppUI: ((IncomingCallData) -> Void)? = nil) {
        if let existingUUID = uuidByCallId[call.callId], callByUUID[existingUUID] != nil {
            return
        }
        let uuid = uuidByCallId[call.callId] ?? UUID()
        uuidByCallId[call.callId] = uuid
        callByUUID[uuid] = call

        let update = CXCallUpdate()
        update.localizedCallerName = call.callerName
        update.remoteHandle = CXHandle(type: .generic, value: call.callerName)
        update.hasVideo = call.callType == "video"
        update.supportsDTMF = false
        update.supportsHolding = false
        update.supportsGrouping = false
        update.supportsUngrouping = false

        provider.reportNewIncomingCall(with: uuid, update: update) { [weak self] error in
            guard error != nil else { return }
            Task { @MainActor in
                self?.removeCall(uuid: uuid)
                fallbackToAppUI?(call)
            }
        }
    }

    func markSystemCallConnected(callId: String) {
        guard uuidByCallId[callId] != nil else { return }
    }

    func pendingIncomingCall(callId: String) -> IncomingCallData? {
        guard let uuid = uuidByCallId[callId] else { return nil }
        return callByUUID[uuid]
    }

    func endSystemCall(callId: String, reason: CXCallEndedReason = .remoteEnded) {
        guard let uuid = uuidByCallId[callId] else { return }
        provider.reportCall(with: uuid, endedAt: Date(), reason: reason)
        removeCall(uuid: uuid)
    }

    private func handleIncomingPush(_ payload: [AnyHashable: Any], completion: @escaping () -> Void) {
        guard let call = Self.incomingCall(from: payload) else {
            completion()
            return
        }
        reportIncomingCall(call) { [weak self] fallback in
            self?.session?.incomingCall = fallback
        }
        completion()
    }

    private func handleAnswer(uuid: UUID, fulfill: @escaping () -> Void, fail: @escaping () -> Void) async {
        guard let call = callByUUID[uuid] else {
            fail()
            return
        }
        await prepareSessionForSystemCall()
        guard let session else {
            fail()
            return
        }
        session.acceptCall(callId: call.callId, incomingOverride: call)
        fulfill()
    }

    private func handleEnd(uuid: UUID, fulfill: @escaping () -> Void) {
        guard let call = callByUUID[uuid] else {
            fulfill()
            return
        }
        if session?.activeCall?.callId == call.callId {
            session?.endCall()
        } else {
            session?.rejectCall(callId: call.callId, incomingOverride: call)
        }
        removeCall(uuid: uuid)
        fulfill()
    }

    private func prepareSessionForSystemCall() async {
        guard let session else { return }
        if APIClient.shared.csrfToken.isEmpty {
            await session.loadBootstrap()
        } else {
            session.connectSocket()
        }
    }

    private func removeCall(uuid: UUID) {
        guard let call = callByUUID.removeValue(forKey: uuid) else { return }
        uuidByCallId.removeValue(forKey: call.callId)
    }

    private static var apnsEnvironment: String {
        #if DEBUG
        return "sandbox"
        #else
        return "production"
        #endif
    }

    private static var voipPushEnabled: Bool {
        if let enabled = Bundle.main.object(forInfoDictionaryKey: "SUN_ENABLE_VOIP_PUSH") as? Bool {
            return enabled
        }
        let raw = String(
            describing: Bundle.main.object(forInfoDictionaryKey: "SUN_ENABLE_VOIP_PUSH") ?? ""
        ).trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return raw == "1" || raw == "true" || raw == "yes"
    }

    private static func incomingCall(from payload: [AnyHashable: Any]) -> IncomingCallData? {
        let root = dictionary(payload["call"]) ?? dictionary(payload) ?? [:]
        guard
            let callId = string(root["call_id"]),
            let chatId = string(root["chat_id"])
        else { return nil }
        let caller = dictionary(root["caller"]) ?? [:]
        let displayName = string(caller["display_name"])
        let username = string(caller["username"])
        let name = displayName?.isEmpty == false ? displayName! : (username?.isEmpty == false ? username! : "SUN Messenger")
        return IncomingCallData(
            callId: callId,
            chatId: chatId,
            callType: string(root["call_type"]) == "video" ? "video" : "audio",
            callerName: name,
            callerAvatarUrl: string(caller["avatar_url"]),
            callerUserId: int(caller["user_id"]) ?? 0
        )
    }

    private static func dictionary(_ value: Any?) -> [String: Any]? {
        if let dict = value as? [String: Any] { return dict }
        if let dict = value as? [AnyHashable: Any] {
            var result: [String: Any] = [:]
            for (key, value) in dict {
                result[String(describing: key)] = value
            }
            return result
        }
        return nil
    }

    private static func string(_ value: Any?) -> String? {
        let text = String(describing: value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty ? nil : text
    }

    private static func int(_ value: Any?) -> Int? {
        if let n = value as? Int { return n }
        if let n = value as? NSNumber { return n.intValue }
        if let s = string(value) { return Int(s) }
        return nil
    }
}

extension NativeCallManager: CXProviderDelegate {
    nonisolated func providerDidReset(_ provider: CXProvider) {
        Task { @MainActor in
            self.callByUUID.removeAll()
            self.uuidByCallId.removeAll()
            self.session?.teardownActiveCall()
        }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXAnswerCallAction) {
        Task { @MainActor in
            await self.handleAnswer(
                uuid: action.callUUID,
                fulfill: { action.fulfill() },
                fail: { action.fail() }
            )
        }
    }

    nonisolated func provider(_ provider: CXProvider, perform action: CXEndCallAction) {
        Task { @MainActor in
            self.handleEnd(uuid: action.callUUID) {
                action.fulfill()
            }
        }
    }
}

extension NativeCallManager: PKPushRegistryDelegate {
    nonisolated func pushRegistry(
        _ registry: PKPushRegistry,
        didUpdate pushCredentials: PKPushCredentials,
        for type: PKPushType
    ) {
        guard type == .voIP else { return }
        let token = pushCredentials.token.map { String(format: "%02x", $0) }.joined()
        Task { @MainActor in
            self.voipToken = token
            await self.registerCurrentVoipTokenIfPossible()
        }
    }

    nonisolated func pushRegistry(_ registry: PKPushRegistry, didInvalidatePushTokenFor type: PKPushType) {
        guard type == .voIP else { return }
        Task { @MainActor in
            await self.unregisterCurrentVoipToken()
            self.voipToken = nil
        }
    }

    nonisolated func pushRegistry(
        _ registry: PKPushRegistry,
        didReceiveIncomingPushWith payload: PKPushPayload,
        for type: PKPushType,
        completion: @escaping () -> Void
    ) {
        guard type == .voIP else {
            completion()
            return
        }
        let dictionaryPayload = payload.dictionaryPayload
        Task { @MainActor in
            self.handleIncomingPush(dictionaryPayload, completion: completion)
        }
    }
}
