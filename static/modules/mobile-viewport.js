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
 * Layout must stay native: `.app` keeps `100dvh`, and the browser/viewport
 * handles keyboard resizing. `visualViewport` is used only to expose the
 * informational `mobile-keyboard-active` class for overlay logic.
 */
export function createVisualViewportCssSyncer(_options = {}) {
    let lastKeyboardActive = null;

    return function syncVisualViewportCssVars() {
        const root = document.documentElement;
        if (!root) return;

        const vv = window.visualViewport;
        const isTouchViewport = isCoarsePointer();
        if (root.style.getPropertyValue('--app-vh') !== '100dvh') {
            root.style.setProperty('--app-vh', '100dvh');
        }
        if (root.style.getPropertyValue('--app-vw') !== '100%') {
            root.style.setProperty('--app-vw', '100%');
        }
        if (root.style.getPropertyValue('--vv-keyboard-inset') !== '0px') {
            root.style.setProperty('--vv-keyboard-inset', '0px');
        }

        // Detection only; this value must not drive layout height on iOS.
        let keyboardActive = false;
        if (vv && isTouchViewport) {
            const vvHeight = roundedPx(vv.height);
            const layoutHeight = roundedPx(window.innerHeight) || vvHeight;
            keyboardActive = layoutHeight > 0 && vvHeight < layoutHeight * 0.85;
        }

        if (keyboardActive !== lastKeyboardActive) {
            lastKeyboardActive = keyboardActive;
            root.classList.toggle('mobile-keyboard-active', keyboardActive);
        }
    };
}
