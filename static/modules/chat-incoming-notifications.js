export function notifyIncomingChatMessage({
    chatId,
    isCurrentChat = false,
    isMention = false,
    isChatMuted = () => false,
    isWindowActive = () => true,
    pushTabAlert = () => {},
    showToast = () => {},
    newMessageToastText = 'Новое сообщение',
    mentionToastText = 'Вас упомянули',
    allowMentionWhenMuted = true,
} = {}) {
    const normalizedChatId = String(chatId || '').trim();
    if (!normalizedChatId) return;

    const mentionNotification = Boolean(isMention);
    const muted = Boolean(isChatMuted(normalizedChatId));
    if (muted && !(mentionNotification && allowMentionWhenMuted)) return;

    const windowActive = Boolean(isWindowActive());
    const toastText = mentionNotification
        ? String(mentionToastText || '')
        : String(newMessageToastText || '');
    const toastType = mentionNotification ? 'warning' : 'info';

    if (!isCurrentChat) {
        pushTabAlert(normalizedChatId);
        if (windowActive) {
            showToast(toastText, toastType);
        }
        return;
    }

    if (mentionNotification) {
        if (windowActive) {
            showToast(toastText, toastType);
        } else {
            pushTabAlert(normalizedChatId);
        }
        return;
    }

    if (!windowActive) {
        pushTabAlert(normalizedChatId);
    }
}

