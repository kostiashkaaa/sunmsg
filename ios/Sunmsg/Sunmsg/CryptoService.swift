import Foundation
import Security
import CryptoKit
import CommonCrypto

// MARK: - BIP-39 word list (same as web mnemonic.js)

private let _bip39WordlistStr = "abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual adapt add addict address adjust admit adult advance advice aerobic affair afford afraid again age agent agree ahead aim air airport aisle alarm album alcohol alert alien all alley allow almost alone alpha already also alter always amateur amazing among amount amused analyst anchor ancient anger angle angry animal ankle announce annual another answer antenna antique anxiety any apart apology appear apple approve april arch arctic area arena argue arm armed armor army around arrange arrest arrive arrow art artefact artist artwork ask aspect assault asset assist assume asthma athlete atom attack attend attitude attract auction audit august aunt author auto autumn average avocado avoid awake aware away awesome awful awkward axis baby bachelor bacon badge bag balance balcony ball bamboo banana banner bar barely bargain barrel base basic basket battle beach bean beauty because become beef before begin behave behind believe below belt bench benefit best betray better between beyond bicycle bid bike bind biology bird birth bitter black blade blame blanket blast bleak bless blind blood blossom blouse blue blur blush board boat body boil bomb bone bonus book boost border boring borrow boss bottom bounce box boy bracket brain brand brass brave bread breeze brick bridge brief bright bring brisk broccoli broken bronze broom brother brown brush bubble buddy budget buffalo build bulb bulk bullet bundle bunker burden burger burst bus business busy butter buyer buzz cabbage cabin cable cactus cage cake call calm camera camp can canal cancel candy cannon canoe canvas canyon capable capital captain car carbon card cargo carpet carry cart case cash casino castle casual cat catalog catch category cattle caught cause caution cave ceiling celery cement census century cereal certain chair chalk champion change chaos chapter charge chase chat cheap check cheese chef cherry chest chicken chief child chimney choice choose chronic chuckle chunk churn cigar cinnamon circle citizen city civil claim clap clarify claw clay clean clerk clever click client cliff climb clinic clip clock clog close cloth cloud clown club clump cluster clutch coach coast coconut code coffee coil coin collect color column combine come comfort comic common company concert conduct confirm congress connect consider control convince cook cool copper copy coral core corn correct cost cotton couch country couple course cousin cover coyote crack cradle craft cram crane crash crater crawl crazy cream credit creek crew cricket crime crisp critic crop cross crouch crowd crucial cruel cruise crumble crunch crush cry crystal cube culture cup cupboard curious current curtain curve cushion custom cute cycle dad damage damp dance danger daring dash daughter dawn day deal debate debris decade december decide decline decorate decrease deer defense define defy degree delay deliver demand demise denial dentist deny depart depend deposit depth deputy derive describe desert design desk despair destroy detail detect develop device devote diagram dial diamond diary dice diesel diet differ digital dignity dilemma dinner dinosaur direct dirt disagree discover disease dish dismiss disorder display distance divert divide divorce dizzy doctor document dog doll dolphin domain donate donkey donor door dose double dove draft dragon drama drastic draw dream dress drift drill drink drip drive drop drum dry duck dumb dune during dust dutch duty dwarf dynamic eager eagle early earn earth easily east easy echo ecology economy edge edit educate effort egg eight either elbow elder electric elegant element elephant elevator elite else embark embody embrace emerge emotion employ empower empty enable enact end endless endorse enemy energy enforce engage engine enhance enjoy enlist enough enrich enroll ensure enter entire entry envelope episode equal equip era erase erode erosion error erupt escape essay essence estate eternal ethics evidence evil evoke evolve exact example excess exchange excite exclude excuse execute exercise exhaust exhibit exile exist exit exotic expand expect expire explain expose express extend extra eye eyebrow fabric face faculty fade faint faith fall false fame family famous fan fancy fantasy farm fashion fat fatal father fatigue fault favorite feature february federal fee feed feel female fence festival fetch fever few fiber fiction field figure file film filter final find fine finger finish fire firm first fiscal fish fit fitness fix flag flame flash flat flavor flee flight flip float flock floor flower fluid flush fly foam focus fog foil fold follow food foot force forest forget fork fortune forum forward fossil foster found fox fragile frame frequent fresh friend fringe frog front frost frown frozen fruit fuel fun funny furnace fury future gadget gain galaxy gallery game gap garage garbage garden garlic garment gas gasp gate gather gauge gaze general genius genre gentle genuine gesture ghost giant gift giggle ginger giraffe girl give glad glance glare glass glide glimpse globe gloom glory glove glow glue goat goddess gold good goose gorilla gospel gossip govern gown grab grace grain grant grape grass gravity great green grid grief grit grocery group grow grunt guard guess guide guilt guitar gun gym habit hair half hammer hamster hand happy harbor hard harsh harvest hat have hawk hazard head health heart heavy hedgehog height hello helmet help hen hero hidden high hill hint hip hire history hobby hockey hold hole holiday hollow home honey hood hope horn horror horse hospital host hotel hour hover hub huge human humble humor hundred hungry hunt hurdle hurry hurt husband hybrid ice icon idea identify idle ignore ill illegal illness image imitate immense immune impact impose improve impulse inch include income increase index indicate indoor industry infant inflict inform inhale inherit initial inject injury inmate inner innocent input inquiry insane insect inside inspire install intact interest into invest invite involve iron island isolate issue item ivory jacket jaguar jar jazz jealous jeans jelly jewel job join joke journey joy judge juice jump jungle junior junk just kangaroo keen keep ketchup key kick kid kidney kind kingdom kiss kit kitchen kite kitten kiwi knee knife knock know lab label labor ladder lady lake lamp language laptop large later latin laugh laundry lava law lawn lawsuit layer lazy leader leaf learn leave lecture left leg legal legend leisure lemon lend length lens leopard lesson letter level liar liberty library license life lift light like limb limit link lion liquid list little live lizard load loan lobster local lock logic lonely long loop lottery loud lounge love loyal lucky luggage lumber lunar lunch luxury lyrics machine mad magic magnet maid mail main major make mammal man manage mandate mango mansion manual maple marble march margin marine market marriage mask mass master match material math matrix matter maximum maze meadow mean measure meat mechanic medal media melody melt member memory mention menu mercy merge merit merry mesh message metal method middle midnight milk million mimic mind minimum minor minute miracle mirror misery miss mistake mix mixed mixture mobile model modify mom moment monitor monkey monster month moon moral more morning mosquito mother motion motor mountain mouse move movie much muffin mule multiply muscle museum mushroom music must mutual myself mystery myth naive name napkin narrow nasty nation nature near neck need negative neglect neither nephew nerve nest net network neutral never news next nice night noble noise nominee noodle normal north nose notable note nothing notice novel now nuclear number nurse nut oak obey object oblige obscure observe obtain obvious occur ocean october odor off offer office often oil okay old olive olympic omit once one onion online only open opera opinion oppose option orange orbit orchard order ordinary organ orient original orphan ostrich other outdoor outer output outside oval oven over own owner oxygen oyster ozone pact paddle page pair palace palm panda panel panic panther paper parade parent park parrot party pass patch path patient patrol pattern pause pave payment peace peanut pear peasant pelican pen penalty pencil people pepper perfect permit person pet phone photo phrase physical piano picnic picture piece pig pigeon pill pilot pink pioneer pipe pistol pitch pizza place planet plastic plate play please pledge pluck plug plunge poem poet point polar pole police pond pony pool popular portion position possible post potato pottery poverty powder power practice praise predict prefer prepare present pretty prevent price pride primary print priority prison private prize problem process produce profit program project promote proof property prosper protect proud provide public pudding pull pulp pulse pumpkin punch pupil puppy purchase purity purpose purse push put puzzle pyramid quality quantum quarter question quick quit quiz quote rabbit raccoon race rack radar radio rail rain raise rally ramp ranch random range rapid rare rate rather raven raw razor ready real reason rebel rebuild recall receive recipe record recycle reduce reflect reform refuse region regret regular reject relax release relief rely remain remember remind remove render renew rent reopen repair repeat replace report require rescue resemble resist resource response result retire retreat return reunion reveal review reward rhythm rib ribbon rice rich ride ridge rifle right rigid ring riot ripple risk ritual rival river road roast robot robust rocket romance roof rookie room rose rotate rough round route royal rubber rude rug rule run runway rural sad saddle sadness safe sail salad salmon salon salt salute same sample sand satisfy satoshi sauce sausage save say scale scan scare scatter scene scheme school science scissors scorpion scout scrap screen script scrub sea search season seat second secret section security seed seek segment select sell seminar senior sense sentence series service session settle setup seven shadow shaft shallow share shed shell sheriff shield shift shine ship shiver shock shoe shoot shop short shoulder shove shrimp shrug shuffle shy sibling sick side siege sight sign silent silk silly silver similar simple since sing siren sister situate six size skate sketch ski skill skin skirt skull slab slam sleep slender slice slide slight slim slogan slot slow slush small smart smile smoke smooth snack snake snap sniff snow soap soccer social sock soda soft solar soldier solid solution solve someone song soon sorry sort soul sound soup source south space spare spatial spawn speak special speed spell spend sphere spice spider spike spin spirit split spoil sponsor spoon sport spot spray spread spring spy square squeeze squirrel stable stadium staff stage stairs stamp stand start state stay steak steel stem step stereo stick still sting stock stomach stone stool story stove strategy street strike strong struggle student stuff stumble style subject submit subway success such sudden suffer sugar suggest suit summer sun sunny sunset super supply supreme sure surface surge surprise surround survey suspect sustain swallow swamp swap swarm swear sweet swift swim swing switch sword symbol symptom syrup system table tackle tag tail talent talk tank tape target task taste tattoo taxi teach team tell ten tenant tennis tent term test text thank that theme then theory there they thing this thought three thrive throw thumb thunder ticket tide tiger tilt timber time tiny tip tired tissue title toast tobacco today toddler toe together toilet token tomato tomorrow tone tongue tonight tool tooth top topic topple torch tornado tortoise toss total tourist toward tower town toy track trade traffic tragic train transfer trap trash travel tray treat tree trend trial tribe trick trigger trim trip trophy trouble truck true truly trumpet trust truth try tube tuition tumble tuna tunnel turkey turn turtle twelve twenty twice twin twist two type typical ugly umbrella unable unaware uncle uncover under undo unfair unfold unhappy uniform unique unit universe unknown unlock until unusual unveil update upgrade uphold upon upper upset urban urge usage use used useful useless usual utility vacant vacuum vague valid valley valve van vanish vapor various vast vault vehicle velvet vendor venture venue verb verify version very vessel veteran viable vibrant vicious victory video view village vintage violin virtual virus visa visit visual vital vivid vocal voice void volcano volume vote voyage wage wagon wait walk wall walnut want warfare warm warrior wash wasp waste water wave way wealth weapon wear weasel weather web wedding weekend weird welcome west wet whale what wheat wheel when where whip whisper wide width wife wild will win window wine wing wink winner winter wire wisdom wise wish witness wolf woman wonder wood wool word work world worry worth wrap wreck wrestle wrist write wrong yard year yellow you young youth zebra zero zone zoo"

