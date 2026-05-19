import { readAppliedDarkMode } from '../../modules/theme-state.js';
import {
    INTERFACE_SURFACE_MODE_GLASS,
    applyInterfaceSurfaceMode,
    resolveInterfaceSurfaceMode,
} from '../../modules/interface-surface-mode.js';

const MESSAGE_SCALE_STORAGE_KEY = 'sun_chat_message_scale_v1';
const SEND_SHORTCUT_STORAGE_KEY = 'sun_send_shortcut_mode_v1';
const TIME_FORMAT_STORAGE_KEY = 'sun_time_format_v1';
const SEND_SHORTCUT_ENTER = 'enter';
const SEND_SHORTCUT_CTRL_ENTER = 'ctrl_enter';
const TIME_FORMAT_24H = '24h';
const TIME_FORMAT_12H = '12h';
const SIDEBAR_WEATHER_SOURCE_AUTO = 'auto';
const SIDEBAR_WEATHER_SOURCE_CITY = 'city';
const SIDEBAR_WEATHER_ROTATE_DEFAULT = 60;
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
const SIDEBAR_WEATHER_CITY_SUGGESTIONS_MIN_QUERY_LENGTH = 2;
const SIDEBAR_WEATHER_CITY_SUGGESTIONS_LIMIT = 8;
const SIDEBAR_WEATHER_CITY_SUGGESTIONS_DEBOUNCE_MS = 260;
const PERFORMANCE_MODES = new Set(['auto', 'full', 'lite']);
const MOTION_LEVELS = new Set(['auto', 'full', 'balanced', 'lite']);
const PRIVACY_VALUES = new Set(['all', 'contacts', 'nobody']);
const PRIVACY_SETTING_DEFS = Object.freeze({
    last_seen_visibility: {
        selectId: 'lastSeenVisibilitySelect',
        title: 'Время захода',
        question: 'Кто видит время моего последнего захода?',
        hint: 'Если выбрать "Никто", контакты не увидят, когда вы были в сети.',
    },
    avatar_visibility: {
        selectId: 'avatarVisibilitySelect',
        title: 'Фотография профиля',
        question: 'Кто видит фото в моем профиле?',
        hint: 'Выберите, кому разрешено видеть фотографию в вашем профиле.',
    },
    bio_visibility: {
        selectId: 'bioVisibilitySelect',
        title: 'О себе',
        question: 'Кто видит мой раздел О себе?',
        hint: 'Выберите, кому доступен просмотр раздела "О себе" в вашем профиле.',
    },
    forward_link_privacy: {
        selectId: 'forwardLinkPrivacySelect',
        title: 'Пересылка сообщений',
        question: 'Кто может ссылаться на мой аккаунт при пересылке сообщений?',
        hint: 'Если доступ запрещен, при пересылке останется имя без ссылки на аккаунт.',
    },
    group_invite_privacy: {
        selectId: 'groupInvitePrivacySelect',
        title: 'Группы и каналы',
        question: 'Кто может приглашать меня?',
        hint: 'Выберите, кто может приглашать вас в группы.',
    },
    voice_message_privacy: {
        selectId: 'voiceMessagePrivacySelect',
        title: 'Голосовые сообщения',
        question: 'Кто может отправлять мне голосовые сообщения?',
        hint: 'Ограничение применяется к личным чатам.',
    },
    message_privacy: {
        selectId: 'messagePrivacySelect',
        title: 'Сообщения',
        question: 'Кто может отправлять мне сообщения?',
        hint: 'Ограничение применяется к личным чатам и новым запросам.',
    },
    read_receipts_privacy: {
        selectId: 'readReceiptsPrivacySelect',
        title: 'Отчеты о прочтении',
        question: 'Кто видит, что я прочитал(а) сообщения?',
        hint: 'Если ограничить доступ, собеседники не увидят отметку прочтения от вас.',
    },
    typing_privacy: {
        selectId: 'typingPrivacySelect',
        title: 'Индикатор набора',
        question: 'Кто видит, что я печатаю?',
        hint: 'Ограничение применяется к личным и групповым чатам.',
    },
    voice_listened_privacy: {
        selectId: 'voiceListenedPrivacySelect',
        title: 'Прослушивание голосовых',
        question: 'Кто видит, что я прослушал(а) голосовое?',
        hint: 'Если ограничить доступ, автор голосового не увидит отметку прослушивания.',
    },
    call_privacy: {
        selectId: 'callPrivacySelect',
        title: 'Звонки',
        question: 'Кто может мне звонить?',
        hint: 'Запрещенные звонки не будут создавать входящий вызов.',
    },
    public_key_search_privacy: {
        selectId: 'publicKeySearchPrivacySelect',
        title: 'Поиск по ключу',
        question: 'Кто может найти меня по публичному ключу?',
        hint: 'Обычный поиск по имени по-прежнему зависит от публичности профиля.',
    },
});

function normalizeSendShortcut(value) {
    const raw = String(value || '').trim().toLowerCase();
    return raw === SEND_SHORTCUT_CTRL_ENTER ? SEND_SHORTCUT_CTRL_ENTER : SEND_SHORTCUT_ENTER;
}

function normalizeTimeFormat(value) {
    const raw = String(value || '').trim().toLowerCase();
    return raw === TIME_FORMAT_12H ? TIME_FORMAT_12H : TIME_FORMAT_24H;
}

function normalizeLanguage(value) {
    return String(value || '').trim().toLowerCase() === 'en' ? 'en' : 'ru';
}

function normalizeSidebarWeatherSource(value) {
    const raw = String(value || '').trim().toLowerCase();
    return raw === SIDEBAR_WEATHER_SOURCE_CITY
        ? SIDEBAR_WEATHER_SOURCE_CITY
        : SIDEBAR_WEATHER_SOURCE_AUTO;
}

function normalizeSidebarWeatherRotateSeconds(value) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return parsed === 30 ? 30 : SIDEBAR_WEATHER_ROTATE_DEFAULT;
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

function clampMessageScale(value) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed)) return 1;
    return Math.min(1.3, Math.max(0.9, parsed));
}

function normalizePerformanceMode(value) {
    const raw = String(value || '').trim().toLowerCase();
    return PERFORMANCE_MODES.has(raw) ? raw : 'auto';
}

function normalizeMotionLevel(value) {
    const raw = String(value || '').trim().toLowerCase();
    return MOTION_LEVELS.has(raw) ? raw : 'auto';
}

function normalizePrivacyChoice(value) {
    const raw = String(value || '').trim().toLowerCase();
    return PRIVACY_VALUES.has(raw) ? raw : 'all';
}

function getPrivacyChoiceLabel(value) {
    const normalized = normalizePrivacyChoice(value);
    if (normalized === 'contacts') return 'Мои контакты';
    if (normalized === 'nobody') return 'Никто';
    return 'Все';
}

function readStorageValue(key, fallback = '') {
    try {
        return String(window.localStorage.getItem(key) || fallback);
    } catch (_) {
        return String(fallback || '');
    }
}

