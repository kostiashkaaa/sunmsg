import { createTypingSignalHeartbeat } from './chat-typing-signal-heartbeat.js';

export function createChatComposerPresenceRuntime({
    emitSocket,
    getCurrentChatId,
    isChatBlocked,
    isEditingMessage,
    typingEmitIntervalMs = 1200,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    nowFn = () => Date.now(),
} = {}) {
    let typingTimeout = null;
    let lastTypingEmitAt = 0;

    const voiceTypingSignal = createTypingSignalHeartbeat({
        emitSocket,
        getChatId: () => getCurrentChatId?.(),
        isBlocked: () => Boolean(isChatBlocked?.()),
    });

    function clearTypingTimeout() {
        if (!typingTimeout) return;
        clearTimeoutFn(typingTimeout);
        typingTimeout = null;
    }

    function emitStopTyping(chatId = getCurrentChatId?.()) {
        if (!chatId) return;
        emitSocket?.('stop_typing', { chat_id: chatId });
    }

    function onComposerTyping() {
        const chatId = getCurrentChatId?.();
        if (!chatId || isEditingMessage?.() || isChatBlocked?.()) return;
        const now = nowFn();
        if ((now - lastTypingEmitAt) >= typingEmitIntervalMs) {
            emitSocket?.('typing', { chat_id: chatId });
            lastTypingEmitAt = now;
        }
        clearTypingTimeout();
        typingTimeout = setTimeoutFn(() => {
            emitStopTyping(getCurrentChatId?.());
            lastTypingEmitAt = 0;
        }, 2000);
    }

    function onComposerStopTyping() {
        clearTypingTimeout();
        emitStopTyping(getCurrentChatId?.());
        lastTypingEmitAt = 0;
    }

    function onVoiceRecordingPresenceChange(isRecording) {
        const chatId = getCurrentChatId?.();
        if (!chatId || isChatBlocked?.()) return;
        clearTypingTimeout();
        if (isRecording) {
            voiceTypingSignal.start('voice');
            lastTypingEmitAt = nowFn();
            return;
        }
        voiceTypingSignal.stop('voice');
        lastTypingEmitAt = 0;
    }

    function stopAll() {
        emitStopTyping(getCurrentChatId?.());
        voiceTypingSignal.stopAll();
        clearTypingTimeout();
        lastTypingEmitAt = 0;
    }

    return {
        onComposerTyping,
        onComposerStopTyping,
        onVoiceRecordingPresenceChange,
        stopAll,
    };
}
