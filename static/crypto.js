/**
 * Client-Side Cryptography Service (Web Crypto API)
 * Implements E2E Encryption and Challenge Signing
 */

const CRYPTO_CONFIG = {
    encryptAlgo: "RSA-OAEP",
    hashAlgo: "SHA-256",
    signAlgo: "RSASSA-PKCS1-v1_5"
};

// RSA-PSS is the modern signature padding. We keep PKCS1-v1.5 as the default
// because: (a) the server-side challenge verifier still expects it, and
// (b) old payloads in the wild are signed with PKCS1. Reading PSS-signed
// payloads is enabled unconditionally via the signature_alg dispatch in
// verifyCiphertextPayloadSignature; writing PSS-signed payloads is opt-in
// via window.cryptoConfig.useRsaPssForNewMessages once we're ready to
// migrate. Until then this constant documents the target algorithm.
const SIGN_ALG_PSS = "RSA-PSS";
const SIGN_ALG_PKCS1 = "RSASSA-PKCS1-v1_5";
const PSS_SALT_LENGTH = 32;  // matches SHA-256 digest size
const KEY_CACHE_TTL_MS = 10 * 60 * 1000;
const KEY_CACHE_MAX_ENTRIES = 64;

// Префикс-маркер для сообщений, которые удалось расшифровать, но подпись
// отправителя отсутствует, хотя его публичный ключ нам известен. Раньше такие
// сообщения молча показывались как доверенные — это позволяло серверу/MITM
// вставить неподписанное сообщение. Теперь они помечаются явно. Маркер
// распознаётся рендером по этому префиксу (см. message-rendering) и не
// добавляется к по-настоящему старым сообщениям без ключа отправителя.
const UNVERIFIED_SIGNATURE_MARKER = "⚠️ [не проверено] ";

// \u041A\u044D\u0448 \u0438\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0445 \u043A\u043B\u044E\u0447\u0435\u0439 \u0434\u043B\u044F \u0443\u0441\u043A\u043E\u0440\u0435\u043D\u0438\u044F (\u0447\u0442\u043E\u0431\u044B \u043D\u0435 \u0434\u0435\u043B\u0430\u0442\u044C \u0438\u043C\u043F\u043E\u0440\u0442 \u043D\u0430 \u043A\u0430\u0436\u0434\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435)
const KeyCache = {
    public: new Map(),
    publicVerify: new Map(),
    privateDec: new Map(),
    privateSign: new Map()
};

function _cacheSweep(map) {
    const now = Date.now();
    for (const [key, entry] of map.entries()) {
        if (!entry || entry.expiresAt <= now) {
            map.delete(key);
        }
    }
    while (map.size > KEY_CACHE_MAX_ENTRIES) {
        const oldestKey = map.keys().next().value;
        if (!oldestKey) break;
        map.delete(oldestKey);
    }
}

function _cacheGet(map, key) {
    const entry = map.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
        map.delete(key);
        return null;
    }
    entry.expiresAt = Date.now() + KEY_CACHE_TTL_MS;
    map.set(key, entry);
    return entry.value;
}

function _cacheSet(map, key, value) {
    _cacheSweep(map);
    map.set(key, {
        value,
        expiresAt: Date.now() + KEY_CACHE_TTL_MS
    });
}

// \u0412 Web Worker (importScripts) \u0441\u0432\u043E\u0439 setInterval \u043D\u0435 \u043D\u0443\u0436\u0435\u043D — sweep \u043F\u0440\u043E\u0438\u0441\u0445\u043E\u0434\u0438\u0442 \u043B\u0435\u043D\u0438\u0432\u043E \u0432 _cacheGet.
if (typeof window !== 'undefined' && typeof self !== 'undefined' && self === window) {
    setInterval(() => {
        _cacheSweep(KeyCache.public);
        _cacheSweep(KeyCache.publicVerify);
        _cacheSweep(KeyCache.privateDec);
        _cacheSweep(KeyCache.privateSign);
    }, 60 * 1000);
}

