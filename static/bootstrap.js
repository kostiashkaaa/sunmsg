(() => {
    'use strict';

    const BOOTSTRAP_SCRIPT_ID = 'sun-bootstrap-data';
    const DEFAULT_QRCODE_SRC = '/static/vendor/js/qrcode.min.js';

    function asObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    function asString(value) {
        return String(value ?? '').trim();
    }

    function asLanguage(value) {
        return asString(value).toLowerCase() === 'en' ? 'en' : 'ru';
    }

    function asTransports(value) {
        if (!Array.isArray(value)) {
            return ['polling', 'websocket'];
        }
        const transports = value
            .filter((item) => typeof item === 'string')
            .map((item) => item.trim())
            .filter(Boolean);
        return transports.length > 0 ? transports : ['polling', 'websocket'];
    }

    function asAppRoot(value) {
        const raw = asString(value);
        if (!raw || raw === '/') return '';
        const prefixed = raw.startsWith('/') ? raw : `/${raw}`;
        return prefixed.replace(/\/+$/, '');
    }

    function asWebPushConfig(value) {
        const raw = asObject(value);
        return {
            enabled: Boolean(raw.enabled),
            publicKey: asString(raw.publicKey),
        };
    }

    function readBootstrapPayload() {
        const script = document.getElementById(BOOTSTRAP_SCRIPT_ID);
        if (!script) return {};
        const raw = script.textContent || '{}';
        try {
            return asObject(JSON.parse(raw));
        } catch (_error) {
            return {};
        }
    }

    function buildBootstrap() {
        const bodyDataset = asObject(document.body?.dataset);
        const payload = readBootstrapPayload();
        const userPayload = asObject(payload.user);
        const socketPayload = asObject(payload.socketio);
        const assetsPayload = asObject(payload.assets);
        const appPayload = asObject(payload.app);

        const user = {
            currentUserPublicKey: asString(userPayload.currentUserPublicKey || bodyDataset.currentUserPublicKey),
            currentDisplayName: asString(userPayload.currentDisplayName || bodyDataset.currentDisplayName),
            currentUsername: asString(userPayload.currentUsername || bodyDataset.currentUsername),
            currentUserId: asString(userPayload.currentUserId || bodyDataset.currentUserId),
            currentAvatarUrl: asString(userPayload.currentAvatarUrl || bodyDataset.currentAvatarUrl),
            initialChatContactUsername: asString(
                userPayload.initialChatContactUsername || bodyDataset.initialChatContactUsername
            ).toLowerCase(),
            uiLanguage: asLanguage(userPayload.uiLanguage || bodyDataset.uiLanguage || document.documentElement.lang),
        };

        return {
            page: asString(payload.page || bodyDataset.page),
            user,
            socketio: {
                transports: asTransports(socketPayload.transports),
                upgrade: socketPayload.upgrade !== false,
            },
            app: {
                root: asAppRoot(appPayload.root || bodyDataset.appRoot),
                webPush: asWebPushConfig(appPayload.webPush),
            },
            assets: {
                qrcodeSrc: asString(assetsPayload.qrcodeSrc || DEFAULT_QRCODE_SRC),
            },
        };
    }

    const bootstrap = buildBootstrap();
    window.SUN_BOOTSTRAP = bootstrap;
    window.getSunBootstrap = () => bootstrap;

    // Transitional compatibility for legacy scripts while modules migrate off window.*
    window.SUN_QRCODE_SRC = bootstrap.assets.qrcodeSrc;
    window.SUN_SOCKETIO_CONFIG = bootstrap.socketio;
    window.SUN_APP_ROOT = bootstrap.app.root;
    window.SUN_WEB_PUSH_CONFIG = bootstrap.app.webPush;
    window.currentUserPublicKey = bootstrap.user.currentUserPublicKey;
    window.currentDisplayName = bootstrap.user.currentDisplayName;
    window.currentUsername = bootstrap.user.currentUsername;
    window.currentUserId = bootstrap.user.currentUserId;
    window.currentAvatarUrl = bootstrap.user.currentAvatarUrl;
})();
