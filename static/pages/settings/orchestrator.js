import { getCsrfToken } from '../../modules/csrf.js';
import { showConfirmDialog } from '../../modules/confirm-dialog.js';
import { withAppRoot } from '../../modules/app-url.js';
import * as ChatIdb from '../../modules/chat-idb.js';
import {
    clearPrivateKeyPem,
    stagePrivateKeyForRedirect,
} from '../../modules/private-key-session.js';
import { hasRuntimePrivateKey } from '../../modules/private-key-runtime.js';
import { waitForMotionEnd } from '../../modules/motion.js';
import { initSettingsPresence } from '../../modules/settings-presence.js';
import { initSettingsQr, downloadSettingsQr } from '../settings-qr.js';
import { initSettingsPremiumUX } from '../../modules/settings-premium-ux.js';

import { createSettingsState } from './state.js';
import { createSettingsApi } from './api.js';
import { initProfileSection } from './profile-section.js';
import { initPrivacySection } from './privacy-section.js';
import { initTotpSection } from './totp-section.js';
import { initDevicesSection } from './devices-section.js';
import { initThemeSection } from './theme-section.js';
import { initSettingsNavShell } from './nav-shell.js';
import { initMnemonicSection } from './mnemonic-section.js';
import { initAccountDangerSection } from './account-danger-section.js';
import { initNotificationsSection } from './notifications-section.js';
import { initSettingsTransferSection } from './settings-transfer-section.js';
import { initDataMemorySection } from './data-memory-section.js';
import { initSecuritySummarySection } from './security-summary-section.js';
import { initProfilePullExpand } from './profile-pull-expand.js';
import { initSpotifySection } from './spotify-section.js';

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

