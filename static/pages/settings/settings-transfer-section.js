const MESSAGE_SCALE_STORAGE_KEY = 'sun_chat_message_scale_v1';
const SEND_SHORTCUT_STORAGE_KEY = 'sun_send_shortcut_mode_v1';
const TIME_FORMAT_STORAGE_KEY = 'sun_time_format_v1';

function downloadTextFile(filename, text) {
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

function normalizeLanguage(value) {
    return String(value || '').toLowerCase() === 'en' ? 'en' : 'ru';
}

function normalizeMessageScale(value) {
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

function readLocalPreference(key, fallback = '') {
    try {
        return localStorage.getItem(key) || fallback;
    } catch (_) {
        return fallback;
    }
}

export function initSettingsTransferSection({
    tr,
    showAlert,
    api,
    privacySection,
    notifyLanguageUpdate,
}) {
    const exportBtn = document.getElementById('settingsExportBtn');
    const importInput = document.getElementById('settingsImportInput');

    if (!exportBtn || !importInput || !privacySection) {
        return {
            exportSettings: () => {},
            importSettings: async () => {},
        };
    }

    function collectLocalAppearance() {
        const interfaceThemeStore = window.InterfaceTheme?.readStore?.() || null;
        const chatAppearanceStore = window.ChatAppearance?.readStore?.() || null;
        const darkMode = localStorage.getItem('darkMode') === 'true';
        const messageScale = normalizeMessageScale(localStorage.getItem(MESSAGE_SCALE_STORAGE_KEY) || '1');
        return {
            interfaceThemeStore,
            chatAppearanceStore,
            darkMode,
            messageScale,
        };
    }

    function collectClientPreferences() {
        const localAppearance = collectLocalAppearance();
        let performanceMode = 'auto';
        let motionLevel = 'auto';
        let sendShortcut = 'enter';
        let timeFormat = '24h';
        try {
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
            darkMode: localAppearance.darkMode,
            messageScale: localAppearance.messageScale,
            performanceMode,
            motionLevel,
            sendShortcut,
            timeFormat,
            interfaceThemeStore: localAppearance.interfaceThemeStore || {},
            chatAppearanceStore: localAppearance.chatAppearanceStore || {},
        };
    }

    function resolveClientPreferences(payload) {
        const direct = payload?.clientPreferences;
        if (direct && typeof direct === 'object') {
            return {
                darkMode: typeof direct.darkMode === 'boolean' ? direct.darkMode : false,
                messageScale: normalizeMessageScale(direct.messageScale),
                performanceMode: String(direct.performanceMode || 'auto').toLowerCase() === 'full'
                    ? 'full'
                    : String(direct.performanceMode || 'auto').toLowerCase() === 'lite'
                        ? 'lite'
                        : 'auto',
                motionLevel: ['auto', 'full', 'balanced', 'lite'].includes(String(direct.motionLevel || '').toLowerCase())
                    ? String(direct.motionLevel).toLowerCase()
                    : 'auto',
                sendShortcut: normalizeSendShortcut(direct.sendShortcut || readLocalPreference(SEND_SHORTCUT_STORAGE_KEY, 'enter')),
                timeFormat: normalizeTimeFormat(direct.timeFormat || readLocalPreference(TIME_FORMAT_STORAGE_KEY, '24h')),
                interfaceThemeStore: direct.interfaceThemeStore && typeof direct.interfaceThemeStore === 'object'
                    ? direct.interfaceThemeStore
                    : null,
                chatAppearanceStore: direct.chatAppearanceStore && typeof direct.chatAppearanceStore === 'object'
                    ? direct.chatAppearanceStore
                    : null,
            };
        }

        const localAppearance = payload?.localAppearance || {};
        return {
            darkMode: !!localAppearance.darkMode,
            messageScale: normalizeMessageScale(localAppearance.messageScale),
            performanceMode: 'auto',
            motionLevel: 'auto',
            sendShortcut: normalizeSendShortcut(payload?.sendShortcut || readLocalPreference(SEND_SHORTCUT_STORAGE_KEY, 'enter')),
            timeFormat: normalizeTimeFormat(payload?.timeFormat || readLocalPreference(TIME_FORMAT_STORAGE_KEY, '24h')),
            interfaceThemeStore: localAppearance.interfaceThemeStore && typeof localAppearance.interfaceThemeStore === 'object'
                ? localAppearance.interfaceThemeStore
                : null,
            chatAppearanceStore: localAppearance.chatAppearanceStore && typeof localAppearance.chatAppearanceStore === 'object'
                ? localAppearance.chatAppearanceStore
                : null,
        };
    }

    function applyLocalAppearance(payload) {
        const clientPreferences = resolveClientPreferences(payload);
        if (clientPreferences.interfaceThemeStore && window.InterfaceTheme?.writeStore) {
            window.InterfaceTheme.writeStore(clientPreferences.interfaceThemeStore);
        }
        if (clientPreferences.chatAppearanceStore && window.ChatAppearance?.writeStore) {
            window.ChatAppearance.writeStore(clientPreferences.chatAppearanceStore);
        }
        if (typeof clientPreferences.darkMode === 'boolean') {
            localStorage.setItem('darkMode', clientPreferences.darkMode ? 'true' : 'false');
            document.documentElement.classList.toggle('dark-mode', clientPreferences.darkMode);
            document.body.classList.toggle('dark-mode', clientPreferences.darkMode);
        }
        localStorage.setItem(MESSAGE_SCALE_STORAGE_KEY, normalizeMessageScale(clientPreferences.messageScale).toFixed(2));
        localStorage.setItem('sun_performance_mode', clientPreferences.performanceMode || 'auto');
        localStorage.setItem('sun_motion_level', clientPreferences.motionLevel || 'auto');
        localStorage.setItem(SEND_SHORTCUT_STORAGE_KEY, normalizeSendShortcut(clientPreferences.sendShortcut));
        localStorage.setItem(TIME_FORMAT_STORAGE_KEY, normalizeTimeFormat(clientPreferences.timeFormat));
        window.InterfaceTheme?.applyCurrentTheme?.();
        window.ChatAppearance?.applyCurrentTheme?.();
    }

    async function exportSettings() {
        try {
            const payload = {
                exportedAt: new Date().toISOString(),
                version: 1,
                serverSettings: privacySection.getCommonPayload(),
                localAppearance: collectLocalAppearance(),
                clientPreferences: collectClientPreferences(),
            };
            const datePart = new Date().toISOString().slice(0, 10);
            downloadTextFile(`sun-settings-${datePart}.json`, JSON.stringify(payload, null, 2));
            showAlert('Настройки экспортированы.', 'success');
        } catch (err) {
            showAlert(String(err?.message || 'Не удалось экспортировать настройки.'), 'danger');
        }
    }

    async function importSettings(file) {
        if (!file) return;

        try {
            const text = await file.text();
            const parsed = JSON.parse(text);

            const server = parsed?.serverSettings;
            if (!server || typeof server !== 'object') {
                throw new Error('Некорректный файл настроек: отсутствует serverSettings.');
            }

            const serverPayload = {
                username: String(server.username || '').trim(),
                display_name: String(server.display_name || '').trim(),
                language: normalizeLanguage(server.language),
                bio: String(server.bio || '').slice(0, 280),
                is_public: !!server.is_public,
                auto_decline_requests: !!server.auto_decline_requests,
                mute_dialog_requests: !!server.mute_dialog_requests,
                hide_online_status: !!server.hide_online_status,
                avatar_visibility: ['all', 'contacts', 'nobody'].includes(String(server.avatar_visibility || '').toLowerCase())
                    ? String(server.avatar_visibility).toLowerCase()
                    : 'all',
                group_invite_privacy: ['all', 'contacts', 'nobody'].includes(String(server.group_invite_privacy || '').toLowerCase())
                    ? String(server.group_invite_privacy).toLowerCase()
                    : 'all',
            };

            await api.saveSettings({
                ...serverPayload,
                client_preferences: resolveClientPreferences(parsed),
            });
            privacySection.applySettingsFromPayload(serverPayload);
            notifyLanguageUpdate(serverPayload.language, true);

            applyLocalAppearance(parsed);

            showAlert('Настройки импортированы. Перезагружаем интерфейс...', 'success');
            window.setTimeout(() => {
                window.location.reload();
            }, 320);
        } catch (err) {
            showAlert(String(err?.message || 'Не удалось импортировать настройки.'), 'danger');
        } finally {
            importInput.value = '';
        }
    }

    exportBtn.addEventListener('click', exportSettings);
    importInput.addEventListener('change', () => {
        importSettings(importInput.files?.[0] || null);
    });

    return {
        exportSettings,
        importSettings,
    };
}
