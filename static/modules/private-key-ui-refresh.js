export function initPrivateKeyUiRefresh({
    chatMessages,
    getPrivateKeyPem,
    getCurrentChatId,
    getChatState,
    isEncryptedPayload,
    decryptForDisplay,
    setChatMessages,
    getMessageKey,
    renderChatMessagesStable,
    restorePinnedBar,
    updateE2EIndicator,
    loadContacts,
    syncSidebarStatusBar,
    formatDaySeparatorLabel,
    dateNavigatorController,
    isProfileDrawerOpen,
    scheduleProfileMediaPanelRefresh,
}) {
    let refreshInFlight = null;
    let refreshQueued = false;
    let refreshSeq = 0;

    function isCurrentRefresh(seq, chatId, privateKeyPem) {
        return (
            seq === refreshSeq
            && String(getCurrentChatId() || '') === String(chatId || '')
            && getPrivateKeyPem() === privateKeyPem
        );
    }

    async function redecryptCurrentChatState(seq) {
        const privateKeyPem = getPrivateKeyPem();
        const chatId = getCurrentChatId();
        if (!privateKeyPem || !chatId) return false;

        const state = getChatState(chatId);
        const currentScrollTop = chatMessages?.scrollTop ?? 0;
        let changed = false;

        const nextMessages = await Promise.all((state.messages || []).map(async (message) => {
            let nextContent = message?.message;
            let nextReply = message?.replyToText;
            let nextEncrypted = Boolean(message?.encrypted);

            if (isEncryptedPayload(nextContent)) {
                try {
                    nextContent = await decryptForDisplay(
                        privateKeyPem,
                        nextContent,
                        message?.sender === 'self',
                    );
                    nextEncrypted = false;
                } catch (_) {}
            }

            if (isEncryptedPayload(nextReply)) {
                try {
                    nextReply = await decryptForDisplay(
                        privateKeyPem,
                        nextReply,
                        message?.replyToSender === '\u0412\u044B',
                    );
                } catch (_) {}
            }

            if (nextContent === message?.message
                && nextReply === message?.replyToText
                && nextEncrypted === Boolean(message?.encrypted)) {
                return message;
            }

            changed = true;
            return {
                ...message,
                message: nextContent,
                replyToText: nextReply,
                encrypted: nextEncrypted,
            };
        }));

        if (!isCurrentRefresh(seq, chatId, privateKeyPem)) return false;

        if (changed) {
            setChatMessages(chatId, nextMessages, { resetHeights: true });
            const refreshedState = getChatState(chatId);
            nextMessages.forEach((message) => refreshedState.renderedKeys.add(getMessageKey(message)));
            await renderChatMessagesStable(chatId, { force: true, scrollTop: currentScrollTop });
            if (!isCurrentRefresh(seq, chatId, privateKeyPem)) return false;
        }

        const updatedState = getChatState(chatId);
        await restorePinnedBar(updatedState.pins || [], {
            activeMessageId: updatedState.activePinMessageId,
        });
        if (!isCurrentRefresh(seq, chatId, privateKeyPem)) return false;
        updateE2EIndicator();
        return changed;
    }

    async function refreshPrivateKeyDependentUi() {
        syncSidebarStatusBar();
        if (!getPrivateKeyPem()) return undefined;
        if (refreshInFlight) {
            refreshQueued = true;
            return refreshInFlight;
        }

        refreshInFlight = (async () => {
            try {
                do {
                    refreshQueued = false;
                    const seq = ++refreshSeq;
                    await redecryptCurrentChatState(seq);
                    if (seq === refreshSeq && getPrivateKeyPem()) {
                        await loadContacts({ immediate: true });
                    }
                } while (refreshQueued && getPrivateKeyPem());
            } finally {
                refreshInFlight = null;
            }
        })();

        return refreshInFlight;
    }

    function refreshLocalizedRuntimeUi(options = {}) {
        const hydrated = options?.hydrated;
        const shouldRunHeavyProfileRefresh = hydrated === true || typeof hydrated === 'undefined';
        chatMessages?.querySelectorAll('.chat-day-separator').forEach((separator) => {
            const rawValue = separator.getAttribute('data-day-key') || '';
            const labelEl = separator.querySelector('.chat-day-separator__label');
            if (labelEl) {
                labelEl.textContent = formatDaySeparatorLabel(rawValue) || rawValue;
            }
        });
        dateNavigatorController.refreshLocale();
        if (shouldRunHeavyProfileRefresh && isProfileDrawerOpen()) {
            scheduleProfileMediaPanelRefresh(getCurrentChatId(), { force: true });
        }
        syncSidebarStatusBar();
    }

    return {
        refreshPrivateKeyDependentUi,
        refreshLocalizedRuntimeUi,
    };
}
