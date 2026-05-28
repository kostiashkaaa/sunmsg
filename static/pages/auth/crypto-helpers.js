export function hasWebCryptoSupport() {
    return !!(window.crypto && window.crypto.subtle && typeof window.crypto.getRandomValues === 'function');
}

export function webCryptoUnavailableMessage(tr = (value) => String(value ?? '')) {
    return tr('Криптография браузера недоступна. Откройте сайт по HTTPS (или localhost). На iPhone адрес вида http://192.168.x.x не подходит.');
}

export function assertWebCryptoSupport(tr = (value) => String(value ?? '')) {
    if (!hasWebCryptoSupport()) {
        throw new Error(webCryptoUnavailableMessage(tr));
    }
}

export function supportsPasskeyAuth() {
    return Boolean(window.PublicKeyCredential && navigator.credentials && typeof navigator.credentials.get === 'function');
}

export function base64urlToBytes(base64url) {
    const text = String(base64url || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (text.length % 4)) % 4);
    const raw = window.atob(text + pad);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
        bytes[i] = raw.charCodeAt(i);
    }
    return bytes;
}

export function parseRequestOptionsFromServer(options) {
    if (window.PublicKeyCredential?.parseRequestOptionsFromJSON) {
        return window.PublicKeyCredential.parseRequestOptionsFromJSON(options);
    }
    const publicKey = JSON.parse(JSON.stringify(options || {}));
    publicKey.challenge = base64urlToBytes(publicKey.challenge);
    if (Array.isArray(publicKey.allowCredentials)) {
        publicKey.allowCredentials = publicKey.allowCredentials.map((descriptor) => ({
            ...descriptor,
            id: base64urlToBytes(descriptor.id),
        }));
    }
    return publicKey;
}

export function credentialToJSON(credential) {
    if (!credential) return credential;
    if (typeof credential.toJSON === 'function') {
        return credential.toJSON();
    }
    const bytesToBase64url = (bytesLike) => {
        const bytes = bytesLike instanceof Uint8Array ? bytesLike : new Uint8Array(bytesLike);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i += 1) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    };
    if (credential instanceof ArrayBuffer) {
        return bytesToBase64url(new Uint8Array(credential));
    }
    if (ArrayBuffer.isView(credential)) {
        return bytesToBase64url(new Uint8Array(credential.buffer, credential.byteOffset, credential.byteLength));
    }
    if (Array.isArray(credential)) {
        return credential.map((value) => credentialToJSON(value));
    }
    if (typeof credential === 'object') {
        const out = {};
        Object.keys(credential).forEach((key) => {
            out[key] = credentialToJSON(credential[key]);
        });
        return out;
    }
    return credential;
}

export function base64urlEncode(bytesLike) {
    const bytes = bytesLike instanceof Uint8Array ? bytesLike : new Uint8Array(bytesLike);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function utf8Bytes(value) {
    return new TextEncoder().encode(String(value || ''));
}

export function concatBytes(a, b) {
    const first = a instanceof Uint8Array ? a : new Uint8Array(a);
    const second = b instanceof Uint8Array ? b : new Uint8Array(b);
    const out = new Uint8Array(first.length + second.length);
    out.set(first, 0);
    out.set(second, first.length);
    return out;
}

// Derive the AES-GCM key for cross-device key transfer. The default path uses
// HKDF-SHA256 per RFC 5869:
//   IKM  = ECDH shared secret bits
//   salt = constant per-protocol label (binds the derivation to this app)
//   info = `sun-key-transfer-v1:<sessionId>` (contextual binding)
// The legacy path (`scheme: 'legacy-sha256-concat'`) computes SHA-256(IKM || info)
// and stays available so a sender on a new build can still complete a transfer
// against a receiver on an older build that hasn't refreshed. Default to HKDF
// for new sessions; fall back only when the peer signals legacy.
const TRANSFER_HKDF_SALT = utf8Bytes('sun-key-transfer-v1');

export async function deriveTransferKey({ privateKey, publicKey, sessionId, scheme = 'hkdf-v1' }) {
    const sharedBits = await crypto.subtle.deriveBits(
        { name: 'ECDH', public: publicKey },
        privateKey,
        256,
    );
    if (scheme === 'legacy-sha256-concat') {
        const context = utf8Bytes(`sun-key-transfer-v1:${sessionId}`);
        const digestInput = concatBytes(new Uint8Array(sharedBits), context);
        const digest = await crypto.subtle.digest('SHA-256', digestInput);
        return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['decrypt']);
    }
    const ikm = await crypto.subtle.importKey(
        'raw',
        sharedBits,
        { name: 'HKDF' },
        false,
        ['deriveKey'],
    );
    return crypto.subtle.deriveKey(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: TRANSFER_HKDF_SALT,
            info: utf8Bytes(`sun-key-transfer-v1:${sessionId}`),
        },
        ikm,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt'],
    );
}

export async function decryptPrivateKeyPem({ cipherText, iv, aesKey }) {
    const cipherBytes = base64urlToBytes(cipherText);
    const ivBytes = base64urlToBytes(iv);
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes },
        aesKey,
        cipherBytes,
    );
    return new TextDecoder().decode(plaintext);
}
