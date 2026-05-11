import * as ChatIdb from './chat-idb.js';
import { createChatIdbRuntime } from './chat-idb-runtime.js';
import { applyDataMemoryPolicy } from './chat-cache-manager.js';
import { readDataMemoryStore } from './chat-cache-policy.js';
import { createChatMediaCacheRuntime } from './chat-media-cache-runtime.js';
import { createOutboxRuntime } from './chat-outbox.js';
import { mountOutboxPill } from './chat-outbox-ui.js';

export function createChatStorageRuntime({
    currentUserId,
    socket,
    emitSocket,
    onPendingMessageExpired,
    onPendingMessageDrained,
    windowRef = window,
    documentRef = document,
} = {}) {
    const chatIdbRuntime = createChatIdbRuntime({
        chatIdb: ChatIdb,
        currentUserId,
    });
    const isChatIdbReady = () => chatIdbRuntime.isReady();
    const ensureChatIdbReady = () => chatIdbRuntime.ensureReady();
    const appendEncryptedMessagesToCache = (chatId, messages) =>
        chatIdbRuntime.appendEncryptedMessages(chatId, messages);
    const syncDeletedMessagesToCache = (chatId, ids) => {
        chatIdbRuntime.syncDeletedMessages(chatId, ids);
    };
    const dropChatCache = (chatId) => {
        chatIdbRuntime.dropChatCache(chatId);
    };

    windowRef.clearChatHistoryCacheOnLogout = () => chatIdbRuntime.clearOnLogout();
    let cachePolicyTimerId = 0;
    let cachePolicyInFlight = false;
    let cachePolicyQueued = false;

    async function runDataMemoryPolicyNow() {
        if (cachePolicyInFlight) {
            cachePolicyQueued = true;
            return;
        }
        cachePolicyInFlight = true;
        try {
            await applyDataMemoryPolicy({
                userId: currentUserId,
                preferences: readDataMemoryStore(),
            });
        } catch (_) {
            // Ignore background policy errors.
        } finally {
            cachePolicyInFlight = false;
            if (cachePolicyQueued) {
                cachePolicyQueued = false;
                windowRef.setTimeout(() => {
                    runDataMemoryPolicyNow().catch(() => {});
                }, 120);
            }
        }
    }

    function scheduleDataMemoryPolicy(delayMs = 900) {
        if (cachePolicyTimerId) {
            windowRef.clearTimeout(cachePolicyTimerId);
        }
        cachePolicyTimerId = windowRef.setTimeout(() => {
            cachePolicyTimerId = 0;
            runDataMemoryPolicyNow().catch(() => {});
        }, Math.max(0, Number(delayMs) || 0));
    }

    function pruneCachedChatsWithPolicy(limit = 100) {
        const prunePromise = ChatIdb.pruneCachedChats(limit);
        prunePromise.catch(() => {});
        scheduleDataMemoryPolicy();
        return prunePromise;
    }
    windowRef.__sunScheduleDataMemoryPolicy = scheduleDataMemoryPolicy;

    const mediaCacheRuntime = createChatMediaCacheRuntime({
        currentUserId,
        fetchImpl: windowRef.authFetch || windowRef.fetch?.bind(windowRef),
    });
    mediaCacheRuntime.init().catch(() => {});
    windowRef.__sunMediaCacheResolveSource = (sourceUrl, options = {}) =>
        mediaCacheRuntime.resolveMediaSource(sourceUrl, options);
    windowRef.__sunMediaCacheRememberElement = (mediaEl) =>
        mediaCacheRuntime.rememberFromElement(mediaEl);

    chatIdbRuntime.init()
        .then((ready) => {
            if (ready) scheduleDataMemoryPolicy(60);
        })
        .catch(() => {});

    const outboxRuntime = createOutboxRuntime({
        currentUserId,
        onEntryExpired: (clientId) => {
            try { onPendingMessageExpired?.(clientId); } catch (_) {}
        },
        onEntryDrained: (clientId) => {
            try { onPendingMessageDrained?.(clientId); } catch (_) {}
        },
    });
    outboxRuntime.init();
    mountOutboxPill(outboxRuntime);
    const enqueueOutboxMessage = (entry) => outboxRuntime.enqueue(entry);
    const drainOutboxOnce = () => outboxRuntime.drainOnce(emitSocket);
    const removeOutboxByClientId = (clientId) => outboxRuntime.remove(clientId);
    socket.on('connect', () => { void drainOutboxOnce(); });
    windowRef.addEventListener('online', () => { void drainOutboxOnce(); });
    socket.on('message_sent', (data) => {
        const clientId = String(data?.client_id || '').trim();
        if (clientId) void removeOutboxByClientId(clientId);
    });
    documentRef.addEventListener('click', (event) => {
        const tick = event.target?.closest?.('.msg-tick.failed');
        if (!tick) return;
        const messageEl = tick.closest('.message.self');
        if (!messageEl) return;
        event.preventDefault();
        event.stopPropagation();
        void drainOutboxOnce();
    });

    const previousClearChatHistoryCacheOnLogout = windowRef.clearChatHistoryCacheOnLogout;
    windowRef.clearChatHistoryCacheOnLogout = async () => {
        if (cachePolicyTimerId) {
            windowRef.clearTimeout(cachePolicyTimerId);
            cachePolicyTimerId = 0;
        }
        try {
            delete windowRef.__sunMediaCacheResolveSource;
            delete windowRef.__sunMediaCacheRememberElement;
            delete windowRef.__sunScheduleDataMemoryPolicy;
            await mediaCacheRuntime.close();
        } catch (_) {}
        try { await previousClearChatHistoryCacheOnLogout?.(); } catch (_) {}
        try { await outboxRuntime.clearOnLogout(); } catch (_) {}
    };

    function disposeMediaCacheRuntime() {
        delete windowRef.__sunMediaCacheResolveSource;
        delete windowRef.__sunMediaCacheRememberElement;
        delete windowRef.__sunScheduleDataMemoryPolicy;
        mediaCacheRuntime.close().catch(() => {});
    }

    return {
        chatIdbRuntime,
        isChatIdbReady,
        ensureChatIdbReady,
        appendEncryptedMessagesToCache,
        syncDeletedMessagesToCache,
        dropChatCache,
        pruneCachedChatsWithPolicy,
        enqueueOutboxMessage,
        disposeMediaCacheRuntime,
    };
}
