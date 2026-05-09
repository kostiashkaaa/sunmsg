import { applyFallbackAvatarTint, buildAvatarInitials } from '../../modules/utils.js';
export function initAuthUi({ withAppRoot, getCsrfToken }) {
    const interfaceThemeApi = window.InterfaceTheme || null;
    const i18nApi = window.SUN_I18N || null;
    const tr = (value) => {
        if (!i18nApi || typeof i18nApi.translateText !== 'function') {
            return String(value ?? '');
        }
        return i18nApi.translateText(value);
    };
    const activeLanguage = () => {
        if (i18nApi && typeof i18nApi.getLanguage === 'function') {
            return i18nApi.getLanguage();
        }
        return document.documentElement.lang === 'en' ? 'en' : 'ru';
    };

    const parseDurationMs = (raw) => {
        const value = String(raw || '').trim().toLowerCase();
        if (!value) return 0;
        if (value.endsWith('ms')) {
            const ms = Number.parseFloat(value.slice(0, -2));
            return Number.isFinite(ms) ? Math.max(0, ms) : 0;
        }
        if (value.endsWith('s')) {
            const seconds = Number.parseFloat(value.slice(0, -1));
            return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;
        }
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
    };
    const maxMotionMs = (element, fallbackMs = 0) => {
        if (!element) return fallbackMs;
        const style = window.getComputedStyle(element);
        const transitionDurations = String(style.transitionDuration || '').split(',').map(parseDurationMs);
        const transitionDelays = String(style.transitionDelay || '').split(',').map(parseDurationMs);
        const animationDurations = String(style.animationDuration || '').split(',').map(parseDurationMs);
        const animationDelays = String(style.animationDelay || '').split(',').map(parseDurationMs);
        const transitionMax = Math.max(0, ...transitionDurations) + Math.max(0, ...transitionDelays);
        const animationMax = Math.max(0, ...animationDurations) + Math.max(0, ...animationDelays);
        return Math.max(transitionMax, animationMax, fallbackMs);
    };
    const waitForMotionEnd = (element, fallbackMs = 0) => {
        if (!element) return Promise.resolve();
        const timeoutMs = maxMotionMs(element, fallbackMs);
        if (timeoutMs <= 0) return Promise.resolve();
        return new Promise((resolve) => {
            let settled = false;
            let timeoutId = 0;
            const finish = () => {
                if (settled) return;
                settled = true;
                if (timeoutId) window.clearTimeout(timeoutId);
                element.removeEventListener('transitionend', onEnd);
                element.removeEventListener('animationend', onEnd);
                resolve();
            };
            const onEnd = (event) => {
                if (event?.target !== element) return;
                finish();
            };
            element.addEventListener('transitionend', onEnd);
            element.addEventListener('animationend', onEnd);
            timeoutId = window.setTimeout(finish, timeoutMs + 60);
        });
    };

    const authLanguageSwitchEl = document.getElementById('authLanguageSwitch');
    const authLanguageButtons = Array.from(document.querySelectorAll('#authLanguageSwitch [data-lang]'));
    const onboardingEntryEl = document.getElementById('authOnboardingEntry');
    const onboardingEntryKickerEl = document.getElementById('authOnboardingEntryKicker');
    const onboardingEntryTitleEl = document.getElementById('authOnboardingEntryTitle');
    const onboardingEntryActionEl = document.getElementById('authOnboardingEntryAction');
    const normalizeLanguageCode = (raw) => (String(raw || '').toLowerCase() === 'en' ? 'en' : 'ru');

    function syncAuthLanguageButtons(language = activeLanguage()) {
        const current = normalizeLanguageCode(language);
        authLanguageButtons.forEach((button) => {
            const buttonLang = normalizeLanguageCode(button.getAttribute('data-lang'));
            const isActive = buttonLang === current;
            button.classList.toggle('is-active', isActive);
            button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
    }

    function syncOnboardingEntry(language = activeLanguage()) {
        if (!onboardingEntryEl) return;
        const current = normalizeLanguageCode(language);
        onboardingEntryEl.setAttribute('href', `${withAppRoot('/onboarding-guide')}?lang=${current}`);
        if (onboardingEntryKickerEl) {
            onboardingEntryKickerEl.textContent = current === 'en'
                ? 'Need help getting started?'
                : 'Впервые в SUN Messenger?';
        }
        if (onboardingEntryTitleEl) {
            onboardingEntryTitleEl.textContent = current === 'en'
                ? 'Open a short registration and sign-in guide'
                : 'Откройте короткую инструкцию по регистрации и входу';
        }
        if (onboardingEntryActionEl) {
            onboardingEntryActionEl.textContent = current === 'en'
                ? 'Open guide'
                : 'Открыть инструкцию';
        }
    }

    async function persistGuestLanguage(language) {
        try {
            await fetch(withAppRoot('/api/set_guest_language'), {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({ language: normalizeLanguageCode(language) }),
            });
        } catch (_) {
            // Best-effort persistence on auth page.
        }
    }

    async function setAuthLanguage(language) {
        const nextLanguage = normalizeLanguageCode(language);
        if (i18nApi && typeof i18nApi.setLanguage === 'function') {
            i18nApi.setLanguage(nextLanguage, { persist: true, apply: true });
        } else {
            document.documentElement.lang = nextLanguage;
            document.body.dataset.uiLanguage = nextLanguage;
        }
        syncAuthLanguageButtons(nextLanguage);
        syncOnboardingEntry(nextLanguage);
        await persistGuestLanguage(nextLanguage);
    }

    if (authLanguageSwitchEl) {
        authLanguageSwitchEl.addEventListener('click', (event) => {
            const button = event.target.closest('[data-lang]');
            if (!button) return;
            const nextLanguage = button.getAttribute('data-lang');
            setAuthLanguage(nextLanguage);
        });
    }
    window.addEventListener('sun-ui-language-changed', () => {
        const current = activeLanguage();
        syncAuthLanguageButtons(current);
        syncOnboardingEntry(current);
    });
    syncAuthLanguageButtons(activeLanguage());
    syncOnboardingEntry(activeLanguage());

    (function applySavedTheme() {
        const saved = localStorage.getItem('darkMode');
        if (saved === 'true') {
            document.documentElement.classList.add('dark-mode');
            document.body.classList.add('dark-mode');
            const icon = document.getElementById('themeIcon');
            if (icon) icon.className = 'bi bi-sun';
        } else {
            document.documentElement.classList.remove('dark-mode');
        }
        if (interfaceThemeApi) {
            interfaceThemeApi.applyCurrentTheme();
        }
    })();

    function toggleTheme() {
        let isDark = false;
        let shouldApplyInterfaceTheme = true;

        if (interfaceThemeApi && typeof interfaceThemeApi.toggleThemeMode === 'function') {
            const applied = interfaceThemeApi.toggleThemeMode({ apply: true });
            isDark = String(applied?.themeKey || (localStorage.getItem('darkMode') === 'true' ? 'dark' : 'light')) === 'dark';
            document.body.classList.toggle('dark-mode', isDark);
            document.documentElement.classList.toggle('dark-mode', isDark);
            localStorage.setItem('darkMode', String(isDark));
            shouldApplyInterfaceTheme = false;
        } else {
            isDark = document.body.classList.toggle('dark-mode');
            document.documentElement.classList.toggle('dark-mode', isDark);
            localStorage.setItem('darkMode', String(isDark));
        }

        const icon = document.getElementById('themeIcon');
        if (icon) {
            icon.className = isDark ? 'bi bi-sun' : 'bi bi-moon-stars';
        }
        if (interfaceThemeApi && shouldApplyInterfaceTheme) {
            interfaceThemeApi.applyCurrentTheme();
        }
    }
    document.getElementById('themeToggleBtn')?.addEventListener('click', toggleTheme);
    window.toggleTheme = toggleTheme;

    const mnemonicGrid = document.getElementById('mnemonicInputGrid');
    if (mnemonicGrid) {
        for (let i = 1; i <= 24; i += 1) {
            const wrap = document.createElement('div');
            wrap.className = 'mnemonic-word-wrap';
            wrap.innerHTML = `
                <span class="mnemonic-num">${i}</span>
                <input type="text" class="mnemonic-word-input" data-index="${i}" autocomplete="off">
            `;
            mnemonicGrid.appendChild(wrap);
        }

        mnemonicGrid.addEventListener('paste', (event) => {
            event.preventDefault();
            const text = (event.clipboardData || window.clipboardData).getData('text');
            const words = text.trim().split(/\s+/);
            const inputs = Array.from(mnemonicGrid.querySelectorAll('input'));
            const targetInput = event.target instanceof HTMLInputElement ? event.target : null;
            const targetIndex = targetInput ? inputs.indexOf(targetInput) : 0;
            const startIndex = targetIndex >= 0 ? targetIndex : 0;
            words.forEach((word, idx) => {
                const input = inputs[startIndex + idx];
                if (input) input.value = word.toLowerCase();
            });
        });
    }

    function getMnemonicFromGrid() {
        const inputs = document.querySelectorAll('.mnemonic-word-input');
        const words = [];
        inputs.forEach((input) => {
            const val = input.value.trim();
            if (val) words.push(val);
        });
        return words.join(' ');
    }

    function setMnemonicToGrid(mnemonic) {
        const words = String(mnemonic || '').trim().split(/\s+/);
        const inputs = document.querySelectorAll('.mnemonic-word-input');
        inputs.forEach((input, idx) => {
            if (words[idx]) input.value = words[idx];
        });
    }

    function switchTab(tab) {
        document.querySelectorAll('.auth-tab-btn').forEach((button) => {
            button.classList.remove('active');
            button.setAttribute('aria-selected', 'false');
        });
        const nextPanel = document.getElementById(`panel-${tab}`);
        document.querySelectorAll('.tab-panel').forEach((panel) => {
            if (panel === nextPanel) return;
            if (panel.classList.contains('active')) {
                panel.classList.remove('active');
                panel.classList.add('tab-panel-leaving');
                waitForMotionEnd(panel, 220).then(() => {
                    panel.classList.remove('tab-panel-leaving');
                });
            } else {
                panel.classList.remove('tab-panel-leaving');
            }
        });
        const tabButton = document.getElementById(`tab-${tab}-btn`);
        tabButton?.classList.add('active');
        tabButton?.setAttribute('aria-selected', 'true');
        nextPanel?.classList.remove('tab-panel-leaving');
        nextPanel?.classList.add('active');

        const headline = document.getElementById('authHeadline');
        if (!headline) return;
        if (tab === 'register') {
            headline.innerHTML = 'Создайте тихое место.'
                + '<br><em class="auth-brand-headline-em">Для тех, кому доверяете.</em>';
            return;
        }
        headline.innerHTML = 'Добро пожаловать'
            + '<br><em class="auth-brand-headline-em">в тихую сеть.</em>';
    }

    document.getElementById('tab-login-btn')?.addEventListener('click', () => switchTab('login'));
    document.getElementById('tab-register-btn')?.addEventListener('click', () => switchTab('register'));
    window.switchTab = switchTab;

    const totpInput = document.getElementById('login_totp_code');
    totpInput?.addEventListener('input', function onTotpInput() {
        this.value = this.value.replace(/\D/g, '').slice(0, 6);
    });

    function showToast(message, type = 'info') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const safeMessage = tr(message);
        const icons = {
            error: 'bi-x-circle-fill',
            info: 'bi-info-circle-fill',
        };
        const successIcon = '<span class="sun-check-glyph sun-check-glyph--single sun-check-glyph--ui auth-toast-icon" aria-hidden="true"><svg viewBox="0 0 10 10" focusable="false"><path d="M1.2 5.2L4 8L8.8 2.2"></path></svg></span>';
        const iconHtml = type === 'success'
            ? successIcon
            : `<i class="bi ${icons[type] || icons.info} auth-toast-icon"></i>`;
        const toast = document.createElement('div');
        toast.className = `auth-toast auth-toast-${type}`;
        toast.innerHTML = `
            ${iconHtml}
            <div>
                <div class="auth-toast-brand">SUN Messenger</div>
                <div class="auth-toast-text">${safeMessage}</div>
            </div>
        `;
        container.appendChild(toast);
        toast.addEventListener('click', () => removeToast(toast));
        setTimeout(() => removeToast(toast), 4500);
    }

    function removeToast(toast) {
        toast.classList.add('auth-toast-out');
        waitForMotionEnd(toast, 280).then(() => {
            toast.remove();
        });
    }

    function setSubmitButtonState(button, isLoading) {
        if (!button) return;
        const arrow = button.querySelector('.auth-btn-arrow');
        button.disabled = isLoading;
        button.classList.toggle('is-loading', isLoading);
        if (arrow) {
            arrow.textContent = isLoading ? '' : '→';
            arrow.classList.toggle('auth-spinner', isLoading);
        }
    }

    function buildAvatarUrl(rawUrl) {
        const text = String(rawUrl || '').trim();
        if (!text) return '';
        if (/^[a-z][a-z0-9+\-.]*:/i.test(text) || text.startsWith('//') || text.startsWith('/')) {
            return text;
        }
        return withAppRoot(`/static/avatars/${text}`);
    }

    function avatarInitial(displayName, username) {
        const source = String(displayName || username || '').trim();
        return buildAvatarInitials(source || '?');
    }

    function showAuthSuccessOverlay({ displayName, username, avatarUrl }) {
        const overlay = document.getElementById('authSuccessOverlay');
        if (!overlay) return false;
        const avatarImg = document.getElementById('authSuccessAvatar');
        const fallbackEl = document.getElementById('authSuccessAvatarFallback');
        const nameEl = document.getElementById('authSuccessDisplayName');
        const userEl = document.getElementById('authSuccessUsername');
        const safeUser = String(username || '').trim();
        const safeName = String(displayName || '').trim() || (safeUser ? `@${safeUser}` : tr('Готово'));
        if (nameEl) nameEl.textContent = safeName;
        if (userEl) {
            userEl.textContent = safeUser ? `@${safeUser}` : '';
            userEl.style.display = safeUser ? '' : 'none';
        }

        const resolvedAvatar = buildAvatarUrl(avatarUrl);
        if (avatarImg && fallbackEl) {
            if (resolvedAvatar) {
                avatarImg.onload = () => {
                    avatarImg.style.display = '';
                    fallbackEl.style.display = 'none';
                };
                avatarImg.onerror = () => {
                    avatarImg.style.display = 'none';
                    fallbackEl.style.display = '';
                    fallbackEl.textContent = avatarInitial(displayName, username);
                    applyFallbackAvatarTint(fallbackEl, safeName || safeUser || '?');
                };
                avatarImg.src = resolvedAvatar;
            } else {
                avatarImg.style.display = 'none';
                avatarImg.removeAttribute('src');
                fallbackEl.style.display = '';
                fallbackEl.textContent = avatarInitial(displayName, username);
                applyFallbackAvatarTint(fallbackEl, safeName || safeUser || '?');
            }
        }

        overlay.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => overlay.classList.add('is-visible'));
        try {
            if (typeof navigator.vibrate === 'function') {
                navigator.vibrate(40);
            }
        } catch (_) {
            // best-effort
        }
        return true;
    }

    const copyPrivateKeyBtn = document.getElementById('copyPrivateKeyBtn');
    copyPrivateKeyBtn?.addEventListener('click', async () => {
        const contentField = document.getElementById('privateKeyContent');
        const value = contentField?.value || '';
        if (!value) return;

        let copied = false;
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(value);
                copied = true;
            } catch (_) {}
        }

        if (!copied && contentField) {
            contentField.focus();
            contentField.select();
            copied = document.execCommand('copy');
            contentField.setSelectionRange(0, 0);
            contentField.blur();
        }

        if (copied) {
            showToast('24 слова скопированы!', 'success');
        } else {
            showToast('Не удалось скопировать. Скопируйте вручную.', 'error');
        }
    });

    return {
        tr,
        activeLanguage,
        getMnemonicFromGrid,
        setMnemonicToGrid,
        switchTab,
        showToast,
        setSubmitButtonState,
        showAuthSuccessOverlay,
    };
}

