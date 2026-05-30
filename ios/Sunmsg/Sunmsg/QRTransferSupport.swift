import CoreImage
import CryptoKit
import Foundation
import Security
import SwiftUI
import UIKit

// MARK: - QR image

private let smQRCodeCIContext = CIContext()

func generateQRCodeImage(from string: String) -> UIImage? {
    let data = Data(string.utf8)
    guard let filter = CIFilter(name: "CIQRCodeGenerator") else { return nil }
    filter.setValue(data, forKey: "inputMessage")
    filter.setValue("M", forKey: "inputCorrectionLevel")
    guard let output = filter.outputImage else { return nil }
    let scaled = output.transformed(by: CGAffineTransform(scaleX: 10, y: 10))
    guard let cgImage = smQRCodeCIContext.createCGImage(scaled, from: scaled.extent) else { return nil }
    return UIImage(cgImage: cgImage)
}

// MARK: - Transfer models

enum QRTransferKind: String {
    case login
    case device
    case profile
    case unknown
}

struct QRTransferCode {
    let kind: QRTransferKind
    let sessionId: String
    let username: String

    static func parse(_ rawValue: String) -> QRTransferCode {
        let text = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else {
            return QRTransferCode(kind: .unknown, sessionId: "", username: "")
        }

        if let sessionId = firstCapture(in: text, pattern: "(?:sun-key-login|skl):([A-Za-z0-9_-]{16,128})") {
            return QRTransferCode(kind: .login, sessionId: sessionId, username: "")
        }
        if let sessionId = firstCapture(in: text, pattern: "sun-key-transfer:([A-Za-z0-9_-]{16,128})") {
            return QRTransferCode(kind: .device, sessionId: sessionId, username: "")
        }
        if let username = firstCapture(in: text, pattern: "(?:sun-user|su):([a-z0-9_]{1,50})") {
            return QRTransferCode(kind: .profile, sessionId: "", username: username.lowercased())
        }
        if let username = firstCapture(in: text, pattern: "^@([a-z0-9_]{1,50})$") {
            return QRTransferCode(kind: .profile, sessionId: "", username: username.lowercased())
        }
        if let url = URL(string: text),
           let username = firstCapture(in: url.path, pattern: "(?:^|/)u/([a-z0-9_]{1,50})/?$") {
            return QRTransferCode(kind: .profile, sessionId: "", username: username.lowercased())
        }
        if let url = URL(string: text),
           let components = URLComponents(url: url, resolvingAgainstBaseURL: false) {
            if let sessionId = components.queryItems?.first(where: { $0.name == "kt" })?.value,
               isSessionId(sessionId) {
                return QRTransferCode(kind: .device, sessionId: sessionId, username: "")
            }
            let hash = (components.fragment ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if let sessionId = firstCapture(in: hash, pattern: "kt=([A-Za-z0-9_-]{16,128})") {
                return QRTransferCode(kind: .device, sessionId: sessionId, username: "")
            }
        }
        if firstCapture(in: text, pattern: "^([A-Za-z0-9_-]{16,128})$") != nil {
            return QRTransferCode(kind: .device, sessionId: text, username: "")
        }
        return QRTransferCode(kind: .unknown, sessionId: "", username: "")
    }

    private static func isSessionId(_ value: String) -> Bool {
        firstCapture(in: value, pattern: "^([A-Za-z0-9_-]{16,128})$") != nil
    }

    private static func firstCapture(in text: String, pattern: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else { return nil }
        let range = NSRange(text.startIndex..<text.endIndex, in: text)
        guard let match = regex.firstMatch(in: text, range: range),
              match.numberOfRanges > 1,
              let captureRange = Range(match.range(at: 1), in: text)
        else { return nil }
        return String(text[captureRange])
    }
}

struct KeyTransferJWK: Codable, Sendable {
    let kty: String
    let crv: String
    let x: String
    let y: String

    var jsonObject: [String: Any] {
        ["kty": kty, "crv": crv, "x": x, "y": y]
    }
}

struct KeyTransferLoginSessionResponse: Decodable {
    let success: Bool
    let sessionId: String
    let qrText: String
    let expiresInSeconds: Int

