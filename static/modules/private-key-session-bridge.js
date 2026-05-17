// private-key-session-bridge.js
// Keeps the decrypted private key in memory only and coordinates wrapped key
// handoff across page navigations.
(function () {
    'use strict';

    const PRIVATE_KEY_STATUS_EVENT = 'sun-private-key-status-changed';
    const LEGACY_PRIVATE_KEY_STORAGE_KEY = 'e2e_private_key';
    const DEFAULT_SESSION_AUTO_LOGOUT_SECONDS = 30 * 24 * 60 * 60;

    let inMemoryPrivateKeyPem = '';

    function normalizePem(value) {
        return String(value || '').trim();
    }

    function hasDeviceKeyApi() {
        return !!window.deviceKey && typeof window.deviceKey.wrapPrivateKey === 'function';
    }

    function positiveInteger(value) {
        const parsed = Number(value || 0);
        if (!Number.isFinite(parsed) || parsed <= 0) return 0;
        return Math.floor(parsed);
    }

    function readBootstrapSession() {
        return window.SUN_BOOTSTRAP?.session || {};
    }

    function resolveSessionAutoLogoutSeconds(options = {}) {
        return positiveInteger(options.sessionAutoLogoutSeconds ?? options.ttlSeconds)
            || positiveInteger(readBootstrapSession().autoLogoutSeconds)
            || positiveInteger(window.SUN_SESSION_AUTO_LOGOUT_SECONDS)
            || DEFAULT_SESSION_AUTO_LOGOUT_SECONDS;
    }

    function resolveSessionExpiresAt(options = {}) {
        return positiveInteger(options.sessionExpiresAt ?? options.expiresAt)
            || positiveInteger(readBootstrapSession().expiresAt)
            || 0;
    }

    function buildPersistentWrapOptions(options = {}) {
        const persistent = options?.persistent === true || options?.rememberDevice === true;
        const ttlSeconds = resolveSessionAutoLogoutSeconds(options);
        const expiresAt = resolveSessionExpiresAt(options);
        return {
            persistent,
            ttlSeconds,
            expiresAt: expiresAt || Math.floor(Date.now() / 1000) + ttlSeconds,
        };
    }

    function notifyPrivateKeyStatusChanged() {
        window.dispatchEvent(new Event(PRIVATE_KEY_STATUS_EVENT));
    }

    function clearLegacyPlaintextKeyStorage() {
        try { sessionStorage.removeItem(LEGACY_PRIVATE_KEY_STORAGE_KEY); } catch (_) {}
        try { localStorage.removeItem(LEGACY_PRIVATE_KEY_STORAGE_KEY); } catch (_) {}
    }

    function getPrivateKeyPem() {
        return inMemoryPrivateKeyPem;
    }

    function hasPrivateKeyPem() {
        return Boolean(inMemoryPrivateKeyPem);
    }

    function setPrivateKeyPem(pem, options = {}) {
        const notify = options?.notify !== false;
        inMemoryPrivateKeyPem = normalizePem(pem);
        clearLegacyPlaintextKeyStorage();
        if (notify) notifyPrivateKeyStatusChanged();
        return Boolean(inMemoryPrivateKeyPem);
    }

    async function clearPrivateKeyPem(options = {}) {
        const notify = options?.notify !== false;
        const clearWrappedSession = options?.clearWrappedSession === true;
        const clearWrappedPersistent = options?.clearWrappedPersistent === true;
        const clearDeviceKey = options?.clearDeviceKey === true;

        inMemoryPrivateKeyPem = '';
        clearLegacyPlaintextKeyStorage();

        if (window.deviceKey) {
            try {
                if (clearDeviceKey && typeof window.deviceKey.clear === 'function') {
                    await window.deviceKey.clear();
                } else {
                    if (clearWrappedSession && typeof window.deviceKey.clearWrappedSession === 'function') {
                        await window.deviceKey.clearWrappedSession();
                    }
                    if (clearWrappedPersistent && typeof window.deviceKey.clearWrappedPersistent === 'function') {
                        await window.deviceKey.clearWrappedPersistent();
                    }
                }
            } catch (_) {}
        }

        if (notify) notifyPrivateKeyStatusChanged();
    }

    async function clearWrappedKeyArtifacts() {
        if (!window.deviceKey) return;
        try {
            if (typeof window.deviceKey.clearWrappedSession === 'function') {
                await window.deviceKey.clearWrappedSession();
            }
            if (typeof window.deviceKey.clearWrappedPersistent === 'function') {
                await window.deviceKey.clearWrappedPersistent();
            }
        } catch (_) {}
    }

    async function stagePrivateKeyForRedirect(pem, options = {}) {
        const notify = options?.notify !== false;
        const normalizedPem = normalizePem(pem);
        if (!normalizedPem) return false;

        // Update in-memory state first, then require wrapped transport to succeed.
        setPrivateKeyPem(normalizedPem, { notify: false });

        if (!hasDeviceKeyApi()) {
            inMemoryPrivateKeyPem = '';
            await clearWrappedKeyArtifacts();
            if (notify) notifyPrivateKeyStatusChanged();
            return false;
        }

        let wrapped = false;
        try {
            wrapped = await window.deviceKey.wrapPrivateKey(normalizedPem, buildPersistentWrapOptions(options));
        } catch (_) {
            wrapped = false;
        }

        if (!wrapped) {
            inMemoryPrivateKeyPem = '';
            await clearWrappedKeyArtifacts();
            if (notify) notifyPrivateKeyStatusChanged();
            return false;
        }

        clearLegacyPlaintextKeyStorage();
        if (notify) notifyPrivateKeyStatusChanged();
        return true;
    }

    async function restoreWrappedPrivateKey(options = {}) {
        const force = options?.force === true;
        const notify = options?.notify !== false;
        // Keep session-scoped wrapped key across reloads by default.
        // It is cleared on logout/device-key reset.
        const consumeSession = options?.consumeSession === true;

        if (!force && inMemoryPrivateKeyPem) {
            if (notify) notifyPrivateKeyStatusChanged();
            return true;
        }

        clearLegacyPlaintextKeyStorage();

        if (!window.deviceKey || typeof window.deviceKey.unwrapPrivateKey !== 'function') {
            if (notify) notifyPrivateKeyStatusChanged();
            return false;
        }
        if (typeof window.deviceKey.hasWrappedKey === 'function' && !window.deviceKey.hasWrappedKey()) {
            inMemoryPrivateKeyPem = '';
            if (notify) notifyPrivateKeyStatusChanged();
            return false;
        }

        let pem = '';
        try {
            pem = await window.deviceKey.unwrapPrivateKey({ consumeSession });
        } catch (_) {
            pem = '';
        }

        inMemoryPrivateKeyPem = normalizePem(pem);
        clearLegacyPlaintextKeyStorage();
        if (notify) notifyPrivateKeyStatusChanged();
        return Boolean(inMemoryPrivateKeyPem);
    }

    function touchPersistentKeyFromSession(payload = {}) {
        if (!window.deviceKey || typeof window.deviceKey.touchPersistentWrappedKey !== 'function') {
            return false;
        }
        return window.deviceKey.touchPersistentWrappedKey({
            sessionAutoLogoutSeconds: payload.session_auto_logout_seconds ?? payload.sessionAutoLogoutSeconds,
            sessionExpiresAt: payload.session_expires_at ?? payload.sessionExpiresAt,
        });
    }

    clearLegacyPlaintextKeyStorage();

    window.sunPrivateKeySession = {
        getPrivateKeyPem,
        hasPrivateKeyPem,
        setPrivateKeyPem,
        clearPrivateKeyPem,
        stagePrivateKeyForRedirect,
        restoreWrappedPrivateKey,
        touchPersistentKeyFromSession,
        notifyPrivateKeyStatusChanged,
        clearLegacyPlaintextKeyStorage,
    };
})();
