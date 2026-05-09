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
    applyAvatarFromSettings,
    downloadSettingsQr,
}) {
    const languageSelectEl = document.getElementById('languageSelect');
    const floatingSaveBtn = document.getElementById('settingsFloatingSaveBtn');
    const bioInputEl = document.getElementById('bioInput');
    const bioCounterEl = document.getElementById('bioCounter');

    function getCommonPayload() {
        const bioEl = document.getElementById('bioInput');
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

        if (bioEl && bioCounterEl) {
            bioCounterEl.textContent = `${bioEl.value.length}/280`;
        }
        persistMuteDialogRequestsPreference(!!payload.mute_dialog_requests);
        if (languageEl && i18nApi && typeof i18nApi.setLanguage === 'function') {
            i18nApi.setLanguage(languageEl.value, { persist: true, apply: true });
        }
        state.syncDirtyState();
    }

    async function saveSettings(extraPayload, btn) {
        if (!state.isLoaded() || !state.getBaseline()) {
            showAlert('Дождитесь полной загрузки настроек.', 'warning');
            if (btn) btn.disabled = true;
            return;
        }

        if (btn) btn.disabled = true;
        state.setFloatingSaveSaving(true);

        try {
            const payload = await api.saveSettings(Object.assign(getCommonPayload(), extraPayload || {}));
            if (!payload.success) {
                showAlert(`Error: ${payload.error || ''}`, 'danger');
                return;
            }
            state.setBaseline(getCommonPayload());
            persistMuteDialogRequestsPreference(Boolean(state.getBaseline().mute_dialog_requests));
            if (i18nApi && typeof i18nApi.setLanguage === 'function') {
                i18nApi.setLanguage(state.getBaseline().language, { persist: true, apply: true });
            }
            notifyLanguageUpdate(state.getBaseline().language, true);
            state.syncDirtyState();
            state.animateFloatingSaveSuccess();
        } catch (_err) {
            showAlert('Ошибка сохранения', 'danger');
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
        });
    }

    floatingSaveBtn?.addEventListener('click', function () {
        if (!state.isDirty() || this.disabled) return;
        saveSettings({}, this);
    });

    function copyKey(id, btn) {
        const el = document.getElementById(id);
        if (!el) return;
        navigator.clipboard.writeText(el.value).then(() => {
            const orig = btn.innerHTML;
            btn.innerHTML = `<span class="sun-check-glyph sun-check-glyph--single sun-check-glyph--ui" aria-hidden="true"><svg viewBox="0 0 10 10" focusable="false"><path d="M1.2 5.2L4 8L8.8 2.2"></path></svg></span> ${tr('Copied!')}`;
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
            showAlert('Не удалось загрузить настройки. Перезагрузите страницу.', 'danger');
        })
        .finally(markSettingsReady);

    return {
        getCommonPayload,
        applySettingsFromPayload,
        saveSettings,
    };
}
