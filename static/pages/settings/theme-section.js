import { prepareWallpaperDataUrl } from './wallpaper-image.js';
import { readAppliedDarkMode } from '../../modules/theme-state.js';

export function initThemeSection({
    tr,
    notifyParent,
    showAlert,
    chatAppearanceApi,
    interfaceThemeApi,
    persistClientPreferences,
}) {
    const MESSAGE_SCALE_STORAGE_KEY = 'sun_chat_message_scale_v1';
    const MESSAGE_SCALE_MOBILE_QUERY = '(max-width: 768px)';
    const SEND_SHORTCUT_STORAGE_KEY = 'sun_send_shortcut_mode_v1';
    const TIME_FORMAT_STORAGE_KEY = 'sun_time_format_v1';
    const themePresetEls = Array.from(document.querySelectorAll('.theme-preview[data-theme-preset]'));

    const isDark = () => readAppliedDarkMode();
    const activeThemeKey = () => (isDark() ? 'dark' : 'light');
    let refreshChatAppearanceUi = null;
    let refreshInterfaceThemeUi = null;
    let persistTimerId = 0;
    let persistInFlight = false;
    let persistQueued = false;
    let pendingClientPreferences = null;

    function resolveCurrentLanguage() {
        const i18nApi = window.SUN_I18N || null;
        if (i18nApi && typeof i18nApi.getLanguage === 'function') {
            return String(i18nApi.getLanguage() || 'ru').toLowerCase() === 'en' ? 'en' : 'ru';
        }
        return String(document.documentElement?.lang || 'ru').toLowerCase() === 'en' ? 'en' : 'ru';
    }

    function syncClientPreferencesLocal(preferences) {
        if (!window.SUN_CLIENT_PREFERENCES || typeof window.SUN_CLIENT_PREFERENCES.collect !== 'function') {
            return;
        }
        try {
            window.SUN_CLIENT_PREFERENCES.collect(preferences || collectClientPreferences(), {
                touchUpdatedAt: true,
            });
        } catch (_) {
            // Ignore local preference sync errors.
        }
    }

    function clampMessageScale(value) {
        const parsed = Number.parseFloat(value);
        if (!Number.isFinite(parsed)) return 1;
        return Math.min(1.3, Math.max(0.9, parsed));
    }

    function isMobileMessageScaleScope() {
        if (typeof window.matchMedia === 'function') {
            return Boolean(window.matchMedia(MESSAGE_SCALE_MOBILE_QUERY).matches);
        }
        return Number(window.innerWidth || 0) > 0 && Number(window.innerWidth) <= 768;
    }

    function getMessageScaleScope() {
        return isMobileMessageScaleScope() ? 'mobile' : 'desktop';
    }

    function getScopedMessageScaleStorageKey(scope = getMessageScaleScope()) {
        return `${MESSAGE_SCALE_STORAGE_KEY}:${scope}`;
    }

    function readScopedMessageScale() {
        try {
            const scope = getMessageScaleScope();
            const scopedValue = localStorage.getItem(getScopedMessageScaleStorageKey(scope));
            if (scopedValue !== null) return scopedValue;
            return scope === 'desktop' ? localStorage.getItem(MESSAGE_SCALE_STORAGE_KEY) : null;
        } catch (_) {
            return null;
        }
    }

    function persistScopedMessageScale(scale) {
        const scope = getMessageScaleScope();
        const value = clampMessageScale(scale).toFixed(2);
        localStorage.setItem(getScopedMessageScaleStorageKey(scope), value);
        if (scope === 'desktop') {
            localStorage.setItem(MESSAGE_SCALE_STORAGE_KEY, value);
        }
    }

    function normalizeSendShortcut(value) {
        return String(value || '').trim().toLowerCase() === 'ctrl_enter' ? 'ctrl_enter' : 'enter';
    }

    function normalizeTimeFormat(value) {
        return String(value || '').trim().toLowerCase() === '12h' ? '12h' : '24h';
    }

    function collectClientPreferences() {
        let messageScale = 1;
        let performanceMode = 'auto';
        let motionLevel = 'auto';
        let sendShortcut = 'enter';
        let timeFormat = '24h';

        try {
            messageScale = clampMessageScale(localStorage.getItem(MESSAGE_SCALE_STORAGE_KEY) || 1);
            const rawPerformanceMode = String(localStorage.getItem('sun_performance_mode') || '').trim().toLowerCase();
            if (rawPerformanceMode === 'auto' || rawPerformanceMode === 'full' || rawPerformanceMode === 'lite') {
                performanceMode = rawPerformanceMode;
            }
            const rawMotionLevel = String(localStorage.getItem('sun_motion_level') || '').trim().toLowerCase();
            if (rawMotionLevel === 'auto' || rawMotionLevel === 'full' || rawMotionLevel === 'balanced' || rawMotionLevel === 'lite') {
                motionLevel = rawMotionLevel;
            }
            sendShortcut = normalizeSendShortcut(localStorage.getItem(SEND_SHORTCUT_STORAGE_KEY));
            timeFormat = normalizeTimeFormat(localStorage.getItem(TIME_FORMAT_STORAGE_KEY));
        } catch (_) {}

        return {
            darkMode: isDark(),
            language: resolveCurrentLanguage(),
            updatedAt: new Date().toISOString(),
            messageScale,
            performanceMode,
            motionLevel,
            sendShortcut,
            timeFormat,
            interfaceThemeStore: interfaceThemeApi?.readStore?.() || {},
            chatAppearanceStore: chatAppearanceApi?.readStore?.() || {},
        };
    }

    async function flushClientPreferencesPersist() {
        if (typeof persistClientPreferences !== 'function') return;
        if (persistInFlight) {
            persistQueued = true;
            return;
        }

        persistInFlight = true;
        const payload = pendingClientPreferences || collectClientPreferences();
        pendingClientPreferences = null;
        try {
            await persistClientPreferences(payload);
        } catch (_) {
            // Do not block UI if background preferences sync fails.
        } finally {
            persistInFlight = false;
            if (persistQueued) {
                persistQueued = false;
                scheduleClientPreferencesPersist(120);
            }
        }
    }

    function scheduleClientPreferencesPersist(delayMs = 360) {
        const payload = collectClientPreferences();
        pendingClientPreferences = payload;
        syncClientPreferencesLocal(payload);
        if (typeof persistClientPreferences !== 'function') return;
        if (persistTimerId) {
            window.clearTimeout(persistTimerId);
        }
        persistTimerId = window.setTimeout(() => {
            persistTimerId = 0;
            flushClientPreferencesPersist().catch(() => {});
        }, delayMs);
    }

    function activePresetId() {
        if (interfaceThemeApi && typeof interfaceThemeApi.getActivePreset === 'function') {
            const preset = interfaceThemeApi.getActivePreset(activeThemeKey());
            return String(preset?.id || '');
        }
        return activeThemeKey() === 'dark' ? 'dark-classic' : 'light-classic';
    }

    function syncPresetSelectionUi() {
        const presetId = activePresetId();
        themePresetEls.forEach((preview) => {
            preview.classList.toggle('selected', preview.dataset.themePreset === presetId);
        });
    }

    function applyTheme(dark, options = {}) {
        const skipInterfaceApply = options.skipInterfaceApply === true;
        document.documentElement.classList.toggle('dark-mode', dark);
        document.body.classList.toggle('dark-mode', dark);
        syncPresetSelectionUi();

        if (interfaceThemeApi && !skipInterfaceApply) {
            interfaceThemeApi.applyCurrentTheme();
            if (typeof refreshInterfaceThemeUi === 'function') {
                refreshInterfaceThemeUi();
            }
        }
        if (chatAppearanceApi) {
            chatAppearanceApi.applyCurrentTheme();
            if (typeof refreshChatAppearanceUi === 'function') {
                refreshChatAppearanceUi();
            }
        }
        notifyParent('sun-settings-theme-updated', { dark });
    }

    applyTheme(isDark());

    function setTheme(dark) {
        localStorage.setItem('darkMode', dark ? 'true' : 'false');
        applyTheme(!!dark);
        scheduleClientPreferencesPersist();
    }

    function setThemePreset(presetId) {
        if (interfaceThemeApi && typeof interfaceThemeApi.setActivePreset === 'function') {
            const applied = interfaceThemeApi.setActivePreset(presetId, { apply: true });
            const dark = String(applied?.themeKey || activeThemeKey()) === 'dark';
            applyTheme(dark, { skipInterfaceApply: true });
            scheduleClientPreferencesPersist();
            return;
        }

        const forceDark = String(presetId || '').startsWith('dark');
        setTheme(forceDark);
    }

    themePresetEls.forEach((preview) => {
        preview.addEventListener('click', () => {
            const presetId = String(preview.dataset.themePreset || '').trim();
            if (!presetId) return;
            setThemePreset(presetId);
        });
    });

    (function initInterfaceThemeSettings() {
        if (!interfaceThemeApi) return;

        const accentInput = document.getElementById('interfaceAccentColor');
        const scopeLabel = document.getElementById('interfaceAccentScope');
        const resetThemeBtn = document.getElementById('interfaceAccentResetThemeBtn');
        const resetAllBtn = document.getElementById('interfaceAccentResetAllBtn');

        if (!accentInput || !scopeLabel || !resetThemeBtn || !resetAllBtn) return;

        function refreshControls() {
            const theme = activeThemeKey();
            syncPresetSelectionUi();
            const state = interfaceThemeApi.getThemeState(theme);
            accentInput.value = state.accent || (theme === 'dark' ? '#d6a449' : '#c58a22');
            scopeLabel.textContent = theme === 'dark'
                ? tr('Сейчас настраивается: тёмная тема')
                : tr('Сейчас настраивается: светлая тема');
        }

        function applyInterfaceThemeNow() {
            interfaceThemeApi.applyCurrentTheme();
            notifyParent('sun-settings-interface-theme-updated', { theme: activeThemeKey() });
        }

        refreshInterfaceThemeUi = () => {
            refreshControls();
        };

        accentInput.addEventListener('input', function () {
            interfaceThemeApi.saveThemeState(activeThemeKey(), { accent: this.value });
            applyInterfaceThemeNow();
            scheduleClientPreferencesPersist();
        });

        resetThemeBtn.addEventListener('click', () => {
            interfaceThemeApi.resetTheme(activeThemeKey());
            refreshControls();
            applyInterfaceThemeNow();
            scheduleClientPreferencesPersist();
            showAlert('Цвет интерфейса для текущей темы сброшен', 'success');
        });

        resetAllBtn.addEventListener('click', () => {
            interfaceThemeApi.resetAll();
            refreshControls();
            applyInterfaceThemeNow();
            scheduleClientPreferencesPersist();
            showAlert('Пользовательские цвета интерфейса сброшены', 'success');
        });

        refreshControls();
        applyInterfaceThemeNow();
    })();

    (function initChatAppearanceSettings() {
        if (!chatAppearanceApi) return;

        const previewEl = document.getElementById('chatAppearancePreview');
        const modeRow = document.getElementById('chatStyleModeRow');
        const presetGroupsEl = document.getElementById('chatPresetGroups');
        const colorPicker = document.getElementById('chatColorPicker');
        const gradientA = document.getElementById('chatGradientColorA');
        const gradientB = document.getElementById('chatGradientColorB');
        const bubbleOpacity = document.getElementById('chatBubbleOpacity');
        const bubbleInBgInput = document.getElementById('chatBubbleInBg');
        const bubbleInTextInput = document.getElementById('chatBubbleInText');
        const bubbleOutBgInput = document.getElementById('chatBubbleOutBg');
        const bubbleOutTextInput = document.getElementById('chatBubbleOutText');
        const bubbleUseThemeBtn = document.getElementById('chatBubbleUseThemeBtn');
        const bubbleModeBadge = document.getElementById('chatBubbleModeBadge');
        const messageScaleRange = document.getElementById('chatMessageScaleRange');
        const messageScaleValue = document.getElementById('chatMessageScaleValue');
        const messageScalePresetButtons = Array.from(document.querySelectorAll('#chatMessageScalePresets .chat-scale-chip'));
        const customImageInput = document.getElementById('chatCustomImageInput');
        const customImageMeta = document.getElementById('chatCustomImageMeta');
        const customDarken = document.getElementById('chatCustomDarken');
        const customBlur = document.getElementById('chatCustomBlur');
        const customOpacity = document.getElementById('chatCustomOpacity');
        const customScale = document.getElementById('chatCustomScale');
        const customPosition = document.getElementById('chatCustomPosition');
        const customRepeat = document.getElementById('chatCustomRepeat');
        const clearBackgroundBtn = document.getElementById('chatClearBackgroundBtn');
        const resetAppearanceBtn = document.getElementById('chatResetAppearanceBtn');
        const panels = Array.from(document.querySelectorAll('.chat-style-panel'));
        const modeButtons = Array.from(modeRow ? modeRow.querySelectorAll('.chat-style-mode-btn') : []);

        if (!previewEl || !modeRow || !presetGroupsEl) return;

        function getCurrentState() {
            return chatAppearanceApi.getThemeState(activeThemeKey());
        }

        function getStoredMessageScale() {
            try {
                return clampMessageScale(readScopedMessageScale() || 1);
            } catch (_) {
                return 1;
            }
        }

        function renderMessageScaleControls(scale) {
            const normalizedScale = clampMessageScale(scale);
            if (messageScaleRange) {
                messageScaleRange.value = normalizedScale.toFixed(2);
            }
            if (messageScaleValue) {
                messageScaleValue.textContent = `${Math.round(normalizedScale * 100)}%`;
            }
            previewEl.style.setProperty('--chat-message-scale', normalizedScale.toFixed(2));
            messageScalePresetButtons.forEach((button) => {
                const buttonScale = clampMessageScale(button.dataset.scale);
                button.classList.toggle('active', Math.abs(buttonScale - normalizedScale) < 0.011);
            });
        }

        function applyMessageScale(scale, { persist = true } = {}) {
            const normalizedScale = clampMessageScale(scale);
            if (persist) {
                try {
                    persistScopedMessageScale(normalizedScale);
                } catch (_) {}
                scheduleClientPreferencesPersist();
            }
            renderMessageScaleControls(normalizedScale);
            notifyParent('sun-settings-message-scale-updated', { scale: normalizedScale });
        }

        function updateCustomMeta(state) {
            customImageMeta.textContent = state.custom && state.custom.imageDataUrl
                ? tr('Кастомный фон загружен')
                : tr('Файл не выбран');
        }

        function normalizeHexColor(value, fallback) {
            const safeFallback = String(fallback || '#000000').trim();
            const normalized = String(value || '').trim().toLowerCase();
            if (/^#[0-9a-f]{6}$/.test(normalized)) return normalized;
            if (/^#[0-9a-f]{3}$/.test(normalized)) {
                return `#${normalized[1]}${normalized[1]}${normalized[2]}${normalized[2]}${normalized[3]}${normalized[3]}`;
            }
            return safeFallback;
        }

        function getThemeBubbleDefaults() {
            if (typeof chatAppearanceApi.getThemeBubbleDefaults === 'function') {
                return chatAppearanceApi.getThemeBubbleDefaults(activeThemeKey());
            }
            return activeThemeKey() === 'dark'
                ? { inBg: '#242016', inText: '#f4ecd9', outBg: '#d7a84d', outText: '#1d160b' }
                : { inBg: '#fffaf1', inText: '#17130d', outBg: '#2b2417', outText: '#fff4dc' };
        }

        function resolveBubbleColorsForUi(state) {
            const defaults = getThemeBubbleDefaults();
            const bubbleState = state && typeof state.bubbleColors === 'object' ? state.bubbleColors : {};
            const mode = bubbleState.mode === 'custom' ? 'custom' : 'auto';
            const source = mode === 'custom' ? bubbleState : defaults;
            return {
                mode,
                inBg: normalizeHexColor(source.inBg, defaults.inBg),
                inText: normalizeHexColor(source.inText, defaults.inText),
                outBg: normalizeHexColor(source.outBg, defaults.outBg),
                outText: normalizeHexColor(source.outText, defaults.outText),
            };
        }

        function patchBubbleColors(partialPatch, mode = 'custom') {
            const state = getCurrentState();
            const current = resolveBubbleColorsForUi(state);
            const defaults = getThemeBubbleDefaults();
            const patch = partialPatch && typeof partialPatch === 'object' ? partialPatch : {};
            patchState({
                bubbleColors: {
                    mode: mode === 'custom' ? 'custom' : 'auto',
                    inBg: normalizeHexColor(patch.inBg ?? current.inBg, defaults.inBg),
                    inText: normalizeHexColor(patch.inText ?? current.inText, defaults.inText),
                    outBg: normalizeHexColor(patch.outBg ?? current.outBg, defaults.outBg),
                    outText: normalizeHexColor(patch.outText ?? current.outText, defaults.outText),
                },
            });
        }

        function setModeUI(mode) {
            modeButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.mode === mode));
            panels.forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === mode));
        }

        function refreshControlValues() {
            const state = getCurrentState();
            setModeUI(state.mode || 'default');
            colorPicker.value = state.color || '#e9edf3';
            gradientA.value = state.gradientA || '#f5f7fb';
            gradientB.value = state.gradientB || '#e4ebf3';
            bubbleOpacity.value = Math.round((state.bubbleOpacity || 0.9) * 100);
            customDarken.value = state.custom?.darken ?? 8;
            customBlur.value = state.custom?.blur ?? 0;
            customOpacity.value = Math.round((state.custom?.opacity ?? 1) * 100);
            customScale.value = state.custom?.scale ?? 100;
            customPosition.value = state.custom?.position || 'center center';
            customRepeat.checked = !!state.custom?.repeat;
            updateCustomMeta(state);
            renderMessageScaleControls(getStoredMessageScale());
            const bubbleColors = resolveBubbleColorsForUi(state);
            if (bubbleInBgInput) bubbleInBgInput.value = bubbleColors.inBg;
            if (bubbleInTextInput) bubbleInTextInput.value = bubbleColors.inText;
            if (bubbleOutBgInput) bubbleOutBgInput.value = bubbleColors.outBg;
            if (bubbleOutTextInput) bubbleOutTextInput.value = bubbleColors.outText;
            if (bubbleModeBadge) {
                bubbleModeBadge.textContent = bubbleColors.mode === 'custom'
                    ? tr('Ручные цвета')
                    : tr('Цвета по теме');
            }

            document.querySelectorAll('.preset-btn').forEach((el) => {
                const isActive = state.mode === 'preset' && state.presetId === el.dataset.presetId;
                el.classList.toggle('active', isActive);
            });
        }

        function swatchCssDeclarations(preset) {
            if (preset.mode === 'color') return `background:${preset.color};`;
            if (preset.mode === 'gradient') return `background:${preset.gradient};`;
            if (preset.mode === 'pattern') {
                return `background-color:${preset.baseColor};background-image:${preset.pattern};background-size:${preset.size || 'auto'};background-repeat:${preset.repeat || 'repeat'};`;
            }
            if (preset.mode === 'texture') {
                return `background-color:${preset.baseColor};background-image:${preset.texture};background-size:${preset.size || 'auto'};background-repeat:${preset.repeat || 'repeat'};`;
            }
            return '';
        }

        function readCspNonce() {
            const nonceHost = document.querySelector('script[nonce],style[nonce]');
            return nonceHost?.nonce || nonceHost?.getAttribute('nonce') || '';
        }

        function ensurePresetSwatchStyles(groups) {
            const styleId = 'chatPresetSwatchStyles';
            const css = [];
            groups.forEach((group) => {
                (group.items || []).forEach((item) => {
                    const presetId = String(item.id || '').trim();
                    if (!presetId) return;
                    const safeId = presetId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
                    css.push(`.preset-swatch[data-preset-id="${safeId}"]{${swatchCssDeclarations(item)}}`);
                });
            });
            let styleEl = document.getElementById(styleId);
            if (!styleEl) {
                styleEl = document.createElement('style');
                styleEl.id = styleId;
                const nonce = readCspNonce();
                if (nonce) {
                    styleEl.setAttribute('nonce', nonce);
                }
                document.head.appendChild(styleEl);
            }
            styleEl.textContent = css.join('\n');
        }

        function renderPresetGroups() {
            const groups = chatAppearanceApi.getPresetGroups();
            ensurePresetSwatchStyles(groups);
            presetGroupsEl.innerHTML = groups.map((group) => `
                <div class="preset-group">
                    <div class="preset-group-title">${group.name}</div>
                    <div class="preset-grid">
                        ${group.items.map((item) => `
                            <button type="button" class="preset-btn" data-preset-id="${item.id}">
                                <div class="preset-swatch" data-preset-id="${item.id}"></div>
                                <div class="preset-name">${item.name}</div>
                            </button>
                        `).join('')}
                    </div>
                </div>
            `).join('');
        }

        function patchState(patch) {
            chatAppearanceApi.saveThemeState(activeThemeKey(), patch);
            scheduleClientPreferencesPersist();
        }

        function patchCustom(customPatch) {
            const curr = getCurrentState();
            patchState({
                mode: 'custom',
                custom: Object.assign({}, curr.custom || {}, customPatch || {}),
            });
        }

        async function applyNowImmediate() {
            await chatAppearanceApi.applyCurrentTheme();
            await chatAppearanceApi.applyThemeState(activeThemeKey(), previewEl);
            notifyParent('sun-settings-chat-appearance-updated', { theme: activeThemeKey() });
        }

        let applyQueued = false;
        function scheduleApplyNow() {
            if (applyQueued) return;
            applyQueued = true;
            window.requestAnimationFrame(() => {
                applyQueued = false;
                applyNowImmediate().catch(() => {});
            });
        }

        refreshChatAppearanceUi = function () {
            refreshControlValues();
            scheduleApplyNow();
        };

        modeButtons.forEach((btn) => {
            btn.addEventListener('click', async () => {
                patchState({ mode: btn.dataset.mode });
                refreshControlValues();
                await applyNowImmediate();
            });
        });

        presetGroupsEl.addEventListener('click', (event) => {
            const btn = event.target.closest('.preset-btn');
            if (!btn) return;
            patchState({ mode: 'preset', presetId: btn.dataset.presetId });
            refreshControlValues();
            scheduleApplyNow();
        });

        colorPicker.addEventListener('input', function () {
            patchState({ mode: 'color', color: this.value });
            setModeUI('color');
            scheduleApplyNow();
        });

        function onGradientChange() {
            patchState({ mode: 'gradient', gradientA: gradientA.value, gradientB: gradientB.value });
            setModeUI('gradient');
            scheduleApplyNow();
        }

        gradientA.addEventListener('input', onGradientChange);
        gradientB.addEventListener('input', onGradientChange);

        bubbleOpacity.addEventListener('input', function () {
            patchState({ bubbleOpacity: Number(this.value) / 100 });
            scheduleApplyNow();
        });

        bubbleInBgInput?.addEventListener('input', function () {
            patchBubbleColors({ inBg: this.value }, 'custom');
            scheduleApplyNow();
        });

        bubbleInTextInput?.addEventListener('input', function () {
            patchBubbleColors({ inText: this.value }, 'custom');
            scheduleApplyNow();
        });

        bubbleOutBgInput?.addEventListener('input', function () {
            patchBubbleColors({ outBg: this.value }, 'custom');
            scheduleApplyNow();
        });

        bubbleOutTextInput?.addEventListener('input', function () {
            patchBubbleColors({ outText: this.value }, 'custom');
            scheduleApplyNow();
        });

        bubbleUseThemeBtn?.addEventListener('click', () => {
            const defaults = getThemeBubbleDefaults();
            patchBubbleColors(defaults, 'auto');
            refreshControlValues();
            scheduleApplyNow();
        });

        messageScaleRange?.addEventListener('input', function () {
            applyMessageScale(this.value, { persist: true });
        });

        messageScalePresetButtons.forEach((button) => {
            button.addEventListener('click', () => {
                applyMessageScale(button.dataset.scale, { persist: true });
            });
        });

        customDarken.addEventListener('input', function () { patchCustom({ darken: Number(this.value) }); scheduleApplyNow(); });
        customBlur.addEventListener('input', function () { patchCustom({ blur: Number(this.value) }); scheduleApplyNow(); });
        customOpacity.addEventListener('input', function () { patchCustom({ opacity: Number(this.value) / 100 }); scheduleApplyNow(); });
        customScale.addEventListener('input', function () { patchCustom({ scale: Number(this.value) }); scheduleApplyNow(); });
        customPosition.addEventListener('change', function () { patchCustom({ position: this.value }); scheduleApplyNow(); });
        customRepeat.addEventListener('change', function () { patchCustom({ repeat: !!this.checked }); scheduleApplyNow(); });

        customImageInput.addEventListener('change', async function () {
            const file = this.files && this.files[0];
            if (!file) return;
            try {
                const imageDataUrl = await prepareWallpaperDataUrl(file);
                chatAppearanceApi.applyAcrossThemes((theme, state) => ({
                    mode: 'custom',
                    custom: Object.assign({}, state.custom || {}, {
                        imageDataUrl,
                        position: (state.custom && state.custom.position) || 'center center',
                        scale: (state.custom && state.custom.scale) || 100,
                        darken: (state.custom && state.custom.darken) || (theme === 'dark' ? 18 : 8),
                        blur: (state.custom && state.custom.blur) || 0,
                        opacity: (state.custom && state.custom.opacity) || 1,
                        repeat: !!(state.custom && state.custom.repeat),
                    }),
                }));
                scheduleClientPreferencesPersist();
                refreshControlValues();
                await applyNowImmediate();
                showAlert('Кастомный фон применён', 'success');
            } catch (_) {
                showAlert('Не удалось обработать это изображение обоев. Попробуйте другой файл.', 'warning');
            }
        });

        clearBackgroundBtn.addEventListener('click', () => {
            patchState({ mode: 'default' });
            refreshControlValues();
            scheduleApplyNow();
        });

        resetAppearanceBtn.addEventListener('click', () => {
            chatAppearanceApi.resetAll();
            scheduleClientPreferencesPersist();
            refreshControlValues();
            scheduleApplyNow();
            showAlert('Оформление чата сброшено', 'success');
        });

        renderPresetGroups();
        refreshControlValues();
        scheduleApplyNow();
        const syncScaleForViewport = () => {
            renderMessageScaleControls(getStoredMessageScale());
        };
        const scaleMediaQuery = typeof window.matchMedia === 'function'
            ? window.matchMedia(MESSAGE_SCALE_MOBILE_QUERY)
            : null;
        if (scaleMediaQuery) {
            if (typeof scaleMediaQuery.addEventListener === 'function') {
                scaleMediaQuery.addEventListener('change', syncScaleForViewport);
            } else if (typeof scaleMediaQuery.addListener === 'function') {
                scaleMediaQuery.addListener(syncScaleForViewport);
            }
        } else {
            window.addEventListener('resize', syncScaleForViewport);
        }
        window.addEventListener('storage', (event) => {
            const scope = getMessageScaleScope();
            const key = String(event.key || '');
            if (key !== getScopedMessageScaleStorageKey(scope)
                && !(scope === 'desktop' && key === MESSAGE_SCALE_STORAGE_KEY)) {
                return;
            }
            renderMessageScaleControls(event.newValue || 1);
        });
    })();

    const flushOnPageHide = () => {
        if (persistTimerId) {
            window.clearTimeout(persistTimerId);
            persistTimerId = 0;
        }
        const payload = pendingClientPreferences || collectClientPreferences();
        pendingClientPreferences = payload;
        syncClientPreferencesLocal(payload);
        if (typeof persistClientPreferences === 'function') {
            void persistClientPreferences(payload, { keepalive: true }).catch(() => {});
        }
    };

    window.addEventListener('pagehide', flushOnPageHide);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            flushOnPageHide();
        }
    });
}

