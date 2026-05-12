const LINK_MESSAGE_PATTERN = /((https?:\/\/|www\.)[^\s<]+)/i;
const OFFLINE_RETRY_MESSAGE = '\u0421\u0432\u044F\u0437\u044C \u0441 \u0441\u0435\u0440\u0432\u0435\u0440\u043E\u043C \u0435\u0449\u0451 \u043D\u0435 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u043B\u0430\u0441\u044C. \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0443 \u0447\u0435\u0440\u0435\u0437 \u043F\u0430\u0440\u0443 \u0441\u0435\u043A\u0443\u043D\u0434.';
const OFFLINE_QUEUED_MESSAGE = '\u0421\u0432\u044F\u0437\u044C \u0441 \u0441\u0435\u0440\u0432\u0435\u0440\u043E\u043C \u0435\u0449\u0451 \u043D\u0435 \u0432\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u0438\u043B\u0430\u0441\u044C. \u0421\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u043E \u0434\u043B\u044F \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u043E\u0439 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438.';

function shouldKeepMobileComposerEnabled() {
    return Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
}

function markUnavailableMessage(clientId, failPendingMessage, showToast, message = OFFLINE_RETRY_MESSAGE) {
    if (typeof failPendingMessage === 'function') {
        failPendingMessage(clientId);
    }
    if (typeof showToast === 'function') {
        showToast(message, 'warning');
    }
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

    setKeepChatPinnedToBottom(true);
    clearComposerInput();
    resizeComposerInput();

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
    }, { renderOptions: { force: true, scrollToBottom: true } });

    updateActiveContactLastMessage(
        message,
        true,
        { pending: true, is_read: false, is_delivered: false },
        sentAt,
    );
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
        if (!emitted) {
            if (typeof enqueueOutbox !== 'function') {
                markUnavailableMessage(clientId, failPendingMessage, showToast);
                return;
            }
            try {
                const queued = await enqueueOutbox({
                    clientId,
                    eventName: 'send_message',
                    payload: sendPayload,
                });
                if (!queued) {
                    markUnavailableMessage(clientId, failPendingMessage, showToast);
                    return;
                }
                markUnavailableMessage(clientId, failPendingMessage, showToast, OFFLINE_QUEUED_MESSAGE);
                return;
            } catch (_) {
                markUnavailableMessage(clientId, failPendingMessage, showToast);
                return;
            }
        }
        schedulePendingTimeout(clientId);
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
