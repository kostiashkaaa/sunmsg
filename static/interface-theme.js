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
            accent: '#c58a22',
            vars: {},
        },
        {
            id: 'light-sky',
            mode: 'light',
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
            id: 'dark-classic',
            mode: 'dark',
            accent: '#d6a449',
            vars: {},
        },
        {
            id: 'dark-forest',
            mode: 'dark',
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
            id: 'custom-light',
            mode: 'light',
            accent: null,
            custom: true,
            vars: {},
        },
        {
            id: 'custom-dark',
            mode: 'dark',
            accent: null,
            custom: true,
            vars: {},
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
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeStore(store)));
        } catch (_error) {
            // Ignore write errors in private browsing modes.
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
        const glow = rgbaFromHex(accent, key === 'dark' ? 0.24 : 0.2);
        const gradient = `linear-gradient(135deg, ${accent} 0%, ${bright} 100%)`;

        return {
            accent,
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
