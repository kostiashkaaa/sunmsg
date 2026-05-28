export function createActivityReporter({
    emitSocket,
    debounceMs = 1000,
    heartbeatMs = 60000,
} = {}) {
    let activityDebounceTimer = null;
    let heartbeatTimer = null;

    function clearPendingActivityUpdate() {
        if (!activityDebounceTimer) return;
        clearTimeout(activityDebounceTimer);
        activityDebounceTimer = null;
    }

    function reportActivity(isActive, { immediate = false } = {}) {
        clearPendingActivityUpdate();

        if (isActive) {
            emitSocket?.('activity_update', { active: true }, { requireConnected: true });
            return;
        }

        if (immediate) {
            emitSocket?.('activity_update', { active: false }, { requireConnected: true });
            return;
        }

        activityDebounceTimer = setTimeout(() => {
            emitSocket?.('activity_update', { active: false }, { requireConnected: true });
            activityDebounceTimer = null;
        }, debounceMs);
    }

    if (
        heartbeatMs > 0
        && typeof setInterval === 'function'
        && typeof document !== 'undefined'
    ) {
        heartbeatTimer = setInterval(() => {
            reportActivity(document.visibilityState === 'visible', { immediate: true });
        }, heartbeatMs);
    }

    return {
        reportActivity,
        dispose() {
            clearPendingActivityUpdate();
            if (heartbeatTimer) {
                clearInterval(heartbeatTimer);
                heartbeatTimer = null;
            }
        },
    };
}

export function bindWindowActivityEvents({
    reportActivity,
    onFocus,
} = {}) {
    const handleVisibilityChange = () => {
        reportActivity?.(document.visibilityState === 'visible', {
            immediate: document.visibilityState !== 'visible',
        });
    };
    const handleFocus = () => {
        reportActivity?.(true);
        onFocus?.();
    };
    const handleBlur = () => reportActivity?.(false);
    const handlePageHide = () => reportActivity?.(false, { immediate: true });

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);
    window.addEventListener('pagehide', handlePageHide);

    return function unbindWindowActivityEvents() {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
        window.removeEventListener('focus', handleFocus);
        window.removeEventListener('blur', handleBlur);
        window.removeEventListener('pagehide', handlePageHide);
    };
}
