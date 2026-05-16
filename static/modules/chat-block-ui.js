export function getChatBlockNoticeText(state = {}) {
    if (state.blocked_by_me && state.blocked_me) return 'Вы заблокировали пользователя и заблокированы';
    if (state.blocked_by_me) return 'Вы заблокировали пользователя';
    if (state.blocked_me) return 'Вы заблокированы';
    return '';
}

export function updateBlockButtons({
    currentBlockState,
    normalizeBlockState = (value) => value,
    getBlockChatBtn = () => document.getElementById('blockChatBtn'),
    chatUnblockBtn = null,
} = {}) {
    const state = normalizeBlockState(currentBlockState);
    const byMe = Boolean(state?.blocked_by_me);

    const blockChatBtn = getBlockChatBtn();
    if (blockChatBtn) {
        const iconClass = byMe ? 'bi bi-unlock' : 'bi bi-slash-circle';
        const title = byMe ? 'Разблокировать пользователя' : 'Заблокировать пользователя';
        blockChatBtn.setAttribute('data-mode', byMe ? 'unblock' : 'block');

        let iconEl = blockChatBtn.querySelector('i');
        let labelEl = blockChatBtn.querySelector('#blockChatBtnLabel');
        if (!iconEl || !labelEl) {
            blockChatBtn.textContent = '';
            iconEl = document.createElement('i');
            iconEl.setAttribute('aria-hidden', 'true');
            const sep = document.createTextNode(' ');
            labelEl = document.createElement('span');
            labelEl.id = 'blockChatBtnLabel';
            blockChatBtn.appendChild(iconEl);
            blockChatBtn.appendChild(sep);
            blockChatBtn.appendChild(labelEl);
        }
        iconEl.className = iconClass;
        labelEl.textContent = title;
    }

    if (chatUnblockBtn) {
        chatUnblockBtn.style.display = byMe ? 'inline-flex' : 'none';
    }
}
