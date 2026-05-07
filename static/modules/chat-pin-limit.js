export function getPinnedContactsCount(contactsList) {
    return Array.from(contactsList?.querySelectorAll('.contact-item[data-pinned="1"]') || []).length;
}

export function canPinMoreChats({
    chatId,
    pinnedChatsLimit,
    resolveContactItemByChatId = () => null,
    getPinnedContactsCount = () => 0,
} = {}) {
    if (!Number.isFinite(pinnedChatsLimit) || pinnedChatsLimit <= 0) return true;
    const normalizedChatId = String(chatId || '').trim();
    const targetItem = normalizedChatId ? resolveContactItemByChatId(normalizedChatId) : null;
    if (targetItem?.getAttribute('data-pinned') === '1') return true;
    return getPinnedContactsCount() < pinnedChatsLimit;
}
