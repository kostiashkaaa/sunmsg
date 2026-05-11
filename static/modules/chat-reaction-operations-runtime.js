export function createChatReactionOperationsRuntime({
    windowRef = window,
    cryptoRef = crypto,
    reactionPickerEmojis = [],
    reactionUpdateStampByMessage,
    getCurrentChatId,
    getChatMessages,
    getChatState,
    findMessageIndex,
    normalizeMessageReactions,
    areMessageReactionsEqual,
    getReactionMessageKey,
    computeOptimisticReactions,
    patchMessageReactions,
    scheduleVirtualChatRender,
    applyReactionOperationUiState,
    emitSocket,
} = {}) {
    const pendingReactionOpsById = new Map();
    const pendingReactionOpByMessage = new Map();
    const supersededReactionRequestIds = new Map();

    function updateMessageReactionsState(chatId, messageId, rawReactions) {
        const numericMessageId = Number(messageId);
        if (!Number.isFinite(numericMessageId) || numericMessageId <= 0) return false;
        const state = getChatState?.(chatId);
        const index = findMessageIndex?.(state, (msg) => Number(msg.id) === numericMessageId);
        if (!Number.isFinite(index) || index < 0) return false;

        const nextReactions = normalizeMessageReactions?.(rawReactions);
        if (areMessageReactionsEqual?.(state.messages[index].reactions, nextReactions)) {
            return false;
        }

        state.messages[index] = {
            ...state.messages[index],
            reactions: nextReactions,
        };
        return true;
    }

    function applyMessageReactionsLocally(chatId, messageId, rawReactions, { animate = true, touchStamp = false, animatedEmoji = '' } = {}) {
        const changed = updateMessageReactionsState(chatId, messageId, rawReactions);
        if (!changed) return false;

        if (touchStamp) {
            const key = getReactionMessageKey?.(chatId, messageId);
            reactionUpdateStampByMessage?.set(key, Date.now());
        }

        if (String(chatId) !== String(getCurrentChatId?.())) {
            return true;
        }

        const chatMessages = getChatMessages?.();
        const messageEl = chatMessages?.querySelector(`.message[data-msg-id="${Number(messageId)}"]`);
        if (messageEl) {
            patchMessageReactions?.(messageEl, rawReactions, { animate, animatedEmoji });
            return true;
        }

        scheduleVirtualChatRender?.(chatId, { force: true, scrollTop: chatMessages.scrollTop });
        return true;
    }

    function rollbackPendingReactionOp(operation) {
        if (!operation) return;
        applyMessageReactionsLocally(
            operation.chatId,
            operation.messageId,
            operation.previousReactions,
            { animate: false },
        );
    }

    function rememberSupersededReactionRequest(requestId, ttlMs = 30000) {
        const token = String(requestId || '').trim();
        if (!token) return;
        const existingTimeoutId = supersededReactionRequestIds.get(token);
        if (existingTimeoutId) {
            clearTimeout(existingTimeoutId);
        }
        const timeoutId = windowRef.setTimeout(() => {
            supersededReactionRequestIds.delete(token);
        }, ttlMs);
        supersededReactionRequestIds.set(token, timeoutId);
    }

    function isSupersededReactionRequest(requestId) {
        const token = String(requestId || '').trim();
        if (!token) return false;
        return supersededReactionRequestIds.has(token);
    }

    function forgetSupersededReactionRequest(requestId) {
        const token = String(requestId || '').trim();
        if (!token) return;
        const timeoutId = supersededReactionRequestIds.get(token);
        if (timeoutId) {
            clearTimeout(timeoutId);
        }
        supersededReactionRequestIds.delete(token);
    }

    function markPendingReactionOpSuperseded(requestId) {
        const token = String(requestId || '').trim();
        if (!token) return;
        const operation = pendingReactionOpsById.get(token);
        if (!operation) return;
        operation.superseded = true;
        applyReactionOperationUiState?.(operation, { syncing: false, failed: false, disabled: false });
        rememberSupersededReactionRequest(token);
    }

    function clearPendingReactionOp(requestId, { rollback = false } = {}) {
        const token = String(requestId || '').trim();
        if (!token) return null;

        const operation = pendingReactionOpsById.get(token);
        if (!operation) return null;

        pendingReactionOpsById.delete(token);
        if (operation.timeoutId) {
            clearTimeout(operation.timeoutId);
        }
        if (pendingReactionOpByMessage.get(operation.messageKey) === token) {
            pendingReactionOpByMessage.delete(operation.messageKey);
        }

        if (rollback) {
            rollbackPendingReactionOp(operation);
        }

        applyReactionOperationUiState?.(operation, { syncing: false, failed: rollback, disabled: false });
        if (rollback && String(operation.chatId || '') === String(getCurrentChatId?.())) {
            windowRef.setTimeout(() => {
                applyReactionOperationUiState?.(operation, { syncing: false, failed: false, disabled: false });
            }, 1100);
        }

        return operation;
    }

    function clearPendingReactionOpByMessage(chatId, messageId, { rollback = false } = {}) {
        const key = getReactionMessageKey?.(chatId, messageId);
        const requestId = pendingReactionOpByMessage.get(key);
        if (requestId) {
            return clearPendingReactionOp(requestId, { rollback });
        }
        return null;
    }

    function registerPendingReactionOp(chatId, messageId, previousReactions, requestId, reactionContext = {}) {
        const token = String(requestId || '').trim();
        if (!token) return;

        const numericMessageId = Number(messageId);
        if (!Number.isFinite(numericMessageId) || numericMessageId <= 0) return;

        const key = getReactionMessageKey?.(chatId, numericMessageId);
        const existing = pendingReactionOpByMessage.get(key);
        if (existing) {
            markPendingReactionOpSuperseded(existing);
        }

        const timeoutId = windowRef.setTimeout(() => {
            clearPendingReactionOp(token);
        }, 4500);

        pendingReactionOpsById.set(token, {
            requestId: token,
            chatId: String(chatId || ''),
            messageId: numericMessageId,
            messageKey: key,
            previousReactions: normalizeMessageReactions?.(previousReactions),
            emoji: String(reactionContext?.emoji || '').trim(),
            mode: String(reactionContext?.mode || '').trim() || 'add',
            superseded: false,
            timeoutId,
        });
        pendingReactionOpByMessage.set(key, token);

        const operation = pendingReactionOpsById.get(token);
        applyReactionOperationUiState?.(operation, { syncing: true, failed: false, disabled: false });
    }

    function emitReactionToggle(messageId, emoji) {
        const currentChatId = getCurrentChatId?.();
        const normalizedMsgId = Number(messageId);
        const normalizedEmoji = String(emoji || '').trim();
        if (!currentChatId || !Number.isFinite(normalizedMsgId) || normalizedMsgId <= 0) return;
        if (!reactionPickerEmojis.includes(normalizedEmoji)) return;

        const state = getChatState?.(currentChatId);
        const messageIndex = findMessageIndex?.(state, (msg) => Number(msg.id) === normalizedMsgId);
        if (!Number.isFinite(messageIndex) || messageIndex < 0) return;

        const previousReactions = normalizeMessageReactions?.(state.messages[messageIndex].reactions);
        const myPreviousReaction = previousReactions.find((item) => item?.reactedByMe) || null;
        const reactionMode = myPreviousReaction?.emoji === normalizedEmoji
            ? 'remove'
            : (myPreviousReaction ? 'switch' : 'add');
        const nextReactions = computeOptimisticReactions?.(previousReactions, normalizedEmoji);
        const changed = applyMessageReactionsLocally(currentChatId, normalizedMsgId, nextReactions, {
            animate: true,
            animatedEmoji: normalizedEmoji,
        });
        if (!changed) return;

        const requestId = cryptoRef.randomUUID();
        registerPendingReactionOp(currentChatId, normalizedMsgId, previousReactions, requestId, {
            emoji: normalizedEmoji,
            mode: reactionMode,
        });
        const emitted = emitSocket?.('toggle_reaction', {
            chat_id: currentChatId,
            message_id: normalizedMsgId,
            emoji: normalizedEmoji,
            request_id: requestId,
        });

        if (!emitted) {
            clearPendingReactionOp(requestId, { rollback: true });
        }
    }

    return {
        updateMessageReactionsState,
        applyMessageReactionsLocally,
        clearPendingReactionOp,
        clearPendingReactionOpByMessage,
        registerPendingReactionOp,
        emitReactionToggle,
        rememberSupersededReactionRequest,
        isSupersededReactionRequest,
        forgetSupersededReactionRequest,
        markPendingReactionOpSuperseded,
    };
}
