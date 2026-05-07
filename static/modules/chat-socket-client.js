import { getCsrfToken } from './csrf.js';
import { withAppRoot } from './app-url.js';

const IDEMPOTENT_SOCKET_EVENTS = new Set([
    'send_message',
    'edit_message',
    'delete_messages',
]);

function buildSocketRequestId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `req_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`;
}

export function createChatSocketClient(socketClientConfig = {}) {
    const transports = Array.isArray(socketClientConfig.transports)
        ? socketClientConfig.transports
            .filter((transport) => typeof transport === 'string')
            .map((transport) => transport.trim())
            .filter(Boolean)
        : [];

    const socketPath = withAppRoot(
        typeof socketClientConfig.path === 'string' && socketClientConfig.path.trim()
            ? socketClientConfig.path.trim()
            : '/socket.io',
    );

    return io({
        path: socketPath,
        transports: transports.length > 0 ? transports : ['polling', 'websocket'],
        upgrade: socketClientConfig.upgrade !== false,
        withCredentials: true,
        reconnection: true,
        timeout: 10000,
        auth: (cb) => cb({ csrf_token: getCsrfToken() }),
    });
}

export function createSocketEmitter(socket) {
    return function emitSocket(eventName, payload = {}, { requireConnected = false } = {}) {
        if (!socket) return false;
        if (requireConnected && !socket.connected) return false;

        let data = payload;
        if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
            data = { ...payload };
            if (!Object.prototype.hasOwnProperty.call(data, 'csrf_token')) {
                const csrf = getCsrfToken();
                if (csrf) data.csrf_token = csrf;
            }
            if (
                IDEMPOTENT_SOCKET_EVENTS.has(String(eventName || ''))
                && !Object.prototype.hasOwnProperty.call(data, 'request_id')
            ) {
                data.request_id = buildSocketRequestId();
            }
        }

        socket.emit(eventName, data);
        return true;
    };
}
