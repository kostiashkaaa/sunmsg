export function wireWindowActivityEvents({
    reportActivity,
    tabAlertController,
    isChatNearBottom,
    isWindowActiveForUnreadHandling,
    getCurrentChatId,
    getOpenChatUnreadCount,
    resetOpenChatUnreadCounter,
    markCurrentChatSeenIfPossible,
}) {
    const handleVisibilityChange = () => {
        if (document.visibilityState !== 'visible' || !document.hasFocus()) return;
        tabAlertController.clearAllAlerts();
        if (getCurrentChatId() && isChatNearBottom() && isWindowActiveForUnreadHandling()) {
            if (getOpenChatUnreadCount() > 0) {
                resetOpenChatUnreadCounter({ markSeen: true });
            } else {
                markCurrentChatSeenIfPossible();
            }
        }
        reportActivity(true);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
}

export function wireBeforeUnloadCleanup({
    tabAlertController,
    dateNavigatorController,
    reportActivity,
    activityController,
    unbindWindowActivityEvents,
    voiceRecorderController,
    disposeChatAnimations,
    isChatIdbReady,
    chatIdbRuntime,
    getExistingChatHistoryRuntime,
    disposeMediaCacheRuntime,
    disconnectSocket,
}) {
    window.addEventListener('beforeunload', () => {
        tabAlertController.stopBlinking();
        dateNavigatorController.destroy();
        reportActivity(false, { immediate: true });
        activityController.dispose();
        if (typeof unbindWindowActivityEvents === 'function') {
            unbindWindowActivityEvents();
        }
        voiceRecorderController.cleanup();
        if (typeof disposeChatAnimations === 'function') {
            disposeChatAnimations();
        }
        if (isChatIdbReady()) {
            chatIdbRuntime.close().catch(() => {});
        }
        const runtime = getExistingChatHistoryRuntime();
        if (runtime) {
            runtime.dispose();
        }
        if (typeof disposeMediaCacheRuntime === 'function') {
            try {
                disposeMediaCacheRuntime();
            } catch (_) {}
        }
        if (typeof disconnectSocket === 'function') {
            try {
                disconnectSocket();
            } catch (_) {}
        }
    });
}
