import { initCaptionModal } from './caption-modal.js';

export function initChatCaptionModalRuntime({
    documentRef = document,
    activateFocusTrap = () => {},
    deactivateFocusTrap = () => {},
    sendFileMessage = () => Promise.resolve(),
    showToast = () => {},
} = {}) {
    return initCaptionModal({
        modalEl: documentRef.getElementById('captionModal'),
        previewEl: documentRef.getElementById('captionPreview'),
        metaEl: documentRef.getElementById('captionMeta'),
        inputEl: documentRef.getElementById('captionInput'),
        sendButtonEl: documentRef.getElementById('captionSendBtn'),
        closeButtonEl: documentRef.getElementById('captionModalClose'),
        titleEl: documentRef.getElementById('captionModalTitle'),
        hintEl: documentRef.getElementById('captionModalHint'),
        activateFocusTrap,
        deactivateFocusTrap,
        onSubmit: (file, caption, submitOptions = {}) => sendFileMessage(file, caption, submitOptions),
        onError: (error) => showToast(error.message, 'danger'),
    });
}
