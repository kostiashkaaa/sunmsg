import { withAppRoot } from './app-url.js';
import {
    getCachedLinkPreviewPayload,
    requestLinkPreviewPayload,
} from './link-preview-shared.js';
import { withStableChatScroll } from './chat-scroll-stability.js';

const MESSAGE_URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+|\bwww\.[^\s<>"'`]+/i;
const TRAILING_PUNCTUATION_RE = /[),.;:!?\]]+$/;
const PREVIEW_DATA_ATTR = 'data-link-preview';

function normalizePreviewUrl(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) return '';
    const matched = raw.match(MESSAGE_URL_PATTERN);
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

function hostLabel(urlValue) {
    try {
        const host = new URL(urlValue).hostname || '';
        return host.replace(/^www\./i, '') || host;
    } catch (_) {
        return '';
    }
}

function readMessageText(messageLike) {
    if (typeof messageLike === 'string') return messageLike;
    if (messageLike && typeof messageLike.message === 'string') return messageLike.message;
    return '';
}

function ensurePreviewNode(messageTextEl) {
    if (!messageTextEl) return null;
    let node = messageTextEl.parentElement?.querySelector(`[${PREVIEW_DATA_ATTR}]`);
    if (node) return node;

    node = document.createElement('div');
    node.className = 'message-link-preview';
    node.setAttribute('data-link-preview', '1');
    node.innerHTML = `
        <a class="message-link-preview__surface" target="_blank" rel="noopener noreferrer">
            <span class="message-link-preview__bar"></span>
            <span class="message-link-preview__body">
                <span class="message-link-preview__meta">
                    <span class="message-link-preview__site"></span>
                    <span class="message-link-preview__title"></span>
                    <span class="message-link-preview__description" hidden></span>
                </span>
                <span class="message-link-preview__media" hidden>
                    <img class="message-link-preview__image" alt="" loading="lazy" decoding="async">
                </span>
            </span>
        </a>`;

    withStableChatScroll(messageTextEl, () => {
        messageTextEl.insertAdjacentElement('afterend', node);
    });
    return node;
}

function clearPreviewNode(messageTextEl) {
    if (!messageTextEl) return;
    const node = messageTextEl.parentElement?.querySelector(`[${PREVIEW_DATA_ATTR}]`);
    withStableChatScroll(messageTextEl, () => {
        node?.remove();
    });
}

function applyPreviewState(node, {
    href,
    siteName,
    title,
    description,
    imageUrl,
    imageLayout,
    imageAspectRatio,
    loading = false,
} = {}) {
    if (!node) return;

    withStableChatScroll(node, () => {
        const anchor = node.querySelector('.message-link-preview__surface');
        const siteEl = node.querySelector('.message-link-preview__site');
        const titleEl = node.querySelector('.message-link-preview__title');
        const descriptionEl = node.querySelector('.message-link-preview__description');
        const mediaEl = node.querySelector('.message-link-preview__media');
        const imageEl = node.querySelector('.message-link-preview__image');

        const safeHref = String(href || '').trim();
        const safeSiteName = String(siteName || '').trim();
        const safeTitle = String(title || '').trim();
        const safeDescription = String(description || '').trim();
        const safeImageUrl = String(imageUrl || '').trim();
        const safeImageLayout = String(imageLayout || '').trim().toLowerCase();
        const safeImageAspectRatio = String(imageAspectRatio || '').trim();

        if (anchor) {
            // Defense-in-depth: only ever assign an http(s) href so a tampered
            // server payload cannot smuggle a javascript:/data: scheme into the
            // anchor. normalizePreviewUrl already enforces this on the input
            // side; re-check here because href comes from the server response.
            const httpHref = /^https?:\/\//i.test(safeHref) ? safeHref : '';
            anchor.href = httpHref || '#';
        }
        if (siteEl) {
            siteEl.textContent = safeSiteName || hostLabel(safeHref);
        }
        if (titleEl) {
            titleEl.textContent = safeTitle || safeSiteName || hostLabel(safeHref) || safeHref;
        }
        if (descriptionEl) {
            const hasDescription = Boolean(safeDescription);
            descriptionEl.hidden = !hasDescription;
            descriptionEl.textContent = hasDescription ? safeDescription : '';
        }
        if (mediaEl && imageEl) {
            const hasImage = Boolean(safeImageUrl);
            const nextImageSrc = hasImage ? buildPreviewImageSrc(safeImageUrl) : '';
            const imageSeq = Number(imageEl.dataset?.previewImageSeq || 0) + 1;
            if (imageEl.dataset) {
                imageEl.dataset.previewImageSeq = String(imageSeq);
            }
            mediaEl.hidden = !hasImage;
            if (hasImage) {
                const finalLayout = safeImageLayout === 'compact' ? 'compact' : 'full';
                node.classList.toggle('is-compact', finalLayout === 'compact');
                if (safeImageAspectRatio) {
                    mediaEl.style.setProperty('--preview-media-ar', safeImageAspectRatio);
                } else {
                    mediaEl.style.removeProperty('--preview-media-ar');
                }
            } else {
                node.classList.remove('is-compact');
                mediaEl.style.removeProperty('--preview-media-ar');
            }
            if (hasImage) {
                imageEl.onload = null;
                imageEl.onerror = () => {
                    if (
                        imageEl.dataset?.previewImageSeq !== String(imageSeq)
                        || !node.isConnected
                        || String(imageEl.getAttribute('src') || '') !== nextImageSrc
                    ) return;
                    withStableChatScroll(node, () => {
                        node.classList.remove('is-compact');
                        node.classList.remove('has-image');
                        mediaEl.hidden = true;
                        mediaEl.style.removeProperty('--preview-media-ar');
                        imageEl.removeAttribute('src');
                    });
                };
                if (String(imageEl.getAttribute('src') || '') !== nextImageSrc) {
                    imageEl.src = nextImageSrc;
                }
            } else {
                imageEl.removeAttribute('src');
                imageEl.onload = null;
                imageEl.onerror = null;
                node.classList.remove('is-compact');
            }
        }

        node.classList.toggle('is-loading', Boolean(loading));
        node.classList.toggle('has-image', Boolean(safeImageUrl));
        node.setAttribute('aria-busy', loading ? 'true' : 'false');
    });
}

