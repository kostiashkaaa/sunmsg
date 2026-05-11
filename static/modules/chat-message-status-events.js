import {
    applyGroupReadMetaToElement,
    applyGroupReadUpdateToMessage,
    normalizeGroupReadUpdate,
} from './chat-group-read-receipts.js';

export function registerMessageStatusSocketHandlers({
    socket,
    isBlockedChat,
    removeChatMessages,
    getCurrentChatId,
    rerenderCurrentChat,
    loadContacts,
    getChatState,
    findMessageIndex,
    cancelPendingTimeout,
    getMessageKey,
    normalizeChatMessageOrder,
    currentChatMessagesEl,
    applyTickToElement,
    formatTime,
    formatFullTimestamp,
    patchMessageReactions,
    updateSidebarContactTick,
    getContactsRoot,
    markAllTicksRead,
    onMessagesMarkedRead,
    isGroupChatById = () => false,
    failPendingMessage = () => {},
    showToast = () => {},
} = {}) {
    const currentUtcText = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
    const normalizeErrorText = (value) => {
        if (!value || typeof value !== 'object') return String(value || '').trim();
        return String(value.message || value.error || '').trim();
    };
    const normalizePendingClientId = (value) => {
        if (!value || typeof value !== 'object') return '';
        return String(value.request_id || value.client_id || '').trim();
    };
    const parseExplicitGroupFlag = (rawValue) => {
        if (
            rawValue === true
            || rawValue === false
            || rawValue === 1
            || rawValue === 0
            || rawValue === '1'
            || rawValue === '0'
            || rawValue === 'true'
            || rawValue === 'false'
        ) {
            const normalized = String(rawValue).trim().toLowerCase();
            return normalized === '1' || normalized === 'true';
        }
        return null;
    };

    const handleDeleteEvent = (data) => {
        const ids = data.msg_id ? [data.msg_id] : (data.msg_ids || []);
        removeChatMessages(data.chat_id, ids);
        if (String(data?.chat_id || '') === String(getCurrentChatId() || '')) {
            rerenderCurrentChat();
        }
        loadContacts();
    };

    socket.on('message_deleted', handleDeleteEvent);
    socket.on('messages_deleted', handleDeleteEvent);

    socket.on('error', (data) => {
        const clientId = normalizePendingClientId(data);
        const code = String(data?.code || '').trim();
        if (clientId && code !== 'duplicate_request') {
            cancelPendingTimeout?.(clientId);
            failPendingMessage?.(clientId);
        }

        const message = normalizeErrorText(data);
        if (message) {
            showToast?.(message, 'warning');
        }
    });

    socket.on('message_sent', (data) => {
        if (!data?.client_id) return;
        const chatId = data.chat_id || getCurrentChatId();
        const state = getChatState(chatId);
        const pendingIndex = findMessageIndex(state, (msg) => msg.clientId === data.client_id);
        if (pendingIndex < 0) return;

        cancelPendingTimeout(data.client_id);
        const pendingMessage = state.messages[pendingIndex];
        const previousKey = getMessageKey(pendingMessage);
        const confirmedMessage = {
            ...pendingMessage,
            id: data.id,
            pending: false,
            failed: false,
            clientId: null,
            is_read: Boolean(data.is_read),
            read_at: String(data.read_at || pendingMessage.read_at || '').trim() || null,
            is_delivered: Boolean(data.is_delivered),
            voice_listened_by_partner: Boolean(data.voice_listened_by_partner),
            created_at: data.created_at || pendingMessage.created_at,
        };
        state.messages[pendingIndex] = confirmedMessage;
        normalizeChatMessageOrder(state);
        const newKey = getMessageKey(confirmedMessage);

        const cachedHeight = state.messageHeights.get(previousKey);
        if (Number.isFinite(cachedHeight) && cachedHeight > 0) {
            state.messageHeights.delete(previousKey);
            state.messageHeights.set(newKey, cachedHeight);
        }

        if (state.renderedKeys.has(previousKey)) {
            state.renderedKeys.delete(previousKey);
            state.renderedKeys.add(newKey);
        }

        if (String(chatId || '') !== String(getCurrentChatId() || '')) return;

        const msgEl = currentChatMessagesEl?.querySelector(
            data.client_id
                ? `.message[data-client-id="${CSS.escape(data.client_id)}"]`
                : '.message[data-pending="true"].self'
        );
        if (!msgEl) return;

        msgEl.setAttribute('data-msg-id', String(data.id));
        msgEl.setAttribute('data-message-key', newKey);
        msgEl.removeAttribute('data-pending');
        msgEl.removeAttribute('data-client-id');
        const tick = msgEl.querySelector('.msg-tick');
        if (tick) {
            applyTickToElement(tick, confirmedMessage);
        }
        if (data.created_at) {
            const timeEl = msgEl.querySelector('.msg-time');
            if (timeEl) {
                timeEl.textContent = formatTime(data.created_at);
                timeEl.title = formatFullTimestamp(data.created_at);
                timeEl.setAttribute('data-created-at', data.created_at);
            }
        }
        patchMessageReactions(msgEl, confirmedMessage.reactions, { animate: false });
        updateSidebarContactTick(chatId, confirmedMessage, getContactsRoot());
    });

    socket.on('messages_delivered', (data) => {
        if (isBlockedChat(data.chat_id)) return;
        const deliveredIds = new Set((data.message_ids || []).map((id) => Number(id)).filter((id) => Number.isFinite(id)));
        const state = getChatState(data.chat_id);

        if (state.initialized) {
            state.messages = state.messages.map((msg) => {
                if (msg.sender !== 'self' || msg.is_read) return msg;
                if (deliveredIds.size > 0 && !deliveredIds.has(Number(msg.id))) return msg;
                return { ...msg, is_delivered: true, pending: false };
            });
        }

        if (String(data?.chat_id || '') === String(getCurrentChatId() || '')) {
            currentChatMessagesEl?.querySelectorAll('.message.self').forEach((messageEl) => {
                const msgId = Number(messageEl.getAttribute('data-msg-id'));
                if (deliveredIds.size > 0 && !deliveredIds.has(msgId)) return;
                const tickEl = messageEl.querySelector('.msg-tick');
                if (!tickEl || tickEl.classList.contains('read')) return;
                applyTickToElement(tickEl, { is_read: false, is_delivered: true, pending: false });
            });
        }

        updateSidebarContactTick(data.chat_id, 'delivered', getContactsRoot());
    });

    socket.on('messages_read', (data) => {
        if (isBlockedChat(data.chat_id)) return;
        const explicitGroupFlag = parseExplicitGroupFlag(data?.is_group);
        const isGroupReadEvent = explicitGroupFlag !== null
            ? explicitGroupFlag
            : isGroupChatById(data.chat_id);
        if (isGroupReadEvent) {
            return;
        }
        const readAt = String(data?.read_at || '').trim() || currentUtcText();
        const state = getChatState(data.chat_id);
        if (state.initialized) {
            state.messages = state.messages.map((msg) => (
                msg.sender === 'self'
                    ? (
                        msg.is_read
                            ? msg
                            : { ...msg, is_read: true, is_delivered: true, pending: false, read_at: readAt || null }
                    )
                    : msg
            ));
        }
        if (String(data.chat_id) === String(getCurrentChatId())) {
            markAllTicksRead(readAt);
        }

        updateSidebarContactTick(data.chat_id, 'read', getContactsRoot());
        onMessagesMarkedRead?.({
            chatId: data.chat_id,
            readAt,
        });
    });

    socket.on('group_messages_read', (data) => {
        if (isBlockedChat(data?.chat_id)) return;
        const normalizedChatId = String(data?.chat_id || '').trim();
        if (!normalizedChatId) return;
        const rawUpdates = Array.isArray(data?.updates) ? data.updates : [];
        if (!rawUpdates.length) return;

        const normalizedUpdates = rawUpdates
            .map((item) => normalizeGroupReadUpdate(item))
            .filter((item) => item && Number.isFinite(item.messageId) && item.messageId > 0);
        if (!normalizedUpdates.length) return;

        const updateMap = new Map();
        normalizedUpdates.forEach((item) => {
            updateMap.set(item.messageId, item);
        });
        const state = getChatState(normalizedChatId);
        if (state.initialized) {
            state.messages = state.messages.map((msg) => {
                if (msg.sender !== 'self') return msg;
                const messageId = Number(msg.id);
                if (!Number.isFinite(messageId) || messageId <= 0) return msg;
                const update = updateMap.get(messageId);
                if (!update) return msg;
                return applyGroupReadUpdateToMessage(msg, update);
            });
        }

        if (String(normalizedChatId) === String(getCurrentChatId())) {
            normalizedUpdates.forEach((update) => {
                const messageEl = currentChatMessagesEl?.querySelector(`.message.self[data-msg-id="${update.messageId}"]`);
                if (!messageEl) return;
                const stateMessage = state?.initialized
                    ? state.messages.find((msg) => Number(msg.id) === Number(update.messageId))
                    : null;
                const patchedMessage = stateMessage || applyGroupReadUpdateToMessage(
                    {
                        sender: 'self',
                        group_read_count: 0,
                        group_readers: [],
                        is_read: false,
                        is_delivered: true,
                        pending: false,
                        read_at: null,
                    },
                    update,
                );

                applyGroupReadMetaToElement(messageEl, patchedMessage, { isGroupChat: true });
                const tickEl = messageEl.querySelector('.msg-tick');
                if (tickEl) {
                    applyTickToElement(tickEl, patchedMessage);
                }
            });
        }

        if (normalizedUpdates.some((item) => item.readCount > 0)) {
            updateSidebarContactTick(normalizedChatId, 'read', getContactsRoot());
        }
        onMessagesMarkedRead?.({
            chatId: normalizedChatId,
            readerUserId: Number(data?.reader_user_id) || null,
            messageIds: normalizedUpdates.map((item) => item.messageId),
            isGroup: true,
        });
    });
}