// MARK: - Error

enum SunCryptoError: LocalizedError {
    case pbkdf2Failed
    case invalidVault
    case invalidBase64
    case invalidPEM
    case rsaFailed(String)
    case aesFailed
    case noDecryptionKey

    var errorDescription: String? {
        switch self {
        case .pbkdf2Failed:     return "Key derivation failed."
        case .invalidVault:     return "Invalid vault format."
        case .invalidBase64:    return "Invalid base64 data."
        case .invalidPEM:       return "Invalid PEM key."
        case .rsaFailed(let m): return "RSA error: \(m)"
        case .aesFailed:        return "AES decryption failed."
        case .noDecryptionKey:  return "No decryption key found — wrong mnemonic?"
        }
    }
}

// MARK: - SunCrypto

struct SunCrypto {

    // MARK: Mnemonic → AES-256 key (PBKDF2-SHA256, 100 000 iterations)
    // Matches JS: PBKDF2 with salt "sun-messenger-v1-salt"

    static func deriveKeyFromMnemonic(_ rawMnemonic: String) throws -> SymmetricKey {
        let normalized = rawMnemonic
            .lowercased()
            .components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")

        guard let password = normalized.data(using: .utf8),
              let salt = "sun-messenger-v1-salt".data(using: .utf8) else {
            throw SunCryptoError.pbkdf2Failed
        }

        var derived = [UInt8](repeating: 0, count: 32)
        let rc = password.withUnsafeBytes { pPtr in
            salt.withUnsafeBytes { sPtr in
                CCKeyDerivationPBKDF(
                    CCPBKDFAlgorithm(kCCPBKDF2),
                    pPtr.baseAddress, pPtr.count,
                    sPtr.baseAddress, sPtr.count,
                    CCPseudoRandomAlgorithm(kCCPRFHmacAlgSHA256),
                    100_000,
                    &derived, 32
                )
            }
        }
        guard rc == kCCSuccess else { throw SunCryptoError.pbkdf2Failed }
        return SymmetricKey(data: Data(derived))
    }

