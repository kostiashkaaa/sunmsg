export function syncE2EPillState({
    getPrivateKeyPem,
    getCurrentContactPublicKey,
    getCurrentChatId,
    getChatState,
    e2ePillWrap,
    e2eIndicator,
}) {
    const hasPrivateKey = Boolean(getPrivateKeyPem());
    const hasContactKey = Boolean(getCurrentContactPublicKey());
    const currentChatId = getCurrentChatId();
    const active = hasPrivateKey && hasContactKey && Boolean(currentChatId);
    const state = active ? getChatState(currentChatId) : null;
    const messageCount = Array.isArray(state?.messages) ? state.messages.length : 0;
    const showPill = active && messageCount > 0 && messageCount <= 3;

    if (e2ePillWrap) {
        e2ePillWrap.style.display = showPill ? '' : 'none';
    }
    if (e2eIndicator) {
        e2eIndicator.style.display = 'none';
        e2eIndicator.hidden = true;
        e2eIndicator.setAttribute('aria-pressed', 'false');
    }
}