    enum CodingKeys: String, CodingKey {
        case success
        case sessionId = "session_id"
        case qrText = "qr_text"
        case expiresInSeconds = "expires_in_seconds"
    }
}

struct KeyTransferSessionDetailsResponse: Decodable {
    let success: Bool
    let state: String
    let receiverPublicJwk: KeyTransferJWK?

    enum CodingKeys: String, CodingKey {
        case success, state
        case receiverPublicJwk = "receiver_public_jwk"
    }
}

struct KeyTransferLoginClaimResponse: Decodable {
    let success: Bool
    let state: String
    let username: String?
    let displayName: String?
    let avatarUrl: String?
    let senderPublicJwk: KeyTransferJWK?
    let cipherText: String?
    let iv: String?

    enum CodingKeys: String, CodingKey {
        case success, state, username, iv
        case displayName = "display_name"
        case avatarUrl = "avatar_url"
        case senderPublicJwk = "sender_public_jwk"
        case cipherText = "cipher_text"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        success = (try? c.decodeIfPresent(Bool.self, forKey: .success)) ?? false
        state = (try? c.decodeIfPresent(String.self, forKey: .state)) ?? "pending"
        username = try? c.decodeIfPresent(String.self, forKey: .username)
        displayName = try? c.decodeIfPresent(String.self, forKey: .displayName)
        avatarUrl = try? c.decodeIfPresent(String.self, forKey: .avatarUrl)
        senderPublicJwk = try? c.decodeIfPresent(KeyTransferJWK.self, forKey: .senderPublicJwk)
        cipherText = try? c.decodeIfPresent(String.self, forKey: .cipherText)
        iv = try? c.decodeIfPresent(String.self, forKey: .iv)
    }
}

// MARK: - Transfer crypto

enum QRTransferCryptoError: LocalizedError {
    case invalidJWK
    case invalidCiphertext
    case missingLocalPrivateKey
    case invalidLocalPrivateKey
    case invalidPrivateKeyPayload
    case randomFailed

    var errorDescription: String? {
        switch self {
        case .invalidJWK:
            return "Некорректный ключ QR-сессии."
        case .invalidCiphertext:
            return "Поврежденные данные QR-сессии."
        case .missingLocalPrivateKey:
            return "На этом устройстве не загружен ключ. Разблокируйте историю 24-словной фразой и повторите QR-вход."
        case .invalidLocalPrivateKey:
            return "Локальный ключ поврежден. Разблокируйте историю заново 24-словной фразой."
        case .invalidPrivateKeyPayload:
            return "QR-сессия вернула ключ в неверном формате."
        case .randomFailed:
            return "Не удалось создать безопасный IV."
        }
    }
}

struct QRTransferEncryptedPayload: Sendable {
    let cipherText: String
    let iv: String
}

enum QRTransferCrypto {
    private static let salt = Data("sun-key-transfer-v1".utf8)

    static func makePublicJWK(from publicKey: P256.KeyAgreement.PublicKey) throws -> KeyTransferJWK {
        let raw = publicKey.x963Representation
        guard raw.count == 65, raw.first == 0x04 else { throw QRTransferCryptoError.invalidJWK }
        let x = Data(raw[1..<33]).base64URLEncodedString()
        let y = Data(raw[33..<65]).base64URLEncodedString()
        return KeyTransferJWK(kty: "EC", crv: "P-256", x: x, y: y)
    }

    static func publicKey(from jwk: KeyTransferJWK) throws -> P256.KeyAgreement.PublicKey {
        guard jwk.kty == "EC", jwk.crv == "P-256",
              let x = Data(base64URLEncoded: jwk.x),
              let y = Data(base64URLEncoded: jwk.y),
              x.count == 32,
              y.count == 32
        else { throw QRTransferCryptoError.invalidJWK }
        return try P256.KeyAgreement.PublicKey(x963Representation: Data([0x04]) + x + y)
    }

    static func deriveKey(
        privateKey: P256.KeyAgreement.PrivateKey,
        peerPublicJwk: KeyTransferJWK,
        sessionId: String
    ) throws -> SymmetricKey {
        let publicKey = try publicKey(from: peerPublicJwk)
        let sharedSecret = try privateKey.sharedSecretFromKeyAgreement(with: publicKey)
        return sharedSecret.hkdfDerivedSymmetricKey(
            using: SHA256.self,
            salt: salt,
            sharedInfo: Data("sun-key-transfer-v1:\(sessionId)".utf8),
            outputByteCount: 32
        )
    }