    // MARK: Vault decryption: JSON{v,iv,data} + mnemonic → RSA private key PEM

    static func decryptVault(_ vaultStr: String, mnemonic: String) throws -> String {
        struct VaultJSON: Decodable { let iv: String; let data: String }
        guard let raw = vaultStr.data(using: .utf8),
              let vault = try? JSONDecoder().decode(VaultJSON.self, from: raw) else {
            throw SunCryptoError.invalidVault
        }
        guard let ivBytes   = Data(base64Encoded: vault.iv),
              let cipherAll = Data(base64Encoded: vault.data) else {
            throw SunCryptoError.invalidBase64
        }

        let aesKey = try deriveKeyFromMnemonic(mnemonic)

        // Web Crypto AES-GCM output layout: ciphertext || 16-byte tag
        guard cipherAll.count > 16 else { throw SunCryptoError.aesFailed }
        let ciphertext = cipherAll.prefix(cipherAll.count - 16)
        let tag        = cipherAll.suffix(16)

        do {
            let nonce  = try AES.GCM.Nonce(data: ivBytes)
            let sealed = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
            let plain  = try AES.GCM.open(sealed, using: aesKey)
            return String(data: plain, encoding: .utf8) ?? ""
        } catch {
            throw SunCryptoError.noDecryptionKey   // wrong mnemonic → decryption fails
        }
    }

