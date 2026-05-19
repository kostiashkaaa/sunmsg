import { runMessageSelectionMotion } from './message-action-motion.js';
import { withStableChatScroll } from './chat-scroll-stability.js';

const SELECTED_FOLLOWED_BY_SELECTED_CLASS = 'selected-followed-by-selected';

export function syncSelectedMessageAdjacency(chatMessages) {
    if (!chatMessages) return;
    chatMessages.querySelectorAll('.message').forEach((message) => {
        const nextElement = message.nextElementSibling;
        const isFollowedBySelected = Boolean(
            message.classList.contains('selected')
            && nextElement?.classList.contains('message')
            && nextElement.classList.contains('selected')
        );
        message.classList.toggle(SELECTED_FOLLOWED_BY_SELECTED_CLASS, isFollowedBySelected);
    });
}

export function initMessageSelection({
    chatMessages,
    headerSelectionWrap,
    selectedCountEl,
    bulkDeleteButtonEl,
    bulkForwardButtonEl,
    bulkCopyButtonEl,
    onEnterSelectionMode,
    onExitSelectionMode,
} = {}) {
    let isSelectionMode = false;
    const selectedMsgIds = new Set();

    function getMessageElements() {
        return chatMessages?.querySelectorAll('.message') ?? [];
    }

    function updateSelectionUI() {
        if (selectedCountEl) {
            selectedCountEl.textContent = selectedMsgIds.size;
        }
        if (bulkDeleteButtonEl) {
            bulkDeleteButtonEl.disabled = selectedMsgIds.size === 0;
        }
        if (bulkCopyButtonEl) {
            bulkCopyButtonEl.disabled = selectedMsgIds.size === 0;
        }
        if (bulkForwardButtonEl) {
            bulkForwardButtonEl.disabled = selectedMsgIds.size === 0;
        }
    }

    function setSelectionMode(on) {
        const nextState = Boolean(on);
        if (nextState === isSelectionMode) {
            updateSelectionUI();
            return;
        }

        withStableChatScroll(chatMessages, () => {
            isSelectionMode = nextState;
            chatMessages?.classList.toggle('selecting', isSelectionMode);
            headerSelectionWrap?.classList.toggle('active', isSelectionMode);

            if (isSelectionMode) {
                selectedMsgIds.clear();
                getMessageElements().forEach((message) => {
                    message.classList.remove('selected');
                    message.classList.remove(SELECTED_FOLLOWED_BY_SELECTED_CLASS);
                    message.classList.add('selecting');
                });
                syncSelectedMessageAdjacency(chatMessages);
                onEnterSelectionMode?.();
            } else {
                selectedMsgIds.clear();
                getMessageElements().forEach((message) => {
                    message.classList.remove('selecting');
                    message.classList.remove('selected');
                    message.classList.remove(SELECTED_FOLLOWED_BY_SELECTED_CLASS);
                });
                onExitSelectionMode?.();
            }
        });

        updateSelectionUI();
    }

    function toggleMessageSelection(msgId, element) {
        const normalizedId = String(msgId || '');
        if (!normalizedId) return;

        if (selectedMsgIds.has(normalizedId)) {
            withStableChatScroll(element || chatMessages, () => {
                selectedMsgIds.delete(normalizedId);
                element?.classList.remove('selected');
                syncSelectedMessageAdjacency(chatMessages);
                runMessageSelectionMotion(element, false);
            });
        } else {
            withStableChatScroll(element || chatMessages, () => {
                selectedMsgIds.add(normalizedId);
                element?.classList.add('selected');
                syncSelectedMessageAdjacency(chatMessages);
                runMessageSelectionMotion(element, true);
            });
        }

        updateSelectionUI();
    }

    return {
        isSelectionMode() {
            return isSelectionMode;
        },
        setSelectionMode,
        toggleMessageSelection,
        hasSelectedMessage(msgId) {
            return selectedMsgIds.has(String(msgId || ''));
        },
        getSelectedIds() {
            return Array.from(selectedMsgIds);
        },
        getSelectedCount() {
            return selectedMsgIds.size;
        },
    };
}
