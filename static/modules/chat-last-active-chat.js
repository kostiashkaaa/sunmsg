export function createLastActiveChatController({
    storageKey,
    storage,
    getStoredString,
    setStoredString,
    getCurrentChatId = () => '',
    contactsList = null,
    initialRequestedContactUserId = '',
    initialRequestedContactUsername = '',
    resolveContactItemByUserId = () => null,
    resolveContactItemByUsername = () => null,
    syncBrowserUrlForActiveChat = () => {},
} = {}) {
    function getStoredLastActiveChatId() {
        return getStoredString(storageKey, storage);
    }

    function persistLastActiveChatId(chatId) {
        const normalizedChatId = String(chatId || '').trim();
        setStoredString(storageKey, normalizedChatId, storage);
    }

    function clearStoredLastActiveChatId(chatId = null) {
        const normalizedChatId = String(chatId || '').trim();
        const storedChatId = getStoredLastActiveChatId();
        if (normalizedChatId && storedChatId && storedChatId !== normalizedChatId) {
            return;
        }
        persistLastActiveChatId('');
    }

    function restoreLastActiveChatSelection() {
        if (getCurrentChatId() || !contactsList) return false;
        if (initialRequestedContactUserId) {
            const preferredContactItem = resolveContactItemByUserId(initialRequestedContactUserId);
            if (preferredContactItem) {
                preferredContactItem.click();
                syncBrowserUrlForActiveChat(preferredContactItem);
                return true;
            }
        }
        if (initialRequestedContactUsername) {
            const preferredContactItem = resolveContactItemByUsername(initialRequestedContactUsername);
            if (preferredContactItem) {
                preferredContactItem.click();
                syncBrowserUrlForActiveChat(preferredContactItem);
                return true;
            }
        }
        syncBrowserUrlForActiveChat(null);
        return false;
    }

    return {
        getStoredLastActiveChatId,
        persistLastActiveChatId,
        clearStoredLastActiveChatId,
        restoreLastActiveChatSelection,
    };
}
