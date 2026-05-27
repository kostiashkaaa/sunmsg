function roundedPx(value) {
    return Math.max(0, Math.round(Number(value) || 0));
}

function isCoarsePointer() {
    return Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
}

const KEYBOARD_RELEASE_LOCK_MS = 420;

/**
 * Keyboard / viewport syncer.
 *
 * Keyboard state syncer.
 *
 * Layout height follows the real visual viewport only while the composer is
 * interacting with the native keyboard. Passive browser chrome resize events
 * keep the 100dvh fallback so ordinary scrolling cannot resize the chat shell.
 */
export function createVisualViewportCssSyncer(_options = {}) {
    let lastKeyboardActive = null;
    let keyboardReleaseUntil = 0;

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
            nextViewportTop = `${vvTop}px`;
            nextViewportLeft = `${vvLeft}px`;
            const keyboardInsetCandidate = Math.max(0, layoutHeight - vvHeight - vvTop);
            const minKeyboardInset = Math.max(160, Math.round(layoutHeight * 0.22));
            const keyboardGeometryActive = layoutHeight > 0 && vvHeight < layoutHeight * 0.85;
            const composerViewportActive = composerFocused && vvHeight > 0;
            // iOS can resize window.innerHeight together with visualViewport while
            // the keyboard is open, which makes the inset candidate 0. The app
            // height still has to follow visualViewport whenever the composer is
            // focused; the inset var remains geometry-only for consumers that
            // need a real keyboard offset.
            keyboardActive = composerViewportActive && (
                keyboardGeometryActive
                    ? keyboardInsetCandidate >= minKeyboardInset
                    : true
            );
            keyboardInset = keyboardGeometryActive && keyboardInsetCandidate >= minKeyboardInset
                ? keyboardInsetCandidate
                : 0;
            const keyboardHandoffActive = root.classList.contains('mobile-emoji-keyboard-handoff');
            const wasKeyboardActive = root.classList.contains('mobile-keyboard-active');
            const now = Date.now();
            if (keyboardActive) {
                keyboardReleaseUntil = 0;
            } else if (wasKeyboardActive || lastKeyboardActive === true || keyboardReleaseUntil > now) {
                keyboardReleaseUntil = Math.max(keyboardReleaseUntil, now + KEYBOARD_RELEASE_LOCK_MS);
            }
            const keyboardReleaseActive = keyboardReleaseUntil > now;
            const shouldUseVisualViewportHeight = Boolean(
                vvHeight > 0
                && (composerViewportActive || keyboardActive || keyboardReleaseActive || keyboardHandoffActive || wasKeyboardActive)
            );
            if (shouldUseVisualViewportHeight) {
                nextAppVh = `${vvHeight}px`;
            }
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
