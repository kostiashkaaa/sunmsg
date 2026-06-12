// focus-trap.js — keyboard focus trap for modals/drawers (stack-based)

const _trapStack = [];

function _focusableInside(container) {
    if (!container) return [];
    const selector = [
        'a[href]',
        'button:not([disabled])',
        'input:not([disabled])',
        'textarea:not([disabled])',
        'select:not([disabled])',
        '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    return Array.from(container.querySelectorAll(selector)).filter(el => {
        if (!(el instanceof HTMLElement)) return false;
        return el.offsetParent !== null && getComputedStyle(el).visibility !== 'hidden';
    });
}

function _isContainerHidden(container) {
    if (!container) return true;
    if (container.hidden) return true;
    if (container.getAttribute('aria-hidden') === 'true') return true;
    const style = getComputedStyle(container);
    return style.display === 'none' || style.visibility === 'hidden';
}

export function activateFocusTrap(container) {
    if (!container) return;

    // Pause the current top trap (not removed — restored on deactivate)
    const top = _trapStack[_trapStack.length - 1];
    if (top) {
        document.removeEventListener('keydown', top.keyHandler, true);
    }

    const previouslyFocused = document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const keyHandler = (e) => {
        if (e.key !== 'Tab') return;
        if (_isContainerHidden(container)) return;
        const focusable = _focusableInside(container);
        if (!focusable.length) {
            e.preventDefault();
            container.focus({ preventScroll: true });
            return;
        }
        const first = focusable[0];
        const last  = focusable[focusable.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
            if (active === first || active === container) {
                e.preventDefault();
                last.focus({ preventScroll: true });
            }
        } else if (active === last) {
            e.preventDefault();
            first.focus({ preventScroll: true });
        }
    };

    document.addEventListener('keydown', keyHandler, true);
    _trapStack.push({ container, keyHandler, previouslyFocused });
}

export function deactivateFocusTrap(container = null) {
    if (!_trapStack.length) return;

    let idx;
    if (container) {
        idx = _findLastIndex(_trapStack, (t) => t.container === container);
        if (idx < 0) return;
    } else {
        idx = _trapStack.length - 1;
    }

    const removed = _trapStack.splice(idx, 1)[0];
    document.removeEventListener('keydown', removed.keyHandler, true);

    // Restore the previous trap if there is one
    const next = _trapStack[_trapStack.length - 1];
    if (next) {
        document.addEventListener('keydown', next.keyHandler, true);
        return;
    }

    // Return focus to where it was before the first trap opened
    const prev = removed.previouslyFocused;
    if (prev && document.contains(prev)) {
        prev.focus({ preventScroll: true });
    }
}

function _findLastIndex(arr, predicate) {
    for (let i = arr.length - 1; i >= 0; i--) {
        if (predicate(arr[i])) return i;
    }
    return -1;
}
