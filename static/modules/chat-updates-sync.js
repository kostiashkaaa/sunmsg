import { withAppRoot } from './app-url.js';

const DEFAULT_DIFFERENCE_LIMIT = 200;
const MAX_DIFFERENCE_LIMIT = 500;
const MAX_DIFFERENCE_STEPS = 32;
const DIFFERENCE_RETRY_ATTEMPTS = 5;
const DIFFERENCE_RETRY_BASE_DELAY_MS = 180;
const DIFFERENCE_RETRY_MAX_DELAY_MS = 2200;
const RETRIABLE_DIFFERENCE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

function normalizeChatId(value) {
    const normalized = String(value || '').trim();
    return normalized || '';
}

function normalizePositiveInteger(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const normalized = Math.floor(numeric);
    return normalized > 0 ? normalized : null;
}

function resolveEventType(payload) {
    const topLevelType = String(payload?.event_type || '').trim();
    if (topLevelType) return topLevelType;
    const envelopeType = String(payload?.envelope?.event_type || '').trim();
    if (envelopeType) return envelopeType;
    return '';
}

function resolveEventPts(payload) {
    const topLevelPts = normalizePositiveInteger(payload?.chat_pts);
    if (topLevelPts) return topLevelPts;
    return normalizePositiveInteger(payload?.envelope?.chat_pts);
}

function safeWarn(logger, message, context = null) {
    if (!logger || typeof logger.warn !== 'function') return;
    try {
        if (context && typeof context === 'object') {
            logger.warn(message, context);
            return;
        }
        logger.warn(message);
    } catch (_) {}
}

function sleep(ms) {
    const timeoutMs = Math.max(0, Number(ms) || 0);
    return new Promise((resolve) => {
        if (typeof setTimeout === 'function') {
            setTimeout(resolve, timeoutMs);
            return;
        }
        resolve();
    });
}

function isRetriableDifferenceStatus(status) {
    const normalizedStatus = Number(status) || 0;
    return RETRIABLE_DIFFERENCE_HTTP_STATUSES.has(normalizedStatus);
}

function computeDifferenceBackoffMs(attempt) {
    const safeAttempt = Math.max(0, Number(attempt) || 0);
    const exponential = DIFFERENCE_RETRY_BASE_DELAY_MS * (2 ** safeAttempt);
    const jitter = Math.floor(Math.random() * 100);
    return Math.min(DIFFERENCE_RETRY_MAX_DELAY_MS, exponential + jitter);
}

