import { runMessageSelectionMotion } from './message-action-motion.js';

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

        isSelectionMode = nextState;
        chatMessages?.classList.toggle('selecting', isSelectionMode);
        headerSelectionWrap?.classList.toggle('active', isSelectionMode);

        if (isSelectionMode) {
            selectedMsgIds.clear();
            getMessageElements().forEach((message) => {
                message.classList.remove('selected');
                message.classList.add('selecting');
            });
            onEnterSelectionMode?.();
        } else {
            selectedMsgIds.clear();
            getMessageElements().forEach((message) => {
                message.classList.remove('selecting');
                message.classList.remove('selected');
            });
            onExitSelectionMode?.();
        }

        updateSelectionUI();
    }

    function toggleMessageSelection(msgId, element) {
        const normalizedId = String(msgId || '');
        if (!normalizedId) return;

        if (selectedMsgIds.has(normalizedId)) {
            selectedMsgIds.delete(normalizedId);
            element?.classList.remove('selected');
            runMessageSelectionMotion(element, false);
        } else {
            selectedMsgIds.add(normalizedId);
            element?.classList.add('selected');
            runMessageSelectionMotion(element, true);
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
