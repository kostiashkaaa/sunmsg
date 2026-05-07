/**
 * Client-Side Cryptography Service (Web Crypto API)
 * Implements E2E Encryption and Challenge Signing
 */

const CRYPTO_CONFIG = {
    encryptAlgo: "RSA-OAEP",
    hashAlgo: "SHA-256",
    signAlgo: "RSASSA-PKCS1-v1_5"
};
const KEY_CACHE_TTL_MS = 10 * 60 * 1000;
const KEY_CACHE_MAX_ENTRIES = 64;

// \u041A\u044D\u0448 \u0438\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0445 \u043A\u043B\u044E\u0447\u0435\u0439 \u0434\u043B\u044F \u0443\u0441\u043A\u043E\u0440\u0435\u043D\u0438\u044F (\u0447\u0442\u043E\u0431\u044B \u043D\u0435 \u0434\u0435\u043B\u0430\u0442\u044C \u0438\u043C\u043F\u043E\u0440\u0442 \u043D\u0430 \u043A\u0430\u0436\u0434\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435)
const KeyCache = {
    public: new Map(),
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
    const binary_string = window.atob(base64);
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
    const key = await window.crypto.subtle.importKey(
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

/**
 * \u0418\u043C\u043F\u043E\u0440\u0442 \u043F\u0440\u0438\u0432\u0430\u0442\u043D\u043E\u0433\u043E \u043A\u043B\u044E\u0447\u0430 \u0434\u043B\u044F \u0441\u043D\u044F\u0442\u0438\u044F \u0448\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u0438\u044F (RSA-OAEP)
 */
async function importPrivateKeyForDecryption(pem) {
    const cached = _cacheGet(KeyCache.privateDec, pem);
    if (cached) return cached;

    const binaryDer = base64ToArrayBuffer(removePemHeaderFooter(pem));
    const key = await window.crypto.subtle.importKey(
        "pkcs8",
        binaryDer,
        {
            name: CRYPTO_CONFIG.encryptAlgo,
            hash: CRYPTO_CONFIG.hashAlgo
        },
        true,
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
    const key = await window.crypto.subtle.importKey(
        "pkcs8",
        binaryDer,
        {
            name: CRYPTO_CONFIG.signAlgo,
            hash: CRYPTO_CONFIG.hashAlgo
        },
        true,
        ["sign"]
    );
    _cacheSet(KeyCache.privateSign, pem, key);
    return key;
}

/**
 * \u041F\u043E\u0434\u043F\u0438\u0441\u0430\u0442\u044C \u0432\u044B\u0437\u043E\u0432
 */
async function signChallenge(pemPrivateKey, challengeStr) {
    const privKey = await importPrivateKeyForSigning(pemPrivateKey);
    const encoder = new TextEncoder();
    const data = encoder.encode(challengeStr);
    const signature = await window.crypto.subtle.sign(
        CRYPTO_CONFIG.signAlgo,
        privKey,
        data
    );
    return arrayBufferToBase64(signature);
}

/**
 * E2E \u0428\u0438\u0444\u0440\u043E\u0432\u0430\u043D\u0438\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F (Hybrid AES-GCM + RSA-OAEP)
 * \u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 JSON string, \u043A\u043E\u0442\u043E\u0440\u044B\u0439 \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u043E \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u0442\u044C \u043D\u0430 \u0441\u0435\u0440\u0432\u0435\u0440
 * \u0428\u0438\u0444\u0440\u0443\u0435\u0442 AES \u043A\u043B\u044E\u0447 \u0434\u0432\u0430\u0436\u0434\u044B: \u0434\u043B\u044F \u043F\u043E\u043B\u0443\u0447\u0430\u0442\u0435\u043B\u044F \u0438 \u0434\u043B\u044F \u0441\u0430\u043C\u043E\u0433\u043E \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u0435\u043B\u044F (\u0447\u0442\u043E\u0431\u044B \u0432\u0438\u0434\u0435\u0442\u044C \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043D\u043E\u0435).
 */
async function encryptMessageE2E(pemPublicKeyReceiver, pemPublicKeySender, plaintext) {
    const pubKeyReceiver = await importPublicKeyForEncryption(pemPublicKeyReceiver);
    const pubKeySender = await importPublicKeyForEncryption(pemPublicKeySender);
    
    // \u0413\u0435\u043D\u0435\u0440\u0438\u0440\u0443\u0435\u043C \u0441\u043B\u0443\u0447\u0430\u0439\u043D\u044B\u0439 AES-GCM \u043A\u043B\u044E\u0447
    const aesKey = await window.crypto.subtle.generateKey(
        { name: "AES-GCM", length: 256 },
        true,
        ["encrypt", "decrypt"]
    );

    // \u0428\u0438\u0444\u0440\u0443\u0435\u043C \u0441\u0430\u043C \u0442\u0435\u043A\u0441\u0442 \u0441 \u043F\u043E\u043C\u043E\u0449\u044C\u044E AES
    const iv = window.crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const encodedPlaintext = encoder.encode(plaintext);
    
    const ciphertextBuffer = await window.crypto.subtle.encrypt(
        { name: "AES-GCM", iv: iv },
        aesKey,
        encodedPlaintext
    );

    // \u042D\u043A\u0441\u043F\u043E\u0440\u0442\u0438\u0440\u0443\u0435\u043C \u0441\u044B\u0440\u043E\u0439 AES \u043A\u043B\u044E\u0447
    const rawAesKey = await window.crypto.subtle.exportKey("raw", aesKey);

    // \u0428\u0438\u0444\u0440\u0443\u0435\u043C \u0441\u044B\u0440\u043E\u0439 AES \u043A\u043B\u044E\u0447 \u043F\u0443\u0431\u043B\u0438\u0447\u043D\u044B\u043C RSA \u043A\u043B\u044E\u0447\u043E\u043C \u0441\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A\u0430
    const encryptedAesKeyReceiver = await window.crypto.subtle.encrypt(
        { name: CRYPTO_CONFIG.encryptAlgo },
        pubKeyReceiver,
        rawAesKey
    );

    // \u0428\u0438\u0444\u0440\u0443\u0435\u043C \u0441\u044B\u0440\u043E\u0439 AES \u043A\u043B\u044E\u0447 \u043F\u0443\u0431\u043B\u0438\u0447\u043D\u044B\u043C RSA \u043A\u043B\u044E\u0447\u043E\u043C \u043E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u0435\u043B\u044F
    const encryptedAesKeySender = await window.crypto.subtle.encrypt(
        { name: CRYPTO_CONFIG.encryptAlgo },
        pubKeySender,
        rawAesKey
    );

    // \u0423\u043F\u0430\u043A\u043E\u0432\u044B\u0432\u0430\u0435\u043C \u044D\u0442\u043E \u0432 \u0444\u043E\u0440\u043C\u0430\u0442
    return JSON.stringify({
        encrypted_message: arrayBufferToBase64(ciphertextBuffer),
        encrypted_key_receiver: arrayBufferToBase64(encryptedAesKeyReceiver),
        encrypted_key_sender: arrayBufferToBase64(encryptedAesKeySender),
        iv: arrayBufferToBase64(iv)
    });
}

/**
 * E2E \u0420\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u043A\u0430 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F
 * `isSelf` \u0443\u043A\u0430\u0437\u044B\u0432\u0430\u0435\u0442, \u043A\u0442\u043E \u044F\u0432\u043B\u044F\u0435\u0442\u0441\u044F \u0430\u0432\u0442\u043E\u0440\u043E\u043C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F (\u0447\u0442\u043E\u0431\u044B \u0432\u044B\u0431\u0440\u0430\u0442\u044C \u043D\u0443\u0436\u043D\u044B\u0439 AES \u043A\u043B\u044E\u0447 \u0434\u043B\u044F \u0440\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u043A\u0438)
 */
async function decryptMessageE2E(pemPrivateKey, encryptedPayloadStr, isSelf) {
    try {
        const payload = JSON.parse(encryptedPayloadStr);
        if(!payload.encrypted_message || !payload.iv) {
            return encryptedPayloadStr; // \u041D\u0430 \u0441\u043B\u0443\u0447\u0430\u0439 \u0435\u0441\u043B\u0438 \u044D\u0442\u043E \u0441\u0442\u0430\u0440\u044B\u0439 plaintext
        }

        const privKey = await importPrivateKeyForDecryption(pemPrivateKey);

        // \u0420\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u044B\u0432\u0430\u0435\u043C AES \u043A\u043B\u044E\u0447
        let targetEncryptedKey = isSelf ? payload.encrypted_key_sender : payload.encrypted_key_receiver;
        if(!targetEncryptedKey && payload.encrypted_key) {
             // Fallback to legacy E2E step 1 if exists
             targetEncryptedKey = payload.encrypted_key;
        }

        if (!targetEncryptedKey) {
            return "[\u041D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D \u043A\u043B\u044E\u0447 \u0434\u043B\u044F \u0440\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u043A\u0438 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F]";
        }

        const encryptedAesKeyBuffer = base64ToArrayBuffer(targetEncryptedKey);
        const rawAesKeyBuffer = await window.crypto.subtle.decrypt(
            { name: CRYPTO_CONFIG.encryptAlgo },
            privKey,
            encryptedAesKeyBuffer
        );

        // \u0418\u043C\u043F\u043E\u0440\u0442\u0438\u0440\u0443\u0435\u043C \u0440\u0430\u0441\u043A\u043E\u0434\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0439 AES \u043A\u043B\u044E\u0447 \u043E\u0431\u0440\u0430\u0442\u043D\u043E \u0432 WebCrypto
        const aesKey = await window.crypto.subtle.importKey(
            "raw",
            rawAesKeyBuffer,
            { name: "AES-GCM" },
            false,
            ["decrypt"]
        );

        // \u0420\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u044B\u0432\u0430\u0435\u043C \u0441\u0430\u043C\u043E \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435
        const ciphertextBuffer = base64ToArrayBuffer(payload.encrypted_message);
        const ivBuffer = base64ToArrayBuffer(payload.iv);

        const plaintextBuffer = await window.crypto.subtle.decrypt(
            { name: "AES-GCM", iv: new Uint8Array(ivBuffer) },
            aesKey,
            ciphertextBuffer
        );

        const decoder = new TextDecoder();
        return decoder.decode(plaintextBuffer);

    } catch (e) {
        console.error("Decrypt error", e);
        return "⚠️ [\u041E\u0448\u0438\u0431\u043A\u0430 \u0440\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u043A\u0438 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F]";
    }
}

window.e2e = {
    signChallenge,
    encryptMessageE2E,
    decryptMessageE2E,
    arrayBufferToBase64,
    base64ToArrayBuffer
};
