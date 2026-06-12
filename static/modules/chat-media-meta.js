// Visual media metadata enrichment: probes width/height for image/video
// payloads that arrived without preview_* fields so the renderer can set
// the right aspect ratio before the resource itself loads.

import { sanitizeFileUri, parseSunFilePayload } from './utils.js';
import { mapWithConcurrency } from './chat-history-runtime.js';

const CHAT_MEDIA_META_PROBE_CONCURRENCY = 4;
const CHAT_MEDIA_META_PROBE_TIMEOUT_MS = 1800;
const CHAT_MEDIA_META_RENDER_BUDGET_MS = 96;

export function createChatMediaMetaController(deps = {}) {
    const {
        buildPendingMediaDimensions,
    } = deps;

    const mediaMetaProbeInFlight = new Map();
    const mediaMetaBySource = new Map();

    function normalizeMediaMetaSourceKey(source) {
        const raw = String(source || '').trim();
        if (!raw) return '';
        if (raw.startsWith('blob:')) return '';
        if (raw.startsWith('data:')) return '';
        try {
            const parsed = new URL(raw, window.location.origin);
            if (parsed.origin === window.location.origin) {
                return `${parsed.pathname}${parsed.search}`;
            }
            return parsed.href;
        } catch (_) {
            return raw;
        }
    }

    function hasVisualPreviewMeta(filePayload) {
        const width = Number(filePayload?.preview_width);
        const height = Number(filePayload?.preview_height);
        const ratio = Number(filePayload?.preview_aspect_ratio);
        if (Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0) {
            return true;
        }
        return Number.isFinite(ratio) && ratio > 0;
    }

    function resolveVisualMediaKind(filePayload) {
        const mime = String(filePayload?.mime || '').toLowerCase();
        if (mime.startsWith('image/')) return 'image';
        if (mime.startsWith('video/')) return 'video';
        return '';
    }

    function probeVisualMediaMetaBySource(source, kind) {
        const safeSource = String(source || '').trim();
        if (!safeSource || (kind !== 'image' && kind !== 'video')) {
            return Promise.resolve(null);
        }
        const baseKey = normalizeMediaMetaSourceKey(safeSource);
        const cacheKey = baseKey ? `${kind}:${baseKey}` : '';
        if (cacheKey) {
            const cached = mediaMetaBySource.get(cacheKey);
            if (cached) {
                return Promise.resolve(cached);
            }
        }
        if (cacheKey) {
            const inFlight = mediaMetaProbeInFlight.get(cacheKey);
            if (inFlight) {
                return inFlight;
            }
        }
        const probePromise = new Promise((resolve) => {
            let settled = false;
            let timeoutId = 0;
            let videoEl = null;
            let imageEl = null;
            const finish = (meta) => {
                if (settled) return;
                settled = true;
                if (timeoutId) {
                    window.clearTimeout(timeoutId);
                    timeoutId = 0;
                }
                if (videoEl) {
                    try {
                        videoEl.pause();
                        videoEl.removeAttribute('src');
                        videoEl.load();
                    } catch (_) {}
                    videoEl = null;
                }
                imageEl = null;
                if (meta) {
                    if (cacheKey) {
                        mediaMetaBySource.set(cacheKey, meta);
                    }
                }
                resolve(meta || null);
            };
            timeoutId = window.setTimeout(() => finish(null), CHAT_MEDIA_META_PROBE_TIMEOUT_MS);
            if (kind === 'image') {
                imageEl = new Image();
                imageEl.onload = () => {
                    const meta = buildPendingMediaDimensions(imageEl.naturalWidth, imageEl.naturalHeight);
                    finish(meta);
                };
                imageEl.onerror = () => finish(null);
                imageEl.src = safeSource;
                return;
            }
            videoEl = document.createElement('video');
            const tryResolve = () => {
                const meta = buildPendingMediaDimensions(videoEl.videoWidth, videoEl.videoHeight);
                if (meta) finish(meta);
            };
            videoEl.preload = 'metadata';
            videoEl.muted = true;
            videoEl.playsInline = true;
            videoEl.onloadedmetadata = tryResolve;
            videoEl.onloadeddata = tryResolve;
            videoEl.ondurationchange = tryResolve;
            videoEl.onresize = tryResolve;
            videoEl.onerror = () => finish(null);
            videoEl.src = safeSource;
            try {
                videoEl.load();
            } catch (_) {}
        }).finally(() => {
            if (cacheKey) {
                mediaMetaProbeInFlight.delete(cacheKey);
            }
        });
        if (cacheKey) {
            mediaMetaProbeInFlight.set(cacheKey, probePromise);
        }
        return probePromise;
    }

    async function enrichVisualMediaMessageText(messageText) {
        if (typeof messageText !== 'string' || !messageText) return messageText;
        const filePayload = parseSunFilePayload(messageText);
        if (!filePayload) return messageText;
        const mediaKind = resolveVisualMediaKind(filePayload);
        if (!mediaKind || hasVisualPreviewMeta(filePayload)) {
            return messageText;
        }
        const mediaSrc = sanitizeFileUri(filePayload.data, { imageOnlyData: mediaKind === 'image' });
        if (!mediaSrc || mediaSrc === '#') return messageText;
        const meta = await probeVisualMediaMetaBySource(mediaSrc, mediaKind);
        if (!meta) return messageText;
        try {
            return JSON.stringify({ ...filePayload, ...meta });
        } catch (_) {
            return messageText;
        }
    }

    async function enrichDecodedMessagesVisualMeta(messages) {
        const list = Array.isArray(messages) ? messages : [];
        if (!list.length) return [];
        const enrichmentPromise = mapWithConcurrency(list, CHAT_MEDIA_META_PROBE_CONCURRENCY, async (messageState) => {
            const nextMessage = await enrichVisualMediaMessageText(messageState?.message);
            if (nextMessage === messageState?.message) return messageState;
            return {
                ...messageState,
                message: nextMessage,
            };
        }).catch(() => list);

        return Promise.race([
            enrichmentPromise,
            new Promise((resolve) => {
                window.setTimeout(() => resolve(list), CHAT_MEDIA_META_RENDER_BUDGET_MS);
            }),
        ]);
    }

    return {
        enrichVisualMediaMessageText,
        enrichDecodedMessagesVisualMeta,
    };
}
