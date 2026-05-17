function roundedPx(value) {
    return Math.max(0, Math.round(Number(value) || 0));
}

function isCoarsePointer() {
    return Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
}

/**
 * Keyboard / viewport syncer.
 *
 * Most mobile browsers shrink `100dvh` when the keyboard opens, but overlay
 * keyboards still report the full layout viewport. While the composer is
 * focused, use `visualViewport.height` as the app height so the input row stays
 * above the real keyboard instead of trusting CSS viewport units alone.
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
        const keyboardHandoff = root.classList.contains('mobile-emoji-keyboard-handoff');

        // With resizes-content, visualViewport and innerHeight stay close; with
        // overlay keyboards, visualViewport is the only reliable visible height.
        let keyboardActive = false;
        let keyboardInset = 0;
        let nextAppVh = '100dvh';
        if (vv && isTouchViewport) {
            const vvHeight = roundedPx(vv.height);
            const layoutHeight = roundedPx(window.innerHeight) || vvHeight;
            const vvTop = roundedPx(vv.offsetTop);
            keyboardActive = layoutHeight > 0 && vvHeight < layoutHeight * 0.85;
            keyboardInset = Math.max(0, layoutHeight - vvHeight - vvTop);
            if ((keyboardActive || composerFocused || keyboardHandoff) && vvHeight > 0) {
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
