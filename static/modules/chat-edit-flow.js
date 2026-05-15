const LINK_MESSAGE_PATTERN = /((https?:\/\/|www\.)[^\s<]+)/i;

function getEditableMessageType(editingFilePayload, content) {
    if (editingFilePayload) {
        const attachMode = editingFilePayload.attach_mode === 'file' ? 'file' : 'media';
        if (attachMode === 'file'
            && (editingFilePayload.mime?.startsWith('image/') || editingFilePayload.mime?.startsWith('video/'))) {
            return 'file';
        }
        if (editingFilePayload.mime?.startsWith('image/')) return 'photo';
        if (editingFilePayload.mime?.startsWith('video/')) return 'video';
        if (editingFilePayload.mime?.startsWith('audio/')) return 'audio';
        return 'file';
    }
    return LINK_MESSAGE_PATTERN.test(content) ? 'link' : 'text';
}

function buildEditedMessagePlainText(editingFilePayload, content) {
    if (!editingFilePayload) return content;
    return JSON.stringify({
        ...editingFilePayload,
        caption: content,
    });
}

export async function handleComposerEditFlow({
    content,
    isEditingMessageId,
    isEditingFilePayload,
    applyEditedMessageLocally,
    encryptForCurrentChat,
    emitSocket,
    currentChatId,
    cancelEdit,
    showToast,
} = {}) {
    if (!isEditingMessageId) return false;

    // For plain-text messages an empty edit is not allowed
    if (!isEditingFilePayload && !String(content || '').trim()) {
        showToast?.('Нельзя сохранить пустое сообщение', 'warning');
        return true; // consumed — don't fall through to send
    }

    const plainToSend = buildEditedMessagePlainText(isEditingFilePayload, content);
    const msgType = getEditableMessageType(isEditingFilePayload, content);

    void applyEditedMessageLocally;
    const encrypted = await encryptForCurrentChat(plainToSend);
    emitSocket('edit_message', {
        msg_id: isEditingMessageId,
        new_content: encrypted,
        chat_id: currentChatId,
        message_type: msgType,
    });
    cancelEdit();
    return true;
}
