export function bindChatMessageSurfaceEventsRuntime({
    chatMessages = null,
    jumpToNewMessagesBtn = null,
    chatLoadMoreThresholdPx = 0,
    isProfileDrawerOpen = () => false,
    closePartnerProfileDrawer = () => {},
    requestAutoScrollToBottom = () => {},
    cancelBottomInertiaScroll = () => {},
    isSelectionMode = () => false,
    openUserProfileById = () => {},
    openLightbox = null,
    getCurrentChatId = () => '',
    getSuppressChatScrollHandling = () => false,
    isReactionPickerOpen = () => false,
    closeReactionPicker = () => {},
    saveChatScrollPosition = () => {},
    scheduleVirtualChatRender = () => {},
    loadOlderMessages = () => {},
    isChatNearBottom = () => false,
    setKeepChatPinnedToBottom = () => {},
    isWindowActiveForUnreadHandling = () => false,
    getOpenChatUnreadCount = () => 0,
    resetOpenChatUnreadCounter = () => {},
    updateJumpToNewMessagesButton = () => {},
    cancelActiveUpload = null,
    requestAnimationFrameFn = requestAnimationFrame,
} = {}) {
    let scrollWorkFrame = 0;
    let pendingScrollChatId = '';

    jumpToNewMessagesBtn?.addEventListener('click', () => {
        if (isProfileDrawerOpen()) {
            closePartnerProfileDrawer();
        }
        requestAutoScrollToBottom({ ifNearBottom: false, smooth: true });
    });

    const stopBottomInertiaOnUserInput = () => {
        cancelBottomInertiaScroll();
    };
    chatMessages?.addEventListener('wheel', stopBottomInertiaOnUserInput, { passive: true });
    chatMessages?.addEventListener('touchstart', stopBottomInertiaOnUserInput, { passive: true });
    chatMessages?.addEventListener('pointerdown', stopBottomInertiaOnUserInput, { passive: true });

    const handleMessageProfileTrigger = (event) => {
        const trigger = event.target?.closest?.('[data-open-profile-trigger][data-profile-user-id]');
        if (!trigger || !chatMessages?.contains(trigger)) return;
        if (isSelectionMode()) return;
        const targetUserId = Number.parseInt(trigger.getAttribute('data-profile-user-id') || '', 10);
        if (!Number.isFinite(targetUserId) || targetUserId <= 0) return;
        event.preventDefault();
        event.stopPropagation();
        openUserProfileById(targetUserId);
    };

    // Delegated click for album cells — created via insertAdjacentHTML after buildMessageElement,
    // so they don't get the per-trigger listener attached in message-rendering.js
    chatMessages?.addEventListener('click', (event) => {
        const cell = event.target?.closest?.('.album-cell.file-msg-media-trigger');
        if (!cell || !chatMessages.contains(cell)) return;
        if (isSelectionMode()) return;
        if (typeof openLightbox === 'function') openLightbox(cell);
    });

    // Cancel upload by clicking the upload overlay ring
    chatMessages?.addEventListener('click', (event) => {
        const overlay = event.target?.closest?.('.media-status-overlay.is-uploading');
        if (!overlay || !chatMessages.contains(overlay)) return;
        event.stopPropagation();
        if (typeof cancelActiveUpload === 'function') cancelActiveUpload();
    });

    chatMessages?.addEventListener('click', handleMessageProfileTrigger);
    chatMessages?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        handleMessageProfileTrigger(event);
    });

    function runMessageScrollWork() {
        scrollWorkFrame = 0;
        const currentChatId = pendingScrollChatId || getCurrentChatId();
        pendingScrollChatId = '';
        if (!currentChatId) return;
        if (getSuppressChatScrollHandling()) return;

        saveChatScrollPosition(currentChatId);
        scheduleVirtualChatRender(currentChatId);

        if (chatMessages.scrollTop <= chatLoadMoreThresholdPx) {
            loadOlderMessages(currentChatId);
        }

        const nearBottom = isChatNearBottom();
        setKeepChatPinnedToBottom(nearBottom);

        if (nearBottom && isWindowActiveForUnreadHandling() && getOpenChatUnreadCount() > 0) {
            resetOpenChatUnreadCounter({ markSeen: true });
        }
        updateJumpToNewMessagesButton();
    }

    chatMessages?.addEventListener('scroll', () => {
        const currentChatId = getCurrentChatId();
        if (!currentChatId) return;
        if (getSuppressChatScrollHandling()) return;
        if (isReactionPickerOpen()) closeReactionPicker();
        pendingScrollChatId = currentChatId;
        if (scrollWorkFrame) return;
        scrollWorkFrame = requestAnimationFrameFn(runMessageScrollWork);
    }, { passive: true });
}
