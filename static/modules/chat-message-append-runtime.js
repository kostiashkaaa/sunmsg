export function createChatMessageAppendRuntime({
    windowRef = window,
    cssEscape = globalThis.CSS?.escape,
    getCurrentChatId,
    getChatMessages,
    getChatState,
    getKeepChatPinnedToBottom,
    upsertChatMessage,
    getMessageKey,
    isSameMessageGroup,
    getMessageDayKey,
    createDaySeparatorNode,
    messageGroup,
    messageItem,
    syncReusedMessageNodeState,
    isMobileViewport,
    isSelectionMode,
    isChatNearBottom,
    requestAutoScrollToBottom,
    registerMediaElementsForLazyHydration,
    schedulePostRenderUiRefresh,
    scheduleVirtualChatRender,
    requestAnimationFrameFn = requestAnimationFrame,
    applyTickToElement,
    formatTime,
    formatFullTimestamp,
    patchMessageReactions,
    refreshMessageHeightCache,
} = {}) {
    const escapeCss = typeof cssEscape === 'function'
        ? cssEscape
        : (value) => String(value).replace(/["\\]/g, '\\$&');

    function applyMessageEnterAnimation(node, msg) {
        if (!node) return;
        if (isMobileViewport?.()) return;
        const senderClass = msg?.sender === 'self' ? 'msg-animate-self' : 'msg-animate-other';
        node.classList.add('msg-animate-in', senderClass);

        let cleared = false;
        const clearClasses = () => {
            if (cleared || !node) return;
            cleared = true;
            node.classList.remove('msg-animate-in', 'msg-animate-self', 'msg-animate-other');
        };

        const handleAnimationEnd = (event) => {
            if (event?.target !== node) return;
            node.removeEventListener('animationend', handleAnimationEnd);
            clearClasses();
        };

        node.addEventListener('animationend', handleAnimationEnd);
        windowRef.setTimeout(() => {
            node.removeEventListener('animationend', handleAnimationEnd);
            clearClasses();
        }, 520);
    }

    function appendMessage(msg, options = {}) {
        const currentChatId = getCurrentChatId?.();
        if (!currentChatId) return null;
        const inserted = upsertChatMessage?.(currentChatId, msg, { append: options.append !== false });
        const renderOptions = options.renderOptions || {};

        const canFastAppend = inserted
            && !renderOptions.force
            && !renderOptions.preserveHeightDelta
            && !Number.isFinite(renderOptions.scrollTop);

        const chatMessages = getChatMessages?.();
        if (canFastAppend && chatMessages) {
            const state = getChatState?.(currentChatId);
            const lastIdx = state.messages.length - 1;
            const isAtTail = state.messages[lastIdx] === inserted;
            const range = state.lastRenderRange;
            const rangeCoversTail = range && range.end >= state.messages.length - 1;
            const msgKey = getMessageKey(inserted);
            const alreadyRendered = state.renderedKeys.has(msgKey);
            const previousTailMessage = lastIdx > 0 ? state.messages[lastIdx - 1] : null;
            const tailGroupWouldChange = isSameMessageGroup(previousTailMessage, inserted);
            const findRenderedMessageNodeByKey = (rawKey) => {
                const normalizedKey = String(rawKey || '');
                if (!normalizedKey) return null;
                return chatMessages.querySelector(`.message[data-message-key="${escapeCss(normalizedKey)}"]`);
            };

            if (isAtTail && rangeCoversTail && !alreadyRendered) {
                if (tailGroupWouldChange && previousTailMessage) {
                    const previousTailKey = getMessageKey(previousTailMessage);
                    const previousTailNode = findRenderedMessageNodeByKey(previousTailKey);
                    if (!previousTailNode) {
                        scheduleVirtualChatRender?.(currentChatId, renderOptions);
                        return inserted;
                    }
                    const previousTailLayout = messageGroup?.(state.messages, lastIdx - 1);
                    syncReusedMessageNodeState?.(previousTailNode, previousTailMessage, previousTailLayout);
                }

                const wasNearBottom = isChatNearBottom?.();
                const bottomSpacer = chatMessages.querySelector('.chat-virtual-spacer:last-child');
                const groupLayout = messageGroup?.(state.messages, lastIdx);
                const node = messageItem?.(inserted, groupLayout);
                applyMessageEnterAnimation(node, inserted);
                if (isSelectionMode?.()) node.classList.add('selecting');

                const prev = lastIdx > 0 ? state.messages[lastIdx - 1] : null;
                const prevDayKey = prev ? getMessageDayKey(prev.created_at) : '';
                const dayKey = getMessageDayKey(inserted.created_at);
                if (dayKey && dayKey !== prevDayKey) {
                    const sep = createDaySeparatorNode(inserted.created_at, dayKey);
                    if (bottomSpacer) chatMessages.insertBefore(sep, bottomSpacer);
                    else chatMessages.appendChild(sep);
                }
                if (bottomSpacer) chatMessages.insertBefore(node, bottomSpacer);
                else chatMessages.appendChild(node);
                registerMediaElementsForLazyHydration?.(node);

                state.renderedKeys.add(msgKey);
                state.lastRenderRange = { start: range.start, end: state.messages.length };

                requestAnimationFrameFn(() => {
                    if (!chatMessages.contains(node)) return;
                    const h = Math.ceil(node.getBoundingClientRect().height);
                    if (Number.isFinite(h) && h > 0) state.messageHeights.set(msgKey, h);
                });

                if (renderOptions.scrollToBottom) {
                    requestAutoScrollToBottom?.();
                } else if (wasNearBottom) {
                    requestAutoScrollToBottom?.();
                }
                schedulePostRenderUiRefresh?.({ searchFilter: true, jumpButton: true, e2ePill: true, expiryBadges: true, albums: true });
                return inserted;
            }
        }

        scheduleVirtualChatRender?.(currentChatId, renderOptions);
        return inserted;
    }

    function confirmPendingMessageDom({ clientId, messageId, message } = {}) {
        const chatMessages = getChatMessages?.();
        if (!chatMessages || !clientId || !message) return false;
        const rawClientId = String(clientId || '');
        if (!rawClientId) return false;
        let msgEl = chatMessages.querySelector(`.message.self[data-client-id="${escapeCss(rawClientId)}"]`);
        const numericMessageId = Number(messageId);
        if (!msgEl && Number.isFinite(numericMessageId) && numericMessageId > 0) {
            msgEl = chatMessages.querySelector(`.message.self[data-msg-id="${numericMessageId}"]`);
        }
        if (!msgEl) return false;

        if (Number.isFinite(numericMessageId) && numericMessageId > 0) {
            msgEl.setAttribute('data-msg-id', String(numericMessageId));
        }
        const key = getMessageKey(message);
        if (key) {
            msgEl.setAttribute('data-message-key', key);
        }
        msgEl.removeAttribute('data-pending');
        msgEl.removeAttribute('data-client-id');

        const tickEl = msgEl.querySelector('.msg-tick');
        if (tickEl) {
            applyTickToElement?.(tickEl, message);
        }
        if (message.created_at) {
            const timeEl = msgEl.querySelector('.msg-time');
            if (timeEl) {
                timeEl.textContent = formatTime(message.created_at);
                timeEl.title = formatFullTimestamp(message.created_at);
                timeEl.setAttribute('data-created-at', message.created_at);
            }
        }
        patchMessageReactions?.(msgEl, message.reactions, { animate: false });
        refreshMessageHeightCache?.(msgEl, { keepBottomPinned: getKeepChatPinnedToBottom?.() });
        return true;
    }

    return {
        applyMessageEnterAnimation,
        appendMessage,
        confirmPendingMessageDom,
    };
}
