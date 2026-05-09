export function escapeHtml(text) {
    if (!text) return '';
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function buildAvatarInitials(value) {
    return String(value || '?')
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0] || '')
        .join('')
        .toUpperCase() || '?';
}

export function computeAvatarTintIndex(seed, paletteSize = 8) {
    const normalizedSeed = String(seed || '?').trim() || '?';
    const palette = Math.max(1, Number.parseInt(paletteSize, 10) || 8);
    let hash = 0;
    for (let i = 0; i < normalizedSeed.length; i += 1) {
        hash = (hash * 31 + normalizedSeed.charCodeAt(i)) >>> 0;
    }
    return hash % palette;
}

export function applyFallbackAvatarTint(element, label = '') {
    if (!element) return;
    if (element.querySelector('img')) {
        element.removeAttribute('data-avatar-tint');
        return;
    }
    const initials = buildAvatarInitials(label || element.textContent || '?');
    element.setAttribute('data-avatar-tint', String(computeAvatarTintIndex(initials, 8)));
}

export function renderEmojiGraphicHtml(emoji, options = {}) {
    const normalized = typeof emoji === 'string' ? emoji.trim() : '';
    if (!normalized) return '';
    const className = options.className || 'emoji-graphic';
    const alt = options.alt || normalized;
    const titleAttr = options.title ? ` title="${escapeHtml(options.title)}"` : '';
    return `<span class="${escapeHtml(className)}" role="img" aria-label="${escapeHtml(alt)}"${titleAttr}>${escapeHtml(normalized)}</span>`;
}

export function applyEmojiGraphics(root) {
    return Boolean(root);
}

function tr(value) {
    const api = window.SUN_I18N;
    if (api && typeof api.translateText === 'function') {
        return api.translateText(value);
    }
    return String(value ?? '');
}

function activeLocale() {
    const api = window.SUN_I18N;
    const language = api && typeof api.getLanguage === 'function'
        ? api.getLanguage()
        : (document.documentElement.lang === 'en' ? 'en' : 'ru');
    return language === 'en' ? 'en-US' : 'ru-RU';
}

const TIME_FORMAT_STORAGE_KEY = 'sun_time_format_v1';
const TIME_FORMAT_12H = '12h';
const TIME_FORMAT_24H = '24h';

function normalizeTimeFormat(value) {
    const raw = String(value || '').trim().toLowerCase();
    return raw === TIME_FORMAT_12H ? TIME_FORMAT_12H : TIME_FORMAT_24H;
}

function readTimeFormat() {
    try {
        return normalizeTimeFormat(window.localStorage.getItem(TIME_FORMAT_STORAGE_KEY));
    } catch (_) {
        return TIME_FORMAT_24H;
    }
}

function buildTimeFormatOptions({ includeSeconds = false } = {}) {
    const options = {
        hour: '2-digit',
        minute: '2-digit',
        hour12: readTimeFormat() === TIME_FORMAT_12H,
    };
    if (includeSeconds) {
        options.second = '2-digit';
    }
    return options;
}

export function sanitizeFileUri(rawUri, { imageOnlyData = false } = {}) {
    const FALLBACK = '#';
    if (typeof rawUri !== 'string') return FALLBACK;
    const uri = rawUri.trim();
    if (!uri) return FALLBACK;

    if (uri.startsWith('data:')) {
        const dataUriPattern = imageOnlyData
            ? /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$/i
            : /^data:(?:image|audio|video)\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$|^data:application\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+$|^data:text\/(?:plain|csv);base64,[a-z0-9+/=]+$/i;
        return dataUriPattern.test(uri) ? uri : FALLBACK;
    }

    try {
        const parsed = new URL(uri, window.location.origin);
        const protocol = parsed.protocol.toLowerCase();
        return (protocol === 'https:' || protocol === 'http:' || protocol === 'blob:') ? parsed.href : FALLBACK;
    } catch (e) {
        return FALLBACK;
    }
}

export function formatTime(timestamp) {
    if (!timestamp) return '';
    let dateStr = timestamp;
    if (!dateStr.includes('T')) {
        dateStr = dateStr.replace(' ', 'T') + 'Z';
    }
    const d = new Date(dateStr);
    return d.toLocaleTimeString(activeLocale(), buildTimeFormatOptions());
}

