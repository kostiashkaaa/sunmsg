(function (global) {
    const STORAGE_KEY = 'sun.chatAppearance.v2';
    const READ_TICK_BLUE = '#0b3d78';
    const READ_TICK_YELLOW = '#ffd166';
    const BASE_BUBBLE_PALETTES = {
        light: { inBg: '#fffaf1', inText: '#17130d', outBg: '#2b2417', outText: '#fff4dc' },
        dark: { inBg: '#242016', inText: '#f4ecd9', outBg: '#d7a84d', outText: '#1d160b' },
    };
    const PRESET_BUBBLE_PALETTES = Object.freeze({
        'light-classic': BASE_BUBBLE_PALETTES.light,
        'light-sky': { inBg: '#f7fbff', inText: '#12233a', outBg: '#3d85e0', outText: '#f5f9ff' },
        'light-mist': { inBg: '#f7f8fa', inText: '#1a1f28', outBg: '#6d7f99', outText: '#f5f7fb' },
        'custom-light': { inBg: '#fffaf0', inText: '#20180f', outBg: '#c58a22', outText: '#fff6e8' },
        'dark-classic': BASE_BUBBLE_PALETTES.dark,
        'dark-forest': { inBg: '#1a2a23', inText: '#e1efe9', outBg: '#34b381', outText: '#08180f' },
        'dark-midnight': { inBg: '#1a2442', inText: '#e6edff', outBg: '#5b7dff', outText: '#f1f4ff' },
        'dark-graphite': { inBg: '#20242a', inText: '#e5e9ef', outBg: '#8a98ad', outText: '#0f141a' },
        'custom-dark': { inBg: '#251d15', inText: '#f1e4cc', outBg: '#d6a449', outText: '#1b1309' },
    });

    const DEFAULTS = {
        light: {
            mode: 'default',
            presetId: null,
            color: '#e9edf3',
            gradientA: '#f5f7fb',
            gradientB: '#e4ebf3',
            bubbleOpacity: 0.9,
            bubbleColors: {
                mode: 'auto',
                inBg: '#fffaf1',
                inText: '#17130d',
                outBg: '#2b2417',
                outText: '#fff4dc',
            },
            custom: {
                imageDataUrl: null,
                darken: 8,
                blur: 0,
                opacity: 1,
                position: 'center center',
                scale: 100,
                repeat: false
            }
        },
        dark: {
            mode: 'default',
            presetId: null,
            color: '#161b22',
            gradientA: '#141a23',
            gradientB: '#10141c',
            bubbleOpacity: 0.88,
            bubbleColors: {
                mode: 'auto',
                inBg: '#242016',
                inText: '#f4ecd9',
                outBg: '#d7a84d',
                outText: '#1d160b',
            },
            custom: {
                imageDataUrl: null,
                darken: 18,
                blur: 0,
                opacity: 1,
                position: 'center center',
                scale: 110,
                repeat: false
            }
        }
    };

    const DEFAULT_BACKGROUNDS = {
        light: {
            baseColor: '#f2ede2',
            image: [
                'radial-gradient(circle at 18% 16%, rgba(255,255,255,0.78), rgba(255,255,255,0) 34%)',
                'radial-gradient(circle at 82% 18%, rgba(215,202,176,0.16), rgba(215,202,176,0) 30%)',
                'radial-gradient(circle at 72% 82%, rgba(196,148,60,0.10), rgba(196,148,60,0) 28%)',
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220' viewBox='0 0 220 220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)' opacity='0.025'/%3E%3C/svg%3E\")"
            ].join(','),
            size: 'cover, cover, cover, 260px 260px',
            position: '18% 16%, 82% 18%, 72% 82%, center center',
            repeat: 'no-repeat, no-repeat, no-repeat, repeat',
            luminance: 0.92
        },
        dark: {
            baseColor: '#12100c',
            image: [
                'radial-gradient(circle at 16% 18%, rgba(196,148,60,0.08), rgba(196,148,60,0) 26%)',
                'radial-gradient(circle at 82% 20%, rgba(214,164,73,0.07), rgba(214,164,73,0) 24%)',
                'radial-gradient(circle at 50% 100%, rgba(255,255,255,0.03), rgba(255,255,255,0) 34%)',
                "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260' viewBox='0 0 260 260'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.72' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='260' height='260' filter='url(%23n)' opacity='0.055'/%3E%3C/svg%3E\")"
            ].join(','),
            size: 'cover, cover, cover, 320px 320px',
            position: '16% 18%, 82% 20%, 50% 100%, center center',
            repeat: 'no-repeat, no-repeat, no-repeat, repeat',
            luminance: 0.1
        }
    };

    const PRESETS = [
        { id: 'dark-graphite', name: 'Soot', group: '\u0422\u0435\u043C\u043D\u044B\u0435 \u043E\u0434\u043D\u043E\u0442\u043E\u043D\u043D\u044B\u0435', mode: 'color', color: '#18140f', luminance: 0.08 },
        { id: 'dark-slate', name: 'Espresso', group: '\u0422\u0435\u043C\u043D\u044B\u0435 \u043E\u0434\u043D\u043E\u0442\u043E\u043D\u043D\u044B\u0435', mode: 'color', color: '#211a14', luminance: 0.1 },
        { id: 'dark-forest', name: 'Deep Teal', group: '\u0422\u0435\u043C\u043D\u044B\u0435 \u043E\u0434\u043D\u043E\u0442\u043E\u043D\u043D\u044B\u0435', mode: 'color', color: '#10211f', luminance: 0.11 },
        { id: 'light-cloud', name: 'Ivory', group: '\u0421\u0432\u0435\u0442\u043B\u044B\u0435 \u043E\u0434\u043D\u043E\u0442\u043E\u043D\u043D\u044B\u0435', mode: 'color', color: '#f6f2ea', luminance: 0.96 },
        { id: 'light-sand', name: 'Linen', group: '\u0421\u0432\u0435\u0442\u043B\u044B\u0435 \u043E\u0434\u043D\u043E\u0442\u043E\u043D\u043D\u044B\u0435', mode: 'color', color: '#efe7d8', luminance: 0.9 },
        { id: 'light-mist', name: 'Pearl', group: '\u0421\u0432\u0435\u0442\u043B\u044B\u0435 \u043E\u0434\u043D\u043E\u0442\u043E\u043D\u043D\u044B\u0435', mode: 'color', color: '#e8eef0', luminance: 0.93 },
        { id: 'grad-mint', name: 'Sea Glass', group: '\u041C\u044F\u0433\u043A\u0438\u0435 \u0433\u0440\u0430\u0434\u0438\u0435\u043D\u0442\u044B', mode: 'gradient', gradient: 'linear-gradient(145deg,#eef6f1 0%,#ddebe7 52%,#e8f0ec 100%)', luminance: 0.91 },
        { id: 'grad-dusk', name: 'Amber Night', group: '\u041C\u044F\u0433\u043A\u0438\u0435 \u0433\u0440\u0430\u0434\u0438\u0435\u043D\u0442\u044B', mode: 'gradient', gradient: 'linear-gradient(145deg,#17130f 0%,#1f1914 46%,#0f2321 100%)', luminance: 0.1 },
        { id: 'grad-blush', name: 'Morning Paper', group: '\u041C\u044F\u0433\u043A\u0438\u0435 \u0433\u0440\u0430\u0434\u0438\u0435\u043D\u0442\u044B', mode: 'gradient', gradient: 'linear-gradient(140deg,#f3ece2 0%,#ece8df 42%,#e8efef 100%)', luminance: 0.9 },
        { id: 'pattern-grid', name: 'Ledger', group: '\u041F\u0430\u0442\u0442\u0435\u0440\u043D\u044B', mode: 'pattern', baseColor: '#f4efe5', pattern: 'linear-gradient(rgba(122,115,99,0.08) 1px, transparent 1px),linear-gradient(90deg, rgba(122,115,99,0.08) 1px, transparent 1px)', size: '24px 24px', repeat: 'repeat', luminance: 0.92 },
        { id: 'pattern-diag-dark', name: 'Contour', group: '\u041F\u0430\u0442\u0442\u0435\u0440\u043D\u044B', mode: 'pattern', baseColor: '#14110d', pattern: 'radial-gradient(circle at 0 0, rgba(196,148,60,0.07) 0 2px, transparent 2px),radial-gradient(circle at 18px 18px, rgba(214,164,73,0.055) 0 2px, transparent 2px)', size: '36px 36px', repeat: 'repeat', luminance: 0.09 },
        { id: 'texture-paper', name: 'Fiber', group: '\u0422\u0435\u043A\u0441\u0442\u0443\u0440\u0430', mode: 'texture', baseColor: '#f3eee4', texture: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220' viewBox='0 0 220 220'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.82' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='220' height='220' filter='url(%23n)' opacity='0.05'/%3E%3C/svg%3E\")", size: '280px 280px', repeat: 'repeat', luminance: 0.94 },
        { id: 'texture-carbon', name: 'Velvet', group: '\u0422\u0435\u043A\u0441\u0442\u0443\u0440\u0430', mode: 'texture', baseColor: '#120f0c', texture: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='260' height='260' viewBox='0 0 260 260'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.68' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='260' height='260' filter='url(%23n)' opacity='0.08'/%3E%3C/svg%3E\")", size: '320px 320px', repeat: 'repeat', luminance: 0.08 }
    ];

    const COLOR_CACHE = new Map();
    const IMAGE_LUMINANCE_CACHE = new Map();

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
        if (fullMatch) {
            return `#${fullMatch[1].toLowerCase()}`;
        }
        return null;
    }

    function rgbaFromHex(hex, alpha) {
        if (!hex) return `rgba(0,0,0,${alpha})`;
        const normalized = hex.replace('#', '');
        const full = normalized.length === 3
            ? normalized.split('').map((c) => c + c).join('')
            : normalized.padEnd(6, '0').slice(0, 6);
        const n = parseInt(full, 16);
        const r = (n >> 16) & 255;
        const g = (n >> 8) & 255;
        const b = n & 255;
        return `rgba(${r}, ${g}, ${b}, ${clamp(alpha, 0, 1).toFixed(3)})`;
    }

    function cssColorToRgb(color) {
        if (!color) return null;
        if (COLOR_CACHE.has(color)) return COLOR_CACHE.get(color);
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#000';
        ctx.fillStyle = color;
        const resolved = ctx.fillStyle;
        const match = resolved.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
        if (!match) return null;
        const rgb = { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
        COLOR_CACHE.set(color, rgb);
        return rgb;
    }

    function luminanceFromRgb(rgb) {
        if (!rgb) return 0.5;
        const srgb = [rgb.r, rgb.g, rgb.b].map((v) => {
            const n = v / 255;
            return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
    }

    function contrastRatio(luminanceA, luminanceB) {
        const lighter = Math.max(luminanceA, luminanceB);
        const darker = Math.min(luminanceA, luminanceB);
        return (lighter + 0.05) / (darker + 0.05);
    }

    function resolveReadTickColor(outBg) {
        const bgLuminance = luminanceFromRgb(cssColorToRgb(outBg));
        const blueContrast = contrastRatio(bgLuminance, luminanceFromRgb(cssColorToRgb(READ_TICK_BLUE)));
        const yellowContrast = contrastRatio(bgLuminance, luminanceFromRgb(cssColorToRgb(READ_TICK_YELLOW)));
        return blueContrast >= yellowContrast ? READ_TICK_BLUE : READ_TICK_YELLOW;
    }

    async function estimateImageLuminance(dataUrl) {
        if (!dataUrl) return 0.5;
        if (IMAGE_LUMINANCE_CACHE.has(dataUrl)) return IMAGE_LUMINANCE_CACHE.get(dataUrl);
        const result = await new Promise((resolve) => {
            const img = new Image();
            img.onload = function () {
                const canvas = document.createElement('canvas');
                const w = 40;
                const h = 40;
                canvas.width = w;
                canvas.height = h;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (!ctx) {
                    resolve(0.5);
                    return;
                }
                ctx.drawImage(img, 0, 0, w, h);
                const pixels = ctx.getImageData(0, 0, w, h).data;
                let r = 0;
                let g = 0;
                let b = 0;
                let count = 0;
                for (let i = 0; i < pixels.length; i += 4) {
                    const a = pixels[i + 3] / 255;
                    if (a <= 0.01) continue;
                    r += pixels[i] * a;
                    g += pixels[i + 1] * a;
                    b += pixels[i + 2] * a;
                    count += a;
                }
                if (count <= 0) {
                    resolve(0.5);
                    return;
                }
                resolve(luminanceFromRgb({ r: r / count, g: g / count, b: b / count }));
            };
            img.onerror = function () { resolve(0.5); };
            img.src = dataUrl;
        });
        IMAGE_LUMINANCE_CACHE.set(dataUrl, result);
        return result;
    }

    function getThemeKey(isDark) {
        return isDark ? 'dark' : 'light';
    }

    function detectDarkMode() {
        return document.documentElement.classList.contains('dark-mode')
            || Boolean(document.body?.classList?.contains('dark-mode'))
            || localStorage.getItem('darkMode') === 'true';
    }

    function normalizeThemeKey(themeKey) {
        return String(themeKey || '').trim().toLowerCase() === 'dark' ? 'dark' : 'light';
    }

    function resolveInterfacePresetId(themeKey) {
        const normalizedTheme = normalizeThemeKey(themeKey);
        const interfaceThemeApi = global.InterfaceTheme || null;
        if (interfaceThemeApi && typeof interfaceThemeApi.getActivePreset === 'function') {
            const activePreset = interfaceThemeApi.getActivePreset(normalizedTheme);
            const presetId = String(activePreset?.id || '').trim();
            if (presetId) return presetId;
        }
        try {
            const parsed = JSON.parse(localStorage.getItem('sun.interfaceTheme.v1') || '{}');
            const modePresets = parsed && typeof parsed.modePresets === 'object' ? parsed.modePresets : {};
            const fromMode = String(modePresets[normalizedTheme] || '').trim();
            if (fromMode) return fromMode;
            const fromActive = String(parsed.activePresetId || '').trim();
            if (fromActive && fromActive.startsWith(`${normalizedTheme}-`)) return fromActive;
            if (fromActive === 'custom-light' || fromActive === 'custom-dark') return fromActive;
        } catch (_error) {
            // Ignore invalid persisted interface theme state.
        }
        return normalizedTheme === 'dark' ? 'dark-classic' : 'light-classic';
    }

    function getThemeBubbleDefaults(themeKey) {
        const normalizedTheme = normalizeThemeKey(themeKey);
        const presetId = resolveInterfacePresetId(normalizedTheme);
        const presetPalette = PRESET_BUBBLE_PALETTES[presetId];
        const fallback = BASE_BUBBLE_PALETTES[normalizedTheme];
        return Object.assign({
            mode: 'auto',
            presetId: presetId || null,
        }, presetPalette || fallback);
    }

    function normalizeBubbleColors(input, fallbackPalette) {
        const fallback = fallbackPalette && typeof fallbackPalette === 'object'
            ? fallbackPalette
            : BASE_BUBBLE_PALETTES.light;
        const source = input && typeof input === 'object' ? input : {};
        return {
            mode: source.mode === 'custom' ? 'custom' : 'auto',
            inBg: normalizeHex(source.inBg) || fallback.inBg,
            inText: normalizeHex(source.inText) || fallback.inText,
            outBg: normalizeHex(source.outBg) || fallback.outBg,
            outText: normalizeHex(source.outText) || fallback.outText,
        };
    }

    function mergeThemeState(input, theme) {
        const base = deepClone(DEFAULTS[theme]);
        const src = input && typeof input === 'object' ? input : {};
        const out = Object.assign(base, src);
        out.custom = Object.assign({}, base.custom, src.custom || {});
        out.bubbleColors = normalizeBubbleColors(
            src.bubbleColors,
            getThemeBubbleDefaults(theme)
        );
        out.bubbleOpacity = clamp(Number(out.bubbleOpacity ?? base.bubbleOpacity), 0.35, 1);
        out.custom.darken = clamp(Number(out.custom.darken ?? base.custom.darken), 0, 70);
        out.custom.blur = clamp(Number(out.custom.blur ?? base.custom.blur), 0, 18);
        out.custom.opacity = clamp(Number(out.custom.opacity ?? base.custom.opacity), 0.2, 1);
        out.custom.scale = clamp(Number(out.custom.scale ?? base.custom.scale), 30, 240);
        out.custom.repeat = !!out.custom.repeat;
        return out;
    }

    function normalizeStore(raw) {
        const base = { themes: { light: deepClone(DEFAULTS.light), dark: deepClone(DEFAULTS.dark) } };
        const src = raw && typeof raw === 'object' ? raw : {};
        const themes = src.themes || {};
        base.themes.light = mergeThemeState(themes.light, 'light');
        base.themes.dark = mergeThemeState(themes.dark, 'dark');
        return base;
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
        const normalizedStore = normalizeStore(store);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizedStore));
        if (window.SUN_CLIENT_PREFERENCES && typeof window.SUN_CLIENT_PREFERENCES.merge === 'function') {
            try {
                window.SUN_CLIENT_PREFERENCES.merge({
                    chatAppearanceStore: normalizedStore,
                    darkMode: detectDarkMode(),
                });
            } catch (_error) {
                // Ignore unified preference sync errors.
            }
        }
    }

    function getPresetById(id) {
        return PRESETS.find((p) => p.id === id) || null;
    }

    function buildWallpaper(state, theme) {
        if (!state || state.mode === 'default') {
            return {
                baseColor: 'var(--chat-bg)',
                image: 'none',
                size: 'cover',
                position: 'center center',
                repeat: 'no-repeat',
                blur: 0,
                dim: 0,
                opacity: 1,
                luminance: DEFAULT_BACKGROUNDS[theme].luminance,
            };
        }

        if (state.mode === 'preset') {
            const preset = getPresetById(state.presetId);
            if (preset) {
                if (preset.mode === 'color') {
                    return { baseColor: preset.color, image: 'none', size: 'auto', position: 'center center', repeat: 'no-repeat', blur: 0, dim: 0, opacity: 1, luminance: preset.luminance };
                }
                if (preset.mode === 'gradient') {
                    return { baseColor: 'transparent', image: preset.gradient, size: 'cover', position: 'center center', repeat: 'no-repeat', blur: 0, dim: 0, opacity: 1, luminance: preset.luminance };
                }
                if (preset.mode === 'pattern') {
                    return { baseColor: preset.baseColor, image: preset.pattern, size: preset.size || 'auto', position: 'center center', repeat: preset.repeat || 'repeat', blur: 0, dim: 0, opacity: 1, luminance: preset.luminance };
                }
                if (preset.mode === 'texture') {
                    return { baseColor: preset.baseColor, image: preset.texture, size: preset.size || 'auto', position: 'center center', repeat: preset.repeat || 'repeat', blur: 0, dim: 0, opacity: 1, luminance: preset.luminance };
                }
            }
            return Object.assign({}, DEFAULT_BACKGROUNDS[theme], { blur: 0, dim: 0, opacity: 1 });
        }

        if (state.mode === 'color') {
            return {
                baseColor: state.color || (theme === 'dark' ? '#141920' : '#eef2f8'),
                image: 'none',
                size: 'auto',
                position: 'center center',
                repeat: 'no-repeat',
                blur: 0,
                dim: 0,
                opacity: 1
            };
        }

        if (state.mode === 'gradient') {
            const a = state.gradientA || (theme === 'dark' ? '#131a24' : '#f3f6fb');
            const b = state.gradientB || (theme === 'dark' ? '#10151e' : '#e7edf6');
            return {
                baseColor: 'transparent',
                image: `linear-gradient(135deg, ${a} 0%, ${b} 100%)`,
                size: 'cover',
                position: 'center center',
                repeat: 'no-repeat',
                blur: 0,
                dim: 0,
                opacity: 1,
                luminance: (luminanceFromRgb(cssColorToRgb(a)) + luminanceFromRgb(cssColorToRgb(b))) / 2
            };
        }

        if (state.mode === 'custom' && state.custom && state.custom.imageDataUrl) {
            const normalizedScale = clamp(state.custom.scale, 30, 240);
            const customSize = state.custom.repeat
                ? `${Math.round(normalizedScale * 0.9)}px ${Math.round(normalizedScale * 0.9)}px`
                : `min(${normalizedScale}vw, 1800px) auto`;
            return {
                baseColor: theme === 'dark' ? '#0f131a' : '#edf2f7',
                image: `url("${state.custom.imageDataUrl}")`,
                size: customSize,
                position: state.custom.position || 'center center',
                repeat: state.custom.repeat ? 'repeat' : 'no-repeat',
                blur: `${clamp(state.custom.blur, 0, 18).toFixed(1)}px`,
                dim: clamp(state.custom.darken / 100, 0, 0.75),
                opacity: clamp(state.custom.opacity, 0.2, 1)
            };
        }

        return Object.assign({}, DEFAULT_BACKGROUNDS[theme], { blur: 0, dim: 0, opacity: 1 });
    }

    async function resolveLuminance(themeState, wallpaper, theme) {
        if (typeof wallpaper.luminance === 'number') return wallpaper.luminance;
        if (themeState.mode === 'custom' && themeState.custom.imageDataUrl) {
            const imgLum = await estimateImageLuminance(themeState.custom.imageDataUrl);
            const darken = clamp(themeState.custom.darken / 100, 0, 0.75);
            return clamp(imgLum * (1 - darken), 0, 1);
        }
        if (themeState.mode === 'gradient') {
            return clamp((luminanceFromRgb(cssColorToRgb(themeState.gradientA)) + luminanceFromRgb(cssColorToRgb(themeState.gradientB))) / 2, 0, 1);
        }
        const fromColor = luminanceFromRgb(cssColorToRgb(wallpaper.baseColor));
        return themeState.mode === 'default' ? DEFAULT_BACKGROUNDS[theme].luminance : fromColor;
    }

    function computeBubblePalette(theme, luminance, bubbleOpacity, state) {
        const normalizedTheme = normalizeThemeKey(theme);
        const lightPalette = BASE_BUBBLE_PALETTES.light;
        const darkPalette = BASE_BUBBLE_PALETTES.dark;
        const basePresetPalette = getThemeBubbleDefaults(normalizedTheme);

        let autoPalette = Object.assign({}, basePresetPalette);
        if (luminance >= 0.72) {
            autoPalette = Object.assign({}, lightPalette);
        } else if (luminance <= 0.22) {
            autoPalette = Object.assign({}, darkPalette);
        }

        const normalizedBubbleColors = normalizeBubbleColors(state?.bubbleColors, autoPalette);
        const palette = normalizedBubbleColors.mode === 'custom'
            ? normalizedBubbleColors
            : autoPalette;

        return {
            inBg: rgbaFromHex(palette.inBg, bubbleOpacity),
            inText: palette.inText,
            outBg: rgbaFromHex(palette.outBg, bubbleOpacity),
            outText: palette.outText,
            readTickColor: resolveReadTickColor(palette.outBg),
            contrastMode: luminance >= 0.72 ? 'high' : 'normal'
        };
    }

    function applyCssVars(target, wallpaper, bubblePalette) {
        target.style.setProperty('--chat-wallpaper-base', wallpaper.baseColor || 'transparent');
        target.style.setProperty('--chat-wallpaper-image', wallpaper.image || 'none');
        target.style.setProperty('--chat-wallpaper-size', wallpaper.size || 'cover');
        target.style.setProperty('--chat-wallpaper-position', wallpaper.position || 'center center');
        target.style.setProperty('--chat-wallpaper-repeat', wallpaper.repeat || 'no-repeat');
        target.style.setProperty('--chat-wallpaper-opacity', String(wallpaper.opacity ?? 1));
        target.style.setProperty('--chat-wallpaper-blur', typeof wallpaper.blur === 'string' ? wallpaper.blur : `${wallpaper.blur || 0}px`);
        target.style.setProperty('--chat-wallpaper-dim', String(wallpaper.dim ?? 0));

        target.style.setProperty('--chat-bubble-in-bg', bubblePalette.inBg);
        target.style.setProperty('--chat-bubble-in-text', bubblePalette.inText);
        target.style.setProperty('--chat-bubble-out-bg', bubblePalette.outBg);
        target.style.setProperty('--chat-bubble-out-text', bubblePalette.outText);
        target.style.setProperty('--read-tick-color', bubblePalette.readTickColor);

        if (bubblePalette.contrastMode === 'high') {
            target.setAttribute('data-chat-contrast', 'high');
        } else {
            target.setAttribute('data-chat-contrast', 'normal');
        }
    }

    async function applyThemeState(themeKey, target = document.documentElement) {
        const store = readStore();
        const normalizedTheme = normalizeThemeKey(themeKey);
        const state = mergeThemeState(store.themes[normalizedTheme], normalizedTheme);
        const wallpaper = buildWallpaper(state, normalizedTheme);
        const luminance = await resolveLuminance(state, wallpaper, normalizedTheme);
        const bubblePalette = computeBubblePalette(normalizedTheme, luminance, state.bubbleOpacity, state);
        applyCssVars(target, wallpaper, bubblePalette);
        return { state, wallpaper, luminance, bubblePalette };
    }

    async function applyCurrentTheme(target) {
        return applyThemeState(getThemeKey(detectDarkMode()), target || document.documentElement);
    }

    function saveThemeState(themeKey, patch) {
        const normalizedTheme = normalizeThemeKey(themeKey);
        const store = readStore();
        const merged = mergeThemeState(Object.assign({}, store.themes[normalizedTheme], patch || {}), normalizedTheme);
        store.themes[normalizedTheme] = merged;
        writeStore(store);
        return merged;
    }

    function setMode(themeKey, mode) {
        saveThemeState(themeKey, { mode });
    }

    function getThemeState(themeKey) {
        const normalizedTheme = normalizeThemeKey(themeKey);
        const store = readStore();
        return mergeThemeState(store.themes[normalizedTheme], normalizedTheme);
    }

    function resetTheme(themeKey) {
        const normalizedTheme = normalizeThemeKey(themeKey);
        const store = readStore();
        store.themes[normalizedTheme] = deepClone(DEFAULTS[normalizedTheme]);
        writeStore(store);
    }

    function resetAll() {
        writeStore({ themes: deepClone(DEFAULTS) });
    }

    function applyAcrossThemes(patchBuilder) {
        const store = readStore();
        ['light', 'dark'].forEach((theme) => {
            const patch = patchBuilder(theme, store.themes[theme]);
            store.themes[theme] = mergeThemeState(Object.assign({}, store.themes[theme], patch), theme);
        });
        writeStore(store);
    }

    function normalizePresetGroups() {
        const groups = [];
        PRESETS.forEach((preset) => {
            let group = groups.find((g) => g.name === preset.group);
            if (!group) {
                group = { name: preset.group, items: [] };
                groups.push(group);
            }
            group.items.push(preset);
        });
        return groups;
    }

    const api = {
        storageKey: STORAGE_KEY,
        getPresets: () => PRESETS.slice(),
        getPresetGroups: normalizePresetGroups,
        getThemeKey,
        detectDarkMode,
        getThemeState,
        saveThemeState,
        setMode,
        resetTheme,
        resetAll,
        getThemeBubbleDefaults,
        applyThemeState,
        applyCurrentTheme,
        applyAcrossThemes,
        readStore,
        writeStore,
        mergeThemeState,
        deepClone
    };

    global.ChatAppearance = api;

    try {
        void applyCurrentTheme().catch(() => {});
    } catch (_error) {
        // Ignore early-load errors.
    }
})(window);
