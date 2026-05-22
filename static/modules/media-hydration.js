export function createMediaHydrationController(options = {}) {
    const rootElement = options?.root || null;
    const videoSelector = '.file-msg-video-preview[data-src]';
    const imageSelector = '.file-msg-img[data-src]';
    const albumImgSelector = '.album-cell-img[data-src]';
    const albumVideoSelector = '.album-cell-video[data-src]';
    let lazyHydrationObserver = null;
    const observedLazyMedia = new Set();

    // iOS WebKit (all browsers on iOS use WKWebView) has a known bug where
    // IntersectionObserver with a custom root fires unreliably.
    const isIOS = typeof navigator !== 'undefined' && (
        /iPad|iPhone|iPod/.test(navigator.userAgent) ||
        (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
    );

    function resolveMediaKindByElement(element) {
        if (element?.classList?.contains('album-cell-img')) return 'image';
        if (element?.classList?.contains('album-cell-video')) return 'video';
        if (element?.classList?.contains('file-msg-img')) return 'image';
        if (element?.classList?.contains('file-msg-video-preview')) return 'video';
        if (element?.classList?.contains('file-msg-audio-el')) return 'audio';
        return 'other';
    }

    async function resolveHydratedSource(dataSrc, kind) {
        const resolver = window.__sunMediaCacheResolveSource;
        if (typeof resolver !== 'function') return dataSrc;
        try {
            const resolved = await resolver(dataSrc, { kind });
            return String(resolved || dataSrc).trim() || dataSrc;
        } catch (_) {
            return dataSrc;
        }
    }

    function nextHydrationSeq(element) {
        const seq = Number(element.dataset?.mediaHydrationSeq || 0) + 1;
        if (element.dataset) {
            element.dataset.mediaHydrationSeq = String(seq);
        }
        return seq;
    }

    function assignHydratedSource(element, resolvedSrc, expectedDataSrc = '', expectedSeq = 0) {
        if (!(element instanceof HTMLElement)) return;
        if (!resolvedSrc) return;
        if (expectedSeq && element.dataset?.mediaHydrationSeq !== String(expectedSeq)) return;
        if (expectedDataSrc && String(element.getAttribute('data-src') || '').trim() !== expectedDataSrc) return;
        const currentSrc = String(element.getAttribute('src') || '').trim();
        if (currentSrc) return;
        element.setAttribute('src', resolvedSrc);
    }

    function forceImageNetworkLoad(imageEl) {
        if (!(imageEl instanceof HTMLImageElement)) return;
        imageEl.loading = 'eager';
        imageEl.setAttribute('loading', 'eager');
    }

    function markAlbumCellLoaded(mediaEl) {
        const cell = mediaEl.closest('.album-cell');
        if (!cell) return;
        cell.classList.add('is-loaded');
        mediaEl.classList.add('is-loaded');
    }

    function wireAlbumCellLoadEvent(mediaEl) {
        // Avoid double-wiring
        if (mediaEl._albumLoadWired) return;
        mediaEl._albumLoadWired = true;

        if (mediaEl instanceof HTMLImageElement) {
            if (mediaEl.complete && mediaEl.naturalWidth > 0) {
                markAlbumCellLoaded(mediaEl);
            } else {
                mediaEl.addEventListener('load', () => markAlbumCellLoaded(mediaEl), { once: true });
                mediaEl.addEventListener('error', () => {
                    mediaEl.closest('.album-cell')?.classList.add('is-loaded');
                }, { once: true });
            }
        } else if (mediaEl instanceof HTMLVideoElement) {
            mediaEl.addEventListener('loadeddata', () => markAlbumCellLoaded(mediaEl), { once: true });
        }
    }

    function hydrateImage(imageEl) {
        if (!(imageEl instanceof HTMLImageElement)) return false;
        const dataSrc = String(imageEl.getAttribute('data-src') || '').trim();
        if (!dataSrc) return false;
        forceImageNetworkLoad(imageEl);
        if (String(imageEl.getAttribute('src') || '').trim()) return true;

        if (imageEl.classList.contains('album-cell-img')) {
            wireAlbumCellLoadEvent(imageEl);
        }

        const hydrationSeq = nextHydrationSeq(imageEl);
        resolveHydratedSource(dataSrc, resolveMediaKindByElement(imageEl))
            .then((resolvedSrc) => { assignHydratedSource(imageEl, resolvedSrc, dataSrc, hydrationSeq); })
            .catch(() => { assignHydratedSource(imageEl, dataSrc, dataSrc, hydrationSeq); });
        return true;
    }

    function hydrateVideo(mediaEl, force = false) {
        if (!(mediaEl instanceof HTMLMediaElement)) return false;
        const isAlbumVideo = mediaEl.classList.contains('album-cell-video');
        const isVideo = isAlbumVideo || mediaEl.classList.contains('file-msg-video-preview');
        const isAudio = mediaEl.classList.contains('file-msg-audio-el');
        if (!isVideo && !isAudio) return false;

        const dataSrc = String(mediaEl.getAttribute('data-src') || '').trim();
        if (!dataSrc) return false;
        if (String(mediaEl.getAttribute('src') || '').trim()) return true;

        if (isAudio && !force) return false;
        if (isAudio) {
            const hydrationSeq = nextHydrationSeq(mediaEl);
            resolveHydratedSource(dataSrc, resolveMediaKindByElement(mediaEl))
                .then((resolvedSrc) => { assignHydratedSource(mediaEl, resolvedSrc, dataSrc, hydrationSeq); })
                .catch(() => { assignHydratedSource(mediaEl, dataSrc, dataSrc, hydrationSeq); });
            return true;
        }

        if (isVideo) {
            mediaEl.setAttribute('preload', force ? 'auto' : 'metadata');
            mediaEl.removeAttribute('data-loaded');
            if (!isAlbumVideo) {
                mediaEl.closest('.image-wrapper, .video-preview')?.classList.remove('is-loaded');
            }
        }

        if (isAlbumVideo) wireAlbumCellLoadEvent(mediaEl);

        const hydrationSeq = nextHydrationSeq(mediaEl);
        resolveHydratedSource(dataSrc, resolveMediaKindByElement(mediaEl))
            .then((resolvedSrc) => { assignHydratedSource(mediaEl, resolvedSrc, dataSrc, hydrationSeq); })
            .catch(() => { assignHydratedSource(mediaEl, dataSrc, dataSrc, hydrationSeq); });
        return true;
    }

    // Public alias kept for external callers
    function ensureMediaElementHydrated(mediaEl, hydrateOptions = {}) {
        return hydrateVideo(mediaEl, Boolean(hydrateOptions.force));
    }

    // Check if element is within the visible scroll area (with margin).
    // Returns true when position can't be determined — always hydrate in that case.
    function isNearViewport(el, margin = 600) {
        if (!el || !rootElement) return true;
        try {
            const containerRect = rootElement.getBoundingClientRect();
            // Container not painted yet (zero size) — hydrate immediately
            if (containerRect.width === 0 && containerRect.height === 0) return true;
            const elRect = el.getBoundingClientRect();
            // Element has no size yet (not laid out) — hydrate immediately
            if (elRect.width === 0 && elRect.height === 0) return true;
            return elRect.bottom >= containerRect.top - margin &&
                   elRect.top <= containerRect.bottom + margin;
        } catch (_) {
            return true;
        }
    }

    function getLazyHydrationObserver() {
        if (lazyHydrationObserver) return lazyHydrationObserver;
        if (typeof IntersectionObserver !== 'function') return null;

        // On iOS use viewport root — custom root is unreliable in WebKit.
        // On desktop use the scroll container for precision.
        const observerRoot = isIOS ? null : rootElement;

        lazyHydrationObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach((entry) => {
                const target = entry.target;
                if (!(target instanceof HTMLElement)) { observer.unobserve(target); observedLazyMedia.delete(target); return; }
                if (!entry.isIntersecting && entry.intersectionRatio <= 0) return;
                if (target.matches(`${imageSelector}, ${albumImgSelector}`)) {
                    hydrateImage(target);
                } else if (target.matches(`${videoSelector}, ${albumVideoSelector}`)) {
                    hydrateVideo(target);
                }
                observer.unobserve(target);
                observedLazyMedia.delete(target);
            });
        }, {
            root: observerRoot,
            rootMargin: isIOS ? '600px 0px' : '400px 0px',
            threshold: 0,
        });
        return lazyHydrationObserver;
    }

    function disconnectLazyMediaHydrationObserver() {
        if (!lazyHydrationObserver) return;
        lazyHydrationObserver.disconnect();
        lazyHydrationObserver = null;
        observedLazyMedia.clear();
    }

    function observeLazyMediaElement(observer, element) {
        if (!observer || !(element instanceof HTMLElement)) return false;
        if (observedLazyMedia.has(element)) return true;
        observer.observe(element);
        observedLazyMedia.add(element);
        return true;
    }

    function unobserveLazyMediaElement(element) {
        if (!(element instanceof HTMLElement)) return;
        if (lazyHydrationObserver && observedLazyMedia.has(element)) {
            lazyHydrationObserver.unobserve(element);
        }
        observedLazyMedia.delete(element);
    }

    function collectLazyMediaElements(root = rootElement) {
        const allImgSel = `${imageSelector}, ${albumImgSelector}`;
        const allVidSel = `${videoSelector}, ${albumVideoSelector}`;
        const images = [];
        const videos = [];

        if (typeof root?.matches === 'function') {
            if (root.matches(allImgSel)) images.push(root);
            if (root.matches(allVidSel)) videos.push(root);
        }
        if (typeof root?.querySelectorAll === 'function') {
            root.querySelectorAll(allImgSel).forEach((el) => images.push(el));
            root.querySelectorAll(allVidSel).forEach((el) => videos.push(el));
        }

        return { images, videos };
    }

    function registerMediaElementsForLazyHydration(root = rootElement) {
        if (!root) return;

        const { images, videos } = collectLazyMediaElements(root);
        const observer = getLazyHydrationObserver();

        images.forEach((imageEl) => {
            if (!(imageEl instanceof HTMLImageElement)) return;
            if (imageEl.getAttribute('src')) { unobserveLazyMediaElement(imageEl); return; }
            // Hydrate immediately if near viewport; otherwise observe
            if (isNearViewport(imageEl, 600)) {
                unobserveLazyMediaElement(imageEl);
                hydrateImage(imageEl);
            } else if (observer) {
                observeLazyMediaElement(observer, imageEl);
            } else {
                hydrateImage(imageEl);
            }
        });

        videos.forEach((videoEl) => {
            if (!(videoEl instanceof HTMLMediaElement)) return;
            if (videoEl.getAttribute('src')) { unobserveLazyMediaElement(videoEl); return; }
            if (isNearViewport(videoEl, 600)) {
                unobserveLazyMediaElement(videoEl);
                hydrateVideo(videoEl);
            } else if (observer) {
                observeLazyMediaElement(observer, videoEl);
            } else {
                hydrateVideo(videoEl, true);
            }
        });
    }

    function unregisterMediaElementsForLazyHydration(root = rootElement) {
        if (!root) return;
        const { images, videos } = collectLazyMediaElements(root);
        images.forEach(unobserveLazyMediaElement);
        videos.forEach(unobserveLazyMediaElement);
    }

    return {
        ensureMediaElementHydrated,
        disconnectLazyMediaHydrationObserver,
        registerMediaElementsForLazyHydration,
        unregisterMediaElementsForLazyHydration,
    };
}
