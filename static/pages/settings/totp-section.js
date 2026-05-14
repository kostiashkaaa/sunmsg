import { showConfirmDialog } from '../../modules/confirm-dialog.js';

export function initTotpSection({
    api,
    tr,
    showAlert,
    uiLocale,
}) {
    const totpStatusTextEl = document.getElementById('totpStatusText');
    const totpEnableBtn = document.getElementById('totpEnableBtn');
    const totpDisableBtn = document.getElementById('totpDisableBtn');
    const totpRegenerateBtn = document.getElementById('totpRegenerateBtn');
    const totpSetupPanel = document.getElementById('totpSetupPanel');
    const totpSettingsSecret = document.getElementById('totpSettingsSecret');
    const totpSettingsQrContainer = document.getElementById('totpSettingsQrContainer');
    const totpEnabledAtTextEl = document.getElementById('totpEnabledAtText');
    const totpVerifyPanel = document.getElementById('totpVerifyPanel');
    const totpVerifyCodeInput = document.getElementById('totpVerifyCode');
    const totpVerifyBtn = document.getElementById('totpVerifyBtn');
    const totpBackupCodesPanel = document.getElementById('totpBackupCodesPanel');
    const totpBackupCodesRemainingEl = document.getElementById('totpBackupCodesRemaining');
    const totpShowBackupCodesBtn = document.getElementById('totpShowBackupCodesBtn');
    const totpBackupCodesList = document.getElementById('totpBackupCodesList');
    const totpRegenerateBackupPanel = document.getElementById('totpRegenerateBackupPanel');
    const totpRegenerateBackupCodeInput = document.getElementById('totpRegenerateBackupCode');
    const totpRegenerateBackupConfirmBtn = document.getElementById('totpRegenerateBackupConfirmBtn');
    const totpNewBackupCodesPanel = document.getElementById('totpNewBackupCodesPanel');
    const totpNewBackupCodesList = document.getElementById('totpNewBackupCodesList');
    const totpCopyBackupCodesBtn = document.getElementById('totpCopyBackupCodesBtn');
    const totpBackupCodesDoneBtn = document.getElementById('totpBackupCodesDoneBtn');

    if (!totpStatusTextEl) {
        return {
            loadTotpStatus: async () => {},
        };
    }

    function setTotpButtonsDisabled(disabled) {
        [totpEnableBtn, totpDisableBtn, totpRegenerateBtn].forEach((btn) => {
            if (!btn) return;
            btn.disabled = !!disabled;
        });
    }

    function setTotpVerifyDisabled(disabled) {
        if (totpVerifyBtn) totpVerifyBtn.disabled = !!disabled;
        if (totpVerifyCodeInput) totpVerifyCodeInput.disabled = !!disabled;
    }

    function toggleTotpVerifyPanel(visible) {
        if (!totpVerifyPanel) return;
        totpVerifyPanel.style.display = visible ? 'block' : 'none';
        if (!visible && totpVerifyCodeInput) {
            totpVerifyCodeInput.value = '';
        }
    }

    function formatUiTimestamp(rawValue) {
        const text = String(rawValue || '').trim();
        if (!text) return tr('неизвестно');
        const date = new Date(text);
        if (Number.isNaN(date.getTime())) return tr('неизвестно');
        return date.toLocaleString(uiLocale(), {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    function renderTotpState(enabled, enabledAtRaw = '', setupPending = false) {
        const isEnabled = !!enabled;
        if (!isEnabled && setupPending) {
            totpStatusTextEl.textContent = tr('ожидает подтверждения');
        } else {
            totpStatusTextEl.textContent = isEnabled ? tr('включен') : tr('выключен');
        }

        if (totpEnabledAtTextEl) {
            if (isEnabled) {
                totpEnabledAtTextEl.textContent = `${tr('Подключено:')} ${formatUiTimestamp(enabledAtRaw)}`;
                totpEnabledAtTextEl.style.display = 'block';
            } else {
                totpEnabledAtTextEl.textContent = '';
                totpEnabledAtTextEl.style.display = 'none';
            }
        }

        if (totpEnableBtn) totpEnableBtn.style.display = isEnabled ? 'none' : 'inline-block';
        if (totpDisableBtn) totpDisableBtn.style.display = isEnabled ? 'inline-block' : 'none';
        if (totpRegenerateBtn) totpRegenerateBtn.style.display = isEnabled ? 'inline-block' : 'none';
        toggleTotpVerifyPanel(!!setupPending);
        if (totpBackupCodesPanel) {
            totpBackupCodesPanel.style.display = isEnabled && !setupPending ? 'block' : 'none';
        }
    }

    function renderBackupCodesRemaining(count) {
        if (!totpBackupCodesRemainingEl) return;
        totpBackupCodesRemainingEl.textContent = `Осталось неиспользованных: ${count} из 10`;
    }

    function renderBackupCodesList(codes, containerEl) {
        if (!containerEl) return;
        containerEl.replaceChildren();
        const grid = document.createElement('div');
        grid.className = 'totp-backup-codes-grid';
        (codes || []).forEach((code) => {
            const span = document.createElement('code');
            span.className = 'totp-backup-code-item';
            span.textContent = String(code);
            grid.appendChild(span);
        });
        containerEl.appendChild(grid);
        containerEl.style.display = 'block';
    }

    function showNewBackupCodes(codes) {
        if (!totpNewBackupCodesPanel) return;
        renderBackupCodesList(codes, totpNewBackupCodesList);
        totpNewBackupCodesPanel.style.display = 'block';
        if (totpBackupCodesPanel) totpBackupCodesPanel.style.display = 'none';
    }

    async function renderTotpSetup(secret, uri) {
        if (!totpSetupPanel || !totpSettingsSecret || !totpSettingsQrContainer) return;
        const secretText = String(secret || '').trim();
        const uriText = String(uri || '').trim();
        if (!secretText || !uriText) {
            totpSetupPanel.style.display = 'none';
            return;
        }
        totpSettingsSecret.textContent = secretText;
        totpSetupPanel.style.display = 'block';
        totpSettingsQrContainer.replaceChildren();
        try {
            await window.ensureQrCodeLibrary();
            new QRCode(totpSettingsQrContainer, {
                text: uriText,
                width: 140,
                height: 140,
                colorDark: '#1a1a2e',
                colorLight: '#ffffff',
                correctLevel: QRCode.CorrectLevel.M,
            });
        } catch (_) {
            totpSettingsQrContainer.textContent = tr('Не удалось построить QR-код');
        }
    }

    async function loadTotpStatus() {
        setTotpButtonsDisabled(true);
        setTotpVerifyDisabled(true);
        totpStatusTextEl.textContent = tr('загрузка...');
        try {
            const payload = await api.getTotpStatus();
            const setupPending = !!payload.setup_pending;
            renderTotpState(!!payload.enabled, payload.totp_enabled_at, setupPending);
            await renderTotpSetup(setupPending ? payload.totp_secret : '', setupPending ? payload.totp_uri : '');
            if (payload.enabled && !setupPending) {
                renderBackupCodesRemaining(Number(payload.backup_codes_remaining ?? 0));
            }
        } catch (_err) {
            totpStatusTextEl.textContent = tr('неизвестно');
            showAlert('Не удалось загрузить состояние TOTP.', 'danger');
        } finally {
            setTotpButtonsDisabled(false);
            setTotpVerifyDisabled(false);
        }
    }

    async function submitTotpAction(action, { askConfirm = false } = {}) {
        if (askConfirm) {
            const ok = await showConfirmDialog({
                title: tr('Подтвердите действие'),
                confirmText: tr('Подтвердить'),
                cancelText: tr('Отмена'),
                variant: 'warning',
            });
            if (!ok) return;
        }
        setTotpButtonsDisabled(true);
        setTotpVerifyDisabled(true);
        try {
            const payload = await api.manageTotp(action);
            renderTotpState(!!payload.enabled, payload.totp_enabled_at, !!payload.setup_pending);
            if (action === 'disable') {
                await renderTotpSetup('', '');
                showAlert('TOTP отключен.', 'success');
                return;
            }
            await renderTotpSetup(payload.totp_secret, payload.totp_uri);
            showAlert(
                action === 'enable'
                    ? 'Отсканируйте QR и подтвердите 6-значный код.'
                    : 'Новый TOTP-секрет готов. Подтвердите его 6-значным кодом.',
                'success',
            );
        } catch (err) {
            showAlert(String(err?.message || 'Ошибка TOTP.'), 'danger');
        } finally {
            setTotpButtonsDisabled(false);
            setTotpVerifyDisabled(false);
        }
    }

    async function submitTotpSetupVerify() {
        if (!totpVerifyCodeInput) return;
        const code = String(totpVerifyCodeInput.value || '').replace(/\D+/g, '').slice(0, 6);
        totpVerifyCodeInput.value = code;
        if (code.length !== 6) {
            showAlert('Введите 6-значный код из Authenticator.', 'warning');
            return;
        }

        setTotpButtonsDisabled(true);
        setTotpVerifyDisabled(true);
        try {
            const payload = await api.verifyTotpSetup(code);
            renderTotpState(true, payload.totp_enabled_at, false);
            await renderTotpSetup('', '');
            if (payload.backup_codes && payload.backup_codes.length) {
                showNewBackupCodes(payload.backup_codes);
                renderBackupCodesRemaining(payload.backup_codes.length);
            } else {
                showAlert('Настройка подтверждена успешно.', 'success');
            }
        } catch (err) {
            showAlert(String(err?.message || 'Ошибка подтверждения TOTP.'), 'danger');
        } finally {
            setTotpButtonsDisabled(false);
            setTotpVerifyDisabled(false);
        }
    }

    async function submitRegenerateBackupCodes() {
        const code = String(totpRegenerateBackupCodeInput?.value || '').replace(/\D+/g, '').slice(0, 6);
        if (code.length !== 6) {
            showAlert('Введите 6-значный код из Authenticator.', 'warning');
            return;
        }
        if (totpRegenerateBackupConfirmBtn) totpRegenerateBackupConfirmBtn.disabled = true;
        try {
            const payload = await api.regenerateBackupCodes(code);
            if (totpRegenerateBackupPanel) totpRegenerateBackupPanel.style.display = 'none';
            if (totpRegenerateBackupCodeInput) totpRegenerateBackupCodeInput.value = '';
            showNewBackupCodes(payload.backup_codes);
            renderBackupCodesRemaining(payload.backup_codes.length);
        } catch (err) {
            showAlert(String(err?.message || 'Ошибка обновления кодов.'), 'danger');
        } finally {
            if (totpRegenerateBackupConfirmBtn) totpRegenerateBackupConfirmBtn.disabled = false;
        }
    }

    totpShowBackupCodesBtn?.addEventListener('click', () => {
        if (!totpRegenerateBackupPanel) return;
        const isVisible = totpRegenerateBackupPanel.style.display === 'block';
        totpRegenerateBackupPanel.style.display = isVisible ? 'none' : 'block';
        if (!isVisible && totpBackupCodesList) totpBackupCodesList.style.display = 'none';
    });

    totpRegenerateBackupConfirmBtn?.addEventListener('click', submitRegenerateBackupCodes);
    totpRegenerateBackupCodeInput?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); submitRegenerateBackupCodes(); }
    });

    totpCopyBackupCodesBtn?.addEventListener('click', () => {
        const codes = Array.from(totpNewBackupCodesList?.querySelectorAll('.totp-backup-code-item') || [])
            .map((el) => el.textContent).join('\n');
        navigator.clipboard?.writeText(codes).catch(() => {});
        showAlert('Коды скопированы.', 'success');
    });

    totpBackupCodesDoneBtn?.addEventListener('click', () => {
        if (totpNewBackupCodesPanel) totpNewBackupCodesPanel.style.display = 'none';
        if (totpBackupCodesPanel) totpBackupCodesPanel.style.display = 'block';
    });

    totpEnableBtn?.addEventListener('click', () => {
        submitTotpAction('enable');
    });
    totpRegenerateBtn?.addEventListener('click', () => {
        submitTotpAction('regenerate', { askConfirm: true });
    });
    totpDisableBtn?.addEventListener('click', () => {
        submitTotpAction('disable', { askConfirm: true });
    });
    if (totpVerifyCodeInput) {
        totpVerifyCodeInput.addEventListener('input', () => {
            totpVerifyCodeInput.value = String(totpVerifyCodeInput.value || '').replace(/\D+/g, '').slice(0, 6);
        });
        totpVerifyCodeInput.addEventListener('keydown', (event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            submitTotpSetupVerify();
        });
    }
    totpVerifyBtn?.addEventListener('click', submitTotpSetupVerify);

    loadTotpStatus();

    return {
        loadTotpStatus,
    };
}