    static func encryptPrivateKeyPem(_ privateKeyPem: String, using key: SymmetricKey) throws -> QRTransferEncryptedPayload {
        let iv = try randomBytes(count: 12)
        let sealed = try AES.GCM.seal(Data(privateKeyPem.utf8), using: key, nonce: AES.GCM.Nonce(data: iv))
        let cipherAll = sealed.ciphertext + sealed.tag
        return QRTransferEncryptedPayload(
            cipherText: cipherAll.base64URLEncodedString(),
            iv: iv.base64URLEncodedString()
        )
    }

    static func decryptPrivateKeyPem(cipherText: String, iv: String, using key: SymmetricKey) throws -> String {
        guard let cipherAll = Data(base64URLEncoded: cipherText),
              let ivData = Data(base64URLEncoded: iv),
              cipherAll.count > 16
        else { throw QRTransferCryptoError.invalidCiphertext }
        let ciphertext = Data(cipherAll.prefix(cipherAll.count - 16))
        let tag = Data(cipherAll.suffix(16))
        let sealed = try AES.GCM.SealedBox(nonce: AES.GCM.Nonce(data: ivData), ciphertext: ciphertext, tag: tag)
        let plaintext = try AES.GCM.open(sealed, using: key)
        guard let pem = String(data: plaintext, encoding: .utf8) else {
            throw QRTransferCryptoError.invalidPrivateKeyPayload
        }
        return try validatedPrivateKeyPem(pem, error: .invalidPrivateKeyPayload)
    }

    static func validatedPrivateKeyPem(_ privateKeyPem: String, error mappedError: QRTransferCryptoError) throws -> String {
        let trimmed = privateKeyPem.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw mappedError }
        do {
            _ = try SunCrypto.importPrivateKey(trimmed)
            return trimmed
        } catch {
            throw mappedError
        }
    }

    private static func randomBytes(count: Int) throws -> Data {
        var bytes = [UInt8](repeating: 0, count: count)
        let status = bytes.withUnsafeMutableBytes { buffer in
            SecRandomCopyBytes(kSecRandomDefault, count, buffer.baseAddress!)
        }
        guard status == errSecSuccess else { throw QRTransferCryptoError.randomFailed }
        return Data(bytes)
    }
}

enum QRTransferService {
    static func submitLocalPrivateKey(for code: QRTransferCode, api: APIClient = .shared) async throws {
        guard code.kind == .login || code.kind == .device else { throw QRTransferCryptoError.invalidCiphertext }
        let privateKeyPem = await Task.detached(priority: .userInitiated) {
            KeychainService.loadPrivateKey()
        }.value
        guard let privateKeyPem else {
            throw QRTransferCryptoError.missingLocalPrivateKey
        }
        let validatedPrivateKeyPem = try await Task.detached(priority: .userInitiated) {
            try QRTransferCrypto.validatedPrivateKeyPem(privateKeyPem, error: .invalidLocalPrivateKey)
        }.value
        if api.csrfToken.isEmpty {
            api.csrfToken = try await api.getCsrfToken()
        }

        let sessionId = code.sessionId
        let details = try await api.getKeyTransferSessionDetails(sessionId: sessionId, kind: code.kind)
        guard details.success, let receiverPublicJwk = details.receiverPublicJwk else { throw QRTransferCryptoError.invalidJWK }

        let (senderPublicJwk, encrypted) = try await Task.detached(priority: .userInitiated) {
            let senderPrivateKey = P256.KeyAgreement.PrivateKey()
            let senderPublicJwk = try QRTransferCrypto.makePublicJWK(from: senderPrivateKey.publicKey)
            let aesKey = try QRTransferCrypto.deriveKey(
                privateKey: senderPrivateKey,
                peerPublicJwk: receiverPublicJwk,
                sessionId: sessionId
            )
            let encrypted = try QRTransferCrypto.encryptPrivateKeyPem(validatedPrivateKeyPem, using: aesKey)
            return (senderPublicJwk, encrypted)
        }.value
        try await api.submitKeyTransferSession(
            sessionId: sessionId,
            kind: code.kind,
            senderPublicJwk: senderPublicJwk,
            cipherText: encrypted.cipherText,
            iv: encrypted.iv
        )
    }
}