export function initPrivacySection({
    api,
    tr,
    i18nApi,
    showAlert,
    state,
    setServerSettingsControlsEnabled,
    markSettingsReady,
    persistMuteDialogRequestsPreference,
    notifyLanguageUpdate,
    notifyMotionUpdate,
    notifyWeatherLabelUpdate,
    applyAvatarFromSettings,
    downloadSettingsQr,
}) {

    const languageOptionEls = Array.from(
        typeof document.querySelectorAll === 'function'
            ? document.querySelectorAll('[data-language-option]')
            : [],
    )
        .filter((el) => el instanceof HTMLInputElement);
    const privacyOverviewPanelEl = document.getElementById('privacyOverviewPanel');
    const privacyDetailPanelEl = document.getElementById('privacyDetailPanel');
    const privacyDetailBackBtnEl = document.getElementById('privacyDetailBackBtn');
    const privacyDetailTitleEl = document.getElementById('privacyDetailTitle');
    const privacyDetailQuestionEl = document.getElementById('privacyDetailQuestion');
    const privacyDetailOptionsEl = document.getElementById('privacyDetailOptions');
    const privacyDetailHintEl = document.getElementById('privacyDetailHint');
    const privacySelectEls = Object.fromEntries(
        Object.entries(PRIVACY_SETTING_DEFS).map(([key, def]) => [key, document.getElementById(def.selectId)]),
    );
    const floatingSaveBtn = document.getElementById('settingsFloatingSaveBtn');
    const bioInputEl = document.getElementById('bioInput');
    const bioCounterEl = document.getElementById('bioCounter');
    const statusTextInputEl = document.getElementById('statusTextInput');
    const statusTextCounterEl = document.getElementById('statusTextCounter');
    const hideOnlineStatusSwitchEl = document.getElementById('hideOnlineStatusSwitch');
    const sendShortcutEnterEl = document.getElementById('sendShortcutEnterOption');
    const sendShortcutCtrlEnterEl = document.getElementById('sendShortcutCtrlEnterOption');
    const timeFormat12hEl = document.getElementById('timeFormat12hOption');
    const timeFormat24hEl = document.getElementById('timeFormat24hOption');
    const timeFormat12hSampleEl = document.getElementById('timeFormat12hSample');
    const timeFormat24hSampleEl = document.getElementById('timeFormat24hSample');
    const animationsEnabledSwitchEl = document.getElementById('animationsEnabledSwitch');
    const interfaceSurfaceGlassSwitchEl = document.getElementById('interfaceSurfaceGlassSwitch');
    const sidebarWeatherEnabledSwitchEl = document.getElementById('sidebarWeatherEnabledSwitch');
    const sidebarWeatherSourceRowEl = document.getElementById('sidebarWeatherSourceRow');
    const sidebarWeatherSourceSelectEl = document.getElementById('sidebarWeatherSourceSelect');
    const sidebarWeatherCityAutocompleteEl = document.getElementById('sidebarWeatherCityAutocomplete');
    const sidebarWeatherCityInputEl = document.getElementById('sidebarWeatherCityInput');
    const sidebarWeatherCitySuggestionsEl = document.getElementById('sidebarWeatherCitySuggestions');
    const sidebarWeatherCityRowEl = document.getElementById('sidebarWeatherCityRow');
    const sidebarWeatherRotateRowEl = document.getElementById('sidebarWeatherRotateRow');
    const sidebarWeatherRotateSelectEl = document.getElementById('sidebarWeatherRotateSelect');
    const sidebarWeatherMetricsRowEl = document.getElementById('sidebarWeatherMetricsRow');
    const sidebarWeatherMetricInputEls = SIDEBAR_WEATHER_METRIC_KEYS
        .map((metricKey) => document.querySelector(`input[name="sidebarWeatherMetricOption"][value="${metricKey}"]`))
        .filter((el) => el instanceof HTMLInputElement);
    let persistedClientPreferences = {};
    let latestPresencePayload = null;
    let sidebarWeatherCitySuggestionsTimerId = 0;
    let sidebarWeatherCitySuggestionsRequestSeq = 0;
    let sidebarWeatherPreferencesSaveTimerId = 0;
    let sidebarWeatherPreferencesSaveSeq = 0;
    let lastSavedSidebarWeatherPreferencesKey = '';
    let privacyPreferencesSaveTimerId = 0;
    let privacyPreferencesSaveSeq = 0;
    let lastSavedPrivacyPreferencesKey = '';
    const CLIENT_PREFERENCES_FIELD_IDS = new Set([
        'lastSeenVisibilitySelect',
        'bioVisibilitySelect',
        'forwardLinkPrivacySelect',
        'voiceMessagePrivacySelect',
        'messagePrivacySelect',
        'sendShortcutEnterOption',
        'sendShortcutCtrlEnterOption',
        'timeFormat12hOption',
        'timeFormat24hOption',
        'animationsEnabledSwitch',
        'sidebarWeatherEnabledSwitch',
        'sidebarWeatherSourceSelect',
        'sidebarWeatherCityInput',
        'sidebarWeatherRotateSelect',
        'sidebarWeatherMetricTemperature',
        'sidebarWeatherMetricFeelsLike',
        'sidebarWeatherMetricHumidity',
        'sidebarWeatherMetricWind',
        'sidebarWeatherMetricPrecip',
        'sidebarWeatherMetricUv',
        'sidebarWeatherMetricAqi',
        'sidebarWeatherMetricPressure',
        'sidebarWeatherMetricSunCycle',
    ]);

    function syncClientPreferencesLocal(touchUpdatedAt = true) {
        if (!window.SUN_CLIENT_PREFERENCES || typeof window.SUN_CLIENT_PREFERENCES.collect !== 'function') {
            return;
        }
        try {
            window.SUN_CLIENT_PREFERENCES.collect(collectClientPreferencesForSave(), { touchUpdatedAt });
        } catch (_) {
            // Ignore local preference sync errors.
        }
    }

    function resolveLocale() {
        const language = i18nApi && typeof i18nApi.getLanguage === 'function'
            ? i18nApi.getLanguage()
            : (document.documentElement.lang || 'ru');
        return language === 'en' ? 'en-US' : 'ru-RU';
    }

    function parseUtcDate(rawValue) {
        if (!rawValue || typeof rawValue !== 'string') return null;
        const normalized = rawValue.includes('T') ? rawValue : `${rawValue.replace(' ', 'T')}Z`;
        const date = new Date(normalized);
        return Number.isNaN(date.getTime()) ? null : date;
    }

    function formatPresenceLastSeen(rawValue) {
        const date = parseUtcDate(rawValue);
        if (!date) return tr('не в сети');
        const now = new Date();
        const isToday = now.toDateString() === date.toDateString();
        const timePart = date.toLocaleTimeString(resolveLocale(), {
            hour: '2-digit',
            minute: '2-digit',
            hour12: getTimeFormatSelection() === TIME_FORMAT_12H,
        });
        if (isToday) return `${tr('был(а) в сети')} ${tr('сегодня в')} ${timePart}`;
        return `${tr('был(а) в сети')} ${date.toLocaleDateString(resolveLocale())}, ${timePart}`;
    }

    function applySettingsNavProfileStatus(payload) {
        const statusEl = document.getElementById('settingsNavProfileStatus');
        if (!statusEl) return;
        const online = payload && payload.online === true;
        const lastSeenRaw = payload && typeof payload.last_seen === 'string' ? payload.last_seen : '';
        statusEl.textContent = online ? tr('в сети') : formatPresenceLastSeen(lastSeenRaw);
    }

    function setSettingsNavProfileLocalPresence(online) {
        if (!latestPresencePayload) return;
        latestPresencePayload = {
            ...latestPresencePayload,
            online: Boolean(online),
            last_seen: online ? latestPresencePayload.last_seen : new Date().toISOString(),
        };
        applySettingsNavProfileStatus(latestPresencePayload);
    }

    function syncSettingsNavPresenceFromVisibility() {
        setSettingsNavProfileLocalPresence(document.visibilityState === 'visible');
    }

    function getSendShortcutSelection() {
        if (sendShortcutCtrlEnterEl?.checked) return SEND_SHORTCUT_CTRL_ENTER;
        return SEND_SHORTCUT_ENTER;
    }

    function setSendShortcutSelection(value) {
        const normalized = normalizeSendShortcut(value);
        if (sendShortcutEnterEl) sendShortcutEnterEl.checked = normalized === SEND_SHORTCUT_ENTER;
        if (sendShortcutCtrlEnterEl) sendShortcutCtrlEnterEl.checked = normalized === SEND_SHORTCUT_CTRL_ENTER;
        return normalized;
    }

    function getTimeFormatSelection() {
        if (timeFormat12hEl?.checked) return TIME_FORMAT_12H;
        return TIME_FORMAT_24H;
    }

    function setTimeFormatSelection(value) {
        const normalized = normalizeTimeFormat(value);
        if (timeFormat12hEl) timeFormat12hEl.checked = normalized === TIME_FORMAT_12H;
        if (timeFormat24hEl) timeFormat24hEl.checked = normalized === TIME_FORMAT_24H;
        return normalized;
    }

    function syncTimeFormatSamples() {
        const sampleDate = new Date(2025, 0, 1, 20, 40, 0);
        const locale = resolveLocale();
        if (timeFormat12hSampleEl) {
            timeFormat12hSampleEl.textContent = sampleDate.toLocaleTimeString(locale, {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true,
            });
        }
        if (timeFormat24hSampleEl) {
            timeFormat24hSampleEl.textContent = sampleDate.toLocaleTimeString(locale, {
                hour: '2-digit',
                minute: '2-digit',
                hour12: false,
            });
        }
    }

    function getPrivacySelection(key) {
        return normalizePrivacyChoice(privacySelectEls[key]?.value);
    }

    function setPrivacySelection(key, value, { emit = false } = {}) {
        const selectEl = privacySelectEls[key];
        if (!selectEl) return 'all';
        const normalized = normalizePrivacyChoice(value);
        selectEl.value = normalized;
        if (key === 'last_seen_visibility') {
            if (hideOnlineStatusSwitchEl) hideOnlineStatusSwitchEl.checked = normalized === 'nobody';
        }
        if (emit) {
            selectEl.dispatchEvent(new Event('input', { bubbles: true }));
            selectEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return normalized;
    }

    function syncPrivacyOverview() {
        Object.keys(PRIVACY_SETTING_DEFS).forEach((key) => {
            const summaryEl = document.querySelector(`[data-privacy-summary="${key}"]`);
            if (!summaryEl) return;
            summaryEl.textContent = getPrivacyChoiceLabel(getPrivacySelection(key));
        });
    }

    function closePrivacyDetail() {
        privacyDetailPanelEl?.classList.add('settings-hidden');
        privacyOverviewPanelEl?.classList.remove('settings-hidden');
    }

    function renderPrivacyDetail(key) {
        const def = PRIVACY_SETTING_DEFS[key];
        if (!def || !privacyDetailOptionsEl) return;
        const currentValue = getPrivacySelection(key);
        privacyOverviewPanelEl?.classList.add('settings-hidden');
        privacyDetailPanelEl?.classList.remove('settings-hidden');
        if (privacyDetailTitleEl) privacyDetailTitleEl.textContent = def.title;
        if (privacyDetailQuestionEl) privacyDetailQuestionEl.textContent = def.question;
        if (privacyDetailHintEl) privacyDetailHintEl.textContent = def.hint;
        privacyDetailOptionsEl.setAttribute('aria-label', def.question);
        privacyDetailOptionsEl.replaceChildren();
        ['all', 'contacts', 'nobody'].forEach((value) => {
            const id = `privacy-${key}-${value}`;
            const labelEl = document.createElement('label');
            labelEl.className = 'settings-preference-option';
            labelEl.setAttribute('for', id);
            labelEl.innerHTML = `
                <input type="radio" name="privacy-${key}" id="${id}" value="${value}">
                <span class="settings-preference-indicator" aria-hidden="true"></span>
                <span class="settings-preference-copy">
                    <span class="settings-preference-title">${getPrivacyChoiceLabel(value)}</span>
                </span>
            `;
            const inputEl = labelEl.querySelector('input');
            if (inputEl) {
                inputEl.checked = value === currentValue;
                inputEl.addEventListener('change', () => {
                    if (!inputEl.checked) return;
                    setPrivacySelection(key, value, { emit: true });
                    syncPrivacyOverview();
                });
            }
            privacyDetailOptionsEl.appendChild(labelEl);
        });
    }

    function getSelectedLanguage() {
        const checked = languageOptionEls.find((el) => el.checked);
        return normalizeLanguage(checked?.value || document.documentElement.lang || 'ru');
    }

    function syncLanguageOptions() {
        const normalized = getSelectedLanguage();
        languageOptionEls.forEach((inputEl) => {
            inputEl.checked = inputEl.value === normalized;
        });
    }

    function resolveWeatherCitySuggestionsLanguage() {
        return getSelectedLanguage() === 'en' ? 'en' : 'ru';
    }

    function setSidebarWeatherCitySuggestionsExpanded(expanded) {
        if (sidebarWeatherCitySuggestionsEl) {
            sidebarWeatherCitySuggestionsEl.hidden = !expanded;
        }
        if (sidebarWeatherCityInputEl) {
            sidebarWeatherCityInputEl.setAttribute('aria-expanded', expanded ? 'true' : 'false');
        }
    }

    function clearSidebarWeatherCitySuggestions({ close = true } = {}) {
        if (sidebarWeatherCitySuggestionsEl) {
            sidebarWeatherCitySuggestionsEl.replaceChildren();
        }
        if (close) {
            setSidebarWeatherCitySuggestionsExpanded(false);
        }
    }

    function commitSidebarWeatherCitySuggestion(value) {
        if (!sidebarWeatherCityInputEl) return;
        const nextValue = normalizeSidebarWeatherCity(value);
        if (!nextValue) return;
        sidebarWeatherCityInputEl.value = nextValue;
        sidebarWeatherCityInputEl.dispatchEvent(new Event('input', { bubbles: true }));
        setSidebarWeatherCitySuggestionsExpanded(false);
    }

    function buildSidebarWeatherCitySuggestionLabel(rawItem) {
        const item = rawItem && typeof rawItem === 'object' ? rawItem : {};
        const pieces = [
            String(item.name || '').trim(),
            String(item.admin1 || '').trim(),
            String(item.country || '').trim(),
        ].filter(Boolean);
        if (!pieces.length) return '';
        const deduped = [];
        const seen = new Set();
        pieces.forEach((piece) => {
            const key = piece.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            deduped.push(piece);
        });
        return deduped.join(', ');
    }

    function applySidebarWeatherCitySuggestions(items) {
        if (!sidebarWeatherCitySuggestionsEl) return;
        clearSidebarWeatherCitySuggestions({ close: false });
        const seen = new Set();
        let hasItems = false;
        items.forEach((item) => {
            const label = buildSidebarWeatherCitySuggestionLabel(item);
            if (!label) return;
            const key = label.toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            hasItems = true;
            const optionEl = document.createElement('button');
            optionEl.type = 'button';
            optionEl.className = 'settings-city-suggestion';
            optionEl.setAttribute('role', 'option');
            optionEl.textContent = label;
            optionEl.addEventListener('mousedown', (event) => {
                event.preventDefault();
            });
            optionEl.addEventListener('click', () => {
                commitSidebarWeatherCitySuggestion(label);
            });
            sidebarWeatherCitySuggestionsEl.appendChild(optionEl);
        });
        setSidebarWeatherCitySuggestionsExpanded(hasItems);
    }

    async function requestSidebarWeatherCitySuggestions(query, seq) {
        const language = resolveWeatherCitySuggestionsLanguage();
        const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
        url.searchParams.set('name', query);
        url.searchParams.set('count', String(SIDEBAR_WEATHER_CITY_SUGGESTIONS_LIMIT));
        url.searchParams.set('language', language);
        url.searchParams.set('format', 'json');
        const response = await fetch(url.toString(), {
            method: 'GET',
            cache: 'no-store',
        });
        if (!response.ok) return;
        const payload = await response.json().catch(() => null);
        if (seq !== sidebarWeatherCitySuggestionsRequestSeq) return;
        const results = Array.isArray(payload?.results) ? payload.results : [];
        applySidebarWeatherCitySuggestions(results);
    }

    function scheduleSidebarWeatherCitySuggestionsUpdate({ immediate = false } = {}) {
        window.clearTimeout(sidebarWeatherCitySuggestionsTimerId);
        const enabled = !!sidebarWeatherEnabledSwitchEl?.checked;
        const source = normalizeSidebarWeatherSource(sidebarWeatherSourceSelectEl?.value);
        const isCityMode = enabled && source === SIDEBAR_WEATHER_SOURCE_CITY;
        if (!isCityMode || !sidebarWeatherCityInputEl || sidebarWeatherCityInputEl.disabled) {
            clearSidebarWeatherCitySuggestions();
            return;
        }

        const query = normalizeSidebarWeatherCity(sidebarWeatherCityInputEl.value);
        if (query.length < SIDEBAR_WEATHER_CITY_SUGGESTIONS_MIN_QUERY_LENGTH) {
            clearSidebarWeatherCitySuggestions();
            return;
        }

        const run = () => {
            const seq = ++sidebarWeatherCitySuggestionsRequestSeq;
            void requestSidebarWeatherCitySuggestions(query, seq).catch(() => {
                if (seq !== sidebarWeatherCitySuggestionsRequestSeq) return;
                clearSidebarWeatherCitySuggestions();
            });
        };

        if (immediate) {
            run();
            return;
        }
        sidebarWeatherCitySuggestionsTimerId = window.setTimeout(
            run,
            SIDEBAR_WEATHER_CITY_SUGGESTIONS_DEBOUNCE_MS,
        );
    }

    function syncSidebarWeatherControls() {
        const enabled = !!sidebarWeatherEnabledSwitchEl?.checked;
        const source = normalizeSidebarWeatherSource(sidebarWeatherSourceSelectEl?.value);
        const visible = enabled && source === SIDEBAR_WEATHER_SOURCE_CITY;

        if (sidebarWeatherSourceRowEl) {
            sidebarWeatherSourceRowEl.style.display = enabled ? '' : 'none';
        }
        if (sidebarWeatherRotateRowEl) {
            sidebarWeatherRotateRowEl.style.display = enabled ? '' : 'none';
        }
        if (sidebarWeatherMetricsRowEl) {
            sidebarWeatherMetricsRowEl.style.display = enabled ? '' : 'none';
        }
        if (sidebarWeatherSourceSelectEl) {
            sidebarWeatherSourceSelectEl.disabled = !enabled;
        }
        if (sidebarWeatherRotateSelectEl) {
            sidebarWeatherRotateSelectEl.disabled = !enabled;
        }
        if (sidebarWeatherCityRowEl) {
            sidebarWeatherCityRowEl.style.display = visible ? '' : 'none';
        }
        if (sidebarWeatherCityInputEl) {
            sidebarWeatherCityInputEl.disabled = !visible;
        }
        sidebarWeatherMetricInputEls.forEach((inputEl) => {
            inputEl.disabled = !enabled;
        });
        if (visible) {
            scheduleSidebarWeatherCitySuggestionsUpdate();
        } else {
            window.clearTimeout(sidebarWeatherCitySuggestionsTimerId);
            clearSidebarWeatherCitySuggestions();
        }
    }

    function getSidebarWeatherPreferencesFromControls() {
        const selectedMetrics = normalizeSidebarWeatherMetrics(
            sidebarWeatherMetricInputEls.filter((inputEl) => inputEl.checked).map((inputEl) => inputEl.value),
            { fallbackToDefault: false },
        );
        return {
            sidebarWeatherEnabled: !!sidebarWeatherEnabledSwitchEl?.checked,
            sidebarWeatherSource: normalizeSidebarWeatherSource(sidebarWeatherSourceSelectEl?.value),
            sidebarWeatherCity: normalizeSidebarWeatherCity(sidebarWeatherCityInputEl?.value),
            sidebarWeatherRotateSeconds: normalizeSidebarWeatherRotateSeconds(sidebarWeatherRotateSelectEl?.value),
            sidebarWeatherMetrics: selectedMetrics,
        };
    }

    function getSidebarWeatherPreferencesKey(weatherPrefs = getSidebarWeatherPreferencesFromControls()) {
        return JSON.stringify({
            sidebarWeatherEnabled: weatherPrefs.sidebarWeatherEnabled === true,
            sidebarWeatherSource: normalizeSidebarWeatherSource(weatherPrefs.sidebarWeatherSource),
            sidebarWeatherCity: normalizeSidebarWeatherCity(weatherPrefs.sidebarWeatherCity),
            sidebarWeatherRotateSeconds: normalizeSidebarWeatherRotateSeconds(weatherPrefs.sidebarWeatherRotateSeconds),
            sidebarWeatherMetrics: normalizeSidebarWeatherMetrics(weatherPrefs.sidebarWeatherMetrics, {
                fallbackToDefault: false,
            }),
        });
    }

    function patchBaselineSidebarWeatherPreferences(weatherPrefs) {
        const baseline = state.getBaseline();
        if (!baseline || typeof baseline !== 'object') return;
        state.setBaseline({
            ...baseline,
            sidebar_weather_enabled: weatherPrefs.sidebarWeatherEnabled,
            sidebar_weather_source: weatherPrefs.sidebarWeatherSource,
            sidebar_weather_city: weatherPrefs.sidebarWeatherCity,
            sidebar_weather_rotate_seconds: weatherPrefs.sidebarWeatherRotateSeconds,
            sidebar_weather_metrics: weatherPrefs.sidebarWeatherMetrics.join(','),
        });
    }

    function getPrivacyPreferencesFromControls() {
        const lastSeenVisibility = getPrivacySelection('last_seen_visibility');
        return {
            is_public: !!document.getElementById('isPublicSwitch')?.checked,
            auto_decline_requests: !!document.getElementById('autoDeclineSwitch')?.checked,
            mute_dialog_requests: !!document.getElementById('muteDialogRequestsSwitch')?.checked,
            hide_online_status: lastSeenVisibility === 'nobody',
            last_seen_visibility: lastSeenVisibility,
            avatar_visibility: getPrivacySelection('avatar_visibility'),
            bio_visibility: getPrivacySelection('bio_visibility'),
            forward_link_privacy: getPrivacySelection('forward_link_privacy'),
            group_invite_privacy: getPrivacySelection('group_invite_privacy'),
            voice_message_privacy: getPrivacySelection('voice_message_privacy'),
            message_privacy: getPrivacySelection('message_privacy'),
            read_receipts_privacy: getPrivacySelection('read_receipts_privacy'),
            typing_privacy: getPrivacySelection('typing_privacy'),
            voice_listened_privacy: getPrivacySelection('voice_listened_privacy'),
            call_privacy: getPrivacySelection('call_privacy'),
            public_key_search_privacy: getPrivacySelection('public_key_search_privacy'),
        };
    }

    function getPrivacyPreferencesKey(privacyPrefs = getPrivacyPreferencesFromControls()) {
        return JSON.stringify({
            is_public: privacyPrefs.is_public === true,
            auto_decline_requests: privacyPrefs.auto_decline_requests === true,
            mute_dialog_requests: privacyPrefs.mute_dialog_requests === true,
            hide_online_status: privacyPrefs.hide_online_status === true,
            last_seen_visibility: normalizePrivacyChoice(privacyPrefs.last_seen_visibility),
            avatar_visibility: normalizePrivacyChoice(privacyPrefs.avatar_visibility),
            bio_visibility: normalizePrivacyChoice(privacyPrefs.bio_visibility),
            forward_link_privacy: normalizePrivacyChoice(privacyPrefs.forward_link_privacy),
            group_invite_privacy: normalizePrivacyChoice(privacyPrefs.group_invite_privacy),
            voice_message_privacy: normalizePrivacyChoice(privacyPrefs.voice_message_privacy),
            message_privacy: normalizePrivacyChoice(privacyPrefs.message_privacy),
            read_receipts_privacy: normalizePrivacyChoice(privacyPrefs.read_receipts_privacy),
            typing_privacy: normalizePrivacyChoice(privacyPrefs.typing_privacy),
            voice_listened_privacy: normalizePrivacyChoice(privacyPrefs.voice_listened_privacy),
            call_privacy: normalizePrivacyChoice(privacyPrefs.call_privacy),
            public_key_search_privacy: normalizePrivacyChoice(privacyPrefs.public_key_search_privacy),
        });
    }

    function patchBaselinePrivacyPreferences(privacyPrefs) {
        const baseline = state.getBaseline();
        if (!baseline || typeof baseline !== 'object') return;
        state.setBaseline({
            ...baseline,
            ...privacyPrefs,
        });
    }

    function applySidebarWeatherPreferencesToControls(rawPreferences) {
        const source = normalizeSidebarWeatherSource(rawPreferences?.sidebarWeatherSource);
        const enabled = rawPreferences?.sidebarWeatherEnabled === true;
        const city = normalizeSidebarWeatherCity(rawPreferences?.sidebarWeatherCity);
        const rotateSeconds = normalizeSidebarWeatherRotateSeconds(rawPreferences?.sidebarWeatherRotateSeconds);
        const hasExplicitMetrics = rawPreferences && typeof rawPreferences === 'object'
            && Object.prototype.hasOwnProperty.call(rawPreferences, 'sidebarWeatherMetrics');
        const metrics = normalizeSidebarWeatherMetrics(rawPreferences?.sidebarWeatherMetrics, {
            fallbackToDefault: !hasExplicitMetrics,
        });

        if (sidebarWeatherEnabledSwitchEl) {
            sidebarWeatherEnabledSwitchEl.checked = enabled;
        }
        if (sidebarWeatherSourceSelectEl) {
            sidebarWeatherSourceSelectEl.value = source;
        }
        if (sidebarWeatherCityInputEl) {
            sidebarWeatherCityInputEl.value = city;
        }
        if (sidebarWeatherRotateSelectEl) {
            sidebarWeatherRotateSelectEl.value = String(rotateSeconds);
        }
        const metricSet = new Set(metrics);
        sidebarWeatherMetricInputEls.forEach((inputEl) => {
            inputEl.checked = metricSet.has(String(inputEl.value || '').toLowerCase());
        });
        syncSidebarWeatherControls();
    }

    function persistInputBehaviorLocally({ sendShortcut, timeFormat }) {
        try {
            window.localStorage.setItem(SEND_SHORTCUT_STORAGE_KEY, normalizeSendShortcut(sendShortcut));
            window.localStorage.setItem(TIME_FORMAT_STORAGE_KEY, normalizeTimeFormat(timeFormat));
        } catch (_) {}
    }

    function resolveCurrentAppliedMotionLevel() {
        const current = String(document.documentElement.getAttribute('data-motion-level') || '').trim().toLowerCase();
        if (current === 'full' || current === 'balanced' || current === 'lite') return current;
        return 'full';
    }

    function applyMotionPreferences(
        { performanceMode, motionLevel },
        { persist = false, notify = false, syncToggle = false } = {},
    ) {
        const safePerformanceMode = normalizePerformanceMode(performanceMode);
        const safeMotionLevel = normalizeMotionLevel(motionLevel);
        const animationsEnabled = safePerformanceMode !== 'lite' && safeMotionLevel !== 'lite';
        const effectiveMotionLevel = animationsEnabled
            ? (safeMotionLevel === 'auto' ? resolveCurrentAppliedMotionLevel() : safeMotionLevel)
            : 'lite';

        document.documentElement.classList.toggle('perf-lite', !animationsEnabled);
        document.documentElement.setAttribute('data-performance-mode', animationsEnabled ? 'full' : 'lite');
        document.documentElement.setAttribute('data-motion-level', effectiveMotionLevel);

        window.SUN_PERFORMANCE_MODE = {
            ...(window.SUN_PERFORMANCE_MODE || {}),
            preference: safePerformanceMode,
            isLite: !animationsEnabled,
        };
        window.SUN_MOTION = {
            ...(window.SUN_MOTION || {}),
            preference: safeMotionLevel,
            level: effectiveMotionLevel,
            forceAnimations: animationsEnabled,
        };

        if (persist) {
            try {
                window.localStorage.setItem('sun_performance_mode', safePerformanceMode);
                window.localStorage.setItem('sun_motion_level', safeMotionLevel);
            } catch (_) {}
        }
        if (syncToggle && animationsEnabledSwitchEl) {
            animationsEnabledSwitchEl.checked = animationsEnabled;
        }
        if (notify && typeof notifyMotionUpdate === 'function') {
            notifyMotionUpdate({
                animationsEnabled,
                performanceMode: safePerformanceMode,
                motionLevel: safeMotionLevel,
                appliedMotionLevel: effectiveMotionLevel,
            });
        }
    }

    function collectClientPreferencesForSave() {
        const base = persistedClientPreferences && typeof persistedClientPreferences === 'object'
            ? persistedClientPreferences
            : {};
        const darkMode = readAppliedDarkMode();
        const messageScale = clampMessageScale(readStorageValue(MESSAGE_SCALE_STORAGE_KEY, base.messageScale || '1'));
        const performanceMode = normalizePerformanceMode(readStorageValue('sun_performance_mode', base.performanceMode || 'auto'));
        const motionLevel = normalizeMotionLevel(readStorageValue('sun_motion_level', base.motionLevel || 'auto'));
        const interfaceSurfaceMode = interfaceSurfaceGlassSwitchEl instanceof HTMLInputElement
            ? (interfaceSurfaceGlassSwitchEl.checked ? 'glass' : 'solid')
            : resolveInterfaceSurfaceMode(base);

        return {
            darkMode,
            language: getSelectedLanguage(),
            updatedAt: new Date().toISOString(),
            messageScale,
            performanceMode,
            motionLevel,
            interfaceSurfaceMode,
            sendShortcut: getSendShortcutSelection(),
            timeFormat: getTimeFormatSelection(),
            ...getSidebarWeatherPreferencesFromControls(),
            interfaceThemeStore: window.InterfaceTheme?.readStore?.() || base.interfaceThemeStore || {},
            chatAppearanceStore: window.ChatAppearance?.readStore?.() || base.chatAppearanceStore || {},
        };
    }

    async function persistSidebarWeatherPreferences(seq) {
        if (!state.isLoaded() || !state.getBaseline()) return;
        const weatherPrefs = getSidebarWeatherPreferencesFromControls();
        const weatherPrefsKey = getSidebarWeatherPreferencesKey(weatherPrefs);
        if (weatherPrefsKey === lastSavedSidebarWeatherPreferencesKey) return;
        const clientPreferences = collectClientPreferencesForSave();

        try {
            const payload = await api.saveSettings({ client_preferences: clientPreferences });
            if (seq !== sidebarWeatherPreferencesSaveSeq || !payload.success) return;
            persistedClientPreferences = { ...clientPreferences };
            lastSavedSidebarWeatherPreferencesKey = weatherPrefsKey;
            patchBaselineSidebarWeatherPreferences(weatherPrefs);
            if (typeof notifyWeatherLabelUpdate === 'function') {
                notifyWeatherLabelUpdate({
                    clientPreferences,
                    persisted: true,
                });
            }
            state.syncDirtyState();
        } catch (_) {
            state.syncDirtyState();
        }
    }

    async function persistPrivacyPreferences(seq) {
        if (!state.isLoaded() || !state.getBaseline()) return;
        const privacyPrefs = getPrivacyPreferencesFromControls();
        const privacyPrefsKey = getPrivacyPreferencesKey(privacyPrefs);
        if (privacyPrefsKey === lastSavedPrivacyPreferencesKey) return;

        try {
            const payload = await api.saveSettings(privacyPrefs);
            if (seq !== privacyPreferencesSaveSeq || !payload.success) return;
            lastSavedPrivacyPreferencesKey = privacyPrefsKey;
            patchBaselinePrivacyPreferences(privacyPrefs);
            persistMuteDialogRequestsPreference(Boolean(privacyPrefs.mute_dialog_requests));
            state.syncDirtyState();
        } catch (_) {
            state.syncDirtyState();
        }
    }

    function scheduleSidebarWeatherPreferencesSave() {
        syncClientPreferencesLocal(true);
        if (typeof notifyWeatherLabelUpdate === 'function') {
            notifyWeatherLabelUpdate({
                clientPreferences: collectClientPreferencesForSave(),
                persisted: false,
            });
        }
        window.clearTimeout(sidebarWeatherPreferencesSaveTimerId);
        const seq = ++sidebarWeatherPreferencesSaveSeq;
        sidebarWeatherPreferencesSaveTimerId = window.setTimeout(() => {
            void persistSidebarWeatherPreferences(seq);
        }, 700);
    }

    function schedulePrivacyPreferencesSave() {
        window.clearTimeout(privacyPreferencesSaveTimerId);
        const seq = ++privacyPreferencesSaveSeq;
        privacyPreferencesSaveTimerId = window.setTimeout(() => {
            void persistPrivacyPreferences(seq);
        }, 500);
    }

    function getCommonPayload() {
        const bioEl = document.getElementById('bioInput');
        const weatherPrefs = getSidebarWeatherPreferencesFromControls();
        const privacyPrefs = getPrivacyPreferencesFromControls();
        return {
            username: document.getElementById('username').value.trim(),
            display_name: document.getElementById('displayName').value.trim(),
            language: getSelectedLanguage(),
            bio: bioEl ? bioEl.value.trim().slice(0, 280) : '',
            status_text: String(statusTextInputEl?.value || '').trim().slice(0, 100),
            ...privacyPrefs,
            send_shortcut: getSendShortcutSelection(),
            time_format: getTimeFormatSelection(),
            sidebar_weather_enabled: weatherPrefs.sidebarWeatherEnabled,
            sidebar_weather_source: weatherPrefs.sidebarWeatherSource,
            sidebar_weather_city: weatherPrefs.sidebarWeatherCity,
            sidebar_weather_rotate_seconds: weatherPrefs.sidebarWeatherRotateSeconds,
            sidebar_weather_metrics: weatherPrefs.sidebarWeatherMetrics.join(','),
        };
    }

    function applySettingsFromPayload(payload) {
        if (!payload || typeof payload !== 'object') return;
        latestPresencePayload = payload;

        const usernameEl = document.getElementById('username');
        const displayNameEl = document.getElementById('displayName');

        const bioEl = document.getElementById('bioInput');
        const isPublicEl = document.getElementById('isPublicSwitch');
        const autoDeclineEl = document.getElementById('autoDeclineSwitch');
        const muteRequestsEl = document.getElementById('muteDialogRequestsSwitch');
        const avatarVisibilityEl = document.getElementById('avatarVisibilitySelect');
        const groupInvitePrivacyEl = document.getElementById('groupInvitePrivacySelect');

        if (usernameEl && typeof payload.username === 'string') usernameEl.value = payload.username.trim();
        if (displayNameEl && typeof payload.display_name === 'string') displayNameEl.value = payload.display_name.trim();
        const incomingLang = normalizeLanguage(payload.language || 'ru');
        languageOptionEls.forEach((el) => { el.checked = el.value === incomingLang; });
        if (bioEl) bioEl.value = String(payload.bio || '').slice(0, 280);
        if (statusTextInputEl) {
            statusTextInputEl.value = String(payload.status_text || '').slice(0, 100);
            if (statusTextCounterEl) statusTextCounterEl.textContent = `${statusTextInputEl.value.length}/100`;
        }
        if (isPublicEl) isPublicEl.checked = !!payload.is_public;
        if (hideOnlineStatusSwitchEl) hideOnlineStatusSwitchEl.checked = !!payload.hide_online_status;
        setPrivacySelection(
            'last_seen_visibility',
            payload.last_seen_visibility || (payload.hide_online_status ? 'nobody' : 'all'),
        );
        setPrivacySelection('bio_visibility', payload.bio_visibility || 'all');
        setPrivacySelection('forward_link_privacy', payload.forward_link_privacy || 'all');
        setPrivacySelection('voice_message_privacy', payload.voice_message_privacy || 'all');
        setPrivacySelection('message_privacy', payload.message_privacy || 'all');
        setPrivacySelection('read_receipts_privacy', payload.read_receipts_privacy || 'all');
        setPrivacySelection('typing_privacy', payload.typing_privacy || 'all');
        setPrivacySelection('voice_listened_privacy', payload.voice_listened_privacy || 'all');
        setPrivacySelection('call_privacy', payload.call_privacy || 'all');
        setPrivacySelection('public_key_search_privacy', payload.public_key_search_privacy || 'all');
        if (autoDeclineEl) autoDeclineEl.checked = !!payload.auto_decline_requests;
        if (muteRequestsEl) muteRequestsEl.checked = !!payload.mute_dialog_requests;
        if (avatarVisibilityEl) {
            const nextVisibility = String(payload.avatar_visibility || 'all').toLowerCase();
            avatarVisibilityEl.value = ['all', 'contacts', 'nobody'].includes(nextVisibility) ? nextVisibility : 'all';
        }
        if (groupInvitePrivacyEl) {
            const nextGroupInvitePrivacy = String(payload.group_invite_privacy || 'all').toLowerCase();
            groupInvitePrivacyEl.value = ['all', 'contacts', 'nobody'].includes(nextGroupInvitePrivacy)
                ? nextGroupInvitePrivacy
                : 'all';
        }
        syncPrivacyOverview();
        syncLanguageOptions();

        const rawClientPreferences = payload.client_preferences && typeof payload.client_preferences === 'object'
            ? payload.client_preferences
            : {};
        const unifiedClientPreferences = window.SUN_CLIENT_PREFERENCES && typeof window.SUN_CLIENT_PREFERENCES.read === 'function'
            ? window.SUN_CLIENT_PREFERENCES.read()
            : null;
        const weatherClientPreferences = unifiedClientPreferences && typeof unifiedClientPreferences === 'object'
            ? unifiedClientPreferences
            : rawClientPreferences;
        persistedClientPreferences = { ...rawClientPreferences };
        applySidebarWeatherPreferencesToControls(weatherClientPreferences);
        lastSavedSidebarWeatherPreferencesKey = getSidebarWeatherPreferencesKey();
        lastSavedPrivacyPreferencesKey = getPrivacyPreferencesKey();
        const nextSendShortcut = setSendShortcutSelection(
            rawClientPreferences.sendShortcut || readStorageValue(SEND_SHORTCUT_STORAGE_KEY, SEND_SHORTCUT_ENTER)
        );
        const nextTimeFormat = setTimeFormatSelection(
            rawClientPreferences.timeFormat || readStorageValue(TIME_FORMAT_STORAGE_KEY, TIME_FORMAT_24H)
        );
        const nextPerformanceMode = normalizePerformanceMode(
            readStorageValue('sun_performance_mode', rawClientPreferences.performanceMode || 'auto')
        );
        const nextMotionLevel = normalizeMotionLevel(
            readStorageValue('sun_motion_level', rawClientPreferences.motionLevel || 'auto')
        );
        syncTimeFormatSamples();
        persistInputBehaviorLocally({ sendShortcut: nextSendShortcut, timeFormat: nextTimeFormat });
        applyMotionPreferences(
            { performanceMode: nextPerformanceMode, motionLevel: nextMotionLevel },
            { persist: true, notify: true, syncToggle: true },
        );
        const nextInterfaceSurfaceMode = resolveInterfaceSurfaceMode(weatherClientPreferences);
        applyInterfaceSurfaceMode(nextInterfaceSurfaceMode, { persist: true });
        if (interfaceSurfaceGlassSwitchEl instanceof HTMLInputElement) {
            interfaceSurfaceGlassSwitchEl.checked = nextInterfaceSurfaceMode === INTERFACE_SURFACE_MODE_GLASS;
        }
        syncClientPreferencesLocal(false);

        if (bioEl && bioCounterEl) {
            bioCounterEl.textContent = `${bioEl.value.length}/280`;
        }
        displayNameEl?.dispatchEvent(new Event('input', { bubbles: true }));
        usernameEl?.dispatchEvent(new Event('input', { bubbles: true }));
        bioEl?.dispatchEvent(new Event('input', { bubbles: true }));
        persistMuteDialogRequestsPreference(!!payload.mute_dialog_requests);
        const checkedLanguageEl = languageOptionEls.find((el) => el.checked);
        if (checkedLanguageEl && i18nApi && typeof i18nApi.setLanguage === 'function') {
            i18nApi.setLanguage(checkedLanguageEl.value, { persist: true, apply: true });
        }
        applySettingsNavProfileStatus(payload);
        if (typeof notifyWeatherLabelUpdate === 'function') {
            notifyWeatherLabelUpdate({
                clientPreferences: collectClientPreferencesForSave(),
                persisted: true,
            });
        }
        state.syncDirtyState();
    }

    async function saveSettings(extraPayload, btn) {
        if (!state.isLoaded() || !state.getBaseline()) {
            showAlert('\u0414\u043E\u0436\u0434\u0438\u0442\u0435\u0441\u044C \u043F\u043E\u043B\u043D\u043E\u0439 \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0438 \u043D\u0430\u0441\u0442\u0440\u043E\u0435\u043A.', 'warning');
            if (btn) btn.disabled = true;
            return;
        }

        if (btn) btn.disabled = true;
        state.setFloatingSaveSaving(true);

        try {
            const requestPayload = Object.assign(getCommonPayload(), extraPayload || {});
            if (!Object.prototype.hasOwnProperty.call(requestPayload, 'client_preferences')) {
                requestPayload.client_preferences = collectClientPreferencesForSave();
            }
            sidebarWeatherPreferencesSaveSeq += 1;
            window.clearTimeout(sidebarWeatherPreferencesSaveTimerId);
            privacyPreferencesSaveSeq += 1;
            window.clearTimeout(privacyPreferencesSaveTimerId);
            const payload = await api.saveSettings(requestPayload);
            if (!payload.success) {
                showAlert(`${tr('\u041E\u0448\u0438\u0431\u043A\u0430:')} ${payload.error || ''}`.trim(), 'danger');
                return;
            }
            persistedClientPreferences = { ...(requestPayload.client_preferences || {}) };
            lastSavedSidebarWeatherPreferencesKey = getSidebarWeatherPreferencesKey();
            lastSavedPrivacyPreferencesKey = getPrivacyPreferencesKey();
            const nextBaseline = getCommonPayload();
            state.setBaseline(nextBaseline);
            persistMuteDialogRequestsPreference(Boolean(nextBaseline.mute_dialog_requests));
            persistInputBehaviorLocally({
                sendShortcut: nextBaseline.send_shortcut,
                timeFormat: nextBaseline.time_format,
            });
            if (i18nApi && typeof i18nApi.setLanguage === 'function') {
                i18nApi.setLanguage(nextBaseline.language, { persist: true, apply: true });
            }
            notifyLanguageUpdate(nextBaseline.language, true);
            if (typeof notifyWeatherLabelUpdate === 'function') {
                notifyWeatherLabelUpdate({
                    clientPreferences: collectClientPreferencesForSave(),
                    persisted: true,
                });
            }
            state.syncDirtyState();
            state.animateFloatingSaveSuccess();
        } catch (_err) {
            showAlert('\u041E\u0448\u0438\u0431\u043A\u0430 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0438\u044F', 'danger');
        } finally {
            if (btn) {
                btn.disabled = !state.isDirty();
            }
            state.setFloatingSaveSaving(false);
            state.syncFloatingSaveButton();
        }
    }

    [
        document.getElementById('displayName'),
        document.getElementById('username'),
        document.getElementById('bioInput'),
        document.getElementById('statusTextInput'),
        document.getElementById('isPublicSwitch'),
        document.getElementById('hideOnlineStatusSwitch'),
        document.getElementById('autoDeclineSwitch'),
        document.getElementById('muteDialogRequestsSwitch'),
        document.getElementById('lastSeenVisibilitySelect'),
        document.getElementById('avatarVisibilitySelect'),
        document.getElementById('bioVisibilitySelect'),
        document.getElementById('forwardLinkPrivacySelect'),
        document.getElementById('groupInvitePrivacySelect'),
        document.getElementById('voiceMessagePrivacySelect'),
        document.getElementById('messagePrivacySelect'),
        document.getElementById('readReceiptsPrivacySelect'),
        document.getElementById('typingPrivacySelect'),
        document.getElementById('voiceListenedPrivacySelect'),
        document.getElementById('callPrivacySelect'),
        document.getElementById('publicKeySearchPrivacySelect'),
        sendShortcutEnterEl,
        sendShortcutCtrlEnterEl,
        timeFormat12hEl,
        timeFormat24hEl,
        sidebarWeatherEnabledSwitchEl,
        sidebarWeatherSourceSelectEl,
        sidebarWeatherCityInputEl,
        sidebarWeatherRotateSelectEl,
        ...sidebarWeatherMetricInputEls,
        ...languageOptionEls,
    ].forEach((field) => {
        if (!field) return;
        const maybeSyncClientPreferences = () => {
            if (CLIENT_PREFERENCES_FIELD_IDS.has(String(field.id || ''))) {
                syncClientPreferencesLocal(true);
            }
        };
        field.addEventListener('input', () => {
            syncPrivacyOverview();
            state.syncDirtyState();
            maybeSyncClientPreferences();
        });
        field.addEventListener('change', () => {
            syncPrivacyOverview();
            state.syncDirtyState();
            maybeSyncClientPreferences();
        });
    });

    if (bioInputEl && bioCounterEl) {
        bioInputEl.addEventListener('input', () => {
            bioCounterEl.textContent = `${bioInputEl.value.length}/280`;
        });
    }

    if (statusTextInputEl && statusTextCounterEl) {
        statusTextInputEl.addEventListener('input', () => {
            statusTextCounterEl.textContent = `${statusTextInputEl.value.length}/100`;
        });
    }

    languageOptionEls.forEach((inputEl) => {
        inputEl.addEventListener('change', () => {
            if (!inputEl.checked) return;
            const nextLanguage = normalizeLanguage(inputEl.value);
            if (i18nApi && typeof i18nApi.setLanguage === 'function') {
                i18nApi.setLanguage(nextLanguage, { persist: false, apply: true });
            }
            notifyLanguageUpdate(nextLanguage, false);
            syncTimeFormatSamples();
            if (latestPresencePayload) applySettingsNavProfileStatus(latestPresencePayload);
            syncClientPreferencesLocal(true);
            scheduleSidebarWeatherCitySuggestionsUpdate({ immediate: true });
        });
    });

    hideOnlineStatusSwitchEl?.addEventListener('change', () => {
        setPrivacySelection('last_seen_visibility', hideOnlineStatusSwitchEl.checked ? 'nobody' : 'all', {
            emit: true,
        });
        syncPrivacyOverview();
    });

    [
        document.getElementById('isPublicSwitch'),
        hideOnlineStatusSwitchEl,
        document.getElementById('autoDeclineSwitch'),
        document.getElementById('muteDialogRequestsSwitch'),
        document.getElementById('lastSeenVisibilitySelect'),
        document.getElementById('avatarVisibilitySelect'),
        document.getElementById('bioVisibilitySelect'),
        document.getElementById('forwardLinkPrivacySelect'),
        document.getElementById('groupInvitePrivacySelect'),
        document.getElementById('voiceMessagePrivacySelect'),
        document.getElementById('messagePrivacySelect'),
        document.getElementById('readReceiptsPrivacySelect'),
        document.getElementById('typingPrivacySelect'),
        document.getElementById('voiceListenedPrivacySelect'),
        document.getElementById('callPrivacySelect'),
        document.getElementById('publicKeySearchPrivacySelect'),
    ].forEach((field) => {
        if (!field) return;
        field.addEventListener('input', schedulePrivacyPreferencesSave);
        field.addEventListener('change', schedulePrivacyPreferencesSave);
    });

    Array.from(
        typeof document.querySelectorAll === 'function'
            ? document.querySelectorAll('[data-privacy-open]')
            : [],
    ).forEach((buttonEl) => {
        buttonEl.addEventListener('click', () => {
            renderPrivacyDetail(String(buttonEl.getAttribute('data-privacy-open') || ''));
        });
    });
    privacyDetailBackBtnEl?.addEventListener('click', closePrivacyDetail);

    window.addEventListener('sun-time-format-changed', () => {
        if (!latestPresencePayload) return;
        applySettingsNavProfileStatus(latestPresencePayload);
    });
    document.addEventListener('visibilitychange', syncSettingsNavPresenceFromVisibility);
    window.addEventListener('pagehide', () => setSettingsNavProfileLocalPresence(false));
    window.addEventListener('focus', () => {
        if (document.visibilityState === 'visible') {
            setSettingsNavProfileLocalPresence(true);
        }
    });

    animationsEnabledSwitchEl?.addEventListener('change', () => {
        const animationsEnabled = !!animationsEnabledSwitchEl.checked;
        applyMotionPreferences(
            {
                performanceMode: animationsEnabled ? 'full' : 'lite',
                motionLevel: animationsEnabled ? 'full' : 'lite',
            },
            { persist: true, notify: true, syncToggle: true },
        );
        syncClientPreferencesLocal(true);
    });

    sidebarWeatherEnabledSwitchEl?.addEventListener('change', () => {
        syncSidebarWeatherControls();
    });

    sidebarWeatherSourceSelectEl?.addEventListener('change', () => {
        syncSidebarWeatherControls();
    });

    sidebarWeatherCityInputEl?.addEventListener('input', () => {
        scheduleSidebarWeatherCitySuggestionsUpdate();
    });

    [
        sidebarWeatherEnabledSwitchEl,
        sidebarWeatherSourceSelectEl,
        sidebarWeatherCityInputEl,
        sidebarWeatherRotateSelectEl,
        ...sidebarWeatherMetricInputEls,
    ].forEach((field) => {
        if (!field) return;
        field.addEventListener('input', scheduleSidebarWeatherPreferencesSave);
        field.addEventListener('change', scheduleSidebarWeatherPreferencesSave);
    });

    sidebarWeatherCityInputEl?.addEventListener('focus', () => {
        scheduleSidebarWeatherCitySuggestionsUpdate({ immediate: true });
    });

    sidebarWeatherCityInputEl?.addEventListener('blur', () => {
        window.setTimeout(() => {
            setSidebarWeatherCitySuggestionsExpanded(false);
        }, 120);
    });

    document.addEventListener('pointerdown', (event) => {
        if (!sidebarWeatherCitySuggestionsEl || sidebarWeatherCitySuggestionsEl.hidden) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target && sidebarWeatherCityAutocompleteEl?.contains(target)) return;
        setSidebarWeatherCitySuggestionsExpanded(false);
    });

    floatingSaveBtn?.addEventListener('click', function () {
        if (!state.isDirty() || this.disabled) return;
        saveSettings({}, this);
    });

    function copyKey(id, btn) {
        const el = document.getElementById(id);
        if (!el) return;
        navigator.clipboard.writeText(el.value).then(() => {
            const orig = btn.innerHTML;
            btn.innerHTML = `<span class="sun-check-glyph sun-check-glyph--single sun-check-glyph--ui" aria-hidden="true"><svg viewBox="0 0 10 10" focusable="false"><path d="M1.2 5.2L4 8L8.8 2.2"></path></svg></span> ${tr('\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E!')}`;
            btn.style.background = 'rgba(16,185,129,0.15)';
            btn.style.color = 'var(--success)';
            setTimeout(() => {
                btn.innerHTML = orig;
                btn.style.background = '';
                btn.style.color = '';
            }, 2000);
        }).catch(() => {
            el.select();
            document.execCommand('copy');
        });
    }

    document.getElementById('copyPublicKeyBtn')?.addEventListener('click', function () {
        copyKey('publicKeyTextarea', this);
    });
    document.getElementById('copyQrPublicKeyBtn')?.addEventListener('click', function () {
        copyKey('publicKeyTextarea', this);
    });
    document.getElementById('copyPrivateKeyBtn')?.addEventListener('click', function () {
        copyKey('privateKeyTextarea', this);
    });
    document.getElementById('downloadQrBtn')?.addEventListener('click', function () {
        downloadSettingsQr();
    });

    syncTimeFormatSamples();
    syncLanguageOptions();
    syncPrivacyOverview();
    syncSidebarWeatherControls();

    api.getSettings()
        .then((s) => {
            try {
                applySettingsFromPayload(s);
                applyAvatarFromSettings(String(s.avatar_url || '').trim());
            } catch (applyErr) {
                console.error('[settings] applySettingsFromPayload failed:', applyErr);
            }
            state.setLoaded(true);
            setServerSettingsControlsEnabled(true);
            state.setBaseline(getCommonPayload());
            state.syncDirtyState();
            notifyLanguageUpdate(s.language, true);
        })
        .catch((err) => {
            state.setLoaded(false);
            state.setBaseline(null);
            setServerSettingsControlsEnabled(false);
            state.syncDirtyState();
            showAlert('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438. \u041F\u0435\u0440\u0435\u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u0435 \u0441\u0442\u0440\u0430\u043D\u0438\u0446\u0443.', 'danger');
        })
        .finally(markSettingsReady);

    return {
        getCommonPayload,
        applySettingsFromPayload,
        saveSettings,
    };
}
