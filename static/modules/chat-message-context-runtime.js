import { initMessageContextMenu } from './message-context-menu.js';
import {
    runMessageActionMotion,
    runMessageActionMotionById,
} from './message-action-motion.js';
import { initReactionPickerController } from './reaction-picker.js';
import { syncReactionPickerItems } from './chat-reaction-picker-items.js';

export function initChatMessageContextRuntime({
    documentRef = document,
    reactionPicker = null,
    contextMenu = null,
    contextReplyItem = null,
    contextPinItem = null,
    contextFavoriteItem = null,
    contextCopyItem = null,
    contextForwardItem = null,
    contextEditItem = null,
    contextSelectItem = null,
    contextReportItem = null,
    contextDeleteItem = null,
    isChatBlocked = () => false,
    getCurrentChatId = () => '',
    getPartnerDisplayName = () => '\u0421\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A',
    copyTextToClipboard = () => Promise.resolve(false),
    showToast = () => {},
    startReply = () => {},
    startEditMessage = () => {},
    isPinnedMessage = () => false,
    isFavoriteMessage = () => false,
    emitSocket = () => {},
    openDeleteModal = () => {},
    openForwardModal = () => {},
    toggleSelectionMode = () => {},
    toggleMessageSelection = () => {},
    openReportModal = () => {},
    emitReactionToggle = () => {},
} = {}) {
    const resolveMessageElement = (msgId) => {
        const token = String(msgId ?? '');
        if (!token) return null;
        return documentRef.querySelector(`.message[data-msg-id="${CSS.escape(token)}"]`);
    };

    syncReactionPickerItems(reactionPicker);

    const messageContextMenuController = initMessageContextMenu({
        menuEl: contextMenu,
        replyItemEl: contextReplyItem,
        pinItemEl: contextPinItem,
        favoriteItemEl: contextFavoriteItem,
        copyItemEl: contextCopyItem,
        forwardItemEl: contextForwardItem,
        editItemEl: contextEditItem,
        selectItemEl: contextSelectItem,
        reportItemEl: contextReportItem,
        deleteItemEl: contextDeleteItem,
        isChatBlocked,
        resolveMessageElement,
        getPartnerDisplayName,
        copyTextToClipboard,
        showToast,
        onReply: (msgId, text, sender) => {
            runMessageActionMotionById(documentRef, msgId, 'reply');
            startReply(msgId, text, sender);
        },
        onEdit: (msgId, text) => {
            runMessageActionMotionById(documentRef, msgId, 'edit');
            startEditMessage(msgId, text);
        },
        onPin: (msgId) => {
            if (isChatBlocked()) return;
            const currentChatId = getCurrentChatId();
            if (!msgId || !currentChatId) return;
            const normalizedMessageId = parseInt(String(msgId), 10);
            if (!Number.isFinite(normalizedMessageId) || normalizedMessageId <= 0) return;
            runMessageActionMotionById(documentRef, normalizedMessageId, 'pin');
            if (isPinnedMessage(currentChatId, normalizedMessageId)) {
                emitSocket('unpin_message', { chat_id: currentChatId, message_id: normalizedMessageId });
                return;
            }
            emitSocket('pin_message', { chat_id: currentChatId, message_id: normalizedMessageId });
        },
        onFavorite: (msgId) => {
            if (isChatBlocked()) return;
            const currentChatId = getCurrentChatId();
            if (!msgId || !currentChatId) return;
            const normalizedMessageId = parseInt(String(msgId), 10);
            if (!Number.isFinite(normalizedMessageId) || normalizedMessageId <= 0) return;
            runMessageActionMotionById(documentRef, normalizedMessageId, 'favorite');
            if (isFavoriteMessage(currentChatId, normalizedMessageId)) {
                emitSocket('unfavorite_message', { chat_id: currentChatId, message_id: normalizedMessageId });
                return;
            }
            emitSocket('favorite_message', { chat_id: currentChatId, message_id: normalizedMessageId });
        },
        onDelete: (msgId) => {
            runMessageActionMotionById(documentRef, msgId, 'delete');
            openDeleteModal(msgId);
        },
        onForward: (msgId) => {
            runMessageActionMotionById(documentRef, msgId, 'forward');
            openForwardModal([msgId]);
        },
        onSelect: (msgId, element) => {
            runMessageActionMotion(element, 'select');
            toggleSelectionMode(true);
            toggleMessageSelection(msgId, element);
        },
        onReport: (msgId, element) => {
            const safeId = Number.parseInt(String(msgId || ''), 10);
            const previewText = String(element?.getAttribute('data-message-content') || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 120);
            runMessageActionMotionById(documentRef, msgId, 'report');
            openReportModal({
                targetType: 'message',
                targetId: Number.isFinite(safeId) && safeId > 0 ? String(safeId) : String(msgId || ''),
                messageId: Number.isFinite(safeId) && safeId > 0 ? safeId : null,
                preview: previewText,
            });
        },
    });

    const reactionPickerController = initReactionPickerController({
        pickerEl: reactionPicker,
        contextMenuEl: contextMenu,
        getCurrentContextMessageId: () => messageContextMenuController.getCurrentMessageId(),
        resolveMessageElement,
        onSelectEmoji: (msgId, emoji) => emitReactionToggle(msgId, emoji),
    });

    return {
        messageContextMenuController,
        reactionPickerController,
    };
}
