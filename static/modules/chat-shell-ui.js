export function getStoredStringList(storageKey, storage = window.localStorage) {
    try {
        const raw = storage.getItem(storageKey);
        const parsed = JSON.parse(raw || '[]');
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch (_) {
        return [];
    }
}

export function setStoredStringList(storageKey, values, storage = window.localStorage) {
    try {
        const normalized = Array.from(new Set((values || []).map(String)));
        storage.setItem(storageKey, JSON.stringify(normalized));
    } catch (_) {
        // Ignore storage failures.
    }
}

export function getStoredString(storageKey, storage = window.sessionStorage) {
    try {
        const value = storage.getItem(storageKey);
        return value ? String(value).trim() : '';
    } catch (_) {
        return '';
    }
}

export function setStoredString(storageKey, value, storage = window.sessionStorage) {
    const normalized = String(value || '').trim();
    try {
        if (!normalized) {
            storage.removeItem(storageKey);
            return;
        }
        storage.setItem(storageKey, normalized);
    } catch (_) {
        // Ignore storage failures.
    }
}

const _dialogTransitionState = new WeakMap();
const _overlayTransitionState = new WeakMap();
const _floatingPanelTransitionState = new WeakMap();

function _prefersReducedMotion() {
    if (document.documentElement.classList.contains('perf-lite')) {
        return true;
    }
    const motionLevel = String(document.documentElement.getAttribute('data-motion-level') || 'full').toLowerCase();
    if (motionLevel !== 'lite') {
        return false;
    }
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {
        return false;
    }
}

function _parseDurationTokenToMs(raw, fallbackMs = 0) {
    const value = String(raw || '').trim().toLowerCase();
    if (!value) return fallbackMs;
    if (value.endsWith('ms')) {
        const parsedMs = Number.parseFloat(value.slice(0, -2));
        return Number.isFinite(parsedMs) ? Math.max(0, parsedMs) : fallbackMs;
    }
    if (value.endsWith('s')) {
        const parsedS = Number.parseFloat(value.slice(0, -1));
        return Number.isFinite(parsedS) ? Math.max(0, parsedS * 1000) : fallbackMs;
    }
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : fallbackMs;
}

function _extractTransitionMs(style, propName) {
    const raw = String(style?.getPropertyValue(propName) || '').trim();
    if (!raw) return 0;
    return raw
        .split(',')
        .map((token) => _parseDurationTokenToMs(token.trim(), 0))
        .reduce((maxMs, currentMs) => Math.max(maxMs, currentMs), 0);
}

function _readMotionMs(element, { cssVarNames = [], fallbackMs = 220 } = {}) {
    if (!element || _prefersReducedMotion()) return 0;
    const computed = window.getComputedStyle(element);
    let maxMs = 0;

    const transitionDurationMs = _extractTransitionMs(computed, 'transition-duration');
    const transitionDelayMs = _extractTransitionMs(computed, 'transition-delay');
    maxMs = Math.max(maxMs, transitionDurationMs + transitionDelayMs);

    for (const cssVarName of cssVarNames) {
        maxMs = Math.max(
            maxMs,
            _parseDurationTokenToMs(computed.getPropertyValue(cssVarName), 0),
        );
    }

    return Math.max(maxMs, fallbackMs);
}

function _waitForAnimationEnd(element, fallbackMs) {
    if (!element || fallbackMs <= 0) return Promise.resolve();

    return new Promise((resolve) => {
        let finished = false;
        let timeoutId = 0;

        const cleanup = () => {
            if (timeoutId) window.clearTimeout(timeoutId);
            element.removeEventListener('transitionend', onEnd);
            element.removeEventListener('animationend', onEnd);
        };

        const finalize = () => {
            if (finished) return;
            finished = true;
            cleanup();
            resolve();
        };

        const onEnd = (event) => {
            if (event?.target !== element) return;
            finalize();
        };

        element.addEventListener('transitionend', onEnd);
        element.addEventListener('animationend', onEnd);
        timeoutId = window.setTimeout(finalize, fallbackMs + 50);
    });
}

function _getTransitionState(map, element) {
    let state = map.get(element);
    if (!state) {
        state = {
            phase: 'closed',
            lastFocused: null,
            promise: null,
            seq: 0,
        };
        map.set(element, state);
    }
    return state;
}

function _canRestoreFocus(element) {
    return element instanceof HTMLElement && document.contains(element);
}

export function hideBootOverlay({
    overlay,
    isHidden = false,
    startedAt = 0,
    minVisibleMs = 320,
    removeDelayMs = 420,
} = {}) {
    if (isHidden || !overlay) return isHidden;

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const elapsed = now - startedAt;
    const waitMs = Math.max(0, minVisibleMs - elapsed);

    window.setTimeout(() => {
        overlay.classList.add('is-hidden');
        _waitForAnimationEnd(overlay, Math.max(0, removeDelayMs)).then(() => {
            overlay.remove();
        });
    }, waitMs);

    return true;
}

export function setElementActiveState(element, isActive, { activeClass = 'active' } = {}) {
    if (!element) return;
    element.classList.toggle(activeClass, Boolean(isActive));
    element.setAttribute('aria-hidden', isActive ? 'false' : 'true');
}

export function openFloatingPanel(panel, activeClass = 'active') {
    if (!panel) return false;
    const state = _getTransitionState(_floatingPanelTransitionState, panel);
    if (
        (state.phase === 'open' && panel.classList.contains(activeClass))
        || (state.phase === 'opening' && (
            panel.classList.contains(activeClass)
            || panel.classList.contains('is-opening')
        ))
    ) {
        panel.setAttribute('aria-hidden', 'false');
        return false;
    }
    const openSeq = ++state.seq;
    state.phase = 'opening';
    state.promise = null;
    panel.dataset.motionSeq = String(openSeq);
    panel.classList.remove(activeClass, 'is-closing');
    panel.classList.add('is-opening');
    panel.setAttribute('aria-hidden', 'false');
    requestAnimationFrame(() => {
        if (openSeq !== state.seq) return;
        panel.classList.add(activeClass);
        requestAnimationFrame(() => {
            if (openSeq !== state.seq) return;
            panel.classList.remove('is-opening');
            state.phase = 'open';
        });
    });
    return true;
}

export function closeFloatingPanel(panel, activeClass = 'active', fallbackMs = 300) {
    if (!panel) return Promise.resolve(false);
    const state = _getTransitionState(_floatingPanelTransitionState, panel);
    if (state.phase === 'closing' && state.promise) return state.promise;
    if (
        !panel.classList.contains(activeClass)
        && !panel.classList.contains('is-opening')
        && !panel.classList.contains('is-closing')
    ) {
        state.phase = 'closed';
        panel.setAttribute('aria-hidden', 'true');
        return Promise.resolve(false);
    }
    const closeSeq = ++state.seq;
    state.phase = 'closing';
    panel.dataset.motionSeq = String(closeSeq);
    panel.classList.remove(activeClass, 'is-opening');
    panel.classList.add('is-closing');
    panel.setAttribute('aria-hidden', 'true');
    const waitMs = _readMotionMs(panel, {
        cssVarNames: ['--m-dur-fast', '--m-dur-base', '--m-dur-medium'],
        fallbackMs,
    });
    state.promise = _waitForAnimationEnd(panel, waitMs).then(() => {
        if (closeSeq !== state.seq) return false;
        panel.classList.remove('is-closing');
        state.phase = 'closed';
        state.promise = null;
        return true;
    });
    return state.promise;
}

export function isOverlayVisible(element, { activeClass = 'is-open' } = {}) {
    return Boolean(
        element
            && element.classList.contains(activeClass)
            && !element.classList.contains('is-closing')
            && element.getAttribute('aria-hidden') !== 'true'
    );
}

export function openAnimatedDialog(dialog, { focusTarget = null } = {}) {
    if (!dialog) return false;

    const state = _getTransitionState(_dialogTransitionState, dialog);
    if (!dialog.open && state.phase !== 'closed') {
        state.phase = 'closed';
        state.promise = null;
    }
    if (state.phase === 'open' || state.phase === 'opening') {
        if (focusTarget instanceof HTMLElement) {
            requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
        }
        return false;
    }

    state.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const openSeq = ++state.seq;
    state.phase = 'opening';

    if (!dialog.open) dialog.showModal();
    dialog.classList.remove('is-closing');
    dialog.classList.add('is-opening');
    dialog.setAttribute('aria-hidden', 'false');

    requestAnimationFrame(() => {
        if (openSeq !== state.seq) return;
        if (!dialog.open) return;
        dialog.classList.add('is-open');
        dialog.classList.remove('is-opening');
        state.phase = 'open';
        if (focusTarget instanceof HTMLElement) {
            focusTarget.focus({ preventScroll: true });
        }
    });

    return true;
}

export function closeAnimatedDialog(dialog, { restoreFocus = true, fallbackMs = 220 } = {}) {
    if (!dialog) return Promise.resolve(false);

    const state = _getTransitionState(_dialogTransitionState, dialog);
    if (state.phase === 'closing' && state.promise) {
        return state.promise;
    }
    if (!dialog.open && !dialog.classList.contains('is-open')) {
        state.phase = 'closed';
        return Promise.resolve(false);
    }

    state.phase = 'closing';
    const closeSeq = ++state.seq;
    dialog.classList.remove('is-opening', 'is-open');
    dialog.classList.add('is-closing');
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && dialog.contains(activeElement)) {
        try {
            activeElement.blur();
        } catch (_) {}
    }
    dialog.setAttribute('aria-hidden', 'true');

    const waitMs = _readMotionMs(dialog, {
        cssVarNames: ['--dur-quick', '--dur-medium'],
        fallbackMs,
    });

    state.promise = _waitForAnimationEnd(dialog, waitMs).then(() => {
        if (closeSeq !== state.seq) return false;
        if (dialog.open) dialog.close();
        dialog.classList.remove('is-closing', 'is-opening', 'is-open');
        state.phase = 'closed';
        state.promise = null;

        const target = state.lastFocused;
        state.lastFocused = null;
        if (restoreFocus && _canRestoreFocus(target)) {
            try {
                target.focus({ preventScroll: true });
            } catch (_) {}
        }
        return true;
    });

    return state.promise;
}

