export function syncProfileMoreMenuChatActions({
    currentChatId = '',
    resolveContactItemByChatId = () => null,
    isChatMuted = () => false,
    canPinMoreChats = () => true,
    pinnedChatsLimit = 5,
    profileToggleMuteMenuBtn = null,
    profileToggleMuteMenuIcon = null,
    profileToggleMuteMenuLabel = null,
    profileTogglePinMenuBtn = null,
    profileTogglePinMenuIcon = null,
    profileTogglePinMenuLabel = null,
    profileDeleteChatMenuBtn = null,
} = {}) {
    const hasChat = Boolean(currentChatId);
    const contactItem = hasChat ? resolveContactItemByChatId(currentChatId) : null;
    const isGroupChat = Boolean(contactItem && String(contactItem.getAttribute('data-is-group') || '') === '1');
    const muted = hasChat ? isChatMuted(currentChatId) : false;
    const pinned = Boolean(contactItem && contactItem.getAttribute('data-pinned') === '1');
    const pinLimitReached = hasChat && !pinned && !canPinMoreChats(currentChatId);

    if (profileToggleMuteMenuBtn) {
        profileToggleMuteMenuBtn.disabled = !hasChat;
    }
    if (profileToggleMuteMenuIcon) {
        profileToggleMuteMenuIcon.className = muted ? 'bi bi-bell' : 'bi bi-bell-slash';
    }
    if (profileToggleMuteMenuLabel) {
        profileToggleMuteMenuLabel.textContent = muted ? 'Включить уведомления' : 'Отключить уведомления';
    }

    if (profileTogglePinMenuBtn) {
        profileTogglePinMenuBtn.disabled = !hasChat || pinLimitReached;
        profileTogglePinMenuBtn.title = pinLimitReached
            ? `Можно закрепить не более ${pinnedChatsLimit} чатов`
            : '';
    }
    if (profileTogglePinMenuIcon) {
        profileTogglePinMenuIcon.className = pinned ? 'bi bi-pin-angle-fill' : 'bi bi-pin-angle';
    }
    if (profileTogglePinMenuLabel) {
        profileTogglePinMenuLabel.textContent = pinned ? 'Открепить чат' : 'Закрепить чат';
    }

    if (profileDeleteChatMenuBtn) {
        profileDeleteChatMenuBtn.disabled = !hasChat;
        const icon = profileDeleteChatMenuBtn.querySelector('i');
        const label = profileDeleteChatMenuBtn.querySelector('span');
        if (icon) {
            icon.className = isGroupChat ? 'bi bi-box-arrow-right' : 'bi bi-trash3';
        }
        if (label) {
            label.textContent = isGroupChat ? 'Покинуть группу' : 'Удалить чат';
        }
    }
}
