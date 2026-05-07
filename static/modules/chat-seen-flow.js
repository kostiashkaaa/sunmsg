export function markCurrentChatSeenIfPossible({
    chatId = '',
    isChatBlocked = () => false,
    isWindowActive = () => false,
    clearTabAlertForChat = () => {},
    emitMessagesSeen = () => {},
} = {}) {
    const normalizedChatId = String(chatId || '').trim();
    if (!normalizedChatId) return;
    if (isChatBlocked()) return;
    if (!isWindowActive()) return;

    clearTabAlertForChat(normalizedChatId);
    emitMessagesSeen(normalizedChatId);
}
