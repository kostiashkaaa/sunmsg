export function configureOnlineStatusController({
    onlineStatusController,
    syncChatConnectionStatus,
    baseUpdateOnlineStatusUI,
} = {}) {
    onlineStatusController?.configure?.({
        syncChatConnectionStatus,
        baseUpdateOnlineStatusUI,
    });
}

export function applyOnlineStatus(onlineStatusController, online, lastSeen) {
    onlineStatusController?.applyOnlineStatus?.(online, lastSeen);
}

export function markOnlineStatusPending(onlineStatusController) {
    onlineStatusController?.markPending?.();
}

export function clearOnlineStatusPending(onlineStatusController) {
    onlineStatusController?.clearPending?.();
}

export function markMessagesAsRead({
    chatId,
    markMessagesAsReadFlow,
    isBlockedChat,
    getCsrfToken,
    onSuccess,
} = {}) {
    return markMessagesAsReadFlow({
        chatId,
        isBlockedChat,
        getCsrfToken,
        onSuccess,
    });
}

export function loadOnlineStatus({
    userId,
    onlineStatusController,
    loadOnlineStatusFlow,
    isBlockedChat,
    updateOnlineStatusUI,
    markOnlineStatusPending,
    clearOnlineStatusPending,
    getCurrentContactId,
    getCurrentPartnerData,
    getCurrentBlockState,
    normalizeBlockState,
    setCurrentPartnerData,
} = {}) {
    const requestId = onlineStatusController?.nextRequestId?.();
    return loadOnlineStatusFlow({
        userId,
        isChatBlocked: () => isBlockedChat(),
        updateOnlineStatusUI,
        markOnlineStatusPending,
        clearOnlineStatusPending,
        shouldApplyResult: () => (
            onlineStatusController?.shouldApplyResult?.(
                requestId,
                userId,
                getCurrentContactId?.(),
            )
        ),
        getCurrentPartnerData,
        getCurrentBlockState,
        normalizeBlockState,
        setCurrentPartnerData,
    });
}
