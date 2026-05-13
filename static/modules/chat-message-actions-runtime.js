import { initDeleteMessagesModal } from './chat-overlays.js';
import { initMessageActionHandlers } from './message-action-handlers.js';

export function initChatMessageActionsRuntime({
    documentRef = document,
    deleteConfirmModal = null,
    cancelDeleteBtn = null,
    confirmDeleteBtn = null,
    deleteForBothCheck = null,
    deleteForBothWrap = null,
    deleteForBothLabel = null,
    deleteModalTitle = null,
    deleteModalText = null,
    deleteModalAuthorAvatar = null,
    deleteModalAuthorName = null,
    barCopyBtn = null,
    barEditBtn = null,
    barDeleteBtn = null,
    barSelectBtn = null,
    cancelSelectionBtn = null,
    bulkDeleteBtn = null,
    bulkForwardBtn = null,
    bulkCopyBtn = null,
    barCancelBtn = null,
    chatMessages = null,
    isChatBlocked = () => false,
    isSavedMessagesChat = () => false,
    getBlockedNoticeText = () => '',
    getCurrentBlockState = () => null,
    getCurrentChatId = () => '',
    emitSocket = () => {},
    openDialog = () => {},
    closeDialog = () => {},
    messageSelectionController = null,
    messageActionsBarController = null,
    copyTextToClipboard = () => {},
    showToast = () => {},
    startEditMessage = () => {},
    toggleSelectionMode = () => {},
    openForwardModal = () => {},
    toggleMessageSelection = () => {},
    closeMessageActionsBar = () => {},
} = {}) {
    const { openDeleteModal } = initDeleteMessagesModal({
        modalEl: deleteConfirmModal,
        cancelButtonEl: cancelDeleteBtn,
        confirmButtonEl: confirmDeleteBtn,
        deleteForBothCheckEl: deleteForBothCheck,
        deleteForBothWrapEl: deleteForBothWrap,
        deleteForBothLabelEl: deleteForBothLabel,
        titleEl: deleteModalTitle,
        textEl: deleteModalText,
        authorAvatarEl: deleteModalAuthorAvatar,
        authorNameEl: deleteModalAuthorName,
        isChatBlocked,
        getBlockedNoticeText,
        currentBlockState: getCurrentBlockState,
        resolveMessageElement: (id) => {
            const token = String(id ?? '');
            if (!token) return null;
            return documentRef.querySelector(`.message[data-msg-id="${CSS.escape(token)}"]`);
        },
        openDialog,
        closeDialog,
        onConfirm: ({ messageIds, mode }) => {
            emitSocket('delete_messages', {
                msg_ids: messageIds,
                chat_id: getCurrentChatId(),
                mode,
            });
        },
        onBlocked: (text) => showToast(text, 'warning'),
        onAfterConfirm: () => {
            if (messageSelectionController?.isSelectionMode()) toggleSelectionMode(false);
            closeMessageActionsBar();
        },
        isSavedMessagesChat,
    });

    initMessageActionHandlers({
        barCopyButtonEl: barCopyBtn,
        barEditButtonEl: barEditBtn,
        barDeleteButtonEl: barDeleteBtn,
        barSelectButtonEl: barSelectBtn,
        cancelSelectionButtonEl: cancelSelectionBtn,
        bulkDeleteButtonEl: bulkDeleteBtn,
        bulkForwardButtonEl: bulkForwardBtn,
        bulkCopyButtonEl: bulkCopyBtn,
        chatMessages,
        getSelectedMessageState: () => messageActionsBarController.getState(),
        messageSelectionController,
        copyTextToClipboard,
        showToast,
        isChatBlocked,
        openDeleteModal,
        startEditMessage,
        toggleSelectionMode,
        onForwardSelected: (messageIds) => {
            openForwardModal(messageIds);
        },
        toggleMessageSelection,
        closeMessageActionsBar,
        resolveMessageElement: (id) => {
            const token = String(id ?? '');
            if (!token) return null;
            return documentRef.querySelector(`.message[data-msg-id="${CSS.escape(token)}"]`);
        },
    });
    barCancelBtn?.addEventListener('click', () => closeMessageActionsBar());

    return {
        openDeleteModal,
    };
}
