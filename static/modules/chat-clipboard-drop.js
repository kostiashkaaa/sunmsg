// Clipboard paste + drag&drop file uploads. Привязывает обработчики к
// composer-input и chat-area, делегирует загрузку через handleFileUpload.

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
        let dragDepth = 0;

        chatArea.addEventListener('dragenter', (e) => {
            if (!getCurrentChatId?.()) return;
            if (isProfileDrawerOpen?.()) return;
            // Only handle real file drags, not browser image drags
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault();
            dragDepth++;
            dragDropOverlay.classList.add('active');
        });

        chatArea.addEventListener('dragover', (e) => {
            if (!getCurrentChatId?.()) return;
            if (isProfileDrawerOpen?.()) return;
            if (!e.dataTransfer.types.includes('Files')) return;
            e.preventDefault(); // required to allow drop
        });

        chatArea.addEventListener('dragleave', () => {
            dragDepth--;
            if (dragDepth <= 0) {
                dragDepth = 0;
                dragDropOverlay.classList.remove('active');
            }
        });

        chatArea.addEventListener('drop', (e) => {
            e.preventDefault();
            dragDepth = 0;
            dragDropOverlay.classList.remove('active');
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
    }
}
