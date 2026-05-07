export function createHistoryAbortController(controllerMap, chatId) {
    const key = String(chatId || '');
    const previous = controllerMap.get(key);
    if (previous) {
        try { previous.abort(); } catch (_) {}
    }
    const next = new AbortController();
    controllerMap.set(key, next);
    return next;
}

export function releaseHistoryAbortController(controllerMap, chatId, controller) {
    const key = String(chatId || '');
    if (controllerMap.get(key) !== controller) return;
    controllerMap.delete(key);
}

export function abortHistoryRequestsForChat(chatId, controllerMaps) {
    const key = String(chatId || '');
    if (!key) return;
    (Array.isArray(controllerMaps) ? controllerMaps : []).forEach((controllerMap) => {
        const controller = controllerMap?.get?.(key);
        if (controller) {
            try { controller.abort(); } catch (_) {}
            controllerMap.delete(key);
        }
    });
}