export function initSettingsPage() {
    const pageRoot = document.body;
    const bootstrapData = window.SUN_BOOTSTRAP || {};
    const bootstrapUser = bootstrapData.user || {};
    const i18nApi = window.SUN_I18N || null;

    const tr = (value) => {
        if (!i18nApi || typeof i18nApi.translateText !== 'function') {
            return String(value ?? '');
        }
        return i18nApi.translateText(value);
    };

    const uiLocale = () => {
        const lang = i18nApi && typeof i18nApi.getLanguage === 'function'
            ? i18nApi.getLanguage()
            : (document.documentElement.lang || 'ru');
        return lang === 'en' ? 'en-US' : 'ru-RU';
    };

    const isEmbedMode = true;
    const currentUsername = String(bootstrapUser.currentUsername || pageRoot.dataset.currentUsername || '');
    initSettingsPresence({ isEmbedded: true });
    initProfilePullExpand();
    initSettingsPremiumUX(document);

    const dispatch = (type, detail = {}) => {
        document.dispatchEvent(new CustomEvent(type, { detail, bubbles: false }));
    };

    const closeEmbeddedSettings = () => {
        dispatch('sun-settings-close');
    };

    const notifyParent = (type, detail = {}) => {
        dispatch(type, detail);
    };

    const notifyLanguageUpdate = (language, persisted = false) => {
        dispatch('sun-settings-language-updated', {
            language: language === 'en' ? 'en' : 'ru',
            persisted: !!persisted,
        });
    };

    const MUTE_DIALOG_REQUESTS_STORAGE_KEY = 'sun_mute_dialog_requests_v1';
    const persistMuteDialogRequestsPreference = (muted) => {
        try {
            window.localStorage.setItem(MUTE_DIALOG_REQUESTS_STORAGE_KEY, muted ? '1' : '0');
        } catch (_) {}
        dispatch('sun-settings-mute-dialog-requests-updated', { muted: !!muted });
    };

    const navigateOut = (url) => {
        window.location.href = withAppRoot(url);
    };

    const reloadSettingsSurface = () => {
        dispatch('sun-settings-redecrypt');
    };

    let settingsReadyMarked = false;
    const markSettingsReady = () => {
        if (settingsReadyMarked) return;
        settingsReadyMarked = true;
        const panelScene = document.getElementById('settingsPanelScene');
        if (panelScene) {
            panelScene.classList.remove('settings-loading');
            panelScene.classList.add('settings-ready');
        }
        dispatch('sun-settings-ready');
    };
    window.setTimeout(markSettingsReady, 2200);

    const floatingSaveBtn = document.getElementById('settingsFloatingSaveBtn');

    let getCommonPayloadRef = () => ({});
    const state = createSettingsState({
        getCommonPayload: () => getCommonPayloadRef(),
        floatingSaveBtn,
    });

    const api = createSettingsApi({ withAppRoot, getCsrfToken });

    const closeSettingsSurface = async () => {
        if (state.isDirty()) {
            const ok = await showConfirmDialog({
                title: tr('Отменить несохранённые изменения?'),
                confirmText: tr('Отменить изменения'),
                cancelText: tr('Остаться'),
                variant: 'warning',
            });
            if (!ok) return;
        }
        if (isEmbedMode) {
            closeEmbeddedSettings();
            return;
        }
        navigateOut('/chat');
    };

    document.getElementById('settingsPanelCloseBtn')?.addEventListener('click', closeSettingsSurface);
    document.getElementById('settingsPanelEscHint')?.addEventListener('click', closeSettingsSurface);

    const serverSettingFieldEls = [
        document.getElementById('displayName'),
        document.getElementById('username'),
        ...Array.from(document.querySelectorAll('[data-language-option]')),
        document.getElementById('bioInput'),
        document.getElementById('isPublicSwitch'),
        document.getElementById('hideOnlineStatusSwitch'),
        document.getElementById('lastSeenVisibilitySelect'),
        document.getElementById('autoDeclineSwitch'),
        document.getElementById('muteDialogRequestsSwitch'),
        document.getElementById('avatarVisibilitySelect'),
        document.getElementById('bioVisibilitySelect'),
        document.getElementById('forwardLinkPrivacySelect'),
        document.getElementById('avatarFileInput'),
        document.getElementById('groupInvitePrivacySelect'),
        document.getElementById('voiceMessagePrivacySelect'),
        document.getElementById('messagePrivacySelect'),
        document.getElementById('sendShortcutEnterOption'),
        document.getElementById('sendShortcutCtrlEnterOption'),
        document.getElementById('timeFormat12hOption'),
        document.getElementById('timeFormat24hOption'),
        document.getElementById('animationsEnabledSwitch'),
        document.getElementById('sidebarWeatherEnabledSwitch'),
        document.getElementById('sidebarWeatherSourceSelect'),
        document.getElementById('sidebarWeatherCityInput'),
        document.getElementById('sidebarWeatherRotateSelect'),
        document.getElementById('sidebarWeatherMetricTemperature'),
        document.getElementById('sidebarWeatherMetricFeelsLike'),
        document.getElementById('sidebarWeatherMetricHumidity'),
        document.getElementById('sidebarWeatherMetricWind'),
        document.getElementById('sidebarWeatherMetricPrecip'),
        document.getElementById('sidebarWeatherMetricUv'),
        document.getElementById('sidebarWeatherMetricAqi'),
        document.getElementById('sidebarWeatherMetricPressure'),
        document.getElementById('sidebarWeatherMetricSunCycle'),
    ];

    const avatarUploadLabel = document.getElementById('avatarUploadLabel');

    function setServerSettingsControlsEnabled(enabled) {
        serverSettingFieldEls.forEach((field) => {
            if (!field) return;
            field.disabled = !enabled;
        });
        if (avatarUploadLabel) {
            avatarUploadLabel.style.opacity = enabled ? '' : '0.55';
            avatarUploadLabel.style.pointerEvents = enabled ? '' : 'none';
            avatarUploadLabel.setAttribute('aria-disabled', enabled ? 'false' : 'true');
        }
        if (floatingSaveBtn) {
            floatingSaveBtn.disabled = !enabled;
            floatingSaveBtn.classList.remove('is-visible', 'is-saving', 'is-saved');
            floatingSaveBtn.hidden = true;
        }
    }

    function showAlert(msg, type) {
        const el = document.getElementById('settingsAlert');
        if (!el) return;
        const safeType = type === 'success' || type === 'warning' || type === 'danger' ? type : 'danger';
        const icon = safeType === 'success' ? 'check-square' : safeType === 'warning' ? 'warning' : 'x-circle';
        const alert = document.createElement('div');
        alert.className = `settings-alert ${safeType}`;
        const iconEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        iconEl.setAttribute('class', 'sun-icon');
        iconEl.setAttribute('aria-hidden', 'true');
        const useEl = document.createElementNS('http://www.w3.org/2000/svg', 'use');
        useEl.setAttribute('href', `#sun-i-${icon}`);
        iconEl.appendChild(useEl);
        const textEl = document.createElement('span');
        textEl.textContent = tr(msg);
        alert.appendChild(iconEl);
        alert.appendChild(document.createTextNode(' '));
        alert.appendChild(textEl);
        el.replaceChildren(alert);
        el.style.display = 'block';
        setTimeout(() => {
            alert.classList.add('is-hiding');
            waitForMotionEnd(alert, 230).then(() => {
                if (el.contains(alert)) el.style.display = 'none';
            });
        }, 4000);
    }

    const profileSection = initProfileSection({
        api,
        tr,
        notifyParent,
        currentUsername,
        getLatestUploadedAvatarUrl: state.getLatestUploadedAvatarUrl,
        setLatestUploadedAvatarUrl: state.setLatestUploadedAvatarUrl,
        onFieldDirtyChange: () => state.syncDirtyState(),
    });

    const privacySection = initPrivacySection({
        api,
        tr,
        i18nApi,
        showAlert,
        state,
        setServerSettingsControlsEnabled,
        markSettingsReady,
        persistMuteDialogRequestsPreference,
        notifyLanguageUpdate,
        notifyMotionUpdate: (detail) => notifyParent('sun-settings-motion-updated', detail || {}),
        notifyWeatherLabelUpdate: (detail) => notifyParent('sun-settings-weather-label-updated', detail || {}),
        applyAvatarFromSettings: profileSection.applyAvatarFromSettings,
        downloadSettingsQr,
    });
    getCommonPayloadRef = privacySection.getCommonPayload;

    initThemeSection({
        tr,
        notifyParent,
        showAlert,
        chatAppearanceApi: window.ChatAppearance || null,
        interfaceThemeApi: window.InterfaceTheme || null,
        persistClientPreferences: (clientPreferences, requestOptions = {}) => api.saveSettings({
            client_preferences: clientPreferences,
        }, requestOptions),
    });

    const devicesSection = initDevicesSection({
        api,
        tr,
        escapeHtml,
        showAlert,
        navigateOut,
        uiLocale,
        doLogout: async () => {
            try { await api.logout(); } catch (_) {}
            navigateOut('/');
        },
    });

    initTotpSection({ api, tr, showAlert, uiLocale });
    initSecuritySummarySection({ tr });
    initNotificationsSection({ api, tr, showAlert });
    initDataMemorySection({
        tr,
        showAlert,
        currentUserId: String(bootstrapUser.currentUserId || pageRoot.dataset.currentUserId || '').trim(),
    });

    const settingsSupportSubmitBtn = document.getElementById('settingsSupportSubmitBtn');
    const settingsSupportOpenPageBtn = document.getElementById('settingsSupportOpenPageBtn');
    const settingsSupportStatus = document.getElementById('settingsSupportStatus');
    const settingsSupportCategory = document.getElementById('settingsSupportCategory');
    const settingsSupportContact = document.getElementById('settingsSupportContact');
    const settingsSupportSubject = document.getElementById('settingsSupportSubject');
    const settingsSupportBody = document.getElementById('settingsSupportBody');

    const setSupportStatus = (text, mode = 'info') => {
        if (!settingsSupportStatus) return;
        settingsSupportStatus.textContent = tr(text || '');
        settingsSupportStatus.style.color = mode === 'error'
            ? '#a3322c'
            : mode === 'success'
                ? '#1f7a36'
                : 'var(--sub-text)';
    };

    settingsSupportOpenPageBtn?.addEventListener('click', () => {
        window.open(withAppRoot('/support/feedback'), '_blank', 'noopener');
    });

    settingsSupportSubmitBtn?.addEventListener('click', async () => {
        const subject = String(settingsSupportSubject?.value || '').trim();
        const message = String(settingsSupportBody?.value || '').trim();
        if (!subject) {
            setSupportStatus('Укажите тему обращения.', 'error');
            return;
        }
        if (!message) {
            setSupportStatus('Добавьте описание проблемы или вопроса.', 'error');
            return;
        }

        settingsSupportSubmitBtn.disabled = true;
        setSupportStatus('Отправка...');
        try {
            const response = await fetch(withAppRoot('/api/support/requests'), {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({
                    source_page: 'settings',
                    category: String(settingsSupportCategory?.value || 'other'),
                    contact_handle: String(settingsSupportContact?.value || ''),
                    subject,
                    message,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.success) {
                setSupportStatus(data.error || 'Не удалось отправить обращение.', 'error');
                return;
            }
            setSupportStatus(`${tr('Обращение отправлено')} (#${data.request_id}).`, 'success');
            if (settingsSupportSubject) settingsSupportSubject.value = '';
            if (settingsSupportBody) settingsSupportBody.value = '';
        } catch (_error) {
            setSupportStatus('Сетевая ошибка при отправке обращения.', 'error');
        } finally {
            settingsSupportSubmitBtn.disabled = false;
        }
    });

    initSettingsTransferSection({
        tr,
        showAlert,
        api,
        privacySection,
        notifyLanguageUpdate,
    });

    setServerSettingsControlsEnabled(false);

    initSettingsNavShell({
        tr,
        state,
        initSettingsQr,
        loadSessionDevices: devicesSection.loadSessionDevices,
        closeSettingsSurface,
    });

    const logoutLinks = document.querySelectorAll('[data-logout-trigger]');
    if (logoutLinks.length) {
        logoutLinks.forEach((trigger) => {
            trigger.addEventListener('click', async (event) => {
                event.preventDefault();
                let logoutRequestFailed = false;
                try {
                    await api.logout();
                } catch (_err) {
                    logoutRequestFailed = true;
                }

                await clearPrivateKeyPem({
                    notify: true,
                    clearWrappedSession: true,
                    clearWrappedPersistent: true,
                    clearDeviceKey: true,
                });

                try {
                    const fallbackUserId = String(
                        bootstrapUser.currentUserId
                        || document.body?.dataset?.currentUserId
                        || localStorage.getItem('last_user_id')
                        || '',
                    ).trim();
                    await ChatIdb.clearAllCache();
                    if (fallbackUserId) {
                        await ChatIdb.deleteChatDb(fallbackUserId);
                    }
                    localStorage.removeItem('last_user_id');
                } catch (_) {}

                if (logoutRequestFailed) {
                    const logoutForm = trigger.closest('form');
                    if (logoutForm && typeof logoutForm.submit === 'function') {
                        logoutForm.submit();
                        return;
                    }
                }

                navigateOut('/');
            });
        });
    }

    initMnemonicSection({
        api,
        tr,
        showAlert,
        isEmbedMode,
        reloadSettingsSurface,
        stagePrivateKeyForRedirect,
        hasRuntimePrivateKey,
    });

    initAccountDangerSection({
        api,
        tr,
        currentUsername,
        navigateOut,
        showAlert,
    });

    initSpotifySection();

    initHomeMetaSync({ tr, i18nApi });
}

/**
 * Populate the home-list nav items' `data-meta` attribute (right-aligned
 * value shown next to the row title in the redesigned home view).
 *
 * Reads from existing DOM state and public APIs so we don't need to refactor
 * each section to expose its current value. Re-runs whenever a relevant input
 * changes (theme, language, toggles, totp).
 */
function initHomeMetaSync({ tr, i18nApi }) {
    const PLACEHOLDER = '—';

    const setMeta = (id, value) => {
        const el = document.getElementById(id);
        if (!el) return;
        const text = value == null || value === '' ? PLACEHOLDER : String(value);
        if (el.getAttribute('data-meta') !== text) {
            el.setAttribute('data-meta', text);
        }
    };

    const readLanguageLabel = () => {
        const lang = i18nApi && typeof i18nApi.getLanguage === 'function'
            ? i18nApi.getLanguage()
            : (document.documentElement.lang || 'ru');
        return lang === 'en' ? 'English' : 'Русский';
    };

    const readThemeLabel = () => {
        try {
            const api = window.InterfaceTheme;
            const isDark = document.body.classList.contains('dark-mode');
            const themeKey = isDark ? 'dark' : 'light';
            if (api && typeof api.getActivePreset === 'function') {
                const preset = api.getActivePreset(themeKey);
                if (preset && preset.label) return tr(preset.label);
                if (preset && preset.id) return tr(preset.id);
            }
            return tr(isDark ? 'Тёмная' : 'Светлая');
        } catch (_) {
            return PLACEHOLDER;
        }
    };

    const readTotpLabel = () => {
        const el = document.getElementById('totpStatusText');
        const raw = (el?.textContent || '').trim().toLowerCase();
        if (!raw) return tr('2FA · выкл');
        if (raw.includes('вкл') || raw.includes('on') || raw.includes('enabled')) return tr('2FA · вкл');
        return tr('2FA · выкл');
    };

    const readPrivacyLabel = () => {
        const sel = document.getElementById('avatarVisibilitySelect');
        if (!sel) return PLACEHOLDER;
        const opt = sel.options?.[sel.selectedIndex];
        return opt ? opt.textContent.trim() : PLACEHOLDER;
    };

    const readSendModeLabel = () => {
        const input = document.querySelector('input[name="chatSendMode"]:checked, input[name="sendMode"]:checked');
        if (!input) return tr('Enter — отправить');
        const v = String(input.value || '').toLowerCase();
        return v.includes('ctrl') ? tr('Ctrl+Enter') : tr('Enter');
    };

    const readDevicesLabel = () => {
        const list = document.getElementById('sessionDevicesList');
        if (!list) return PLACEHOLDER;
        const items = list.querySelectorAll('.session-device-item');
        const n = items.length;
        if (!n) return PLACEHOLDER;
        const word = n === 1 ? tr('активная') : (n < 5 ? tr('активных') : tr('активных'));
        return `${n} ${word}`;
    };

    const readDataMemoryLabel = () => {
        const el = document.querySelector('#cacheSizeValue, [data-cache-size]');
        const txt = (el?.textContent || '').trim();
        return txt || PLACEHOLDER;
    };

    const syncAll = () => {
        setMeta('navMetaNotifications', tr('Push для браузера'));
        setMeta('navMetaDataMemory', readDataMemoryLabel());
        setMeta('navMetaPrivacy', readPrivacyLabel());
        setMeta('navMetaSecurity', readTotpLabel());
        setMeta('navMetaAppearance', readThemeLabel());
        setMeta('navMetaLanguage', readLanguageLabel());
        setMeta('navMetaBehavior', readSendModeLabel());
        setMeta('navMetaDevices', readDevicesLabel());
    };

    // First pass + a few delayed passes so async sections finish loading
    syncAll();
    setTimeout(syncAll, 300);
    setTimeout(syncAll, 1500);

    // React to relevant changes
    document.addEventListener('change', (e) => {
        const t = e.target;
        if (!t) return;
        if (t.id === 'avatarVisibilitySelect'
            || (t.name && /sendMode|chatSendMode/i.test(t.name))) {
            syncAll();
        }
    }, true);

    document.addEventListener('sun-theme-changed', syncAll);
    document.addEventListener('sun-language-changed', syncAll);
    document.addEventListener('sun-settings-refresh', syncAll);

    // MutationObserver on body class for dark-mode toggle
    const bodyObserver = new MutationObserver(syncAll);
    bodyObserver.observe(document.body, { attributes: true, attributeFilter: ['class', 'data-ui-language'] });
}
