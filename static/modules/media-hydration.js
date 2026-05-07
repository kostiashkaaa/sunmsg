export function createMediaHydrationController(options = {}) {
    const rootElement = options?.root || null;
    const videoSelector = '.file-msg-video-preview[data-src]';
    let lazyVideoHydrationObserver = null;

    function ensureMediaElementHydrated(mediaEl, hydrateOptions = {}) {
        if (!(mediaEl instanceof HTMLMediaElement)) return false;
        const isVideo = mediaEl.classList.contains('file-msg-video-preview');
        const isAudio = mediaEl.classList.contains('file-msg-audio-el');
        if (!isVideo && !isAudio) return false;

        const dataSrc = String(mediaEl.getAttribute('data-src') || '').trim();
        if (!dataSrc) return false;

        const currentSrc = String(mediaEl.getAttribute('src') || '').trim();
        if (currentSrc === dataSrc) return true;

        const force = Boolean(hydrateOptions.force);
        if (isAudio && !force) return false;

        mediaEl.setAttribute('src', dataSrc);
        if (isVideo) {
            mediaEl.setAttribute('preload', force ? 'auto' : 'metadata');
            mediaEl.removeAttribute('data-loaded');
            const mediaWrap = mediaEl.closest('.image-wrapper, .video-preview');
            mediaWrap?.classList.remove('is-loaded');
        }
        return true;
    }

    function getLazyVideoHydrationObserver() {
        if (lazyVideoHydrationObserver) return lazyVideoHydrationObserver;
        if (typeof IntersectionObserver !== 'function' || !rootElement) return null;

        lazyVideoHydrationObserver = new IntersectionObserver((entries, observer) => {
            entries.forEach((entry) => {
                const target = entry.target;
                if (!(target instanceof HTMLMediaElement)) {
                    observer.unobserve(target);
                    return;
                }
                if (!entry.isIntersecting && entry.intersectionRatio <= 0) return;
                ensureMediaElementHydrated(target);
                observer.unobserve(target);
            });
        }, {
            root: rootElement,
            rootMargin: '280px 0px',
            threshold: 0.01,
        });
        return lazyVideoHydrationObserver;
    }

    function disconnectLazyMediaHydrationObserver() {
        if (!lazyVideoHydrationObserver) return;
        lazyVideoHydrationObserver.disconnect();
    }

    function registerMediaElementsForLazyHydration(root = rootElement) {
        if (!root) return;

        const videos = [];
        if (typeof root.matches === 'function' && root.matches(videoSelector)) {
            videos.push(root);
        }
        if (typeof root.querySelectorAll === 'function') {
            root.querySelectorAll(videoSelector).forEach((el) => videos.push(el));
        }

        const observer = getLazyVideoHydrationObserver();
        videos.forEach((videoEl) => {
            if (!(videoEl instanceof HTMLMediaElement)) return;
            if (videoEl.getAttribute('src')) return;
            if (observer) {
                observer.observe(videoEl);
            } else {
                ensureMediaElementHydrated(videoEl, { force: true });
            }
        });
    }

    return {
        ensureMediaElementHydrated,
        disconnectLazyMediaHydrationObserver,
        registerMediaElementsForLazyHydration,
    };
}
