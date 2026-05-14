export const DISAPPEARING_TIMERS = [
    { value: 0,       label: 'Выкл.' },
    { value: 30,      label: '30 сек' },
    { value: 300,     label: '5 мин' },
    { value: 3600,    label: '1 час' },
    { value: 86400,   label: '24 часа' },
    { value: 604800,  label: '7 дней' },
    { value: 2592000, label: '30 дней' },
];

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
    documentRef = document,
} = {}) {
    const autoDeleteByChatId = new Map();

    function getAutoDeleteSeconds(chatId) {
        return autoDeleteByChatId.get(chatId) ?? 0;
    }

    function setAutoDeleteSeconds(chatId, seconds) {
        autoDeleteByChatId.set(chatId, Number(seconds) || 0);
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
        return `<select class="disappearing-timer-select">${rows}</select>`;
    }

    function renderTimerPickerInContainer(containerEl, chatId) {
        if (!containerEl) return;
        const current = getAutoDeleteSeconds(chatId);
        containerEl.innerHTML = `
            <div class="disappearing-timer-row">
                <span class="disappearing-timer-label">Исчезающие сообщения</span>
                ${buildTimerPickerHtml(current)}
            </div>`;
        const select = containerEl.querySelector('.disappearing-timer-select');
        select?.addEventListener('change', () => {
            const val = Number(select.value);
            applyTimerToChatId(chatId, val);
        });
    }

    function addExpiryBadgeToMessage(messageEl, expiresAtUnix) {
        if (!messageEl || !expiresAtUnix) return;
        const existing = messageEl.querySelector('.expiry-badge');
        if (existing) existing.remove();
        const badge = documentRef.createElement('span');
        badge.className = 'expiry-badge';
        badge.title = 'Исчезающее сообщение';
        badge.textContent = formatExpiresAt(expiresAtUnix);
        badge.dataset.expiresAt = String(expiresAtUnix);
        messageEl.appendChild(badge);
    }

    function refreshExpiryBadges() {
        documentRef.querySelectorAll('.expiry-badge[data-expires-at]').forEach((badge) => {
            const ts = Number(badge.dataset.expiresAt);
            badge.textContent = formatExpiresAt(ts);
        });
    }

    const _interval = setInterval(refreshExpiryBadges, 10000);

    function destroy() {
        clearInterval(_interval);
    }

    return {
        getAutoDeleteSeconds,
        setAutoDeleteSeconds,
        applyTimerToChatId,
        onChatAutoDeleteUpdated,
        renderTimerPickerInContainer,
        addExpiryBadgeToMessage,
        refreshExpiryBadges,
        destroy,
    };
}