    // MARK: PEM helpers

    static func pemBase64(_ pem: String) -> String {
        pem.components(separatedBy: .newlines)
           .filter { !$0.hasPrefix("-----") && !$0.isEmpty }
           .joined()
    }

    // MARK: RSA key import

    static func importPrivateKey(_ pem: String) throws -> SecKey {
        guard var der = Data(base64Encoded: pemBase64(pem), options: .ignoreUnknownCharacters) else {
            throw SunCryptoError.invalidPEM
        }
        // SecKeyCreateWithData only accepts PKCS#1 RSAPrivateKey.
        // Web-generated keys are PKCS#8 — extract inner PKCS#1 if needed.
        if let pkcs1 = extractRSAPrivateKeyFromPKCS8(der) { der = pkcs1 }

        var err: Unmanaged<CFError>?
        let attrs: [String: Any] = [
            kSecAttrKeyType  as String: kSecAttrKeyTypeRSA,
            kSecAttrKeyClass as String: kSecAttrKeyClassPrivate,
        ]
        guard let key = SecKeyCreateWithData(der as CFData, attrs as CFDictionary, &err) else {
            throw err?.takeRetainedValue() as Error? ?? SunCryptoError.invalidPEM
        }
        return key
    }

    // Extracts the RSAPrivateKey (PKCS#1) payload from a PKCS#8 PrivateKeyInfo wrapper.
    // Returns nil if the input is already PKCS#1 (no wrapper detected).
    private static func extractRSAPrivateKeyFromPKCS8(_ data: Data) -> Data? {
        let b = [UInt8](data)
        var i = 0
        func readLen() -> Int {
            guard i < b.count else { return 0 }
            let first = Int(b[i]); i += 1
            if first < 0x80 { return first }
            let octets = first & 0x7f
            var len = 0
            for _ in 0..<min(octets, 4) { guard i < b.count else { return 0 }; len = (len << 8) | Int(b[i]); i += 1 }
            return len
        }
        guard i < b.count, b[i] == 0x30 else { return nil }; i += 1  // outer SEQUENCE
        _ = readLen()
        guard i < b.count, b[i] == 0x02 else { return nil }; i += 1  // INTEGER (version=0)
        let vLen = readLen(); i += vLen
        guard i < b.count, b[i] == 0x30 else { return nil }; i += 1  // AlgorithmIdentifier
        let aLen = readLen(); i += aLen
        guard i < b.count, b[i] == 0x04 else { return nil }; i += 1  // OCTET STRING
        let oLen = readLen()
        guard i + oLen <= b.count else { return nil }
        return Data(b[i..<(i + oLen)])
    }

    static func importPublicKey(_ pem: String) throws -> SecKey {
        guard let der = Data(base64Encoded: pemBase64(pem), options: .ignoreUnknownCharacters) else {
            throw SunCryptoError.invalidPEM
        }
        var err: Unmanaged<CFError>?
        let attrs: [String: Any] = [
            kSecAttrKeyType  as String: kSecAttrKeyTypeRSA,
            kSecAttrKeyClass as String: kSecAttrKeyClassPublic,
        ]
        guard let key = SecKeyCreateWithData(der as CFData, attrs as CFDictionary, &err) else {
            throw err?.takeRetainedValue() as Error? ?? SunCryptoError.invalidPEM
        }
        return key
    }

    // MARK: RSA-OAEP/SHA-256

    static func rsaDecrypt(_ cipher: Data, privateKeyPEM: String) throws -> Data {
        let key = try importPrivateKey(privateKeyPEM)
        let algorithms: [SecKeyAlgorithm] = [
            .rsaEncryptionOAEPSHA256,
            .rsaEncryptionOAEPSHA1,
        ]
        var lastError: Error?
        for algorithm in algorithms where SecKeyIsAlgorithmSupported(key, .decrypt, algorithm) {
            var err: Unmanaged<CFError>?
            if let plain = SecKeyCreateDecryptedData(key, algorithm, cipher as CFData, &err) {
                return plain as Data
            }
            lastError = err?.takeRetainedValue() as Error?
        }
        throw lastError ?? SunCryptoError.rsaFailed("decrypt")
    }

    static func rsaEncrypt(_ data: Data, publicKeyPEM: String) throws -> Data {
        let key = try importPublicKey(publicKeyPEM)
        var err: Unmanaged<CFError>?
        guard let cipher = SecKeyCreateEncryptedData(
            key, .rsaEncryptionOAEPSHA256, data as CFData, &err
        ) else {
            throw err?.takeRetainedValue() as Error? ?? SunCryptoError.rsaFailed("encrypt")
        }
        return cipher as Data
    }

    // MARK: RSASSA-PKCS1-v1_5/SHA-256 (challenge signing + payload signing)

