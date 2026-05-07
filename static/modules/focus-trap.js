// focus-trap.js — keyboard focus trap for modals/drawers

let activeFocusTrap = null;

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
    if (activeFocusTrap) deactivateFocusTrap();
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
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
    activeFocusTrap = { container, keyHandler, previouslyFocused };
}

export function deactivateFocusTrap(container = null) {
    if (!activeFocusTrap) return;
    if (container && activeFocusTrap.container !== container) return;
    document.removeEventListener('keydown', activeFocusTrap.keyHandler, true);
    const prev = activeFocusTrap.previouslyFocused;
    activeFocusTrap = null;
    if (prev && document.contains(prev)) prev.focus({ preventScroll: true });
}
