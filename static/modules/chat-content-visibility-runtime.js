export function createChatContentVisibilityRuntime({
    chatPlaceholder = null,
    chatMessages = null,
    chatInputArea = null,
    chatHeaderActions = null,
    getCurrentChatId = () => null,
    getChatState = () => null,
    resizeComposerInput = () => {},
    updateChatMessagesBottomInset = () => {},
    resetOpenChatUnreadCounter = () => {},
    resolveSavedChatScrollTop = () => NaN,
    scheduleVirtualChatRender = () => {},
    requestAnimationFrameFn = requestAnimationFrame,
    setKeepChatPinnedToBottom = () => {},
    isChatNearBottom = () => false,
    updateJumpToNewMessagesButton = () => {},
    setE2EPillPinnedOpen = () => {},
    setChatStageLoading = () => {},
    syncMuteButton = () => {},
    syncE2EPillState = () => {},
    updateVoiceRecordButtonState = () => {},
} = {}) {
    function showChatContent(show, options = {}) {
        if (chatPlaceholder) chatPlaceholder.style.display = show ? 'none' : '';
        if (chatMessages) {
            chatMessages.classList.toggle('chat-messages--hidden', !show);
            chatMessages.style.display = '';
        }
        if (chatInputArea) {
            chatInputArea.classList.toggle('chat-input-area--hidden', !show);
            chatInputArea.style.display = '';
        }
        if (chatHeaderActions) {
            chatHeaderActions.classList.toggle('header-actions-group--hidden', !show);
            chatHeaderActions.style.display = '';
        }
        if (show) {
            resizeComposerInput();
            updateChatMessagesBottomInset({ immediate: true });
        } else {
            updateChatMessagesBottomInset({ immediate: true });
        }
        if (!show) {
            resetOpenChatUnreadCounter();
        } else if (options?.renderInitializedChat !== false) {
            const currentChatId = getCurrentChatId();
            const state = currentChatId ? getChatState(currentChatId) : null;
            if (state?.initialized) {
                const restoredTop = resolveSavedChatScrollTop(currentChatId);
                if (Number.isFinite(restoredTop)) {
                    scheduleVirtualChatRender(currentChatId, { force: true, scrollTop: restoredTop });
                    requestAnimationFrameFn(() => {
                        setKeepChatPinnedToBottom(isChatNearBottom());
                    });
                } else {
                    scheduleVirtualChatRender(currentChatId, { force: true, scrollToBottom: true });
                    setKeepChatPinnedToBottom(true);
                }
            }
            updateJumpToNewMessagesButton();
        }
        if (!show) {
            setE2EPillPinnedOpen(false);
            setChatStageLoading(false);
        }
        syncMuteButton();
        syncE2EPillState();
        updateVoiceRecordButtonState();
    }

    return { showChatContent };
}
