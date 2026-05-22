// Chat drafts: persist composer text per-chat, sync с realtime-обновлениями,
// показ превью в сайдбаре. Вынесено из chat.js без изменений в поведении.

const CHAT_DRAFT_SAVE_DEBOUNCE_MS = 700;
const ENCRYPTED_PREVIEW_LOADING_TOKEN = '__SUN_ENCRYPTED_LOADING__';

export function createChatDraftsController(deps = {}) {
    const {
        messageInput,
        getCurrentChatId,
        getIsEditingMessageId,
        isChatBlocked,
        getCurrentUserId,
        withAppRoot,
        getCsrfToken,
        resizeComposerInput,
        updateVoiceRecordButtonState,
        getLinkDraftBarController,
        resolveContactItemByChatId,
        updateActiveContactLastMessage,
        sortContactsList,
        getPrivateKeyPem,
        isEncryptedPayload,
        decryptForDisplay,
        encryptForCurrentChat,
    } = deps;

    let chatDraftSaveTimer = 0;
    let chatDraftSaveTargetChatId = '';
    let chatDraftSaveQueuedText = '';
    let activeDraftLoadRequestId = 0;
    const draftSaveSeqByChatId = new Map();
    const lastSavedDraftByChatId = new Map();
    const lastDraftUpdatedAtByChatId = new Map();

    function normalizeDraftText(value) {
        return String(value ?? '').replace(/\r\n/g, '\n');
    }

    function toDraftTimestampMs(value) {
        const raw = String(value || '').trim();
        if (!raw) return 0;
        const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
        const parsed = Date.parse(normalized);
        return Number.isFinite(parsed) ? parsed : 0;
    }

    function shouldApplyDraftUpdate(chatId, updatedAt, incomingDraftText = '') {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return false;
        const nextMs = toDraftTimestampMs(updatedAt);
        if (!nextMs) return true;
        const prevMs = Number(lastDraftUpdatedAtByChatId.get(normalizedChatId) || 0);
        if (nextMs > prevMs) return true;
        if (nextMs < prevMs) return false;

        // CURRENT_TIMESTAMP from backend is second-precision; if two updates share
        // the same timestamp, only treat exact text duplicates as safe/idempotent.
        const previousSavedDraftText = normalizeDraftText(lastSavedDraftByChatId.get(normalizedChatId) || '');
        const nextDraftText = normalizeDraftText(incomingDraftText || '');
        return nextDraftText === previousSavedDraftText;
    }

    function hasMeaningfulDraft(value) {
        return Boolean(normalizeDraftText(value).trim());
    }

    async function decryptDraftForLocalDisplay(rawDraftText) {
        const normalizedDraftText = normalizeDraftText(rawDraftText);
        if (!normalizedDraftText) return '';
        if (typeof isEncryptedPayload !== 'function' || !isEncryptedPayload(normalizedDraftText)) {
            return normalizedDraftText;
        }
        const privateKeyPem = typeof getPrivateKeyPem === 'function' ? getPrivateKeyPem() : '';
        if (!privateKeyPem || typeof decryptForDisplay !== 'function') {
            return '';
        }
        try {
            return normalizeDraftText(await decryptForDisplay(privateKeyPem, normalizedDraftText, true));
        } catch (_) {
            return '';
        }
    }

    async function encryptDraftForServer(draftText) {
        const normalizedDraft = normalizeDraftText(draftText);
        if (!hasMeaningfulDraft(normalizedDraft)) return '';
        if (typeof encryptForCurrentChat !== 'function') return null;
        try {
            const encryptedDraft = await encryptForCurrentChat(normalizedDraft);
            if (typeof isEncryptedPayload === 'function' && isEncryptedPayload(encryptedDraft)) {
                return encryptedDraft;
            }
        } catch (_) {
            return null;
        }
        return null;
    }

    function applyComposerDraftText(value) {
        if (!messageInput) return;
        const normalized = normalizeDraftText(value);
        if (messageInput.value === normalized) return;
        messageInput.value = normalized;
        messageInput.dispatchEvent(new Event('sun-composer-sync-visual'));
        getLinkDraftBarController?.()?.syncFromInput?.({ force: true });
        resizeComposerInput?.();
        updateVoiceRecordButtonState?.();
    }

    async function syncDraftPreviewForContact(chatId, draftText, updatedAt = '', options = {}) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return;

        const showWhileActive = options?.showWhileActive === true;
        if (!showWhileActive && normalizedChatId === String(getCurrentChatId?.() || '')) {
            return;
        }

        const contactItem = resolveContactItemByChatId(normalizedChatId);
        if (!contactItem) return;

        const normalizedDraft = normalizeDraftText(draftText);
        const hasDraft = hasMeaningfulDraft(normalizedDraft);
        if (hasDraft) {
            updateActiveContactLastMessage(
                contactItem,
                normalizedDraft,
                false,
                { pending: false, is_read: false, is_delivered: false },
                updatedAt || new Date().toISOString(),
                {
                    isDraft: true,
                    draftText: normalizedDraft,
                },
            );
        } else if (contactItem.getAttribute('data-has-draft') === '1') {
            const rawMessage = String(contactItem.getAttribute('data-raw-last-message') || '');
            const rawTimestamp = String(
                contactItem.getAttribute('data-raw-last-message-time')
                || contactItem.getAttribute('data-last-message-time')
                || '',
            ).trim();
            const lastSenderId = String(contactItem.getAttribute('data-last-sender-id') || '').trim();
            const isSelf = Boolean(lastSenderId) && lastSenderId === String(getCurrentUserId?.() || '');
            const isRead = contactItem.getAttribute('data-last-message-is-read') === '1';
            const isDelivered = contactItem.getAttribute('data-last-message-is-delivered') === '1';
            let restoredMessage = rawMessage;
            if (rawMessage && typeof isEncryptedPayload === 'function' && isEncryptedPayload(rawMessage)) {
                const privateKeyPem = typeof getPrivateKeyPem === 'function'
                    ? getPrivateKeyPem()
                    : '';
                if (privateKeyPem && typeof decryptForDisplay === 'function') {
                    try {
                        restoredMessage = await decryptForDisplay(privateKeyPem, rawMessage, isSelf);
                    } catch (_) {
                        restoredMessage = ENCRYPTED_PREVIEW_LOADING_TOKEN;
                    }
                } else {
                    restoredMessage = ENCRYPTED_PREVIEW_LOADING_TOKEN;
                }
            }
            updateActiveContactLastMessage(
                contactItem,
                restoredMessage,
                isSelf,
                { is_read: isRead, is_delivered: isDelivered },
                rawTimestamp || null,
                { isDraft: false },
            );
        }

        sortContactsList?.();
    }

    async function saveDraftForChat(chatId, draftText, { force = false } = {}) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return null;
        const saveSeq = Number(draftSaveSeqByChatId.get(normalizedChatId) || 0) + 1;
        draftSaveSeqByChatId.set(normalizedChatId, saveSeq);

        const normalizedDraft = normalizeDraftText(draftText);
        const nextSavedText = hasMeaningfulDraft(normalizedDraft) ? normalizedDraft : '';
        if (!force && lastSavedDraftByChatId.get(normalizedChatId) === nextSavedText) {
            return null;
        }

        const draftTextForServer = await encryptDraftForServer(normalizedDraft);
        if (draftSaveSeqByChatId.get(normalizedChatId) !== saveSeq) {
            return null;
        }
        if (draftTextForServer === null) {
            return null;
        }

        try {
            const response = await fetch(withAppRoot('/save_chat_draft'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({
                    chat_id: normalizedChatId,
                    draft_text: draftTextForServer,
                }),
            });
            const payload = await response.json();
            if (!response.ok || !payload?.success) return null;
            if (draftSaveSeqByChatId.get(normalizedChatId) !== saveSeq) return null;

            const savedText = payload.has_draft
                ? await decryptDraftForLocalDisplay(payload.draft_text || '')
                : '';
            if (draftSaveSeqByChatId.get(normalizedChatId) !== saveSeq) return null;
            const savedUpdatedAt = String(payload.updated_at || '').trim();
            lastSavedDraftByChatId.set(normalizedChatId, savedText);
            if (savedUpdatedAt) {
                lastDraftUpdatedAtByChatId.set(normalizedChatId, toDraftTimestampMs(savedUpdatedAt));
            }
            syncDraftPreviewForContact(normalizedChatId, savedText, savedUpdatedAt);
            return payload;
        } catch (_) {
            return null;
        }
    }

    function scheduleCurrentChatDraftSave({ immediate = false, force = false } = {}) {
        const currentChatId = getCurrentChatId?.();
        if (!currentChatId || !messageInput || getIsEditingMessageId?.() || isChatBlocked?.()) return;

        if (immediate) {
            if (chatDraftSaveTimer) {
                clearTimeout(chatDraftSaveTimer);
                chatDraftSaveTimer = 0;
            }
            chatDraftSaveTargetChatId = '';
            chatDraftSaveQueuedText = '';
            void saveDraftForChat(currentChatId, messageInput.value, { force });
            return;
        }

        chatDraftSaveTargetChatId = String(currentChatId);
        chatDraftSaveQueuedText = String(messageInput.value || '');
        if (chatDraftSaveTimer) {
            clearTimeout(chatDraftSaveTimer);
        }
        chatDraftSaveTimer = window.setTimeout(() => {
            const targetChatId = chatDraftSaveTargetChatId;
            const queuedText = chatDraftSaveQueuedText;
            chatDraftSaveTimer = 0;
            chatDraftSaveTargetChatId = '';
            chatDraftSaveQueuedText = '';
            if (!targetChatId) return;
            void saveDraftForChat(targetChatId, queuedText, { force });
        }, CHAT_DRAFT_SAVE_DEBOUNCE_MS);
    }

    function flushDraftSaveForChat(chatId, draftText, { force = false } = {}) {
        if (chatDraftSaveTimer) {
            clearTimeout(chatDraftSaveTimer);
            chatDraftSaveTimer = 0;
        }
        chatDraftSaveTargetChatId = '';
        chatDraftSaveQueuedText = '';
        return saveDraftForChat(chatId, draftText, { force });
    }

    function prefillComposerDraftFromContactItem(contactItem) {
        if (!contactItem) return;
        const hasDraft = contactItem.getAttribute('data-has-draft') === '1';
        const draftText = String(contactItem.getAttribute('data-draft-text') || '');
        const canPrefillSynchronously = !(
            hasDraft
            && typeof isEncryptedPayload === 'function'
            && isEncryptedPayload(draftText)
        );
        applyComposerDraftText(hasDraft && canPrefillSynchronously ? draftText : '');
    }

    async function loadDraftForChat(chatId, { fallbackContactItem = null } = {}) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId || String(normalizedChatId) !== String(getCurrentChatId?.() || '')) return;

        const requestId = ++activeDraftLoadRequestId;
        const beforeRequestValue = String(messageInput?.value || '');
        try {
            const response = await fetch(
                withAppRoot(`/get_chat_draft?chat_id=${encodeURIComponent(normalizedChatId)}`),
            );
            const payload = await response.json();
            if (!response.ok || !payload?.success) return;
            if (requestId !== activeDraftLoadRequestId) return;
            if (String(getCurrentChatId?.() || '') !== normalizedChatId) return;
            const currentValue = String(messageInput?.value || '');
            if (currentValue !== beforeRequestValue && document.activeElement === messageInput) {
                return;
            }

            const draftText = payload.has_draft
                ? await decryptDraftForLocalDisplay(payload.draft_text || '')
                : '';
            if (requestId !== activeDraftLoadRequestId) return;
            if (String(getCurrentChatId?.() || '') !== normalizedChatId) return;
            const draftUpdatedAt = String(payload.updated_at || '');
            lastSavedDraftByChatId.set(normalizedChatId, draftText);
            if (draftUpdatedAt) {
                lastDraftUpdatedAtByChatId.set(normalizedChatId, toDraftTimestampMs(draftUpdatedAt));
            }
            syncDraftPreviewForContact(normalizedChatId, draftText, draftUpdatedAt);
            applyComposerDraftText(draftText);
        } catch (_) {
            if (requestId !== activeDraftLoadRequestId) return;
            if (String(getCurrentChatId?.() || '') !== normalizedChatId) return;
            prefillComposerDraftFromContactItem(fallbackContactItem || resolveContactItemByChatId(normalizedChatId));
        }
    }

    async function applyRealtimeChatDraftUpdated(payload) {
        const chatId = String(payload?.chat_id || '').trim();
        if (!chatId) return;

        const updatedAt = String(payload?.updated_at || '').trim();
        const normalizedDraftText = payload?.has_draft
            ? await decryptDraftForLocalDisplay(payload?.draft_text || '')
            : '';
        if (!shouldApplyDraftUpdate(chatId, updatedAt, normalizedDraftText)) return;

        const previousSavedDraftText = String(lastSavedDraftByChatId.get(chatId) || '');
        lastSavedDraftByChatId.set(chatId, normalizedDraftText);
        if (updatedAt) {
            lastDraftUpdatedAtByChatId.set(chatId, toDraftTimestampMs(updatedAt));
        }
        syncDraftPreviewForContact(chatId, normalizedDraftText, updatedAt);

        if (String(chatId) !== String(getCurrentChatId?.() || '')) return;

        const isComposerFocused = document.activeElement === messageInput;
        const currentValue = normalizeDraftText(messageInput?.value || '');
        const hasUnsavedLocalChanges = currentValue !== previousSavedDraftText;
        if (isComposerFocused && hasUnsavedLocalChanges) return;
        applyComposerDraftText(normalizedDraftText);
    }

    function handleRealtimeChatDraftUpdated(payload) {
        void applyRealtimeChatDraftUpdated(payload);
    }

    function clearLocalDraftStateForChat(chatId) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return;
        lastSavedDraftByChatId.set(normalizedChatId, '');
        lastDraftUpdatedAtByChatId.set(normalizedChatId, Date.now());
    }

    return {
        scheduleCurrentChatDraftSave,
        flushDraftSaveForChat,
        loadDraftForChat,
        prefillComposerDraftFromContactItem,
        handleRealtimeChatDraftUpdated,
        syncDraftPreviewForContact,
        applyComposerDraftText,
        hasMeaningfulDraft,
        clearLocalDraftStateForChat,
    };
}