private extension Data {
    init?(base64URLEncoded value: String) {
        var base64 = value
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        let padding = (4 - (base64.count % 4)) % 4
        if padding > 0 {
            base64 += String(repeating: "=", count: padding)
        }
        self.init(base64Encoded: base64)
    }

    func base64URLEncodedString() -> String {
        base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}

// MARK: - QR login panel

struct QRLoginPanel: View {
    let onPrivateKeyReceived: (String, String) async throws -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var qrImage: UIImage?
    @State private var statusText = "Готовим QR..."
    @State private var errorText: String?
    @State private var pollTask: Task<Void, Never>?
    @State private var pollSessionId: String?
    @State private var sessionRequestToken: UUID?
    @State private var isPreparing = false
    @State private var isWaiting = false
    @State private var isCompleting = false

    var body: some View {
        VStack(spacing: 14) {
            HStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color.smAccent.opacity(0.12))
                        .frame(width: 34, height: 34)
                    Image(systemName: "qrcode.viewfinder")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(Color.smAccent2)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("QR вход")
                        .font(.headline)
                        .foregroundStyle(Color.smText)
                    Text("Как на вебе: сканируете с устройства, где уже вошли.")
                        .font(.caption)
                        .foregroundStyle(Color.smMuted)
                }
                Spacer()
            }

            ZStack {
                RoundedRectangle(cornerRadius: 18)
                    .fill(Color.white)
                    .frame(width: 232, height: 232)
                    .shadow(color: Color.black.opacity(0.10), radius: 10, x: 0, y: 4)

                if let qrImage {
                    Image(uiImage: qrImage)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(width: 196, height: 196)
                    Circle()
                        .fill(Color.white)
                        .frame(width: 44, height: 44)
                        .overlay(SunMarkView(size: 26))
                        .shadow(color: Color.black.opacity(0.08), radius: 3, x: 0, y: 1)
                } else {
                    ProgressView()
                        .tint(Color.smAccent)
                }
            }
            .overlay(
                RoundedRectangle(cornerRadius: 18)
                    .stroke(isWaiting ? Color.smAccent.opacity(0.34) : Color.smBorder, lineWidth: 1)
            )
            .scaleEffect(isCompleting && !reduceMotion ? 0.985 : 1)

