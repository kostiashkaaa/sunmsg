const DRAG_THRESHOLD_PX = 6;

export function initHorizontalDragScroll(element) {
    if (!(element instanceof HTMLElement)) return null;

    let state = null;
    let suppressClick = false;
    let suppressClickTimer = 0;

    function hasOverflow() {
        return element.scrollWidth > element.clientWidth + 1;
    }

    function clearState() {
        const wasDragging = Boolean(state?.dragging);
        if (state?.dragging) {
            element.classList.remove('is-drag-scrolling');
        }
        if (state?.captured) {
            try {
                element.releasePointerCapture(state.pointerId);
            } catch (_) {}
        }
        state = null;
        if (wasDragging) {
            globalThis.clearTimeout?.(suppressClickTimer);
            suppressClickTimer = globalThis.setTimeout?.(() => {
                suppressClick = false;
                suppressClickTimer = 0;
            }, 350) || 0;
        }
    }

    function onPointerDown(event) {
        if (!event.isPrimary || !hasOverflow()) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;

        state = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            startScrollLeft: element.scrollLeft,
            dragging: false,
            captured: false,
        };
    }

    function capturePointer() {
        if (!state || state.captured) return;
        try {
            element.setPointerCapture(state.pointerId);
            state.captured = true;
        } catch (_) {}
    }

    function onPointerMove(event) {
        if (!state || event.pointerId !== state.pointerId) return;

        const deltaX = event.clientX - state.startX;
        const deltaY = event.clientY - state.startY;
        const absX = Math.abs(deltaX);
        const absY = Math.abs(deltaY);

        if (!state.dragging) {
            if (absX < DRAG_THRESHOLD_PX && absY < DRAG_THRESHOLD_PX) return;
            if (absY > absX) {
                clearState();
                return;
            }
            state.dragging = true;
            suppressClick = true;
            element.classList.add('is-drag-scrolling');
            capturePointer();
        }

        element.scrollLeft = state.startScrollLeft - deltaX;
        if (event.cancelable) event.preventDefault();
    }

    function onClick(event) {
        if (!suppressClick) return;
        suppressClick = false;
        globalThis.clearTimeout?.(suppressClickTimer);
        suppressClickTimer = 0;
        event.preventDefault();
        event.stopImmediatePropagation();
    }

    element.addEventListener('pointerdown', onPointerDown);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', clearState);
    element.addEventListener('pointercancel', clearState);
    element.addEventListener('lostpointercapture', clearState);
    element.addEventListener('click', onClick, true);

    return {
        destroy() {
            clearState();
            suppressClick = false;
            globalThis.clearTimeout?.(suppressClickTimer);
            suppressClickTimer = 0;
            element.removeEventListener('pointerdown', onPointerDown);
            element.removeEventListener('pointermove', onPointerMove);
            element.removeEventListener('pointerup', clearState);
            element.removeEventListener('pointercancel', clearState);
            element.removeEventListener('lostpointercapture', clearState);
            element.removeEventListener('click', onClick, true);
        },
    };
}
