const DEFAULT_TYPING_SIGNAL_HEARTBEAT_MS = 2800;

const ALLOWED_TYPING_KINDS = new Set([
    'text',
    'voice',
    'upload_file',
    'upload_voice',
    'send_file',
    'send_voice',
]);

function normalizeTypingKind(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return '';
    return ALLOWED_TYPING_KINDS.has(normalized) ? normalized : '';
}

function resolveChatId(getChatId) {
    const value = typeof getChatId === 'function' ? getChatId() : '';
    return String(value || '').trim();
}

export function createTypingSignalHeartbeat({
    emitSocket,
    getChatId,
    isBlocked,
    heartbeatMs = DEFAULT_TYPING_SIGNAL_HEARTBEAT_MS,
} = {}) {
    let timerId = 0;
    let activeKind = '';

    const clearTimer = () => {
        if (!timerId) return;
        clearInterval(timerId);
        timerId = 0;
    };

    const emitSignal = (eventName, typingKind) => {
        const chatId = resolveChatId(getChatId);
        if (!chatId || typeof emitSocket !== 'function') return false;
        const payload = { chat_id: chatId };
        const normalizedKind = normalizeTypingKind(typingKind);
        if (normalizedKind) {
            payload.typing_kind = normalizedKind;
        }
        return emitSocket(eventName, payload);
    };

    function start(kind) {
        const normalizedKind = normalizeTypingKind(kind);
        if (!normalizedKind) return false;
        if (typeof isBlocked === 'function' && isBlocked()) return false;

        if (activeKind && activeKind !== normalizedKind) {
            stop(activeKind);
        }
        if (activeKind === normalizedKind && timerId) {
            return true;
        }

        activeKind = normalizedKind;
        emitSignal('typing', normalizedKind);

        const intervalMs = Math.max(2500, Number(heartbeatMs) || DEFAULT_TYPING_SIGNAL_HEARTBEAT_MS);
        timerId = setInterval(() => {
            if (!activeKind) return;
            if (typeof isBlocked === 'function' && isBlocked()) {
                stop(activeKind);
                return;
            }
            emitSignal('typing', activeKind);
        }, intervalMs);
        return true;
    }

    function stop(kind = '') {
        const targetKind = normalizeTypingKind(kind || activeKind);
        const currentKind = normalizeTypingKind(activeKind);
        if (!targetKind || !currentKind) {
            clearTimer();
            activeKind = '';
            return;
        }
        if (targetKind !== currentKind) return;

        clearTimer();
        emitSignal('stop_typing', currentKind);
        activeKind = '';
    }

    function stopAll() {
        stop(activeKind);
    }

    function isActive(kind = '') {
        const targetKind = normalizeTypingKind(kind);
        if (!targetKind) return Boolean(activeKind);
        return activeKind === targetKind;
    }

    return {
        start,
        stop,
        stopAll,
        isActive,
        getActiveKind: () => activeKind,
    };
}
