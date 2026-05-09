import * as ChatIdb from './chat-idb.js';
import {
    clearAllCachedMedia,
    deleteCachedMediaEntry,
    openMediaCacheDb,
    readAllCachedMediaEntries,
} from './chat-media-cache-db.js';
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

async function ensureMediaDbReady(userId) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId) return false;
    const db = await openMediaCacheDb(normalizedUserId);
    return Boolean(db);
}

function resolveCacheCategory(category) {
    const normalized = String(category || '').trim().toLowerCase();
    if (normalized === CACHE_CATEGORY_PHOTOS) return CACHE_CATEGORY_PHOTOS;
    if (normalized === CACHE_CATEGORY_VIDEOS) return CACHE_CATEGORY_VIDEOS;
    if (normalized === CACHE_CATEGORY_STICKERS) return CACHE_CATEGORY_STICKERS;
    return CACHE_CATEGORY_OTHER;
}

function buildMediaCacheBreakdown(entries) {
    const categories = {
        [CACHE_CATEGORY_PHOTOS]: 0,
        [CACHE_CATEGORY_VIDEOS]: 0,
        [CACHE_CATEGORY_STICKERS]: 0,
        [CACHE_CATEGORY_OTHER]: 0,
    };
    const safeEntries = Array.isArray(entries) ? entries : [];
    let totalBytes = 0;
    let entryCount = 0;
    for (const entry of safeEntries) {
        const cacheKey = String(entry?.cacheKey || '').trim();
        if (!cacheKey) continue;
        const size = Math.max(0, Number(entry?.size) || Number(entry?.blob?.size) || 0);
        const category = resolveCacheCategory(entry?.category);
        categories[category] += size;
        totalBytes += size;
        entryCount += 1;
    }
    return {
        totalBytes,
        entryCount,
        categories,
    };
}

