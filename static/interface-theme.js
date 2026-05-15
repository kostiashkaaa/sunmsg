(function (global) {
    const STORAGE_KEY = 'sun.interfaceTheme.v1';
    const STORE_VERSION = 3;

    const DEFAULTS = {
        light: {
            accent: '#c58a22',
        },
        dark: {
            accent: '#d6a449',
        },
    };

    const THEME_PRESETS = [
        {
            id: 'light-classic',
            mode: 'light',
            label: 'Светлая классика',
            accent: '#c58a22',
            vars: {},
        },
        {
            id: 'light-sky',
            mode: 'light',
            label: 'Светлая прохлада',
            accent: '#3d85e0',
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
        {
            id: 'light-mist',
            mode: 'light',
            label: 'Серая дымка',
            accent: '#6d7f99',
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
        {
            id: 'dark-classic',
            mode: 'dark',
            label: 'Тёмная классика',
            accent: '#d6a449',
            vars: {},
        },
        {
            id: 'dark-forest',
            mode: 'dark',
            label: 'Тёмный лес',
            accent: '#34b381',
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
        {
            id: 'dark-midnight',
            mode: 'dark',
            label: 'Тёмная синь',
            accent: '#5b7dff',
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
        {
            id: 'dark-graphite',
            mode: 'dark',
            label: 'Тёмный графит',
            accent: '#8a98ad',
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
        {
            id: 'custom-light',
            mode: 'light',
            label: 'Кастомная светлая',
            accent: null,
            custom: true,
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
        {
            id: 'custom-dark',
            mode: 'dark',
            label: 'Кастомная тёмная',
            accent: null,
            custom: true,
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
    ];

    const LEGACY_DEFAULT_ACCENTS = {
        light: '#008080',
        dark: '#009999',
    };

    const DEFAULT_PRESET_BY_MODE = {
        light: 'light-classic',
        dark: 'dark-classic',
    };

    const PRESET_MAP = new Map(THEME_PRESETS.map((preset) => [preset.id, preset]));
    const PRESET_VAR_KEYS = Array.from(new Set(
        THEME_PRESETS.flatMap((preset) => Object.keys(preset.vars || {})),
    ));

    function deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function normalizeThemeKey(value) {
        return value === 'dark' ? 'dark' : 'light';
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

    function getThemeKey() {
        try {
            const stored = localStorage.getItem('darkMode');
            if (stored === 'true') return 'dark';
            if (stored === 'false') return 'light';
        } catch (_error) {
            // Ignore storage access errors.
        }
        return document.body && document.body.classList.contains('dark-mode') ? 'dark' : 'light';
    }

    function normalizePresetId(value, expectedMode) {
        const id = typeof value === 'string' ? value.trim() : '';
        if (!id) return null;
        const preset = PRESET_MAP.get(id);
        if (!preset) return null;
        if (expectedMode && preset.mode !== expectedMode) return null;
        return preset.id;
    }

    function resolveDefaultPresetId(themeKey) {
        return DEFAULT_PRESET_BY_MODE[normalizeThemeKey(themeKey)];
    }

    function mergeThemeState(input, themeKey, migrateLegacyDefault = false) {
        const base = deepClone(DEFAULTS[themeKey]);
        const src = input && typeof input === 'object' ? input : {};
        const accent = normalizeHex(src.accent);
        const legacyAccent = LEGACY_DEFAULT_ACCENTS[themeKey];
        return {
            accent: accent && !(migrateLegacyDefault && accent === legacyAccent) ? accent : base.accent,
        };
    }

    function normalizeModePresets(rawModePresets) {
        const modePresets = rawModePresets && typeof rawModePresets === 'object'
            ? rawModePresets
            : {};
        const lightPreset = normalizePresetId(modePresets.light, 'light') || resolveDefaultPresetId('light');
        const darkPreset = normalizePresetId(modePresets.dark, 'dark') || resolveDefaultPresetId('dark');
        return { light: lightPreset, dark: darkPreset };
    }

    function normalizeStore(raw) {
        const src = raw && typeof raw === 'object' ? raw : {};
        const themes = src.themes && typeof src.themes === 'object' ? src.themes : {};
        const migrateLegacyDefault = src.version !== STORE_VERSION;
        const modePresets = normalizeModePresets(src.modePresets);
        const currentMode = getThemeKey();
        const activePresetCandidate = normalizePresetId(src.activePresetId, currentMode);
        const activePresetId = activePresetCandidate || modePresets[currentMode];

        return {
            version: STORE_VERSION,
            themes: {
                light: mergeThemeState(themes.light, 'light', migrateLegacyDefault),
                dark: mergeThemeState(themes.dark, 'dark', migrateLegacyDefault),
            },
            activePresetId,
            modePresets,
        };
    }

    function readStore() {
        try {
            const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            return normalizeStore(parsed);
        } catch (_error) {
            return normalizeStore({});
        }
    }

    function writeStore(store) {
        const normalizedStore = normalizeStore(store);
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedStore));
        } catch (_error) {
            // Ignore write errors in private browsing modes.
        }
        if (window.SUN_CLIENT_PREFERENCES && typeof window.SUN_CLIENT_PREFERENCES.merge === 'function') {
            try {
                window.SUN_CLIENT_PREFERENCES.merge({
                    interfaceThemeStore: normalizedStore,
                    darkMode: getThemeKey() === 'dark',
                });
            } catch (_error) {
                // Ignore unified preference sync errors.
            }
        }
    }

    function resolveActivePreset(themeKey, store) {
        const normalizedTheme = normalizeThemeKey(themeKey);
        const normalizedStore = store || readStore();
        const activePresetId = normalizePresetId(normalizedStore.activePresetId, normalizedTheme);
        if (activePresetId) {
            return PRESET_MAP.get(activePresetId) || PRESET_MAP.get(resolveDefaultPresetId(normalizedTheme));
        }
        const modePresetId = normalizePresetId(normalizedStore.modePresets[normalizedTheme], normalizedTheme);
        if (modePresetId) {
            return PRESET_MAP.get(modePresetId) || PRESET_MAP.get(resolveDefaultPresetId(normalizedTheme));
        }
        return PRESET_MAP.get(resolveDefaultPresetId(normalizedTheme)) || null;
    }

    function getActivePreset(themeKey) {
        const key = normalizeThemeKey(themeKey || getThemeKey());
        return resolveActivePreset(key, readStore());
    }

    function getThemeState(themeKey) {
        const key = normalizeThemeKey(themeKey);
        const store = readStore();
        return mergeThemeState(store.themes[key], key);
    }

    function saveThemeState(themeKey, patch) {
        const key = normalizeThemeKey(themeKey);
        const store = readStore();
        const merged = mergeThemeState(Object.assign({}, store.themes[key], patch || {}), key);
        store.themes[key] = merged;
        writeStore(store);
        return merged;
    }

    function resetTheme(themeKey) {
        const key = normalizeThemeKey(themeKey);
        const store = readStore();
        store.themes[key] = deepClone(DEFAULTS[key]);
        writeStore(store);
    }

    function resetAll() {
        writeStore({
            themes: deepClone(DEFAULTS),
            activePresetId: null,
            modePresets: {
                light: resolveDefaultPresetId('light'),
                dark: resolveDefaultPresetId('dark'),
            },
        });
    }

    function setDarkModeFlag(themeKey) {
        const key = normalizeThemeKey(themeKey);
        const isDark = key === 'dark';
        try {
            localStorage.setItem('darkMode', isDark ? 'true' : 'false');
        } catch (_error) {
            // Ignore storage write errors.
        }
        document.documentElement.classList.toggle('dark-mode', isDark);
        if (document.body) {
            document.body.classList.toggle('dark-mode', isDark);
        }
        if (window.SUN_CLIENT_PREFERENCES && typeof window.SUN_CLIENT_PREFERENCES.merge === 'function') {
            try {
                window.SUN_CLIENT_PREFERENCES.merge({ darkMode: isDark });
            } catch (_error) {
                // Ignore unified preference sync errors.
            }
        }
    }

    function setActivePreset(presetId, options = {}) {
        const explicitTheme = options.themeKey ? normalizeThemeKey(options.themeKey) : null;
        const fallbackTheme = explicitTheme || getThemeKey();
        const normalizedPresetId = normalizePresetId(presetId, explicitTheme || null)
            || resolveDefaultPresetId(fallbackTheme);
        const preset = PRESET_MAP.get(normalizedPresetId);
        if (!preset) return null;

        setDarkModeFlag(preset.mode);
        const store = readStore();
        store.activePresetId = preset.id;
        store.modePresets[preset.mode] = preset.id;
        writeStore(store);

        if (options.applyPresetAccent !== false && !preset.custom && preset.accent) {
            saveThemeState(preset.mode, { accent: preset.accent });
        }

        if (options.apply !== false) {
            applyCurrentTheme(options.target || null);
        }

        return { preset, themeKey: preset.mode };
    }

    function toggleThemeMode(options = {}) {
        const currentTheme = getThemeKey();
        const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
        const store = readStore();
        const nextPresetId = normalizePresetId(store.modePresets[nextTheme], nextTheme) || resolveDefaultPresetId(nextTheme);
        return setActivePreset(nextPresetId, {
            apply: options.apply !== false,
            applyPresetAccent: false,
        });
    }

    function computeTokens(themeKey, themeState) {
        const key = normalizeThemeKey(themeKey);
        const accent = normalizeHex(themeState && themeState.accent) || DEFAULTS[key].accent;
        const hover = key === 'dark'
            ? mixColors(accent, '#ffffff', 0.18)
            : mixColors(accent, '#000000', 0.2);
        const bright = key === 'dark'
            ? mixColors(accent, '#ffffff', 0.32)
            : mixColors(accent, '#ffffff', 0.24);
        const light = key === 'dark'
            ? mixColors(accent, '#0b1f21', 0.72)
            : mixColors(accent, '#ffffff', 0.86);
        const deep = key === 'dark' ? bright : hover;
        const soft = key === 'dark' ? rgbaFromHex(accent, 0.14) : light;
        const glow = rgbaFromHex(accent, key === 'dark' ? 0.24 : 0.2);
        const gradient = `linear-gradient(135deg, ${accent} 0%, ${bright} 100%)`;

        return {
            accent,
            deep,
            soft,
            hover,
            bright,
            light,
            glow,
            gradient,
        };
    }

    function applyAccentVars(target, tokens) {
        if (!target || !target.style) return;
        target.style.setProperty('--accent', tokens.accent);
        target.style.setProperty('--accent-deep', tokens.deep);
        target.style.setProperty('--accent-soft', tokens.soft);
        target.style.setProperty('--accent-hover', tokens.hover);
        target.style.setProperty('--accent-bright', tokens.bright);
        target.style.setProperty('--accent-light', tokens.light);
        target.style.setProperty('--accent-glow', tokens.glow);
        target.style.setProperty('--accent-gradient', tokens.gradient);
    }

    function clearPresetVars(target) {
        if (!target || !target.style) return;
        PRESET_VAR_KEYS.forEach((varName) => {
            target.style.removeProperty(varName);
        });
    }

    function applyPresetVars(target, preset) {
        clearPresetVars(target);
        if (!target || !target.style || !preset || !preset.vars) return;
        Object.entries(preset.vars).forEach(([varName, value]) => {
            target.style.setProperty(varName, value);
        });
    }

    function applyThemeState(themeKey, target) {
        const key = normalizeThemeKey(themeKey);
        const store = readStore();
        const preset = resolveActivePreset(key, store);
        const state = mergeThemeState(store.themes[key], key);
        const tokens = computeTokens(key, state);

        if (!target) {
            applyPresetVars(document.documentElement, preset);
            applyAccentVars(document.documentElement, tokens);
            if (document.body) {
                applyPresetVars(document.body, preset);
                applyAccentVars(document.body, tokens);
            }
        } else {
            applyPresetVars(target, preset);
            applyAccentVars(target, tokens);
            if (target === document.documentElement && document.body) {
                applyPresetVars(document.body, preset);
                applyAccentVars(document.body, tokens);
            }
        }

        return { state, tokens, preset };
    }

    function applyCurrentTheme(target) {
        return applyThemeState(getThemeKey(), target || null);
    }

    const api = {
        storageKey: STORAGE_KEY,
        getThemeKey,
        readStore,
        writeStore,
        getThemeState,
        saveThemeState,
        resetTheme,
        resetAll,
        applyThemeState,
        applyCurrentTheme,
        getThemePresets: () => THEME_PRESETS.map((preset) => Object.assign({}, preset)),
        getActivePreset,
        setActivePreset,
        toggleThemeMode,
    };

    global.InterfaceTheme = api;

    try {
        applyCurrentTheme();
    } catch (_error) {
        // Ignore early-load errors.
    }

    if (!document.body) {
        document.addEventListener('DOMContentLoaded', () => {
            try {
                applyCurrentTheme();
            } catch (_error) {
                // Ignore late-load errors.
            }
        }, { once: true });
    }
})(window);
