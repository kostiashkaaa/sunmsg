export function createContextMenuApi({
    messageContextMenuController,
    messageSelectionController,
}) {
    function showContextMenu(x, y, msgId, isSelf, isFile, options = {}) {
        void isFile;
        messageContextMenuController.showContextMenu(x, y, msgId, isSelf, options);
    }

    function hideContextMenu() {
        messageContextMenuController.hideContextMenu();
    }

    function toggleSelectionMode(on) {
        messageSelectionController.setSelectionMode(on);
    }

    function toggleMessageSelection(msgId, element) {
        messageSelectionController.toggleMessageSelection(msgId, element);
    }

    return {
        showContextMenu,
        hideContextMenu,
        toggleSelectionMode,
        toggleMessageSelection,
    };
}