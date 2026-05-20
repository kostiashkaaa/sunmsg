function getTouchDistance(t1, t2) {
    const dx = t1.clientX - t2.clientX;
    const dy = t1.clientY - t2.clientY;
    return Math.hypot(dx, dy);
}

function getTouchCenter(t1, t2) {
    return {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2,
    };
}

export function bindLightboxGestures(ctx) {
    const {
        els,
        state,
        isOpen,
        isImageActive,
        setZoom,
        applyTransform,
        goNext,
        goPrev,
        showZoomPanel,
        hideZoomPanel,
        clearZoomHideTimer,
        showOverlay,
        close,
    } = ctx;

    els.zoomToggle?.addEventListener('click', (e) => {
        if (!isImageActive()) return;
        e.stopPropagation();
        const isVisible = !!els.zoomPanel?.classList.contains('is-visible');
        if (isVisible && state.zoom <= 1.02) {
            hideZoomPanel(true);
            return;
        }
        showZoomPanel();
    });

    els.zoomIn?.addEventListener('click', (e) => {
        if (!isImageActive()) return;
        e.stopPropagation();
        setZoom(state.zoom + 0.15, true, 'panel');
    });

    els.zoomOut?.addEventListener('click', (e) => {
        if (!isImageActive()) return;
        e.stopPropagation();
        setZoom(state.zoom - 0.15, true, 'panel');
    });

    els.zoomRange?.addEventListener('input', (e) => {
        if (!isImageActive()) return;
        const value = Number(e.target.value);
        if (!Number.isFinite(value)) return;
        setZoom(value, value > 1.001, 'panel');
    });

    els.root?.addEventListener('wheel', (e) => {
        if (!isOpen() || !isImageActive() || !e.ctrlKey) return;
        e.preventDefault();
        const step = e.deltaY < 0 ? 0.12 : -0.12;
        const viewportRect = els.root?.getBoundingClientRect();
        const focalPoint = viewportRect
            ? {
                x: Math.max(viewportRect.left, Math.min(viewportRect.right, e.clientX)),
                y: Math.max(viewportRect.top, Math.min(viewportRect.bottom, e.clientY)),
            }
            : null;
        setZoom(state.zoom + step, true, 'wheel', focalPoint);
    }, { passive: false });

    els.zoomPanel?.addEventListener('pointerenter', () => clearZoomHideTimer());
    els.zoomPanel?.addEventListener('pointerleave', () => hideZoomPanel(false));

    els.img?.addEventListener('dblclick', (e) => {
        if (!isImageActive()) return;
        e.preventDefault();
        setZoom(state.zoom > 1.02 ? 1 : 2.3, true, 'dblclick', { x: e.clientX, y: e.clientY });
    });

    els.main?.addEventListener('mousedown', (e) => {
        if (!isOpen() || !isImageActive() || state.zoom <= 1.02 || e.button !== 0) return;
        e.preventDefault();
        state.dragging = true;
        state.dragStartX = e.clientX;
        state.dragStartY = e.clientY;
        state.dragPanX = state.panX;
        state.dragPanY = state.panY;
        applyTransform();
    });

    document.addEventListener('mousemove', (e) => {
        if (!isOpen() || !isImageActive() || !state.dragging) return;
        state.panX = state.dragPanX + (e.clientX - state.dragStartX);
        state.panY = state.dragPanY + (e.clientY - state.dragStartY);
        applyTransform();
    });

    document.addEventListener('mouseup', () => {
        if (!state.dragging) return;
        state.dragging = false;
        applyTransform();
    });

    els.main?.addEventListener('touchstart', (e) => {
        if (!isOpen() || !isImageActive()) return;
        showOverlay();
        if (e.touches.length === 2) {
            const [t1, t2] = e.touches;
            const center = getTouchCenter(t1, t2);
            state.touchMode = 'pinch';
            state.pinchStartDistance = getTouchDistance(t1, t2);
            state.pinchStartZoom = state.zoom;
            state.pinchStartCenterX = center.x;
            state.pinchStartCenterY = center.y;
            state.pinchStartPanX = state.panX;
            state.pinchStartPanY = state.panY;
            return;
        }
        if (e.touches.length === 1) {
            const t = e.touches[0];
            state.touchStartX = t.clientX;
            state.touchStartY = t.clientY;
            state.dragPanX = state.panX;
            state.dragPanY = state.panY;
            state.touchMode = state.zoom > 1.02 ? 'pan' : 'swipe';
        }
    }, { passive: true });

    els.main?.addEventListener('touchmove', (e) => {
        if (!isOpen() || !isImageActive()) return;
        if (state.touchMode === 'pinch' && e.touches.length === 2) {
            e.preventDefault();
            const [t1, t2] = e.touches;
            const dist = getTouchDistance(t1, t2);
            const center = getTouchCenter(t1, t2);
            if (state.pinchStartDistance > 0) {
                setZoom(state.pinchStartZoom * (dist / state.pinchStartDistance), true, 'pinch', center);
            }
            state.panX += (center.x - state.pinchStartCenterX);
            state.panY += (center.y - state.pinchStartCenterY);
            state.pinchStartCenterX = center.x;
            state.pinchStartCenterY = center.y;
            applyTransform();
            return;
        }
        if (state.touchMode === 'pan' && e.touches.length === 1) {
            e.preventDefault();
            const t = e.touches[0];
            state.panX = state.dragPanX + (t.clientX - state.touchStartX);
            state.panY = state.dragPanY + (t.clientY - state.touchStartY);
            applyTransform();
        }
    }, { passive: false });

    els.main?.addEventListener('touchend', (e) => {
        if (!isOpen() || !isImageActive()) return;
        if (state.touchMode === 'swipe') {
            const t = e.changedTouches[0];
            if (t) {
                const dx = t.clientX - state.touchStartX;
                const dy = t.clientY - state.touchStartY;
                if (state.zoom <= 1.02 && dy > 72 && Math.abs(dx) < 52) {
                    close?.();
                    return;
                }
                if (Math.abs(dx) > 42 && Math.abs(dy) < 36) {
                    if (dx < 0) goNext();
                    if (dx > 0) goPrev();
                }
            }
        }
        if (e.touches.length === 0) state.touchMode = '';
    }, { passive: true });
}
