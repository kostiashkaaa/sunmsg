/**
 * Cryptography Service v2 — X25519 ECDH, Ed25519, HKDF, AES-256-GCM
 *
 * Replaces RSA-OAEP + RSASSA-PKCS1-v1_5 from crypto.js (v2 payload).
 * All keys are stored/transmitted as raw base64url bytes (no PEM).
 *
 * Key formats:
 *   X25519  — ECDH key agreement  (32-byte raw public/private)
 *   Ed25519 — signatures          (32-byte raw public, 64-byte signature)
 *   AES-256-GCM — symmetric       (32-byte raw)
 *
 * Payload version: v=3
 */

'use strict';

// ── Helpers ──────────────────────────────────────────────────────────────────

function b64uEncode(buf) {
    const bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer);
    let str = '';
    for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function b64uDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    const binary = atob(str);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

function concatBuffers(...bufs) {
    const total = bufs.reduce((n, b) => n + b.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const b of bufs) {
        out.set(new Uint8Array(b), offset);
        offset += b.byteLength;
    }
    return out.buffer;
}

function randomBytes(n) {
    return crypto.getRandomValues(new Uint8Array(n)).buffer;
}

// ── X25519 ECDH ──────────────────────────────────────────────────────────────

async function generateX25519KeyPair() {
    const kp = await crypto.subtle.generateKey({ name: 'X25519' }, true, ['deriveKey', 'deriveBits']);
    const pubRaw = await crypto.subtle.exportKey('raw', kp.publicKey);
    const privJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    return {
        publicKey: kp.publicKey,
        privateKey: kp.privateKey,
        publicKeyBytes: new Uint8Array(pubRaw),
        publicKeyB64u: b64uEncode(pubRaw),
        privateKeyJwk: privJwk,
    };
}

async function importX25519Public(b64u) {
    const raw = b64uDecode(b64u);
    return crypto.subtle.importKey('raw', raw, { name: 'X25519' }, true, []);
}

async function importX25519Private(jwk) {
    return crypto.subtle.importKey('jwk', jwk, { name: 'X25519' }, true, ['deriveKey', 'deriveBits']);
}

async function x25519DH(privateKey, publicKey) {
    const bits = await crypto.subtle.deriveBits({ name: 'X25519', public: publicKey }, privateKey, 256);
    return bits;
}

// ── Ed25519 signatures ────────────────────────────────────────────────────────

async function generateEd25519KeyPair() {
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    const pubRaw = await crypto.subtle.exportKey('raw', kp.publicKey);
    const privJwk = await crypto.subtle.exportKey('jwk', kp.privateKey);
    return {
        publicKey: kp.publicKey,
        privateKey: kp.privateKey,
        publicKeyBytes: new Uint8Array(pubRaw),
        publicKeyB64u: b64uEncode(pubRaw),
        privateKeyJwk: privJwk,
    };
}

async function importEd25519Public(b64u) {
    const raw = b64uDecode(b64u);
    return crypto.subtle.importKey('raw', raw, { name: 'Ed25519' }, true, ['verify']);
}

async function importEd25519Private(jwk) {
    return crypto.subtle.importKey('jwk', jwk, { name: 'Ed25519' }, true, ['sign']);
}

async function ed25519Sign(privateKey, data) {
    const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const sig = await crypto.subtle.sign('Ed25519', privateKey, buf);
    return b64uEncode(sig);
}

async function ed25519Verify(publicKey, data, signatureB64u) {
    const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const sig = b64uDecode(signatureB64u);
    return crypto.subtle.verify('Ed25519', publicKey, sig, buf);
}

// ── HKDF ─────────────────────────────────────────────────────────────────────

