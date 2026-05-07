import { escapeHtml } from './utils.js';
import {
    closeAnimatedOverlay,
    isOverlayVisible,
    openAnimatedOverlay,
} from './chat-shell-ui.js';

export function initCaptionModal({
    modalEl,
    previewEl,
    metaEl,
    inputEl,
    sendButtonEl,
    closeButtonEl,
    titleEl,
    hintEl,
    activateFocusTrap,
    deactivateFocusTrap,
    onSubmit,
    onError,
} = {}) {
    let pendingPayload = null;
    let previewObjectUrl = '';

    function cleanupPreviewObjectUrl() {
        if (!previewObjectUrl) return;
        try {
            URL.revokeObjectURL(previewObjectUrl);
        } catch (_) {}
        previewObjectUrl = '';
    }

    function resolveAttachMode(value) {
        return value === 'media' ? 'media' : 'file';
    }

    function formatFileSize(bytes) {
        const value = Number(bytes);
        if (!Number.isFinite(value) || value <= 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const order = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
        const sized = value / (1024 ** order);
        const precision = order === 0 ? 0 : (sized >= 100 ? 0 : 1);
        return `${sized.toFixed(precision)} ${units[order]}`;
    }

    function resolveFileKindLabel(file) {
        const mime = String(file?.type || '').toLowerCase();
        if (mime.startsWith('image/')) return '\u0424\u043E\u0442\u043E';
        if (mime.startsWith('video/')) return '\u0412\u0438\u0434\u0435\u043E';
        if (mime.startsWith('audio/')) return '\u0410\u0443\u0434\u0438\u043E';
        return '\u0424\u0430\u0439\u043B';
    }

    function resolveFileExtLabel(file) {
        const name = String(file?.name || '');
        const dotIndex = name.lastIndexOf('.');
        if (dotIndex > -1 && dotIndex < name.length - 1) {
            return name.slice(dotIndex + 1).toUpperCase();
        }
        const mime = String(file?.type || '').toLowerCase();
        if (!mime) return 'BIN';
        const [, subtype = 'BIN'] = mime.split('/');
        return subtype.toUpperCase();
    }

    function resolveFilePreviewIcon(file) {
        const ext = resolveFileExtLabel(file).toLowerCase();
        if (['pdf'].includes(ext)) return 'bi-file-earmark-pdf';
        if (['doc', 'docx'].includes(ext)) return 'bi-file-earmark-word';
        if (['xls', 'xlsx', 'csv'].includes(ext)) return 'bi-file-earmark-spreadsheet';
        if (['zip', 'rar', '7z'].includes(ext)) return 'bi-file-earmark-zip';
        if (['mp3', 'wav', 'ogg', 'm4a', 'aac', 'opus'].includes(ext)) return 'bi-file-earmark-music';
        return 'bi-file-earmark';
    }

    function renderModalMeta(file, attachMode) {
        if (!metaEl) return;
        const modeText = attachMode === 'media'
            ? '\u0424\u043E\u0442\u043E/\u0432\u0438\u0434\u0435\u043E (\u043E\u043F\u0442\u0438\u043C\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u043D\u043E)'
            : '\u0414\u043E\u043A\u0443\u043C\u0435\u043D\u0442 (\u0431\u0435\u0437 \u0441\u0436\u0430\u0442\u0438\u044F)';
        metaEl.innerHTML = `
            <span class="caption-meta-chip caption-meta-chip--accent">${escapeHtml(modeText)}</span>
            <span class="caption-meta-chip">${escapeHtml(resolveFileKindLabel(file))}</span>
            <span class="caption-meta-chip">${escapeHtml(resolveFileExtLabel(file))}</span>
            <span class="caption-meta-chip">${escapeHtml(formatFileSize(file?.size || 0))}</span>
        `;
    }

    function renderPreview(file) {
        if (!previewEl) return;
        cleanupPreviewObjectUrl();
        previewEl.innerHTML = '';

        const mime = String(file?.type || '').toLowerCase();
        const isImage = mime.startsWith('image/');
        const isVideo = mime.startsWith('video/');

        if (isImage || isVideo) {
            previewObjectUrl = URL.createObjectURL(file);
            previewEl.innerHTML = isImage
                ? `<img src="${escapeHtml(previewObjectUrl)}" alt="${escapeHtml(file.name)}">`
                : `<video class="caption-preview-video" src="${escapeHtml(previewObjectUrl)}" preload="metadata" muted playsinline controls></video>`;
        } else {
            previewEl.innerHTML = `<div class="caption-file-icon"><i class="bi ${resolveFilePreviewIcon(file)}"></i></div>`;
        }

        previewEl.insertAdjacentHTML(
            'beforeend',
            `<span class="caption-file-name" title="${escapeHtml(file.name || '')}">${escapeHtml(file.name || '')}</span>`,
        );
    }

    function showCaptionModal(file, options = {}) {
        const attachMode = resolveAttachMode(options?.attachMode);
        pendingPayload = {
            file,
            options: {
                ...options,
                attachMode,
            },
        };
        if (!previewEl || !inputEl) return;

        inputEl.value = '';
        renderPreview(file);
        renderModalMeta(file, attachMode);
        if (titleEl) {
            titleEl.textContent = attachMode === 'media' ? '\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0444\u043E\u0442\u043E \u0438\u043B\u0438 \u0432\u0438\u0434\u0435\u043E' : '\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0444\u0430\u0439\u043B';
        }
        if (hintEl) {
            hintEl.textContent = attachMode === 'media'
                ? '\u0424\u0430\u0439\u043B \u0431\u0443\u0434\u0435\u0442 \u043E\u043F\u0442\u0438\u043C\u0438\u0437\u0438\u0440\u043E\u0432\u0430\u043D \u043F\u0435\u0440\u0435\u0434 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u043E\u0439'
                : '\u041E\u0442\u043F\u0440\u0430\u0432\u043A\u0430 \u043E\u0440\u0438\u0433\u0438\u043D\u0430\u043B\u0430 \u0431\u0435\u0437 \u0441\u0436\u0430\u0442\u0438\u044F';
        }

        if (modalEl) {
            openAnimatedOverlay(modalEl, { focusTarget: inputEl });
            activateFocusTrap?.(modalEl);
        }
    }

    function closeCaptionModal() {
        pendingPayload = null;
        cleanupPreviewObjectUrl();
        if (previewEl) previewEl.innerHTML = '';
        if (metaEl) metaEl.innerHTML = '';
        if (!modalEl) return;
        deactivateFocusTrap?.(modalEl);
        closeAnimatedOverlay(modalEl);
    }

    async function submitPendingCaption() {
        if (!pendingPayload?.file) return;
        const caption = String(inputEl?.value || '').trim();
        const file = pendingPayload.file;
        const submitOptions = pendingPayload.options || {};
        closeCaptionModal();
        try {
            await onSubmit?.(file, caption, submitOptions);
        } catch (error) {
            onError?.(error);
        }
    }

    sendButtonEl?.addEventListener('click', submitPendingCaption);
    inputEl?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            submitPendingCaption();
        }
    });
    closeButtonEl?.addEventListener('click', closeCaptionModal);
    modalEl?.addEventListener('click', (event) => {
        if (event.target === modalEl) {
            closeCaptionModal();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (!isOverlayVisible(modalEl)) return;
        closeCaptionModal();
    });

    return {
        showCaptionModal,
        closeCaptionModal,
        hasPendingFile() {
            return Boolean(pendingPayload?.file);
        },
    };
}
