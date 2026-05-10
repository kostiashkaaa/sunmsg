const MESSAGE_SCALE_STORAGE_KEY = 'sun_chat_message_scale_v1';
const SEND_SHORTCUT_STORAGE_KEY = 'sun_send_shortcut_mode_v1';
const TIME_FORMAT_STORAGE_KEY = 'sun_time_format_v1';
const SIDEBAR_WEATHER_METRIC_KEYS = Object.freeze([
    'temperature',
    'feels_like',
    'humidity',
    'wind',
    'precip',
    'uv',
    'aqi',
    'pressure',
    'sun_cycle',
]);
const SIDEBAR_WEATHER_DEFAULT_METRICS = Object.freeze(['temperature']);

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

function normalizeSidebarWeatherSource(value) {
    return String(value || '').trim().toLowerCase() === 'city' ? 'city' : 'auto';
}

function normalizeSidebarWeatherRotateSeconds(value) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return parsed === 30 ? 30 : 60;
}

function normalizeSidebarWeatherCity(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 80);
}

function normalizeSidebarWeatherMetrics(value, { fallbackToDefault = true } = {}) {
    if (!Array.isArray(value)) {
        return fallbackToDefault ? [...SIDEBAR_WEATHER_DEFAULT_METRICS] : [];
    }
    const result = [];
    const seen = new Set();
    value.forEach((entry) => {
        const metric = String(entry || '').trim().toLowerCase();
        if (!SIDEBAR_WEATHER_METRIC_KEYS.includes(metric) || seen.has(metric)) return;
        seen.add(metric);
        result.push(metric);
    });
    return result;
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
        const unifiedPrefs = window.SUN_CLIENT_PREFERENCES?.read?.() || null;
        const interfaceThemeStore = window.InterfaceTheme?.readStore?.() || null;
        const chatAppearanceStore = window.ChatAppearance?.readStore?.() || null;
        const darkMode = localStorage.getItem('darkMode') === 'true';
        const messageScale = normalizeMessageScale(localStorage.getItem(MESSAGE_SCALE_STORAGE_KEY) || '1');
        return {
            interfaceThemeStore,
            chatAppearanceStore,
            darkMode,
            messageScale,
            language: normalizeLanguage(unifiedPrefs?.language || document.documentElement?.lang || 'ru'),
            updatedAt: String(unifiedPrefs?.updatedAt || '').trim() || null,
        };
    }

    function collectClientPreferences() {
        const localAppearance = collectLocalAppearance();
        let performanceMode = 'auto';
        let motionLevel = 'auto';
        let sendShortcut = 'enter';
        let timeFormat = '24h';
        let sidebarWeatherEnabled = false;
        let sidebarWeatherSource = 'auto';
        let sidebarWeatherCity = '';
        let sidebarWeatherRotateSeconds = 60;
        let sidebarWeatherMetrics = [...SIDEBAR_WEATHER_DEFAULT_METRICS];
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
        const sidebarWeatherEnabledEl = document.getElementById('sidebarWeatherEnabledSwitch');
        const sidebarWeatherSourceEl = document.getElementById('sidebarWeatherSourceSelect');
        const sidebarWeatherCityEl = document.getElementById('sidebarWeatherCityInput');
        const sidebarWeatherRotateEl = document.getElementById('sidebarWeatherRotateSelect');
        const sidebarWeatherMetricEls = SIDEBAR_WEATHER_METRIC_KEYS
            .map((metricKey) => document.querySelector(`input[name="sidebarWeatherMetricOption"][value="${metricKey}"]`))
            .filter((el) => el instanceof HTMLInputElement);
        sidebarWeatherEnabled = !!sidebarWeatherEnabledEl?.checked;
        sidebarWeatherSource = normalizeSidebarWeatherSource(sidebarWeatherSourceEl?.value);
        sidebarWeatherCity = normalizeSidebarWeatherCity(sidebarWeatherCityEl?.value);
        sidebarWeatherRotateSeconds = normalizeSidebarWeatherRotateSeconds(sidebarWeatherRotateEl?.value);
        sidebarWeatherMetrics = normalizeSidebarWeatherMetrics(
            sidebarWeatherMetricEls.filter((el) => el.checked).map((el) => el.value),
            { fallbackToDefault: false },
        );

        return {
            darkMode: localAppearance.darkMode,
            language: normalizeLanguage(localAppearance.language || document.documentElement?.lang || 'ru'),
            messageScale: localAppearance.messageScale,
            performanceMode,
            motionLevel,
            sendShortcut,
            timeFormat,
            sidebarWeatherEnabled,
            sidebarWeatherSource,
            sidebarWeatherCity,
            sidebarWeatherRotateSeconds,
            sidebarWeatherMetrics,
            interfaceThemeStore: localAppearance.interfaceThemeStore || {},
            chatAppearanceStore: localAppearance.chatAppearanceStore || {},
            updatedAt: String(localAppearance.updatedAt || '').trim() || undefined,
        };
    }

    function resolveClientPreferences(payload) {
        const direct = payload?.clientPreferences;
        if (direct && typeof direct === 'object') {
            const hasExplicitMetrics = Object.prototype.hasOwnProperty.call(direct, 'sidebarWeatherMetrics');
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
                language: normalizeLanguage(direct.language || document.documentElement?.lang || 'ru'),
                sendShortcut: normalizeSendShortcut(direct.sendShortcut || readLocalPreference(SEND_SHORTCUT_STORAGE_KEY, 'enter')),
                timeFormat: normalizeTimeFormat(direct.timeFormat || readLocalPreference(TIME_FORMAT_STORAGE_KEY, '24h')),
                sidebarWeatherEnabled: direct.sidebarWeatherEnabled === true,
                sidebarWeatherSource: normalizeSidebarWeatherSource(direct.sidebarWeatherSource),
                sidebarWeatherCity: normalizeSidebarWeatherCity(direct.sidebarWeatherCity),
                sidebarWeatherRotateSeconds: normalizeSidebarWeatherRotateSeconds(direct.sidebarWeatherRotateSeconds),
                sidebarWeatherMetrics: normalizeSidebarWeatherMetrics(direct.sidebarWeatherMetrics, {
                    fallbackToDefault: !hasExplicitMetrics,
                }),
                interfaceThemeStore: direct.interfaceThemeStore && typeof direct.interfaceThemeStore === 'object'
                    ? direct.interfaceThemeStore
                    : null,
                chatAppearanceStore: direct.chatAppearanceStore && typeof direct.chatAppearanceStore === 'object'
                    ? direct.chatAppearanceStore
                    : null,
                updatedAt: String(direct.updatedAt || '').trim() || undefined,
            };
        }

        const localAppearance = payload?.localAppearance || {};
        return {
            darkMode: !!localAppearance.darkMode,
            messageScale: normalizeMessageScale(localAppearance.messageScale),
            performanceMode: 'auto',
            motionLevel: 'auto',
            language: normalizeLanguage(localAppearance.language || document.documentElement?.lang || 'ru'),
            sendShortcut: normalizeSendShortcut(payload?.sendShortcut || readLocalPreference(SEND_SHORTCUT_STORAGE_KEY, 'enter')),
            timeFormat: normalizeTimeFormat(payload?.timeFormat || readLocalPreference(TIME_FORMAT_STORAGE_KEY, '24h')),
            sidebarWeatherEnabled: false,
            sidebarWeatherSource: 'auto',
            sidebarWeatherCity: '',
            sidebarWeatherRotateSeconds: 60,
            sidebarWeatherMetrics: [...SIDEBAR_WEATHER_DEFAULT_METRICS],
            interfaceThemeStore: localAppearance.interfaceThemeStore && typeof localAppearance.interfaceThemeStore === 'object'
                ? localAppearance.interfaceThemeStore
                : null,
            chatAppearanceStore: localAppearance.chatAppearanceStore && typeof localAppearance.chatAppearanceStore === 'object'
                ? localAppearance.chatAppearanceStore
                : null,
            updatedAt: String(localAppearance.updatedAt || '').trim() || undefined,
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
        localStorage.setItem('sun_ui_language', normalizeLanguage(clientPreferences.language || document.documentElement?.lang || 'ru'));
        window.InterfaceTheme?.applyCurrentTheme?.();
        window.ChatAppearance?.applyCurrentTheme?.();
        if (window.SUN_CLIENT_PREFERENCES && typeof window.SUN_CLIENT_PREFERENCES.collect === 'function') {
            try {
                window.SUN_CLIENT_PREFERENCES.collect(clientPreferences, { touchUpdatedAt: true });
            } catch (_) {
                // Ignore unified preference sync errors.
            }
        }
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

            const resolvedClientPreferences = resolveClientPreferences(parsed);
            await api.saveSettings({
                ...serverPayload,
                client_preferences: resolvedClientPreferences,
            });
            privacySection.applySettingsFromPayload({
                ...serverPayload,
                client_preferences: resolvedClientPreferences,
            });
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