// \u0425\u0435\u043B\u043F\u0435\u0440\u044B \u0434\u043B\u044F \u0440\u0430\u0431\u043E\u0442\u044B \u0441 Base64
function arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const len = bytes.byteLength;
    // \u0427\u0430\u043D\u043A\u0430\u043C\u0438 \u043F\u043E 32K, \u0447\u0442\u043E\u0431\u044B \u043D\u0435 \u0432\u044B\u0439\u0442\u0438 \u0437\u0430 \u043B\u0438\u043C\u0438\u0442 \u0430\u0440\u0433\u0443\u043C\u0435\u043D\u0442\u043E\u0432 apply()
    const CHUNK = 0x8000;
    const parts = [];
    for (let i = 0; i < len; i += CHUNK) {
        const slice = bytes.subarray(i, Math.min(i + CHUNK, len));
        parts.push(String.fromCharCode.apply(null, slice));
    }
    return btoa(parts.join(''));
}

function base64ToArrayBuffer(base64) {
    const binary_string = atob(base64);
    const len = binary_string.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary_string.charCodeAt(i);
    }
    return bytes.buffer;
}

// \u041F\u0440\u0435\u043E\u0431\u0440\u0430\u0437\u043E\u0432\u0430\u043D\u0438\u0435 PEM \u043A ArrayBuffer
function removePemHeaderFooter(pem) {
    return pem
        .replace(/-----BEGIN [^-]+-----/g, '')
        .replace(/-----END [^-]+-----/g, '')
        .replace(/\s+/g, '');
}

/**
 * \u0418\u043C\u043F\u043E\u0440\u0442 \u043F\u0443\u0431\u043B\u0438\u0447\u043D\u043E\u0433\u043E \u043A\u043B\u044E\u0447\u0430 \u0434\u043B\u044F \u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u0438\u044F (RSA-OAEP)
 */
async function importPublicKeyForEncryption(pem) {
    const cached = _cacheGet(KeyCache.public, pem);
    if (cached) return cached;

    const binaryDer = base64ToArrayBuffer(removePemHeaderFooter(pem));
    const key = await crypto.subtle.importKey(
        "spki",
        binaryDer,
        {
            name: CRYPTO_CONFIG.encryptAlgo,
            hash: CRYPTO_CONFIG.hashAlgo
        },
        true,
        ["encrypt"]
    );
    _cacheSet(KeyCache.public, pem, key);
    return key;
}

async function importPublicKeyForVerification(pem) {
    const cached = _cacheGet(KeyCache.publicVerify, pem);
    if (cached) return cached;

    const binaryDer = base64ToArrayBuffer(removePemHeaderFooter(pem));
    const key = await crypto.subtle.importKey(
        "spki",
        binaryDer,
        {
            name: CRYPTO_CONFIG.signAlgo,
            hash: CRYPTO_CONFIG.hashAlgo
        },
        true,
        ["verify"]
    );
    _cacheSet(KeyCache.publicVerify, pem, key);
    return key;
}

/**
 * \u0418\u043C\u043F\u043E\u0440\u0442 \u043F\u0440\u0438\u0432\u0430\u0442\u043D\u043E\u0433\u043E \u043A\u043B\u044E\u0447\u0430 \u0434\u043B\u044F \u0441\u043D\u044F\u0442\u0438\u044F \u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u0438\u044F (RSA-OAEP)
 */
async function importPrivateKeyForDecryption(pem) {
    const cached = _cacheGet(KeyCache.privateDec, pem);
    if (cached) return cached;

    const binaryDer = base64ToArrayBuffer(removePemHeaderFooter(pem));
    // extractable=false \u2014 once the CryptoKey lands in our cache, an attacker
    // with same-origin XSS cannot re-export the PKCS8 via crypto.subtle.exportKey.
    // The PEM string the caller passed in is still in JS heap until GC'd, so
    // this is defense-in-depth, not a silver bullet \u2014 minimize PEM lifetime
    // elsewhere (device-key.js unwraps just-in-time).
    const key = await crypto.subtle.importKey(
        "pkcs8",
        binaryDer,
        {
            name: CRYPTO_CONFIG.encryptAlgo,
            hash: CRYPTO_CONFIG.hashAlgo
        },
        false,
        ["decrypt"]
    );
    _cacheSet(KeyCache.privateDec, pem, key);
    return key;
}

