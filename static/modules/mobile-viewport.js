function roundedPx(value) {
    return Math.max(0, Math.round(Number(value) || 0));
}

function isCoarsePointer() {
    return Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
}

/**
 * Keyboard / viewport syncer.
 *
 * The chat layout now relies on the native browser behaviour
 * `interactive-widget=resizes-content`: when the on-screen keyboard opens the
 * browser itself shrinks the layout viewport (and therefore `100dvh`), so the
 * `position:fixed` app shell and the `position:absolute` composer naturally
 * sit above the keyboard with NO JavaScript driving their size.
 *
 * Because of that this syncer no longer writes `--app-vh`, `--app-vw`,
 * viewport offsets or any keyboard-inset variable — doing so was exactly what
 * caused the composer to jump while JS chased delayed `visualViewport` resize
 * events.
 *
 * It now only:
 *   1. keeps `--app-vh` / `--app-vw` pointing at `100dvh` / `100%` as a static
 *      fallback for browsers without `dvh` support;
 *   2. toggles the `mobile-keyboard-active` class, which the rest of the JS
 *      still reads for focus / overlay logic (it does not affect layout).
 */
export function createVisualViewportCssSyncer(_options = {}) {
    let lastKeyboardActive = null;

    return function syncVisualViewportCssVars() {
        const root = document.documentElement;
        if (!root) return;

        // Static fallback values — layout itself is handled natively by the
        // browser via 100dvh + interactive-widget=resizes-content.
        if (root.style.getPropertyValue('--app-vh') !== '100dvh') {
            root.style.setProperty('--app-vh', '100dvh');
        }
        if (root.style.getPropertyValue('--app-vw') !== '100%') {
            root.style.setProperty('--app-vw', '100%');
        }

        const vv = window.visualViewport;
        const isTouchViewport = isCoarsePointer();

        // Keyboard detection: compare the visual viewport height against the
        // layout viewport. With resizes-content the two stay close, so we use a
        // soft threshold purely to set the informational class — never layout.
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