            VStack(spacing: 8) {
                HStack(spacing: 7) {
                    Circle()
                        .fill(statusDotColor)
                        .frame(width: 7, height: 7)
                    Text(errorText ?? statusText)
                        .font(.caption.weight(.medium))
                        .foregroundStyle(errorText == nil ? Color.smMuted : Color.smDanger)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                }
                .frame(maxWidth: .infinity)

                Button(action: { Task { await startNewSession() } }) {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 12, weight: .semibold))
                        Text("Обновить QR")
                            .font(.caption.weight(.semibold))
                    }
                    .foregroundStyle(Color.smAccent2)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(Color.smAccent.opacity(0.10), in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(isPreparing || isCompleting)
                .opacity(isPreparing || isCompleting ? 0.45 : 1)
            }
        }
        .padding(16)
        .background(Color.smBg, in: RoundedRectangle(cornerRadius: 16))
        .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.smBorder, lineWidth: 0.5))
        .task { await startNewSession() }
        .onDisappear {
            if !isCompleting {
                cancelPolling()
            }
        }
    }

    private var statusDotColor: Color {
        if errorText != nil { return Color.smDanger }
        if isCompleting { return Color.smOnline }
        if isWaiting { return Color.smAccent }
        return Color.smFaint
    }

    @MainActor
    private func startNewSession() async {
        let requestToken = UUID()
        sessionRequestToken = requestToken
        cancelPolling()
        qrImage = nil
        errorText = nil
        isPreparing = true
        isWaiting = false
        isCompleting = false
        statusText = "Готовим QR..."

        do {
            let api = APIClient.shared
            if api.csrfToken.isEmpty {
                api.csrfToken = try await api.getCsrfToken()
            }
            let receiverPrivateKey = P256.KeyAgreement.PrivateKey()
            let receiverPublicJwk = try QRTransferCrypto.makePublicJWK(from: receiverPrivateKey.publicKey)
            let response = try await api.createKeyTransferLoginSession(receiverPublicJwk: receiverPublicJwk)
            guard response.success, !response.sessionId.isEmpty, !response.qrText.isEmpty else {
                throw QRTransferCryptoError.invalidCiphertext
            }
            let qrText = response.qrText
            let image = await Task.detached(priority: .userInitiated) {
                generateQRCodeImage(from: qrText)
            }.value
            guard !Task.isCancelled, sessionRequestToken == requestToken else { return }
            qrImage = image
            statusText = "Откройте SUN на другом устройстве и отсканируйте этот код."
            isPreparing = false
            isWaiting = true
            startPolling(sessionId: response.sessionId, receiverPrivateKey: receiverPrivateKey)
        } catch {
            guard sessionRequestToken == requestToken else { return }
            isPreparing = false
            isWaiting = false
            errorText = error.localizedDescription
        }
    }

    private func startPolling(sessionId: String, receiverPrivateKey: P256.KeyAgreement.PrivateKey) {
        cancelPolling()
        pollSessionId = sessionId
        pollTask = Task {
            defer {
                Task { @MainActor in
                    guard pollSessionId == sessionId else { return }
                    pollTask = nil
                    pollSessionId = nil
                }
            }
            var fastPollsLeft = 10
            while !Task.isCancelled {
                let delay: UInt64 = fastPollsLeft > 0 ? 600_000_000 : 1_800_000_000
                fastPollsLeft = max(0, fastPollsLeft - 1)
                try? await Task.sleep(nanoseconds: delay)
                guard !Task.isCancelled else { return }

                do {
                    let payload = try await APIClient.shared.claimLoginKeyTransferSession(sessionId: sessionId)
                    guard payload.success, payload.state == "submitted" else { continue }
                    guard let senderPublicJwk = payload.senderPublicJwk,
                          let cipherText = payload.cipherText,
                          let iv = payload.iv,
                          let username = payload.username?.trimmingCharacters(in: .whitespacesAndNewlines),
                          !username.isEmpty
                    else { throw QRTransferCryptoError.invalidCiphertext }

                    let privateKeyPem = try await Task.detached(priority: .userInitiated) {
                        let aesKey = try QRTransferCrypto.deriveKey(
                            privateKey: receiverPrivateKey,
                            peerPublicJwk: senderPublicJwk,
                            sessionId: sessionId
                        )
                        return try QRTransferCrypto.decryptPrivateKeyPem(
                            cipherText: cipherText,
                            iv: iv,
                            using: aesKey
                        )
                    }.value

                    let canComplete = await MainActor.run { () -> Bool in
                        guard pollSessionId == sessionId else { return false }
                        isWaiting = false
                        isCompleting = true
                        statusText = "Ключ получен. Входим..."
                        return true
                    }
                    guard canComplete, !Task.isCancelled else { return }
                    try await onPrivateKeyReceived(username, privateKeyPem)
                    return
                } catch let apiError as APIError {
                    guard !Task.isCancelled else { return }
                    if case .serverError(let code, _) = apiError, code == 404 || code == 410 {
                        await MainActor.run {
                            guard pollSessionId == sessionId else { return }
                            isWaiting = false
                            errorText = "QR истек. Обновите код."
                        }
                        return
                    }
                    await MainActor.run {
                        guard pollSessionId == sessionId else { return }
                        isWaiting = false
                        isCompleting = false
                        errorText = apiError.localizedDescription
                    }
                    return
                } catch {
                    guard !Task.isCancelled else { return }
                    await MainActor.run {
                        guard pollSessionId == sessionId else { return }
                        isWaiting = false
                        isCompleting = false
                        errorText = error.localizedDescription
                    }
                    return
                }
            }
        }
    }

    private func cancelPolling() {
        pollTask?.cancel()
        pollTask = nil
        pollSessionId = nil
    }
}