function mergeCategoryBreakdown(...categoryMaps) {
    const result = {
        [CACHE_CATEGORY_PHOTOS]: 0,
        [CACHE_CATEGORY_VIDEOS]: 0,
        [CACHE_CATEGORY_STICKERS]: 0,
        [CACHE_CATEGORY_OTHER]: 0,
    };
    categoryMaps.forEach((categories) => {
        if (!categories || typeof categories !== 'object') return;
        result[CACHE_CATEGORY_PHOTOS] += Math.max(0, Number(categories[CACHE_CATEGORY_PHOTOS]) || 0);
        result[CACHE_CATEGORY_VIDEOS] += Math.max(0, Number(categories[CACHE_CATEGORY_VIDEOS]) || 0);
        result[CACHE_CATEGORY_STICKERS] += Math.max(0, Number(categories[CACHE_CATEGORY_STICKERS]) || 0);
        result[CACHE_CATEGORY_OTHER] += Math.max(0, Number(categories[CACHE_CATEGORY_OTHER]) || 0);
    });
    return result;
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

async function listCachedMediaEntries(userId) {
    const ready = await ensureMediaDbReady(userId);
    if (!ready) return [];
    return readAllCachedMediaEntries();
}

function parseMediaUpdatedAt(entry) {
    const updatedAt = Number(entry?.updatedAt);
    if (Number.isFinite(updatedAt) && updatedAt > 0) return updatedAt;
    const accessedAt = Number(entry?.accessedAt);
    if (Number.isFinite(accessedAt) && accessedAt > 0) return accessedAt;
    const createdAt = Number(entry?.createdAt);
    if (Number.isFinite(createdAt) && createdAt > 0) return createdAt;
    return 0;
}

function estimateChatRowBytes(row) {
    return buildChatCacheBreakdown([row]).totalBytes;
}

async function removeMediaEntriesByKey(keys) {
    const list = Array.from(
        new Set((Array.isArray(keys) ? keys : []).map((key) => String(key || '').trim()).filter(Boolean))
    );
    if (!list.length) return 0;
    await Promise.all(list.map((key) => deleteCachedMediaEntry(key).catch(() => false)));
    return list.length;
}

export async function computeDataMemorySnapshot({ userId } = {}) {
    const [rows, mediaEntries, streamCacheBytes] = await Promise.all([
        listCachedRows(userId),
        listCachedMediaEntries(userId),
        estimatePrefixedCacheStorageBytes(),
    ]);
    const chatCache = buildChatCacheBreakdown(rows);
    const mediaCache = buildMediaCacheBreakdown(mediaEntries);
    const filesCache = {
        totalBytes: chatCache.totalBytes + mediaCache.totalBytes,
        categories: mergeCategoryBreakdown(chatCache.categories, mediaCache.categories),
    };
    return {
        rows,
        mediaEntries,
        chatCache,
        mediaCache,
        filesCache,
        streamCacheBytes,
        totalManagedBytes: filesCache.totalBytes + streamCacheBytes,
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
    const mediaEntries = await listCachedMediaEntries(userId);
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
    const ageExpiredMediaKeys = cutoffMs > 0
        ? mediaEntries
            .filter((entry) => {
                const updatedAt = parseMediaUpdatedAt(entry);
                return updatedAt > 0 && updatedAt < cutoffMs;
            })
            .map((entry) => entry.cacheKey || entry.sourceUrl)
        : [];
    const deletedMediaByAge = await removeMediaEntriesByKey(ageExpiredMediaKeys);

    let rowCandidates = await listCachedRows(userId);
    let mediaCandidates = await listCachedMediaEntries(userId);
    let deletedChatsByLimit = 0;
    let deletedMediaByLimit = 0;
    const maxBytes = prefs.maxCacheMb > 0 ? prefs.maxCacheMb * 1024 * 1024 : 0;
    if (maxBytes > 0 && (rowCandidates.length || mediaCandidates.length)) {
        const chatCandidates = rowCandidates.map((row) => ({
            type: 'chat',
            key: String(row?.chat_id || '').trim(),
            updatedAt: parseRowUpdatedAt(row),
            bytes: estimateChatRowBytes(row),
        })).filter((item) => item.key && item.bytes > 0);
        const mediaLimitCandidates = mediaCandidates.map((entry) => ({
            type: 'media',
            key: String(entry?.cacheKey || entry?.sourceUrl || '').trim(),
            updatedAt: parseMediaUpdatedAt(entry),
            bytes: Math.max(0, Number(entry?.size) || Number(entry?.blob?.size) || 0),
        })).filter((item) => item.key && item.bytes > 0);
        const allCandidates = [...chatCandidates, ...mediaLimitCandidates]
            .sort((a, b) => a.updatedAt - b.updatedAt);

        let totalBytes = allCandidates.reduce((sum, item) => sum + item.bytes, 0);
        if (totalBytes > maxBytes) {
            const chatIdsToDelete = [];
            const mediaKeysToDelete = [];
            for (const item of allCandidates) {
                if (totalBytes <= maxBytes) break;
                if (item.type === 'chat') {
                    chatIdsToDelete.push(item.key);
                } else if (item.type === 'media') {
                    mediaKeysToDelete.push(item.key);
                }
                totalBytes = Math.max(0, totalBytes - item.bytes);
            }
            deletedChatsByLimit = await removeChatsById(chatIdsToDelete);
            deletedMediaByLimit = await removeMediaEntriesByKey(mediaKeysToDelete);
        }
        rowCandidates = await listCachedRows(userId);
        mediaCandidates = await listCachedMediaEntries(userId);
    }

    return {
        deletedChatsByAge,
        deletedMediaByAge,
        deletedChatsByLimit,
        deletedMediaByLimit,
        remainingRows: rowCandidates.length,
        remainingMediaEntries: mediaCandidates.length,
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

    const mediaEntries = await listCachedMediaEntries(userId);
    const mediaKeysToDelete = mediaEntries
        .filter((entry) => resolveCacheCategory(entry?.category) === targetCategory)
        .map((entry) => entry.cacheKey || entry.sourceUrl);
    const deletedMediaEntries = await removeMediaEntriesByKey(mediaKeysToDelete);

    return { affectedChats, deletedMediaEntries };
}

export async function clearAllManagedCache({ userId } = {}) {
    const ready = await ensureChatDbReady(userId);
    if (ready) {
        await ChatIdb.clearAllCache().catch(() => {});
    }
    const mediaReady = await ensureMediaDbReady(userId);
    if (mediaReady) {
        await clearAllCachedMedia().catch(() => {});
    }
    await clearPrefixedCacheStorage();
}

export async function clearChatCacheOnly({ userId } = {}) {
    const ready = await ensureChatDbReady(userId);
    if (ready) {
        await ChatIdb.clearAllCache().catch(() => {});
    }
    const mediaReady = await ensureMediaDbReady(userId);
    if (mediaReady) {
        await clearAllCachedMedia().catch(() => {});
    }
}

export async function clearStreamFragmentCacheOnly() {
    await clearPrefixedCacheStorage();
}
