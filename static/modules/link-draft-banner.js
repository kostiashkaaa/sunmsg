import { waitForMotionEnd } from './motion.js';
import { requestLinkPreviewPayload } from './link-preview-shared.js';
import { withAppRoot } from './app-url.js';
import { withStableChatScroll } from './chat-scroll-stability.js';

const LINK_URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`]+|\bwww\.[^\s<>"'`]+/i;
const TRAILING_PUNCTUATION_RE = /[),.;:!?\]]+$/;

function normalizeDraftUrl(rawValue) {
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

function hostLabel(urlValue) {
    try {
        const host = new URL(urlValue).hostname || '';
        return host.replace(/^www\./i, '') || host;
    } catch (_) {
        return '';
    }
}

function trimPreviewLine(value, maxLen = 140) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    if (normalized.length <= maxLen) return normalized;
    return normalized.slice(0, maxLen).trimEnd() + '…';
}

function requestLinkPreview(normalizedUrl) {
    const safeUrl = String(normalizedUrl || '').trim();
    if (!safeUrl) return Promise.resolve(null);
    return requestLinkPreviewPayload(safeUrl);
}

function applyThumb(thumbEl, imgEl, imageUrl) {
    if (!thumbEl || !imgEl) return;
    const src = imageUrl ? withAppRoot(`/link_preview_image?url=${encodeURIComponent(imageUrl)}`) : '';
    if (src) {
        imgEl.src = src;
        imgEl.onload = () => thumbEl.classList.add('has-image');
        imgEl.onerror = () => {
            thumbEl.classList.remove('has-image');
            imgEl.removeAttribute('src');
        };
    } else {
        thumbEl.classList.remove('has-image');
        imgEl.removeAttribute('src');
        imgEl.onload = null;
        imgEl.onerror = null;
    }
}

export function initLinkDraftBar({
    barEl,
    labelEl,
    textEl,
    thumbEl,
    thumbImgEl,
    closeBtnEl,
    inputEl,
    formEl,
    chatMessages,
    resizeComposerInput,
    scheduleComposerFocus,
} = {}) {
    if (!barEl || !inputEl) {
        return {
            syncFromInput() {},
            hide() {},
            showForUrl() {},
        };
    }

    let currentUrl = '';
    let dismissedUrl = '';
    let pendingRequestSeq = 0;
    let inputDebounceTimer = 0;
    let hideMotionSeq = 0;

    function showBar() {
        const motionSeq = ++hideMotionSeq;
        withStableChatScroll(chatMessages || barEl, () => {
            barEl.classList.remove('link-draft-bar--hidden', 'is-closing');
            barEl.style.display = 'flex';
            barEl.setAttribute('aria-hidden', 'false');
        });
        requestAnimationFrame(() => {
            if (motionSeq !== hideMotionSeq) return;
            barEl.classList.add('is-visible');
        });
    }

    function hideBar() {
        const motionSeq = ++hideMotionSeq;
        withStableChatScroll(chatMessages || barEl, () => {
            barEl.classList.remove('is-visible');
            barEl.classList.add('is-closing');
            barEl.setAttribute('aria-hidden', 'true');
        });
        waitForMotionEnd(barEl, 220).then(() => {
            if (motionSeq !== hideMotionSeq) return;
            if (barEl.classList.contains('is-visible')) return;
            withStableChatScroll(chatMessages || barEl, () => {
                barEl.classList.add('link-draft-bar--hidden');
                barEl.classList.remove('is-closing');
                barEl.style.display = 'none';
            });
        });
    }

    function setBannerText({ site = '', summary = '' } = {}) {
        if (labelEl) {
            labelEl.textContent = trimPreviewLine(site || hostLabel(currentUrl) || 'Ссылка', 48).toUpperCase();
        }
        if (textEl) {
            textEl.textContent = trimPreviewLine(summary || currentUrl, 170);
        }
    }

    function applyPreviewPayload(payload, urlToken, requestSeq) {
        if (requestSeq !== pendingRequestSeq) return;
        if (String(urlToken) !== String(currentUrl)) return;
        if (!payload || payload.success === false) {
            setBannerText({ site: hostLabel(urlToken), summary: urlToken });
            applyThumb(thumbEl, thumbImgEl, '');
            return;
        }

        const siteName = String(payload.site_name || '').trim() || hostLabel(urlToken);
        const title = String(payload.title || '').trim();
        const description = String(payload.description || '').trim();
        const summary = title || description || urlToken;
        const imageUrl = String(payload.image_url || '').trim();

        setBannerText({ site: siteName, summary });
        applyThumb(thumbEl, thumbImgEl, imageUrl);
    }

    function showForUrl(urlToken) {
        currentUrl = String(urlToken || '').trim();
        if (!currentUrl) {
            hideBar();
            return;
        }

        showBar();
        setBannerText({ site: hostLabel(currentUrl), summary: currentUrl });
        applyThumb(thumbEl, thumbImgEl, '');

        const requestSeq = ++pendingRequestSeq;
        requestLinkPreview(currentUrl).then((payload) => {
            applyPreviewPayload(payload, currentUrl, requestSeq);
        });
    }

    function syncFromInput({ force = false } = {}) {
        const detectedUrl = normalizeDraftUrl(inputEl.value);

        if (!detectedUrl) {
            currentUrl = '';
            dismissedUrl = '';
            hideBar();
            return;
        }

        if (!force && dismissedUrl && dismissedUrl === detectedUrl) {
            currentUrl = detectedUrl;
            hideBar();
            return;
        }

        if (!force && detectedUrl === currentUrl && barEl.classList.contains('is-visible')) {
            return;
        }

        showForUrl(detectedUrl);
    }

    function handleInput() {
        if (inputDebounceTimer) {
            window.clearTimeout(inputDebounceTimer);
        }
        inputDebounceTimer = window.setTimeout(() => {
            inputDebounceTimer = 0;
            syncFromInput();
            resizeComposerInput?.();
        }, 110);
    }

    inputEl.addEventListener('input', handleInput);

    closeBtnEl?.addEventListener('click', () => {
        dismissedUrl = currentUrl;
        hideBar();
        scheduleComposerFocus?.({ force: true });
    });

    formEl?.addEventListener('reset', () => {
        currentUrl = '';
        dismissedUrl = '';
        applyThumb(thumbEl, thumbImgEl, '');
        hideBar();
    });

    return {
        syncFromInput,
        hide: hideBar,
        showForUrl,
    };
}
