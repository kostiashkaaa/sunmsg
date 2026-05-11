import { bindWindowActivityEvents, createActivityReporter } from './chat-activity.js';
import { createChatSocketClient, createSocketEmitter } from './chat-socket-client.js';

export function initSettingsPresence({
    isEmbedded = false,
    socketClientConfig = null,
} = {}) {
    if (isEmbedded) return null;
    if (typeof window === 'undefined' || typeof document === 'undefined') return null;
    if (typeof globalThis.io !== 'function') return null;

    const bootstrapConfig = window.SUN_BOOTSTRAP?.socketio || {};
    const socket = createChatSocketClient(socketClientConfig || bootstrapConfig);
    const emitSocket = createSocketEmitter(socket);
    const activityController = createActivityReporter({ emitSocket });
    const reportActivity = activityController.reportActivity;

    const reportCurrentActivity = () => {
        const isVisible = document.visibilityState === 'visible';
        reportActivity(isVisible, { immediate: !isVisible });
    };

    const unbindWindowActivityEvents = bindWindowActivityEvents({ reportActivity });
    socket.on('connect', reportCurrentActivity);
    if (socket.connected) {
        reportCurrentActivity();
    }

    return {
        socket,
        dispose() {
            socket.off?.('connect', reportCurrentActivity);
            unbindWindowActivityEvents();
            activityController.dispose();
        },
    };
}
