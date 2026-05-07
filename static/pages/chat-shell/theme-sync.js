export function initChatShellThemeSync(options = {}) {
    const interfaceThemeApi = options.interfaceThemeApi || window.InterfaceTheme || null;
    const chatAppearanceApi = options.chatAppearanceApi || window.ChatAppearance || null;
    const i18nApi = options.i18nApi || window.SUN_I18N || null;

    const tr = (value) => {
        if (i18nApi && typeof i18nApi.translateText === 'function') {
            return i18nApi.translateText(value);
        }
        return String(value ?? '');
    };

    const isDark = () => localStorage.getItem('darkMode') === 'true';

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
    }

    applyDark(isDark());
    if (window.ChatAppearance) {
        window.ChatAppearance.applyCurrentTheme();
    }

    const sidebarThemeToggleBtn = document.getElementById('sidebarThemeToggleBtn');
    if (sidebarThemeToggleBtn) {
        sidebarThemeToggleBtn.addEventListener('click', (event) => {
            event.stopPropagation();
            const next = !isDark();
            localStorage.setItem('darkMode', next);
            applyDark(next);
            if (window.ChatAppearance) {
                window.ChatAppearance.applyCurrentTheme();
            }
        });
    }

    return {
        tr,
        isDark,
        applyDark,
        applyEmbeddedThemeUpdates,
        applyEmbeddedLanguageUpdates,
    };
}
