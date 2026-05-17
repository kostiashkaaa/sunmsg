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

    function removePersistentWrappedPayload() {
        try { localStorage.removeItem(LS_WRAPPED_PERSISTENT); } catch (_) {}
    }

    function removeSessionWrappedPayload() {
        const session = getSessionStorage();
        if (!session) return;
        try { session.removeItem(SS_WRAPPED_SESSION); } catch (_) {}
    }

    function readWrappedPayload(preferSession = true) {
        const session = getSessionStorage();
        const sessionPayload = session ? session.getItem(SS_WRAPPED_SESSION) : null;
        const persistentPayload = localStorage.getItem(LS_WRAPPED_PERSISTENT);

        if (preferSession && sessionPayload) {
            return { payload: sessionPayload, source: 'session' };
        }
        if (persistentPayload) {
            return { payload: persistentPayload, source: 'persistent' };
        }
        if (sessionPayload) {
            return { payload: sessionPayload, source: 'session' };
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
        return !!localStorage.getItem(LS_WRAPPED_PERSISTENT);
    }

    function hasSessionWrappedKey() {
        const session = getSessionStorage();
        return !!session && !!session.getItem(SS_WRAPPED_SESSION);
    }

    async function wrapPrivateKey(pem, options = {}) {
        if (!pem) return false;
        const persistent = options?.persistent === true;

        try {
            const key = await getOrCreateDeviceKey();
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const enc = new TextEncoder().encode(pem);
            const ct = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc);
            const payload = JSON.stringify({ v: 1, iv: b64encode(iv.buffer), data: b64encode(ct) });
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
            const payload = JSON.parse(wrapped.payload);
            if (!payload || payload.v !== 1 || !payload.iv || !payload.data) return '';
            const key = await getOrCreateDeviceKey();
            const iv = b64decode(payload.iv);
            const ct = b64decode(payload.data);
            const pt = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
            const pem = new TextDecoder().decode(pt);
            if (wrapped.source === 'session' && consumeSession) {
                removeSessionWrappedPayload();
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

    removePersistentWrappedPayload();

    window.deviceKey = {
        wrapPrivateKey,
        unwrapPrivateKey,
        hasWrappedKey,
        hasPersistentWrappedKey,
        hasSessionWrappedKey,
        clearWrappedPersistent,
        clearWrappedSession,
        clear,
    };
})();

