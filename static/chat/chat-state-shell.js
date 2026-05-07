export function createChatStateShell(options = {}) {
    const {
        chatStates,
        chatDefaultMessageHeight,
        chatDaySeparatorHeight,
        chatVirtualizationMinMessages,
        chatVirtualWindowSize,
        chatVirtualBuffer,
        getMessageKey,
        getMessageDayKey,
        formatDaySeparatorLabel,
        parseUtcDate,
        getReactionMessageKey,
        clearPendingReactionOpByMessage,
        syncDeletedMessagesToCache,
        invalidateChatDomSnapshot,
        scheduleProfileMediaPanelRefresh,
        getChatMessagesClientHeight,
        onRemoveMessageId,
    } = options;

    function createChatState() {
        return {
            initialized: false,
            isLoadingInitial: false,
            isLoadingOlder: false,
            historyRequestToken: 0,
            historyOlderToken: 0,
            messages: [],
            pins: [],
            pin: null,
            activePinMessageId: null,
            favorites: [],
            favorite: null,
            activeFavoriteMessageId: null,
            hasMoreBefore: true,
            savedScrollTop: 0,
            hasSavedScrollTop: false,
            blockState: { is_blocked: false, blocked_by_me: false, blocked_me: false },
            lastRenderRange: null,
            messageHeights: new Map(),
            averageMessageHeight: chatDefaultMessageHeight,
            renderedKeys: new Set(),
            domSnapshot: null,
        };
    }

    function getChatState(chatId) {
        const key = String(chatId || '');
        if (!chatStates.has(key)) {
            chatStates.set(key, createChatState());
        }
        return chatStates.get(key);
    }

    function findMessageIndex(state, predicate) {
        if (!state || typeof predicate !== 'function') return -1;
        for (let i = 0; i < state.messages.length; i += 1) {
            if (predicate(state.messages[i], i)) return i;
        }
        return -1;
    }

    function findMessageById(chatId, msgId) {
        const state = getChatState(chatId);
        const index = findMessageIndex(state, (msg) => Number(msg.id) === Number(msgId));
        return index >= 0 ? state.messages[index] : null;
    }

    function normalizePinnedMessages(rawPins) {
        if (!Array.isArray(rawPins)) return [];
        const seen = new Set();
        return rawPins.reduce((result, pin) => {
            const messageId = Number(pin?.message_id ?? pin?.messageId);
            if (!Number.isFinite(messageId) || messageId <= 0 || seen.has(messageId)) {
                return result;
            }
            seen.add(messageId);
            result.push({
                message_id: messageId,
                message_content: String(pin?.message_content ?? pin?.preview ?? ''),
                sender_pub: String(pin?.sender_pub || ''),
                pinned_at: String(pin?.pinned_at || ''),
                created_at: String(pin?.created_at || pin?.createdAt || ''),
            });
            return result;
        }, []).sort((left, right) => {
            const leftDate = parseUtcDate(left.created_at);
            const rightDate = parseUtcDate(right.created_at);
            const leftTs = leftDate ? leftDate.getTime() : Number(left.message_id);
            const rightTs = rightDate ? rightDate.getTime() : Number(right.message_id);
            if (leftTs !== rightTs) return leftTs - rightTs;
            return Number(left.message_id) - Number(right.message_id);
        });
    }

    function isPinnedMessage(chatId, msgId) {
        const normalizedMessageId = Number(msgId);
        if (!Number.isFinite(normalizedMessageId) || normalizedMessageId <= 0) return false;
        return getChatState(chatId).pins.some((pin) => Number(pin.message_id) === normalizedMessageId);
    }

    function setChatPinnedMessages(chatId, rawPins, { activeMessageId = null } = {}) {
        const state = getChatState(chatId);
        const normalizedPins = normalizePinnedMessages(rawPins);
        state.pins = normalizedPins;
        state.pin = normalizedPins[0] || null;

        const normalizedActiveMessageId = Number(activeMessageId);
        if (normalizedPins.length === 0) {
            state.activePinMessageId = null;
        } else if (Number.isFinite(normalizedActiveMessageId) && normalizedActiveMessageId > 0) {
            state.activePinMessageId = normalizedPins.some((pin) => Number(pin.message_id) === normalizedActiveMessageId)
                ? normalizedActiveMessageId
                : Number(normalizedPins[0].message_id);
        } else if (
            state.activePinMessageId
            && normalizedPins.some((pin) => Number(pin.message_id) === Number(state.activePinMessageId))
        ) {
            state.activePinMessageId = Number(state.activePinMessageId);
        } else {
            state.activePinMessageId = Number(normalizedPins[0].message_id);
        }

        return state.pins;
    }

    function upsertChatPinnedMessage(chatId, rawPin, { makeActive = true } = {}) {
        const normalizedPin = normalizePinnedMessages([rawPin])[0] || null;
        if (!normalizedPin) {
            return getChatState(chatId).pins;
        }
        const state = getChatState(chatId);
        const nextPins = [
            normalizedPin,
            ...state.pins.filter((pin) => Number(pin.message_id) !== Number(normalizedPin.message_id)),
        ];
        return setChatPinnedMessages(chatId, nextPins, {
            activeMessageId: makeActive ? normalizedPin.message_id : state.activePinMessageId,
        });
    }

    function removeChatPinnedMessage(chatId, msgId) {
        const normalizedMessageId = Number(msgId);
        const state = getChatState(chatId);
        if (!Number.isFinite(normalizedMessageId) || normalizedMessageId <= 0) {
            return setChatPinnedMessages(chatId, []);
        }
        const nextPins = state.pins.filter((pin) => Number(pin.message_id) !== normalizedMessageId);
        return setChatPinnedMessages(chatId, nextPins, {
            activeMessageId: state.activePinMessageId === normalizedMessageId ? null : state.activePinMessageId,
        });
    }

    function normalizeFavoriteMessages(rawFavorites) {
        if (!Array.isArray(rawFavorites)) return [];
        const seen = new Set();
        return rawFavorites.reduce((result, favorite) => {
            const messageId = Number(favorite?.message_id ?? favorite?.messageId);
            if (!Number.isFinite(messageId) || messageId <= 0 || seen.has(messageId)) {
                return result;
            }
            seen.add(messageId);
            result.push({
                message_id: messageId,
                message_content: String(favorite?.message_content ?? favorite?.preview ?? ''),
                sender_pub: String(favorite?.sender_pub || ''),
                favorited_at: String(favorite?.favorited_at || ''),
                created_at: String(favorite?.created_at || favorite?.createdAt || ''),
            });
            return result;
        }, []).sort((left, right) => {
            const leftDate = parseUtcDate(left.favorited_at || left.created_at);
            const rightDate = parseUtcDate(right.favorited_at || right.created_at);
            const leftTs = leftDate ? leftDate.getTime() : Number(left.message_id);
            const rightTs = rightDate ? rightDate.getTime() : Number(right.message_id);
            if (leftTs !== rightTs) return rightTs - leftTs;
            return Number(right.message_id) - Number(left.message_id);
        });
    }

    function isFavoriteMessage(chatId, msgId) {
        const normalizedMessageId = Number(msgId);
        if (!Number.isFinite(normalizedMessageId) || normalizedMessageId <= 0) return false;
        return getChatState(chatId).favorites.some((favorite) => Number(favorite.message_id) === normalizedMessageId);
    }

    function setChatFavoriteMessages(chatId, rawFavorites, { activeMessageId = null } = {}) {
        const state = getChatState(chatId);
        const normalizedFavorites = normalizeFavoriteMessages(rawFavorites);
        state.favorites = normalizedFavorites;
        state.favorite = normalizedFavorites[0] || null;

        const normalizedActiveMessageId = Number(activeMessageId);
        if (normalizedFavorites.length === 0) {
            state.activeFavoriteMessageId = null;
        } else if (Number.isFinite(normalizedActiveMessageId) && normalizedActiveMessageId > 0) {
            state.activeFavoriteMessageId = normalizedFavorites.some((favorite) => Number(favorite.message_id) === normalizedActiveMessageId)
                ? normalizedActiveMessageId
                : Number(normalizedFavorites[0].message_id);
        } else if (
            state.activeFavoriteMessageId
            && normalizedFavorites.some((favorite) => Number(favorite.message_id) === Number(state.activeFavoriteMessageId))
        ) {
            state.activeFavoriteMessageId = Number(state.activeFavoriteMessageId);
        } else {
            state.activeFavoriteMessageId = Number(normalizedFavorites[0].message_id);
        }

        return state.favorites;
    }

    function upsertChatFavoriteMessage(chatId, rawFavorite, { makeActive = true } = {}) {
        const normalizedFavorite = normalizeFavoriteMessages([rawFavorite])[0] || null;
        if (!normalizedFavorite) {
            return getChatState(chatId).favorites;
        }
        const state = getChatState(chatId);
        const nextFavorites = [
            normalizedFavorite,
            ...state.favorites.filter((favorite) => Number(favorite.message_id) !== Number(normalizedFavorite.message_id)),
        ];
        return setChatFavoriteMessages(chatId, nextFavorites, {
            activeMessageId: makeActive ? normalizedFavorite.message_id : state.activeFavoriteMessageId,
        });
    }

    function removeChatFavoriteMessage(chatId, msgId) {
        const normalizedMessageId = Number(msgId);
        const state = getChatState(chatId);
        if (!Number.isFinite(normalizedMessageId) || normalizedMessageId <= 0) {
            return setChatFavoriteMessages(chatId, []);
        }
        const nextFavorites = state.favorites.filter((favorite) => Number(favorite.message_id) !== normalizedMessageId);
        return setChatFavoriteMessages(chatId, nextFavorites, {
            activeMessageId: state.activeFavoriteMessageId === normalizedMessageId ? null : state.activeFavoriteMessageId,
        });
    }

    function getMessageTimestamp(msg) {
        const createdAt = parseUtcDate(msg?.created_at);
        if (createdAt) return createdAt.getTime();
        if (msg?.pending) return Number.MAX_SAFE_INTEGER - 1;
        return Number.MAX_SAFE_INTEGER;
    }

    function compareChatMessages(left, right) {
        const leftTs = getMessageTimestamp(left);
        const rightTs = getMessageTimestamp(right);
        if (leftTs !== rightTs) return leftTs - rightTs;
        const leftId = Number(left?.id);
        const rightId = Number(right?.id);
        const leftHasId = Number.isFinite(leftId) && leftId > 0;
        const rightHasId = Number.isFinite(rightId) && rightId > 0;
        if (leftHasId && rightHasId && leftId !== rightId) return leftId - rightId;
        if (leftHasId && !rightHasId) return -1;
        if (!leftHasId && rightHasId) return 1;
        return 0;
    }

    function normalizeChatMessageOrder(state) {
        if (!state?.messages?.length) return;
        state.messages = state.messages
            .map((msg, index) => ({ msg, index }))
            .sort((a, b) => {
                const byMessage = compareChatMessages(a.msg, b.msg);
                if (byMessage !== 0) return byMessage;
                return a.index - b.index;
            })
            .map((entry) => entry.msg);
    }

    function upsertChatMessage(chatId, message, { append = true } = {}) {
        const state = getChatState(chatId);
        const key = getMessageKey(message);
        const existingIndex = findMessageIndex(state, (item) => getMessageKey(item) === key || (message.id && Number(item.id) === Number(message.id)));
        if (existingIndex >= 0) {
            state.messages[existingIndex] = { ...state.messages[existingIndex], ...message };
            normalizeChatMessageOrder(state);
            invalidateChatDomSnapshot(chatId);
            scheduleProfileMediaPanelRefresh(chatId);
            return state.messages[existingIndex];
        }
        if (append) {
            state.messages.push(message);
        } else {
            state.messages.unshift(message);
        }
        normalizeChatMessageOrder(state);
        invalidateChatDomSnapshot(chatId);
        scheduleProfileMediaPanelRefresh(chatId);
        return message;
    }

    function prependChatMessages(chatId, messages) {
        const state = getChatState(chatId);
        const incoming = Array.isArray(messages) ? messages : [];
        const deduped = incoming.filter((msg) => findMessageIndex(state, (item) => getMessageKey(item) === getMessageKey(msg) || (msg.id && Number(item.id) === Number(msg.id))) === -1);
        if (!deduped.length) return 0;
        state.messages = [...deduped, ...state.messages];
        normalizeChatMessageOrder(state);
        invalidateChatDomSnapshot(chatId);
        scheduleProfileMediaPanelRefresh(chatId);
        return deduped.length;
    }

    function setChatMessages(chatId, messages, { resetHeights = false } = {}) {
        const state = getChatState(chatId);
        state.messages = Array.isArray(messages) ? [...messages] : [];
        normalizeChatMessageOrder(state);
        if (resetHeights) {
            state.messageHeights = new Map();
            state.averageMessageHeight = chatDefaultMessageHeight;
            state.renderedKeys = new Set();
        }
        state.lastRenderRange = null;
        invalidateChatDomSnapshot(chatId);
        scheduleProfileMediaPanelRefresh(chatId);
    }

    function estimateMessageHeight(state, msg) {
        const cached = state.messageHeights.get(getMessageKey(msg));
        if (Number.isFinite(cached) && cached > 0) return cached;
        return state.averageMessageHeight || chatDefaultMessageHeight;
    }

    function removeChatMessages(chatId, msgIds) {
        const ids = new Set((Array.isArray(msgIds) ? msgIds : [msgIds]).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0));
        if (!ids.size) return;
        const state = getChatState(chatId);
        state.messages = state.messages.filter((msg) => !ids.has(Number(msg.id)));
        ids.forEach((msgId) => {
            clearPendingReactionOpByMessage(chatId, msgId);
            onRemoveMessageId?.(chatId, msgId, getReactionMessageKey(chatId, msgId));
        });
        invalidateChatDomSnapshot(chatId);
        scheduleProfileMediaPanelRefresh(chatId);
        syncDeletedMessagesToCache(chatId, Array.from(ids));
        return ids;
    }

    function createDaySeparatorNode(rawValue, dayKey) {
        const separator = document.createElement('div');
        separator.className = 'chat-day-separator';
        separator.setAttribute('data-day-key', dayKey || '');
        const label = document.createElement('span');
        label.className = 'chat-day-separator__label';
        label.textContent = formatDaySeparatorLabel(rawValue) || dayKey || '';
        separator.appendChild(label);
        return separator;
    }

    function sumEstimatedHeights(state, startIndex, endIndex) {
        let total = 0;
        let previousDayKey = startIndex > 0
            ? getMessageDayKey(state.messages[startIndex - 1]?.created_at)
            : '';
        for (let i = startIndex; i < endIndex; i += 1) {
            const msg = state.messages[i];
            const dayKey = getMessageDayKey(msg?.created_at);
            if (dayKey && dayKey !== previousDayKey) {
                total += chatDaySeparatorHeight;
            }
            total += estimateMessageHeight(state, msg);
            previousDayKey = dayKey;
        }
        return total;
    }

    function getDesiredRenderRange(state, scrollTop = 0) {
        const total = state.messages.length;
        if (total <= chatVirtualizationMinMessages) {
            return { start: 0, end: total };
        }

        const avgHeight = Math.max(48, state.averageMessageHeight || chatDefaultMessageHeight);
        const viewportHeight = Math.max(Number(getChatMessagesClientHeight?.() || 0), avgHeight * 4);
        const approxVisibleCount = Math.max(10, Math.ceil(viewportHeight / avgHeight));
        const windowSize = Math.max(chatVirtualWindowSize, approxVisibleCount + (chatVirtualBuffer * 2));

        let start = Math.max(0, Math.floor(scrollTop / avgHeight) - chatVirtualBuffer);
        let end = Math.min(total, start + windowSize);
        start = Math.max(0, end - windowSize);
        return { start, end };
    }

    function createVirtualSpacer(heightPx) {
        const spacer = document.createElement('div');
        spacer.className = 'chat-virtual-spacer';
        spacer.style.height = `${Math.max(0, Math.round(heightPx))}px`;
        spacer.setAttribute('aria-hidden', 'true');
        return spacer;
    }

    return {
        createChatState,
        getChatState,
        findMessageIndex,
        findMessageById,
        normalizePinnedMessages,
        isPinnedMessage,
        setChatPinnedMessages,
        upsertChatPinnedMessage,
        removeChatPinnedMessage,
        normalizeFavoriteMessages,
        isFavoriteMessage,
        setChatFavoriteMessages,
        upsertChatFavoriteMessage,
        removeChatFavoriteMessage,
        getMessageTimestamp,
        compareChatMessages,
        normalizeChatMessageOrder,
        upsertChatMessage,
        prependChatMessages,
        setChatMessages,
        estimateMessageHeight,
        removeChatMessages,
        createDaySeparatorNode,
        sumEstimatedHeights,
        getDesiredRenderRange,
        createVirtualSpacer,
    };
}
