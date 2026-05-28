export function wireSocketLifecycleHandlers({
    socket,
    reportActivity,
    syncChatConnectionStatus,
    getCurrentChatId,
    isChatBlocked,
    isChatNearBottom = () => false,
    joinChatRoom,
    markCurrentChatSeenIfPossible,
    retryPendingDraftSaves,
    syncSidebarStatusBar,
    loadContacts,
    loadDialogRequests,
    refreshCurrentPresence,
    getHasSocketConnectedOnce,
    setHasSocketConnectedOnce,
    setHasSocketConnectionIssue,
    syncOnReconnect,
}) {
    socket.on('connect', () => {
        setHasSocketConnectionIssue(false);
        reportActivity(document.visibilityState === 'visible');
        syncChatConnectionStatus();

        const currentChatId = getCurrentChatId();
        if (currentChatId && !isChatBlocked()) {
            joinChatRoom(currentChatId);
            if (isChatNearBottom()) {
                markCurrentChatSeenIfPossible();
            }
            refreshCurrentPresence?.();
        }

        syncSidebarStatusBar();

        if (getHasSocketConnectedOnce()) {
            retryPendingDraftSaves?.();
            loadContacts();
            loadDialogRequests();
            if (currentChatId && typeof syncOnReconnect === 'function') {
                void syncOnReconnect(currentChatId);
            }
            return;
        }
        setHasSocketConnectedOnce(true);
    });

    socket.on('connect_error', (err) => {
        console.warn('Socket connect error:', err?.message || err);
        setHasSocketConnectionIssue(true);
        syncSidebarStatusBar();
        syncChatConnectionStatus();
    });

    socket.on('disconnect', (reason) => {
        console.warn('Socket disconnected:', reason);
        setHasSocketConnectionIssue(navigator.onLine !== false);
        syncSidebarStatusBar();
        syncChatConnectionStatus();
    });
}

export function registerRealtimeOrchestrator(options = {}) {
    const {
        socket,
        registerMessageStatusSocketHandlers,
        registerIncomingMessageSocketHandlers,
        registerProfileRealtimeSocketHandlers,
        registerSystemSocketHandlers,
        markOutgoingVoiceMessageListenedByPartner,
        messageStatusOptions,
        incomingOptions,
        profileOptions,
        systemOptions,
    } = options;

    const messageStatusRuntime = registerMessageStatusSocketHandlers(messageStatusOptions);

    socket.on('voice_message_listened', (data) => {
        const chatId = String(data?.chat_id || '').trim();
        const msgId = Number(data?.msg_id ?? data?.message_id);
        if (!chatId || !Number.isFinite(msgId) || msgId <= 0) return;
        markOutgoingVoiceMessageListenedByPartner(chatId, msgId);
    });

    registerIncomingMessageSocketHandlers(incomingOptions);
    registerProfileRealtimeSocketHandlers(profileOptions);
    registerSystemSocketHandlers(systemOptions);

    return {
        messageStatusRuntime,
    };
}
