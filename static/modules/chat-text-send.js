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
    try {
        if (typeof prewarmMessageLinkPreview === 'function') {
            await prewarmMessageLinkPreview(message, { delayMs: 0, awaitReady: true });
        }

        const isLink = LINK_MESSAGE_PATTERN.test(message);
        const msgType = isLink ? 'link' : 'text';
        const clientId = crypto.randomUUID();

        const encryptedPayloadStr = await encryptForCurrentChat(message);
        const {
            replyToId: snapReplyId,
            replyToText: snapReplyText,
            replyToSender: snapReplySender,
        } = getReplyState();
        cancelReply();

        const emitted = emitSocket('send_message', {
            message: encryptedPayloadStr,
            chat_id: currentChatId,
            message_type: msgType,
            client_id: clientId,
            reply_to_id: snapReplyId,
        }, { requireConnected: true });
        if (!emitted) {
            return;
        }

        const sentAt = new Date().toISOString();
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

        setKeepChatPinnedToBottom(true);
        updateActiveContactLastMessage(
            message,
            true,
            { pending: true, is_read: false, is_delivered: false },
            sentAt,
        );
        schedulePendingTimeout(clientId);

        clearComposerInput();
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                resizeComposerInput();
            });
        });

        isSent = true;
    } finally {
        setSendingState(false);
        if (isSent) restoreComposerFocus();
    }
}

