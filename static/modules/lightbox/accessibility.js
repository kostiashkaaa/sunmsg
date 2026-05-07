export function bindLightboxAccessibility(ctx) {
    const {
        els,
        isOpen,
        isImageActive,
        showOverlay,
        close,
        goPrev,
        goNext,
        toggleVideoPlay,
        setZoom,
        getZoom,
        updateBottomInset,
        applyTransform,
    } = ctx;

    els.root?.addEventListener('mousemove', () => {
        if (isOpen()) showOverlay();
    });
    els.root?.addEventListener('touchstart', () => {
        if (isOpen()) showOverlay();
    }, { passive: true });

    els.videoWrap?.addEventListener('mousemove', () => {
        if (!isOpen() || isImageActive()) return;
        showOverlay();
    });

    document.addEventListener('keydown', (e) => {
        if (!isOpen()) return;
        showOverlay();
        if (e.key === 'Escape') {
            close();
            return;
        }
        if (e.key === 'ArrowLeft') {
            goPrev();
            return;
        }
        if (e.key === 'ArrowRight') {
            goNext();
            return;
        }
        if (!isImageActive() && (e.key === ' ' || e.code === 'Space')) {
            e.preventDefault();
            toggleVideoPlay();
            return;
        }
        if (e.key === '+' || e.key === '=') {
            if (isImageActive()) setZoom(getZoom() + 0.15, true, 'key');
            return;
        }
        if (e.key === '-') {
            if (isImageActive()) setZoom(getZoom() - 0.15, true, 'key');
        }
    });

    window.addEventListener('resize', () => {
        if (!isOpen()) return;
        updateBottomInset();
        applyTransform();
    });
}