/**
 * \u0418\u043C\u043F\u043E\u0440\u0442 \u043F\u0440\u0438\u0432\u0430\u0442\u043D\u043E\u0433\u043E \u043A\u043B\u044E\u0447\u0430 \u0434\u043B\u044F \u043F\u043E\u0434\u043F\u0438\u0441\u0438 (RSASSA)
 */
async function importPrivateKeyForSigning(pem) {
    const cached = _cacheGet(KeyCache.privateSign, pem);
    if (cached) return cached;

    const binaryDer = base64ToArrayBuffer(removePemHeaderFooter(pem));
    // extractable=false: see importPrivateKeyForDecryption for rationale.
    const key = await crypto.subtle.importKey(
        "pkcs8",
        binaryDer,
        {
            name: CRYPTO_CONFIG.signAlgo,
            hash: CRYPTO_CONFIG.hashAlgo
        },
        false,
        ["sign"]
    );
    _cacheSet(KeyCache.privateSign, pem, key);
    return key;
}

async function _importPrivateKeyForPssSigning(pem) {
    const cacheKey = `pss:${pem}`;
    const cached = _cacheGet(KeyCache.privateSign, cacheKey);
    if (cached) return cached;

    const binaryDer = base64ToArrayBuffer(removePemHeaderFooter(pem));
    const key = await crypto.subtle.importKey(
        "pkcs8",
        binaryDer,
        { name: SIGN_ALG_PSS, hash: CRYPTO_CONFIG.hashAlgo },
        false,
        ["sign"]
    );
    _cacheSet(KeyCache.privateSign, cacheKey, key);
    return key;
}

function _newMessageSignatureAlg() {
    const cfg = (typeof window !== 'undefined' && window.cryptoConfig) || {};
    return cfg.useRsaPssForNewMessages === true
        ? "RSA-PSS/SHA-256"
        : "RSASSA-PKCS1-v1_5/SHA-256";
}

/**
 * \u041F\u043E\u0434\u043F\u0438\u0441\u0430\u0442\u044C \u0432\u044B\u0437\u043E\u0432
 */
async function signChallenge(pemPrivateKey, challengeStr) {
    const privKey = await importPrivateKeyForSigning(pemPrivateKey);
    const encoder = new TextEncoder();
    const data = encoder.encode(challengeStr);
    const signature = await crypto.subtle.sign(
        CRYPTO_CONFIG.signAlgo,
        privKey,
        data
    );
    return arrayBufferToBase64(signature);
}

function normalizeEncryptedKeysForSignature(value) {
    if (!Array.isArray(value)) return [];
    return value.map((item) => String(item || '')).filter(Boolean);
}

function buildCiphertextSignatureMessage(payload) {
    return JSON.stringify({
        v: Number(payload?.v || 1),
        encrypted_message: String(payload?.encrypted_message || ''),
        encrypted_key_receiver: String(payload?.encrypted_key_receiver || ''),
        encrypted_key_sender: String(payload?.encrypted_key_sender || ''),
        encrypted_key: String(payload?.encrypted_key || ''),
        encrypted_keys: normalizeEncryptedKeysForSignature(payload?.encrypted_keys),
        iv: String(payload?.iv || '')
    });
}

async function signCiphertextPayload(pemPrivateKeySender, payload, signatureAlg = _newMessageSignatureAlg()) {
    if (!pemPrivateKeySender) return '';
    const signParams = _verifyParamsForAlg(signatureAlg);
    const privKey = signParams.name === SIGN_ALG_PSS
        ? await _importPrivateKeyForPssSigning(pemPrivateKeySender)
        : await importPrivateKeyForSigning(pemPrivateKeySender);
    const data = new TextEncoder().encode(buildCiphertextSignatureMessage(payload));
    const signature = await crypto.subtle.sign(
        signParams,
        privKey,
        data
    );
    return arrayBufferToBase64(signature);
}

