import { tr } from './utils.js';

export const DISAPPEARING_TIMERS = [
    { value: 0,       label: 'Выкл.' },
    { value: 30,      label: '30 сек' },
    { value: 300,     label: '5 мин' },
    { value: 3600,    label: '1 час' },
    { value: 86400,   label: '24 часа' },
    { value: 604800,  label: '7 дней' },
    { value: 2592000, label: '30 дней' },
];

function nextFrame(callback) {
    const raf = globalThis?.requestAnimationFrame;
    if (typeof raf === 'function') return raf(callback);
    return globalThis?.setTimeout?.(callback, 16);
}

function cancelNextFrame(frameId) {
    if (!frameId) return;
    if (typeof globalThis?.cancelAnimationFrame === 'function') {
        globalThis.cancelAnimationFrame(frameId);
        return;
    }
    globalThis?.clearTimeout?.(frameId);
}

export function formatTimerLabel(seconds) {
    const safeSeconds = Number(seconds) || 0;
    const timer = DISAPPEARING_TIMERS.find((item) => item.value === safeSeconds);
    if (timer) return timer.label;
    if (safeSeconds > 0) return `${safeSeconds} сек`;
    return DISAPPEARING_TIMERS[0].label;
}

export function formatTimerSummary(seconds) {
    const safeSeconds = Number(seconds) || 0;
    if (safeSeconds > 0) {
        return `${tr('Новые сообщения удаляются через')} ${formatTimerLabel(safeSeconds)} ${tr('после отправки')}.`;
    }
    return tr('Новые сообщения остаются в чате.');
}

export function formatTimerPillText(seconds) {
    const safeSeconds = Number(seconds) || 0;
    if (safeSeconds <= 0) return '';
    return `${tr('Новые сообщения будут удаляться через')} ${formatTimerLabel(safeSeconds)}.`;
}

export function formatExpiresAt(expiresAtUnix) {
    if (!expiresAtUnix) return null;
    const ms = Number(expiresAtUnix) * 1000;
    const diff = ms - Date.now();
    if (diff <= 0) return 'Истекает...';
    const s = Math.floor(diff / 1000);
    if (s < 60) return `${s}с`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}м`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}ч`;
    return `${Math.floor(h / 24)}д`;
}