    static func rsaSign(_ message: String, privateKeyPEM: String) throws -> String {
        let key  = try importPrivateKey(privateKeyPEM)
        let data = Data(message.utf8)
        var err: Unmanaged<CFError>?
        guard let sig = SecKeyCreateSignature(
            key, .rsaSignatureMessagePKCS1v15SHA256, data as CFData, &err
        ) else {
            throw err?.takeRetainedValue() as Error? ?? SunCryptoError.rsaFailed("sign")
        }
        return (sig as Data).base64EncodedString()
    }

    // MARK: Message decryption (legacy v2 JSON payload)

    static func decryptMessageForDisplay(
        _ payload: String,
        isSelf: Bool,
        privateKeyPEM: String
    ) -> String {
        do {
            return try decryptMessage(payload, isSelf: isSelf, privateKeyPEM: privateKeyPEM)
        } catch SunCryptoError.noDecryptionKey {
            return "[ключ не найден]"
        } catch SunCryptoError.invalidBase64 {
            return "[некорректные данные сообщения]"
        } catch SunCryptoError.aesFailed {
            return "[не удалось расшифровать]"
        } catch {
            return "[не удалось расшифровать]"
        }
    }

    static func decryptMessage(
        _ jsonStr: String,
        isSelf: Bool,
        privateKeyPEM: String
    ) throws -> String {
        struct Payload: Decodable {
            let v: Int?
            let proto: String?
            let encrypted_message: String
            let encrypted_key_receiver: String?
            let encrypted_key_sender: String?
            let encrypted_key: String?
            let encrypted_keys: [String]?
            let iv: String
        }
        // Fast-detect v3 messages (have "ct" not "encrypted_message") before Payload decode
        if V3CryptoService.isV3Message(jsonStr) {
            return "__v3__"        // sentinel: ChatView will handle async decryption
        }
        guard let raw = jsonStr.data(using: .utf8),
              let p = try? JSONDecoder().decode(Payload.self, from: raw) else {
            return jsonStr          // not encrypted — return as-is
        }
        if p.v == 3 {
            return "__v3__"
        }
        guard let ivData     = Data(base64Encoded: p.iv),
              let cipherAll  = Data(base64Encoded: p.encrypted_message),
              cipherAll.count > 16 else {
            throw SunCryptoError.invalidBase64
        }

        // Pick the right wrapped AES key
        let preferred: [String?] = isSelf
            ? [p.encrypted_key_sender, p.encrypted_key_receiver, p.encrypted_key]
            : [p.encrypted_key_receiver, p.encrypted_key_sender, p.encrypted_key]
        let candidates = preferred
            + [p.encrypted_key_receiver, p.encrypted_key_sender, p.encrypted_key]
            + (p.encrypted_keys ?? []).map(Optional.some)

        var rawAES: Data?
        var seen = Set<String>()
        for b64 in candidates.compactMap({ $0 }) {
            if seen.contains(b64) { continue }
            seen.insert(b64)
            if let cd = Data(base64Encoded: b64),
               let d = try? rsaDecrypt(cd, privateKeyPEM: privateKeyPEM) {
                rawAES = d; break
            }
        }
        guard let aesRaw = rawAES else { throw SunCryptoError.noDecryptionKey }

        let aesKey    = SymmetricKey(data: aesRaw)
        let ciphertext = cipherAll.prefix(cipherAll.count - 16)
        let tag        = cipherAll.suffix(16)

        do {
            let nonce  = try AES.GCM.Nonce(data: ivData)
            let sealed = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
            let plain  = try AES.GCM.open(sealed, using: aesKey)
            return String(data: plain, encoding: .utf8) ?? ""
        } catch {
            throw SunCryptoError.aesFailed
        }
    }

    // MARK: Message encryption (v2 JSON payload, matches JS encryptMessageE2E)

    static func encryptMessage(
        _ plaintext: String,
        receiverPEM: String,
        senderPEM: String,
        privateKeyPEM: String
    ) throws -> String {
        // Random AES-256 key + 12-byte nonce
        let aesKey = SymmetricKey(size: .bits256)
        let nonce  = AES.GCM.Nonce()
        let sealed = try AES.GCM.seal(Data(plaintext.utf8), using: aesKey, nonce: nonce)

        // ciphertext || tag  (matches Web Crypto layout)
        let encMsg = (sealed.ciphertext + sealed.tag).base64EncodedString()
        let ivB64  = Data(nonce).base64EncodedString()

        // Export raw AES key bytes
        let rawKey = aesKey.withUnsafeBytes { Data($0) }

        let encKeyR = try rsaEncrypt(rawKey, publicKeyPEM: receiverPEM).base64EncodedString()
        let encKeyS = try rsaEncrypt(rawKey, publicKeyPEM: senderPEM).base64EncodedString()

        // Sign the payload (must match JS buildCiphertextSignatureMessage key order)
        let sigMsg = buildSignatureMessage(
            v: 2, encMsg: encMsg, encKeyR: encKeyR,
            encKeyS: encKeyS, encKey: "", encKeys: [], iv: ivB64
        )
        let sig = try rsaSign(sigMsg, privateKeyPEM: privateKeyPEM)

        // Build JSON with exact key order required by the backend / JS verifier
        return """
        {"v":2,"encrypted_message":"\(encMsg)","encrypted_key_receiver":"\(encKeyR)","encrypted_key_sender":"\(encKeyS)","encrypted_key":"","encrypted_keys":[],"iv":"\(ivB64)","signature":"\(sig)","signature_alg":"RSASSA-PKCS1-v1_5/SHA-256"}
        """
    }