export function openAnimatedOverlay(overlay, { activeClass = 'is-open', focusTarget = null } = {}) {
    if (!overlay) return false;

    const state = _getTransitionState(_overlayTransitionState, overlay);
    if (state.phase === 'open' || state.phase === 'opening') {
        if (focusTarget instanceof HTMLElement) {
            requestAnimationFrame(() => focusTarget.focus({ preventScroll: true }));
        }
        return false;
    }

    state.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const openSeq = ++state.seq;
    state.phase = 'opening';

    overlay.classList.remove(activeClass, 'is-closing');
    overlay.classList.add('is-opening');
    overlay.setAttribute('aria-hidden', 'false');

    requestAnimationFrame(() => {
        if (openSeq !== state.seq) return;
        overlay.classList.add(activeClass);
        requestAnimationFrame(() => {
            if (openSeq !== state.seq) return;
            overlay.classList.remove('is-opening');
            state.phase = 'open';
            if (focusTarget instanceof HTMLElement) {
                focusTarget.focus({ preventScroll: true });
            }
        });
    });

    return true;
}

export function closeAnimatedOverlay(
    overlay,
    { activeClass = 'is-open', restoreFocus = true, fallbackMs = 240 } = {},
) {
    if (!overlay) return Promise.resolve(false);

    const state = _getTransitionState(_overlayTransitionState, overlay);
    if (state.phase === 'closing' && state.promise) {
        return state.promise;
    }
    if (
        !overlay.classList.contains(activeClass)
        && !overlay.classList.contains('is-opening')
    ) {
        state.phase = 'closed';
        return Promise.resolve(false);
    }

    state.phase = 'closing';
    const closeSeq = ++state.seq;
    overlay.classList.remove(activeClass, 'is-opening');
    overlay.classList.add('is-closing');
    overlay.setAttribute('aria-hidden', 'true');

    const waitMs = _readMotionMs(overlay, {
        cssVarNames: ['--dur-quick', '--dur-medium'],
        fallbackMs,
    });

    state.promise = _waitForAnimationEnd(overlay, waitMs).then(() => {
        if (closeSeq !== state.seq) return false;
        overlay.classList.remove('is-closing');
        state.phase = 'closed';
        state.promise = null;

        const target = state.lastFocused;
        state.lastFocused = null;
        if (restoreFocus && _canRestoreFocus(target)) {
            try {
                target.focus({ preventScroll: true });
            } catch (_) {}
        }
        return true;
    });

    return state.promise;
}

export async function copyTextToClipboard(text) {
    const value = String(text || '').trim();
    if (!value) return false;

    try {
        if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(value);
            return true;
        }
    } catch (_) {}

    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.top = '-9999px';
    document.body.appendChild(input);
    input.select();

    try {
        const ok = document.execCommand('copy');
        document.body.removeChild(input);
        return ok;
    } catch (_) {
        document.body.removeChild(input);
        return false;
    }
}

export function addTapFeedback(element) {
    if (!element) return;

    const setDown = () => element.classList.add('is-tapped');
    const clear = () => element.classList.remove('is-tapped');

    element.addEventListener('pointerdown', setDown);
    element.addEventListener('pointerup', clear);
    element.addEventListener('pointercancel', clear);
    element.addEventListener('pointerleave', clear);
}
