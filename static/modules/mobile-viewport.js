function roundedPx(value) {
    return Math.max(0, Math.round(Number(value) || 0));
}

function isCoarsePointer() {
    return Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
}

/**
 * Keyboard / viewport syncer.
 *
 * Keyboard state syncer.
 *
 * Layout height follows the real visual viewport on touch devices. This keeps
 * the chat flex column tied to the visible area whether the browser resizes
 * content for the keyboard or overlays the keyboard above the layout viewport.
 */
export function createVisualViewportCssSyncer(_options = {}) {
    let lastKeyboardActive = null;

    return function syncVisualViewportCssVars() {
        const root = document.documentElement;
        if (!root) return;

        const vv = window.visualViewport;
        const isTouchViewport = isCoarsePointer();
        const activeElement = document.activeElement;
        const composerFocused = Boolean(
            activeElement
            && activeElement !== document.body
            && activeElement.closest?.('#messageForm, #composerRow')
        );
        let keyboardActive = false;
        let keyboardInset = 0;
        let nextAppVh = '100dvh';
        let nextViewportTop = '0px';
        let nextViewportLeft = '0px';
        if (vv && isTouchViewport) {
            const vvHeight = roundedPx(vv.height);
            const layoutHeight = roundedPx(window.innerHeight) || vvHeight;
            const vvTop = roundedPx(vv.offsetTop);
            const vvLeft = roundedPx(vv.offsetLeft);
            if (vvHeight > 0) {
                nextAppVh = `${vvHeight}px`;
            }
            nextViewportTop = `${vvTop}px`;
            nextViewportLeft = `${vvLeft}px`;
            const keyboardInsetCandidate = Math.max(0, layoutHeight - vvHeight - vvTop);
            const minKeyboardInset = Math.max(160, Math.round(layoutHeight * 0.22));
            const keyboardGeometryActive = layoutHeight > 0 && vvHeight < layoutHeight * 0.85;
            // Safari browser chrome can also shrink visualViewport; require the larger real-keyboard inset.
            keyboardActive = composerFocused && keyboardGeometryActive && keyboardInsetCandidate >= minKeyboardInset;
            keyboardInset = keyboardActive ? keyboardInsetCandidate : 0;
        }
        if (root.style.getPropertyValue('--app-vh') !== nextAppVh) {
            root.style.setProperty('--app-vh', nextAppVh);
        }
        if (root.style.getPropertyValue('--app-vw') !== '100%') {
            root.style.setProperty('--app-vw', '100%');
        }
        if (root.style.getPropertyValue('--vv-top-offset') !== nextViewportTop) {
            root.style.setProperty('--vv-top-offset', nextViewportTop);
        }
        if (root.style.getPropertyValue('--vv-left-offset') !== nextViewportLeft) {
            root.style.setProperty('--vv-left-offset', nextViewportLeft);
        }
        const nextKeyboardInset = `${keyboardInset}px`;
        if (root.style.getPropertyValue('--vv-keyboard-inset') !== nextKeyboardInset) {
            root.style.setProperty('--vv-keyboard-inset', nextKeyboardInset);
        }

        if (keyboardActive !== lastKeyboardActive) {
            lastKeyboardActive = keyboardActive;
            root.classList.toggle('mobile-keyboard-active', keyboardActive);
        }
    };
}
