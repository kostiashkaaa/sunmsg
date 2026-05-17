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
 * Layout stays native while the keyboard is active. With the keyboard closed,
 * iOS Safari can resolve `100dvh` before the bottom browser chrome settles
 * after reload, so the idle app height follows the real visual viewport.
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
        if (vv && isTouchViewport) {
            const vvHeight = roundedPx(vv.height);
            const layoutHeight = roundedPx(window.innerHeight) || vvHeight;
            const vvTop = roundedPx(vv.offsetTop);
            keyboardActive = layoutHeight > 0 && vvHeight < layoutHeight * 0.85;
            keyboardInset = keyboardActive ? Math.max(0, layoutHeight - vvHeight - vvTop) : 0;
            if (!keyboardActive && !composerFocused && vvHeight > 0) {
                nextAppVh = `${vvHeight}px`;
            }
        }
        if (root.style.getPropertyValue('--app-vh') !== nextAppVh) {
            root.style.setProperty('--app-vh', nextAppVh);
        }
        if (root.style.getPropertyValue('--app-vw') !== '100%') {
            root.style.setProperty('--app-vw', '100%');
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
