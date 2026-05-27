export const E2E_ACTIVATION_REQUIRED_MESSAGE = 'Введите 24 слова, чтобы активировать чаты.';

export function hasE2ePrivateKey(getPrivateKeyPem) {
    if (typeof getPrivateKeyPem !== 'function') return false;
    return Boolean(String(getPrivateKeyPem() || '').trim());
}

export function isE2eActivationLocked(getPrivateKeyPem) {
    return !hasE2ePrivateKey(getPrivateKeyPem);
}

export function requestE2eActivation({
    showToast,
    windowRef = typeof window !== 'undefined' ? window : null,
} = {}) {
    if (typeof windowRef?.openKeyRestoreModal === 'function') {
        windowRef.openKeyRestoreModal();
        return true;
    }
    if (typeof showToast === 'function') {
        showToast(E2E_ACTIVATION_REQUIRED_MESSAGE, 'warning');
    }
    return false;
}

export function syncE2eActivationSocket({
    socket,
    isLocked,
    syncSidebarStatusBar,
    syncChatConnectionStatus,
    reportActivity,
    documentRef = typeof document !== 'undefined' ? document : null,
} = {}) {
    const locked = typeof isLocked === 'function' ? Boolean(isLocked()) : true;
    if (locked) {
        if (socket?.connected || socket?.active) {
            socket.disconnect();
        }
        syncSidebarStatusBar?.();
        syncChatConnectionStatus?.();
        return false;
    }

    if (socket && socket.connected !== true) {
        socket.connect();
    }
    reportActivity?.(documentRef?.visibilityState === 'visible', { immediate: true });
    syncSidebarStatusBar?.();
    syncChatConnectionStatus?.();
    return true;
}