    static func encryptMessageForRecipients(
        _ plaintext: String,
        recipientPEMs: [String],
        senderPEM: String,
        privateKeyPEM: String
    ) throws -> String {
        var recipients: [String] = []
        var seen = Set<String>()
        for pem in recipientPEMs + [senderPEM] {
            let normalized = pem.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !normalized.isEmpty, !seen.contains(normalized) else { continue }
            recipients.append(normalized)
            seen.insert(normalized)
        }
        guard !recipients.isEmpty else {
            throw SunCryptoError.invalidPEM
        }

        let aesKey = SymmetricKey(size: .bits256)
        let nonce = AES.GCM.Nonce()
        let sealed = try AES.GCM.seal(Data(plaintext.utf8), using: aesKey, nonce: nonce)
        let encMsg = (sealed.ciphertext + sealed.tag).base64EncodedString()
        let ivB64 = Data(nonce).base64EncodedString()
        let rawKey = aesKey.withUnsafeBytes { Data($0) }
        let encKeys = try recipients.map {
            try rsaEncrypt(rawKey, publicKeyPEM: $0).base64EncodedString()
        }

        let sigMsg = buildSignatureMessage(
            v: 2,
            encMsg: encMsg,
            encKeyR: "",
            encKeyS: "",
            encKey: "",
            encKeys: encKeys,
            iv: ivB64
        )
        let sig = try rsaSign(sigMsg, privateKeyPEM: privateKeyPEM)
        let keysJSON = "[" + encKeys.map { "\"\($0)\"" }.joined(separator: ",") + "]"
        return """
        {"v":2,"encrypted_message":"\(encMsg)","encrypted_key_receiver":"","encrypted_key_sender":"","encrypted_key":"","encrypted_keys":\(keysJSON),"iv":"\(ivB64)","signature":"\(sig)","signature_alg":"RSASSA-PKCS1-v1_5/SHA-256"}
        """
    }

    // Mirrors JS buildCiphertextSignatureMessage — key order must be identical.
    static func buildSignatureMessage(
        v: Int, encMsg: String, encKeyR: String,
        encKeyS: String, encKey: String, encKeys: [String], iv: String
    ) -> String {
        let keysJSON = "[" + encKeys.map { "\"\($0)\"" }.joined(separator: ",") + "]"
        return """
        {"v":\(v),"encrypted_message":"\(encMsg)","encrypted_key_receiver":"\(encKeyR)","encrypted_key_sender":"\(encKeyS)","encrypted_key":"\(encKey)","encrypted_keys":\(keysJSON),"iv":"\(iv)"}
        """
    }

    // MARK: - BIP-39 mnemonic generation (matches web mnemonic.js)

    static func generateMnemonic() throws -> String {
        let words = _bip39WordlistStr.components(separatedBy: " ")

        var entropy = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, 32, &entropy) == errSecSuccess else {
            throw SunCryptoError.pbkdf2Failed
        }
        var hash = [UInt8](repeating: 0, count: Int(CC_SHA256_DIGEST_LENGTH))
        _ = entropy.withUnsafeBytes { CC_SHA256($0.baseAddress, CC_LONG($0.count), &hash) }
        let checksum = hash[0]

        var bits = [UInt8]()
        bits.reserveCapacity(264)
        for byte in entropy {
            for i in stride(from: 7, through: 0, by: -1) { bits.append((byte >> i) & 1) }
        }
        for i in stride(from: 7, through: 0, by: -1) { bits.append((checksum >> i) & 1) }

