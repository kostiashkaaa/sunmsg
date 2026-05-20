import {
    closeMediaCacheDb,
    normalizeMediaCacheKey,
    openMediaCacheDb,
    readCachedMediaEntry,
    touchCachedMediaEntry,
    writeCachedMediaEntry,
} from './chat-media-cache-db.js';
import {
    decryptChatMediaBlob,
    parseEncryptedMediaUrl,
} from './chat-media-e2ee.js';

function resolveCategoryByKind(kind) {
    const normalizedKind = String(kind || '').trim().toLowerCase();
    if (normalizedKind === 'image' || normalizedKind === 'photo') return 'photos';
    if (normalizedKind === 'video') return 'videos';
    if (normalizedKind === 'sticker' || normalizedKind === 'emoji') return 'stickers';
    return 'other';
}

function resolveCategoryByMime(mimeType, fallbackKind = 'other') {
    const mime = String(mimeType || '').trim().toLowerCase();
    if (mime.startsWith('image/')) return resolveCategoryByKind(fallbackKind === 'other' ? 'image' : fallbackKind);
    if (mime.startsWith('video/')) return resolveCategoryByKind('video');
    return resolveCategoryByKind(fallbackKind);
}

function normalizeFetchImpl(fetchImpl) {
    if (typeof fetchImpl === 'function') return fetchImpl;
    if (typeof window !== 'undefined' && typeof window.fetch === 'function') {
        return window.fetch.bind(window);
    }
    return null;
}

export function createChatMediaCacheRuntime({
    currentUserId = '',
    fetchImpl = null,
} = {}) {
    const normalizedUserId = String(currentUserId || '').trim();
    const resolvedFetch = normalizeFetchImpl(fetchImpl);
    const objectUrlByKey = new Map();
    const transientObjectUrls = new Set();
    const inFlightByKey = new Map();
    let ready = false;

    function isReady() {
        return ready;
    }

    async function init() {
        if (!normalizedUserId) return false;
        const db = await openMediaCacheDb(normalizedUserId);
        ready = Boolean(db);
        return ready;
    }

    function getOrCreateObjectUrl(cacheKey, blob) {
        if (objectUrlByKey.has(cacheKey)) return objectUrlByKey.get(cacheKey);
        const url = URL.createObjectURL(blob);
        objectUrlByKey.set(cacheKey, url);
        return url;
    }

    function createTransientObjectUrl(blob) {
        const url = URL.createObjectURL(blob);
        transientObjectUrls.add(url);
        return url;
    }

    function releaseObjectUrls() {
        for (const objectUrl of objectUrlByKey.values()) {
            try {
                URL.revokeObjectURL(objectUrl);
            } catch (_) {}
        }
        objectUrlByKey.clear();
        for (const objectUrl of transientObjectUrls.values()) {
            try {
                URL.revokeObjectURL(objectUrl);
            } catch (_) {}
        }
        transientObjectUrls.clear();
    }

    async function resolveMediaSource(sourceUrl, { kind = 'other' } = {}) {
        const encryptedMedia = parseEncryptedMediaUrl(sourceUrl);
        const cacheKey = normalizeMediaCacheKey(sourceUrl);
        if (!cacheKey || !ready) {
            if (encryptedMedia && resolvedFetch) {
                try {
                    const response = await resolvedFetch(encryptedMedia.fetchUrl, {
                        method: 'GET',
                        credentials: 'include',
                        cache: 'default',
                    });
                    if (!response?.ok) return '';
                    const blob = await decryptChatMediaBlob(await response.blob(), encryptedMedia.metadata);
                    return createTransientObjectUrl(blob);
                } catch (_) {
                    return '';
                }
            }
            return String(sourceUrl || '').trim();
        }

        const cached = await readCachedMediaEntry(cacheKey);
        if (cached?.blob instanceof Blob) {
            touchCachedMediaEntry(cacheKey).catch(() => {});
            return getOrCreateObjectUrl(cacheKey, cached.blob);
        }

        if (encryptedMedia) {
            const stored = await rememberFromNetwork(sourceUrl, { kind });
            if (stored) {
                const nextCached = await readCachedMediaEntry(cacheKey);
                if (nextCached?.blob instanceof Blob) {
                    return getOrCreateObjectUrl(cacheKey, nextCached.blob);
                }
            }
            return '';
        }

        rememberFromNetwork(sourceUrl, { kind }).catch(() => {});
        return String(sourceUrl || '').trim();
    }

    async function rememberFromNetwork(sourceUrl, { kind = 'other' } = {}) {
        const encryptedMedia = parseEncryptedMediaUrl(sourceUrl);
        const networkSourceUrl = encryptedMedia?.fetchUrl || sourceUrl;
        const cacheKey = normalizeMediaCacheKey(sourceUrl);
        if (!cacheKey || !ready || !resolvedFetch) return false;

        if (inFlightByKey.has(cacheKey)) return inFlightByKey.get(cacheKey);

        const requestPromise = (async () => {
            try {
                const response = await resolvedFetch(networkSourceUrl, {
                    method: 'GET',
                    credentials: 'include',
                    cache: 'default',
                });
                if (!response?.ok) return false;
                const responseBlob = await response.blob();
                const blob = encryptedMedia
                    ? await decryptChatMediaBlob(responseBlob, encryptedMedia.metadata)
                    : responseBlob;
                if (!(blob instanceof Blob) || Number(blob.size) <= 0) return false;
                const mimeType = String(encryptedMedia?.metadata?.mime || response.headers?.get('content-type') || blob.type || '').trim();
                const category = resolveCategoryByMime(mimeType, kind);
                const stored = await writeCachedMediaEntry({
                    sourceUrl,
                    blob,
                    mimeType,
                    category,
                });
                if (stored) {
                    try {
                        window.__sunScheduleDataMemoryPolicy?.(300);
                    } catch (_) {}
                }
                return stored;
            } catch (_) {
                return false;
            } finally {
                inFlightByKey.delete(cacheKey);
            }
        })();

        inFlightByKey.set(cacheKey, requestPromise);
        return requestPromise;
    }

    async function rememberFromElement(mediaEl) {
        if (!mediaEl || typeof mediaEl.getAttribute !== 'function') return false;
        const explicitOriginal = String(mediaEl.getAttribute('data-src') || '').trim();
        const currentSrc = String(mediaEl.getAttribute('src') || mediaEl.currentSrc || '').trim();
        const sourceUrl = explicitOriginal || currentSrc;
        if (!sourceUrl || sourceUrl.startsWith('blob:') || sourceUrl.startsWith('data:')) return false;
        const kind = mediaEl.classList.contains('file-msg-img')
            ? 'image'
            : mediaEl.classList.contains('file-msg-video-preview')
                ? 'video'
                : mediaEl.classList.contains('file-msg-audio-el')
                    ? 'audio'
                    : 'other';
        return rememberFromNetwork(sourceUrl, { kind });
    }

    async function close() {
        inFlightByKey.clear();
        releaseObjectUrls();
        await closeMediaCacheDb();
        ready = false;
    }

    return {
        init,
        isReady,
        close,
        resolveMediaSource,
        rememberFromElement,
        rememberFromNetwork,
    };
}