export function createChatUpdatesSyncController({
    socket,
    fetchImpl = null,
    resolveAppUrl = withAppRoot,
    differenceLimit = DEFAULT_DIFFERENCE_LIMIT,
    logger = console,
} = {}) {
    const fetcher = typeof fetchImpl === 'function'
        ? fetchImpl
        : (typeof fetch === 'function' ? fetch.bind(window) : null);
    const normalizeUrl = typeof resolveAppUrl === 'function' ? resolveAppUrl : withAppRoot;
    const safeLimit = Math.max(
        1,
        Math.min(MAX_DIFFERENCE_LIMIT, Number(differenceLimit) || DEFAULT_DIFFERENCE_LIMIT),
    );
    const stateSyncPending = new Map();

    function canUseGapSync() {
        return Boolean(
            socket
            && typeof socket.__sun_setGapSyncHandler === 'function'
            && typeof socket.__sun_dispatchInbound === 'function'
            && typeof socket.__sun_getChatPts === 'function'
            && typeof socket.__sun_setChatPts === 'function'
            && fetcher,
        );
    }

    async function requestUpdateState(chatId) {
        const normalizedChatId = normalizeChatId(chatId);
        if (!normalizedChatId || !fetcher) return null;

        const params = new URLSearchParams({ chat_id: normalizedChatId });
        const response = await fetcher(
            normalizeUrl(`/api/updates/state?${params}`),
            { credentials: 'same-origin' },
        );
        if (!response.ok) {
            throw new Error(`state_http_${response.status}`);
        }
        const payload = await response.json();
        if (!payload?.success) {
            throw new Error('state_payload_invalid');
        }
        return payload;
    }

    async function requestUpdateDifference(chatId, fromPts) {
        const normalizedChatId = normalizeChatId(chatId);
        if (!normalizedChatId || !fetcher) {
            return null;
        }

        const params = new URLSearchParams({
            chat_id: normalizedChatId,
            from_pts: String(Math.max(0, Number(fromPts) || 0)),
            limit: String(safeLimit),
        });
        let lastError = null;
        for (let attempt = 0; attempt < DIFFERENCE_RETRY_ATTEMPTS; attempt += 1) {
            try {
                const response = await fetcher(
                    normalizeUrl(`/api/updates/difference?${params}`),
                    { credentials: 'same-origin' },
                );
                if (!response.ok) {
                    const httpError = new Error(`difference_http_${response.status}`);
                    httpError.status = Number(response.status) || 0;
                    throw httpError;
                }

                const payload = await response.json();
                if (!payload?.success) {
                    throw new Error('difference_payload_invalid');
                }
                return payload;
            } catch (error) {
                lastError = error;
                const status = Number(error?.status) || 0;
                const message = String(error?.message || '');
                const retriableNetworkError = (
                    error?.name === 'TypeError'
                    || /failed to fetch|networkerror|load failed/i.test(message)
                );
                const retriable = retriableNetworkError || isRetriableDifferenceStatus(status);
                const hasAttemptsLeft = attempt < (DIFFERENCE_RETRY_ATTEMPTS - 1);
                if (!retriable || !hasAttemptsLeft) {
                    throw error;
                }
                await sleep(computeDifferenceBackoffMs(attempt));
            }
        }
        throw lastError || new Error('difference_retry_exhausted');
    }

    function dispatchDifferenceEvents(diffPayload) {
        if (!socket || typeof socket.__sun_dispatchInbound !== 'function') return 0;
        const events = Array.isArray(diffPayload?.events) ? diffPayload.events : [];
        let dispatchedCount = 0;
        events.forEach((eventPayload) => {
            const eventType = resolveEventType(eventPayload);
            if (!eventType) return;
            socket.__sun_dispatchInbound(eventType, eventPayload, { __sunReplay: true });
            dispatchedCount += 1;
        });
        return dispatchedCount;
    }

    function extractNextCursor(diffPayload, fallbackPts) {
        const explicitNext = normalizePositiveInteger(diffPayload?.next_from_pts);
        if (explicitNext) return explicitNext;

        const events = Array.isArray(diffPayload?.events) ? diffPayload.events : [];
        let maxPts = normalizePositiveInteger(fallbackPts) || 0;
        events.forEach((eventPayload) => {
            const pts = resolveEventPts(eventPayload);
            if (pts && pts > maxPts) {
                maxPts = pts;
            }
        });
        return maxPts > 0 ? maxPts : (normalizePositiveInteger(fallbackPts) || 0);
    }

    async function recoverGap({ chatId, fromPts, targetPts }) {
        if (!canUseGapSync()) return false;
        const normalizedChatId = normalizeChatId(chatId);
        if (!normalizedChatId) return false;

        let cursor = Math.max(0, Number(fromPts) || 0);
        const normalizedTargetPts = normalizePositiveInteger(targetPts);
        for (let step = 0; step < MAX_DIFFERENCE_STEPS; step += 1) {
            const diffPayload = await requestUpdateDifference(normalizedChatId, cursor);
            if (!diffPayload) return false;

            dispatchDifferenceEvents(diffPayload);
            const nextCursor = extractNextCursor(diffPayload, cursor);
            const hasMore = Boolean(diffPayload?.has_more);
            if (nextCursor > cursor) {
                cursor = nextCursor;
                socket.__sun_setChatPts(normalizedChatId, cursor);
            } else if (hasMore) {
                safeWarn(logger, 'Realtime difference cursor did not advance.', {
                    chatId: normalizedChatId,
                    cursor,
                    nextCursor,
                    hasMore,
                });
                return false;
            }

            if (normalizedTargetPts && cursor >= normalizedTargetPts) {
                return true;
            }

            if (!hasMore) {
                if (!normalizedTargetPts || cursor >= normalizedTargetPts) {
                    return true;
                }
                safeWarn(logger, 'Realtime difference did not reach target pts.', {
                    chatId: normalizedChatId,
                    cursor,
                    targetPts: normalizedTargetPts,
                });
                return false;
            }
        }

        safeWarn(logger, 'Realtime difference recovery reached max steps.', {
            chatId: normalizedChatId,
            fromPts,
            targetPts,
        });
        return false;
    }

    async function primeChatState(chatId) {
        if (!canUseGapSync()) return null;
        const normalizedChatId = normalizeChatId(chatId);
        if (!normalizedChatId) return null;

        const inFlight = stateSyncPending.get(normalizedChatId);
        if (inFlight) return inFlight;

        const syncTask = requestUpdateState(normalizedChatId)
            .then((payload) => {
                const chatPts = normalizePositiveInteger(payload?.chat_pts);
                if (chatPts) {
                    socket.__sun_setChatPts(normalizedChatId, chatPts);
                    return chatPts;
                }
                return null;
            })
            .catch((error) => {
                safeWarn(logger, 'Realtime state prime failed.', {
                    chatId: normalizedChatId,
                    error: String(error?.message || error || 'unknown'),
                });
                return null;
            })
            .finally(() => {
                if (stateSyncPending.get(normalizedChatId) === syncTask) {
                    stateSyncPending.delete(normalizedChatId);
                }
            });

        stateSyncPending.set(normalizedChatId, syncTask);
        return syncTask;
    }

    async function syncOnReconnect(chatId) {
        if (!canUseGapSync()) return false;
        const normalizedChatId = normalizeChatId(chatId);
        if (!normalizedChatId) return false;

        const localPts = socket.__sun_getChatPts(normalizedChatId);
        let serverPts = null;
        try {
            const payload = await requestUpdateState(normalizedChatId);
            serverPts = normalizePositiveInteger(payload?.chat_pts);
        } catch (_) {
            return false;
        }

        if (!serverPts) return false;

        if (!localPts || localPts <= 0) {
            socket.__sun_setChatPts(normalizedChatId, serverPts);
            return true;
        }

        if (serverPts <= localPts) return true;

        return recoverGap({ chatId: normalizedChatId, fromPts: localPts, targetPts: serverPts });
    }

    function bind() {
        if (!canUseGapSync()) return false;
        socket.__sun_setGapSyncHandler(recoverGap);
        return true;
    }

    return {
        bind,
        primeChatState,
        syncOnReconnect,
    };
}
