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
} = {}) {
    const currentUtcText = () => new Date().toISOString().slice(0, 19).replace('T', ' ');

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
}
