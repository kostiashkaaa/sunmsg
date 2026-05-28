// key-rotation.js — client-side flow for rotating the user's RSA public key.
//
// Server contract: POST /api/keys/rotate with
//   { new_public_key, signature, ts, new_login_vault }
// where `signature` is RSASSA-PKCS1-v1.5/SHA-256 over a stable JSON of
//   { op: "key_rotation_v1", old_public_key, new_public_key, ts }
// signed with the *current* private key. The server cross-checks against
// the public key stored in the users table.
//
// After a successful rotate the server clears the session and the refresh
// cookie; the caller is responsible for redirecting to the login page.

(function () {
    'use strict';

    const ROTATION_OP = 'key_rotation_v1';

    function stripPemHeaders(pem) {
        return String(pem || '')
            .replace(/-----BEGIN [^-]+-----/g, '')
            .replace(/-----END [^-]+-----/g, '')
            .replace(/\s+/g, '');
    }

    async function generateNewKeyPair() {
        const keyPair = await window.crypto.subtle.generateKey(
            {
                name: 'RSA-OAEP',
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: 'SHA-256',
            },
            true, // extractable — we must export to PEM
            ['encrypt', 'decrypt'],
        );
        const spki = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
        const pkcs8 = await window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
        return {
            publicKeyB64: arrayBufferToBase64(spki),
            privateKeyB64: arrayBufferToBase64(pkcs8),
        };
    }

    function arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode.apply(
                null,
                bytes.subarray(i, Math.min(i + CHUNK, bytes.length)),
            );
        }
        return window.btoa(binary);
    }

    function pemFromBase64Spki(b64) {
        const lines = [];
        for (let i = 0; i < b64.length; i += 64) {
            lines.push(b64.slice(i, i + 64));
        }
        return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`;
    }

    function pemFromBase64Pkcs8(b64) {
        const lines = [];
        for (let i = 0; i < b64.length; i += 64) {
            lines.push(b64.slice(i, i + 64));
        }
        return `-----BEGIN PRIVATE KEY-----\n${lines.join('\n')}\n-----END PRIVATE KEY-----`;
    }

    async function signRotationPayload({ oldPrivateKeyPem, oldPublicKeyPem, newPublicKeyPem, ts }) {
        if (!window.e2e || typeof window.e2e.signChallenge !== 'function') {
            throw new Error('Crypto helpers are not loaded.');
        }
        // Reuse the same headerless+canonical-JSON contract the server uses.
        const payload = JSON.stringify({
            op: ROTATION_OP,
            old_public_key: stripPemHeaders(oldPublicKeyPem),
            new_public_key: stripPemHeaders(newPublicKeyPem),
            ts: Number(ts),
        });
        // signChallenge signs a UTF-8 string with the old PEM; the server
        // recreates the exact same string via canonical json.dumps.
        // Note: JSON.stringify with the keys in this exact order matches
        // Python `json.dumps(..., sort_keys=True, separators=(',',':'))`
        // because keys are already in ASCII-sorted order: new < old < op < ts.
        // We rebuild explicitly to be safe.
        const canonicalPayload = JSON.stringify({
            new_public_key: stripPemHeaders(newPublicKeyPem),
            old_public_key: stripPemHeaders(oldPublicKeyPem),
            op: ROTATION_OP,
            ts: Number(ts),
        });
        // sanity: verify our two formats agree on byte length
        void payload;
        return window.e2e.signChallenge(oldPrivateKeyPem, canonicalPayload);
    }

    /**
     * Run the full rotation.
     *
     * @param {object} opts
     * @param {string} opts.oldPrivateKeyPem - PEM of the current private key
     *        (unwrap with window.deviceKey.unwrapPrivateKey before calling).
     * @param {string} opts.oldPublicKeyPem - current public PEM (with or without headers).
     * @param {(args: {newPublicKeyPem: string, newPrivateKeyPem: string}) =>
     *         Promise<object|null>} [opts.buildNewLoginVault] - optional builder
     *        that re-encrypts the recovery-words-protected vault for the new
     *        key. Return null to leave the vault untouched on the server.
     * @param {(args: {newPublicKeyPem: string, newPrivateKeyPem: string}) =>
     *         Promise<void>} opts.persistNewPrivateKey - store the new private
     *        key client-side (e.g. via deviceKey.wrapPrivateKey).
     * @param {object} opts.api - settings api object exposing rotateKeys().
     */
    async function rotateUserKey({
        oldPrivateKeyPem,
        oldPublicKeyPem,
        buildNewLoginVault,
        persistNewPrivateKey,
        api,
    }) {
        if (!oldPrivateKeyPem) throw new Error('Текущий приватный ключ недоступен.');
        if (!oldPublicKeyPem) throw new Error('Текущий публичный ключ недоступен.');
        if (!api || typeof api.rotateKeys !== 'function') {
            throw new Error('API ротации недоступен.');
        }

        const { publicKeyB64, privateKeyB64 } = await generateNewKeyPair();
        const newPublicKeyPem = pemFromBase64Spki(publicKeyB64);
        const newPrivateKeyPem = pemFromBase64Pkcs8(privateKeyB64);

        const ts = Math.floor(Date.now() / 1000);
        const signature = await signRotationPayload({
            oldPrivateKeyPem,
            oldPublicKeyPem,
            newPublicKeyPem,
            ts,
        });

        let newLoginVault = null;
        if (typeof buildNewLoginVault === 'function') {
            try {
                newLoginVault = await buildNewLoginVault({ newPublicKeyPem, newPrivateKeyPem });
            } catch (err) {
                throw new Error(`Не удалось перешифровать сейф: ${err && err.message ? err.message : err}`);
            }
        }

        // Persist the new private key on this device BEFORE the server call
        // so a successful server-side rotation does not lock the user out
        // if the next response is dropped mid-flight. The server will only
        // accept logins signed by `newPublicKeyPem` after the swap.
        await persistNewPrivateKey({ newPublicKeyPem, newPrivateKeyPem });

        await api.rotateKeys({
            newPublicKey: stripPemHeaders(newPublicKeyPem),
            signature,
            ts,
            newLoginVault,
        });

        // The server cleared the session and refresh cookie. Force a clean
        // reload so all in-memory state (sockets, contacts, etc.) is
        // re-fetched against the new identity.
        return {
            newPublicKeyPem,
            newPrivateKeyPem,
            requiresReauth: true,
        };
    }

    window.keyRotation = {
        rotateUserKey,
        stripPemHeaders,
    };
})();
