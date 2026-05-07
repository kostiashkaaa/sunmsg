import { withAppRoot } from './app-url.js';
import {
    getCachedLinkPreviewPayload,
    requestLinkPreviewPayload,
} from './link-preview-shared.js';

const MESSAGE_URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+|\bwww\.[^\s<>"'`]+/i;
const TRAILING_PUNCTUATION_RE = /[),.;:!?\]]+$/;
const PREVIEW_DATA_ATTR = 'data-link-preview';

const CHAT_SCROLL_STABILIZE_BOTTOM_THRESHOLD = 18;
const CHAT_SCROLL_INITIAL_GRACE_MS = 2200;
const CHAT_SCROLL_CORRECTION_MIN_DELTA_PX = 2.0;

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
            <span class="message-link-preview__meta">
                <span class="message-link-preview__site"></span>
                <span class="message-link-preview__title"></span>
                <span class="message-link-preview__description" hidden></span>
                <span class="message-link-preview__url"></span>
            </span>
            <span class="message-link-preview__media" hidden>
                <img class="message-link-preview__image" alt="" loading="lazy" decoding="async">
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

function resolveChatScrollContainer(referenceNode) {
    if (!referenceNode) return null;
    const scopedContainer = referenceNode.closest('#chatMessages, .chat-messages');
    if (scopedContainer instanceof HTMLElement) return scopedContainer;
    const globalContainer = document.getElementById('chatMessages');
    return globalContainer instanceof HTMLElement ? globalContainer : null;
}

function resolveViewportAnchor(scrollContainer) {
    if (!(scrollContainer instanceof HTMLElement)) return null;
    const containerRect = scrollContainer.getBoundingClientRect();
    const containerTop = Number(containerRect.top) || 0;
    const nodes = scrollContainer.querySelectorAll('.message, .day-separator');
    for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        const rect = node.getBoundingClientRect();
        if (Number(rect.bottom) > containerTop + 1) {
            return {
                element: node,
                top: Number(rect.top) || 0,
            };
        }
    }
    return null;
}

function withStableChatScroll(referenceNode, mutateFn) {
    const scrollContainer = resolveChatScrollContainer(referenceNode);
    if (!scrollContainer || typeof mutateFn !== 'function') {
        mutateFn?.();
        return;
    }

    const previousScrollTop = Number(scrollContainer.scrollTop) || 0;
    const previousScrollHeight = Number(scrollContainer.scrollHeight) || 0;
    const previousClientHeight = Number(scrollContainer.clientHeight) || 0;
    const previousBottomDistance = previousScrollHeight - (previousScrollTop + previousClientHeight);
    const wasNearBottom = previousBottomDistance <= CHAT_SCROLL_STABILIZE_BOTTOM_THRESHOLD;
    const nowMs = Date.now();
    const existingBootAt = Number(scrollContainer.dataset.previewStableBootAt || 0);
    const bootAtMs = Number.isFinite(existingBootAt) && existingBootAt > 0 ? existingBootAt : nowMs;
    if (!existingBootAt) {
        scrollContainer.dataset.previewStableBootAt = String(bootAtMs);
    }
    const isWithinInitialGrace = (nowMs - bootAtMs) <= CHAT_SCROLL_INITIAL_GRACE_MS;
    const viewportAnchorBefore = resolveViewportAnchor(scrollContainer);
    const containerRectBefore = scrollContainer.getBoundingClientRect();
    const referenceRectBefore = referenceNode instanceof Element
        ? referenceNode.getBoundingClientRect()
        : null;
    const wasReferenceAboveViewport = Boolean(
        referenceRectBefore
        && referenceRectBefore.bottom <= containerRectBefore.top + 1
    );

    mutateFn();

    const nextScrollHeight = Number(scrollContainer.scrollHeight) || 0;
    if (nextScrollHeight === previousScrollHeight) return;

    if (wasNearBottom) {
        const nextTop = Math.max(0, nextScrollHeight - previousClientHeight);
        scrollContainer.scrollTop = nextTop;
        return;
    }

    if (viewportAnchorBefore?.element instanceof HTMLElement) {
        const anchorRectAfter = viewportAnchorBefore.element.getBoundingClientRect();
        const anchorDelta = (Number(anchorRectAfter.top) || 0) - (Number(viewportAnchorBefore.top) || 0);
        if (Number.isFinite(anchorDelta) && Math.abs(anchorDelta) >= CHAT_SCROLL_CORRECTION_MIN_DELTA_PX) {
            scrollContainer.scrollTop = Math.max(0, previousScrollTop + anchorDelta);
            return;
        }
    }

    if (isWithinInitialGrace) return;

    if (!wasReferenceAboveViewport || !(referenceNode instanceof Element)) return;

    const referenceRectAfter = referenceNode.getBoundingClientRect();
    const shiftDelta = (Number(referenceRectAfter.top) || 0) - (Number(referenceRectBefore?.top) || 0);
    if (!Number.isFinite(shiftDelta) || Math.abs(shiftDelta) < CHAT_SCROLL_CORRECTION_MIN_DELTA_PX) return;

    scrollContainer.scrollTop = Math.max(0, previousScrollTop + shiftDelta);
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
        const urlEl = node.querySelector('.message-link-preview__url');
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
            anchor.href = safeHref || '#';
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
        if (urlEl) {
            urlEl.textContent = safeHref;
        }
        if (mediaEl && imageEl) {
            const hasImage = Boolean(safeImageUrl);
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
                imageEl.src = buildPreviewImageSrc(safeImageUrl);
                imageEl.onload = null;
                imageEl.onerror = () => {
                    withStableChatScroll(node, () => {
                        node.classList.remove('is-compact');
                        node.classList.remove('has-image');
                        mediaEl.hidden = true;
                        mediaEl.style.removeProperty('--preview-media-ar');
                        imageEl.removeAttribute('src');
                    });
                };
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
        applyResolvedPreviewPayload(previewNode, normalizedUrl, payload);
    });
}
