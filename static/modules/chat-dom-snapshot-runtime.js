export function createChatDomSnapshotRuntime({
    snapshotLimit = 5,
    getChatMessages,
    getChatState,
    getExistingChatState,
    getCurrentChatId,
    getChatScrollPositions,
    renderChatMessages,
    setKeepChatPinnedToBottom,
    setSuppressChatScrollHandling,
    disconnectLazyMediaHydrationObserver,
    registerMediaElementsForLazyHydration,
    requestAnimationFrameFn,
} = {}) {
    const requestFrame = typeof requestAnimationFrameFn === 'function'
        ? requestAnimationFrameFn
        : (handler) => setTimeout(handler, 0);
    const chatDomSnapshotOrder = [];

    function touchChatDomSnapshotLRU(chatId) {
        const key = String(chatId);
        const idx = chatDomSnapshotOrder.indexOf(key);
        if (idx >= 0) chatDomSnapshotOrder.splice(idx, 1);
        chatDomSnapshotOrder.push(key);
        while (chatDomSnapshotOrder.length > snapshotLimit) {
            const oldKey = chatDomSnapshotOrder.shift();
            const oldState = getExistingChatState?.(oldKey);
            if (oldState) oldState.domSnapshot = null;
        }
    }

    function dropChatDomSnapshotLRU(chatId) {
        const key = String(chatId);
        const idx = chatDomSnapshotOrder.indexOf(key);
        if (idx >= 0) chatDomSnapshotOrder.splice(idx, 1);
    }

    function invalidateChatDomSnapshot(chatIdOrState) {
        const state = (chatIdOrState && typeof chatIdOrState === 'object' && 'messages' in chatIdOrState)
            ? chatIdOrState
            : (chatIdOrState ? getChatState?.(chatIdOrState) : null);
        if (!state) return;
        if (state.domSnapshot) state.domSnapshot = null;
        if (typeof chatIdOrState === 'string' || typeof chatIdOrState === 'number') {
            dropChatDomSnapshotLRU(chatIdOrState);
        }
    }

    function captureChatDomSnapshot(chatId) {
        const chatMessages = getChatMessages?.();
        if (!chatMessages || !chatId) return;
        const state = getChatState?.(chatId);
        if (!state?.initialized || !state.lastRenderRange) return;
        if (chatMessages.childNodes.length === 0) return;
        const nodes = Array.from(chatMessages.childNodes);
        const scrollTop = Math.max(0, chatMessages.scrollTop || 0);
        state.domSnapshot = {
            nodes,
            range: { ...state.lastRenderRange },
            scrollTop,
            messagesLength: state.messages.length,
        };
        touchChatDomSnapshotLRU(chatId);
    }

    function restoreChatDomSnapshot(chatId) {
        const chatMessages = getChatMessages?.();
        if (!chatMessages || !chatId) return false;
        const state = getChatState?.(chatId);
        const snap = state?.domSnapshot;
        if (!snap || !snap.nodes?.length) return false;
        if (!state.lastRenderRange) return false;
        if (snap.range.start !== state.lastRenderRange.start || snap.range.end !== state.lastRenderRange.end) return false;
        if (snap.messagesLength !== state.messages.length) return false;
        try {
            chatMessages.replaceChildren(...snap.nodes);
        } catch (_) {
            return false;
        }
        disconnectLazyMediaHydrationObserver?.();
        registerMediaElementsForLazyHydration?.(chatMessages);
        state.domSnapshot = null;
        dropChatDomSnapshotLRU(chatId);

        const targetTop = Number.isFinite(snap.scrollTop) ? snap.scrollTop : 0;
        setSuppressChatScrollHandling?.(true);
        requestFrame(() => {
            const activeMessages = getChatMessages?.();
            if (!activeMessages) {
                setSuppressChatScrollHandling?.(false);
                return;
            }
            if (!chatId || String(chatId) !== String(getCurrentChatId?.())) {
                setSuppressChatScrollHandling?.(false);
                return;
            }
            activeMessages.scrollTop = targetTop;
            requestFrame(() => {
                const nextMessages = getChatMessages?.();
                if (
                    nextMessages
                    && chatId
                    && String(chatId) === String(getCurrentChatId?.())
                    && Math.abs(nextMessages.scrollTop - targetTop) > 1
                ) {
                    nextMessages.scrollTop = targetTop;
                }
                setSuppressChatScrollHandling?.(false);
            });
        });
        return true;
    }

    function resolveSavedChatScrollTop(chatId = getCurrentChatId?.()) {
        if (!chatId) return null;
        const key = String(chatId);
        const chatScrollPositions = getChatScrollPositions?.();
        if (chatScrollPositions?.has(key)) {
            const storedTop = Number(chatScrollPositions.get(key));
            if (Number.isFinite(storedTop)) return storedTop;
        }
        const state = getChatState?.(chatId);
        if (state?.hasSavedScrollTop && Number.isFinite(state.savedScrollTop)) {
            return state.savedScrollTop;
        }
        return null;
    }

    function renderChatAtBottom(chatId = getCurrentChatId?.()) {
        if (!chatId) return;
        renderChatMessages?.(chatId, { force: true, scrollToBottom: true });
        setKeepChatPinnedToBottom?.(true);
    }

    return {
        invalidateChatDomSnapshot,
        captureChatDomSnapshot,
        restoreChatDomSnapshot,
        resolveSavedChatScrollTop,
        renderChatAtBottom,
        dropChatDomSnapshotLRU,
    };
}
