const MESSAGE_FOCUS_TOP_OFFSET = 84;
const MESSAGE_FOCUS_ALIGN = 'center';
const MESSAGE_FOCUS_VISIBLE_MARGIN = 18;
const MESSAGE_FOCUS_MIN_HIGHLIGHT_DELAY = 90;
const MESSAGE_FOCUS_FLASH_DURATION = 1450;
const MESSAGE_FOCUS_TARGET_EPSILON = 12;
const MESSAGE_FOCUS_FLASH_FADE_MS = 220;

export function createMessageFocusRuntime({
    documentRef = document,
    requestAnimationFrameFn = requestAnimationFrame,
    cancelAnimationFrameFn = cancelAnimationFrame,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    getChatMessages,
    getCurrentChatId,
    getChatState,
    findMessageById,
    findMessageIndex,
    loadOlderMessages,
    estimateMessageHeight,
    chatDefaultMessageHeight,
    sumEstimatedHeights,
    renderChatMessages,
} = {}) {
    const messageFlashTimers = new WeakMap();

    function isMessageInView(el, container, margin = MESSAGE_FOCUS_VISIBLE_MARGIN) {
        if (!el || !container) return false;
        const cRect = container.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        const topVisible = eRect.top >= (cRect.top + margin);
        const bottomVisible = eRect.bottom <= (cRect.bottom - margin);
        return topVisible && bottomVisible;
    }

    function computeScrollTarget(el, container, options = {}) {
        const topOffset = Number.isFinite(options.topOffset) ? options.topOffset : MESSAGE_FOCUS_TOP_OFFSET;
        const align = typeof options.align === 'string' ? options.align : MESSAGE_FOCUS_ALIGN;
        const cRect = container.getBoundingClientRect();
        const eRect = el.getBoundingClientRect();
        const relativeTop = eRect.top - cRect.top;
        const centerOffset = Math.max(0, (container.clientHeight - eRect.height) / 2);
        const rawTargetTop = align === 'center'
            ? container.scrollTop + relativeTop - centerOffset
            : container.scrollTop + relativeTop - topOffset;
        const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
        return Math.max(0, Math.min(rawTargetTop, maxScrollTop));
    }

    function flashMessageTarget(el) {
        if (!el) return;
        const previousState = messageFlashTimers.get(el);
        if (previousState?.showFrame) cancelAnimationFrameFn(previousState.showFrame);
        if (previousState?.hideTimer) clearTimeoutFn(previousState.hideTimer);
        if (previousState?.cleanupTimer) clearTimeoutFn(previousState.cleanupTimer);
        el.classList.remove('highlight-flash-active');
        el.classList.remove('highlight-flash');
        void el.offsetWidth;
        el.classList.add('highlight-flash');
        const showFrame = requestAnimationFrameFn(() => {
            el.classList.add('highlight-flash-active');
        });
        const hideTimer = setTimeoutFn(() => {
            el.classList.remove('highlight-flash-active');
        }, MESSAGE_FOCUS_FLASH_DURATION);
        const cleanupTimer = setTimeoutFn(() => {
            el.classList.remove('highlight-flash');
            messageFlashTimers.delete(el);
        }, MESSAGE_FOCUS_FLASH_DURATION + MESSAGE_FOCUS_FLASH_FADE_MS);
        messageFlashTimers.set(el, {
            showFrame,
            hideTimer,
            cleanupTimer,
        });
    }

    async function ensureMessageLoaded(msgId) {
        const currentChatId = getCurrentChatId?.();
        if (!currentChatId) return false;
        const numericId = Number(msgId);
        if (!Number.isFinite(numericId) || numericId <= 0) return false;

        const state = getChatState?.(currentChatId);
        while (!findMessageById?.(currentChatId, numericId) && state?.hasMoreBefore && !state.isLoadingOlder) {
            const oldestId = Number(state.messages[0]?.id);
            if (!Number.isFinite(oldestId) || numericId >= oldestId) break;
            await loadOlderMessages?.(currentChatId);
        }
        return Boolean(findMessageById?.(currentChatId, numericId));
    }

    function estimateScrollTopForMessage(msgId, options = {}) {
        const currentChatId = getCurrentChatId?.();
        const state = getChatState?.(currentChatId);
        if (!state) return null;
        const index = findMessageIndex?.(state, (msg) => Number(msg.id) === Number(msgId));
        if (!Number.isFinite(index) || index < 0) return null;
        const topOffset = Number.isFinite(options.topOffset) ? options.topOffset : MESSAGE_FOCUS_TOP_OFFSET;
        const align = typeof options.align === 'string' ? options.align : MESSAGE_FOCUS_ALIGN;
        const targetMessage = state.messages[index];
        const estimatedHeight = Math.max(
            48,
            estimateMessageHeight?.(state, targetMessage) || state.averageMessageHeight || chatDefaultMessageHeight,
        );
        const chatMessages = getChatMessages?.();
        const centerOffset = Math.max(0, ((chatMessages?.clientHeight || 0) - estimatedHeight) / 2);
        const anchorOffset = align === 'center' ? centerOffset : topOffset;
        return Math.max(0, sumEstimatedHeights?.(state, 0, index) - anchorOffset);
    }

    async function focusMessageById(msgId, options = {}) {
        const chatMessages = getChatMessages?.();
        if (!chatMessages) return false;

        const msgIdToken = String(msgId ?? '');
        if (!msgIdToken) return false;
        const messageSelector = `.message[data-msg-id="${CSS.escape(msgIdToken)}"]`;
        let el = documentRef.querySelector(messageSelector);
        if (!el) {
            const loaded = await ensureMessageLoaded(msgId);
            if (!loaded) return false;
            const estimatedTop = estimateScrollTopForMessage(msgId, options);
            renderChatMessages?.(getCurrentChatId?.(), {
                force: true,
                scrollTop: Number.isFinite(estimatedTop) ? estimatedTop : chatMessages.scrollTop,
            });
            el = documentRef.querySelector(messageSelector);
        }
        if (!el) return false;

        const smooth = options.smooth !== false;
        const targetTop = computeScrollTarget(el, chatMessages, options);
        const distance = Math.abs(targetTop - chatMessages.scrollTop);
        const alreadyInView = isMessageInView(el, chatMessages);

        if (alreadyInView && distance <= MESSAGE_FOCUS_TARGET_EPSILON) {
            flashMessageTarget(el);
            return true;
        }

        requestAnimationFrameFn(() => {
            chatMessages.scrollTo({ top: targetTop, behavior: smooth ? 'smooth' : 'auto' });
            const delay = smooth
                ? Math.max(MESSAGE_FOCUS_MIN_HIGHLIGHT_DELAY, Math.min(520, Math.round(distance * 0.45)))
                : 0;
            setTimeoutFn(() => flashMessageTarget(el), delay);
        });
        return true;
    }

    return { focusMessageById };
}
