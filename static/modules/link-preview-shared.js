import { withAppRoot } from './app-url.js';

const CACHE_TTL_MS = 30 * 60 * 1000;
const NEGATIVE_CACHE_TTL_MS = 45 * 1000;
const CACHE_MAX_ENTRIES = 4096;

const payloadCache = new Map();
const requestCache = new Map();

function normalizeUrlKey(urlValue) {
    return String(urlValue || '').trim();
}

function nowMs() {
    return Date.now();
}

function pruneExpiredCache(atMs) {
    for (const [urlKey, record] of payloadCache) {
        const expiresAtMs = Number(record?.expiresAtMs || 0);
        if (expiresAtMs > atMs) continue;
        payloadCache.delete(urlKey);
    }
}

function enforceCacheLimit() {
    if (payloadCache.size <= CACHE_MAX_ENTRIES) return;
    const entries = Array.from(payloadCache.entries());
    entries.sort((left, right) => Number(left[1]?.expiresAtMs || 0) - Number(right[1]?.expiresAtMs || 0));
    while (payloadCache.size > CACHE_MAX_ENTRIES && entries.length) {
        const [urlKey] = entries.shift();
        payloadCache.delete(urlKey);
    }
}

function readPayloadRecord(urlValue) {
    const urlKey = normalizeUrlKey(urlValue);
    if (!urlKey) return null;

    const record = payloadCache.get(urlKey);
    if (!record) return null;

    const currentMs = nowMs();
    const expiresAtMs = Number(record?.expiresAtMs || 0);
    if (expiresAtMs > currentMs) {
        return record;
    }

    payloadCache.delete(urlKey);
    return null;
}

function writePayloadRecord(urlValue, payload, ttlMs) {
    const urlKey = normalizeUrlKey(urlValue);
    if (!urlKey) return;

    const currentMs = nowMs();
    const safeTtlMs = Math.max(1, Number(ttlMs) || 0);
    const expiresAtMs = currentMs + safeTtlMs;

    payloadCache.set(urlKey, {
        payload,
        expiresAtMs,
    });

    pruneExpiredCache(currentMs);
    enforceCacheLimit();
}

export function getCachedLinkPreviewPayload(urlValue) {
    const record = readPayloadRecord(urlValue);
    if (!record) return undefined;
    return record.payload ?? null;
}

export function primeLinkPreviewPayload(urlValue, payload) {
    const safePayload = payload && typeof payload === 'object' ? payload : null;
    const hasMeta = Boolean(
        safePayload
        && (safePayload.success !== false)
        && (
            String(safePayload.title || '').trim()
            || String(safePayload.description || '').trim()
            || String(safePayload.image_url || '').trim()
        )
    );

    const ttlMs = hasMeta ? CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS;
    writePayloadRecord(urlValue, safePayload, ttlMs);
}

export function requestLinkPreviewPayload(urlValue) {
    const safeUrl = normalizeUrlKey(urlValue);
    if (!safeUrl) return Promise.resolve(null);

    const cachedPayload = getCachedLinkPreviewPayload(safeUrl);
    if (cachedPayload !== undefined) {
        return Promise.resolve(cachedPayload);
    }

    if (requestCache.has(safeUrl)) {
        return requestCache.get(safeUrl);
    }

    const requestPromise = fetch(withAppRoot(`/link_preview?url=${encodeURIComponent(safeUrl)}`), {
        method: 'GET',
        headers: {
            Accept: 'application/json',
        },
    })
        .then((response) => {
            if (!response.ok) {
                throw new Error(`preview:${response.status}`);
            }
            return response.json();
        })
        .then((payload) => {
            primeLinkPreviewPayload(safeUrl, payload);
            return payload;
        })
        .catch(() => {
            primeLinkPreviewPayload(safeUrl, null);
            return null;
        })
        .finally(() => {
            requestCache.delete(safeUrl);
        });

    requestCache.set(safeUrl, requestPromise);
    return requestPromise;
}
