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
const PERFORMANCE_MODES = new Set(['auto', 'full', 'lite']);
const MOTION_LEVELS = new Set(['auto', 'full', 'balanced', 'lite']);

function normalizeSendShortcut(value) {
    const raw = String(value || '').trim().toLowerCase();
    return raw === SEND_SHORTCUT_CTRL_ENTER ? SEND_SHORTCUT_CTRL_ENTER : SEND_SHORTCUT_ENTER;
}

function normalizeTimeFormat(value) {
    const raw = String(value || '').trim().toLowerCase();
    return raw === TIME_FORMAT_12H ? TIME_FORMAT_12H : TIME_FORMAT_24H;
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
    const languageSelectEl = document.getElementById('languageSelect');
    const floatingSaveBtn = document.getElementById('settingsFloatingSaveBtn');
    const bioInputEl = document.getElementById('bioInput');
    const bioCounterEl = document.getElementById('bioCounter');
    const sendShortcutEnterEl = document.getElementById('sendShortcutEnterOption');
    const sendShortcutCtrlEnterEl = document.getElementById('sendShortcutCtrlEnterOption');
    const timeFormat12hEl = document.getElementById('timeFormat12hOption');
    const timeFormat24hEl = document.getElementById('timeFormat24hOption');
    const timeFormat12hSampleEl = document.getElementById('timeFormat12hSample');
    const timeFormat24hSampleEl = document.getElementById('timeFormat24hSample');
    const animationsEnabledSwitchEl = document.getElementById('animationsEnabledSwitch');
    const sidebarWeatherEnabledSwitchEl = document.getElementById('sidebarWeatherEnabledSwitch');
    const sidebarWeatherSourceSelectEl = document.getElementById('sidebarWeatherSourceSelect');
    const sidebarWeatherCityInputEl = document.getElementById('sidebarWeatherCityInput');
    const sidebarWeatherCityRowEl = document.getElementById('sidebarWeatherCityRow');
    const sidebarWeatherRotateSelectEl = document.getElementById('sidebarWeatherRotateSelect');
    let persistedClientPreferences = {};

    function resolveLocale() {
        const language = i18nApi && typeof i18nApi.getLanguage === 'function'
            ? i18nApi.getLanguage()
            : (document.documentElement.lang || 'ru');
        return language === 'en' ? 'en-US' : 'ru-RU';
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

    function syncSidebarWeatherCityRow() {
        if (!sidebarWeatherCityRowEl) return;
        const enabled = !!sidebarWeatherEnabledSwitchEl?.checked;
        const source = normalizeSidebarWeatherSource(sidebarWeatherSourceSelectEl?.value);
        const visible = enabled && source === SIDEBAR_WEATHER_SOURCE_CITY;
        sidebarWeatherCityRowEl.style.display = visible ? '' : 'none';
        if (sidebarWeatherCityInputEl) {
            sidebarWeatherCityInputEl.disabled = !visible;
        }
    }

    function getSidebarWeatherPreferencesFromControls() {
        return {
            sidebarWeatherEnabled: !!sidebarWeatherEnabledSwitchEl?.checked,
            sidebarWeatherSource: normalizeSidebarWeatherSource(sidebarWeatherSourceSelectEl?.value),
            sidebarWeatherCity: normalizeSidebarWeatherCity(sidebarWeatherCityInputEl?.value),
            sidebarWeatherRotateSeconds: normalizeSidebarWeatherRotateSeconds(sidebarWeatherRotateSelectEl?.value),
        };
    }

    function applySidebarWeatherPreferencesToControls(rawPreferences) {
        const source = normalizeSidebarWeatherSource(rawPreferences?.sidebarWeatherSource);
        const enabled = rawPreferences?.sidebarWeatherEnabled === true;
        const city = normalizeSidebarWeatherCity(rawPreferences?.sidebarWeatherCity);
        const rotateSeconds = normalizeSidebarWeatherRotateSeconds(rawPreferences?.sidebarWeatherRotateSeconds);

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
        syncSidebarWeatherCityRow();
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
        const darkMode = readStorageValue('darkMode', base.darkMode ? 'true' : 'false') === 'true';
        const messageScale = clampMessageScale(readStorageValue(MESSAGE_SCALE_STORAGE_KEY, base.messageScale || '1'));
        const performanceMode = normalizePerformanceMode(readStorageValue('sun_performance_mode', base.performanceMode || 'auto'));
        const motionLevel = normalizeMotionLevel(readStorageValue('sun_motion_level', base.motionLevel || 'auto'));

        return {
            darkMode,
            messageScale,
            performanceMode,
            motionLevel,
            sendShortcut: getSendShortcutSelection(),
            timeFormat: getTimeFormatSelection(),
            ...getSidebarWeatherPreferencesFromControls(),
            interfaceThemeStore: window.InterfaceTheme?.readStore?.() || base.interfaceThemeStore || {},
            chatAppearanceStore: window.ChatAppearance?.readStore?.() || base.chatAppearanceStore || {},
        };
    }

    function getCommonPayload() {
        const bioEl = document.getElementById('bioInput');
        const weatherPrefs = getSidebarWeatherPreferencesFromControls();
        return {
            username: document.getElementById('username').value.trim(),
            display_name: document.getElementById('displayName').value.trim(),
            language: (document.getElementById('languageSelect') || {}).value || 'ru',
            bio: bioEl ? bioEl.value.trim().slice(0, 280) : '',
            is_public: document.getElementById('isPublicSwitch').checked,
            auto_decline_requests: document.getElementById('autoDeclineSwitch').checked,
            mute_dialog_requests: document.getElementById('muteDialogRequestsSwitch').checked,
            hide_online_status: document.getElementById('hideOnlineStatusSwitch').checked,
            avatar_visibility: (document.getElementById('avatarVisibilitySelect') || {}).value || 'all',
            group_invite_privacy: (document.getElementById('groupInvitePrivacySelect') || {}).value || 'all',
            send_shortcut: getSendShortcutSelection(),
            time_format: getTimeFormatSelection(),
            sidebar_weather_enabled: weatherPrefs.sidebarWeatherEnabled,
            sidebar_weather_source: weatherPrefs.sidebarWeatherSource,
            sidebar_weather_city: weatherPrefs.sidebarWeatherCity,
            sidebar_weather_rotate_seconds: weatherPrefs.sidebarWeatherRotateSeconds,
        };
    }

    function applySettingsFromPayload(payload) {
        if (!payload || typeof payload !== 'object') return;

        const usernameEl = document.getElementById('username');
        const displayNameEl = document.getElementById('displayName');
        const languageEl = document.getElementById('languageSelect');
        const bioEl = document.getElementById('bioInput');
        const isPublicEl = document.getElementById('isPublicSwitch');
        const hideOnlineEl = document.getElementById('hideOnlineStatusSwitch');
        const autoDeclineEl = document.getElementById('autoDeclineSwitch');
        const muteRequestsEl = document.getElementById('muteDialogRequestsSwitch');
        const avatarVisibilityEl = document.getElementById('avatarVisibilitySelect');
        const groupInvitePrivacyEl = document.getElementById('groupInvitePrivacySelect');

        if (usernameEl && typeof payload.username === 'string') usernameEl.value = payload.username.trim();
        if (displayNameEl && typeof payload.display_name === 'string') displayNameEl.value = payload.display_name.trim();
        if (languageEl) languageEl.value = payload.language === 'en' ? 'en' : 'ru';
        if (bioEl) bioEl.value = String(payload.bio || '').slice(0, 280);
        if (isPublicEl) isPublicEl.checked = !!payload.is_public;
        if (hideOnlineEl) hideOnlineEl.checked = !!payload.hide_online_status;
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

        const rawClientPreferences = payload.client_preferences && typeof payload.client_preferences === 'object'
            ? payload.client_preferences
            : {};
        persistedClientPreferences = { ...rawClientPreferences };
        applySidebarWeatherPreferencesToControls(rawClientPreferences);
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

        if (bioEl && bioCounterEl) {
            bioCounterEl.textContent = `${bioEl.value.length}/280`;
        }
        persistMuteDialogRequestsPreference(!!payload.mute_dialog_requests);
        if (languageEl && i18nApi && typeof i18nApi.setLanguage === 'function') {
            i18nApi.setLanguage(languageEl.value, { persist: true, apply: true });
        }
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
            const payload = await api.saveSettings(requestPayload);
            if (!payload.success) {
                showAlert(`${tr('\u041E\u0448\u0438\u0431\u043A\u0430:')} ${payload.error || ''}`.trim(), 'danger');
                return;
            }
            persistedClientPreferences = { ...(requestPayload.client_preferences || {}) };
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
        document.getElementById('languageSelect'),
        document.getElementById('bioInput'),
        document.getElementById('isPublicSwitch'),
        document.getElementById('hideOnlineStatusSwitch'),
        document.getElementById('autoDeclineSwitch'),
        document.getElementById('muteDialogRequestsSwitch'),
        document.getElementById('avatarVisibilitySelect'),
        document.getElementById('groupInvitePrivacySelect'),
        sendShortcutEnterEl,
        sendShortcutCtrlEnterEl,
        timeFormat12hEl,
        timeFormat24hEl,
        sidebarWeatherEnabledSwitchEl,
        sidebarWeatherSourceSelectEl,
        sidebarWeatherCityInputEl,
        sidebarWeatherRotateSelectEl,
    ].forEach((field) => {
        if (!field) return;
        field.addEventListener('input', () => state.syncDirtyState());
        field.addEventListener('change', () => state.syncDirtyState());
    });

    if (bioInputEl && bioCounterEl) {
        bioInputEl.addEventListener('input', () => {
            bioCounterEl.textContent = `${bioInputEl.value.length}/280`;
        });
    }

    if (languageSelectEl && i18nApi && typeof i18nApi.setLanguage === 'function') {
        languageSelectEl.addEventListener('change', () => {
            const nextLanguage = languageSelectEl.value === 'en' ? 'en' : 'ru';
            i18nApi.setLanguage(nextLanguage, { persist: false, apply: true });
            notifyLanguageUpdate(nextLanguage, false);
            syncTimeFormatSamples();
        });
    }

    animationsEnabledSwitchEl?.addEventListener('change', () => {
        const animationsEnabled = !!animationsEnabledSwitchEl.checked;
        applyMotionPreferences(
            {
                performanceMode: animationsEnabled ? 'full' : 'lite',
                motionLevel: animationsEnabled ? 'full' : 'lite',
            },
            { persist: true, notify: true, syncToggle: true },
        );
    });

    sidebarWeatherEnabledSwitchEl?.addEventListener('change', () => {
        syncSidebarWeatherCityRow();
    });

    sidebarWeatherSourceSelectEl?.addEventListener('change', () => {
        syncSidebarWeatherCityRow();
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
    syncSidebarWeatherCityRow();

    api.getSettings()
        .then((s) => {
            applySettingsFromPayload(s);
            applyAvatarFromSettings(String(s.avatar_url || '').trim());

            state.setLoaded(true);
            setServerSettingsControlsEnabled(true);
            state.setBaseline(getCommonPayload());
            state.syncDirtyState();
            notifyLanguageUpdate(s.language, true);
        })
        .catch(() => {
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
