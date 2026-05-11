import { getCsrfToken } from './csrf.js';
import { withAppRoot } from './app-url.js';

const IDEMPOTENT_SOCKET_EVENTS = new Set([
    'send_message',
    'edit_message',
    'delete_messages',
]);
const SOCKET_EVENT_DEDUPE_LIMIT = 2000;

function isObjectPayload(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function extractEnvelope(value) {
    if (!isObjectPayload(value)) return null;
    const directEnvelope = isObjectPayload(value.envelope) ? value.envelope : null;
    if (directEnvelope && typeof directEnvelope.event_id === 'string') {
        return directEnvelope;
    }
    if (
        typeof value.event_id === 'string'
        && typeof value.event_type === 'string'
        && typeof value.server_ts === 'string'
    ) {
        return {
            v: Number.isFinite(Number(value.v)) ? Number(value.v) : 1,
            event_id: value.event_id,
            event_type: value.event_type,
            server_ts: value.server_ts,
            chat_id: typeof value.chat_id === 'string' ? value.chat_id : null,
            chat_pts: Number.isFinite(Number(value.chat_pts)) ? Number(value.chat_pts) : null,
            request_id: typeof value.request_id === 'string' ? value.request_id : null,
        };
    }
    return null;
}

function attachEnvelopeMeta(payload, envelope) {
    if (!isObjectPayload(payload) || !envelope) return payload;
    try {
        Object.defineProperty(payload, '__sun_envelope', {
            value: envelope,
            configurable: true,
            enumerable: false,
            writable: false,
        });
    } catch (_err) {
        payload.__sun_envelope = envelope;
    }
    return payload;
}

function unwrapSocketPayload(rawPayload) {
    const envelope = extractEnvelope(rawPayload);
    if (!envelope) {
        return { payload: rawPayload, envelope: null };
    }
    if (isObjectPayload(rawPayload) && isObjectPayload(rawPayload.payload)) {
        return {
            payload: attachEnvelopeMeta({ ...rawPayload.payload }, envelope),
            envelope,
        };
    }
    if (isObjectPayload(rawPayload)) {
        const nextPayload = { ...rawPayload };
        delete nextPayload.envelope;
        delete nextPayload.payload;
        delete nextPayload.event_id;
        delete nextPayload.event_type;
        delete nextPayload.server_ts;
        delete nextPayload.chat_pts;
        delete nextPayload.v;
        return {
            payload: attachEnvelopeMeta(nextPayload, envelope),
            envelope,
        };
    }
    return { payload: rawPayload, envelope };
}

function patchSocketListeners(socket) {
    if (!socket || socket.__sun_listener_patch_applied) return socket;
    const originalOn = typeof socket.on === 'function' ? socket.on.bind(socket) : null;
    if (!originalOn) return socket;
    const seenEventIds = new Map();

    socket.on = function patchedOn(eventName, handler) {
        if (typeof handler !== 'function') {
            return originalOn(eventName, handler);
        }
        const wrappedHandler = (...args) => {
            const rawPayload = args.length > 0 ? args[0] : undefined;
            const remaining = args.length > 1 ? args.slice(1) : [];
            const { payload, envelope } = unwrapSocketPayload(rawPayload);
            const eventId = envelope && typeof envelope.event_id === 'string'
                ? envelope.event_id
                : '';
            if (eventId) {
                if (seenEventIds.has(eventId)) {
                    return;
                }
                seenEventIds.set(eventId, Date.now());
                if (seenEventIds.size > SOCKET_EVENT_DEDUPE_LIMIT) {
                    const oldest = seenEventIds.keys().next().value;
                    if (oldest) {
                        seenEventIds.delete(oldest);
                    }
                }
            }
            handler(payload, ...remaining);
        };
        return originalOn(eventName, wrappedHandler);
    };

    Object.defineProperty(socket, '__sun_listener_patch_applied', {
        value: true,
        configurable: false,
        enumerable: false,
        writable: false,
    });
    return socket;
}

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

    const socket = io({
        path: socketPath,
        transports: transports.length > 0 ? transports : ['polling', 'websocket'],
        upgrade: socketClientConfig.upgrade !== false,
        withCredentials: true,
        reconnection: true,
        timeout: 10000,
        auth: (cb) => cb({ csrf_token: getCsrfToken() }),
    });
    return patchSocketListeners(socket);
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
