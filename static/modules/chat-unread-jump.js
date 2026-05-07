export function updateJumpToNewMessagesButton({
    jumpToNewMessagesBtn = null,
    jumpToNewMessagesCount = null,
    currentChatId = '',
    chatMessages = null,
    isChatNearBottom = () => true,
    openChatUnreadCount = 0,
    newMessagesAriaLabel = 'К новым сообщениям',
    scrollDownAriaLabel = 'Вниз',
} = {}) {
    if (!jumpToNewMessagesBtn) return;
    const hasVisibleChat = Boolean(currentChatId) && chatMessages?.style.display !== 'none';
    const shouldShow = hasVisibleChat && !isChatNearBottom();

    jumpToNewMessagesBtn.classList.toggle('is-visible', shouldShow);
    jumpToNewMessagesBtn.setAttribute('aria-hidden', shouldShow ? 'false' : 'true');
    jumpToNewMessagesBtn.tabIndex = shouldShow ? 0 : -1;
    jumpToNewMessagesBtn.setAttribute(
        'aria-label',
        openChatUnreadCount > 0 ? newMessagesAriaLabel : scrollDownAriaLabel,
    );

    if (!jumpToNewMessagesCount) return;
    if (openChatUnreadCount > 0) {
        jumpToNewMessagesCount.style.display = 'inline-flex';
        jumpToNewMessagesCount.textContent = openChatUnreadCount > 99 ? '99+' : String(openChatUnreadCount);
    } else {
        jumpToNewMessagesCount.style.display = 'none';
        jumpToNewMessagesCount.textContent = '0';
    }
}

export function resetOpenChatUnreadCounter({
    markSeen = false,
    setOpenChatUnreadCount = () => {},
    updateJumpToNewMessagesButton = () => {},
    markCurrentChatSeenIfPossible = () => {},
    setContactUnreadBadge = () => {},
    currentChatId = '',
} = {}) {
    setOpenChatUnreadCount(0);
    updateJumpToNewMessagesButton();
    if (markSeen) {
        markCurrentChatSeenIfPossible();
    }
    setContactUnreadBadge(currentChatId, 0);
}
