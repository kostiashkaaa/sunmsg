export function bindChatComposerInputRuntime({
    documentRef = document,
    messageInput = null,
    isMobileWidth = () => false,
    isCoarsePointer = () => false,
    updateVoiceRecordButtonState = () => {},
    scheduleCurrentChatDraftSave = () => {},
    isChatNearBottom = () => false,
    requestAutoScrollToBottom = () => {},
    setLastMobileKeyboardDismissAt = () => {},
    setTimeoutFn = setTimeout,
    now = () => Date.now(),
} = {}) {
    if (!messageInput) return () => {};

    const handleInput = () => {
        updateVoiceRecordButtonState();
        scheduleCurrentChatDraftSave();
    };
    const handleFocus = () => {
        if (!isMobileWidth()) return;
        const wasNearBottom = isChatNearBottom();
        setTimeoutFn(() => {
            if (wasNearBottom) {
                requestAutoScrollToBottom({ ifNearBottom: false });
            }
        }, 300);
    };
    const handleBlur = () => {
        scheduleCurrentChatDraftSave({ immediate: true });
        if (!isCoarsePointer()) return;
        setTimeoutFn(() => {
            const active = documentRef.activeElement;
            if (!active || active === documentRef.body) {
                setLastMobileKeyboardDismissAt(now());
            }
        }, 0);
    };

    messageInput.addEventListener('input', handleInput);
    messageInput.addEventListener('focus', handleFocus);
    messageInput.addEventListener('blur', handleBlur);

    return () => {
        messageInput.removeEventListener('input', handleInput);
        messageInput.removeEventListener('focus', handleFocus);
        messageInput.removeEventListener('blur', handleBlur);
    };
}
