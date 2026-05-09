import { parseSunFilePayload } from './utils.js';

export const DATA_MEMORY_PREFS_STORAGE_KEY = 'sun_data_memory_store_v1';

export const CACHE_CATEGORY_PHOTOS = 'photos';
export const CACHE_CATEGORY_VIDEOS = 'videos';
export const CACHE_CATEGORY_STICKERS = 'stickers';
export const CACHE_CATEGORY_OTHER = 'other';

const RETENTION_ALLOWED_DAYS = new Set([0, 1, 3, 7, 30, 90]);
const MIN_FILE_AUTODOWNLOAD_MB = 0.1;
const MAX_FILE_AUTODOWNLOAD_MB = 128;
const MIN_MAX_CACHE_MB = 32;
const MAX_MAX_CACHE_MB = 4096;

export const DEFAULT_DATA_MEMORY_STORE = Object.freeze({
    autoDownloadMedia: true,
    autoDownloadPhotos: true,
    autoDownloadVideos: true,
    autoDownloadFilesMaxMb: 3,
    cacheRetentionDays: 7,
    maxCacheMb: 0,
});

function toFiniteNumber(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function normalizeBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}

export function normalizeDataMemoryStore(rawValue) {
    const raw = rawValue && typeof rawValue === 'object' ? rawValue : {};

    const autoDownloadMedia = normalizeBoolean(
        raw.autoDownloadMedia,
        DEFAULT_DATA_MEMORY_STORE.autoDownloadMedia,
    );
    const autoDownloadPhotos = normalizeBoolean(
        raw.autoDownloadPhotos,
        DEFAULT_DATA_MEMORY_STORE.autoDownloadPhotos,
    );
    const autoDownloadVideos = normalizeBoolean(
        raw.autoDownloadVideos,
        DEFAULT_DATA_MEMORY_STORE.autoDownloadVideos,
    );

    const rawFileLimit = toFiniteNumber(raw.autoDownloadFilesMaxMb, DEFAULT_DATA_MEMORY_STORE.autoDownloadFilesMaxMb);
    const autoDownloadFilesMaxMb = Number(
        clamp(rawFileLimit, MIN_FILE_AUTODOWNLOAD_MB, MAX_FILE_AUTODOWNLOAD_MB).toFixed(1)
    );

    const rawRetention = Math.round(toFiniteNumber(raw.cacheRetentionDays, DEFAULT_DATA_MEMORY_STORE.cacheRetentionDays));
    const cacheRetentionDays = RETENTION_ALLOWED_DAYS.has(rawRetention)
        ? rawRetention
        : DEFAULT_DATA_MEMORY_STORE.cacheRetentionDays;

    const rawMaxCacheMb = Math.round(toFiniteNumber(raw.maxCacheMb, DEFAULT_DATA_MEMORY_STORE.maxCacheMb));
    const maxCacheMb = rawMaxCacheMb === 0
        ? 0
        : clamp(rawMaxCacheMb, MIN_MAX_CACHE_MB, MAX_MAX_CACHE_MB);

    return {
        autoDownloadMedia,
        autoDownloadPhotos,
        autoDownloadVideos,
        autoDownloadFilesMaxMb,
        cacheRetentionDays,
        maxCacheMb,
    };
}

function safeStorageGetItem(storage, key) {
    try {
        return String(storage?.getItem(key) || '').trim();
    } catch (_) {
        return '';
    }
}

export function readDataMemoryStore(storage = window.localStorage) {
    const raw = safeStorageGetItem(storage, DATA_MEMORY_PREFS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DATA_MEMORY_STORE };
    try {
        const parsed = JSON.parse(raw);
        return normalizeDataMemoryStore(parsed);
    } catch (_) {
        return { ...DEFAULT_DATA_MEMORY_STORE };
    }
}

export function writeDataMemoryStore(value, storage = window.localStorage) {
    const normalized = normalizeDataMemoryStore(value);
    try {
        storage?.setItem(DATA_MEMORY_PREFS_STORAGE_KEY, JSON.stringify(normalized));
    } catch (_) {}
    return normalized;
}

export function estimateValueBytes(value) {
    try {
        const packed = JSON.stringify(value);
        if (typeof packed !== 'string') return 0;
        return new TextEncoder().encode(packed).length;
    } catch (_) {
        return 0;
    }
}

function normalizeMessageType(message) {
    return String(message?.message_type || '').trim().toLowerCase();
}

function classifyFromFilePayload(filePayload) {
    if (!filePayload || typeof filePayload !== 'object') return null;

    const mime = String(filePayload.mime || '').trim().toLowerCase();
    if (mime.startsWith('image/')) return CACHE_CATEGORY_PHOTOS;
    if (mime.startsWith('video/')) return CACHE_CATEGORY_VIDEOS;

    const stickerCandidate = String(filePayload.sticker || filePayload.emoji || '').trim();
    if (stickerCandidate) return CACHE_CATEGORY_STICKERS;

    return null;
}

export function classifyCachedMessage(message) {
    const type = normalizeMessageType(message);
    if (type === 'image' || type === 'photo') return CACHE_CATEGORY_PHOTOS;
    if (type === 'video') return CACHE_CATEGORY_VIDEOS;
    if (type === 'sticker' || type === 'emoji' || type === 'reaction') return CACHE_CATEGORY_STICKERS;

    const payload = parseSunFilePayload(String(message?.message || ''));
    const payloadCategory = classifyFromFilePayload(payload);
    if (payloadCategory) return payloadCategory;

    return CACHE_CATEGORY_OTHER;
}

export function buildChatCacheBreakdown(rows) {
    const categories = {
        [CACHE_CATEGORY_PHOTOS]: 0,
        [CACHE_CATEGORY_VIDEOS]: 0,
        [CACHE_CATEGORY_STICKERS]: 0,
        [CACHE_CATEGORY_OTHER]: 0,
    };
    const safeRows = Array.isArray(rows) ? rows : [];
    let totalBytes = 0;
    let chatCount = 0;
    let messageCount = 0;

    safeRows.forEach((row) => {
        const chatId = String(row?.chat_id || '').trim();
        if (!chatId) return;
        chatCount += 1;
        const messages = Array.isArray(row.messages) ? row.messages : [];
        messages.forEach((message) => {
            const bytes = estimateValueBytes(message);
            totalBytes += bytes;
            messageCount += 1;
            const category = classifyCachedMessage(message);
            categories[category] += bytes;
        });
        totalBytes += estimateValueBytes({
            chat_id: chatId,
            firstId: row?.firstId || 0,
            lastId: row?.lastId || 0,
            updatedAt: row?.updatedAt || 0,
        });
    });

    return {
        totalBytes,
        chatCount,
        messageCount,
        categories,
    };
}

export function formatBytesCompact(value) {
    const bytes = Math.max(0, Number(value) || 0);
    if (bytes < 1024) return `${bytes} B`;
    const kb = bytes / 1024;
    if (kb < 1024) return `${kb.toFixed(1)} KB`;
    const mb = kb / 1024;
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    return `${(mb / 1024).toFixed(2)} GB`;
}

