export function bindChatEscapeOverlaysRuntime({
    documentRef = document,
    isReactionPickerOpen = () => false,
    closeReactionPicker = () => {},
    isAttachMenuOpen = () => false,
    closeAttachMenu = () => {},
    hasPendingCaptionFile = () => false,
    closeCaptionModal = () => {},
    getLightbox = () => null,
    closeLightbox = () => {},
    closeMessageSearchOverlay = () => false,
    isSelectionMode = () => false,
    toggleSelectionMode = () => {},
    isEditingMessage = () => false,
    cancelEdit = () => {},
    getReplyState = () => ({}),
    cancelReply = () => {},
} = {}) {
    documentRef.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (isReactionPickerOpen()) { closeReactionPicker(); return; }
        if (isAttachMenuOpen()) { closeAttachMenu(); return; }
        if (hasPendingCaptionFile()) { closeCaptionModal(); return; }
        const lightbox = getLightbox();
        if (lightbox?.classList.contains('active')) { closeLightbox(); return; }
        if (closeMessageSearchOverlay()) return;
        if (isSelectionMode()) { toggleSelectionMode(false); return; }
        if (isEditingMessage()) cancelEdit();
        if (getReplyState().replyToId) cancelReply();
    });
}
