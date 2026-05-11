export function createChatMessageStatusRuntime({
    getCurrentChatId,
    getChatState,
    getChatMessages,
    findMessageIndex,
    applyTickToElement,
    scheduleForcedCurrentChatRerender,
    prefersReducedMotionSetting,
    runBottomInertiaScroll,
    setChatScrollTop,
    isTailRangeRendered,
    cancelBottomInertiaScroll,
    renderChatMessages,
    setKeepChatPinnedToBottom,
    saveChatScrollPosition,
    updateJumpToNewMessagesButton,
} = {}) {
    function markAllTicksRead(readAtRaw = '') {
        const readAt = String(readAtRaw || '').trim() || null;
        const currentChatId = getCurrentChatId?.();
        if (currentChatId) {
            const state = getChatState?.(currentChatId);
            state.messages = state.messages.map((msg) => (
                msg.sender === 'self'
                    ? (
                        msg.is_read
                            ? msg
                            : { ...msg, is_read: true, is_delivered: true, pending: false, read_at: readAt || msg.read_at || null }
                    )
                    : msg
            ));
        }
        getChatMessages?.()
            ?.querySelectorAll('.message.self .msg-tick.sent, .message.self .msg-tick.delivered')
            .forEach((el) => {
                applyTickToElement?.(el, { is_read: true, is_delivered: true, pending: false, read_at: readAt });
            });
    }

    function markOutgoingVoiceMessageListenedByPartner(chatId, msgId) {
        if (!chatId || !Number.isFinite(msgId)) return;
        const state = getChatState?.(chatId);
        if (state?.initialized) {
            const msgIndex = findMessageIndex?.(state, (msg) => Number(msg.id) === Number(msgId));
            if (Number.isFinite(msgIndex) && msgIndex >= 0 && state.messages[msgIndex]?.sender === 'self') {
                state.messages[msgIndex] = {
                    ...state.messages[msgIndex],
                    voice_listened_by_partner: true,
                };
            }
        }

        if (chatId !== getCurrentChatId?.()) return;
        const messageEl = getChatMessages?.()?.querySelector(`.message.self[data-msg-id="${Number(msgId)}"]`);
        if (messageEl) {
            messageEl.setAttribute('data-audio-listened-by-partner', '1');
        } else if (state?.initialized) {
            scheduleForcedCurrentChatRerender?.();
        }
    }

    function scrollToBottom({ smooth = true } = {}) {
        const chatMessages = getChatMessages?.();
        const currentChatId = getCurrentChatId?.();
        if (!chatMessages) return;

        if (smooth && !prefersReducedMotionSetting?.()) {
            if (!runBottomInertiaScroll?.()) {
                setChatScrollTop?.(chatMessages.scrollHeight);
            }
        } else if (!isTailRangeRendered?.(currentChatId)) {
            cancelBottomInertiaScroll?.();
            renderChatMessages?.(currentChatId, { force: true, scrollToBottom: true });
        } else {
            setChatScrollTop?.(chatMessages.scrollHeight);
        }

        setKeepChatPinnedToBottom?.(true);
        saveChatScrollPosition?.(currentChatId);
        updateJumpToNewMessagesButton?.();
    }

    return {
        markAllTicksRead,
        markOutgoingVoiceMessageListenedByPartner,
        scrollToBottom,
    };
}
