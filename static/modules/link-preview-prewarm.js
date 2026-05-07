import { requestLinkPreviewPayload } from './link-preview-shared.js';

const LINK_URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+|\bwww\.[^\s<>"'`]+/i;
const TRAILING_PUNCTUATION_RE = /[),.;:!?\]]+$/;
const PREWARM_COOLDOWN_MS = 5 * 60 * 1000;
const PREWARM_CACHE_MAX_SIZE = 4096;

const prewarmedUntil = new Map();
const prewarmPending = new Set();
const prewarmTasks = new Map();

function normalizePreviewUrl(rawValue) {
    const rawText = String(rawValue || '').trim();
    if (!rawText) return '';

    const matched = rawText.match(LINK_URL_PATTERN);
    if (!matched) return '';

    let candidate = String(matched[0] || '').replace(TRAILING_PUNCTUATION_RE, '');
    if (!candidate) return '';
    if (candidate.toLowerCase().startsWith('www.')) {
        candidate = `https://${candidate}`;
    }

    try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return '';
        parsed.hash = '';
        return parsed.toString();
    } catch (_) {
        return '';
    }
}

function prunePrewarmCache(nowMs) {
    if (prewarmedUntil.size <= PREWARM_CACHE_MAX_SIZE) return;
    for (const [url, expiresAt] of prewarmedUntil) {
        if (expiresAt > nowMs) continue;
        prewarmedUntil.delete(url);
    }
}

function runPrewarmNow(normalizedUrl) {
    const safeUrl = String(normalizedUrl || '').trim();
    if (!safeUrl) return Promise.resolve();

    if (prewarmTasks.has(safeUrl)) {
        return prewarmTasks.get(safeUrl);
    }

    prewarmPending.add(safeUrl);
    const task = requestLinkPreviewPayload(safeUrl)
        .catch(() => null)
        .finally(() => {
            prewarmPending.delete(safeUrl);
            prewarmTasks.delete(safeUrl);
            prewarmedUntil.set(safeUrl, Date.now() + PREWARM_COOLDOWN_MS);
            prunePrewarmCache(Date.now());
        });
    prewarmTasks.set(safeUrl, task);
    return task;
}

export function scheduleMessageLinkPreviewPrewarm(rawMessage, { delayMs = 90, awaitReady = false } = {}) {
    const normalizedUrl = normalizePreviewUrl(rawMessage);
    if (!normalizedUrl) return '';

    const nowMs = Date.now();
    const warmedUntilMs = Number(prewarmedUntil.get(normalizedUrl) || 0);
    if (warmedUntilMs > nowMs) {
        return awaitReady ? Promise.resolve(normalizedUrl) : normalizedUrl;
    }
    if (prewarmPending.has(normalizedUrl)) {
        if (awaitReady) {
            return (prewarmTasks.get(normalizedUrl) || Promise.resolve()).then(() => normalizedUrl);
        }
        return normalizedUrl;
    }

    if (awaitReady) {
        return runPrewarmNow(normalizedUrl).then(() => normalizedUrl);
    }

    const runPrewarm = () => {
        if (prewarmPending.has(normalizedUrl)) return;
        const currentNowMs = Date.now();
        const currentUntilMs = Number(prewarmedUntil.get(normalizedUrl) || 0);
        if (currentUntilMs > currentNowMs) return;
        runPrewarmNow(normalizedUrl);
    };

    const safeDelayMs = Math.max(0, Number(delayMs) || 0);
    if (safeDelayMs > 0) {
        window.setTimeout(runPrewarm, safeDelayMs);
    } else {
        runPrewarm();
    }

    return normalizedUrl;
}
