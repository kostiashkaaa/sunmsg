export function createChatMessageExpiryRuntime({
    getCurrentChatId = () => '',
    getChatState = () => null,
    expireMessages = () => {},
    nowMs = () => Date.now(),
    setTimeoutFn = (handler, delay) => window.setTimeout(handler, delay),
    clearTimeoutFn = (timerId) => window.clearTimeout(timerId),
} = {}) {
    let expiryTimer = 0;

    const clearExpiryTimer = () => {
        if (!expiryTimer) return;
        clearTimeoutFn(expiryTimer);
        expiryTimer = 0;
    };

    const normalizeMessageId = (value) => {
        const id = Number(value);
        return Number.isFinite(id) && id > 0 ? id : null;
    };

    function resolveExpiryState(chatId) {
        const state = getChatState(chatId);
        const messages = Array.isArray(state?.messages) ? state.messages : [];
        const now = Math.floor(nowMs() / 1000);
        const expiredIds = [];
        let nextExpiresAt = 0;

        messages.forEach((message) => {
            const messageId = normalizeMessageId(message?.id);
            const expiresAt = Number(message?.expires_at);
            if (!messageId || !Number.isFinite(expiresAt) || expiresAt <= 0) return;
            if (expiresAt <= now) {
                expiredIds.push(messageId);
                return;
            }
            nextExpiresAt = nextExpiresAt > 0 ? Math.min(nextExpiresAt, expiresAt) : expiresAt;
        });

        return { expiredIds, nextExpiresAt, now };
    }

    function runExpiryCheck() {
        expiryTimer = 0;
        const chatId = String(getCurrentChatId() || '').trim();
        if (!chatId) return;

        const { expiredIds, nextExpiresAt, now } = resolveExpiryState(chatId);
        if (expiredIds.length) {
            expireMessages(chatId, expiredIds);
            return;
        }

        if (nextExpiresAt > 0) {
            const delayMs = Math.max(250, ((nextExpiresAt - now) * 1000) + 50);
            expiryTimer = setTimeoutFn(runExpiryCheck, delayMs);
        }
    }

    function scheduleCurrentChatExpiry() {
        clearExpiryTimer();
        runExpiryCheck();
    }

    return {
        scheduleCurrentChatExpiry,
        clear: clearExpiryTimer,
    };
}
