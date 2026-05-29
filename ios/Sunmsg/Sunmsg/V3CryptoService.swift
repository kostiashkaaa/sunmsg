import Foundation
import CryptoKit

// MARK: - Errors

enum V3CryptoError: Error, LocalizedError {
    case invalidPayload
    case invalidBase64
    case missingDHKey
    case invalidState
    case tooManySkipped
    case aesDecryptFailed

    var errorDescription: String? {
        switch self {
        case .invalidPayload:   return "Invalid v3 payload"
        case .invalidBase64:    return "Invalid base64url data"
        case .missingDHKey:     return "DH private key not found in session"
        case .invalidState:     return "Invalid DR state"
        case .tooManySkipped:   return "Too many skipped DR messages"
        case .aesDecryptFailed: return "AES-GCM decryption failed"
        }
    }
}

// MARK: - V3CryptoService

struct V3CryptoService {

    // MARK: Base64url

    static func b64uDecode(_ s: String) -> Data? {
        var str = s
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while str.count % 4 != 0 { str += "=" }
        return Data(base64Encoded: str, options: .ignoreUnknownCharacters)
    }

    static func b64uEncode(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }

    // MARK: HKDF (matches web cv2.hkdf(ikm, salt, info, length))

    static func hkdf(ikm: Data, salt: Data, info: String, length: Int) -> Data {
        let inputKey = SymmetricKey(data: ikm)
        let derived = HKDF<SHA256>.deriveKey(
            inputKeyMaterial: inputKey,
            salt: salt,
            info: Data(info.utf8),
            outputByteCount: length
        )
        return derived.withUnsafeBytes { Data($0) }
    }

    // MARK: DR KDF

    // kdfRK: HKDF(ikm=dhOutput, salt=rootKey, info="SUN-DR-RK-v1", 64 bytes)
    // Returns (newRootKey[0:32], newChainKey[32:64])
    static func kdfRK(rootKey: Data, dhOutput: Data) -> (newRK: Data, newCK: Data) {
        let out = hkdf(ikm: dhOutput, salt: rootKey, info: "SUN-DR-RK-v1", length: 64)
        return (Data(out.prefix(32)), Data(out.suffix(32)))
    }

    // kdfCK: web uses two separate HKDF calls with different salts
    // mk  = HKDF(ikm=chainKey, salt=32_zero_bytes, info="SUN-DR-MK-v1", 32)
    // newCK = HKDF(ikm=chainKey, salt=[1],          info="SUN-DR-CK-v1", 32)
    static func kdfCK(chainKey: Data) -> (newCK: Data, mk: Data) {
        let zeroSalt = Data(repeating: 0, count: 32)
        let oneSalt  = Data([1])
        let mk    = hkdf(ikm: chainKey, salt: zeroSalt, info: "SUN-DR-MK-v1", length: 32)
        let newCK = hkdf(ikm: chainKey, salt: oneSalt,  info: "SUN-DR-CK-v1", length: 32)
        return (newCK, mk)
    }

    // MARK: X25519 DH

    static func x25519DH(privateKeyRaw: Data, publicKeyRaw: Data) throws -> Data {
        let priv = try Curve25519.KeyAgreement.PrivateKey(rawRepresentation: privateKeyRaw)
        let pub  = try Curve25519.KeyAgreement.PublicKey(rawRepresentation: publicKeyRaw)
        let shared = try priv.sharedSecretFromKeyAgreement(with: pub)
        return shared.withUnsafeBytes { Data($0) }
    }

    // MARK: AES-256-GCM (web format: last 16 bytes of ct are the auth tag)

    static func aesGcmDecrypt(messageKey: Data, ctB64u: String, ivB64u: String) throws -> String {
        guard let ctBytes = b64uDecode(ctB64u), ctBytes.count > 16,
              let ivBytes = b64uDecode(ivB64u) else {
            throw V3CryptoError.invalidBase64
        }
        let ciphertext = ctBytes.prefix(ctBytes.count - 16)
        let tag        = ctBytes.suffix(16)
        do {
            let nonce  = try AES.GCM.Nonce(data: ivBytes)
            let sealed = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
            let plain  = try AES.GCM.open(sealed, using: SymmetricKey(data: messageKey))
            return String(data: plain, encoding: .utf8) ?? ""
        } catch {
            throw V3CryptoError.aesDecryptFailed
        }
    }

    // MARK: JWK X25519 private key extraction

    static func x25519PrivFromJwk(_ jwk: [String: Any]) -> Data? {
        guard let d = jwk["d"] as? String else { return nil }
        return b64uDecode(d)
    }

    // MARK: Message detection

    static func isV3Message(_ json: String) -> Bool {
        guard json.hasPrefix("{"),
              let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let v = obj["v"] as? Int, v == 3
        else { return false }
        return true
    }

