(() => {
    'use strict';

    const BOOTSTRAP_SCRIPT_ID = 'sun-bootstrap-data';
    const DEFAULT_QRCODE_SRC = '/static/vendor/js/qrcode.min.js';
    const MESSAGE_SCALE_MIN = 0.9;
    const MESSAGE_SCALE_MAX = 1.3;
    const PERFORMANCE_MODES = new Set(['auto', 'full', 'lite']);
    const MOTION_LEVELS = new Set(['auto', 'full', 'balanced', 'lite']);
    const SEND_SHORTCUT_MODES = new Set(['enter', 'ctrl_enter']);
    const TIME_FORMAT_MODES = new Set(['24h', '12h']);

    function asObject(value) {
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    }

    function asString(value) {
        return String(value ?? '').trim();
    }

    function asLanguage(value) {
        return asString(value).toLowerCase() === 'en' ? 'en' : 'ru';
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
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

    function asJsonObject(value, maxLength) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return null;
        }
        try {
            const packed = JSON.stringify(value);
            if (!packed || packed.length > maxLength) return null;
            const parsed = JSON.parse(packed);
            return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
        } catch (_error) {
            return null;
        }
    }

    function asClientPreferences(value) {
        const raw = asObject(value);
        const out = {};

        if (typeof raw.darkMode === 'boolean') {
            out.darkMode = raw.darkMode;
        }

        const messageScaleRaw = Number(raw.messageScale);
        if (Number.isFinite(messageScaleRaw)) {
            out.messageScale = Number(clamp(messageScaleRaw, MESSAGE_SCALE_MIN, MESSAGE_SCALE_MAX).toFixed(2));
        }

        const performanceMode = asString(raw.performanceMode).toLowerCase();
        if (PERFORMANCE_MODES.has(performanceMode)) {
            out.performanceMode = performanceMode;
        }

        const motionLevel = asString(raw.motionLevel).toLowerCase();
        if (MOTION_LEVELS.has(motionLevel)) {
            out.motionLevel = motionLevel;
        }

        const sendShortcut = asString(raw.sendShortcut).toLowerCase();
        if (SEND_SHORTCUT_MODES.has(sendShortcut)) {
            out.sendShortcut = sendShortcut;
        }

        const timeFormat = asString(raw.timeFormat).toLowerCase();
        if (TIME_FORMAT_MODES.has(timeFormat)) {
            out.timeFormat = timeFormat;
        }

        const interfaceThemeStore = asJsonObject(raw.interfaceThemeStore, 32_000);
        if (interfaceThemeStore) {
            out.interfaceThemeStore = interfaceThemeStore;
        }

        const chatAppearanceStore = asJsonObject(raw.chatAppearanceStore, 460_000);
        if (chatAppearanceStore) {
            out.chatAppearanceStore = chatAppearanceStore;
        }

        return out;
    }

    function applyClientPreferences(clientPreferences) {
        if (!clientPreferences || typeof clientPreferences !== 'object') return;
        if (typeof localStorage === 'undefined' || !localStorage || typeof localStorage.setItem !== 'function') {
            return;
        }

        try {
            if (typeof clientPreferences.darkMode === 'boolean') {
                localStorage.setItem('darkMode', clientPreferences.darkMode ? 'true' : 'false');
            }
            if (Number.isFinite(clientPreferences.messageScale)) {
                const scale = clamp(Number(clientPreferences.messageScale), MESSAGE_SCALE_MIN, MESSAGE_SCALE_MAX);
                localStorage.setItem('sun_chat_message_scale_v1', scale.toFixed(2));
            }
            if (typeof clientPreferences.performanceMode === 'string' && PERFORMANCE_MODES.has(clientPreferences.performanceMode)) {
                localStorage.setItem('sun_performance_mode', clientPreferences.performanceMode);
            }
            if (typeof clientPreferences.motionLevel === 'string' && MOTION_LEVELS.has(clientPreferences.motionLevel)) {
                localStorage.setItem('sun_motion_level', clientPreferences.motionLevel);
            }
            if (typeof clientPreferences.sendShortcut === 'string' && SEND_SHORTCUT_MODES.has(clientPreferences.sendShortcut)) {
                localStorage.setItem('sun_send_shortcut_mode_v1', clientPreferences.sendShortcut);
            }
            if (typeof clientPreferences.timeFormat === 'string' && TIME_FORMAT_MODES.has(clientPreferences.timeFormat)) {
                localStorage.setItem('sun_time_format_v1', clientPreferences.timeFormat);
            }
            if (clientPreferences.interfaceThemeStore) {
                localStorage.setItem('sun.interfaceTheme.v1', JSON.stringify(clientPreferences.interfaceThemeStore));
            }
            if (clientPreferences.chatAppearanceStore) {
                localStorage.setItem('sun.chatAppearance.v2', JSON.stringify(clientPreferences.chatAppearanceStore));
            }
        } catch (_error) {
            // Ignore storage write errors.
        }
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
            clientPreferences: asClientPreferences(userPayload.clientPreferences),
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
    applyClientPreferences(bootstrap.user?.clientPreferences || {});
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
