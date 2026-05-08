// Chat drafts: persist composer text per-chat, sync с realtime-обновлениями,
// показ превью в сайдбаре. Вынесено из chat.js без изменений в поведении.

const CHAT_DRAFT_SAVE_DEBOUNCE_MS = 700;

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
    } = deps;

    let chatDraftSaveTimer = 0;
    let chatDraftSaveTargetChatId = '';
    let chatDraftSaveQueuedText = '';
    let activeDraftLoadRequestId = 0;
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

    function applyComposerDraftText(value) {
        if (!messageInput) return;
        const normalized = normalizeDraftText(value);
        if (messageInput.value === normalized) return;
        messageInput.value = normalized;
        getLinkDraftBarController?.()?.syncFromInput?.({ force: true });
        resizeComposerInput?.();
        updateVoiceRecordButtonState?.();
    }

    function syncDraftPreviewForContact(chatId, draftText, updatedAt = '', options = {}) {
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
            updateActiveContactLastMessage(
                contactItem,
                rawMessage,
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

        const normalizedDraft = normalizeDraftText(draftText);
        const nextSavedText = hasMeaningfulDraft(normalizedDraft) ? normalizedDraft : '';
        if (!force && lastSavedDraftByChatId.get(normalizedChatId) === nextSavedText) {
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
                    draft_text: normalizedDraft,
                }),
            });
            const payload = await response.json();
            if (!response.ok || !payload?.success) return null;

            const savedText = payload.has_draft ? normalizeDraftText(payload.draft_text || '') : '';
            const savedUpdatedAt = String(payload.updated_at || '').trim();
            lastSavedDraftByChatId.set(normalizedChatId, savedText);
            if (savedUpdatedAt) {
                lastDraftUpdatedAtByChatId.set(normalizedChatId, toDraftTimestampMs(savedUpdatedAt));
            }
            syncDraftPreviewForContact(normalizedChatId, savedText, savedUpdatedAt, { showWhileActive: true });
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
        applyComposerDraftText(hasDraft ? draftText : '');
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

            const draftText = payload.has_draft ? normalizeDraftText(payload.draft_text || '') : '';
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

    function handleRealtimeChatDraftUpdated(payload) {
        const chatId = String(payload?.chat_id || '').trim();
        if (!chatId) return;

        const updatedAt = String(payload?.updated_at || '').trim();
        if (!shouldApplyDraftUpdate(chatId, updatedAt, payload?.has_draft ? payload?.draft_text || '' : '')) return;

        const previousSavedDraftText = String(lastSavedDraftByChatId.get(chatId) || '');
        const normalizedDraftText = payload?.has_draft
            ? normalizeDraftText(payload?.draft_text || '')
            : '';
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