/**
 * Verify the integrity signature on an E2E ciphertext payload.
 *
 * Returns one of:
 *   - `true`            — signature checked and valid
 *   - `false`           — signature present but mismatch (treat as tampered)
 *   - `'unsigned'`      — payload carries no signature; the sender either is
 *                         a legacy client or the server stripped the field.
 *                         Callers MUST surface this in UI rather than
 *                         conflate it with verification success.
 *   - `'no-pubkey'`     — caller did not provide the sender's pubkey, so we
 *                         can't verify; same UI treatment as 'unsigned'.
 *
 * Historical contract returned `true` for both genuinely unsigned messages
 * and verification failures with missing inputs — that let a hostile relay
 * silently drop signatures. The bool|string union forces callers to handle
 * the ambiguous states explicitly.
 */
function _verifyParamsForAlg(signatureAlg) {
    const alg = String(signatureAlg || '').toLowerCase();
    if (alg.startsWith('rsa-pss') || alg.startsWith('rsassa-pss')) {
        return { name: SIGN_ALG_PSS, saltLength: PSS_SALT_LENGTH };
    }
    return { name: SIGN_ALG_PKCS1 };
}

async function verifyCiphertextPayloadSignature(pemPublicKeySender, payload) {
    if (!payload?.signature) return 'unsigned';
    if (!pemPublicKeySender) return 'no-pubkey';
    const verifyParams = _verifyParamsForAlg(payload.signature_alg);
    // The verification key import is algorithm-agnostic for our import path
    // because spki + RSASSA-PKCS1-v1_5 and RSA-PSS use the same SubjectPublicKeyInfo
    // structure; the algorithm comes from the `algorithm` parameter on verify().
    // But WebCrypto requires the imported key's `algorithm.name` to match the
    // verify call — so re-import per algorithm when PSS is requested.
    const pubKey = verifyParams.name === SIGN_ALG_PSS
        ? await _importPublicKeyForPssVerification(pemPublicKeySender)
        : await importPublicKeyForVerification(pemPublicKeySender);
    const signature = base64ToArrayBuffer(payload.signature);
    const data = new TextEncoder().encode(buildCiphertextSignatureMessage(payload));
    const ok = await crypto.subtle.verify(
        verifyParams,
        pubKey,
        signature,
        data
    );
    return ok === true;
}

async function _importPublicKeyForPssVerification(pem) {
    const cacheKey = `pss:${pem}`;
    const cached = _cacheGet(KeyCache.publicVerify, cacheKey);
    if (cached) return cached;
    const binaryDer = base64ToArrayBuffer(removePemHeaderFooter(pem));
    const key = await crypto.subtle.importKey(
        "spki",
        binaryDer,
        { name: SIGN_ALG_PSS, hash: CRYPTO_CONFIG.hashAlgo },
        true,
        ["verify"]
    );
    _cacheSet(KeyCache.publicVerify, cacheKey, key);
    return key;
}

async function encryptMessageWithRecipientKeys(recipientPublicKeys, plaintext) {
    const uniquePublicKeys = Array.from(new Set(
        (Array.isArray(recipientPublicKeys) ? recipientPublicKeys : [])
            .map((value) => String(value || '').trim())
            .filter(Boolean)
    ));
    if (!uniquePublicKeys.length) {
        throw new Error("No recipient public keys.");
    }

    const aesKey = await crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encodedPlaintext = new TextEncoder().encode(plaintext);
    const ciphertextBuffer = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        aesKey,
        encodedPlaintext
    );
    const rawAesKey = await crypto.subtle.exportKey("raw", aesKey);
    const encryptedKeys = [];
    for (const publicKeyPem of uniquePublicKeys) {
        const pubKey = await importPublicKeyForEncryption(publicKeyPem);
        const encryptedAesKey = await crypto.subtle.encrypt(
            { name: CRYPTO_CONFIG.encryptAlgo },
            pubKey,
            rawAesKey
        );
        encryptedKeys.push(arrayBufferToBase64(encryptedAesKey));
    }
    return {
        encrypted_message: arrayBufferToBase64(ciphertextBuffer),
        encrypted_keys: encryptedKeys,
        iv: arrayBufferToBase64(iv)
    };
}

