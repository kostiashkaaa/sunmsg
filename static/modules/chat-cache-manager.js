import * as ChatIdb from './chat-idb.js';
import {
    CACHE_CATEGORY_OTHER,
    CACHE_CATEGORY_PHOTOS,
    CACHE_CATEGORY_STICKERS,
    CACHE_CATEGORY_VIDEOS,
    buildChatCacheBreakdown,
    classifyCachedMessage,
    normalizeDataMemoryStore,
    readDataMemoryStore,
} from './chat-cache-policy.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const STREAM_CACHE_PREFIXES = ['sun-stream-cache-', 'sun-video-fragments-'];

function normalizeUserId(userId) {
    return String(userId || '').trim();
}

async function ensureChatDbReady(userId) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) return false;
    const db = await ChatIdb.openChatDb(normalizedUserId);
    return Boolean(db);
}

async function estimateResponseBytes(response) {
    if (!response) return 0;
    const contentLength = Number(response.headers?.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > 0) return contentLength;
    try {
        const blob = await response.clone().blob();
        return Number(blob.size) || 0;
    } catch (_) {
        return 0;
    }
}

export async function estimatePrefixedCacheStorageBytes(prefixes = STREAM_CACHE_PREFIXES) {
    if (!('caches' in window)) return 0;
    const list = Array.isArray(prefixes) ? prefixes : [];
    let totalBytes = 0;
    try {
        const cacheNames = await caches.keys();
        const targetNames = cacheNames.filter((name) => list.some((prefix) => String(name).startsWith(prefix)));
        for (const cacheName of targetNames) {
            const cache = await caches.open(cacheName);
            const requests = await cache.keys();
            for (const request of requests) {
                const response = await cache.match(request);
                totalBytes += await estimateResponseBytes(response);
            }
        }
    } catch (_) {}
    return totalBytes;
}

export async function clearPrefixedCacheStorage(prefixes = STREAM_CACHE_PREFIXES) {
    if (!('caches' in window)) return 0;
    const list = Array.isArray(prefixes) ? prefixes : [];
    let deleted = 0;
    try {
        const names = await caches.keys();
        for (const name of names) {
            if (!list.some((prefix) => String(name).startsWith(prefix))) continue;
            const ok = await caches.delete(name);
            if (ok) deleted += 1;
        }
    } catch (_) {}
    return deleted;
}

function parseRowUpdatedAt(row) {
    const updatedAt = Number(row?.updatedAt);
    if (Number.isFinite(updatedAt) && updatedAt > 0) return updatedAt;
    return 0;
}

async function listCachedRows(userId) {
    const ready = await ensureChatDbReady(userId);
    if (!ready) return [];
    return ChatIdb.readAllCachedChats();
}

export async function computeDataMemorySnapshot({ userId } = {}) {
    const rows = await listCachedRows(userId);
    const chatCache = buildChatCacheBreakdown(rows);
    const streamCacheBytes = await estimatePrefixedCacheStorageBytes();
    return {
        rows,
        chatCache,
        streamCacheBytes,
        totalManagedBytes: chatCache.totalBytes + streamCacheBytes,
    };
}

async function removeChatsById(chatIds) {
    const ids = Array.from(new Set((Array.isArray(chatIds) ? chatIds : []).map((id) => String(id || '').trim())))
        .filter(Boolean);
    if (!ids.length) return 0;
    await Promise.all(ids.map((chatId) => ChatIdb.deleteCachedChat(chatId).catch(() => {})));
    return ids.length;
}