    static func v3Proto(_ json: String) -> String? {
        guard let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return nil }
        return obj["proto"] as? String
    }

    // MARK: - DR State

    struct DRState {
        var dhsPrivRaw:  Data?    // 32-byte X25519 private key (our current DH key)
        var dhsPubB64u:  String?  // b64u-encoded public key
        var dhrB64u:     String?  // their current DH public key (b64u), nil if receiver
        var rk:          Data?    // root key (32 bytes)
        var cks:         Data?    // sending chain key (32 bytes)
        var ckr:         Data?    // receiving chain key (32 bytes)
        var ns:          Int      // sent messages count
        var nr:          Int      // received messages count
        var pn:          Int      // messages in previous sending chain
        var mkSkipped:   [String: Data]  // "dhPubB64u:msgNum" → 32-byte message key
    }

    static func parseDRState(_ json: String) throws -> DRState {
        guard let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { throw V3CryptoError.invalidState }

        var state = DRState(dhsPrivRaw: nil, dhsPubB64u: nil, dhrB64u: nil,
                            rk: nil, cks: nil, ckr: nil,
                            ns: 0, nr: 0, pn: 0, mkSkipped: [:])

        if let dhs = obj["DHs"] as? [String: Any] {
            state.dhsPubB64u = dhs["publicKeyB64u"] as? String
            if let jwk = dhs["privateKeyJwk"] as? [String: Any] {
                state.dhsPrivRaw = x25519PrivFromJwk(jwk)
            }
        }

        state.dhrB64u = obj["DHr"] as? String

        if let rkB64u  = obj["RK"]  as? String { state.rk  = b64uDecode(rkB64u) }
        if let cksB64u = obj["CKs"] as? String { state.cks = b64uDecode(cksB64u) }
        if let ckrB64u = obj["CKr"] as? String { state.ckr = b64uDecode(ckrB64u) }

        state.ns = (obj["Ns"] as? Int) ?? 0
        state.nr = (obj["Nr"] as? Int) ?? 0
        state.pn = (obj["PN"] as? Int) ?? 0

        if let skipped = obj["MKSKIPPED"] as? [String: String] {
            for (k, v) in skipped {
                if let bytes = b64uDecode(v) { state.mkSkipped[k] = bytes }
            }
        }

        return state
    }

    static func serializeDRState(_ state: DRState) -> String? {
        var dhsObj: Any = NSNull()
        if let priv = state.dhsPrivRaw, let pub = state.dhsPubB64u {
            let jwk: [String: Any] = [
                "kty": "OKP", "crv": "X25519",
                "x": pub,
                "d": b64uEncode(priv),
                "key_ops": ["deriveKey", "deriveBits"],
                "ext": true,
            ]
            dhsObj = ["publicKeyB64u": pub, "privateKeyJwk": jwk]
        }

        var mkSkippedStr = [String: String]()
        for (k, v) in state.mkSkipped { mkSkippedStr[k] = b64uEncode(v) }

        var obj: [String: Any] = [
            "Ns": state.ns, "Nr": state.nr, "PN": state.pn,
            "MKSKIPPED": mkSkippedStr,
            "DHs": dhsObj,
        ]
        obj["DHr"]  = state.dhrB64u  as Any
        obj["RK"]   = state.rk.map  { b64uEncode($0) } as Any
        obj["CKs"]  = state.cks.map { b64uEncode($0) } as Any
        obj["CKr"]  = state.ckr.map { b64uEncode($0) } as Any

        guard let data = try? JSONSerialization.data(withJSONObject: obj) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    // MARK: - DR Decryption

    static func decryptDR(json: String, state: inout DRState) throws -> String {
        guard let data = json.data(using: .utf8),
              let obj  = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let hdr  = obj["header"] as? [String: Any],
              let dhB64u = hdr["dh"] as? String,
              let ct   = obj["ct"] as? String,
              let iv   = obj["iv"] as? String
        else { throw V3CryptoError.invalidPayload }

        let pn = (hdr["pn"] as? Int) ?? 0
        let n  = (hdr["n"]  as? Int) ?? 0

        // Skipped keys cache
        let skKey = "\(dhB64u):\(n)"
        if let mk = state.mkSkipped[skKey] {
            state.mkSkipped.removeValue(forKey: skKey)
            return try aesGcmDecrypt(messageKey: mk, ctB64u: ct, ivB64u: iv)
        }

        // DH ratchet if new DHr key
        if state.dhrB64u == nil || dhB64u != state.dhrB64u {
            guard let dhsPriv = state.dhsPrivRaw else { throw V3CryptoError.missingDHKey }
            guard let rk = state.rk else { throw V3CryptoError.invalidState }

            // Skip remaining receive chain up to pn
            if state.ckr != nil {
                try skipMessageKeys(&state, until: pn)
            }

            state.pn = state.ns
            state.ns = 0
            state.nr = 0
            state.dhrB64u = dhB64u

            guard let theirPubBytes = b64uDecode(dhB64u) else { throw V3CryptoError.invalidBase64 }

            // DH step 1: our current DHs × their new key
            let dhOut1 = try x25519DH(privateKeyRaw: dhsPriv, publicKeyRaw: theirPubBytes)
            let (newRK1, newCKr) = kdfRK(rootKey: rk, dhOutput: dhOut1)
            state.rk  = newRK1
            state.ckr = newCKr

            // Generate a new DHs pair for future sends
            let newPriv = Curve25519.KeyAgreement.PrivateKey()
            state.dhsPrivRaw = newPriv.rawRepresentation
            state.dhsPubB64u = b64uEncode(newPriv.publicKey.rawRepresentation)

            // DH step 2: new DHs × their new key
            let dhOut2 = try x25519DH(privateKeyRaw: state.dhsPrivRaw!, publicKeyRaw: theirPubBytes)
            let (newRK2, newCKs) = kdfRK(rootKey: newRK1, dhOutput: dhOut2)
            state.rk  = newRK2
            state.cks = newCKs
        }

        // Skip receive chain keys up to n
        try skipMessageKeys(&state, until: n)

        guard let ckr = state.ckr else { throw V3CryptoError.invalidState }
        let (newCKr, mk) = kdfCK(chainKey: ckr)
        state.ckr = newCKr
        state.nr += 1

        return try aesGcmDecrypt(messageKey: mk, ctB64u: ct, ivB64u: iv)
    }

    private static func skipMessageKeys(_ state: inout DRState, until: Int) throws {
        guard state.ckr != nil, state.nr < until else { return }
        let toSkip = until - state.nr
        if toSkip > 100 { throw V3CryptoError.tooManySkipped }

        while state.nr < until {
            guard let ckr = state.ckr else { return }
            let (newCKr, mk) = kdfCK(chainKey: ckr)
            state.ckr = newCKr
            let mapKey = "\(state.dhrB64u ?? ""):\(state.nr)"
            state.mkSkipped[mapKey] = mk
            state.nr += 1
        }

        // Cap MKSKIPPED at 100 entries
        if state.mkSkipped.count > 100 {
            let toRemove = state.mkSkipped.count - 100
            for k in Array(state.mkSkipped.keys.prefix(toRemove)) {
                state.mkSkipped.removeValue(forKey: k)
            }
        }
    }

    // MARK: - X3DH Responder Decryption

    // Payload: { v:3, proto:"x3dh", sender_ik, ephemeral_key, spk_id, ct, iv [, otpk_id] }
    // iOS needs: ikPrivRaw (X25519 identity key), spkPrivRaw (X25519 signed prekey for spk_id)
    static func decryptX3DH(json: String, ikPrivRaw: Data, spkPrivRaw: Data) throws -> String {
        guard let data = json.data(using: .utf8),
              let obj  = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let senderIkB64u    = obj["sender_ik"]      as? String,
              let ephemeralB64u   = obj["ephemeral_key"]  as? String,
              let ct = obj["ct"] as? String,
              let iv = obj["iv"] as? String
        else { throw V3CryptoError.invalidPayload }

        guard let senderIkBytes  = b64uDecode(senderIkB64u),
              let ephemeralBytes = b64uDecode(ephemeralB64u)
        else { throw V3CryptoError.invalidBase64 }

        // DH1 = X25519(spk_priv, sender_ik)
        let dh1 = try x25519DH(privateKeyRaw: spkPrivRaw, publicKeyRaw: senderIkBytes)
        // DH2 = X25519(ik_priv, ephemeral)
        let dh2 = try x25519DH(privateKeyRaw: ikPrivRaw,  publicKeyRaw: ephemeralBytes)
        // DH3 = X25519(spk_priv, ephemeral)
        let dh3 = try x25519DH(privateKeyRaw: spkPrivRaw, publicKeyRaw: ephemeralBytes)

        var ikm = dh1 + dh2 + dh3

        // Optional one-time prekey: look up its private key in Keychain
        if let otpkId = obj["otpk_id"] as? Int,
           let otpkPrivRaw = KeychainService.loadOTPKPrivateKey(id: otpkId) {
            let dh4 = try x25519DH(privateKeyRaw: otpkPrivRaw, publicKeyRaw: ephemeralBytes)
            ikm += dh4
        }

        let salt         = Data(repeating: 0, count: 32)
        let masterSecret = hkdf(ikm: ikm, salt: salt, info: "SUN-X3DH-v1", length: 64)
        let encKey       = Data(masterSecret.prefix(32))

        return try aesGcmDecrypt(messageKey: encKey, ctB64u: ct, ivB64u: iv)
    }

    // MARK: - iOS key generation

    static func generateX25519KeyPair() -> (privateRaw: Data, publicRaw: Data) {
        let priv = Curve25519.KeyAgreement.PrivateKey()
        return (priv.rawRepresentation, priv.publicKey.rawRepresentation)
    }

    static func generateEd25519KeyPair() -> (privateRaw: Data, publicRaw: Data) {
        let priv = Curve25519.Signing.PrivateKey()
        return (priv.rawRepresentation, priv.publicKey.rawRepresentation)
    }

    static func ed25519Sign(privateRaw: Data, message: String) throws -> Data {
        let priv = try Curve25519.Signing.PrivateKey(rawRepresentation: privateRaw)
        return try priv.signature(for: Data(message.utf8))
    }
}