/**
 * E2E \u0428\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F (Hybrid AES-GCM + RSA-OAEP)
 * \u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 JSON string, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u0442\u044C \u043D\u0430 \u0441\u0435\u0440\u0432\u0435\u0440
 * \u0428\u0438\u0444\u0440\u0443\u0435\u0442 AES \u043A\u043B\u044E\u0447 \u0434\u0432\u0430\u0436\u0434\u044B: \u0434\u043B\u044F \u043F\u043E\u043B\u0443\u0447\u0430\u0442\u0435\u043B\u044F \u0438 \u0434\u043B\u044F \u0441\u0430\u043C\u043E\u0433\u043E \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u0435\u043B\u044F (\u0447\u0442\u043E\u0431\u044B \u0432\u0438\u0434\u0435\u0442\u044C \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043D\u043E\u0435).
 */
async function encryptMessageE2E(pemPublicKeyReceiver, pemPublicKeySender, plaintext, pemPrivateKeySender = '') {
    const basePayload = await encryptMessageWithRecipientKeys(
        [pemPublicKeyReceiver, pemPublicKeySender],
        plaintext
    );
    const payload = {
        v: 2,
        encrypted_message: basePayload.encrypted_message,
        encrypted_key_receiver: basePayload.encrypted_keys[0],
        encrypted_key_sender: basePayload.encrypted_keys[1] || basePayload.encrypted_keys[0],
        iv: basePayload.iv
    };
    const signatureAlg = _newMessageSignatureAlg();
    const signature = await signCiphertextPayload(pemPrivateKeySender, payload, signatureAlg);
    if (signature) {
        payload.signature = signature;
        payload.signature_alg = signatureAlg;
    }
    return JSON.stringify(payload);
}

async function encryptMessageE2EForRecipients(recipientPublicKeys, pemPublicKeySender, plaintext, pemPrivateKeySender = '') {
    const recipients = Array.from(new Set([
        ...(Array.isArray(recipientPublicKeys) ? recipientPublicKeys : []),
        pemPublicKeySender
    ].map((value) => String(value || '').trim()).filter(Boolean)));
    const payload = {
        v: 2,
        ...(await encryptMessageWithRecipientKeys(recipients, plaintext))
    };
    const signatureAlg = _newMessageSignatureAlg();
    const signature = await signCiphertextPayload(pemPrivateKeySender, payload, signatureAlg);
    if (signature) {
        payload.signature = signature;
        payload.signature_alg = signatureAlg;
    }
    return JSON.stringify(payload);
}

/**
 * E2E \u0420\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u043A\u0430 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F
 * `isSelf` \u0443\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442, \u043A\u0442\u043E \u044F\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u0440\u043E\u043C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F (\u0447\u0442\u043E\u0431\u044B \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u043D\u0443\u0436\u043D\u044B\u0439 AES \u043A\u043B\u044E\u0447 \u0434\u043B\u044F \u0440\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u043A\u0438)
 */
