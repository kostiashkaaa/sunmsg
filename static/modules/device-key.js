// device-key.js -- non-extractable AES-GCM key kept in IndexedDB.
// Wraps/unwraps the RSA private key as ciphertext for cross-page handoff.
// Exposes window.deviceKey with persistent and session-scoped wrapped storage.

(function () {
    'use strict';

    const DB_NAME = 'sun-device-key';
    const STORE = 'keys';
    const KEY_ID = 'device-aes-gcm-v1';
    const LS_WRAPPED_PERSISTENT = 'e2e_private_key_wrapped';
    const SS_WRAPPED_SESSION = 'e2e_private_key_wrapped_session';
    // Persistent wrap defaults to 7 days (was 30). Users who want the
    // longer 30-day window must opt in via ttlSeconds at wrap time. The
    // shorter default reduces the window where a stolen device still
    // holds an unwrapping path to the user's private key.
    const DEFAULT_PERSISTENT_TTL_SECONDS = 7 * 24 * 60 * 60;

    function openDb() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, 1);
            req.onupgradeneeded = () => {
                const db = req.result;
                if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    function idbGet(db, key) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(key);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }

    function idbPut(db, key, value) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    function idbDelete(db, key) {
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    }

    async function getOrCreateDeviceKey() {
        const db = await openDb();
        let key = await idbGet(db, KEY_ID);
        if (key) return key;
        key = await window.crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            false, // non-extractable
            ['encrypt', 'decrypt']
        );
        await idbPut(db, KEY_ID, key);
        return key;
    }

    function b64encode(buf) {
        const bytes = new Uint8Array(buf);
        let s = '';
        for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s);
    }

    function b64decode(str) {
        const bin = atob(str);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    function getSessionStorage() {
        try {
            return window.sessionStorage;
        } catch (_) {
            return null;
        }
    }

    function nowSeconds() {
        return Math.floor(Date.now() / 1000);
    }

    function positiveInteger(value) {
        const parsed = Number(value || 0);
        if (!Number.isFinite(parsed) || parsed <= 0) return 0;
        return Math.floor(parsed);
    }

    function resolvePersistentMetadata(options = {}) {
        const ttlSeconds = positiveInteger(options.ttlSeconds ?? options.sessionAutoLogoutSeconds)
            || DEFAULT_PERSISTENT_TTL_SECONDS;
        const expiresAt = positiveInteger(options.expiresAt ?? options.sessionExpiresAt)
            || (nowSeconds() + ttlSeconds);
        return { ttlSeconds, expiresAt };
    }

    function removePersistentWrappedPayload() {
        try { localStorage.removeItem(LS_WRAPPED_PERSISTENT); } catch (_) {}
    }

    function removeSessionWrappedPayload() {
        const session = getSessionStorage();
        if (!session) return;
        try { session.removeItem(SS_WRAPPED_SESSION); } catch (_) {}
    }

    function parseWrappedPayload(raw, source) {
        if (!raw) return null;
        let payload = null;
        try {
            payload = JSON.parse(raw);
        } catch (_) {
            if (source === 'persistent') removePersistentWrappedPayload();
            else removeSessionWrappedPayload();
            return null;
        }
        if (!payload || payload.v !== 1 || !payload.iv || !payload.data) {
            if (source === 'persistent') removePersistentWrappedPayload();
            else removeSessionWrappedPayload();
            return null;
        }
        if (source === 'persistent') {
            const expiresAt = positiveInteger(payload.expiresAt);
            if (!expiresAt || expiresAt <= nowSeconds()) {
                removePersistentWrappedPayload();
                return null;
            }
        }
        return { raw, payload, source };
    }

    function readPersistentWrappedPayload() {
        try {
            return parseWrappedPayload(localStorage.getItem(LS_WRAPPED_PERSISTENT), 'persistent');
        } catch (_) {
            return null;
        }
    }

    function readSessionWrappedPayload() {
        const session = getSessionStorage();
        if (!session) return null;
        try {
            return parseWrappedPayload(session.getItem(SS_WRAPPED_SESSION), 'session');
        } catch (_) {
            return null;
        }
    }

    function readWrappedPayload(preferSession = true) {
        const sessionPayload = readSessionWrappedPayload();
        const persistentPayload = readPersistentWrappedPayload();

        if (preferSession && sessionPayload) {
            return sessionPayload;
        }
        if (persistentPayload) {
            return persistentPayload;
        }
        if (sessionPayload) {
            return sessionPayload;
        }
        return null;
    }

    function writeWrappedPayload(payload, persistent) {
        if (persistent) {
            localStorage.setItem(LS_WRAPPED_PERSISTENT, payload);
            removeSessionWrappedPayload();
            return;
        }

        const session = getSessionStorage();
        if (!session) throw new Error('Хранилище сессии недоступно.');
        session.setItem(SS_WRAPPED_SESSION, payload);
        removePersistentWrappedPayload();
    }

    function hasPersistentWrappedKey() {
        return !!readPersistentWrappedPayload();
    }

    function hasSessionWrappedKey() {
        return !!readSessionWrappedPayload();
    }

    async function wrapPrivateKey(pem, options = {}) {
        if (!pem) return false;
        const persistent = options?.persistent === true;

        try {
            const key = await getOrCreateDeviceKey();
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const enc = new TextEncoder().encode(pem);
            const ct = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc);
            const payloadObj = {
                v: 1,
                iv: b64encode(iv.buffer),
                data: b64encode(ct),
                persistent,
                createdAt: nowSeconds(),
            };
            if (persistent) {
                const metadata = resolvePersistentMetadata(options);
                payloadObj.ttlSeconds = metadata.ttlSeconds;
                payloadObj.expiresAt = metadata.expiresAt;
            }
            const payload = JSON.stringify(payloadObj);
            writeWrappedPayload(payload, persistent);
            return true;
        } catch (_) {
            return false;
        }
    }

    async function unwrapPrivateKey(options = {}) {
        const preferSession = options?.preferSession !== false;
        const consumeSession = options?.consumeSession !== false;
        const wrapped = readWrappedPayload(preferSession);
        if (!wrapped) return '';

        try {
            const payload = wrapped.payload;
            const key = await getOrCreateDeviceKey();
            const iv = b64decode(payload.iv);
            const ct = b64decode(payload.data);
            const pt = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
            const pem = new TextDecoder().decode(pt);
            if (wrapped.source === 'session' && consumeSession) {
                removeSessionWrappedPayload();
            } else if (wrapped.source === 'persistent') {
                touchPersistentWrappedKey({ ttlSeconds: payload.ttlSeconds });
            }
            return pem;
        } catch (_) {
            if (wrapped.source === 'session') {
                removeSessionWrappedPayload();
            } else {
                removePersistentWrappedPayload();
            }
            return '';
        }
    }

    function hasWrappedKey() {
        return hasSessionWrappedKey() || hasPersistentWrappedKey();
    }

    function touchPersistentWrappedKey(options = {}) {
        const wrapped = readPersistentWrappedPayload();
        if (!wrapped) return false;

        const explicitExpiresAt = positiveInteger(options.expiresAt ?? options.sessionExpiresAt);
        if (explicitExpiresAt && explicitExpiresAt <= nowSeconds()) {
            removePersistentWrappedPayload();
            return false;
        }

        const metadata = resolvePersistentMetadata({
            ttlSeconds: options.ttlSeconds ?? options.sessionAutoLogoutSeconds ?? wrapped.payload.ttlSeconds,
            expiresAt: explicitExpiresAt,
        });
        const nextPayload = {
            ...wrapped.payload,
            ttlSeconds: metadata.ttlSeconds,
            expiresAt: metadata.expiresAt,
            touchedAt: nowSeconds(),
        };
        try {
            localStorage.setItem(LS_WRAPPED_PERSISTENT, JSON.stringify(nextPayload));
            return true;
        } catch (_) {
            return false;
        }
    }

    async function clearWrappedPersistent() {
        removePersistentWrappedPayload();
    }

    async function clearWrappedSession() {
        removeSessionWrappedPayload();
    }

    async function clear() {
        removeSessionWrappedPayload();
        removePersistentWrappedPayload();
        try {
            const db = await openDb();
            await idbDelete(db, KEY_ID);
        } catch (_) {}
    }

    // ── X25519 + Ed25519 keys (crypto v2) ──────────────────────────────────────
    // Private keys are stored as encrypted JSON (same wrapping mechanisms).
    // Public keys are stored in plain localStorage (not secret).

    const LS_V2_PUBLIC_KEYS = 'sun_v2_public_keys';
    const SS_V2_PRIVATE_KEYS_SESSION = 'sun_v2_private_keys_session';
    const LS_V2_PRIVATE_KEYS_PERSISTENT = 'sun_v2_private_keys_persistent';

    async function generateV2KeyPair() {
        if (!window.cryptoV2) throw new Error('crypto-v2.js not loaded');
        const cv2 = window.cryptoV2;
        const x25519 = await cv2.generateX25519KeyPair();
        const ed25519 = await cv2.generateEd25519KeyPair();
        return {
            x25519: {
                publicKeyB64u: x25519.publicKeyB64u,
                privateKeyJwk: x25519.privateKeyJwk,
            },
            ed25519: {
                publicKeyB64u: ed25519.publicKeyB64u,
                privateKeyJwk: ed25519.privateKeyJwk,
            },
        };
    }

    async function storeV2KeyPair(keyPair, options = {}) {
        const persistent = options?.persistent === true;

        // Public keys in localStorage (not secret)
        try {
            localStorage.setItem(LS_V2_PUBLIC_KEYS, JSON.stringify({
                x25519: keyPair.x25519.publicKeyB64u,
                ed25519: keyPair.ed25519.publicKeyB64u,
            }));
        } catch (_) {}

        // Private keys are encrypted with the device key
        const privJson = JSON.stringify({
            x25519Jwk: keyPair.x25519.privateKeyJwk,
            ed25519Jwk: keyPair.ed25519.privateKeyJwk,
        });

        const deviceKey = await getOrCreateDeviceKey();
        const iv = window.crypto.getRandomValues(new Uint8Array(12));
        const ct = await window.crypto.subtle.encrypt(
            { name: 'AES-GCM', iv },
            deviceKey,
            new TextEncoder().encode(privJson)
        );

        const created = nowSeconds();
        const ttlSeconds = persistent
            ? (positiveInteger(options.ttlSeconds) || DEFAULT_PERSISTENT_TTL_SECONDS)
            : 0;
        const wrapped = JSON.stringify({
            v: 1,
            iv: b64encode(iv.buffer),
            data: b64encode(ct),
            persistent,
            createdAt: created,
            // Mirror the V1 wrap format: persistent stores get an explicit
            // expiry so loadV2PrivateKeys can drop stale material instead
            // of trusting it indefinitely.
            ttlSeconds,
            expiresAt: persistent ? (created + ttlSeconds) : 0,
        });

        const storageKey = persistent ? LS_V2_PRIVATE_KEYS_PERSISTENT : SS_V2_PRIVATE_KEYS_SESSION;
        try {
            if (persistent) localStorage.setItem(storageKey, wrapped);
            else (getSessionStorage() || localStorage).setItem(storageKey, wrapped);
        } catch (_) {}
    }

    async function loadV2PrivateKeys() {
        const ssRaw = (() => {
            try { return (getSessionStorage() || localStorage).getItem(SS_V2_PRIVATE_KEYS_SESSION); }
            catch (_) { return null; }
        })();
        const lsRaw = (() => {
            try { return localStorage.getItem(LS_V2_PRIVATE_KEYS_PERSISTENT); }
            catch (_) { return null; }
        })();
        const raw = ssRaw || lsRaw;
        if (!raw) return null;

        try {
            const payload = JSON.parse(raw);
            if (!payload?.v || !payload.iv || !payload.data) return null;
            // Honor explicit expiry on persistent wraps. Session-scoped
            // wraps have expiresAt === 0 and skip this check.
            const expiresAt = positiveInteger(payload.expiresAt);
            if (payload.persistent && expiresAt && expiresAt <= nowSeconds()) {
                try { localStorage.removeItem(LS_V2_PRIVATE_KEYS_PERSISTENT); } catch (_) {}
                return null;
            }
            const deviceKey = await getOrCreateDeviceKey();
            const pt = await window.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: b64decode(payload.iv) },
                deviceKey,
                b64decode(payload.data)
            );
            return JSON.parse(new TextDecoder().decode(pt));
        } catch (_) {
            return null;
        }
    }

    function loadV2PublicKeys() {
        try {
            const raw = localStorage.getItem(LS_V2_PUBLIC_KEYS);
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    function clearV2Keys() {
        try { localStorage.removeItem(LS_V2_PUBLIC_KEYS); } catch (_) {}
        try { localStorage.removeItem(LS_V2_PRIVATE_KEYS_PERSISTENT); } catch (_) {}
        try { (getSessionStorage() || localStorage).removeItem(SS_V2_PRIVATE_KEYS_SESSION); } catch (_) {}
    }

    function hasV2Keys() {
        return !!loadV2PublicKeys();
    }

    window.deviceKey = {
        wrapPrivateKey,
        unwrapPrivateKey,
        hasWrappedKey,
        hasPersistentWrappedKey,
        hasSessionWrappedKey,
        touchPersistentWrappedKey,
        clearWrappedPersistent,
        clearWrappedSession,
        clear,
        // crypto v2
        generateV2KeyPair,
        storeV2KeyPair,
        loadV2PrivateKeys,
        loadV2PublicKeys,
        clearV2Keys,
        hasV2Keys,
    };
})();