export function createDisappearingMessagesController({
    socketEmit,
    getCsrfToken,
    getCurrentChatId,
    documentRef = globalThis.document,
} = {}) {
    const autoDeleteByChatId = new Map();
    let pillHideTimer = 0;
    let pillUpdateTimer = 0;
    let pillRevealFrame = 0;
    let lastVisiblePillSeconds = 0;

    function getAutoDeleteSeconds(chatId) {
        return autoDeleteByChatId.get(chatId) ?? 0;
    }

    function setAutoDeleteSeconds(chatId, seconds) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return;
        autoDeleteByChatId.set(normalizedChatId, Number(seconds) || 0);
        syncCurrentChatTimerUi();
    }

    function applyTimerToChatId(chatId, seconds) {
        setAutoDeleteSeconds(chatId, seconds);
        if (typeof socketEmit === 'function') {
            socketEmit('set_chat_auto_delete', {
                chat_id: chatId,
                seconds,
                csrf_token: typeof getCsrfToken === 'function' ? getCsrfToken() : '',
            });
        }
    }

    function onChatAutoDeleteUpdated(payload) {
        const chatId = String(payload?.chat_id || '');
        const seconds = Number(payload?.seconds ?? 0);
        if (chatId) setAutoDeleteSeconds(chatId, seconds);
    }

    function buildTimerPickerHtml(currentSeconds) {
        const rows = DISAPPEARING_TIMERS.map(({ value, label }) => {
            const selected = value === currentSeconds ? ' selected' : '';
            return `<option value="${value}"${selected}>${label}</option>`;
        }).join('');
        return `<select class="disappearing-timer-select" aria-label="${tr('Таймер исчезающих сообщений')}">${rows}</select>`;
    }

    function buildProfileTimerHtml(currentSeconds) {
        return `
            <div class="profile-info-line profile-info-line--timer${currentSeconds > 0 ? ' is-active' : ''}">
                <span class="profile-info-icon"><i class="bi bi-clock-history" aria-hidden="true"></i></span>
                <div class="profile-info-text">
                    <div class="profile-info-value">${tr('Исчезающие сообщения')}</div>
                    <div class="profile-info-label" data-disappearing-timer-summary>${formatTimerSummary(currentSeconds)}</div>
                </div>
                ${buildTimerPickerHtml(currentSeconds)}
            </div>`;
    }

    function buildMenuTimerHtml(currentSeconds) {
        return `
            <div class="disappearing-timer-row disappearing-timer-row--menu${currentSeconds > 0 ? ' is-active' : ''}">
                <span class="disappearing-timer-copy">
                    <span class="disappearing-timer-label">${tr('Исчезающие сообщения')}</span>
                    <span class="disappearing-timer-hint">${formatTimerSummary(currentSeconds)}</span>
                </span>
                ${buildTimerPickerHtml(currentSeconds)}
            </div>`;
    }

    function setPillVisibility(pillWrap, enabled) {
        if (!pillWrap) return;
        if (pillHideTimer) {
            clearTimeout(pillHideTimer);
            pillHideTimer = 0;
        }
        if (enabled) {
            const wasHidden = pillWrap.hidden
                || pillWrap.classList?.contains?.('disappearing-pill-wrap--hidden');
            pillWrap.hidden = false;
            pillWrap.setAttribute('aria-hidden', 'false');
            if (wasHidden) {
                pillWrap.classList?.add?.('disappearing-pill-wrap--hidden');
                pillRevealFrame = nextFrame(() => {
                    pillRevealFrame = 0;
                    pillWrap.classList?.remove?.('disappearing-pill-wrap--hidden');
                });
            } else {
                pillWrap.classList?.remove?.('disappearing-pill-wrap--hidden');
            }
            return;
        }

        lastVisiblePillSeconds = 0;
        pillWrap.setAttribute('aria-hidden', 'true');
        pillWrap.classList?.add?.('disappearing-pill-wrap--hidden');
        if (pillWrap.hidden) return;
        pillHideTimer = setTimeout(() => {
            pillHideTimer = 0;
            if (pillWrap.classList?.contains?.('disappearing-pill-wrap--hidden')) {
                pillWrap.hidden = true;
            }
        }, 240);
    }

    function animatePillTimerChange(pillEl, seconds) {
        if (!pillEl || seconds <= 0) return;
        if (!lastVisiblePillSeconds || lastVisiblePillSeconds === seconds) {
            lastVisiblePillSeconds = seconds;
            return;
        }
        pillEl.classList?.remove?.('disappearing-pill--timer-changing');
        nextFrame(() => {
            pillEl.classList?.add?.('disappearing-pill--timer-changing');
        });
        if (pillUpdateTimer) clearTimeout(pillUpdateTimer);
        pillUpdateTimer = setTimeout(() => {
            pillUpdateTimer = 0;
            pillEl.classList?.remove?.('disappearing-pill--timer-changing');
        }, 420);
        lastVisiblePillSeconds = seconds;
    }

    function syncCurrentChatTimerUi() {
        const chatId = String(typeof getCurrentChatId === 'function' ? getCurrentChatId() || '' : '').trim();
        const seconds = chatId ? getAutoDeleteSeconds(chatId) : 0;
        const enabled = seconds > 0;
        const label = formatTimerLabel(seconds);
        const pillText = formatTimerPillText(seconds);

        const menuBtn = documentRef?.getElementById?.('disappearingMsgMenuBtn');
        const menuLabel = documentRef?.getElementById?.('disappearingMsgMenuLabel');
        if (menuBtn) {
            menuBtn.classList.toggle('is-active', enabled);
            menuBtn.setAttribute('aria-label', enabled
                ? `${tr('Исчезающие сообщения')}: ${label}`
                : tr('Исчезающие сообщения'));
            menuBtn.title = enabled
                ? `${tr('Исчезающие сообщения')}: ${label}`
                : tr('Исчезающие сообщения');
        }
        if (menuLabel) {
            menuLabel.textContent = enabled
                ? `${tr('Исчезающие')}: ${label}`
                : tr('Исчезающие сообщения');
        }

        const pillWrap = documentRef?.getElementById?.('disappearingPillWrap');
        const pillEl = documentRef?.getElementById?.('disappearingPill');
        const pillTitleEl = documentRef?.getElementById?.('disappearingPillTitle');
        const pillTextEl = documentRef?.getElementById?.('disappearingPillText');
        const chatAreaEl = documentRef?.getElementById?.('chatArea')
            || pillWrap?.closest?.('.chat-area');
        chatAreaEl?.classList?.toggle?.('chat-area--disappearing-enabled', enabled);
        setPillVisibility(pillWrap, enabled);
        if (pillTitleEl) {
            pillTitleEl.textContent = enabled ? tr('В этом чате включено автоудаление') : '';
        }
        if (pillTextEl) {
            pillTextEl.textContent = enabled ? pillText : '';
        }
        animatePillTimerChange(pillEl, enabled ? seconds : 0);

        const profileContainer = documentRef?.getElementById?.('disappearingTimerContainer');
        const profileRow = profileContainer?.querySelector?.('.profile-info-line--timer');
        const profileSelect = profileContainer?.querySelector?.('.disappearing-timer-select');
        const profileSummary = profileContainer?.querySelector?.('[data-disappearing-timer-summary]');
        if (profileRow) {
            profileRow.classList.toggle('is-active', enabled);
            profileRow.setAttribute('aria-label', enabled
                ? `${tr('Исчезающие сообщения')}: ${label}`
                : tr('Исчезающие сообщения выключены'));
        }
        if (profileSelect) profileSelect.value = String(seconds);
        if (profileSummary) profileSummary.textContent = formatTimerSummary(seconds);

        const menuContainer = documentRef?.getElementById?.('disappearingTimerPickerContainer');
        const menuSelect = menuContainer?.querySelector?.('.disappearing-timer-select');
        const menuHint = menuContainer?.querySelector?.('.disappearing-timer-hint');
        const menuRow = menuContainer?.querySelector?.('.disappearing-timer-row--menu');
        if (menuSelect) menuSelect.value = String(seconds);
        if (menuHint) menuHint.textContent = formatTimerSummary(seconds);
        if (menuRow) menuRow.classList.toggle('is-active', enabled);
    }

    function renderTimerPickerInContainer(containerEl, chatId) {
        if (!containerEl) return;
        const current = getAutoDeleteSeconds(chatId);
        const isProfileTimer = containerEl.id === 'disappearingTimerContainer'
            || containerEl.classList?.contains('disappearing-timer-container');
        containerEl.innerHTML = isProfileTimer
            ? buildProfileTimerHtml(current)
            : buildMenuTimerHtml(current);
        const select = containerEl.querySelector('.disappearing-timer-select');
        select?.addEventListener('change', () => {
            const val = Number(select.value);
            applyTimerToChatId(chatId, val);
        });
        syncCurrentChatTimerUi();
    }

    function addExpiryBadgeToMessage(messageEl, expiresAtUnix) {
        if (!messageEl || !expiresAtUnix) return;
        messageEl.querySelectorAll?.('.expiry-badge').forEach((badge) => badge.remove());
    }

    function refreshExpiryBadges() {
        (documentRef?.querySelectorAll?.('.expiry-badge') || []).forEach((badge) => badge.remove());
    }

    const _interval = setInterval(refreshExpiryBadges, 10000);

    function destroy() {
        clearInterval(_interval);
        if (pillHideTimer) clearTimeout(pillHideTimer);
        if (pillUpdateTimer) clearTimeout(pillUpdateTimer);
        cancelNextFrame(pillRevealFrame);
    }

    return {
        getAutoDeleteSeconds,
        setAutoDeleteSeconds,
        applyTimerToChatId,
        onChatAutoDeleteUpdated,
        renderTimerPickerInContainer,
        syncCurrentChatTimerUi,
        addExpiryBadgeToMessage,
        refreshExpiryBadges,
        destroy,
    };
}
