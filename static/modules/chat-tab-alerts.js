export function createTabAlertController({
    baseTitle = '',
    blinkIntervalMs = 900,
    getTitle = () => '',
    setTitle = () => {},
    setIntervalFn = (handler, delay) => window.setInterval(handler, delay),
    clearIntervalFn = (timerId) => window.clearInterval(timerId),
} = {}) {
    function tr(value) {
        const api = globalThis.window?.SUN_I18N;
        if (api && typeof api.translateText === 'function') {
            return api.translateText(value);
        }
        return String(value ?? '');
    }

    const alertsByChatId = new Map();
    const normalizedBaseTitle = String(baseTitle || getTitle() || 'sun');
    let blinkTimer = 0;
    let blinkPhase = false;

    function getAlertCount() {
        let count = 0;
        alertsByChatId.forEach((value) => {
            count += Math.max(0, Number(value) || 0);
        });
        return count;
    }

    function getAlertTitle() {
        const count = getAlertCount();
        if (count <= 0) return normalizedBaseTitle;
        if (count === 1) {
            return `(1) ${tr('\u041D\u043E\u0432\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435')} • ${normalizedBaseTitle}`;
        }
        return `(${count}) ${tr('\u041D\u043E\u0432\u044B\u0445 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439')} • ${normalizedBaseTitle}`;
    }

    function applyTitleFrame() {
        const count = getAlertCount();
        if (count <= 0) {
            setTitle(normalizedBaseTitle);
            return;
        }
        setTitle(blinkPhase ? getAlertTitle() : normalizedBaseTitle);
    }

    function startBlinking() {
        if (blinkTimer) return;
        blinkPhase = true;
        applyTitleFrame();
        blinkTimer = setIntervalFn(() => {
            blinkPhase = !blinkPhase;
            applyTitleFrame();
        }, blinkIntervalMs);
    }

    function stopBlinking() {
        if (blinkTimer) {
            clearIntervalFn(blinkTimer);
            blinkTimer = 0;
        }
        blinkPhase = false;
    }

    function clearAlertForChat(chatId) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return;
        alertsByChatId.delete(normalizedChatId);
        if (getAlertCount() <= 0) {
            stopBlinking();
            setTitle(normalizedBaseTitle);
            return;
        }
        applyTitleFrame();
    }

    function clearAllAlerts() {
        alertsByChatId.clear();
        stopBlinking();
        setTitle(normalizedBaseTitle);
    }

    function pushAlert(chatId) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return;
        const nextCount = (alertsByChatId.get(normalizedChatId) || 0) + 1;
        alertsByChatId.set(normalizedChatId, nextCount);
        startBlinking();
        applyTitleFrame();
    }

    return {
        getAlertCount,
        getAlertTitle,
        applyTitleFrame,
        startBlinking,
        stopBlinking,
        clearAlertForChat,
        clearAllAlerts,
        pushAlert,
    };
}