export async function applyDataMemoryPolicy({
    userId,
    preferences,
} = {}) {
    const prefs = normalizeDataMemoryStore(preferences || readDataMemoryStore());
    const rows = await listCachedRows(userId);
    if (!rows.length) {
        return {
            deletedChatsByAge: 0,
            deletedChatsByLimit: 0,
            remainingRows: 0,
        };
    }

    const nowMs = Date.now();
    const cutoffMs = prefs.cacheRetentionDays > 0
        ? nowMs - (prefs.cacheRetentionDays * DAY_MS)
        : 0;

    const ageExpiredIds = cutoffMs > 0
        ? rows
            .filter((row) => {
                const updatedAt = parseRowUpdatedAt(row);
                return updatedAt > 0 && updatedAt < cutoffMs;
            })
            .map((row) => row.chat_id)
        : [];
    const deletedChatsByAge = await removeChatsById(ageExpiredIds);

    let sizeCandidates = await listCachedRows(userId);
    let deletedChatsByLimit = 0;
    const maxBytes = prefs.maxCacheMb > 0 ? prefs.maxCacheMb * 1024 * 1024 : 0;
    if (maxBytes > 0 && sizeCandidates.length) {
        let breakdown = buildChatCacheBreakdown(sizeCandidates);
        if (breakdown.totalBytes > maxBytes) {
            const sortedByAge = [...sizeCandidates].sort((a, b) => parseRowUpdatedAt(a) - parseRowUpdatedAt(b));
            const idsToDelete = [];
            for (const row of sortedByAge) {
                if (breakdown.totalBytes <= maxBytes) break;
                idsToDelete.push(row.chat_id);
                const rowBreakdown = buildChatCacheBreakdown([row]);
                breakdown.totalBytes = Math.max(0, breakdown.totalBytes - rowBreakdown.totalBytes);
            }
            deletedChatsByLimit = await removeChatsById(idsToDelete);
        }
        sizeCandidates = await listCachedRows(userId);
    }

    return {
        deletedChatsByAge,
        deletedChatsByLimit,
        remainingRows: sizeCandidates.length,
    };
}

function resolveRowsWithoutCategory(rows, category) {
    const safeRows = Array.isArray(rows) ? rows : [];
    const normalizedCategory = String(category || '').trim().toLowerCase();
    if (!normalizedCategory) return [];
    const result = [];
    for (const row of safeRows) {
        const messages = Array.isArray(row.messages) ? row.messages : [];
        const filtered = messages.filter((message) => classifyCachedMessage(message) !== normalizedCategory);
        result.push({
            chat_id: String(row.chat_id || '').trim(),
            updatedAt: row.updatedAt,
            firstId: row.firstId,
            lastId: row.lastId,
            originalMessages: messages,
            nextMessages: filtered,
        });
    }
    return result.filter((entry) => entry.chat_id && entry.nextMessages.length !== entry.originalMessages.length);
}

export async function clearCachedCategory({ userId, category } = {}) {
    const allowed = new Set([
        CACHE_CATEGORY_PHOTOS,
        CACHE_CATEGORY_VIDEOS,
        CACHE_CATEGORY_STICKERS,
        CACHE_CATEGORY_OTHER,
    ]);
    const targetCategory = String(category || '').trim().toLowerCase();
    if (!allowed.has(targetCategory)) return { affectedChats: 0 };

    const rows = await listCachedRows(userId);
    const nextRows = resolveRowsWithoutCategory(rows, targetCategory);
    let affectedChats = 0;

    for (const entry of nextRows) {
        affectedChats += 1;
        if (!entry.nextMessages.length) {
            await ChatIdb.deleteCachedChat(entry.chat_id).catch(() => {});
            continue;
        }
        const firstId = Number(entry.nextMessages[0]?.id) || 0;
        const lastId = Number(entry.nextMessages[entry.nextMessages.length - 1]?.id) || 0;
        await ChatIdb.writeCachedMessages(
            entry.chat_id,
            entry.nextMessages,
            { firstId, lastId },
        ).catch(() => {});
    }

    return { affectedChats };
}

export async function clearAllManagedCache({ userId } = {}) {
    const ready = await ensureChatDbReady(userId);
    if (ready) {
        await ChatIdb.clearAllCache().catch(() => {});
    }
    await clearPrefixedCacheStorage();
}

export async function clearChatCacheOnly({ userId } = {}) {
    const ready = await ensureChatDbReady(userId);
    if (!ready) return;
    await ChatIdb.clearAllCache().catch(() => {});
}

export async function clearStreamFragmentCacheOnly() {
    await clearPrefixedCacheStorage();
}