function buildPreviewImageSrc(imageUrl) {
    const normalized = String(imageUrl || '').trim();
    if (!normalized) return '';
    return withAppRoot(`/link_preview_image?url=${encodeURIComponent(normalized)}`);
}

function applyResolvedPreviewPayload(previewNode, normalizedUrl, payload) {
    const previewUrl = String(payload?.url || normalizedUrl).trim() || normalizedUrl;
    const previewSite = String(payload?.site_name || '').trim() || hostLabel(previewUrl);
    const previewTitle = String(payload?.title || '').trim() || previewSite;
    const previewDescription = String(payload?.description || '').trim();
    const previewImageUrl = String(payload?.image_url || '').trim();
    const previewImageLayout = String(payload?.image_layout || '').trim();
    const previewImageAspectRatio = String(payload?.image_aspect_ratio || '').trim();

    applyPreviewState(previewNode, {
        href: previewUrl,
        siteName: previewSite,
        title: previewTitle,
        description: previewDescription,
        imageUrl: previewImageUrl,
        imageLayout: previewImageLayout,
        imageAspectRatio: previewImageAspectRatio,
        loading: false,
    });
}

export function renderMessageLinkPreview(messageRoot, messageLike) {
    if (!messageRoot) return;

    const messageTextEl = messageRoot.querySelector('.message-text');
    if (!messageTextEl) return;

    const rawMessageText = readMessageText(messageLike);
    const normalizedUrl = normalizePreviewUrl(rawMessageText);
    if (!normalizedUrl) {
        clearPreviewNode(messageTextEl);
        return;
    }

    const previewNode = ensurePreviewNode(messageTextEl);
    if (!previewNode) return;

    previewNode.dataset.previewUrl = normalizedUrl;
    const cachedPayload = getCachedLinkPreviewPayload(normalizedUrl);
    if (cachedPayload !== undefined) {
        if (!cachedPayload || !cachedPayload.has_meta) {
            clearPreviewNode(messageTextEl);
            return;
        }
        applyResolvedPreviewPayload(previewNode, normalizedUrl, cachedPayload);
        return;
    }

    applyPreviewState(previewNode, {
        href: normalizedUrl,
        siteName: hostLabel(normalizedUrl),
        title: hostLabel(normalizedUrl),
        description: '',
        imageUrl: '',
        imageLayout: 'none',
        imageAspectRatio: '',
        loading: true,
    });

    requestLinkPreviewPayload(normalizedUrl).then((payload) => {
        if (!previewNode.isConnected) return;
        if (String(previewNode.dataset.previewUrl || '') !== normalizedUrl) return;
        if (!payload || !payload.has_meta) {
            clearPreviewNode(messageTextEl);
            return;
        }
        applyResolvedPreviewPayload(previewNode, normalizedUrl, payload);
    });
}
