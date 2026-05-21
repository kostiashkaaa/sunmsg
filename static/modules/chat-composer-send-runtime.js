import { sendFileMessageFlow } from './chat-file-send.js';
import { sendTextMessageFlow } from './chat-text-send.js';
import { handleComposerEditFlow } from './chat-edit-flow.js';
import { getErrorMessage } from './utils.js';

export function createChatComposerSendRuntime({
    windowRef = window,
    getCurrentChatId,
    getCurrentContactId,
    getCurrentBlockState,
    getCurrentUserPublicKey,
    getCurrentContactPublicKey,
    isCurrentChatGroup,
    isChatBlocked,
    getBlockedNoticeText,
    showToast,
    maxChatMediaSize,
    getCsrfToken,
    setSendingState,
    getReplyState,
    cancelReply,
    emitSocket,
    enqueueOutboxMessage,
    appendMessage,
    setKeepChatPinnedToBottom,
    updateContactLastMessageForChat,
    prewarmMessageLinkPreview,
    clearComposerInput,
    resizeComposerInput,
    restoreComposerFocus,
    failPendingMessage,
    getEditingFilePayload,
    getEditingMessageId,
    applyEditedMessageLocally,
    encryptForCurrentChat,
    createEncryptForChatSnapshot,
    cancelEdit,
    getForwardComposerDraftForChat,
    resolveForwardContactRows,
    forwardMessagesToTargets,
    clearForwardComposerDraft,
    updatePendingFileUploadProgress,
    commitPendingFileUpload,
    setActiveComposerUpload,
    updateActiveComposerUploadProgress,
    clearActiveComposerUpload,
    isRealtimeConnected,
} = {}) {
    const pendingTimeouts = new Map();
    const pendingRetryHandlers = new Map();

    function normalizeClientId(clientId) {
        return String(clientId || '').trim();
    }

    function schedulePendingTimeout(clientId, ms = 20000) {
        const token = normalizeClientId(clientId);
        if (!token) return;
        const timeoutId = windowRef.setTimeout(() => {
            pendingTimeouts.delete(token);
            failPendingMessage?.(token);
        }, ms);
        pendingTimeouts.set(token, timeoutId);
    }

    function cancelPendingTimeout(clientId) {
        const token = normalizeClientId(clientId);
        if (!token) return;
        const timeoutId = pendingTimeouts.get(token);
        if (timeoutId !== undefined) {
            clearTimeout(timeoutId);
            pendingTimeouts.delete(token);
        }
    }

    function registerPendingMessageRetry(clientId, handler) {
        const token = normalizeClientId(clientId);
        if (!token || typeof handler !== 'function') return;
        pendingRetryHandlers.set(token, handler);
    }

    function clearPendingMessageRetry(clientId) {
        const token = normalizeClientId(clientId);
        if (!token) return;
        pendingRetryHandlers.delete(token);
    }

    async function retryPendingMessage(clientId) {
        const token = normalizeClientId(clientId);
        const handler = token ? pendingRetryHandlers.get(token) : null;
        if (!handler) return false;
        pendingRetryHandlers.delete(token);
        await handler();
        return true;
    }

    function buildSourceChatSnapshot() {
        const sourceChatId = String(getCurrentChatId?.() || '').trim();
        if (!sourceChatId) return null;
        const sourceContactId = String(getCurrentContactId?.() || '').trim();
        const sourceChatIsGroup = Boolean(isCurrentChatGroup?.());
        const sourceContactPublicKey = String(getCurrentContactPublicKey?.() || '').trim();
        const sourceUserPublicKey = String(getCurrentUserPublicKey?.() || '').trim();
        const encryptForSourceChat = createEncryptForChatSnapshot?.({
            chatId: sourceChatId,
            isGroup: sourceChatIsGroup,
            contactId: sourceContactId,
            contactPublicKey: sourceContactPublicKey,
            userPublicKey: sourceUserPublicKey,
        });
        return {
            sourceChatId,
            sourceChatIsGroup,
            encryptForSourceChat,
        };
    }

    async function sendTextMessage(message) {
        const snapshot = buildSourceChatSnapshot();
        if (!snapshot) return;
        const { sourceChatId, sourceChatIsGroup, encryptForSourceChat } = snapshot;

        return sendTextMessageFlow({
            message,
            isGroupChat: sourceChatIsGroup,
            isChatBlocked,
            getBlockedNoticeText,
            currentBlockState: getCurrentBlockState?.(),
            showToast,
            setSendingState,
            encryptForCurrentChat: encryptForSourceChat,
            getReplyState,
            cancelReply,
            emitSocket,
            enqueueOutbox: enqueueOutboxMessage,
            currentChatId: sourceChatId,
            getCurrentChatId,
            appendMessage,
            setKeepChatPinnedToBottom,
            updateActiveContactLastMessage: (text, isSelf, status, timestamp) => {
                updateContactLastMessageForChat?.(sourceChatId, text, isSelf, status, timestamp);
            },
            schedulePendingTimeout,
            failPendingMessage,
            prewarmMessageLinkPreview,
            clearComposerInput: () => clearComposerInput?.(sourceChatId),
            resizeComposerInput,
            restoreComposerFocus,
        });
    }

    async function runFileMessageFlow(file, caption = '', options = {}, snapshot = null) {
        const resolvedSnapshot = snapshot || buildSourceChatSnapshot();
        if (!resolvedSnapshot) return;
        const { sourceChatId, sourceChatIsGroup, encryptForSourceChat } = resolvedSnapshot;

        return sendFileMessageFlow({
            file,
            caption,
            options,
            isGroupChat: sourceChatIsGroup,
            isChatBlocked,
            getBlockedNoticeText,
            currentBlockState: getCurrentBlockState?.(),
            showToast,
            maxChatMediaSize,
            currentChatId: sourceChatId,
            getCurrentChatId,
            getCsrfToken,
            setSendingState,
            getReplyState,
            cancelReply,
            encryptForCurrentChat: encryptForSourceChat,
            isRealtimeConnected,
            emitSocket,
            appendMessage,
            setKeepChatPinnedToBottom,
            updateActiveContactLastMessage: (text, isSelf, status, timestamp) => {
                updateContactLastMessageForChat?.(sourceChatId, text, isSelf, status, timestamp);
            },
            schedulePendingTimeout,
            updatePendingFileUploadProgress,
            commitPendingFileUpload,
            failPendingMessage,
            setActiveComposerUpload,
            updateActiveComposerUploadProgress,
            clearActiveComposerUpload,
            enqueueOutbox: enqueueOutboxMessage,
            registerPendingMessageRetry: (clientId, retryOptions = {}) => {
                registerPendingMessageRetry(clientId, () => runFileMessageFlow(
                    file,
                    caption,
                    {
                        ...options,
                        ...retryOptions,
                        retryClientId: clientId,
                    },
                    resolvedSnapshot,
                ));
            },
            clearPendingMessageRetry,
        });
    }

    async function sendFileMessage(file, caption = '', options = {}) {
        const snapshot = buildSourceChatSnapshot();
        if (!snapshot) return;
        return runFileMessageFlow(file, caption, options, snapshot);
    }

    async function handleComposerEncryptAndSend(rawContent) {
        const activeChatId = String(getCurrentChatId?.() || '').trim();
        const pendingForwardDraft = getForwardComposerDraftForChat?.(activeChatId);
        const normalizedRaw = String(rawContent || '').replace(/\r\n/g, '\n');
        const isEditingText = Boolean(getEditingMessageId?.()) && !getEditingFilePayload?.();
        if (!normalizedRaw.trim() && !getEditingFilePayload?.() && !pendingForwardDraft) {
            // If the user clears a text message and tries to submit, show a warning instead of silently ignoring
            if (isEditingText) {
                showToast?.('Нельзя сохранить пустое сообщение', 'warning');
            }
            return;
        }
        const content = normalizedRaw.trim() ? normalizedRaw : '';

        const handledEdit = await handleComposerEditFlow({
            content,
            isEditingMessageId: getEditingMessageId?.(),
            isEditingFilePayload: getEditingFilePayload?.(),
            applyEditedMessageLocally,
            encryptForCurrentChat,
            emitSocket,
            currentChatId: activeChatId,
            cancelEdit,
            showToast,
        });
        if (handledEdit) return;

        if (pendingForwardDraft) {
            const targetRows = resolveForwardContactRows?.()
                ?.filter((row) => row.chatId === pendingForwardDraft.targetChatId) || [];
            if (!targetRows.length) {
                showToast?.('Чат для пересылки недоступен. Выберите получателя заново.', 'warning');
                clearForwardComposerDraft?.(activeChatId);
                return;
            }
            try {
                const sentCount = await forwardMessagesToTargets(pendingForwardDraft.messages, targetRows);
                showToast?.(`Переслано сообщений: ${sentCount}.`, 'success');
                clearForwardComposerDraft?.(activeChatId);
            } catch (error) {
                showToast?.(getErrorMessage(error, 'Не удалось переслать сообщения.'), 'danger');
                return;
            }
        }

        if (content) {
            await sendTextMessage(content);
        }
    }

    return {
        schedulePendingTimeout,
        cancelPendingTimeout,
        clearPendingMessageRetry,
        retryPendingMessage,
        sendTextMessage,
        sendFileMessage,
        handleComposerEncryptAndSend,
    };
}
