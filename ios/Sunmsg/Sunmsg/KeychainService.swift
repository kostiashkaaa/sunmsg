import Foundation
import Security

struct KeychainService {
    private static let service = "studio.sunmsg.app"
    private static let account = "sunmsg-private-key-pem"

    // MARK: - Generic binary key helpers

    private static func saveRawKey(_ data: Data, account: String) throws {
        deleteRawKey(account: account)
        let query: [String: Any] = [
            kSecClass as String:          kSecClassGenericPassword,
            kSecAttrService as String:    service,
            kSecAttrAccount as String:    account,
            kSecValueData as String:      data,
            kSecAttrAccessible as String: kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        let rc = SecItemAdd(query as CFDictionary, nil)
        if rc != errSecSuccess {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(rc))
        }
    }

    private static func loadRawKey(account: String) -> Data? {
        let query: [String: Any] = [
            kSecClass as String:       kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String:  true,
            kSecMatchLimit as String:  kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let rc = SecItemCopyMatching(query as CFDictionary, &result)
        guard rc == errSecSuccess, let data = result as? Data else { return nil }
        return data
    }

    private static func deleteRawKey(account: String) {
        let query: [String: Any] = [
            kSecClass as String:       kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }

    // MARK: - X25519 identity key (iOS device key for X3DH)

    static func saveX25519PrivateKey(_ rawBytes: Data) throws {
        try saveRawKey(rawBytes, account: "sunmsg-x25519-identity-priv")
    }

    static func loadX25519PrivateKey() -> Data? {
        loadRawKey(account: "sunmsg-x25519-identity-priv")
    }

    static func deleteX25519PrivateKey() {
        deleteRawKey(account: "sunmsg-x25519-identity-priv")
    }

    // MARK: - Ed25519 signing key

    static func saveEd25519PrivateKey(_ rawBytes: Data) throws {
        try saveRawKey(rawBytes, account: "sunmsg-ed25519-signing-priv")
    }

    static func loadEd25519PrivateKey() -> Data? {
        loadRawKey(account: "sunmsg-ed25519-signing-priv")
    }

    static func deleteEd25519PrivateKey() {
        deleteRawKey(account: "sunmsg-ed25519-signing-priv")
    }

    // MARK: - Signed prekey private key

    static func saveSignedPrekeyPrivateKey(_ rawBytes: Data, id: Int) throws {
        try saveRawKey(rawBytes, account: "sunmsg-spk-priv-\(id)")
    }

    static func loadSignedPrekeyPrivateKey(id: Int) -> Data? {
        loadRawKey(account: "sunmsg-spk-priv-\(id)")
    }

    static func deleteSignedPrekeyPrivateKey(id: Int) {
        deleteRawKey(account: "sunmsg-spk-priv-\(id)")
    }

    // MARK: - One-time prekey private key

    static func saveOTPKPrivateKey(_ rawBytes: Data, id: Int) throws {
        try saveRawKey(rawBytes, account: "sunmsg-otpk-priv-\(id)")
    }

    static func loadOTPKPrivateKey(id: Int) -> Data? {
        loadRawKey(account: "sunmsg-otpk-priv-\(id)")
    }

    static func deleteOTPKPrivateKey(id: Int) {
        deleteRawKey(account: "sunmsg-otpk-priv-\(id)")
    }

    // MARK: - RSA private key (PEM)

    static func savePrivateKey(_ pem: String) throws {
        guard let data = pem.data(using: .utf8) else { return }
        deletePrivateKey()
        let query: [String: Any] = [
            kSecClass as String:            kSecClassGenericPassword,
            kSecAttrService as String:      service,
            kSecAttrAccount as String:      account,
            kSecValueData as String:        data,
            kSecAttrAccessible as String:   kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        ]
        let rc = SecItemAdd(query as CFDictionary, nil)
        if rc != errSecSuccess {
            throw NSError(domain: NSOSStatusErrorDomain, code: Int(rc))
        }
    }

    static func loadPrivateKey() -> String? {
        let query: [String: Any] = [
            kSecClass as String:        kSecClassGenericPassword,
            kSecAttrService as String:  service,
            kSecAttrAccount as String:  account,
            kSecReturnData as String:   true,
            kSecMatchLimit as String:   kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let rc = SecItemCopyMatching(query as CFDictionary, &result)
        guard rc == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func hasPrivateKey() -> Bool {
        let query: [String: Any] = [
            kSecClass as String:       kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecMatchLimit as String:  kSecMatchLimitOne,
        ]
        return SecItemCopyMatching(query as CFDictionary, nil) == errSecSuccess
    }

    static func deletePrivateKey() {
        let query: [String: Any] = [
            kSecClass as String:        kSecClassGenericPassword,
            kSecAttrService as String:  service,
            kSecAttrAccount as String:  account,
        ]
        SecItemDelete(query as CFDictionary)
    }

    static func deleteAllLocalSecrets() {
        deletePrivateKey()
        deleteX25519PrivateKey()
        deleteEd25519PrivateKey()
        deleteSignedPrekeyPrivateKey(id: 1)
    }
}
