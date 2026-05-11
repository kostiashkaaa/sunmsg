export function createChatContactPreviewRuntime({
    getCurrentChatId,
    resolveContactItemByChatId,
    hideSidebarTyping,
    updateActiveContactLastMessageFlow,
    sortContactsList,
    contactsSidebarController,
    setContactUnreadBadge,
} = {}) {
    function updateActiveContactLastMessage(
        message,
        isSelf = true,
        status = { is_read: false, is_delivered: false },
        timestamp = null,
    ) {
        const currentChatId = getCurrentChatId?.();
        if (!currentChatId) return;
        const contactItem = resolveContactItemByChatId?.(currentChatId);
        if (!contactItem) return;
        hideSidebarTyping?.(currentChatId);
        updateActiveContactLastMessageFlow?.(contactItem, message, isSelf, status, timestamp);
        sortContactsList?.();
    }

    function updateContactLastMessageForChat(
        chatId,
        message,
        isSelf = true,
        status = { is_read: false, is_delivered: false },
        timestamp = null,
    ) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return;
        const contactItem = resolveContactItemByChatId?.(normalizedChatId);
        if (!contactItem) return;
        hideSidebarTyping?.(normalizedChatId);
        updateActiveContactLastMessageFlow?.(contactItem, message, isSelf, status, timestamp);
        sortContactsList?.();
    }

    function updateSidebarForOtherChat(
        chatId,
        message,
        isSelf,
        timestamp,
        status = { is_read: false, is_delivered: false },
    ) {
        contactsSidebarController?.updateSidebarForOtherChat(
            chatId,
            message,
            isSelf,
            timestamp,
            status,
            setContactUnreadBadge,
        );
    }

    return {
        updateActiveContactLastMessage,
        updateContactLastMessageForChat,
        updateSidebarForOtherChat,
    };
}
