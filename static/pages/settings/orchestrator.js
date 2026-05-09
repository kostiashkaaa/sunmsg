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
import { initSettingsQr, downloadSettingsQr } from '../settings-qr.js';

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

    const isEmbedMode = String(bootstrapUser.embedMode ?? pageRoot.dataset.embedMode) === 'true';
    const currentUsername = String(bootstrapUser.currentUsername || pageRoot.dataset.currentUsername || '');

    const closeEmbeddedSettings = () => {
        if (!isEmbedMode || window.parent === window) return;
        window.parent.postMessage({ type: 'sun-settings-close' }, window.location.origin);
    };

    const notifyParent = (type, detail = {}) => {
        if (!isEmbedMode || window.parent === window) return;
        window.parent.postMessage({ type, detail }, window.location.origin);
    };

    const notifyLanguageUpdate = (language, persisted = false) => {
        notifyParent('sun-settings-language-updated', {
            language: language === 'en' ? 'en' : 'ru',
            persisted: !!persisted,
        });
    };

    const MUTE_DIALOG_REQUESTS_STORAGE_KEY = 'sun_mute_dialog_requests_v1';
    const persistMuteDialogRequestsPreference = (muted) => {
        try {
            window.localStorage.setItem(MUTE_DIALOG_REQUESTS_STORAGE_KEY, muted ? '1' : '0');
        } catch (_) {}
        notifyParent('sun-settings-mute-dialog-requests-updated', { muted: !!muted });
    };

    const navigateOut = (url) => {
        const nextUrl = withAppRoot(url);
        if (isEmbedMode && window.top) {
            window.top.location.href = nextUrl;
            return;
        }
        window.location.href = nextUrl;
    };

    const reloadSettingsSurface = () => {
        if (isEmbedMode && window.parent !== window) {
            notifyParent('sun-settings-redecrypt');
            return;
        }
        window.location.reload();
    };

    let settingsReadyMarked = false;
    const markSettingsReady = () => {
        if (settingsReadyMarked) return;
        settingsReadyMarked = true;
        document.body.classList.remove('settings-loading');
        document.body.classList.add('settings-ready');
        notifyParent('sun-settings-ready');
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
        document.getElementById('languageSelect'),
        document.getElementById('bioInput'),
        document.getElementById('isPublicSwitch'),
        document.getElementById('hideOnlineStatusSwitch'),
        document.getElementById('autoDeclineSwitch'),
        document.getElementById('muteDialogRequestsSwitch'),
        document.getElementById('avatarVisibilitySelect'),
        document.getElementById('avatarFileInput'),
        document.getElementById('sendShortcutEnterOption'),
        document.getElementById('sendShortcutCtrlEnterOption'),
        document.getElementById('timeFormat12hOption'),
        document.getElementById('timeFormat24hOption'),
        document.getElementById('animationsEnabledSwitch'),
        document.getElementById('sidebarWeatherEnabledSwitch'),
        document.getElementById('sidebarWeatherSourceSelect'),
        document.getElementById('sidebarWeatherCityInput'),
        document.getElementById('sidebarWeatherRotateSelect'),
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
        const icon = safeType === 'success' ? 'check-circle' : safeType === 'warning' ? 'exclamation-triangle' : 'x-circle';
        const alert = document.createElement('div');
        alert.className = `settings-alert ${safeType}`;
        const iconEl = document.createElement('i');
        iconEl.className = `bi bi-${icon}`;
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
        persistClientPreferences: (clientPreferences) => api.saveSettings({
            client_preferences: clientPreferences,
        }),
    });

    const devicesSection = initDevicesSection({
        api,
        tr,
        escapeHtml,
        showAlert,
        navigateOut,
        uiLocale,
    });

    initTotpSection({ api, tr, showAlert, uiLocale });
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
                    clearWrappedSession: false,
                    clearWrappedPersistent: false,
                    clearDeviceKey: false,
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
}
