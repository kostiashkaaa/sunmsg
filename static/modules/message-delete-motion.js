export function createMessageDeleteMotionController({
    getChatMessages = () => null,
    setTimeoutFn = (handler, delay) => window.setTimeout(handler, delay),
    requestAnimationFrameFn = (handler) => (
        globalThis.requestAnimationFrame
            ? globalThis.requestAnimationFrame(handler)
            : setTimeoutFn(handler, 16)
    ),
    removalAnimationMs = 180,
} = {}) {
    let deleteMotionSeq = 0;

    const normalizeDomRect = (rect) => {
        if (!rect) return null;
        const top = Number(rect.top);
        const left = Number.isFinite(Number(rect.left)) ? Number(rect.left) : 0;
        const bottom = Number(rect.bottom);
        const width = Number.isFinite(Number(rect.width)) ? Number(rect.width) : 1;
        const height = Number.isFinite(Number(rect.height))
            ? Number(rect.height)
            : bottom - top;
        if (![top, left, width, height].every((value) => Number.isFinite(value))) return null;
        if (width <= 0 || height <= 0) return null;
        return {
            top,
            left,
            width,
            height,
            bottom: Number.isFinite(bottom) ? bottom : top + height,
        };
    };

    const captureDeleteRenderState = (deletedIds) => {
        const chatMessages = getChatMessages();
        if (!chatMessages || typeof chatMessages.querySelectorAll !== 'function') return null;
        const containerRect = normalizeDomRect(chatMessages.getBoundingClientRect?.());
        const messages = Array.from(chatMessages.querySelectorAll('.message[data-message-key]'));
        let anchor = null;
        const motion = {
            removed: [],
            survivors: new Map(),
        };

        messages.forEach((node) => {
            const msgId = Number(node.getAttribute?.('data-msg-id'));
            const rect = normalizeDomRect(node.getBoundingClientRect?.());
            if (!rect) return;
            const isVisible = !containerRect || (rect.bottom > containerRect.top && rect.top < containerRect.bottom);
            if (!isVisible) return;
            if (deletedIds.has(msgId)) {
                motion.removed.push({ node, rect });
                return;
            }

            const anchorMessageKey = String(node.getAttribute?.('data-message-key') || '').trim();
            if (!anchorMessageKey) return;
            if (!motion.survivors.has(anchorMessageKey)) {
                motion.survivors.set(anchorMessageKey, rect);
            }
            if (!anchor && containerRect) {
                anchor = {
                    anchorMessageKey,
                    anchorOffsetTop: rect.top - containerRect.top,
                };
            }
        });

        return { anchor, motion };
    };

    const createDeletedMessageGhost = ({ node, rect }) => {
        const chatMessages = getChatMessages();
        const ownerDocument = chatMessages?.ownerDocument || node?.ownerDocument || globalThis.document;
        if (!ownerDocument?.body || typeof node?.cloneNode !== 'function') return null;

        const ghost = node.cloneNode(true);
        ghost.classList?.add?.('message-delete-ghost');
        ghost.removeAttribute?.('data-msg-id');
        ghost.removeAttribute?.('data-message-key');
        ghost.removeAttribute?.('data-client-id');
        ghost.setAttribute?.('aria-hidden', 'true');
        Object.assign(ghost.style, {
            position: 'fixed',
            left: `${rect.left}px`,
            top: `${rect.top}px`,
            width: `${rect.width}px`,
            margin: '0',
            pointerEvents: 'none',
            zIndex: '80',
            opacity: '1',
            transform: 'translate3d(0, 0, 0) scale(1)',
            transformOrigin: node.classList?.contains?.('self') ? 'right bottom' : 'left bottom',
            transition: `opacity ${removalAnimationMs}ms var(--ease-quick, cubic-bezier(.4, 0, .2, 1)), transform ${removalAnimationMs}ms var(--ease-quick, cubic-bezier(.4, 0, .2, 1))`,
            willChange: 'opacity, transform',
            contain: 'layout paint',
            maxWidth: 'none',
        });
        ownerDocument.body.appendChild(ghost);
        return ghost;
    };

    const animateDeletedMessageGhosts = (removed = []) => {
        const ghosts = removed
            .map((entry) => createDeletedMessageGhost(entry))
            .filter(Boolean);
        if (!ghosts.length) return;

        requestAnimationFrameFn(() => {
            ghosts.forEach((ghost) => {
                ghost.style.opacity = '0';
                ghost.style.transform = 'translate3d(0, -6px, 0) scale(0.97)';
            });
        });
        setTimeoutFn(() => {
            ghosts.forEach((ghost) => ghost.remove?.());
        }, removalAnimationMs + 60);
    };

    const animateSurvivingMessageMoves = (survivors) => {
        const chatMessages = getChatMessages();
        if (!chatMessages || !survivors?.size || typeof chatMessages.querySelectorAll !== 'function') return;

        const moved = [];
        Array.from(chatMessages.querySelectorAll('.message[data-message-key]')).forEach((node) => {
            const key = String(node.getAttribute?.('data-message-key') || '').trim();
            const before = key ? survivors.get(key) : null;
            if (!before || !node?.style) return;
            const after = normalizeDomRect(node.getBoundingClientRect?.());
            if (!after) return;
            const deltaX = before.left - after.left;
            const deltaY = before.top - after.top;
            if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) return;

            moved.push({
                node,
                previousTransition: node.style.transition || '',
                previousTransform: node.style.transform || '',
                previousWillChange: node.style.willChange || '',
                deltaX,
                deltaY,
            });
        });
        if (!moved.length) return;

        const motionToken = String(++deleteMotionSeq);
        moved.forEach(({ node, deltaX, deltaY }) => {
            if (node.dataset) node.dataset.deleteMotionToken = motionToken;
            node.style.transition = 'none';
            node.style.transform = `translate3d(${deltaX.toFixed(2)}px, ${deltaY.toFixed(2)}px, 0)`;
            node.style.willChange = 'transform';
        });
        requestAnimationFrameFn(() => {
            moved.forEach(({ node }) => {
                node.style.transition = `transform ${removalAnimationMs}ms var(--ease-quick, cubic-bezier(.4, 0, .2, 1))`;
                node.style.transform = '';
            });
            setTimeoutFn(() => {
                moved.forEach(({ node, previousTransition, previousTransform, previousWillChange }) => {
                    if (node.dataset?.deleteMotionToken && node.dataset.deleteMotionToken !== motionToken) return;
                    if (node.dataset?.deleteMotionToken === motionToken) {
                        delete node.dataset.deleteMotionToken;
                    }
                    node.style.transition = previousTransition;
                    node.style.transform = previousTransform;
                    node.style.willChange = previousWillChange;
                });
            }, removalAnimationMs + 60);
        });
    };

    const runDeleteMotion = (motion) => {
        if (!motion) return;
        animateDeletedMessageGhosts(motion.removed);
        animateSurvivingMessageMoves(motion.survivors);
    };

    return {
        captureDeleteRenderState,
        runDeleteMotion,
    };
}
