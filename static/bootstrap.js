(() => {
    'use strict';

    const BOOTSTRAP_SCRIPT_ID = 'sun-bootstrap-data';
    const DEFAULT_QRCODE_SRC = '/static/vendor/js/qrcode.min.js';
    const CLIENT_PREFERENCES_STORAGE_KEY = 'sun.clientPreferences.v1';
    const UI_LANGUAGE_STORAGE_KEY = 'sun_ui_language';
    const INTERFACE_THEME_STORAGE_KEY = 'sun.interfaceTheme.v1';
    const CHAT_APPEARANCE_STORAGE_KEY = 'sun.chatAppearance.v2';
    const DARK_MODE_STORAGE_KEY = 'darkMode';
    const MESSAGE_SCALE_STORAGE_KEY = 'sun_chat_message_scale_v1';
    const PERFORMANCE_MODE_STORAGE_KEY = 'sun_performance_mode';
    const MOTION_LEVEL_STORAGE_KEY = 'sun_motion_level';
    const SEND_SHORTCUT_STORAGE_KEY = 'sun_send_shortcut_mode_v1';
    const TIME_FORMAT_STORAGE_KEY = 'sun_time_format_v1';
    const MESSAGE_SCALE_MIN = 0.9;
    const MESSAGE_SCALE_MAX = 1.3;
    const PERFORMANCE_MODES = new Set(['auto', 'full', 'lite']);
    const MOTION_LEVELS = new Set(['auto', 'full', 'balanced', 'lite']);
    const SEND_SHORTCUT_MODES = new Set(['enter', 'ctrl_enter']);
    const TIME_FORMAT_MODES = new Set(['24h', '12h']);
    const SIDEBAR_WEATHER_SOURCES = new Set(['auto', 'city']);
    const SIDEBAR_WEATHER_ROTATE_SECONDS = new Set([30, 60]);
    const SIDEBAR_WEATHER_METRICS = new Set([
        'temperature',
        'feels_like',
        'humidity',
        'wind',
        'precip',
        'uv',
        'aqi',
        'pressure',
        'sun_cycle',
    ]);
    const SIDEBAR_WEATHER_DEFAULT_METRICS = ['temperature'];

    const INTERFACE_DEFAULT_ACCENT = {
        light: '#c58a22',
        dark: '#d6a449',
    };

    const INTERFACE_PRESET_BY_THEME = {
        light: 'light-classic',
        dark: 'dark-classic',
    };

    const INTERFACE_PRESETS = Object.freeze({
        'light-classic': { mode: 'light', vars: {} },
        'light-sky': {
            mode: 'light',
            vars: {
                '--bg': '#eaf2fb',
                '--paper': '#f7fbff',
                '--paper-alt': '#e3edf8',
                '--surface': '#f7fbff',
                '--surface-2': '#e3edf8',
                '--sidebar-bg': '#eaf2fb',
                '--sidebar-hdr': '#e3edf8',
                '--chat-bg': '#e6eff9',
                '--chat-hdr-bg': '#eaf2fb',
                '--input-bg': '#f7fbff',
                '--overlay-bg': '#f7fbff',
                '--modal-bg': '#f7fbff',
                '--auth-bg': '#eaf2fb',
                '--auth-card-bg': 'rgba(247,251,255,0.95)',
                '--auth-card-border': 'rgba(165,188,216,0.45)',
                '--ink': '#131d2e',
                '--ink-soft': '#374f6d',
                '--ink-mute': '#6881a0',
                '--ink-faint': '#97adc4',
                '--text': '#131d2e',
                '--sub-text': '#6881a0',
                '--text-muted': '#97adc4',
                '--text-inv': '#eaf2fb',
                '--rule': '#cfdced',
                '--rule-soft': '#deebf7',
                '--border': '#cfdced',
                '--border-focus': 'rgba(61,133,224,0.45)',
                '--chat-hdr': '#eaf2fb',
                '--overlay-menu-bg': '#f7fbff',
                '--profile-backdrop-bg': 'rgba(20,35,62,0.28)',
            },
        },
        'light-mist': {
            mode: 'light',
            vars: {
                '--bg': '#eef0f3',
                '--paper': '#f7f8fa',
                '--paper-alt': '#e4e7ec',
                '--surface': '#f7f8fa',
                '--surface-2': '#e4e7ec',
                '--sidebar-bg': '#eef0f3',
                '--sidebar-hdr': '#e4e7ec',
                '--chat-bg': '#e9edf2',
                '--chat-hdr-bg': '#eef0f3',
                '--input-bg': '#f7f8fa',
                '--overlay-bg': '#f7f8fa',
                '--modal-bg': '#f7f8fa',
                '--auth-bg': '#eef0f3',
                '--auth-card-bg': 'rgba(247,248,250,0.95)',
                '--auth-card-border': 'rgba(150,160,175,0.42)',
                '--ink': '#1a1f28',
                '--ink-soft': '#3f4755',
                '--ink-mute': '#6b7484',
                '--ink-faint': '#98a2b3',
                '--text': '#1a1f28',
                '--sub-text': '#6b7484',
                '--text-muted': '#98a2b3',
                '--text-inv': '#eef0f3',
                '--rule': '#ccd3dd',
                '--rule-soft': '#dde2e9',
                '--border': '#ccd3dd',
                '--border-focus': 'rgba(109,127,153,0.42)',
                '--chat-hdr': '#eef0f3',
                '--overlay-menu-bg': '#f7f8fa',
                '--profile-backdrop-bg': 'rgba(19,26,36,0.30)',
            },
        },
        'dark-classic': { mode: 'dark', vars: {} },
        'dark-forest': {
            mode: 'dark',
            vars: {
                '--bg': '#101815',
                '--paper': '#15201c',
                '--paper-alt': '#1b2a24',
                '--surface': '#15201c',
                '--surface-2': '#1b2a24',
                '--sidebar-bg': '#101815',
                '--sidebar-hdr': '#15201c',
                '--chat-bg': '#0b120f',
                '--chat-hdr-bg': '#101815',
                '--input-bg': '#15201c',
                '--overlay-bg': '#15201c',
                '--modal-bg': '#15201c',
                '--auth-bg': '#101815',
                '--auth-card-bg': 'rgba(21,32,28,0.95)',
                '--auth-card-border': 'rgba(76,151,122,0.24)',
                '--ink': '#ddefe6',
                '--ink-soft': '#b3d0c3',
                '--ink-mute': '#87a99a',
                '--ink-faint': '#678576',
                '--text': '#ddefe6',
                '--sub-text': '#87a99a',
                '--text-muted': '#678576',
                '--text-inv': '#101815',
                '--rule': '#2a3d34',
                '--rule-soft': '#223228',
                '--border': '#2a3d34',
                '--border-focus': 'rgba(52,179,129,0.42)',
                '--chat-hdr': '#101815',
                '--overlay-menu-bg': '#15201c',
                '--profile-backdrop-bg': 'rgba(7,11,9,0.62)',
            },
        },
        'dark-midnight': {
            mode: 'dark',
            vars: {
                '--bg': '#10162a',
                '--paper': '#151d36',
                '--paper-alt': '#1a2442',
                '--surface': '#151d36',
                '--surface-2': '#1a2442',
                '--sidebar-bg': '#10162a',
                '--sidebar-hdr': '#151d36',
                '--chat-bg': '#0a1020',
                '--chat-hdr-bg': '#10162a',
                '--input-bg': '#151d36',
                '--overlay-bg': '#151d36',
                '--modal-bg': '#151d36',
                '--auth-bg': '#10162a',
                '--auth-card-bg': 'rgba(21,29,54,0.95)',
                '--auth-card-border': 'rgba(113,139,255,0.24)',
                '--ink': '#e2e8ff',
                '--ink-soft': '#bac4ef',
                '--ink-mute': '#8f9fd6',
                '--ink-faint': '#6f7fae',
                '--text': '#e2e8ff',
                '--sub-text': '#8f9fd6',
                '--text-muted': '#6f7fae',
                '--text-inv': '#10162a',
                '--rule': '#293456',
                '--rule-soft': '#202b47',
                '--border': '#293456',
                '--border-focus': 'rgba(91,125,255,0.42)',
                '--chat-hdr': '#10162a',
                '--overlay-menu-bg': '#151d36',
                '--profile-backdrop-bg': 'rgba(6,10,21,0.66)',
            },
        },
        'dark-graphite': {
            mode: 'dark',
            vars: {
                '--bg': '#121416',
                '--paper': '#181b1f',
                '--paper-alt': '#20242a',
                '--surface': '#181b1f',
                '--surface-2': '#20242a',
                '--sidebar-bg': '#121416',
                '--sidebar-hdr': '#181b1f',
                '--chat-bg': '#0d1013',
                '--chat-hdr-bg': '#121416',
                '--input-bg': '#181b1f',
                '--overlay-bg': '#181b1f',
                '--modal-bg': '#181b1f',
                '--auth-bg': '#121416',
                '--auth-card-bg': 'rgba(24,27,31,0.95)',
                '--auth-card-border': 'rgba(126,139,156,0.24)',
                '--ink': '#e5e9ef',
                '--ink-soft': '#b8c0cc',
                '--ink-mute': '#8f99a8',
                '--ink-faint': '#6b7482',
                '--text': '#e5e9ef',
                '--sub-text': '#8f99a8',
                '--text-muted': '#6b7482',
                '--text-inv': '#121416',
                '--rule': '#2b3139',
                '--rule-soft': '#232930',
                '--border': '#2b3139',
                '--border-focus': 'rgba(138,152,173,0.40)',
                '--chat-hdr': '#121416',
                '--overlay-menu-bg': '#181b1f',
                '--profile-backdrop-bg': 'rgba(5,7,10,0.68)',
            },
        },
        'custom-light': {
            mode: 'light',
            vars: {
                '--bg': '#f6f0e6',
                '--paper': '#fffaf0',
                '--paper-alt': '#ece2d3',
                '--surface': '#fffaf0',
                '--surface-2': '#ece2d3',
                '--sidebar-bg': '#f6f0e6',
                '--sidebar-hdr': '#ece2d3',
                '--chat-bg': '#f3e9d8',
                '--chat-hdr-bg': '#f6f0e6',
                '--input-bg': '#fffaf0',
                '--overlay-bg': '#fffaf0',
                '--modal-bg': '#fffaf0',
                '--auth-bg': '#f6f0e6',
                '--auth-card-bg': 'rgba(255,250,240,0.95)',
                '--auth-card-border': 'rgba(206,188,160,0.52)',
                '--ink': '#20180f',
                '--ink-soft': '#4c3c2a',
                '--ink-mute': '#7f6b53',
                '--ink-faint': '#b19e85',
                '--text': '#20180f',
                '--sub-text': '#7f6b53',
                '--text-muted': '#b19e85',
                '--text-inv': '#f6f0e6',
                '--rule': '#dbc9af',
                '--rule-soft': '#e9ddc9',
                '--border': '#dbc9af',
                '--border-focus': 'rgba(181,138,74,0.45)',
                '--chat-hdr': '#f6f0e6',
                '--overlay-menu-bg': '#fffaf0',
                '--profile-backdrop-bg': 'rgba(31,21,11,0.30)',
            },
        },
        'custom-dark': {
            mode: 'dark',
            vars: {
                '--bg': '#16110c',
                '--paper': '#1d1711',
                '--paper-alt': '#251d15',
                '--surface': '#1d1711',
                '--surface-2': '#251d15',
                '--sidebar-bg': '#16110c',
                '--sidebar-hdr': '#1d1711',
                '--chat-bg': '#120d09',
                '--chat-hdr-bg': '#16110c',
                '--input-bg': '#1d1711',
                '--overlay-bg': '#1d1711',
                '--modal-bg': '#1d1711',
                '--auth-bg': '#16110c',
                '--auth-card-bg': 'rgba(29,23,17,0.95)',
                '--auth-card-border': 'rgba(162,128,86,0.24)',
                '--ink': '#f1e4cc',
                '--ink-soft': '#d3c0a0',
                '--ink-mute': '#ab936f',
                '--ink-faint': '#856f50',
                '--text': '#f1e4cc',
                '--sub-text': '#ab936f',
                '--text-muted': '#856f50',
                '--text-inv': '#16110c',
                '--rule': '#34291d',
                '--rule-soft': '#2a2017',
                '--border': '#34291d',
                '--border-focus': 'rgba(181,138,74,0.42)',
                '--chat-hdr': '#16110c',
                '--overlay-menu-bg': '#1d1711',
                '--profile-backdrop-bg': 'rgba(8,5,3,0.64)',
            },
        },
    });

    const CHAT_APPEARANCE_DEFAULTS = {
        light: {
            mode: 'default',
            color: '#e9edf3',
            gradientA: '#f5f7fb',
            gradientB: '#e4ebf3',
            custom: {
                imageDataUrl: null,
                darken: 8,
                blur: 0,
                opacity: 1,
                position: 'center center',
                scale: 100,
                repeat: false,
            },
        },
        dark: {
            mode: 'default',
            color: '#161b22',
            gradientA: '#141a23',
            gradientB: '#10141c',
            custom: {
                imageDataUrl: null,
                darken: 18,
                blur: 0,
                opacity: 1,
                position: 'center center',
                scale: 110,
                repeat: false,
            },
        },
    };

    const CHAT_APPEARANCE_PRESETS = Object.freeze({
        'dark-graphite': { mode: 'color', color: '#18140f' },
        'dark-slate': { mode: 'color', color: '#211a14' },
        'dark-forest': { mode: 'color', color: '#10211f' },
        'light-cloud': { mode: 'color', color: '#f6f2ea' },
        'light-sand': { mode: 'color', color: '#efe7d8' },
        'light-mist': { mode: 'color', color: '#e8eef0' },
        'grad-mint': { mode: 'gradient', gradient: 'linear-gradient(145deg,#eef6f1 0%,#ddebe7 52%,#e8f0ec 100%)' },
        'grad-dusk': { mode: 'gradient', gradient: 'linear-gradient(145deg,#17130f 0%,#1f1914 46%,#0f2321 100%)' },
        'grad-blush': { mode: 'gradient', gradient: 'linear-gradient(140deg,#f3ece2 0%,#ece8df 42%,#e8efef 100%)' },
        'pattern-grid': {
            mode: 'pattern',
            baseColor: '#f4efe5',
            pattern: 'linear-gradient(rgba(122,115,99,0.08) 1px, transparent 1px),linear-gradient(90deg, rgba(122,115,99,0.08) 1px, transparent 1px)',
            size: '24px 24px',
            repeat: 'repeat',
        },
        'pattern-diag-dark': {
            mode: 'pattern',
            baseColor: '#14110d',
            pattern: 'radial-gradient(circle at 0 0, rgba(196,148,60,0.07) 0 2px, transparent 2px),radial-gradient(circle at 18px 18px, rgba(214,164,73,0.055) 0 2px, transparent 2px)',
            size: '36px 36px',
            repeat: 'repeat',
        },
        'texture-paper': {
            mode: 'texture',
            baseColor: '#f3eee4',
            texture: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'220\' height=\'220\' viewBox=\'0 0 220 220\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.82\' numOctaves=\'2\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'220\' height=\'220\' filter=\'url(%23n)\' opacity=\'0.05\'/%3E%3C/svg%3E")',
            size: '280px 280px',
            repeat: 'repeat',
        },
        'texture-carbon': {
            mode: 'texture',
            baseColor: '#120f0c',
            texture: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'260\' height=\'260\' viewBox=\'0 0 260 260\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.68\' numOctaves=\'3\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'260\' height=\'260\' filter=\'url(%23n)\' opacity=\'0.08\'/%3E%3C/svg%3E")',
            size: '320px 320px',
            repeat: 'repeat',
        },
    });

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

    function deepClone(value) {
        try {
            return JSON.parse(JSON.stringify(value));
        } catch (_error) {
            return {};
        }
    }

    function asFiniteNumber(value, fallback = null) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function normalizeHex(value) {
        if (typeof value !== 'string') return null;
        const trimmed = value.trim();
        const shortMatch = trimmed.match(/^#([0-9a-f]{3})$/i);
        if (shortMatch) {
            const short = shortMatch[1].toLowerCase();
            return `#${short[0]}${short[0]}${short[1]}${short[1]}${short[2]}${short[2]}`;
        }
        const fullMatch = trimmed.match(/^#([0-9a-f]{6})$/i);
        if (fullMatch) return `#${fullMatch[1].toLowerCase()}`;
        return null;
    }

    function hexToRgb(hex) {
        const normalized = normalizeHex(hex);
        if (!normalized) return null;
        const n = parseInt(normalized.slice(1), 16);
        return {
            r: (n >> 16) & 255,
            g: (n >> 8) & 255,
            b: n & 255,
        };
    }

    function rgbToHex(rgb) {
        const r = clamp(Math.round(rgb.r), 0, 255).toString(16).padStart(2, '0');
        const g = clamp(Math.round(rgb.g), 0, 255).toString(16).padStart(2, '0');
        const b = clamp(Math.round(rgb.b), 0, 255).toString(16).padStart(2, '0');
        return `#${r}${g}${b}`;
    }

    function mixColors(colorA, colorB, weightToB) {
        const a = hexToRgb(colorA) || { r: 0, g: 0, b: 0 };
        const b = hexToRgb(colorB) || { r: 0, g: 0, b: 0 };
        const w = clamp(Number(weightToB || 0), 0, 1);
        return rgbToHex({
            r: a.r * (1 - w) + b.r * w,
            g: a.g * (1 - w) + b.g * w,
            b: a.b * (1 - w) + b.b * w,
        });
    }

    function rgbaFromHex(hex, alpha) {
        const rgb = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
        return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamp(Number(alpha || 0), 0, 1).toFixed(3)})`;
    }

    function toTimestampMs(value) {
        if (typeof value === 'number' && Number.isFinite(value)) {
            if (value > 1e12) return Math.floor(value);
            if (value > 1e9) return Math.floor(value * 1000);
        }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (!trimmed) return 0;
            const numeric = Number(trimmed);
            if (Number.isFinite(numeric) && numeric > 0) {
                if (numeric > 1e12) return Math.floor(numeric);
                if (numeric > 1e9) return Math.floor(numeric * 1000);
            }
            const parsed = Date.parse(trimmed);
            if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
        }
        return 0;
    }

    function toIsoTimestamp(value) {
        const ms = toTimestampMs(value);
        if (!ms) return '';
        try {
            return new Date(ms).toISOString();
        } catch (_error) {
            return '';
        }
    }

    function hasStorage() {
        return typeof localStorage !== 'undefined'
            && !!localStorage
            && typeof localStorage.getItem === 'function'
            && typeof localStorage.setItem === 'function';
    }

    function normalizeSidebarWeatherSource(value) {
        const raw = asString(value).toLowerCase();
        return SIDEBAR_WEATHER_SOURCES.has(raw) ? raw : 'auto';
    }

    function normalizeSidebarWeatherRotateSeconds(value) {
        const parsed = Number.parseInt(String(value ?? ''), 10);
        return SIDEBAR_WEATHER_ROTATE_SECONDS.has(parsed) ? parsed : 60;
    }

    function normalizeSidebarWeatherCity(value) {
        return asString(value)
            .replace(/\s+/g, ' ')
            .slice(0, 80);
    }

    function normalizeSidebarWeatherMetrics(value, { fallbackToDefault = true } = {}) {
        if (!Array.isArray(value)) {
            return fallbackToDefault ? [...SIDEBAR_WEATHER_DEFAULT_METRICS] : [];
        }
        const result = [];
        const seen = new Set();
        value.forEach((entry) => {
            const metric = asString(entry).toLowerCase();
            if (!SIDEBAR_WEATHER_METRICS.has(metric) || seen.has(metric)) return;
            seen.add(metric);
            result.push(metric);
        });
        return result;
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

    function asClientPreferences(value, options = {}) {
        const raw = asObject(value);
        const out = {};
        const fallbackLanguage = asLanguage(options.defaultLanguage || document.documentElement?.lang || 'ru');

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

        const sidebarWeatherEnabled = raw.sidebarWeatherEnabled;
        if (typeof sidebarWeatherEnabled === 'boolean') {
            out.sidebarWeatherEnabled = sidebarWeatherEnabled;
        }

        if (Object.prototype.hasOwnProperty.call(raw, 'sidebarWeatherSource')) {
            out.sidebarWeatherSource = normalizeSidebarWeatherSource(raw.sidebarWeatherSource);
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'sidebarWeatherCity')) {
            out.sidebarWeatherCity = normalizeSidebarWeatherCity(raw.sidebarWeatherCity);
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'sidebarWeatherRotateSeconds')) {
            out.sidebarWeatherRotateSeconds = normalizeSidebarWeatherRotateSeconds(raw.sidebarWeatherRotateSeconds);
        }
        if (Object.prototype.hasOwnProperty.call(raw, 'sidebarWeatherMetrics')) {
            out.sidebarWeatherMetrics = normalizeSidebarWeatherMetrics(raw.sidebarWeatherMetrics, {
                fallbackToDefault: false,
            });
        }

        const interfaceThemeStore = asJsonObject(raw.interfaceThemeStore, 32_000);
        if (interfaceThemeStore) {
            out.interfaceThemeStore = interfaceThemeStore;
        }

        const chatAppearanceStore = asJsonObject(raw.chatAppearanceStore, 460_000);
        if (chatAppearanceStore) {
            out.chatAppearanceStore = chatAppearanceStore;
        }

        if (Object.prototype.hasOwnProperty.call(raw, 'language') || Object.prototype.hasOwnProperty.call(raw, 'uiLanguage')) {
            const language = asLanguage(raw.language || raw.uiLanguage || fallbackLanguage);
            out.language = language;
        }

        const updatedAt = toIsoTimestamp(raw.updatedAt);
        if (updatedAt) {
            out.updatedAt = updatedAt;
        }

        return out;
    }

    function resolveThemeKeyFromPreferences(clientPreferences) {
        if (typeof clientPreferences?.darkMode === 'boolean') {
            return clientPreferences.darkMode ? 'dark' : 'light';
        }
        if (hasStorage()) {
            try {
                if (localStorage.getItem(DARK_MODE_STORAGE_KEY) === 'true') return 'dark';
                if (localStorage.getItem(DARK_MODE_STORAGE_KEY) === 'false') return 'light';
            } catch (_error) {
                // Ignore storage read errors.
            }
        }
        return 'light';
    }

    function resolveInterfacePreset(themeKey, store) {
        const normalizedTheme = themeKey === 'dark' ? 'dark' : 'light';
        const themeStore = asObject(store);
        const modePresets = asObject(themeStore.modePresets);
        const activePresetId = asString(themeStore.activePresetId);
        const activePreset = INTERFACE_PRESETS[activePresetId];
        if (activePreset && activePreset.mode === normalizedTheme) {
            return activePreset;
        }
        const modePresetId = asString(modePresets[normalizedTheme]);
        const modePreset = INTERFACE_PRESETS[modePresetId];
        if (modePreset && modePreset.mode === normalizedTheme) {
            return modePreset;
        }
        return INTERFACE_PRESETS[INTERFACE_PRESET_BY_THEME[normalizedTheme]];
    }

    function resolveInterfaceAccent(themeKey, store) {
        const normalizedTheme = themeKey === 'dark' ? 'dark' : 'light';
        const themes = asObject(asObject(store).themes);
        const themeState = asObject(themes[normalizedTheme]);
        const accent = normalizeHex(themeState.accent);
        return accent || INTERFACE_DEFAULT_ACCENT[normalizedTheme];
    }

    function buildInterfaceCssVars(themeKey, interfaceThemeStore) {
        const preset = resolveInterfacePreset(themeKey, interfaceThemeStore);
        const accent = resolveInterfaceAccent(themeKey, interfaceThemeStore);
        const hover = themeKey === 'dark'
            ? mixColors(accent, '#ffffff', 0.18)
            : mixColors(accent, '#000000', 0.2);
        const bright = themeKey === 'dark'
            ? mixColors(accent, '#ffffff', 0.32)
            : mixColors(accent, '#ffffff', 0.24);
        const light = themeKey === 'dark'
            ? mixColors(accent, '#0b1f21', 0.72)
            : mixColors(accent, '#ffffff', 0.86);
        const glow = rgbaFromHex(accent, themeKey === 'dark' ? 0.24 : 0.2);
        const gradient = `linear-gradient(135deg, ${accent} 0%, ${bright} 100%)`;

        return {
            ...(preset?.vars || {}),
            '--accent': accent,
            '--accent-hover': hover,
            '--accent-bright': bright,
            '--accent-light': light,
            '--accent-glow': glow,
            '--accent-gradient': gradient,
        };
    }

    function mergeChatThemeState(rawState, themeKey) {
        const base = deepClone(CHAT_APPEARANCE_DEFAULTS[themeKey]);
        const src = asObject(rawState);
        const merged = {
            ...base,
            ...src,
            custom: {
                ...base.custom,
                ...asObject(src.custom),
            },
        };
        merged.mode = asString(merged.mode) || 'default';
        merged.presetId = asString(merged.presetId) || null;
        merged.color = asString(merged.color) || base.color;
        merged.gradientA = asString(merged.gradientA) || base.gradientA;
        merged.gradientB = asString(merged.gradientB) || base.gradientB;
        merged.custom.darken = clamp(asFiniteNumber(merged.custom.darken, base.custom.darken), 0, 70);
        merged.custom.blur = clamp(asFiniteNumber(merged.custom.blur, base.custom.blur), 0, 18);
        merged.custom.opacity = clamp(asFiniteNumber(merged.custom.opacity, base.custom.opacity), 0.2, 1);
        merged.custom.scale = clamp(asFiniteNumber(merged.custom.scale, base.custom.scale), 30, 240);
        merged.custom.position = asString(merged.custom.position) || 'center center';
        merged.custom.repeat = Boolean(merged.custom.repeat);
        merged.custom.imageDataUrl = asString(merged.custom.imageDataUrl) || null;
        return merged;
    }

    function buildWallpaperFromChatState(themeKey, rawState) {
        const state = mergeChatThemeState(rawState, themeKey);
        if (state.mode === 'default') {
            return {
                baseColor: 'var(--chat-bg)',
                image: 'none',
                size: 'cover',
                position: 'center center',
                repeat: 'no-repeat',
                opacity: '1',
                blur: '0px',
                dim: '0',
            };
        }

        if (state.mode === 'preset') {
            const preset = CHAT_APPEARANCE_PRESETS[state.presetId];
            if (preset) {
                if (preset.mode === 'color') {
                    return {
                        baseColor: preset.color,
                        image: 'none',
                        size: 'auto',
                        position: 'center center',
                        repeat: 'no-repeat',
                        opacity: '1',
                        blur: '0px',
                        dim: '0',
                    };
                }
                if (preset.mode === 'gradient') {
                    return {
                        baseColor: 'transparent',
                        image: preset.gradient,
                        size: 'cover',
                        position: 'center center',
                        repeat: 'no-repeat',
                        opacity: '1',
                        blur: '0px',
                        dim: '0',
                    };
                }
                if (preset.mode === 'pattern') {
                    return {
                        baseColor: preset.baseColor || 'var(--chat-bg)',
                        image: preset.pattern || 'none',
                        size: preset.size || 'auto',
                        position: 'center center',
                        repeat: preset.repeat || 'repeat',
                        opacity: '1',
                        blur: '0px',
                        dim: '0',
                    };
                }
                if (preset.mode === 'texture') {
                    return {
                        baseColor: preset.baseColor || 'var(--chat-bg)',
                        image: preset.texture || 'none',
                        size: preset.size || 'auto',
                        position: 'center center',
                        repeat: preset.repeat || 'repeat',
                        opacity: '1',
                        blur: '0px',
                        dim: '0',
                    };
                }
            }
        }

        if (state.mode === 'color') {
            return {
                baseColor: state.color,
                image: 'none',
                size: 'auto',
                position: 'center center',
                repeat: 'no-repeat',
                opacity: '1',
                blur: '0px',
                dim: '0',
            };
        }

        if (state.mode === 'gradient') {
            return {
                baseColor: 'transparent',
                image: `linear-gradient(135deg, ${state.gradientA} 0%, ${state.gradientB} 100%)`,
                size: 'cover',
                position: 'center center',
                repeat: 'no-repeat',
                opacity: '1',
                blur: '0px',
                dim: '0',
            };
        }

        if (state.mode === 'custom' && state.custom?.imageDataUrl) {
            const normalizedScale = clamp(asFiniteNumber(state.custom.scale, 100), 30, 240);
            const customSize = state.custom.repeat
                ? `${Math.round(normalizedScale * 0.9)}px ${Math.round(normalizedScale * 0.9)}px`
                : `min(${normalizedScale}vw, 1800px) auto`;
            return {
                baseColor: themeKey === 'dark' ? '#0f131a' : '#edf2f7',
                image: `url("${state.custom.imageDataUrl}")`,
                size: customSize,
                position: state.custom.position || 'center center',
                repeat: state.custom.repeat ? 'repeat' : 'no-repeat',
                opacity: String(clamp(state.custom.opacity, 0.2, 1)),
                blur: `${clamp(state.custom.blur, 0, 18).toFixed(1)}px`,
                dim: String(clamp(state.custom.darken / 100, 0, 0.75)),
            };
        }

        return {
            baseColor: 'var(--chat-bg)',
            image: 'none',
            size: 'cover',
            position: 'center center',
            repeat: 'no-repeat',
            opacity: '1',
            blur: '0px',
            dim: '0',
        };
    }

    function buildChatAppearanceCssVars(themeKey, chatAppearanceStore) {
        const themes = asObject(asObject(chatAppearanceStore).themes);
        const themeState = themes[themeKey];
        const wallpaper = buildWallpaperFromChatState(themeKey, themeState);
        return {
            '--chat-wallpaper-base': wallpaper.baseColor,
            '--chat-wallpaper-image': wallpaper.image,
            '--chat-wallpaper-size': wallpaper.size,
            '--chat-wallpaper-position': wallpaper.position,
            '--chat-wallpaper-repeat': wallpaper.repeat,
            '--chat-wallpaper-opacity': wallpaper.opacity,
            '--chat-wallpaper-blur': wallpaper.blur,
            '--chat-wallpaper-dim': wallpaper.dim,
        };
    }

    function buildClientPreferencesBoot(clientPreferences) {
        const normalized = asClientPreferences(clientPreferences || {});
        const themeKey = resolveThemeKeyFromPreferences(normalized);
        const interfaceVars = buildInterfaceCssVars(themeKey, normalized.interfaceThemeStore || {});
        const chatVars = buildChatAppearanceCssVars(themeKey, normalized.chatAppearanceStore || {});
        return {
            darkMode: themeKey === 'dark',
            language: asLanguage(normalized.language || document.documentElement?.lang || 'ru'),
            cssVars: {
                ...interfaceVars,
                ...chatVars,
            },
        };
    }

    function finalizeClientPreferences(value, options = {}) {
        const normalized = asClientPreferences(value || {}, {
            defaultLanguage: options.defaultLanguage || document.documentElement?.lang || 'ru',
        });
        if (!normalized.language && options.ensureLanguage === true) {
            normalized.language = asLanguage(options.defaultLanguage || document.documentElement?.lang || 'ru');
        }
        const finalized = {
            ...normalized,
            boot: buildClientPreferencesBoot(normalized),
        };
        const currentUpdatedAt = normalized.updatedAt || '';
        if (options.touchUpdatedAt === true) {
            finalized.updatedAt = new Date().toISOString();
        } else if (currentUpdatedAt) {
            finalized.updatedAt = currentUpdatedAt;
        } else if (options.ensureUpdatedAt === true) {
            finalized.updatedAt = new Date().toISOString();
        }
        return finalized;
    }

    function readUnifiedClientPreferences() {
        if (!hasStorage()) return {};
        try {
            const packed = localStorage.getItem(CLIENT_PREFERENCES_STORAGE_KEY);
            if (!packed) return {};
            const raw = JSON.parse(packed);
            return finalizeClientPreferences(raw, {
                touchUpdatedAt: false,
                ensureUpdatedAt: false,
                ensureLanguage: false,
            });
        } catch (_error) {
            return {};
        }
    }

    function hasMeaningfulClientPreferences(prefs) {
        if (!prefs || typeof prefs !== 'object') return false;
        const keys = Object.keys(prefs).filter((key) => key !== 'updatedAt' && key !== 'boot');
        return keys.length > 0;
    }

    function resolveEffectiveClientPreferences(serverPrefs, localPrefs, fallbackLanguage) {
        const server = finalizeClientPreferences(serverPrefs || {}, { touchUpdatedAt: false, defaultLanguage: fallbackLanguage });
        const local = finalizeClientPreferences(localPrefs || {}, {
            touchUpdatedAt: false,
            ensureUpdatedAt: false,
            ensureLanguage: false,
            defaultLanguage: fallbackLanguage,
        });
        const serverTs = toTimestampMs(server.updatedAt);
        const localTs = toTimestampMs(local.updatedAt);

        if (localTs > 0 && serverTs > 0) {
            return localTs > serverTs ? local : server;
        }
        if (localTs > 0 && serverTs === 0) {
            return local;
        }
        if (serverTs > 0 && localTs === 0) {
            return server;
        }
        if (hasMeaningfulClientPreferences(local)) {
            return local;
        }
        return server;
    }

    function readLegacyJsonFromStorage(key, maxLength) {
        if (!hasStorage()) return null;
        try {
            const raw = localStorage.getItem(key);
            if (!raw || raw.length > maxLength) return null;
            return asJsonObject(JSON.parse(raw), maxLength);
        } catch (_error) {
            return null;
        }
    }

    function readRuntimeClientPreferencesSnapshot(fallback = {}) {
        const snapshot = asClientPreferences(fallback || {});
        if (!hasStorage()) return snapshot;
        try {
            const storedDark = localStorage.getItem(DARK_MODE_STORAGE_KEY);
            if (storedDark === 'true') snapshot.darkMode = true;
            if (storedDark === 'false') snapshot.darkMode = false;

            const storedScaleRaw = localStorage.getItem(MESSAGE_SCALE_STORAGE_KEY);
            const storedScale = storedScaleRaw === null ? null : asFiniteNumber(storedScaleRaw, null);
            if (storedScale !== null) {
                snapshot.messageScale = Number(clamp(storedScale, MESSAGE_SCALE_MIN, MESSAGE_SCALE_MAX).toFixed(2));
            }

            const storedPerf = asString(localStorage.getItem(PERFORMANCE_MODE_STORAGE_KEY)).toLowerCase();
            if (PERFORMANCE_MODES.has(storedPerf)) snapshot.performanceMode = storedPerf;

            const storedMotion = asString(localStorage.getItem(MOTION_LEVEL_STORAGE_KEY)).toLowerCase();
            if (MOTION_LEVELS.has(storedMotion)) snapshot.motionLevel = storedMotion;

            const storedSendShortcut = asString(localStorage.getItem(SEND_SHORTCUT_STORAGE_KEY)).toLowerCase();
            if (SEND_SHORTCUT_MODES.has(storedSendShortcut)) snapshot.sendShortcut = storedSendShortcut;

            const storedTimeFormat = asString(localStorage.getItem(TIME_FORMAT_STORAGE_KEY)).toLowerCase();
            if (TIME_FORMAT_MODES.has(storedTimeFormat)) snapshot.timeFormat = storedTimeFormat;

            const storedLang = asString(localStorage.getItem(UI_LANGUAGE_STORAGE_KEY));
            if (storedLang) snapshot.language = asLanguage(storedLang);

            const storedInterfaceTheme = readLegacyJsonFromStorage(INTERFACE_THEME_STORAGE_KEY, 32_000);
            if (storedInterfaceTheme) snapshot.interfaceThemeStore = storedInterfaceTheme;

            const storedChatAppearance = readLegacyJsonFromStorage(CHAT_APPEARANCE_STORAGE_KEY, 460_000);
            if (storedChatAppearance) snapshot.chatAppearanceStore = storedChatAppearance;
        } catch (_error) {
            // Ignore storage read errors.
        }
        return snapshot;
    }

    function applyClientPreferences(clientPreferences, options = {}) {
        if (!clientPreferences || typeof clientPreferences !== 'object') return {};
        const normalized = finalizeClientPreferences(clientPreferences, {
            touchUpdatedAt: options.touchUpdatedAt === true,
            ensureUpdatedAt: options.ensureUpdatedAt !== false,
            ensureLanguage: options.ensureLanguage !== false,
            defaultLanguage: options.defaultLanguage || document.documentElement?.lang || 'ru',
        });

        if (!hasStorage()) {
            return normalized;
        }

        try {
            if (typeof normalized.darkMode === 'boolean') {
                localStorage.setItem(DARK_MODE_STORAGE_KEY, normalized.darkMode ? 'true' : 'false');
            }
            if (Number.isFinite(normalized.messageScale)) {
                const scale = clamp(Number(normalized.messageScale), MESSAGE_SCALE_MIN, MESSAGE_SCALE_MAX);
                localStorage.setItem(MESSAGE_SCALE_STORAGE_KEY, scale.toFixed(2));
            }
            if (typeof normalized.performanceMode === 'string' && PERFORMANCE_MODES.has(normalized.performanceMode)) {
                localStorage.setItem(PERFORMANCE_MODE_STORAGE_KEY, normalized.performanceMode);
            }
            if (typeof normalized.motionLevel === 'string' && MOTION_LEVELS.has(normalized.motionLevel)) {
                localStorage.setItem(MOTION_LEVEL_STORAGE_KEY, normalized.motionLevel);
            }
            if (typeof normalized.sendShortcut === 'string' && SEND_SHORTCUT_MODES.has(normalized.sendShortcut)) {
                localStorage.setItem(SEND_SHORTCUT_STORAGE_KEY, normalized.sendShortcut);
            }
            if (typeof normalized.timeFormat === 'string' && TIME_FORMAT_MODES.has(normalized.timeFormat)) {
                localStorage.setItem(TIME_FORMAT_STORAGE_KEY, normalized.timeFormat);
            }
            if (normalized.interfaceThemeStore) {
                localStorage.setItem(INTERFACE_THEME_STORAGE_KEY, JSON.stringify(normalized.interfaceThemeStore));
            }
            if (normalized.chatAppearanceStore) {
                localStorage.setItem(CHAT_APPEARANCE_STORAGE_KEY, JSON.stringify(normalized.chatAppearanceStore));
            }
            if (normalized.language) {
                localStorage.setItem(UI_LANGUAGE_STORAGE_KEY, normalized.language);
                if (document.documentElement && typeof document.documentElement.setAttribute === 'function') {
                    document.documentElement.setAttribute('lang', normalized.language);
                }
            }
            if (options.persistUnified !== false) {
                localStorage.setItem(CLIENT_PREFERENCES_STORAGE_KEY, JSON.stringify(normalized));
            }
        } catch (_error) {
            // Ignore storage write errors.
        }
        return normalized;
    }

    function mergeClientPreferences(patch, options = {}) {
        const localBaseline = readUnifiedClientPreferences();
        const runtimeBaseline = readRuntimeClientPreferencesSnapshot(localBaseline);
        const merged = {
            ...runtimeBaseline,
            ...asObject(patch),
        };
        const normalized = finalizeClientPreferences(merged, {
            touchUpdatedAt: options.touchUpdatedAt !== false,
            ensureLanguage: options.ensureLanguage !== false,
            defaultLanguage: options.defaultLanguage || document.documentElement?.lang || 'ru',
        });
        return applyClientPreferences(normalized, {
            persistUnified: true,
            touchUpdatedAt: false,
            defaultLanguage: options.defaultLanguage || document.documentElement?.lang || 'ru',
        });
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
            clientPreferences: asClientPreferences(userPayload.clientPreferences, {
                defaultLanguage: asLanguage(userPayload.uiLanguage || bodyDataset.uiLanguage || document.documentElement.lang),
            }),
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
    const localUnifiedPreferences = readUnifiedClientPreferences();
    const localRuntimePreferences = readRuntimeClientPreferencesSnapshot(localUnifiedPreferences);
    const effectiveClientPreferences = resolveEffectiveClientPreferences(
        bootstrap.user?.clientPreferences || {},
        localRuntimePreferences,
        bootstrap.user?.uiLanguage || 'ru',
    );
    const appliedClientPreferences = applyClientPreferences(effectiveClientPreferences, {
        persistUnified: true,
        touchUpdatedAt: false,
        ensureUpdatedAt: true,
        ensureLanguage: true,
        defaultLanguage: bootstrap.user?.uiLanguage || 'ru',
    });
    bootstrap.user.clientPreferences = appliedClientPreferences;
    if (!bootstrap.user.uiLanguage) {
        bootstrap.user.uiLanguage = appliedClientPreferences.language || 'ru';
    }

    const clientPreferencesApi = {
        storageKey: CLIENT_PREFERENCES_STORAGE_KEY,
        read() {
            return deepClone(readUnifiedClientPreferences());
        },
        get() {
            return deepClone(readUnifiedClientPreferences());
        },
        merge(patch, options = {}) {
            return deepClone(mergeClientPreferences(patch, options));
        },
        replace(nextValue, options = {}) {
            const normalized = finalizeClientPreferences(nextValue || {}, {
                touchUpdatedAt: options.touchUpdatedAt !== false,
                ensureUpdatedAt: options.ensureUpdatedAt !== false,
                ensureLanguage: options.ensureLanguage !== false,
                defaultLanguage: options.defaultLanguage || bootstrap.user?.uiLanguage || 'ru',
            });
            return deepClone(applyClientPreferences(normalized, {
                persistUnified: true,
                touchUpdatedAt: false,
                defaultLanguage: options.defaultLanguage || bootstrap.user?.uiLanguage || 'ru',
            }));
        },
        collect(extra = {}, options = {}) {
            const snapshot = readRuntimeClientPreferencesSnapshot(readUnifiedClientPreferences());
            const merged = {
                ...snapshot,
                ...asObject(extra),
            };
            return deepClone(mergeClientPreferences(merged, options));
        },
    };

    window.SUN_CLIENT_PREFERENCES = clientPreferencesApi;
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
