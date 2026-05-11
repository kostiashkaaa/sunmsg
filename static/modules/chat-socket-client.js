import { getCsrfToken } from './csrf.js';
import { withAppRoot } from './app-url.js';

const IDEMPOTENT_SOCKET_EVENTS = new Set([
    'send_message',
    'edit_message',
    'delete_messages',
]);
const SOCKET_EVENT_DEDUPE_LIMIT = 2000;
const SOCKET_PTS_SYNC_QUEUE_LIMIT = 128;

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

function normalizePositivePts(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const normalized = Math.floor(numeric);
    return normalized > 0 ? normalized : null;
}

function patchSocketListeners(socket) {
    if (!socket || socket.__sun_listener_patch_applied) return socket;
    const originalOn = typeof socket.on === 'function' ? socket.on.bind(socket) : null;
    if (!originalOn) return socket;
    const originalOff = typeof socket.off === 'function' ? socket.off.bind(socket) : null;
    const seenEventIds = new Map();
    const chatPtsByChatId = new Map();
    const listenersByEvent = new Map();
    const handlerWrapMap = new WeakMap();
    const ptsSyncQueueByChatId = new Map();
    let gapSyncHandler = null;

    const markEventSeen = (eventId) => {
        if (!eventId) return;
        seenEventIds.set(eventId, Date.now());
        if (seenEventIds.size > SOCKET_EVENT_DEDUPE_LIMIT) {
            const oldest = seenEventIds.keys().next().value;
            if (oldest) {
                seenEventIds.delete(oldest);
            }
        }
    };

    const queueGapSync = (chatId, fromPts, targetPts) => {
        if (typeof gapSyncHandler !== 'function') {
            return Promise.resolve(true);
        }
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) {
            return Promise.resolve(true);
        }
        const prevTask = ptsSyncQueueByChatId.get(normalizedChatId) || Promise.resolve();
        const nextTask = Promise.resolve(prevTask)
            .catch(() => true)
            .then(async () => {
                try {
                    const result = await gapSyncHandler({
                        chatId: normalizedChatId,
                        fromPts,
                        targetPts,
                    });
                    return result !== false;
                } catch (_err) {
                    return false;
                }
            });

        ptsSyncQueueByChatId.set(normalizedChatId, nextTask);
        if (ptsSyncQueueByChatId.size > SOCKET_PTS_SYNC_QUEUE_LIMIT) {
            const oldestChatId = ptsSyncQueueByChatId.keys().next().value;
            if (oldestChatId && oldestChatId !== normalizedChatId) {
                ptsSyncQueueByChatId.delete(oldestChatId);
            }
        }
        return nextTask.finally(() => {
            if (ptsSyncQueueByChatId.get(normalizedChatId) === nextTask) {
                ptsSyncQueueByChatId.delete(normalizedChatId);
            }
        });
    };

    const dispatchInbound = (eventName, ...args) => {
        const normalizedEventName = String(eventName || '');
        if (!normalizedEventName) return;
        const listeners = listenersByEvent.get(normalizedEventName);
        if (!listeners || listeners.size === 0) return;
        listeners.forEach((listener) => {
            try {
                listener(...args);
            } catch (_err) {}
        });
    };

    socket.on = function patchedOn(eventName, handler) {
        if (typeof handler !== 'function') {
            return originalOn(eventName, handler);
        }
        const normalizedEventName = String(eventName || '');
        const wrappedHandler = (...args) => {
            const run = async () => {
                const rawPayload = args.length > 0 ? args[0] : undefined;
                const remaining = args.length > 1 ? args.slice(1) : [];
                const replayMeta = remaining[0];
                const isReplayEvent = Boolean(
                    replayMeta
                    && typeof replayMeta === 'object'
                    && replayMeta.__sunReplay === true,
                );
                const { payload, envelope } = unwrapSocketPayload(rawPayload);
                const eventId = envelope && typeof envelope.event_id === 'string'
                    ? envelope.event_id
                    : '';
                if (eventId && seenEventIds.has(eventId)) {
                    return;
                }

                const envelopeChatId = String(envelope?.chat_id || '').trim();
                const incomingPts = normalizePositivePts(envelope?.chat_pts);
                if (envelopeChatId && incomingPts) {
                    const knownPts = normalizePositivePts(chatPtsByChatId.get(envelopeChatId));
                    if (knownPts && incomingPts <= knownPts) {
                        markEventSeen(eventId);
                        return;
                    }
                    if (!isReplayEvent && knownPts && incomingPts > (knownPts + 1)) {
                        const gapRecovered = await queueGapSync(envelopeChatId, knownPts, incomingPts - 1);
                        if (!gapRecovered) {
                            return;
                        }
                    }

                    if (eventId && seenEventIds.has(eventId)) {
                        return;
                    }
                    const latestKnownPts = normalizePositivePts(chatPtsByChatId.get(envelopeChatId));
                    if (latestKnownPts && incomingPts <= latestKnownPts) {
                        markEventSeen(eventId);
                        return;
                    }
                    chatPtsByChatId.set(envelopeChatId, incomingPts);
                }

                markEventSeen(eventId);
                handler(payload, ...remaining);
            };

            const maybePromise = run();
            if (maybePromise && typeof maybePromise.catch === 'function') {
                maybePromise.catch(() => {});
            }
        };
        handlerWrapMap.set(handler, wrappedHandler);
        if (!listenersByEvent.has(normalizedEventName)) {
            listenersByEvent.set(normalizedEventName, new Set());
        }
        listenersByEvent.get(normalizedEventName).add(wrappedHandler);
        return originalOn(eventName, wrappedHandler);
    };

    if (originalOff) {
        socket.off = function patchedOff(eventName, handler) {
            const normalizedEventName = String(eventName || '');
            if (typeof handler !== 'function') {
                listenersByEvent.delete(normalizedEventName);
                return originalOff(eventName);
            }
            const wrapped = handlerWrapMap.get(handler) || handler;
            const listeners = listenersByEvent.get(normalizedEventName);
            if (listeners) {
                listeners.delete(wrapped);
                if (listeners.size === 0) {
                    listenersByEvent.delete(normalizedEventName);
                }
            }
            return originalOff(eventName, wrapped);
        };
    }

    socket.__sun_dispatchInbound = dispatchInbound;
    socket.__sun_setGapSyncHandler = (handler) => {
        gapSyncHandler = typeof handler === 'function' ? handler : null;
    };
    socket.__sun_getChatPts = (chatId) => {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return null;
        return normalizePositivePts(chatPtsByChatId.get(normalizedChatId));
    };
    socket.__sun_setChatPts = (chatId, chatPts) => {
        const normalizedChatId = String(chatId || '').trim();
        const normalizedPts = normalizePositivePts(chatPts);
        if (!normalizedChatId || !normalizedPts) return;
        const currentPts = normalizePositivePts(chatPtsByChatId.get(normalizedChatId));
        if (currentPts && currentPts > normalizedPts) return;
        chatPtsByChatId.set(normalizedChatId, normalizedPts);
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
        if (requireConnected) {
            const hasNetwork = (typeof navigator === 'undefined') ? true : navigator.onLine !== false;
            if (!socket.connected || !hasNetwork) return false;
        }

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
