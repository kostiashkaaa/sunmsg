const LINK_MESSAGE_PATTERN = /((https?:\/\/|www\.)[^\s<]+)/i;

function shouldKeepMobileComposerEnabled() {
    return Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
}

export async function sendTextMessageFlow({
    message,
    isGroupChat = false,
    isChatBlocked,
    getBlockedNoticeText,
    currentBlockState,
    showToast,
    setSendingState,
    encryptForCurrentChat,
    getReplyState,
    cancelReply,
    emitSocket,
    currentChatId,
    appendMessage,
    setKeepChatPinnedToBottom,
    updateActiveContactLastMessage,
    schedulePendingTimeout,
    clearComposerInput,
    resizeComposerInput,
    restoreComposerFocus,
    prewarmMessageLinkPreview,
    enqueueOutbox,
    failPendingMessage,
} = {}) {
    if (isChatBlocked()) {
        showToast(getBlockedNoticeText(currentBlockState), 'warning');
        return;
    }

    let isSent = false;
    const keepComposerEnabled = shouldKeepMobileComposerEnabled();
    if (!keepComposerEnabled) {
        setSendingState(true);
    }
    const clientId = crypto.randomUUID();
    const sentAt = new Date().toISOString();
    const isLink = LINK_MESSAGE_PATTERN.test(message);
    const msgType = isLink ? 'link' : 'text';

    const {
        replyToId: snapReplyId,
        replyToText: snapReplyText,
        replyToSender: snapReplySender,
    } = getReplyState();
    cancelReply();

    appendMessage({
        sender: 'self',
        message,
        encrypted: true,
        is_read: false,
        is_delivered: false,
        created_at: sentAt,
        pending: true,
        clientId,
        replyToId: snapReplyId,
        replyToText: snapReplyText,
        replyToSender: snapReplySender,
        ...(isGroupChat ? { group_read_count: 0, group_readers: [] } : {}),
        reactions: [],
    }, { renderOptions: { scrollToBottom: true } });

    setKeepChatPinnedToBottom(true);
    updateActiveContactLastMessage(
        message,
        true,
        { pending: true, is_read: false, is_delivered: false },
        sentAt,
    );
    clearComposerInput();
    requestAnimationFrame(() => {
        resizeComposerInput();
    });
    isSent = true;

    try {
        if (typeof prewarmMessageLinkPreview === 'function') {
            void prewarmMessageLinkPreview(message, { delayMs: 0, awaitReady: false });
        }

        const encryptedPayloadStr = await encryptForCurrentChat(message);

        const sendPayload = {
            message: encryptedPayloadStr,
            chat_id: currentChatId,
            message_type: msgType,
            client_id: clientId,
            reply_to_id: snapReplyId,
            request_id: clientId,
        };
        const emitted = emitSocket('send_message', sendPayload, { requireConnected: true });
        let isQueuedOffline = false;
        if (!emitted) {
            if (typeof enqueueOutbox !== 'function') {
                if (typeof failPendingMessage === 'function') {
                    failPendingMessage(clientId);
                }
                return;
            }
            try {
                const queued = await enqueueOutbox({
                    clientId,
                    eventName: 'send_message',
                    payload: sendPayload,
                });
                if (!queued) {
                    if (typeof failPendingMessage === 'function') {
                        failPendingMessage(clientId);
                    }
                    return;
                }
                isQueuedOffline = true;
            } catch (_) {
                if (typeof failPendingMessage === 'function') {
                    failPendingMessage(clientId);
                }
                return;
            }
        }
        if (!isQueuedOffline) {
            schedulePendingTimeout(clientId);
        }
    } catch (error) {
        if (typeof failPendingMessage === 'function') {
            failPendingMessage(clientId);
        }
        throw error;
    } finally {
        setSendingState(false);
        if (isSent) restoreComposerFocus();
    }
}
