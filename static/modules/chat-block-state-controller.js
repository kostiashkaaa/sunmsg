export function applyChatBlockStateFlow({
    state,
    syncChatRoom = true,
    getCurrentBlockState = () => ({}),
    setCurrentBlockState = () => {},
    normalizeBlockState = (value) => value,
    applyBlockNoticeUIFn = () => {},
    blockNoticeElements = {},
    composerRow = null,
    getFileAttachInput = () => null,
    getAttachButton = () => null,
    closeAttachMenu = () => {},
    updateVoiceRecordButtonState = () => {},
    isVoiceRecordingActive = () => false,
    stopVoiceRecording = () => Promise.resolve(),
    hideTyping = null,
    hideSidebarTyping = null,
    getCurrentChatId = () => null,
    hideContextMenu = null,
    closeReactionPicker = () => {},
    closeMessageActionsBar = null,
    cancelReply = null,
    cancelEdit = null,
    isSelectionMode = () => false,
    toggleSelectionMode = null,
    deleteConfirmModal = null,
    closeAnimatedDialog = () => {},
    emitLeaveChatRoom = () => {},
    joinChatRoom = () => {},
    updateBlockButtons = () => {},
    getCurrentPartnerData = () => null,
    updateOnlineStatusUI = () => {},
    renderProfileHeader = () => {},
    getCurrentContactId = () => null,
    loadOnlineStatus = () => {},
} = {}) {
    const previousBlocked = Boolean(getCurrentBlockState()?.is_blocked);
    const nextBlockState = normalizeBlockState(state);
    setCurrentBlockState(nextBlockState);
    const blocked = nextBlockState.is_blocked;
    const currentChatId = getCurrentChatId();
    const fileAttachInput = getFileAttachInput();
    const attachBtn = getAttachButton();

    applyBlockNoticeUIFn(nextBlockState, blockNoticeElements);
    if (composerRow) composerRow.style.display = blocked ? 'none' : '';
    if (fileAttachInput) fileAttachInput.disabled = blocked;
    if (attachBtn) {
        attachBtn.classList.toggle('disabled', blocked);
        attachBtn.disabled = blocked;
    }
    if (blocked) closeAttachMenu();
    updateVoiceRecordButtonState();

    if (blocked) {
        if (isVoiceRecordingActive()) {
            stopVoiceRecording({ reason: 'cancel' }).catch(() => {});
        }
        if (typeof hideTyping === 'function') hideTyping();
        if (currentChatId && typeof hideSidebarTyping === 'function') hideSidebarTyping(currentChatId);
        if (typeof hideContextMenu === 'function') hideContextMenu();
        closeReactionPicker();
        if (typeof closeMessageActionsBar === 'function') closeMessageActionsBar();
        if (typeof cancelReply === 'function') cancelReply();
        if (typeof cancelEdit === 'function') cancelEdit();
        if (isSelectionMode() && typeof toggleSelectionMode === 'function') toggleSelectionMode(false);
        if (deleteConfirmModal?.open) closeAnimatedDialog(deleteConfirmModal);
        if (syncChatRoom && currentChatId) {
            emitLeaveChatRoom(currentChatId);
        }
    } else if (syncChatRoom && currentChatId) {
        joinChatRoom(currentChatId);
    }

    updateBlockButtons();
    const currentPartnerData = getCurrentPartnerData();
    if (currentPartnerData) {
        currentPartnerData.block_state = { ...nextBlockState };
    }

    if (blocked) {
        if (currentPartnerData) {
            currentPartnerData.online = false;
            currentPartnerData.last_seen = null;
        }
        updateOnlineStatusUI(false, null);
        renderProfileHeader(currentPartnerData || {});
        return;
    }

    const currentContactId = getCurrentContactId();
    if (previousBlocked && currentContactId) {
        const knownOnline = currentPartnerData?.online;
        const knownLastSeen = currentPartnerData?.last_seen || null;
        updateOnlineStatusUI(knownOnline, knownLastSeen);
        loadOnlineStatus(currentContactId);
    }
}
