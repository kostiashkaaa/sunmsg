import { showConfirmDialog } from '../../modules/confirm-dialog.js';

export function initDevicesSection({
    api,
    tr,
    escapeHtml,
    showAlert,
    navigateOut,
    uiLocale,
}) {
    const sessionDevicesListEl = document.getElementById('sessionDevicesList');
    const signOutOtherSessionsBtn = document.getElementById('signOutOtherSessionsBtn');

    function formatSessionTimestamp(ts) {
        const value = Number(ts || 0);
        if (!Number.isFinite(value) || value <= 0) return tr('неизвестно');
        const date = new Date(value * 1000);
        return date.toLocaleString(uiLocale(), {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    function describeUserAgent(ua, persistent) {
        const raw = String(ua || '').trim();
        if (!raw) return persistent ? tr('Сохранённое устройство') : tr('Текущая веб-сессия');
        if (/iphone|ipad|ios/i.test(raw)) return 'iPhone / iPad';
        if (/android/i.test(raw)) return 'Android';
        if (/mac os x|macintosh/i.test(raw)) return 'macOS';
        if (/windows/i.test(raw)) return 'Windows';
        if (/linux/i.test(raw)) return 'Linux';
        return raw.slice(0, 80);
    }

    async function loadSessionDevices() {
        if (!sessionDevicesListEl) return;
        sessionDevicesListEl.innerHTML = `<div class="session-device-empty">${escapeHtml(tr('Загружаем активные сессии…'))}</div>`;
        try {
            const data = await api.getSessionDevices();
            const devices = Array.isArray(data.devices) ? data.devices : [];
            if (!devices.length) {
                sessionDevicesListEl.innerHTML = `<div class="session-device-empty">${escapeHtml(tr('Активных сессий не найдено.'))}</div>`;
                return;
            }
            sessionDevicesListEl.innerHTML = devices.map((device) => {
                const label = describeUserAgent(device.user_agent, device.persistent);
                const location = device.ip ? `IP ${escapeHtml(device.ip)}` : escapeHtml(tr('IP скрыт'));
                const persistentLabel = device.persistent ? '30 days' : 'Session only';
                return `
                    <div class="session-device-item">
                        <div class="session-device-main">
                            <div class="session-device-name">
                                <span>${escapeHtml(label)}</span>
                                ${device.is_current ? '<span class="session-device-pill">Current</span>' : ''}
                                <span class="session-device-pill">${escapeHtml(persistentLabel)}</span>
                            </div>
                            <div class="session-device-meta">
                                ${escapeHtml(tr('Последняя активность:'))} ${escapeHtml(formatSessionTimestamp(device.last_used_at))}<br>
                                ${location}
                            </div>
                        </div>
                        ${device.family_id
                            ? `<button type="button" class="btn-settings secondary session-revoke-btn" data-family-id="${escapeHtml(device.family_id)}" data-current="${device.is_current ? '1' : '0'}">
                                ${escapeHtml(tr(device.is_current ? 'Выйти' : 'Завершить'))}
                            </button>`
                            : '<span class="session-device-pill">Web</span>'
                        }
                    </div>
                `;
            }).join('');
        } catch (_err) {
            sessionDevicesListEl.innerHTML = `<div class="session-device-empty">${escapeHtml(tr('Сетевая ошибка при загрузке сессий.'))}</div>`;
        }
    }

    sessionDevicesListEl?.addEventListener('click', async (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const btn = target.closest('.session-revoke-btn');
        if (!btn) return;
        const familyId = btn.getAttribute('data-family-id');
        const isCurrent = btn.getAttribute('data-current') === '1';
        if (!familyId) return;
        const ok = await showConfirmDialog({
            title: tr(isCurrent ? 'Выйти с этого устройства?' : 'Завершить эту сессию?'),
            confirmText: tr(isCurrent ? 'Выйти' : 'Завершить'),
            cancelText: tr('Отмена'),
            variant: 'danger',
        });
        if (!ok) return;

        btn.disabled = true;
        try {
            const data = await api.revokeSessionDevice(familyId);
            if (data.signed_out_current) {
                navigateOut('/');
                return;
            }
            showAlert('Сессия завершена.', 'success');
            await loadSessionDevices();
        } catch (_err) {
            showAlert('Сетевая ошибка при завершении сессии.', 'danger');
        } finally {
            btn.disabled = false;
        }
    });

    signOutOtherSessionsBtn?.addEventListener('click', async function () {
        const ok = await showConfirmDialog({
            title: tr('Завершить все остальные активные сессии?'),
            confirmText: tr('Завершить все'),
            cancelText: tr('Отмена'),
            variant: 'danger',
        });
        if (!ok) return;
        this.disabled = true;
        try {
            await api.revokeOtherSessionDevices();
            showAlert('Остальные сессии завершены.', 'success');
            await loadSessionDevices();
        } catch (_err) {
            showAlert('Сетевая ошибка при завершении остальных сессий.', 'danger');
        } finally {
            this.disabled = false;
        }
    });

    return {
        loadSessionDevices,
    };
}
