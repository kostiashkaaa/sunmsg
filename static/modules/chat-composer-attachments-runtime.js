import { createChatAttachMenuController } from './chat-attach-menu.js';

export function createChatComposerAttachmentsRuntime({
    documentRef = document,
    windowRef = window,
    voiceRecordBtn = null,
    voiceRecordCancelBtn = null,
    voiceRecordSendBtn = null,
    isChatBlocked = () => false,
    getCurrentBlockState = () => null,
    getBlockedNoticeText = () => '',
    maxChatMediaSize = 0,
    showToast = () => {},
    showCaptionModal = () => {},
    sendFileMessage = () => Promise.resolve(),
    cancelActiveComposerUpload = () => {},
    startVoiceRecording = () => Promise.resolve(),
    stopVoiceRecording = () => Promise.resolve(),
    updateVoiceRecordButtonState = () => {},
} = {}) {
    const fileAttachInput = documentRef.getElementById('fileAttachInput');
    const attachBtn = documentRef.getElementById('attachBtn');
    const attachMenu = documentRef.getElementById('attachMenu');
    const attachMenuItems = Array.from(attachMenu?.querySelectorAll('[data-attach-mode]') || []);
    let attachMenuPanelController = null;

    async function handleFileUpload(fileOrFiles, { allowCaption = true, attachMode = null } = {}) {
        if (isChatBlocked()) {
            showToast(getBlockedNoticeText(getCurrentBlockState()), 'warning');
            return;
        }

        // Normalize to array
        const files = Array.isArray(fileOrFiles) ? fileOrFiles : (fileOrFiles ? [fileOrFiles] : []);
        if (!files.length) return;

        const primaryFile = files[0];
        const normalizedAttachMode = attachMenuPanelController?.resolveAttachModeForFile(primaryFile, attachMode) || 'file';

        if (allowCaption) {
            showCaptionModal(primaryFile, { attachMode: normalizedAttachMode, files });
            return;
        }

        for (const file of files) {
            if (normalizedAttachMode !== 'media' && file.size > maxChatMediaSize) {
                showToast(
                    `\u0424\u0430\u0439\u043B "${file.name}" \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u0431\u043E\u043B\u044C\u0448\u043E\u0439. \u041C\u0430\u043A\u0441. ${Math.round(maxChatMediaSize / (1024 * 1024))} \u041C\u0411.`,
                    'danger',
                );
                continue;
            }
            try {
                await sendFileMessage(file, '', { attachMode: normalizedAttachMode });
            } catch (err) {
                showToast(err.message || '\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438 \u0444\u0430\u0439\u043B\u0430.', 'danger');
            }
        }
    }

    attachMenuPanelController = createChatAttachMenuController({
        attachMenu,
        attachBtn,
        fileAttachInput,
        attachMenuItems,
        isChatBlocked,
        handleFileUpload,
    });

    voiceRecordBtn?.addEventListener('click', () => {
        if (voiceRecordBtn.classList.contains('is-uploading-state')) {
            cancelActiveComposerUpload();
            return;
        }
        if (voiceRecordBtn.classList.contains('is-send-state')) {
            const messageForm = documentRef.getElementById('messageForm');
            if (messageForm && typeof messageForm.requestSubmit === 'function') {
                messageForm.requestSubmit();
            } else if (messageForm) {
                messageForm.dispatchEvent(new windowRef.Event('submit', { cancelable: true, bubbles: true }));
            }
            return;
        }
        startVoiceRecording().catch((err) => {
            showToast(err?.message || '\u041E\u0448\u0438\u0431\u043A\u0430 \u0437\u0430\u043F\u0438\u0441\u0438.', 'danger');
        });
    });

    voiceRecordCancelBtn?.addEventListener('click', () => {
        stopVoiceRecording({ reason: 'cancel' }).catch((err) => {
            showToast(err?.message || '\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043C\u0435\u043D\u044B \u0437\u0430\u043F\u0438\u0441\u0438.', 'danger');
        });
    });

    voiceRecordSendBtn?.addEventListener('click', () => {
        stopVoiceRecording({ reason: 'send' }).catch((err) => {
            showToast(err?.message || '\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0433\u043E.', 'danger');
        });
    });

    updateVoiceRecordButtonState();

    return {
        handleFileUpload,
        resolveAttachModeForFile: (file, preferredMode = null) => (
            attachMenuPanelController?.resolveAttachModeForFile(file, preferredMode) || 'file'
        ),
        closeAttachMenu: () => attachMenuPanelController?.closeAttachMenu(),
        isAttachMenuOpen: () => Boolean(attachMenuPanelController?.isAttachMenuOpen()),
    };
}
