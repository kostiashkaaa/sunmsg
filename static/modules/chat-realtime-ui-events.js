export function registerRealtimeUiSocketHandlers({
    socket,
    getChatState,
    getCurrentChatId,
    upsertChatPinnedMessage,
    removeChatPinnedMessage,
    setChatPinnedMessages,
    upsertChatFavoriteMessage,
    removeChatFavoriteMessage,
    setChatFavoriteMessages,
    restorePinnedBar,
    restoreFavoriteBar,
    patchPinnedMessageState,
    clearPinnedMessageStates,
    patchFavoriteMessageState,
    clearFavoriteMessageStates,
    getReactionMessageKey,
    getReactionEventTimestamp,
    reactionUpdateStampByMessage,
    clearPendingReactionOp,
    clearPendingReactionOpByMessage,
    isSupersededReactionRequest,
    forgetSupersededReactionRequest,
    updateMessageReactionsState,
    getActiveReactionMessageId,
    closeReactionPicker,
    resolveCurrentChatMessageElement,
    patchMessageReactions,
    rerenderCurrentChat,
} = {}) {
    socket.on('message_pinned', async (data) => {
        const nextPins = upsertChatPinnedMessage?.(
            data.chat_id,
            {
                message_id: data.message_id,
                message_content: data.message_content,
                sender_pub: data.sender_pub,
                pinned_at: data.pinned_at,
                created_at: data.created_at,
            },
            { makeActive: true },
        ) || getChatState(data.chat_id).pins || [];

        if (String(data?.chat_id || '') !== String(getCurrentChatId() || '')) return;
        await restorePinnedBar?.(nextPins, { activeMessageId: data.message_id });
        const pinnedMessageEl = resolveCurrentChatMessageElement?.(data.message_id);
        if (pinnedMessageEl) {
            patchPinnedMessageState?.(pinnedMessageEl, true);
        }
    });

    socket.on('message_unpinned', async (data) => {
        const nextPins = data.message_id
            ? (removeChatPinnedMessage?.(data.chat_id, data.message_id) || getChatState(data.chat_id).pins || [])
            : (setChatPinnedMessages?.(data.chat_id, []) || []);

        if (String(data?.chat_id || '') !== String(getCurrentChatId() || '')) return;
        await restorePinnedBar?.(nextPins, {
            activeMessageId: getChatState(data.chat_id).activePinMessageId,
        });
        if (data.message_id) {
            const unpinnedMessageEl = resolveCurrentChatMessageElement?.(data.message_id);
            if (unpinnedMessageEl) {
                patchPinnedMessageState?.(unpinnedMessageEl, false);
            }
            return;
        }
        clearPinnedMessageStates?.();
    });

    socket.on('message_favorited', async (data) => {
        const nextFavorites = upsertChatFavoriteMessage?.(
            data.chat_id,
            {
                message_id: data.message_id,
                message_content: data.message_content,
                sender_pub: data.sender_pub,
                favorited_at: data.favorited_at,
                created_at: data.created_at,
            },
            { makeActive: true },
        ) || getChatState(data.chat_id).favorites || [];

        if (String(data?.chat_id || '') !== String(getCurrentChatId() || '')) return;
        await restoreFavoriteBar?.(nextFavorites, { activeMessageId: data.message_id });
        const favoritedMessageEl = resolveCurrentChatMessageElement?.(data.message_id);
        if (favoritedMessageEl) {
            patchFavoriteMessageState?.(favoritedMessageEl, true);
        }
    });

    socket.on('message_unfavorited', async (data) => {
        const nextFavorites = data.message_id
            ? (removeChatFavoriteMessage?.(data.chat_id, data.message_id) || getChatState(data.chat_id).favorites || [])
            : (setChatFavoriteMessages?.(data.chat_id, []) || []);

        if (String(data?.chat_id || '') !== String(getCurrentChatId() || '')) return;
        await restoreFavoriteBar?.(nextFavorites, {
            activeMessageId: getChatState(data.chat_id).activeFavoriteMessageId,
        });
        if (data.message_id) {
            const unfavoritedMessageEl = resolveCurrentChatMessageElement?.(data.message_id);
            if (unfavoritedMessageEl) {
                patchFavoriteMessageState?.(unfavoritedMessageEl, false);
            }
            return;
        }
        clearFavoriteMessageStates?.();
    });

    socket.on('message_reactions_updated', (data) => {
        const chatId = String(data?.chat_id || '');
        const messageId = Number(data?.message_id);
        if (!chatId || !Number.isFinite(messageId) || messageId <= 0) return;

        const reactionKey = getReactionMessageKey(chatId, messageId);
        const incomingStamp = getReactionEventTimestamp(data?.updated_at);
        const knownStamp = reactionUpdateStampByMessage.get(reactionKey) || 0;
        if (incomingStamp < knownStamp) {
            return;
        }
        reactionUpdateStampByMessage.set(reactionKey, incomingStamp);

        const requestId = String(data?.request_id || '').trim();
        let settledOperation = null;
        if (requestId) {
            settledOperation = clearPendingReactionOp(requestId);
        } else {
            settledOperation = clearPendingReactionOpByMessage(chatId, messageId);
        }
        const isSupersededLocalEcho = Boolean(
            requestId
            && (
                settledOperation?.superseded
                || isSupersededReactionRequest?.(requestId)
            )
        );
        if (isSupersededLocalEcho) {
            forgetSupersededReactionRequest?.(requestId);
            return;
        }

        if (requestId) {
            forgetSupersededReactionRequest?.(requestId);
        }
        const isLocalOptimisticEcho = Boolean(
            settledOperation
            && String(settledOperation.chatId || '') === chatId
            && Number(settledOperation.messageId) === messageId
        );

        const changed = updateMessageReactionsState(chatId, messageId, data.reactions);
        if (String(chatId || '') !== String(getCurrentChatId() || '')) return;
        if (getActiveReactionMessageId() === messageId) {
            closeReactionPicker();
        }

        const messageEl = resolveCurrentChatMessageElement(messageId);
        if (messageEl) {
            patchMessageReactions(messageEl, data.reactions, { animate: changed && !isLocalOptimisticEcho });
            return;
        }
        if (changed) {
            rerenderCurrentChat();
        }
    });
}
