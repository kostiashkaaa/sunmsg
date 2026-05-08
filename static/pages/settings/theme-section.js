import { prepareWallpaperDataUrl } from './wallpaper-image.js';

export function initThemeSection({
    tr,
    notifyParent,
    showAlert,
    chatAppearanceApi,
    interfaceThemeApi,
}) {
    const darkModeSwitchEl = document.getElementById('darkModeSwitch');
    const themeLightEl = document.getElementById('themeLight');
    const themeDarkEl = document.getElementById('themeDark');

    const isDark = () => localStorage.getItem('darkMode') === 'true';
    const activeThemeKey = () => (isDark() ? 'dark' : 'light');
    let refreshChatAppearanceUi = null;
    let refreshInterfaceThemeUi = null;

    function applyTheme(dark) {
        document.documentElement.classList.toggle('dark-mode', dark);
        document.body.classList.toggle('dark-mode', dark);
        if (darkModeSwitchEl) darkModeSwitchEl.checked = dark;
        if (themeLightEl) themeLightEl.classList.toggle('selected', !dark);
        if (themeDarkEl) themeDarkEl.classList.toggle('selected', dark);

        if (interfaceThemeApi) {
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
    }

    darkModeSwitchEl?.addEventListener('change', function () {
        setTheme(this.checked);
    });
    themeLightEl?.addEventListener('click', () => {
        setTheme(false);
    });
    themeDarkEl?.addEventListener('click', () => {
        setTheme(true);
    });
    document.querySelectorAll('.theme-preview[data-theme-choice]').forEach((preview) => {
        preview.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            setTheme(preview.dataset.themeChoice === 'dark');
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
        });

        resetThemeBtn.addEventListener('click', () => {
            interfaceThemeApi.resetTheme(activeThemeKey());
            refreshControls();
            applyInterfaceThemeNow();
            showAlert('Цвет интерфейса для текущей темы сброшен', 'success');
        });

        resetAllBtn.addEventListener('click', () => {
            interfaceThemeApi.resetAll();
            refreshControls();
            applyInterfaceThemeNow();
            showAlert('Пользовательские цвета интерфейса сброшены', 'success');
        });

        refreshControls();
        applyInterfaceThemeNow();
    })();

    (function initChatAppearanceSettings() {
        if (!chatAppearanceApi) return;

        const MESSAGE_SCALE_STORAGE_KEY = 'sun_chat_message_scale_v1';
        const previewEl = document.getElementById('chatAppearancePreview');
        const modeRow = document.getElementById('chatStyleModeRow');
        const presetGroupsEl = document.getElementById('chatPresetGroups');
        const colorPicker = document.getElementById('chatColorPicker');
        const gradientA = document.getElementById('chatGradientColorA');
        const gradientB = document.getElementById('chatGradientColorB');
        const bubbleOpacity = document.getElementById('chatBubbleOpacity');
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

        function clampMessageScale(value) {
            const parsed = Number.parseFloat(value);
            if (!Number.isFinite(parsed)) return 1;
            return Math.min(1.3, Math.max(0.9, parsed));
        }

        function getStoredMessageScale() {
            try {
                return clampMessageScale(localStorage.getItem(MESSAGE_SCALE_STORAGE_KEY) || 1);
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
                    localStorage.setItem(MESSAGE_SCALE_STORAGE_KEY, normalizedScale.toFixed(2));
                } catch (_) {}
            }
            renderMessageScaleControls(normalizedScale);
            notifyParent('sun-settings-message-scale-updated', { scale: normalizedScale });
        }

        function updateCustomMeta(state) {
            customImageMeta.textContent = state.custom && state.custom.imageDataUrl
                ? tr('Кастомный фон загружен')
                : tr('Файл не выбран');
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
            refreshControlValues();
            scheduleApplyNow();
            showAlert('Оформление чата сброшено', 'success');
        });

        renderPresetGroups();
        refreshControlValues();
        scheduleApplyNow();
        window.addEventListener('storage', (event) => {
            if (String(event.key || '') !== MESSAGE_SCALE_STORAGE_KEY) return;
            renderMessageScaleControls(event.newValue || 1);
        });
    })();
}

