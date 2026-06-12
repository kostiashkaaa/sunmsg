// Clipboard paste + drag&drop file uploads. Binds handlers to the
// composer input and chat area, delegates uploads via handleFileUpload.

export function initChatClipboardAndDrop(deps = {}) {
    const {
        messageInput,
        chatArea,
        dragDropOverlay,
        handleFileUpload,
        isProfileDrawerOpen,
        getCurrentChatId,
        showToast,
    } = deps;

    function extractClipboardFiles(event) {
        const clipboardData = event.clipboardData || event.originalEvent?.clipboardData;
        if (!clipboardData) return [];

        // Prefer items API (more reliable); fall back to files.
        // Never read BOTH - they contain the same data and cause duplicates.
        if (clipboardData.items && clipboardData.items.length) {
            const files = [];
            for (const item of clipboardData.items) {
                if (item.kind === 'file') {
                    const file = item.getAsFile();
                    if (file) files.push(file);
                }
            }
            if (files.length) return files;
        }

        if (clipboardData.files && clipboardData.files.length) {
            return Array.from(clipboardData.files);
        }

        return [];
    }

    function handleClipboardPaste(e) {
        const files = extractClipboardFiles(e);
        if (!files.length) return;

        e.preventDefault();
        const allowCaption = files.length === 1;
        files.forEach((file) => handleFileUpload(file, { allowCaption }));
    }

    if (messageInput) {
        messageInput.addEventListener('paste', handleClipboardPaste);
    }

    document.addEventListener('paste', (e) => {
        if (!getCurrentChatId?.()) return;
        if (e.target === messageInput) return;
        handleClipboardPaste(e);
    });

    if (chatArea && dragDropOverlay) {
        // dragDepth counts how deep the cursor is inside nested children so the
        // overlay survives moving between child elements. It is only ever
        // touched while the overlay is shown, which keeps enter/leave symmetric
        // even when dragenter bails out early (no chat, drawer open, no files).
        let dragDepth = 0;

        function isFileDrag(e) {
            const types = e.dataTransfer?.types;
            return !!types && Array.prototype.includes.call(types, 'Files');
        }

        function canAcceptDrop() {
            return !!getCurrentChatId?.() && !isProfileDrawerOpen?.();
        }

        function showOverlay() {
            dragDropOverlay.classList.add('active');
        }

        function hideOverlay() {
            dragDepth = 0;
            dragDropOverlay.classList.remove('active');
        }

        chatArea.addEventListener('dragenter', (e) => {
            // Only handle real file drags, not in-page text/image drags.
            if (!isFileDrag(e)) return;
            if (!canAcceptDrop()) return;
            e.preventDefault();
            dragDepth++;
            showOverlay();
        });

        chatArea.addEventListener('dragover', (e) => {
            if (!isFileDrag(e)) return;
            if (!canAcceptDrop()) {
                hideOverlay();
                return;
            }
            e.preventDefault(); // required to allow drop
            e.dataTransfer.dropEffect = 'copy';
            // Re-assert the overlay in case a dragenter was missed (e.g. the
            // drag started outside chatArea and moved in over a child).
            if (!dragDepth) dragDepth = 1;
            showOverlay();
        });

        chatArea.addEventListener('dragleave', () => {
            if (!dragDepth) return;
            dragDepth--;
            if (dragDepth <= 0) hideOverlay();
        });

        chatArea.addEventListener('drop', (e) => {
            e.preventDefault();
            hideOverlay();
            if (!getCurrentChatId?.()) {
                showToast('Выберите чат перед отправкой файла.', 'warning');
                return;
            }
            if (isProfileDrawerOpen?.()) return;
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                const allowCaption = files.length === 1;
                for (const file of files) handleFileUpload(file, { allowCaption });
            }
        });

        // Safety nets: hide the overlay if the drag ends or leaves the window
        // entirely, otherwise it can stay stuck after the cursor exits.
        window.addEventListener('dragend', hideOverlay);
        window.addEventListener('drop', (e) => {
            if (!chatArea.contains(e.target)) hideOverlay();
        });
        document.addEventListener('dragleave', (e) => {
            // relatedTarget is null when the pointer leaves the viewport.
            if (!e.relatedTarget) hideOverlay();
        });
    }
}