        return (0..<24).map { i in
            var idx = 0
            for j in 0..<11 { idx = (idx << 1) | Int(bits[i * 11 + j]) }
            return words[idx]
        }.joined(separator: " ")
    }

    // MARK: - RSA-2048 key pair generation (PKCS#8 private + SPKI public for web compatibility)

    // Returns (privatePEM, publicPEM):
    //   privatePEM — PKCS#1 RSAPrivateKey ("BEGIN RSA PRIVATE KEY"), usable by all internal crypto
    //   publicPEM  — SPKI ("BEGIN PUBLIC KEY"), required by the server's load_pem_public_key
    static func generateRSAKeyPair() throws -> (privatePEM: String, publicPEM: String) {
        let attrs: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeRSA,
            kSecAttrKeySizeInBits as String: 2048,
            kSecPrivateKeyAttrs as String: [kSecAttrIsPermanent as String: false],
        ]
        var err: Unmanaged<CFError>?
        guard let privateKey = SecKeyCreateRandomKey(attrs as CFDictionary, &err) else {
            throw err?.takeRetainedValue() as Error? ?? SunCryptoError.rsaFailed("keygen")
        }
        guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
            throw SunCryptoError.rsaFailed("public key extract")
        }
        guard let privateDER = SecKeyCopyExternalRepresentation(privateKey, &err) as Data? else {
            throw err?.takeRetainedValue() as Error? ?? SunCryptoError.rsaFailed("export private")
        }
        guard let publicDER = SecKeyCopyExternalRepresentation(publicKey, &err) as Data? else {
            throw err?.takeRetainedValue() as Error? ?? SunCryptoError.rsaFailed("export public")
        }
        // privateDER is PKCS#1 — SecKeyCreateWithData accepts this directly
        // publicDER is PKCS#1 RSAPublicKey — wrap to SPKI for server compatibility
        let spki = rsaPublicToSPKI(publicDER)
        return (wrapPEM(privateDER, header: "RSA PRIVATE KEY"), wrapPEM(spki, header: "PUBLIC KEY"))
    }

    // Convert a PKCS#1 PEM to PKCS#8 PEM so the web's importKey("pkcs8", ...) can read it.
    static func convertToPKCS8PEM(_ pkcs1PEM: String) -> String {
        guard let der = Data(base64Encoded: pemBase64(pkcs1PEM), options: .ignoreUnknownCharacters) else {
            return pkcs1PEM
        }
        return wrapPEM(pkcs1PrivateToPKCS8(der), header: "PRIVATE KEY")
    }

    private static func pkcs1PrivateToPKCS8(_ pkcs1: Data) -> Data {
        let version: [UInt8] = [0x02, 0x01, 0x00]
        let algId: [UInt8] = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]
        let octet = [UInt8]([0x04]) + derLen(pkcs1.count) + [UInt8](pkcs1)
        let inner = version + algId + octet
        return Data([0x30] + derLen(inner.count) + inner)
    }

    private static func rsaPublicToSPKI(_ pkcs1: Data) -> Data {
        let algId: [UInt8] = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]
        let bitStr = [UInt8]([0x03]) + derLen(pkcs1.count + 1) + [0x00] + [UInt8](pkcs1)
        let inner = algId + bitStr
        return Data([0x30] + derLen(inner.count) + inner)
    }

    private static func derLen(_ n: Int) -> [UInt8] {
        if n < 128 { return [UInt8(n)] }
        if n < 256 { return [0x81, UInt8(n)] }
        return [0x82, UInt8(n >> 8), UInt8(n & 0xff)]
    }

    static func wrapPEM(_ der: Data, header: String) -> String {
        let b64 = der.base64EncodedString()
        var lines = ["-----BEGIN \(header)-----"]
        var i = b64.startIndex
        while i < b64.endIndex {
            let end = b64.index(i, offsetBy: 64, limitedBy: b64.endIndex) ?? b64.endIndex
            lines.append(String(b64[i..<end]))
            i = end
        }
        lines.append("-----END \(header)-----")
        return lines.joined(separator: "\n")
    }

    // MARK: - Vault encryption (mirrors JS createVault)

    static func encryptVault(privateKeyPEM: String, mnemonic: String) throws -> String {
        let aesKey = try deriveKeyFromMnemonic(mnemonic)
        var nonceBytes = [UInt8](repeating: 0, count: 12)
        guard SecRandomCopyBytes(kSecRandomDefault, 12, &nonceBytes) == errSecSuccess else {
            throw SunCryptoError.aesFailed
        }
        let nonce = try AES.GCM.Nonce(data: Data(nonceBytes))
        let sealed = try AES.GCM.seal(Data(privateKeyPEM.utf8), using: aesKey, nonce: nonce)
        let encData = (sealed.ciphertext + sealed.tag).base64EncodedString()
        let ivB64 = Data(nonceBytes).base64EncodedString()
        return "{\"v\":1,\"iv\":\"\(ivB64)\",\"data\":\"\(encData)\"}"
    }
}

// MARK: - Client-side media E2EE (mirrors web chat-media-e2ee.js)
//
// The web client optionally encrypts uploaded media files with AES-256-GCM
// before sending them to the server.  The decryption key is stored inline in
// the `data` URL field of the __sunfile envelope, appended as a URL fragment:
//
//   /chat_media/123#sun_media_e2ee=<base64url-JSON>
//
// The encrypted file on the server starts with the magic header "SUNENC1\n"
// (8 bytes) followed by the AES-GCM ciphertext+tag.

struct SunMediaE2EE {