export function formatMediaDuration(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatFullTimestamp(timestamp) {
    if (!timestamp) return '';
    let dateStr = timestamp;
    if (!dateStr.includes('T')) {
        dateStr = dateStr.replace(' ', 'T') + 'Z';
    }
    const d = new Date(dateStr);
    const pad = n => String(n).padStart(2, '0');
    const timePart = d.toLocaleTimeString(activeLocale(), buildTimeFormatOptions({ includeSeconds: true }));
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${timePart}`;
}

export function formatSidebarTime(timestamp) {
    if (!timestamp) return '';
    let dateStr = timestamp;
    if (!dateStr.includes('T')) dateStr = dateStr.replace(' ', 'T') + 'Z';
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    const now = new Date();
    const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
    const isYesterday = d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear();
    const isThisYear = d.getFullYear() === now.getFullYear();
    if (isToday) return d.toLocaleTimeString(activeLocale(), buildTimeFormatOptions());
    if (isYesterday) return tr('\u0412\u0447\u0435\u0440\u0430');
    if (isThisYear) {
        return d.toLocaleDateString(activeLocale(), { day: '2-digit', month: '2-digit' });
    }
    return d.toLocaleDateString(activeLocale());
}

export function parseSunFilePayload(messageText) {
    if (!messageText || typeof messageText !== 'string') return null;
    const normalized = messageText.trim();
    if (!normalized) return null;
    // Fast path: avoid throw-heavy JSON.parse for plain chat text.
    if (normalized.charCodeAt(0) !== 123 || !normalized.includes('__sunfile')) return null;
    try {
        const parsed = JSON.parse(normalized);
        if (parsed && parsed.__sunfile) return parsed;
    } catch (_) {}
    return null;
}

function looksLikeImageSource(src) {
    if (typeof src !== 'string' || !src) return false;
    return src.startsWith('data:image/')
        || /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|$)/i.test(src);
}

export function extractImagePreview(filePayload) {
    if (!filePayload || typeof filePayload !== 'object') return null;
    const items = [];

    const pushImageCandidate = (entry) => {
        if (!entry || typeof entry !== 'object') return;
        const src = entry.data || entry.src || entry.url || entry.thumb || entry.thumbnail;
        const mime = entry.mime || '';
        if (!src || typeof src !== 'string') return;
        if ((typeof mime === 'string' && mime.startsWith('image/')) || looksLikeImageSource(src)) {
            items.push(src);
        }
    };

    if (typeof filePayload.data === 'string'
        && ((filePayload.mime || '').startsWith('image/') || looksLikeImageSource(filePayload.data))) {
        items.push(filePayload.data);
    }

    ['images', 'photos', 'items', 'files', 'attachments'].forEach((key) => {
        const arr = filePayload[key];
        if (Array.isArray(arr)) arr.forEach(pushImageCandidate);
    });

    const declaredCount = Number(
        filePayload.image_count || filePayload.images_count || filePayload.total_images || filePayload.count
    );
    const count = Math.max(items.length, Number.isFinite(declaredCount) ? declaredCount : 0, items.length ? 1 : 0);
    if (!count) return null;

    return {
        src: items[0] || '',
        count,
        caption: typeof filePayload.caption === 'string' ? filePayload.caption.trim() : '',
        name: typeof filePayload.name === 'string' ? filePayload.name : '\u0424\u043e\u0442\u043e'
    };
}

function clipPreviewText(text, maxLen = 80) {
    const normalized = String(text || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    return normalized.length > maxLen ? normalized.slice(0, maxLen) : normalized;
}

function buildThumbHtml(src, count, altText) {
    const badge = count > 1 ? `<span class="msg-preview-thumb-count">+${count - 1}</span>` : '';
    if (!src) {
        return `<span class="msg-preview-thumb is-fallback" aria-hidden="true">
            <i class="bi bi-image msg-preview-fallback-icon"></i>
            ${badge}
        </span>`;
    }
    return `<span class="msg-preview-thumb" aria-hidden="true">
        <img src="${escapeHtml(src)}" alt="${escapeHtml(altText || '\u0424\u043e\u0442\u043e')}" loading="lazy" decoding="async">
        ${badge}
    </span>`;
}

export function renderMessagePreviewHtml(messageText, options = {}) {
    const {
        isSelf = false,
        maxLen = 80,
        emptyText = '',
        defaultPhotoText = '\u0424\u043e\u0442\u043e',
        mediaTokenStyle = 'tag',
    } = options;

    const filePayload = parseSunFilePayload(messageText);
    const selfPrefix = isSelf ? `${tr('\u0412\u044B')}: ` : '';
    const photoFallback = tr(defaultPhotoText);

    if (filePayload) {
        const image = extractImagePreview(filePayload);
        if (image) {
            const baseText = image.caption || photoFallback;
            const text = clipPreviewText(selfPrefix + baseText, maxLen);
            return `<span class="msg-preview-inline">
                ${buildThumbHtml(image.src, image.count, image.name)}
                <span class="msg-preview-text">${escapeHtml(text || (selfPrefix + photoFallback))}</span>
            </span>`;
        }
        if ((filePayload.mime || '').startsWith('audio/')) {
            const voiceLabel = tr('\u0413\u043e\u043b\u043e\u0441\u043e\u0432\u043e\u0435');
            const audioText = clipPreviewText(filePayload.caption || voiceLabel, maxLen);
            const safeAudioText = escapeHtml(audioText || voiceLabel);
            if (mediaTokenStyle === 'plain') {
                return `${escapeHtml(selfPrefix)}${safeAudioText}`;
            }
            return `${escapeHtml(selfPrefix)}[voice] ${safeAudioText}`;
        }
        if ((filePayload.mime || '').startsWith('video/')) {
            const videoLabel = tr('\u0412\u0438\u0434\u0435\u043e');
            const videoText = clipPreviewText(filePayload.caption || videoLabel, maxLen);
            const safeVideoText = escapeHtml(videoText || videoLabel);
            if (mediaTokenStyle === 'plain') {
                return `${escapeHtml(selfPrefix)}${safeVideoText}`;
            }
            return `${escapeHtml(selfPrefix)}[video] ${safeVideoText}`;
        }
        const fileLabel = tr('\u0424\u0430\u0439\u043b');
        const fileName = clipPreviewText(filePayload.name || fileLabel, maxLen);
        const safeFileText = escapeHtml(fileName || fileLabel);
        if (mediaTokenStyle === 'plain') {
            return `${escapeHtml(selfPrefix)}${safeFileText}`;
        }
        return `${escapeHtml(selfPrefix)}[file] ${safeFileText}`;
    }

    const text = clipPreviewText((selfPrefix + (messageText || '')), maxLen);
    return escapeHtml(text || emptyText);
}

export function getErrorMessage(err, fallback = '\u041e\u0448\u0438\u0431\u043a\u0430.') {
    if (!err) return fallback;
    if (typeof err === 'string') return err;
    if (typeof err?.message === 'string') return err.message;
    if (typeof err?.error?.message === 'string') return err.error.message;
    return fallback;
}
