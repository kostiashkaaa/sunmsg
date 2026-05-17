import {
    isCurrentUserMentioned,
    normalizeMentionUserIds,
} from './chat-mentions.js';
import { normalizeGroupReaders } from './chat-group-read-receipts.js';

async function decryptReplyPreview({
    data,
    currentUserPublicKey,
    privateKeyPem,
    decryptForDisplay,
} = {}) {
    if (!data?.reply_to_id || !data?.reply_message) return '';

    try {
        const replyIsSelf = data.reply_sender_pub === currentUserPublicKey;
        return await decryptForDisplay(
            privateKeyPem,
            data.reply_message,
            replyIsSelf,
            String(data.reply_sender_pub || '').trim()
        );
    } catch (_) {
        return '\u{1F512}';
    }
}

function isIncomingSenderCurrentUser(data, currentUserPublicKey, currentUserId) {
    const senderUserId = Number(data?.sender_user_id);
    const normalizedCurrentUserId = Number(currentUserId);
    if (
        Number.isFinite(senderUserId)
        && senderUserId > 0
        && Number.isFinite(normalizedCurrentUserId)
        && normalizedCurrentUserId > 0
    ) {
        return senderUserId === normalizedCurrentUserId;
    }
    return String(data?.sender_public_key || '').trim() === String(currentUserPublicKey || '').trim();
}

function buildIncomingMessageState({
    data,
    isSelf,
    decryptedMessage,
    replyText,
    currentUserPublicKey,
    otherSenderLabel = '\u0421\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A',
    normalizeMessageReactions,
    isEncryptedPayload,
} = {}) {
    const hasReactionPayload = Array.isArray(data?.reactions) && data.reactions.length > 0;
    const normalizedMentionedUserIds = normalizeMentionUserIds(data?.mentioned_user_ids);
    const normalizedMentionedUsernames = Array.isArray(data?.mentioned_usernames)
        ? data.mentioned_usernames
            .map((value) => String(value || '').trim().toLowerCase())
            .filter(Boolean)
        : [];
    const groupReadCountRaw = Number(data?.group_read_count);
    const normalizedGroupReaders = normalizeGroupReaders(data?.group_readers);
    const normalizedGroupReadCount = Number.isFinite(groupReadCountRaw) && groupReadCountRaw >= 0
        ? Math.floor(groupReadCountRaw)
        : normalizedGroupReaders.length;
    return {
        id: data.id,
        sender: isSelf ? 'self' : 'other',
        senderUserId: Number(data.sender_user_id) || null,
        senderPublicKey: String(data.sender_public_key || '').trim(),
        senderDisplayName: String(data.sender_display_name || '').trim(),
        senderUsername: String(data.sender_username || '').trim(),
        senderAvatarUrl: String(data.sender_avatar_url || '').trim(),
        message: decryptedMessage,
        message_type: data.message_type || 'text',
        encrypted: isEncryptedPayload(data.message),
        is_read: Boolean(data.is_read),
        read_at: String(data.read_at || '').trim() || null,
        is_delivered: Boolean(data.is_delivered),
        voice_listened_by_partner: Boolean(data.voice_listened_by_partner),
        created_at: data.created_at,
        replyToId: data.reply_to_id || null,
        replyToText: replyText,
        replyToSender: data.reply_sender_pub === currentUserPublicKey
            ? '\u0412\u044B'
            : otherSenderLabel,
        forwardFromName: String(data.forward_from_name || '').trim(),
        forwardFromUserId: Number(data.forward_from_user_id) || null,
        group_read_count: normalizedGroupReadCount,
        group_readers: normalizedGroupReaders,
        mentionedUserIds: normalizedMentionedUserIds,
        mentionedUsernames: normalizedMentionedUsernames,
        expires_at: data.expires_at ? Number(data.expires_at) : null,
        ...(hasReactionPayload ? { reactions: normalizeMessageReactions(data.reactions) } : {}),
    };
}

function preserveSelfEchoPlaintextFallback(previousMessage, incomingMessageState, isEncryptedPayload) {
    if (!previousMessage || !incomingMessageState || typeof isEncryptedPayload !== 'function') {
        return incomingMessageState;
    }
    const messageType = String(incomingMessageState.message_type || previousMessage.message_type || 'text');
    const canReusePreviousMessage = messageType === 'text' || messageType === 'link';

    const nextMessage = { ...incomingMessageState };
    if (
        canReusePreviousMessage
        && isEncryptedPayload(nextMessage.message)
        && previousMessage.message
        && !isEncryptedPayload(previousMessage.message)
    ) {
        nextMessage.message = previousMessage.message;
    }
    if (
        isEncryptedPayload(nextMessage.replyToText)
        && previousMessage.replyToText
        && !isEncryptedPayload(previousMessage.replyToText)
    ) {
        nextMessage.replyToText = previousMessage.replyToText;
    }
    return nextMessage;
}

