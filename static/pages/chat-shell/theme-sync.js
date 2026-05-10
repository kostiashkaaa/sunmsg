export function initChatShellThemeSync(options = {}) {
    const interfaceThemeApi = options.interfaceThemeApi || window.InterfaceTheme || null;
    const chatAppearanceApi = options.chatAppearanceApi || window.ChatAppearance || null;
    const i18nApi = options.i18nApi || window.SUN_I18N || null;
    const persistClientPreferences = typeof options.persistClientPreferences === 'function'
        ? options.persistClientPreferences
        : null;
    const MESSAGE_SCALE_STORAGE_KEY = 'sun_chat_message_scale_v1';
    const SEND_SHORTCUT_STORAGE_KEY = 'sun_send_shortcut_mode_v1';
    const TIME_FORMAT_STORAGE_KEY = 'sun_time_format_v1';
    let persistTimerId = 0;
    let pendingClientPreferences = null;

    const tr = (value) => {
        if (i18nApi && typeof i18nApi.translateText === 'function') {
            return i18nApi.translateText(value);
        }
        return String(value ?? '');
    };

    const isDark = () => localStorage.getItem('darkMode') === 'true';

    const resolveCurrentLanguage = () => {
        if (i18nApi && typeof i18nApi.getLanguage === 'function') {
            return String(i18nApi.getLanguage() || 'ru').toLowerCase() === 'en' ? 'en' : 'ru';
        }
        return String(document.documentElement?.lang || 'ru').toLowerCase() === 'en' ? 'en' : 'ru';
    };

    const syncClientPreferencesLocal = (preferences) => {
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
    };

    function clampMessageScale(value) {
        const parsed = Number.parseFloat(value);
        if (!Number.isFinite(parsed)) return 1;
        return Math.min(1.3, Math.max(0.9, parsed));
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

    function scheduleClientPreferencesPersist(delayMs = 300) {
        const payload = collectClientPreferences();
        pendingClientPreferences = payload;
        syncClientPreferencesLocal(payload);
        if (!persistClientPreferences) return;
        if (persistTimerId) {
            window.clearTimeout(persistTimerId);
        }
        persistTimerId = window.setTimeout(async () => {
            persistTimerId = 0;
            try {
                const outgoing = pendingClientPreferences || collectClientPreferences();
                pendingClientPreferences = null;
                await persistClientPreferences(outgoing);
            } catch (_) {
                // Ignore background sync failure for non-critical UI toggle.
            }
        }, delayMs);
    }

    function flushClientPreferencesPersist(options = {}) {
        const payload = pendingClientPreferences || collectClientPreferences();
        pendingClientPreferences = payload;
        syncClientPreferencesLocal(payload);
        if (persistTimerId) {
            window.clearTimeout(persistTimerId);
            persistTimerId = 0;
        }
        if (!persistClientPreferences) return Promise.resolve();
        return persistClientPreferences(payload, options)
            .catch(() => {});
    }

    function applyDark(on) {
        document.documentElement.classList.toggle('dark-mode', on);
        document.body.classList.toggle('dark-mode', on);
        if (interfaceThemeApi) {
            interfaceThemeApi.applyCurrentTheme();
        }
        const sidebarThemeIcon = document.getElementById('sidebarThemeIcon');
        const sidebarThemeToggleBtn = document.getElementById('sidebarThemeToggleBtn');
        if (sidebarThemeIcon) sidebarThemeIcon.className = on ? 'bi bi-sun' : 'bi bi-moon-stars';
        if (sidebarThemeToggleBtn) {
            sidebarThemeToggleBtn.title = on ? tr('Светлая тема') : tr('Тёмная тема');
            sidebarThemeToggleBtn.setAttribute('aria-label', on ? tr('Переключить на светлую тему') : tr('Переключить на тёмную тему'));
        }
    }

    async function applyEmbeddedThemeUpdates() {
        applyDark(isDark());
        if (chatAppearanceApi) {
            await chatAppearanceApi.applyCurrentTheme();
        }
    }

    function applyEmbeddedLanguageUpdates(language, options = {}) {
        if (!i18nApi || typeof i18nApi.setLanguage !== 'function') {
            return;
        }
        const nextLanguage = String(language || '').toLowerCase() === 'en' ? 'en' : 'ru';
        const shouldPersist = options.persist !== false;
        i18nApi.setLanguage(nextLanguage, { persist: shouldPersist, apply: true });
        scheduleClientPreferencesPersist(120);
    }

    applyDark(isDark());
    if (window.ChatAppearance) {
        window.ChatAppearance.applyCurrentTheme();
    }

    const sidebarThemeToggleBtn = document.getElementById('sidebarThemeToggleBtn');
    if (sidebarThemeToggleBtn) {
        sidebarThemeToggleBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            if (interfaceThemeApi && typeof interfaceThemeApi.toggleThemeMode === 'function') {
                const applied = interfaceThemeApi.toggleThemeMode({ apply: true });
                const dark = String(applied?.themeKey || (isDark() ? 'dark' : 'light')) === 'dark';
                applyDark(dark);
            } else {
                const next = !isDark();
                localStorage.setItem('darkMode', next);
                applyDark(next);
            }
            if (window.ChatAppearance) {
                window.ChatAppearance.applyCurrentTheme();
            }
            scheduleClientPreferencesPersist();
        });
    }

    return {
        tr,
        isDark,
        applyDark,
        applyEmbeddedThemeUpdates,
        applyEmbeddedLanguageUpdates,
        flushClientPreferencesPersist,
    };
}
