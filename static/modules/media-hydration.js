export function createMediaHydrationController(options = {}) {
    const rootElement = options?.root || null;
    const videoSelector = '.file-msg-video-preview[data-src]';
    const imageSelector = '.file-msg-img[data-src]';
    const albumImgSelector = '.album-cell-img[data-src]';
    const albumVideoSelector = '.album-cell-video[data-src]';
    let lazyHydrationObserver = null;

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

    function assignHydratedSource(element, resolvedSrc) {
        if (!(element instanceof HTMLElement)) return;
        const currentSrc = String(element.getAttribute('src') || '').trim();
        if (currentSrc) return;
        element.setAttribute('src', resolvedSrc);
    }

    function markAlbumCellLoaded(mediaEl) {
        const cell = mediaEl.closest('.album-cell');
        if (!cell) return;
        if (!cell.classList.contains('is-loaded')) {
            cell.classList.add('is-loaded');
        }
        mediaEl.classList.add('is-loaded');
    }

    function wireAlbumCellLoadEvent(mediaEl) {
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

    function ensureMediaElementHydrated(mediaEl, hydrateOptions = {}) {
        if (!(mediaEl instanceof HTMLMediaElement)) return false;
        const isAlbumVideo = mediaEl.classList.contains('album-cell-video');
        const isVideo = isAlbumVideo || mediaEl.classList.contains('file-msg-video-preview');
        const isAudio = mediaEl.classList.contains('file-msg-audio-el');
        if (!isVideo && !isAudio) return false;

        const dataSrc = String(mediaEl.getAttribute('data-src') || '').trim();
        if (!dataSrc) return false;

        const currentSrc = String(mediaEl.getAttribute('src') || '').trim();
        if (currentSrc) return true;

        const force = Boolean(hydrateOptions.force);
        if (isAudio && !force) return false;
        if (isAudio) {
            mediaEl.setAttribute('src', dataSrc);
            return true;
        }

        if (isVideo) {
            mediaEl.setAttribute('preload', force ? 'auto' : 'metadata');
            mediaEl.removeAttribute('data-loaded');
            if (!isAlbumVideo) {
                const mediaWrap = mediaEl.closest('.image-wrapper, .video-preview');
                mediaWrap?.classList.remove('is-loaded');
            }
        }

        if (isAlbumVideo) {
            wireAlbumCellLoadEvent(mediaEl);
        }

        resolveHydratedSource(dataSrc, resolveMediaKindByElement(mediaEl))
            .then((resolvedSrc) => {
                assignHydratedSource(mediaEl, resolvedSrc);
            })
            .catch(() => {
                assignHydratedSource(mediaEl, dataSrc);
            });
        return true;
    }

    function ensureImageElementHydrated(imageEl) {
        if (!(imageEl instanceof HTMLImageElement)) return false;
        const dataSrc = String(imageEl.getAttribute('data-src') || '').trim();
        if (!dataSrc) return false;
        const currentSrc = String(imageEl.getAttribute('src') || '').trim();
        if (currentSrc) return true;

        const isAlbumImg = imageEl.classList.contains('album-cell-img');
        if (isAlbumImg) {
            wireAlbumCellLoadEvent(imageEl);
        }

        resolveHydratedSource(dataSrc, resolveMediaKindByElement(imageEl))
            .then((resolvedSrc) => {
                assignHydratedSource(imageEl, resolvedSrc);
            })
            .catch(() => {
                assignHydratedSource(imageEl, dataSrc);
            });
        return true;
    }

    function getLazyHydrationObserver() {
        if (lazyHydrationObserver) return lazyHydrationObserver;
        if (typeof IntersectionObserver !== 'function' || !rootElement) return null;

        const allImageSelectors = `${imageSelector}, ${albumImgSelector}`;
        const allVideoSelectors = `${videoSelector}, ${albumVideoSelector}`;

        lazyHydrationObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach((entry) => {
                const target = entry.target;
                if (!(target instanceof HTMLElement)) {
                    observer.unobserve(target);
                    return;
                }
                if (!entry.isIntersecting && entry.intersectionRatio <= 0) return;
                if (target.matches(allImageSelectors)) {
                    ensureImageElementHydrated(target);
                } else if (target.matches(allVideoSelectors)) {
                    ensureMediaElementHydrated(target);
                }
                observer.unobserve(target);
            });
        }, {
            root: rootElement,
            rootMargin: '300px 0px',
            threshold: 0.01,
        });
        return lazyHydrationObserver;
    }

    function disconnectLazyMediaHydrationObserver() {
        if (!lazyHydrationObserver) return;
        lazyHydrationObserver.disconnect();
        lazyHydrationObserver = null;
    }

    function registerMediaElementsForLazyHydration(root = rootElement) {
        if (!root) return;

        const videos = [];
        const images = [];

        const addIfMatches = (el, sel, arr) => {
            if (typeof el.matches === 'function' && el.matches(sel)) arr.push(el);
        };

        if (typeof root.matches === 'function') {
            addIfMatches(root, videoSelector, videos);
            addIfMatches(root, albumVideoSelector, videos);
            addIfMatches(root, imageSelector, images);
            addIfMatches(root, albumImgSelector, images);
        }
        if (typeof root.querySelectorAll === 'function') {
            root.querySelectorAll(`${videoSelector}, ${albumVideoSelector}`).forEach((el) => videos.push(el));
            root.querySelectorAll(`${imageSelector}, ${albumImgSelector}`).forEach((el) => images.push(el));
        }

        const observer = getLazyHydrationObserver();
        videos.forEach((videoEl) => {
            if (!(videoEl instanceof HTMLMediaElement)) return;
            if (videoEl.getAttribute('src')) return;
            if (observer) {
                observer.observe(videoEl);
            } else {
                ensureMediaElementHydrated(videoEl, { force: true });
            }
        });

        images.forEach((imageEl) => {
            if (!(imageEl instanceof HTMLImageElement)) return;
            if (imageEl.getAttribute('src')) return;
            if (observer) {
                observer.observe(imageEl);
            } else {
                ensureImageElementHydrated(imageEl);
            }
        });
    }

    return {
        ensureMediaElementHydrated,
        disconnectLazyMediaHydrationObserver,
        registerMediaElementsForLazyHydration,
    };
}
