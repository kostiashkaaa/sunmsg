const DEFAULT_BOTTOM_THRESHOLD_PX = 18;
const DEFAULT_CORRECTION_MIN_DELTA_PX = 2;

function resolveChatScrollContainer(referenceNode) {
    if (!referenceNode?.isConnected) return null;
    const scopedContainer = referenceNode.closest?.('#chatMessages, .chat-messages');
    if (scopedContainer instanceof HTMLElement) return scopedContainer;
    const ownerDocument = referenceNode.ownerDocument || document;
    const globalContainer = ownerDocument.getElementById?.('chatMessages');
    return globalContainer instanceof HTMLElement ? globalContainer : null;
}

function resolveViewportAnchor(scrollContainer) {
    if (!(scrollContainer instanceof HTMLElement)) return null;
    const containerRect = scrollContainer.getBoundingClientRect();
    const containerTop = Number(containerRect.top) || 0;
    const nodes = scrollContainer.querySelectorAll('.message, .chat-day-separator, .day-separator');

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

function captureStableScrollSnapshot(referenceNode, options = {}) {
    const scrollContainer = resolveChatScrollContainer(referenceNode);
    if (!scrollContainer) return null;

    const bottomThresholdPx = Number.isFinite(options.bottomThresholdPx)
        ? Math.max(0, Number(options.bottomThresholdPx))
        : DEFAULT_BOTTOM_THRESHOLD_PX;
    const previousScrollTop = Number(scrollContainer.scrollTop) || 0;
    const previousScrollHeight = Number(scrollContainer.scrollHeight) || 0;
    const previousClientHeight = Number(scrollContainer.clientHeight) || 0;
    const previousBottomDistance = previousScrollHeight - (previousScrollTop + previousClientHeight);
    const referenceRect = referenceNode instanceof Element
        ? referenceNode.getBoundingClientRect()
        : null;
    const containerRect = scrollContainer.getBoundingClientRect();

    return {
        scrollContainer,
        viewportAnchor: resolveViewportAnchor(scrollContainer),
        previousScrollTop,
        previousScrollHeight,
        previousClientHeight,
        wasNearBottom: previousBottomDistance <= bottomThresholdPx,
        referenceNode,
        referenceTop: Number(referenceRect?.top) || 0,
        wasReferenceAboveViewport: Boolean(referenceRect && referenceRect.bottom <= (Number(containerRect.top) || 0) + 1),
        minDeltaPx: Number.isFinite(options.minDeltaPx)
            ? Math.max(0, Number(options.minDeltaPx))
            : DEFAULT_CORRECTION_MIN_DELTA_PX,
    };
}

function setScrollTop(scrollContainer, nextTop) {
    if (!(scrollContainer instanceof HTMLElement)) return;
    const maxScrollTop = Math.max(0, scrollContainer.scrollHeight - scrollContainer.clientHeight);
    const safeTop = Math.max(0, Math.min(maxScrollTop, Number(nextTop) || 0));
    scrollContainer.scrollTop = safeTop;
}

function restoreStableScrollSnapshot(snapshot, options = {}) {
    if (!snapshot?.scrollContainer?.isConnected) return;
    const {
        scrollContainer,
        viewportAnchor,
        previousScrollTop,
        previousScrollHeight,
        referenceNode,
        referenceTop,
        wasReferenceAboveViewport,
        minDeltaPx,
    } = snapshot;
    const pinToBottom = Boolean(options.pinToBottom || snapshot.wasNearBottom);

    if (pinToBottom) {
        setScrollTop(scrollContainer, scrollContainer.scrollHeight);
        return;
    }

    if (viewportAnchor?.element instanceof HTMLElement && viewportAnchor.element.isConnected) {
        const anchorRectAfter = viewportAnchor.element.getBoundingClientRect();
        const anchorDelta = (Number(anchorRectAfter.top) || 0) - (Number(viewportAnchor.top) || 0);
        if (Number.isFinite(anchorDelta) && Math.abs(anchorDelta) >= minDeltaPx) {
            setScrollTop(scrollContainer, previousScrollTop + anchorDelta);
            return;
        }
    }

    if (wasReferenceAboveViewport && referenceNode instanceof Element && referenceNode.isConnected) {
        const referenceRectAfter = referenceNode.getBoundingClientRect();
        const referenceDelta = (Number(referenceRectAfter.top) || 0) - referenceTop;
        if (Number.isFinite(referenceDelta) && Math.abs(referenceDelta) >= minDeltaPx) {
            setScrollTop(scrollContainer, previousScrollTop + referenceDelta);
            return;
        }
    }

    const heightDelta = (Number(scrollContainer.scrollHeight) || 0) - previousScrollHeight;
    if (Math.abs(heightDelta) >= minDeltaPx && wasReferenceAboveViewport) {
        setScrollTop(scrollContainer, previousScrollTop + heightDelta);
    }
}

export function withStableChatScroll(referenceNode, mutateFn, options = {}) {
    if (typeof mutateFn !== 'function') return undefined;
    const snapshot = captureStableScrollSnapshot(referenceNode, options);
    if (!snapshot) return mutateFn();

    let result;
    try {
        result = mutateFn();
    } finally {
        restoreStableScrollSnapshot(snapshot, options);
        const frameHost = referenceNode?.ownerDocument?.defaultView || globalThis;
        const requestFrame = frameHost.requestAnimationFrame || ((handler) => frameHost.setTimeout(handler, 16));
        requestFrame(() => restoreStableScrollSnapshot(snapshot, options));
    }
    return result;
}
