export function initChatEmojiRefreshRuntime({
    windowRef = window,
    documentRef = document,
    requestAnimationFrameFn = requestAnimationFrame,
    applyEmojiGraphics = () => {},
    chatMessages = null,
    contactsList = null,
    reactionPicker = null,
} = {}) {
    function refreshVisibleEmojiGraphics() {
        applyEmojiGraphics(chatMessages);
        applyEmojiGraphics(contactsList);
        applyEmojiGraphics(reactionPicker);
        applyEmojiGraphics(documentRef.getElementById('replyBarText'));
        applyEmojiGraphics(documentRef.getElementById('pinnedBarText'));
    }

    applyEmojiGraphics(reactionPicker);
    requestAnimationFrameFn(refreshVisibleEmojiGraphics);
    windowRef.addEventListener('load', refreshVisibleEmojiGraphics, { once: true });

    return {
        refreshVisibleEmojiGraphics,
    };
}
