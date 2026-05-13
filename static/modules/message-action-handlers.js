import {
    runMessageActionMotion,
    runMessageActionMotionForIds,
} from './message-action-motion.js';

export function initMessageActionHandlers({
    barCopyButtonEl,
    barEditButtonEl,
    barDeleteButtonEl,
    barSelectButtonEl,
    cancelSelectionButtonEl,
    bulkDeleteButtonEl,
    bulkForwardButtonEl,
    bulkCopyButtonEl,
    chatMessages,
    getSelectedMessageState,
    messageSelectionController,
    copyTextToClipboard,
    showToast,
    isChatBlocked,
    openDeleteModal,
    startEditMessage,
    toggleSelectionMode,
    onForwardSelected,
    toggleMessageSelection,
    closeMessageActionsBar,
    resolveMessageElement,
} = {}) {
    const documentRef = chatMessages?.ownerDocument || globalThis.document || null;

    barCopyButtonEl?.addEventListener('click', async () => {
        const state = getSelectedMessageState();
        if (!state.messageText || state.isFile) return;
        runMessageActionMotion(resolveMessageElement(state.messageId), 'copy');
        const copied = await copyTextToClipboard(state.messageText);
        if (copied) {
            showToast('\u0422\u0435\u043A\u0441\u0442 \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D', 'success');
        }
        closeMessageActionsBar();
    });

    barEditButtonEl?.addEventListener('click', () => {
        const state = getSelectedMessageState();
        if (isChatBlocked()) return;
        if (!state.messageId || state.isFile || state.canEdit === false) return;
        runMessageActionMotion(resolveMessageElement(state.messageId), 'edit');
        startEditMessage(state.messageId, state.messageText);
        closeMessageActionsBar();
    });

    barSelectButtonEl?.addEventListener('click', () => {
        const state = getSelectedMessageState();
        if (isChatBlocked()) return;
        const targetMessageId = state.messageId ? String(state.messageId) : '';
        if (!targetMessageId) return;
        toggleSelectionMode(true);
        const element = resolveMessageElement(targetMessageId);
        if (element) {
            runMessageActionMotion(element, 'select');
            toggleMessageSelection(targetMessageId, element);
        }
    });

    cancelSelectionButtonEl?.addEventListener('click', () => toggleSelectionMode(false));

    bulkDeleteButtonEl?.addEventListener('click', () => {
        if (isChatBlocked()) return;
        if (messageSelectionController.getSelectedCount() > 0) {
            runMessageActionMotionForIds(documentRef, messageSelectionController.getSelectedIds(), 'delete');
            openDeleteModal(messageSelectionController.getSelectedIds());
        }
    });

    bulkForwardButtonEl?.addEventListener('click', () => {
        if (isChatBlocked()) return;
        const selectedIds = messageSelectionController.getSelectedIds();
        if (!selectedIds.length) return;
        runMessageActionMotionForIds(documentRef, selectedIds, 'forward');
        onForwardSelected?.(selectedIds);
    });

    bulkCopyButtonEl?.addEventListener('click', async () => {
        const texts = [];
        messageSelectionController.getSelectedIds().forEach((id) => {
            const element = resolveMessageElement(id);
            if (!element) return;
            const content = element.getAttribute('data-message-content');
            if (content) texts.push(content);
        });
        if (!texts.length) return;

        runMessageActionMotionForIds(documentRef, messageSelectionController.getSelectedIds(), 'copy');
        const copied = await copyTextToClipboard(texts.join('\n'));
        if (copied) {
            showToast('\u0422\u0435\u043A\u0441\u0442\u044B \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u044B', 'success');
            toggleSelectionMode(false);
        }
    });

    barDeleteButtonEl?.addEventListener('click', () => {
        const state = getSelectedMessageState();
        if (isChatBlocked()) return;
        if (state.messageId) {
            runMessageActionMotion(resolveMessageElement(state.messageId), 'delete');
            openDeleteModal(state.messageId);
        }
    });

    chatMessages?.addEventListener('click', (event) => {
        if (!messageSelectionController.isSelectionMode()) return;
        const message = event.target.closest('.message[data-msg-id]');
        if (!message) return;
        event.preventDefault();
        event.stopPropagation();
        toggleMessageSelection(message.getAttribute('data-msg-id'), message);
    });
}