async function hkdf(inputKeyMaterial, salt, info, lengthBytes = 32) {
    const ikm = await crypto.subtle.importKey(
        'raw', inputKeyMaterial, { name: 'HKDF' }, false, ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits(
        {
            name: 'HKDF',
            hash: 'SHA-256',
            salt: salt instanceof ArrayBuffer ? salt : new Uint8Array(salt).buffer,
            info: typeof info === 'string' ? new TextEncoder().encode(info) : info,
        },
        ikm,
        lengthBytes * 8
    );
    return bits;
}

// ── AES-256-GCM ───────────────────────────────────────────────────────────────

async function aesGcmEncrypt(keyBytes, plaintext) {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = randomBytes(12);
    const data = typeof plaintext === 'string' ? new TextEncoder().encode(plaintext) : plaintext;
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    return { ciphertext: ct, iv };
}

async function aesGcmDecrypt(keyBytes, ciphertext, iv) {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
}

// ── X3DH key agreement ────────────────────────────────────────────────────────
//
// Инициатор (Alice) вычисляет мастер-секрет из 4 ECDH операций:
//   DH1 = DH(IKa, SPKb)   IK Alice  × Signed Prekey Bob
//   DH2 = DH(EKa, IKb)    Ephemeral × IK Bob
//   DH3 = DH(EKa, SPKb)   Ephemeral × Signed Prekey Bob
//   DH4 = DH(EKa, OPKb)   Ephemeral × One-Time Prekey Bob (опционально)
//   masterSecret = HKDF(DH1 || DH2 || DH3 [|| DH4])

async function x3dhInitiatorSecretAndEphemeral(
    aliceIdentityPriv,    // CryptoKey X25519
    bobBundle             // { identityKey, signedPrekey, signedPrekeyId, signature, oneTimePrekey?, oneTimePrekeyId? }
) {
    const bobIK = await importX25519Public(bobBundle.identityKey);
    const bobSPK = await importX25519Public(bobBundle.signedPrekey);

    const ephemeral = await generateX25519KeyPair();

    const dh1 = await x25519DH(aliceIdentityPriv, bobSPK);
    const dh2 = await x25519DH(ephemeral.privateKey, bobIK);
    const dh3 = await x25519DH(ephemeral.privateKey, bobSPK);

    let ikm = concatBuffers(dh1, dh2, dh3);

    let usedOneTimePrekey = null;
    if (bobBundle.oneTimePrekey) {
        const bobOPK = await importX25519Public(bobBundle.oneTimePrekey);
        const dh4 = await x25519DH(ephemeral.privateKey, bobOPK);
        ikm = concatBuffers(ikm, dh4);
        usedOneTimePrekey = bobBundle.oneTimePrekeyId;
    }

    const salt = new Uint8Array(32).buffer;
    const masterSecret = await hkdf(ikm, salt, 'SUN-X3DH-v1', 64);

    return {
        masterSecret,
        ephemeralPublicKeyB64u: ephemeral.publicKeyB64u,
        usedSignedPrekeyId: bobBundle.signedPrekeyId,
        usedOneTimePrekeyId: usedOneTimePrekey,
    };
}

async function x3dhResponderSecret(
    bobIdentityPriv,      // CryptoKey X25519
    bobSignedPrekeyPriv,  // CryptoKey X25519
    aliceIdentityPubB64u, // string
    aliceEphemeralPubB64u,// string
    bobOneTimePrekeyPriv  // CryptoKey X25519 | null
) {
    const aliceIK = await importX25519Public(aliceIdentityPubB64u);
    const aliceEK = await importX25519Public(aliceEphemeralPubB64u);

    const dh1 = await x25519DH(bobSignedPrekeyPriv, aliceIK);
    const dh2 = await x25519DH(bobIdentityPriv, aliceEK);
    const dh3 = await x25519DH(bobSignedPrekeyPriv, aliceEK);

    let ikm = concatBuffers(dh1, dh2, dh3);

    if (bobOneTimePrekeyPriv) {
        const dh4 = await x25519DH(bobOneTimePrekeyPriv, aliceEK);
        ikm = concatBuffers(ikm, dh4);
    }

    const salt = new Uint8Array(32).buffer;
    return hkdf(ikm, salt, 'SUN-X3DH-v1', 64);
}

// ── One-shot E2EE (нет DR сессии, fallback для первого сообщения) ────────────
//
// Шифрует сообщение для получателя у которого нет DR сессии.
// Возвращает payload версии v=3 с ephemeral X3DH.

async function encryptMessageX3DH(
    senderIdentityPrivKey,  // CryptoKey X25519 (приватный)
    senderIdentityPubB64u,  // string
    senderEd25519PrivKey,   // CryptoKey Ed25519
    recipientBundle,        // prekey bundle от сервера
    plaintext               // string
) {
    const { masterSecret, ephemeralPublicKeyB64u, usedSignedPrekeyId, usedOneTimePrekeyId } =
        await x3dhInitiatorSecretAndEphemeral(senderIdentityPrivKey, recipientBundle);

    const encKey = masterSecret.slice(0, 32);
    const { ciphertext, iv } = await aesGcmEncrypt(encKey, plaintext);

    const payload = {
        v: 3,
        proto: 'x3dh',
        sender_ik: senderIdentityPubB64u,
        ephemeral_key: ephemeralPublicKeyB64u,
        spk_id: usedSignedPrekeyId,
        otpk_id: usedOneTimePrekeyId ?? undefined,
        ct: b64uEncode(ciphertext),
        iv: b64uEncode(iv),
    };

    const toSign = JSON.stringify({
        v: payload.v,
        proto: payload.proto,
        sender_ik: payload.sender_ik,
        ephemeral_key: payload.ephemeral_key,
        spk_id: payload.spk_id,
        ct: payload.ct,
        iv: payload.iv,
    });
    payload.sig = await ed25519Sign(senderEd25519PrivKey, toSign);
    payload.sig_alg = 'Ed25519';

    return JSON.stringify(payload);
}

async function decryptMessageX3DH(
    recipientIdentityPrivKey,   // CryptoKey X25519
    recipientSignedPrekeyPriv,  // CryptoKey X25519
    recipientOneTimePrekeyPriv, // CryptoKey X25519 | null
    senderEd25519PubB64u,       // string для верификации подписи
    payloadStr                  // JSON string
) {
    const payload = JSON.parse(payloadStr);
    if (payload.v !== 3 || payload.proto !== 'x3dh') throw new Error('not_x3dh_v3');

    // X3DH-payload всегда подписывается отправителем (см. encryptMessageX3DH).
    // Если ключ известен, но подписи/её валидности нет — помечаем непроверенным,
    // вместо того чтобы молча доверять.
    let unverified = false;
    if (senderEd25519PubB64u && payload.sig) {
        const pubKey = await importEd25519Public(senderEd25519PubB64u);
        const toVerify = JSON.stringify({
            v: payload.v,
            proto: payload.proto,
            sender_ik: payload.sender_ik,
            ephemeral_key: payload.ephemeral_key,
            spk_id: payload.spk_id,
            ct: payload.ct,
            iv: payload.iv,
        });
        const ok = await ed25519Verify(pubKey, toVerify, payload.sig);
        if (!ok) return '[Подпись сообщения не прошла проверку]';
    } else if (senderEd25519PubB64u) {
        unverified = true;
    }

    const masterSecret = await x3dhResponderSecret(
        recipientIdentityPrivKey,
        recipientSignedPrekeyPriv,
        payload.sender_ik,
        payload.ephemeral_key,
        recipientOneTimePrekeyPriv
    );

    const encKey = masterSecret.slice(0, 32);
    try {
        const pt = await aesGcmDecrypt(encKey, b64uDecode(payload.ct), b64uDecode(payload.iv));
        const text = new TextDecoder().decode(pt);
        return unverified ? '⚠️ [не проверено] ' + text : text;
    } catch {
        return '⚠️ [Ошибка расшифровки сообщения]';
    }
}

// ── Файловое шифрование ───────────────────────────────────────────────────────
//
// file_key — случайный 32-байтовый AES-256 ключ.
// Сам файл шифруется локально, file_key отправляется внутри E2EE-сообщения.

async function encryptFile(fileArrayBuffer) {
    const fileKey = randomBytes(32);
    const { ciphertext, iv } = await aesGcmEncrypt(fileKey, fileArrayBuffer);
    const hashBuf = await crypto.subtle.digest('SHA-256', fileArrayBuffer);
    return {
        encryptedFile: ciphertext,
        fileKey: b64uEncode(fileKey),
        iv: b64uEncode(iv),
        sha256: b64uEncode(hashBuf),
        size: fileArrayBuffer.byteLength,
    };
}

async function decryptFile(encryptedBuffer, fileKeyB64u, ivB64u, expectedSha256B64u) {
    const keyBytes = b64uDecode(fileKeyB64u);
    const iv = b64uDecode(ivB64u);
    const plaintext = await aesGcmDecrypt(keyBytes, encryptedBuffer, iv);
    if (expectedSha256B64u) {
        const hash = await crypto.subtle.digest('SHA-256', plaintext);
        if (b64uEncode(hash) !== expectedSha256B64u) {
            throw new Error('file_integrity_check_failed');
        }
    }
    return plaintext;
}

// ── Public API ────────────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
    window.cryptoV2 = {
        // Ключевые пары
        generateX25519KeyPair,
        generateEd25519KeyPair,
        importX25519Public,
        importX25519Private,
        importEd25519Public,
        importEd25519Private,
        // Примитивы
        x25519DH,
        hkdf,
        aesGcmEncrypt,
        aesGcmDecrypt,
        ed25519Sign,
        ed25519Verify,
        // X3DH
        x3dhInitiatorSecretAndEphemeral,
        x3dhResponderSecret,
        encryptMessageX3DH,
        decryptMessageX3DH,
        // Файлы
        encryptFile,
        decryptFile,
        // Утилиты
        b64uEncode,
        b64uDecode,
        randomBytes,
    };
}