    let fetchURL: URL   // URL without the fragment (ready to fetch)
    let key: Data       // raw 32-byte AES-256 key
    let iv: Data        // 12-byte AES-GCM nonce
    let mime: String    // original MIME type

    private static let fragmentParam = "sun_media_e2ee"
    // "SUNENC1\n" — 8 bytes
    private static let magic: [UInt8] = [
        0x53, 0x55, 0x4E, 0x45, 0x4E, 0x43, 0x31, 0x0A
    ]

    // MARK: Parse

    /// Returns a `SunMediaE2EE` if `url` contains a `#sun_media_e2ee=…` fragment,
    /// `nil` otherwise (plain/unencrypted media URL).
    static func parse(url: URL) -> SunMediaE2EE? {
        guard let fragment = url.fragment, !fragment.isEmpty else { return nil }

        // The fragment may contain additional key=value pairs joined by "&".
        var encoded: String?
        for part in fragment.split(separator: "&") {
            let kv = part.split(separator: "=", maxSplits: 1)
            if kv.count == 2, kv[0] == Substring(fragmentParam) {
                encoded = String(kv[1])
                break
            }
        }
        guard let encodedStr = encoded, !encodedStr.isEmpty else { return nil }

        // Reverse the web's base64url-encode-JSON step:
        //   1. Convert URL-safe base64 → standard base64
        //   2. Decode bytes → UTF-8 JSON string
        //   3. Parse JSON → metadata dict
        var b64 = encodedStr
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let jsonBytes = Data(base64Encoded: b64, options: .ignoreUnknownCharacters),
              let obj = try? JSONSerialization.jsonObject(with: jsonBytes) as? [String: Any]
        else { return nil }

        guard let keyB64 = obj["key"] as? String,
              let ivB64  = obj["iv"]  as? String,
              let keyData = Data(base64Encoded: keyB64, options: .ignoreUnknownCharacters),
              let ivData  = Data(base64Encoded: ivB64,  options: .ignoreUnknownCharacters),
              keyData.count == 32,
              ivData.count  == 12
        else { return nil }

        let mime = (obj["mime"] as? String) ?? "application/octet-stream"

        // Build fetch URL without the fragment
        var comp = URLComponents(url: url, resolvingAgainstBaseURL: true)
        comp?.fragment = nil
        guard let fetchURL = comp?.url else { return nil }

        return SunMediaE2EE(fetchURL: fetchURL, key: keyData, iv: ivData, mime: mime)
    }

    // MARK: Decrypt

    /// Decrypts `encryptedData` that begins with the "SUNENC1\n" magic header.
    func decrypt(_ encryptedData: Data) throws -> Data {
        let magicLen = SunMediaE2EE.magic.count
        guard encryptedData.count > magicLen + 16 else { throw SunCryptoError.invalidBase64 }

        // Verify magic header
        for i in 0..<magicLen {
            guard encryptedData[i] == SunMediaE2EE.magic[i] else { throw SunCryptoError.invalidBase64 }
        }

        let cipherAll  = encryptedData.dropFirst(magicLen)
        let ciphertext = cipherAll.prefix(cipherAll.count - 16)
        let tag        = cipherAll.suffix(16)

        let aesKey = SymmetricKey(data: key)
        let nonce  = try AES.GCM.Nonce(data: iv)
        let sealed = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext, tag: tag)
        return try AES.GCM.open(sealed, using: aesKey)
    }

    // MARK: Convenience

    /// File extension inferred from MIME type (for temp file naming).
    var fileExtension: String {
        switch mime.lowercased() {
        case "image/jpeg", "image/jpg": return "jpg"
        case "image/png":               return "png"
        case "image/gif":               return "gif"
        case "image/webp":              return "webp"
        case "video/mp4":               return "mp4"
        case "video/webm":              return "webm"
        case "video/quicktime":         return "mov"
        case "audio/mp4", "audio/aac", "audio/m4a": return "m4a"
        case "audio/webm", "audio/ogg": return "webm"
        case "audio/mpeg", "audio/mp3": return "mp3"
        default:                        return "bin"
        }
    }

    /// Fetch from server, decrypt, and persist to a temp file.
    /// Returns the temp file `URL` which can be passed to `AVPlayer` or `UIImage`.
    func fetchAndDecryptToTempFile() async throws -> URL {
        guard let rawData = try await APIClient.shared.fetchMedia(fetchURL),
              !rawData.isEmpty else {
            throw URLError(.badServerResponse)
        }
        let decrypted = try decrypt(rawData)
        let tmpURL = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension(fileExtension)
        try decrypted.write(to: tmpURL)
        return tmpURL
    }

    /// Fetch and decrypt directly into memory (for images).
    func fetchAndDecrypt() async throws -> Data {
        guard let rawData = try await APIClient.shared.fetchMedia(fetchURL),
              !rawData.isEmpty else {
            throw URLError(.badServerResponse)
        }
        return try decrypt(rawData)
    }
}