export function registerIncomingMessageSocketHandlers({
    socket,
    isBlockedChat,
    getCurrentChatId,
    currentUserPublicKey,
    getPrivateKeyPem,
    decryptForDisplay,
    getChatState,
    findMessageIndex,
    cancelPendingTimeout,
    normalizeChatMessageOrder,
    updateActiveContactLastMessage,
    isChatNearBottom,
    isWindowActiveForUnreadHandling,
    getCurrentChatScrollTop,
    getCurrentChatScrollHeight,
    appendMessage,
    isEncryptedPayload,
    normalizeMessageReactions,
    getCurrentPartnerDisplayName,
    markCurrentChatSeenIfPossible,
    markOutgoingReadByPartnerMessage = () => {},
    setKeepChatPinnedToBottom,
    incrementOpenChatUnreadCount,
    updateJumpToNewMessagesButton,
    setContactUnreadBadge,
    upsertChatMessage,
    updateSidebarForOtherChat,
    showToast,
    updateMessageContent,
    rerenderCurrentChat,
    resolveMessageElement,
    getMessageKey,
    confirmPendingMessageDom,
    loadContacts,
    isChatMuted = () => false,
    enrichVisualMediaMessage,
    notifyIncomingMessage,
    onIncomingRawMessage,
    prewarmMessageLinkPreview,
    getCurrentUserId = () => null,
    getCurrentUsername = () => '',
} = {}) {
    socket.on('receive_message', async (data) => {
        try {
        if (isBlockedChat(data.chat_id)) return;
        if (typeof onIncomingRawMessage === 'function') {
            onIncomingRawMessage({
                chatId: data.chat_id,
                rawMessage: data,
            });
        }

        const currentChatId = getCurrentChatId();
        const normalizedCurrentChatId = String(currentChatId || '');
        const normalizedIncomingChatId = String(data?.chat_id || '');
        const privateKeyPem = getPrivateKeyPem();
        const currentUserId = getCurrentUserId?.();
        const currentUsername = String(getCurrentUsername?.() || '').trim();

        if (normalizedIncomingChatId === normalizedCurrentChatId) {
            const isSelf = isIncomingSenderCurrentUser(data, currentUserPublicKey, currentUserId);
            const wasNearBottom = isChatNearBottom();
            const previousScrollTop = getCurrentChatScrollTop();
            const rawDecryptedMessage = await decryptForDisplay(
                privateKeyPem,
                data.message,
                isSelf,
                String(data.sender_public_key || '').trim()
            );
            const decryptedMessage = typeof enrichVisualMediaMessage === 'function'
                ? await enrichVisualMediaMessage(rawDecryptedMessage)
                : rawDecryptedMessage;
            if (typeof prewarmMessageLinkPreview === 'function') {
                await prewarmMessageLinkPreview(decryptedMessage, { delayMs: 0, awaitReady: true });
            }
            const replyText = await decryptReplyPreview({
                data,
                currentUserPublicKey,
                privateKeyPem,
                decryptForDisplay,
            });
            const incomingMessageState = buildIncomingMessageState({
                data,
                isSelf,
                decryptedMessage,
                replyText,
                currentUserPublicKey,
                otherSenderLabel: getCurrentPartnerDisplayName(),
                normalizeMessageReactions,
                isEncryptedPayload,
            });
            const mentionForCurrentUser = !isSelf && isCurrentUserMentioned({
                mentionedUserIds: incomingMessageState.mentionedUserIds,
                currentUserId,
                currentUsername,
                text: decryptedMessage,
            });

            if (isSelf && data.client_id) {
                const state = getChatState(currentChatId);
                const pendingIdx = findMessageIndex(state, (msg) => msg.clientId === data.client_id);
                if (pendingIdx >= 0) {
                    cancelPendingTimeout?.(data.client_id);
                    const previousMessage = state.messages[pendingIdx];
                    const safeIncomingMessageState = preserveSelfEchoPlaintextFallback(
                        previousMessage,
                        incomingMessageState,
                        isEncryptedPayload,
                    );
                    const previousKey = typeof getMessageKey === 'function'
                        ? getMessageKey(previousMessage)
                        : null;
                    const confirmedMessage = {
                        ...previousMessage,
                        ...safeIncomingMessageState,
                        id: data.id,
                        pending: false,
                        failed: false,
                        clientId: null,
                        created_at: data.created_at || previousMessage.created_at,
                    };
                    state.messages[pendingIdx] = confirmedMessage;
                    normalizeChatMessageOrder?.(state);
                    const nextKey = typeof getMessageKey === 'function'
                        ? getMessageKey(confirmedMessage)
                        : null;
                    if (previousKey && nextKey && previousKey !== nextKey) {
                        const cachedHeight = state.messageHeights?.get(previousKey);
                        if (Number.isFinite(cachedHeight) && cachedHeight > 0) {
                            state.messageHeights.delete(previousKey);
                            state.messageHeights.set(nextKey, cachedHeight);
                        }
                        if (state.renderedKeys?.has(previousKey)) {
                            state.renderedKeys.delete(previousKey);
                            state.renderedKeys.add(nextKey);
                        }
                    }

                    const patched = confirmPendingMessageDom?.({
                        clientId: data.client_id,
                        messageId: data.id,
                        message: confirmedMessage,
                    });
                    if (!patched) {
                        rerenderCurrentChat?.();
                    }
                    updateActiveContactLastMessage(
                        confirmedMessage.message,
                        isSelf,
                        {
                            is_read: Boolean(data.is_read),
                            is_delivered: Boolean(data.is_delivered),
                        },
                        data.created_at,
                    );
                    return;
                }
            }

            if (isSelf) {
                const state = getChatState(currentChatId);
                const existingIdx = findMessageIndex(state, (msg) => Number(msg.id) === Number(data.id));
                if (existingIdx >= 0) {
                    const previousMessage = state.messages[existingIdx];
                    const safeIncomingMessageState = preserveSelfEchoPlaintextFallback(
                        previousMessage,
                        incomingMessageState,
                        isEncryptedPayload,
                    );
                    state.messages[existingIdx] = {
                        ...previousMessage,
                        ...safeIncomingMessageState,
                        pending: false,
                        failed: false,
                        clientId: null,
                    };
                    normalizeChatMessageOrder?.(state);
                    updateActiveContactLastMessage(
                        state.messages[existingIdx].message,
                        isSelf,
                        {
                            is_read: Boolean(data.is_read),
                            is_delivered: Boolean(data.is_delivered),
                        },
                        data.created_at,
                    );
                    return;
                }
            }

            const canTreatAsSeenNow = !isSelf && wasNearBottom && isWindowActiveForUnreadHandling();
            const shouldAutoScroll = isSelf || canTreatAsSeenNow;
            const previousScrollHeight = getCurrentChatScrollHeight();
            appendMessage(
                incomingMessageState,
                {
                    renderOptions: shouldAutoScroll
                        ? { scrollToBottom: true }
                        : { preserveHeightDelta: true, previousScrollTop, previousScrollHeight },
                },
            );

            if (shouldAutoScroll) {
                setKeepChatPinnedToBottom(true);
                if (!isSelf) markCurrentChatSeenIfPossible();
            } else if (!isSelf) {
                incrementOpenChatUnreadCount();
                updateJumpToNewMessagesButton();
                setContactUnreadBadge(currentChatId);
            }

            updateActiveContactLastMessage(
                decryptedMessage,
                isSelf,
                {
                    is_read: Boolean(data.is_read),
                    is_delivered: Boolean(data.is_delivered),
                },
                data.created_at,
            );
            if (!isSelf) {
                markOutgoingReadByPartnerMessage({
                    chatId: currentChatId,
                    messageCreatedAt: data.created_at,
                });
            }
            if (!isSelf && (!isChatMuted(data.chat_id) || mentionForCurrentUser)) {
                notifyIncomingMessage?.({
                    chatId: data.chat_id,
                    message: decryptedMessage,
                    isCurrentChat: true,
                    isSelf: false,
                    isMention: mentionForCurrentUser,
                    shouldIncrementUnread: !canTreatAsSeenNow,
                });
            }
            return;
        }

        const isSelfOther = isIncomingSenderCurrentUser(data, currentUserPublicKey, currentUserId);
        const rawDecryptedOtherMessage = await decryptForDisplay(
            privateKeyPem,
            data.message,
            isSelfOther,
            String(data.sender_public_key || '').trim()
        );
        const decryptedMessage = typeof enrichVisualMediaMessage === 'function'
            ? await enrichVisualMediaMessage(rawDecryptedOtherMessage)
            : rawDecryptedOtherMessage;
        if (typeof prewarmMessageLinkPreview === 'function') {
            await prewarmMessageLinkPreview(decryptedMessage, { delayMs: 0, awaitReady: true });
        }
        const replyText = await decryptReplyPreview({
            data,
            currentUserPublicKey,
            privateKeyPem,
            decryptForDisplay,
        });
        const incomingMessageForOtherChat = buildIncomingMessageState({
            data,
            isSelf: isSelfOther,
            decryptedMessage,
            replyText,
            currentUserPublicKey,
            normalizeMessageReactions,
            isEncryptedPayload,
        });
        const mentionForCurrentUser = !isSelfOther && isCurrentUserMentioned({
            mentionedUserIds: incomingMessageForOtherChat.mentionedUserIds,
            currentUserId,
            currentUsername,
            text: decryptedMessage,
        });
        const otherState = getChatState(data.chat_id);
        if (otherState.initialized) {
            const canConfirmPending = isSelfOther && Boolean(data.client_id);
            if (canConfirmPending) {
                const pendingIdx = findMessageIndex(otherState, (msg) => msg.clientId === data.client_id);
                if (pendingIdx >= 0) {
                    cancelPendingTimeout?.(data.client_id);
                    const previousMessage = otherState.messages[pendingIdx];
                    otherState.messages[pendingIdx] = {
                        ...previousMessage,
                        ...incomingMessageForOtherChat,
                        id: data.id,
                        pending: false,
                        failed: false,
                        clientId: null,
                        created_at: data.created_at || previousMessage.created_at,
                    };
                    normalizeChatMessageOrder?.(otherState);
                } else {
                    upsertChatMessage(data.chat_id, incomingMessageForOtherChat);
                }
            } else {
                upsertChatMessage(data.chat_id, incomingMessageForOtherChat);
            }
        }

        updateSidebarForOtherChat(
            data.chat_id,
            decryptedMessage,
            isSelfOther,
            data.created_at,
            {
                is_read: Boolean(data.is_read),
                is_delivered: Boolean(data.is_delivered),
            },
        );
        if (!isSelfOther && (!isChatMuted(data.chat_id) || mentionForCurrentUser)) {
            if (typeof notifyIncomingMessage === 'function') {
                notifyIncomingMessage({
                    chatId: data.chat_id,
                    message: decryptedMessage,
                    isCurrentChat: false,
                    isSelf: false,
                    isMention: mentionForCurrentUser,
                    shouldIncrementUnread: true,
                });
            } else {
                showToast('\u041D\u043E\u0432\u043E\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435', 'info');
            }
        }
        } catch (err) {
            console.error('[receive_message]', err);
            showToast('\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u0438\u0438 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F', 'danger');
        }
    });

    socket.on('message_edited', async (data) => {
        try {
        if (isBlockedChat(data.chat_id)) return;

        const state = getChatState(data.chat_id);
        const msgIndex = findMessageIndex(state, (msg) => Number(msg.id) === Number(data.msg_id));
        if (msgIndex >= 0) {
            const stateMessage = state.messages[msgIndex];
            const privateKeyPem = getPrivateKeyPem();
            const isSelf = stateMessage.sender === 'self';
            const rawDecrypted = await decryptForDisplay(
                privateKeyPem,
                data.new_content,
                isSelf,
                String(data.sender_public_key || '').trim()
            );
            const decrypted = typeof enrichVisualMediaMessage === 'function'
                ? await enrichVisualMediaMessage(rawDecrypted)
                : rawDecrypted;
            state.messages[msgIndex] = {
                ...stateMessage,
                message: decrypted,
                is_edited: true,
            };

            const msgDiv = resolveMessageElement(data.msg_id);
            if (msgDiv) {
                updateMessageContent(msgDiv, decrypted);
            } else if (String(data?.chat_id || '') === String(getCurrentChatId() || '')) {
                rerenderCurrentChat();
            }
        }
        loadContacts();
        } catch (err) {
            console.error('[message_edited]', err);
            showToast('\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0438 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F', 'danger');
        }
    });
}
