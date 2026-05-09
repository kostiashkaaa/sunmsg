const DB_VERSION = 1;
const STORE_ENTRIES = 'entries';
const INDEX_UPDATED_AT = 'byUpdatedAt';
const INDEX_ACCESSED_AT = 'byAccessedAt';
const INDEX_CATEGORY = 'byCategory';

let activeDb = null;
let activeUserId = '';

function warn(message, error) {
    if (error) {
        console.warn(`[chat-media-cache-db] ${message}`, error);
        return;
    }
    console.warn(`[chat-media-cache-db] ${message}`);
}

function canUseIndexedDb() {
    return typeof indexedDB !== 'undefined';
}

function normalizeUserId(userId) {
    return String(userId || '').trim();
}

function safeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function safeString(value) {
    return String(value || '').trim();
}

function buildDbName(userId) {
    return `sunmessenger_media_cache_${normalizeUserId(userId)}`;
}

function openIndexedDb(dbName) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            let store = null;
            if (!db.objectStoreNames.contains(STORE_ENTRIES)) {
                store = db.createObjectStore(STORE_ENTRIES, { keyPath: 'cacheKey' });
            } else {
                store = request.transaction?.objectStore(STORE_ENTRIES) || null;
            }
            if (!store) return;
            if (!store.indexNames.contains(INDEX_UPDATED_AT)) {
                store.createIndex(INDEX_UPDATED_AT, 'updatedAt', { unique: false });
            }
            if (!store.indexNames.contains(INDEX_ACCESSED_AT)) {
                store.createIndex(INDEX_ACCESSED_AT, 'accessedAt', { unique: false });
            }
            if (!store.indexNames.contains(INDEX_CATEGORY)) {
                store.createIndex(INDEX_CATEGORY, 'category', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Failed to open media cache DB.'));
        request.onblocked = () => warn(`Open blocked for ${dbName}.`);
    });
}

export function normalizeMediaCacheKey(rawUrl) {
    const value = String(rawUrl || '').trim();
    if (!value) return '';
    try {
        const parsed = new URL(value, window.location.origin);
        if (parsed.origin !== window.location.origin) return '';
        if (!parsed.pathname.startsWith('/chat_media/')) return '';
        return `${parsed.pathname}${parsed.search}`;
    } catch (_) {
        return '';
    }
}

function normalizeStoredEntry(row) {
    if (!row || typeof row !== 'object') return null;
    const cacheKey = safeString(row.cacheKey);
    if (!cacheKey) return null;
    const blob = row.blob instanceof Blob ? row.blob : null;
    return {
        cacheKey,
        sourceUrl: safeString(row.sourceUrl),
        blob,
        mimeType: safeString(row.mimeType),
        size: Math.max(0, safeNumber(row.size, blob ? blob.size : 0)),
        category: safeString(row.category) || 'other',
        createdAt: Math.max(0, safeNumber(row.createdAt, 0)),
        updatedAt: Math.max(0, safeNumber(row.updatedAt, 0)),
        accessedAt: Math.max(0, safeNumber(row.accessedAt, 0)),
    };
}

export async function openMediaCacheDb(userId) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId || !canUseIndexedDb()) return null;

    if (activeDb && activeUserId === normalizedUserId) return activeDb;
    if (activeDb) await closeMediaCacheDb();

    try {
        const db = await openIndexedDb(buildDbName(normalizedUserId));
        activeDb = db;
        activeUserId = normalizedUserId;
        return db;
    } catch (error) {
        warn('openMediaCacheDb failed.', error);
        activeDb = null;
        activeUserId = '';
        return null;
    }
}

export async function closeMediaCacheDb() {
    if (!activeDb) return;
    try {
        activeDb.close();
    } catch (error) {
        warn('closeMediaCacheDb failed.', error);
    } finally {
        activeDb = null;
        activeUserId = '';
    }
}

export async function readCachedMediaEntry(rawUrl) {
    const cacheKey = normalizeMediaCacheKey(rawUrl);
    if (!activeDb || !cacheKey) return null;
    try {
        const row = await new Promise((resolve, reject) => {
            const tx = activeDb.transaction(STORE_ENTRIES, 'readonly');
            const request = tx.objectStore(STORE_ENTRIES).get(cacheKey);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error || new Error('Failed to read media cache entry.'));
            tx.onerror = () => reject(tx.error || new Error('Media cache read transaction failed.'));
        });
        return normalizeStoredEntry(row);
    } catch (error) {
        warn('readCachedMediaEntry failed.', error);
        return null;
    }
}

