import { showConfirmDialog } from '../../modules/confirm-dialog.js';

export function initDevicesSection({
    api,
    tr,
    escapeHtml,
    showAlert,
    navigateOut,
    uiLocale,
    doLogout,
}) {
    const sessionDevicesListEl = document.getElementById('sessionDevicesList');
    const signOutOtherSessionsBtn = document.getElementById('signOutOtherSessionsBtn');
    const sessionAutoLogoutSelectEl = document.getElementById('sessionAutoLogoutSelect');
    const sessionAutoLogoutSummaryEl = document.getElementById('sessionAutoLogoutSummary');

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

    function getDeviceInfo(ua, persistent) {
        const raw = String(ua || '').trim();
        if (!raw) {
            return {
                name: persistent ? tr('Сохранённое устройство') : tr('Веб-браузер'),
                icon: 'sun-i-laptop',
                type: 'desktop',
            };
        }
        if (/iphone/i.test(raw)) return { name: 'iPhone', icon: 'sun-i-phone', type: 'mobile' };
        if (/ipad/i.test(raw)) return { name: 'iPad', icon: 'sun-i-tablet', type: 'tablet' };
        if (/android.*mobile|mobile.*android/i.test(raw)) return { name: 'Android', icon: 'sun-i-phone', type: 'mobile' };
        if (/android/i.test(raw)) return { name: 'Android', icon: 'sun-i-tablet', type: 'tablet' };
        if (/mac os x|macintosh/i.test(raw)) return { name: 'macOS', icon: 'sun-i-laptop', type: 'desktop' };
        if (/windows/i.test(raw)) return { name: 'Windows', icon: 'sun-i-laptop', type: 'desktop' };
        if (/linux/i.test(raw)) return { name: 'Linux', icon: 'sun-i-laptop', type: 'desktop' };
        if (/crios|chrome|firefox|safari|opera|edge/i.test(raw)) return { name: 'Браузер', icon: 'sun-i-laptop', type: 'desktop' };
        return { name: raw.slice(0, 60), icon: 'sun-i-devices', type: 'unknown' };
    }

    function getBrowserName(ua) {
        const raw = String(ua || '').trim();
        if (!raw) return '';
        if (/edg\//i.test(raw)) return 'Edge';
        if (/opr\//i.test(raw)) return 'Opera';
        if (/crios/i.test(raw)) return 'Chrome iOS';
        if (/fxios/i.test(raw)) return 'Firefox iOS';
        if (/chrome/i.test(raw)) return 'Chrome';
        if (/firefox/i.test(raw)) return 'Firefox';
        if (/safari/i.test(raw)) return 'Safari';
        return '';
    }

    function _formatExpiry(expiresAt) {
        const now = Math.floor(Date.now() / 1000);
        const diff = Number(expiresAt || 0) - now;
        if (diff <= 0) return tr('истекает');
        const days = Math.ceil(diff / 86400);
        if (days >= 2) return `${days} ${tr('дн.')}`;
        const hours = Math.ceil(diff / 3600);
        if (hours >= 2) return `${hours} ${tr('ч.')}`;
        return tr('< 1 ч.');
    }

    function renderDeviceIcon(iconId) {
        return `<svg class="sun-icon session-device-icon" aria-hidden="true"><use href="#${iconId}"></use></svg>`;
    }

    function optionLabel(option) {
        if (!option) return '';
        return String(uiLocale() || '').startsWith('en')
            ? String(option.label_en || option.label_ru || '')
            : String(option.label_ru || option.label_en || '');
    }

    function applySessionAutoLogout(data) {
        if (!sessionAutoLogoutSelectEl) return;
        const options = Array.isArray(data?.session_auto_logout_options) ? data.session_auto_logout_options : [];
        if (options.length) {
            sessionAutoLogoutSelectEl.innerHTML = options.map((option) => {
                const seconds = Number(option?.seconds || 0);
                if (!Number.isFinite(seconds) || seconds <= 0) return '';
                return `<option value="${String(seconds)}">${escapeHtml(optionLabel(option))}</option>`;
            }).join('');
        }

        const selected = String(Number(data?.session_auto_logout_seconds || 0) || 2592000);
        sessionAutoLogoutSelectEl.value = selected;
        const selectedOption = Array.from(sessionAutoLogoutSelectEl.options).find(option => option.value === selected);
        if (sessionAutoLogoutSummaryEl) {
            const label = selectedOption?.textContent || tr('1 месяц');
            sessionAutoLogoutSummaryEl.textContent = tr('Неактивные устройства будут отключены через:') + ` ${label}`;
        }
        try {
            window.sunPrivateKeySession?.touchPersistentKeyFromSession?.(data);
        } catch (_) {}
    }

    async function loadSessionDevices() {
        if (!sessionDevicesListEl) return;
        sessionDevicesListEl.innerHTML = `<div class="session-device-empty">${escapeHtml(tr('Загружаем активные сессии…'))}</div>`;
        try {
            const data = await api.getSessionDevices();
            applySessionAutoLogout(data);
            const devices = Array.isArray(data.devices) ? data.devices : [];

            if (!devices.length) {
                sessionDevicesListEl.innerHTML = `<div class="session-device-empty">${escapeHtml(tr('Активных сессий не найдено.'))}</div>`;
                updateSignOutBtn(0);
                return;
            }

            const currentDevice = devices.find(d => d.is_current);
            const otherDevices = devices.filter(d => !d.is_current);

            const sections = [];

            if (currentDevice) {
                sections.push(renderDeviceItem(currentDevice, true));
            }

            if (otherDevices.length > 0) {
                if (currentDevice) {
                    sections.push(`<div class="session-devices-section-label">${escapeHtml(tr('Другие сессии'))}</div>`);
                }
                otherDevices.forEach(d => sections.push(renderDeviceItem(d, false)));
            }

            sessionDevicesListEl.innerHTML = sections.join('');
            updateSignOutBtn(otherDevices.length);
        } catch (_err) {
            sessionDevicesListEl.innerHTML = `<div class="session-device-empty">${escapeHtml(tr('Сетевая ошибка при загрузке сессий.'))}</div>`;
            // Баг 5 fix: скрываем кнопку при ошибке загрузки
            updateSignOutBtn(0);
        }
    }

    function updateSignOutBtn(otherCount) {
        if (!signOutOtherSessionsBtn) return;
        signOutOtherSessionsBtn.style.display = otherCount > 0 ? '' : 'none';
    }

    function renderDeviceItem(device, isCurrent) {
        const info = getDeviceInfo(device.user_agent, device.persistent);
        const browser = getBrowserName(device.user_agent);
        const nameDisplay = browser ? `${escapeHtml(info.name)} · ${escapeHtml(browser)}` : escapeHtml(info.name);
        const location = device.ip ? `IP ${escapeHtml(device.ip)}` : escapeHtml(tr('IP скрыт'));
        const lastActive = formatSessionTimestamp(device.last_used_at);
        // Баг 2 fix: _formatExpiry только для persistent-сессий
        const sessionAge = device.persistent ? _formatExpiry(device.expires_at) : tr('Сессия');

        const pills = [];
        if (isCurrent) pills.push(`<span class="session-device-pill session-device-pill--current">${escapeHtml(tr('Текущая'))}</span>`);
        pills.push(`<span class="session-device-pill">${escapeHtml(sessionAge)}</span>`);

        // Баг 3 fix: для веб-сессии без family_id (fallback) показываем кнопку выхода через /logout
        let actionHtml;
        if (device.family_id) {
            actionHtml = `<button type="button" class="session-revoke-btn${isCurrent ? ' session-revoke-btn--current' : ''}" data-family-id="${escapeHtml(device.family_id)}" data-current="${isCurrent ? '1' : '0'}">
                ${escapeHtml(tr(isCurrent ? 'Выйти' : 'Завершить'))}
            </button>`;
        } else if (isCurrent) {
            // Текущая сессия без refresh-cookie — можно только разлогиниться
            actionHtml = `<button type="button" class="session-revoke-btn session-revoke-btn--current" data-logout="1">
                ${escapeHtml(tr('Выйти'))}
            </button>`;
        } else {
            actionHtml = `<span class="session-device-pill">${escapeHtml(tr('Веб'))}</span>`;
        }

        return `
            <div class="session-device-item${isCurrent ? ' session-device-item--current' : ''}">
                <div class="session-device-avatar">
                    ${renderDeviceIcon(info.icon)}
                </div>
                <div class="session-device-main">
                    <div class="session-device-name">
                        ${nameDisplay}
                        <span class="session-device-pills">${pills.join('')}</span>
                    </div>
                    <div class="session-device-meta">
                        <span>${escapeHtml(tr('Последняя активность:'))} ${escapeHtml(lastActive)}</span>
                        <span class="session-device-ip">${location}</span>
                    </div>
                </div>
                <div class="session-device-action">
                    ${actionHtml}
                </div>
            </div>
        `;
    }

    sessionDevicesListEl?.addEventListener('click', async (event) => {
        const target = event.target;
        if (!(target instanceof Element)) return;
        const btn = target.closest('.session-revoke-btn');
        if (!btn) return;

        // Баг 3 fix: обработка кнопки выхода для веб-сессии без cookie
        if (btn.dataset.logout === '1') {
            const ok = await showConfirmDialog({
                title: tr('Выйти с этого устройства?'),
                message: tr('Вы выйдете из аккаунта на этом устройстве.'),
                confirmText: tr('Выйти'),
                cancelText: tr('Отмена'),
                variant: 'danger',
            });
            if (!ok) return;
            if (typeof doLogout === 'function') await doLogout();
            else navigateOut('/');
            return;
        }

        const familyId = btn.getAttribute('data-family-id');
        const isCurrent = btn.getAttribute('data-current') === '1';
        if (!familyId) return;

        // Баг 1 fix: правильный параметр — message, не body
        const ok = await showConfirmDialog({
            title: tr(isCurrent ? 'Выйти с этого устройства?' : 'Завершить эту сессию?'),
            message: isCurrent
                ? tr('Вы выйдете из аккаунта на этом устройстве.')
                : tr('Устройство будет отключено от аккаунта.'),
            confirmText: tr(isCurrent ? 'Выйти' : 'Завершить'),
            cancelText: tr('Отмена'),
            variant: 'danger',
        });
        if (!ok) return;

        btn.disabled = true;
        try {
            const data = await api.revokeSessionDevice(familyId);
            if (data.signed_out_current) {
                // Баг 4 fix: return до finally чтобы не разблокировать кнопку перед редиректом
                navigateOut('/');
                return;
            }
            showAlert(tr('Сессия завершена.'), 'success');
            await loadSessionDevices();
        } catch (_err) {
            showAlert(tr('Сетевая ошибка при завершении сессии.'), 'danger');
            btn.disabled = false;
        }
    });

    signOutOtherSessionsBtn?.addEventListener('click', async function () {
        // Баг 1 fix: правильный параметр — message, не body
        const ok = await showConfirmDialog({
            title: tr('Завершить все другие сессии?'),
            message: tr('Все устройства, кроме текущего, будут отключены от аккаунта.'),
            confirmText: tr('Завершить все'),
            cancelText: tr('Отмена'),
            variant: 'danger',
        });
        if (!ok) return;
        this.disabled = true;
        try {
            await api.revokeOtherSessionDevices();
            showAlert(tr('Остальные сессии завершены.'), 'success');
            await loadSessionDevices();
        } catch (_err) {
            showAlert(tr('Сетевая ошибка при завершении остальных сессий.'), 'danger');
        } finally {
            this.disabled = false;
        }
    });

    sessionAutoLogoutSelectEl?.addEventListener('change', async function () {
        const seconds = Number(this.value || 0);
        if (!Number.isFinite(seconds) || seconds <= 0) return;
        this.disabled = true;
        try {
            const data = await api.updateSessionAutoLogoutSeconds(seconds);
            applySessionAutoLogout(data);
            showAlert(tr('Срок автоматического завершения сеанса обновлен.'), 'success');
            await loadSessionDevices();
        } catch (_err) {
            showAlert(tr('Сетевая ошибка при обновлении срока сессии.'), 'danger');
            await loadSessionDevices();
        } finally {
            this.disabled = false;
        }
    });

    return {
        loadSessionDevices,
    };
}