async function decryptMessageE2E(pemPrivateKey, encryptedPayloadStr, isSelf, expectedSenderPublicKey = '') {
    try {
        const payload = JSON.parse(encryptedPayloadStr);
        if(!payload.encrypted_message || !payload.iv) {
            return encryptedPayloadStr; // \u041D\u0430 \u0441\u043B\u0443\u0447\u0430\u0439 \u0435\u0441\u043B\u0438 \u044D\u0442\u043E \u0441\u0442\u0430\u0440\u044B\u0439 plaintext
        }

        const signatureStatus = await verifyCiphertextPayloadSignature(expectedSenderPublicKey, payload);
        if (signatureStatus === false) {
            return "[\u041F\u043E\u0434\u043F\u0438\u0441\u044C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u043D\u0435 \u043F\u0440\u043E\u0448\u043B\u0430 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0443]";
        }
        // 'unsigned' \u043F\u0440\u0438 \u0438\u0437\u0432\u0435\u0441\u0442\u043D\u043E\u043C \u043A\u043B\u044E\u0447\u0435 \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u0435\u043B\u044F = \u043F\u043E\u0434\u043F\u0438\u0441\u044C \u043C\u043E\u0433\u043B\u0430 \u0438 \u0434\u043E\u043B\u0436\u043D\u0430 \u0431\u044B\u043B\u0430
        // \u0431\u044B\u0442\u044C, \u043D\u043E \u0435\u0451 \u043D\u0435\u0442 \u2192 \u043F\u043E\u043C\u0435\u0442\u0438\u0442\u044C \u043A\u0430\u043A \u043D\u0435\u043F\u0440\u043E\u0432\u0435\u0440\u0435\u043D\u043D\u043E\u0435 (\u043D\u043E \u0432\u0441\u0451 \u0440\u0430\u0432\u043D\u043E \u043F\u043E\u043A\u0430\u0437\u0430\u0442\u044C).
        // 'no-pubkey' (\u043A\u043B\u044E\u0447 \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u0435\u043B\u044F \u043D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u0435\u043D, \u043D\u0430\u043F\u0440. \u0441\u0442\u0430\u0440\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435) \u0438 true
        // (\u043F\u043E\u0434\u043F\u0438\u0441\u044C \u0432\u0430\u043B\u0438\u0434\u043D\u0430) \u2014 \u0431\u0435\u0437 \u043C\u0430\u0440\u043A\u0435\u0440\u0430.
        const isUnverified = signatureStatus === 'unsigned' && Boolean(expectedSenderPublicKey);

        const privKey = await importPrivateKeyForDecryption(pemPrivateKey);

        // \u0420\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u044B\u0432\u0430\u0435\u043C AES \u043A\u043B\u044E\u0447
        let targetEncryptedKey = isSelf ? payload.encrypted_key_sender : payload.encrypted_key_receiver;
        if(!targetEncryptedKey && payload.encrypted_key) {
             // Fallback to legacy E2E step 1 if exists
             targetEncryptedKey = payload.encrypted_key;
        }

        let rawAesKeyBuffer = null;
        if (targetEncryptedKey) {
            const encryptedAesKeyBuffer = base64ToArrayBuffer(targetEncryptedKey);
            rawAesKeyBuffer = await crypto.subtle.decrypt(
                { name: CRYPTO_CONFIG.encryptAlgo },
                privKey,
                encryptedAesKeyBuffer
            );
        } else if (Array.isArray(payload.encrypted_keys)) {
            for (const candidate of payload.encrypted_keys) {
                if (!candidate) continue;
                try {
                    rawAesKeyBuffer = await crypto.subtle.decrypt(
                        { name: CRYPTO_CONFIG.encryptAlgo },
                        privKey,
                        base64ToArrayBuffer(candidate)
                    );
                    break;
                } catch (_) {}
            }
        }

        if (!rawAesKeyBuffer) {
            return "[\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u043A\u043B\u044E\u0447 \u0434\u043B\u044F \u0440\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u043A\u0438 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F]";
        }

        // \u0418\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u0443\u0435\u043C \u0440\u0430\u0441\u043A\u043E\u0434\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0439 AES \u043A\u043B\u044E\u0447 \u043E\u0431\u0440\u0430\u0442\u043D\u043E \u0432 WebCrypto
        const aesKey = await crypto.subtle.importKey(
            "raw",
            rawAesKeyBuffer,
            { name: "AES-GCM" },
            false,
            ["decrypt"]
        );

        // \u0420\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u044B\u0432\u0430\u0435\u043C \u0441\u0430\u043C\u043E \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435
        const ciphertextBuffer = base64ToArrayBuffer(payload.encrypted_message);
        const ivBuffer = base64ToArrayBuffer(payload.iv);

        const plaintextBuffer = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: new Uint8Array(ivBuffer) },
            aesKey,
            ciphertextBuffer
        );

        const decoder = new TextDecoder();
        const plaintext = decoder.decode(plaintextBuffer);
        return isUnverified ? UNVERIFIED_SIGNATURE_MARKER + plaintext : plaintext;

    } catch (e) {
        console.error("Decrypt error:", e?.name || 'unknown');
        return "⚠️ [\u041E\u0448\u0438\u0431\u043A\u0430 \u0440\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u043A\u0438 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F]";
    }
}

if (typeof window !== 'undefined') {
    window.e2e = {
        signChallenge,
        encryptMessageE2E,
        encryptMessageE2EForRecipients,
        decryptMessageE2E,
        arrayBufferToBase64,
        base64ToArrayBuffer
    };
}