export async function writeCachedMediaEntry({
    sourceUrl,
    blob,
    category = 'other',
    mimeType = '',
} = {}) {
    const cacheKey = normalizeMediaCacheKey(sourceUrl);
    if (!activeDb || !cacheKey || !(blob instanceof Blob)) return false;

    const now = Date.now();
    const normalizedCategory = safeString(category) || 'other';
    const normalizedMime = safeString(mimeType) || safeString(blob.type);
    const size = Math.max(0, safeNumber(blob.size, 0));

    try {
        await new Promise((resolve, reject) => {
            const tx = activeDb.transaction(STORE_ENTRIES, 'readwrite');
            const store = tx.objectStore(STORE_ENTRIES);
            const getRequest = store.get(cacheKey);
            getRequest.onerror = () => reject(getRequest.error || new Error('Failed to read media cache row.'));
            getRequest.onsuccess = () => {
                const existing = normalizeStoredEntry(getRequest.result);
                store.put({
                    cacheKey,
                    sourceUrl: safeString(sourceUrl),
                    blob,
                    mimeType: normalizedMime,
                    size,
                    category: normalizedCategory,
                    createdAt: existing?.createdAt || now,
                    updatedAt: now,
                    accessedAt: now,
                });
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('Failed to write media cache entry.'));
            tx.onabort = () => reject(tx.error || new Error('Media cache write aborted.'));
        });
        return true;
    } catch (error) {
        warn('writeCachedMediaEntry failed.', error);
        return false;
    }
}

export async function touchCachedMediaEntry(rawUrl) {
    const cacheKey = normalizeMediaCacheKey(rawUrl);
    if (!activeDb || !cacheKey) return false;
    const now = Date.now();
    try {
        await new Promise((resolve, reject) => {
            const tx = activeDb.transaction(STORE_ENTRIES, 'readwrite');
            const store = tx.objectStore(STORE_ENTRIES);
            const getRequest = store.get(cacheKey);
            getRequest.onerror = () => reject(getRequest.error || new Error('Failed to read cache row for touch.'));
            getRequest.onsuccess = () => {
                const existing = normalizeStoredEntry(getRequest.result);
                if (!existing) return;
                store.put({
                    ...existing,
                    accessedAt: now,
                });
            };
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('Failed to touch media cache entry.'));
            tx.onabort = () => reject(tx.error || new Error('Media cache touch aborted.'));
        });
        return true;
    } catch (error) {
        warn('touchCachedMediaEntry failed.', error);
        return false;
    }
}

export async function deleteCachedMediaEntry(rawUrl) {
    const cacheKey = normalizeMediaCacheKey(rawUrl);
    if (!activeDb || !cacheKey) return false;
    try {
        await new Promise((resolve, reject) => {
            const tx = activeDb.transaction(STORE_ENTRIES, 'readwrite');
            tx.objectStore(STORE_ENTRIES).delete(cacheKey);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('Failed to delete media cache entry.'));
            tx.onabort = () => reject(tx.error || new Error('Media cache delete aborted.'));
        });
        return true;
    } catch (error) {
        warn('deleteCachedMediaEntry failed.', error);
        return false;
    }
}

export async function readAllCachedMediaEntries() {
    if (!activeDb) return [];
    try {
        const rows = await new Promise((resolve, reject) => {
            const tx = activeDb.transaction(STORE_ENTRIES, 'readonly');
            const request = tx.objectStore(STORE_ENTRIES).getAll();
            request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
            request.onerror = () => reject(request.error || new Error('Failed to read media cache entries.'));
            tx.onerror = () => reject(tx.error || new Error('Media cache read transaction failed.'));
        });
        return rows
            .map((row) => normalizeStoredEntry(row))
            .filter(Boolean);
    } catch (error) {
        warn('readAllCachedMediaEntries failed.', error);
        return [];
    }
}

export async function clearAllCachedMedia() {
    if (!activeDb) return false;
    try {
        await new Promise((resolve, reject) => {
            const tx = activeDb.transaction(STORE_ENTRIES, 'readwrite');
            tx.objectStore(STORE_ENTRIES).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('Failed to clear media cache.'));
            tx.onabort = () => reject(tx.error || new Error('Media cache clear aborted.'));
        });
        return true;
    } catch (error) {
        warn('clearAllCachedMedia failed.', error);
        return false;
    }
}

