(function (global) {
    const STORAGE_KEY = 'sun.interfaceTheme.v1';
    const STORE_VERSION = 2;

    const DEFAULTS = {
        light: {
            accent: '#c58a22'
        },
        dark: {
            accent: '#d6a449'
        }
    };
    const LEGACY_DEFAULT_ACCENTS = {
        light: '#008080',
        dark: '#009999'
    };

    function deepClone(obj) {
        return JSON.parse(JSON.stringify(obj));
    }

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
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
            b: n & 255
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
            b: a.b * (1 - w) + b.b * w
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
        } catch (_e) {
            // Ignore storage access errors.
        }
        return document.body && document.body.classList.contains('dark-mode') ? 'dark' : 'light';
    }

    function mergeThemeState(input, themeKey, migrateLegacyDefault = false) {
        const base = deepClone(DEFAULTS[themeKey]);
        const src = input && typeof input === 'object' ? input : {};
        const accent = normalizeHex(src.accent);
        const legacyAccent = LEGACY_DEFAULT_ACCENTS[themeKey];
        return {
            accent: accent && !(migrateLegacyDefault && accent === legacyAccent) ? accent : base.accent
        };
    }

    function normalizeStore(raw) {
        const src = raw && typeof raw === 'object' ? raw : {};
        const themes = src.themes && typeof src.themes === 'object' ? src.themes : {};
        const migrateLegacyDefault = src.version !== STORE_VERSION;
        return {
            version: STORE_VERSION,
            themes: {
                light: mergeThemeState(themes.light, 'light', migrateLegacyDefault),
                dark: mergeThemeState(themes.dark, 'dark', migrateLegacyDefault)
            }
        };
    }

    function readStore() {
        try {
            const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            return normalizeStore(parsed);
        } catch (_e) {
            return normalizeStore({});
        }
    }

    function writeStore(store) {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeStore(store)));
        } catch (_e) {
            // Ignore write errors in private browsing modes.
        }
    }

    function getThemeState(themeKey) {
        const store = readStore();
        return mergeThemeState(store.themes[themeKey], themeKey);
    }

    function saveThemeState(themeKey, patch) {
        const store = readStore();
        const merged = mergeThemeState(Object.assign({}, store.themes[themeKey], patch || {}), themeKey);
        store.themes[themeKey] = merged;
        writeStore(store);
        return merged;
    }

    function resetTheme(themeKey) {
        const store = readStore();
        store.themes[themeKey] = deepClone(DEFAULTS[themeKey]);
        writeStore(store);
    }

    function resetAll() {
        writeStore({ themes: deepClone(DEFAULTS) });
    }

    function computeTokens(themeKey, themeState) {
        const accent = normalizeHex(themeState && themeState.accent) || DEFAULTS[themeKey].accent;
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
            accent,
            hover,
            bright,
            light,
            glow,
            gradient
        };
    }

    function applyCssVars(target, tokens) {
        if (!target || !target.style) return;
        target.style.setProperty('--accent', tokens.accent);
        target.style.setProperty('--accent-hover', tokens.hover);
        target.style.setProperty('--accent-bright', tokens.bright);
        target.style.setProperty('--accent-light', tokens.light);
        target.style.setProperty('--accent-glow', tokens.glow);
        target.style.setProperty('--accent-gradient', tokens.gradient);
    }

    function applyThemeState(themeKey, target) {
        const state = getThemeState(themeKey);
        const tokens = computeTokens(themeKey, state);

        if (!target) {
            applyCssVars(document.documentElement, tokens);
            if (document.body) {
                // `body.dark-mode` defines its own defaults, so apply custom vars to body too.
                applyCssVars(document.body, tokens);
            }
        } else {
            applyCssVars(target, tokens);
            if (target === document.documentElement && document.body) {
                applyCssVars(document.body, tokens);
            }
        }

        return { state, tokens };
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
        applyCurrentTheme
    };

    global.InterfaceTheme = api;

    try {
        applyCurrentTheme();
    } catch (_e) {
        // Ignore early-load errors.
    }
})(window);
