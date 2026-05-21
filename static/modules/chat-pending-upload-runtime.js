import { clampUploadProgress } from './upload-progress.js';

export function createPendingUploadRuntime({
    getCurrentChatId,
    getChatState,
    findMessageIndex,
    getChatMessages,
    parseSunFilePayload,
    updateMessageContent,
    cssEscape = globalThis.CSS?.escape,
} = {}) {
    const escapeCss = typeof cssEscape === 'function'
        ? cssEscape
        : (value) => String(value).replace(/["\\]/g, '\\$&');

    function buildPendingMediaDimensions(width, height) {
        const safeWidth = Math.round(Number(width) || 0);
        const safeHeight = Math.round(Number(height) || 0);
        if (!(safeWidth > 0) || !(safeHeight > 0)) return null;
        return {
            preview_width: safeWidth,
            preview_height: safeHeight,
            preview_aspect_ratio: Number((safeWidth / safeHeight).toFixed(4)),
        };
    }

    function resolvePendingMessageByClientId(clientId) {
        const currentChatId = getCurrentChatId?.();
        if (!currentChatId || !clientId) return null;
        const state = getChatState?.(currentChatId);
        const index = findMessageIndex?.(state, (msg) => msg.clientId === clientId);
        if (!Number.isFinite(index) || index < 0) return null;
        return {
            state,
            index,
            message: state.messages[index],
            element: getChatMessages?.()?.querySelector(`.message.self[data-client-id="${escapeCss(clientId)}"]`) || null,
        };
    }

    function persistPendingMediaDimensions(messageEl, width, height) {
        const clientId = messageEl?.getAttribute('data-client-id');
        if (!clientId) return null;
        const resolved = resolvePendingMessageByClientId(clientId);
        if (!resolved) return null;
        const filePayload = parseSunFilePayload?.(resolved.message.message);
        if (!filePayload) return null;
        const nextDimensions = buildPendingMediaDimensions(width, height);
        if (!nextDimensions) return null;

        const prevWidth = Number(filePayload.preview_width);
        const prevHeight = Number(filePayload.preview_height);
        const prevRatio = Number(filePayload.preview_aspect_ratio);
        const nextRatio = Number(nextDimensions.preview_aspect_ratio);
        const unchanged = prevWidth === nextDimensions.preview_width
            && prevHeight === nextDimensions.preview_height
            && Math.abs(prevRatio - nextRatio) < 0.0001;
        if (unchanged) {
            return { ...filePayload, ...nextDimensions };
        }

        const nextPayload = { ...filePayload, ...nextDimensions };
        const nextMessageText = JSON.stringify(nextPayload);
        resolved.state.messages[resolved.index] = {
            ...resolved.message,
            message: nextMessageText,
        };
        resolved.element?.setAttribute('data-message-content', nextMessageText);
        return nextPayload;
    }

    function syncPendingMediaOverlay(messageEl, filePayload) {
        if (!messageEl || !filePayload) return;
        const mediaWrap = messageEl.querySelector('.image-wrapper, .video-preview');
        if (!mediaWrap) return;

        const isUploading = Boolean(filePayload.uploading);
        const progress = clampUploadProgress(filePayload.upload_progress);
        mediaWrap.classList.toggle('is-uploading', isUploading);
        mediaWrap.setAttribute('data-upload-progress', String(progress));

        const overlay = mediaWrap.querySelector('.media-status-overlay');
        if (overlay) {
            overlay.classList.toggle('is-uploading', isUploading);
            overlay.setAttribute('data-upload-progress', String(progress));
            overlay.style.setProperty('--upload-progress', String(progress));
        }

        const progressBar = mediaWrap.querySelector('.media-upload-progress-bar');
        if (progressBar) {
            progressBar.setAttribute('data-upload-progress', String(progress));
            progressBar.style.setProperty('--upload-progress', String(progress));
        }
    }

    function syncPendingInlineUpload(messageEl, filePayload) {
        if (!messageEl || !filePayload) return;
        const uploadEl = messageEl.querySelector('[data-file-upload-inline="1"]');
        if (!uploadEl) return;

        const isUploading = Boolean(filePayload.uploading);
        const progress = clampUploadProgress(filePayload.upload_progress);
        uploadEl.classList.toggle('is-uploading', isUploading);
        uploadEl.classList.toggle('is-hidden', !isUploading);
        uploadEl.setAttribute('data-upload-progress', String(progress));
        uploadEl.style.setProperty('--upload-progress', String(progress));

        const percentEl = uploadEl.querySelector('.file-upload-inline-percent');
        if (percentEl) {
            percentEl.textContent = `${progress}%`;
        }

        const fileLinkEl = messageEl.querySelector('.file-msg-link');
        if (fileLinkEl) {
            fileLinkEl.classList.toggle('is-uploading', isUploading);
            fileLinkEl.setAttribute('aria-disabled', isUploading ? 'true' : 'false');
        }
    }

    function syncPendingUploadIndicators(messageEl, filePayload) {
        syncPendingMediaOverlay(messageEl, filePayload);
        syncPendingInlineUpload(messageEl, filePayload);
    }

    function updatePendingFileUploadProgress(clientId, percent) {
        const resolved = resolvePendingMessageByClientId(clientId);
        if (!resolved) return;

        const filePayload = parseSunFilePayload?.(resolved.message.message);
        if (!filePayload) return;

        const nextPayload = {
            ...filePayload,
            uploading: true,
            upload_progress: clampUploadProgress(percent),
        };
        resolved.state.messages[resolved.index] = {
            ...resolved.message,
            message: JSON.stringify(nextPayload),
        };
        syncPendingUploadIndicators(resolved.element, nextPayload);
    }

    function commitPendingFileUpload(clientId, nextFilePayload) {
        const resolved = resolvePendingMessageByClientId(clientId);
        if (!resolved) return;

        const currentFilePayload = parseSunFilePayload?.(resolved.message.message) || {};
        const nextPayload = {
            ...currentFilePayload,
            ...nextFilePayload,
            preview_width: nextFilePayload?.preview_width ?? currentFilePayload.preview_width,
            preview_height: nextFilePayload?.preview_height ?? currentFilePayload.preview_height,
            preview_aspect_ratio: nextFilePayload?.preview_aspect_ratio ?? currentFilePayload.preview_aspect_ratio,
            uploading: false,
            upload_progress: 100,
        };
        const nextMessageText = JSON.stringify(nextPayload);
        resolved.state.messages[resolved.index] = {
            ...resolved.message,
            message: nextMessageText,
        };

        if (resolved.element) {
            updateMessageContent?.(resolved.element, nextMessageText, true);
        }
    }

    return {
        buildPendingMediaDimensions,
        resolvePendingMessageByClientId,
        persistPendingMediaDimensions,
        syncPendingUploadIndicators,
        updatePendingFileUploadProgress,
        commitPendingFileUpload,
    };
}
