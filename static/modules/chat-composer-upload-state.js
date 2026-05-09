function clampUploadProgress(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(100, Math.round(numeric)));
}

function normalizeClientId(value) {
    return String(value || '').trim();
}

export function createComposerUploadState() {
    let activeClientId = '';
    let activeProgress = 0;
    let cancelUpload = null;

    function isActive() {
        return Boolean(activeClientId);
    }

    function setActive({
        clientId,
        progress = 0,
        cancel = null,
    } = {}) {
        const normalizedClientId = normalizeClientId(clientId);
        if (!normalizedClientId) return false;
        activeClientId = normalizedClientId;
        activeProgress = clampUploadProgress(progress);
        if (typeof cancel === 'function') {
            cancelUpload = cancel;
        }
        return true;
    }

    function updateProgress(clientId, progress) {
        const normalizedClientId = normalizeClientId(clientId);
        if (!activeClientId || normalizedClientId !== activeClientId) return false;
        activeProgress = clampUploadProgress(progress);
        return true;
    }

    function clear(clientId = '') {
        const normalizedClientId = normalizeClientId(clientId);
        if (normalizedClientId && normalizedClientId !== activeClientId) return false;
        if (!activeClientId) return false;
        activeClientId = '';
        activeProgress = 0;
        cancelUpload = null;
        return true;
    }

    function canCancel() {
        return Boolean(activeClientId) && typeof cancelUpload === 'function';
    }

    function cancelActiveUpload() {
        if (!canCancel()) return false;
        const cancelFn = cancelUpload;
        cancelUpload = null;
        try {
            cancelFn();
        } catch (_) {}
        return true;
    }

    function getProgress() {
        return activeClientId ? activeProgress : 0;
    }

    function getClientId() {
        return activeClientId;
    }

    return {
        isActive,
        setActive,
        updateProgress,
        clear,
        canCancel,
        cancelActiveUpload,
        getProgress,
        getClientId,
    };
}
