export function notifyIncomingChatMessage({
    chatId,
    isCurrentChat = false,
    isChatMuted = () => false,
    isWindowActive = () => true,
    pushTabAlert = () => {},
    showToast = () => {},
    newMessageToastText = 'Новое сообщение',
} = {}) {
    const normalizedChatId = String(chatId || '').trim();
    if (!normalizedChatId) return;
    if (isChatMuted(normalizedChatId)) return;

    const windowActive = Boolean(isWindowActive());
    if (!isCurrentChat) {
        pushTabAlert(normalizedChatId);
        if (windowActive) {
            showToast(String(newMessageToastText || ''), 'info');
        }
        return;
    }

    if (!windowActive) {
        pushTabAlert(normalizedChatId);
    }
}
