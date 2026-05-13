const ACTION_BASE_CLASS = 'message-action-motion';
const ACTION_CLASS_PREFIX = 'message-action-motion--';
const SELECTION_BASE_CLASS = 'message-selection-motion';
const SELECTION_CLASS_PREFIX = 'message-selection-motion--';
const STATE_BASE_CLASS = 'message-state-motion';
const STATE_CLASS_PREFIX = 'message-state-motion--';

const actionTimers = new WeakMap();
const selectionTimers = new WeakMap();
const stateTimers = new WeakMap();

function normalizeToken(value, fallback) {
    return String(value || fallback || 'default')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || fallback || 'default';
}

function clearPrefixedClasses(element, prefix) {
    Array.from(element.classList).forEach((className) => {
        if (className.startsWith(prefix)) element.classList.remove(className);
    });
}

function restartTransientClass(element, {
    baseClass,
    prefixedClass,
    prefix,
    timerMap,
    durationMs,
}) {
    if (!element?.classList) return;
    const timerHost = element.ownerDocument?.defaultView || globalThis;

    const prevTimer = timerMap.get(element);
    if (prevTimer) {
        timerHost.clearTimeout(prevTimer);
        timerMap.delete(element);
    }

    element.classList.remove(baseClass);
    clearPrefixedClasses(element, prefix);
    void element.offsetWidth;
    element.classList.add(baseClass, prefixedClass);

    const timerId = timerHost.setTimeout(() => {
        element.classList.remove(baseClass, prefixedClass);
        timerMap.delete(element);
    }, durationMs);
    timerMap.set(element, timerId);
}

export function runMessageActionMotion(messageEl, action = 'default') {
    restartTransientClass(messageEl, {
        baseClass: ACTION_BASE_CLASS,
        prefixedClass: `${ACTION_CLASS_PREFIX}${normalizeToken(action, 'default')}`,
        prefix: ACTION_CLASS_PREFIX,
        timerMap: actionTimers,
        durationMs: 420,
    });
}

export function runMessageSelectionMotion(messageEl, selected) {
    restartTransientClass(messageEl, {
        baseClass: SELECTION_BASE_CLASS,
        prefixedClass: `${SELECTION_CLASS_PREFIX}${selected ? 'selected' : 'cleared'}`,
        prefix: SELECTION_CLASS_PREFIX,
        timerMap: selectionTimers,
        durationMs: 280,
    });
}

export function runMessageStateMotion(messageEl, state = 'default') {
    restartTransientClass(messageEl, {
        baseClass: STATE_BASE_CLASS,
        prefixedClass: `${STATE_CLASS_PREFIX}${normalizeToken(state, 'default')}`,
        prefix: STATE_CLASS_PREFIX,
        timerMap: stateTimers,
        durationMs: 520,
    });
}

export function runMessageActionMotionById(documentRef, msgId, action = 'default') {
    const normalizedId = String(msgId || '').trim();
    if (!normalizedId) return null;
    const cssEscape = documentRef?.defaultView?.CSS?.escape || globalThis.CSS?.escape;
    const selectorId = typeof cssEscape === 'function'
        ? cssEscape(normalizedId)
        : normalizedId.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const messageEl = documentRef?.querySelector?.(`.message[data-msg-id="${selectorId}"]`) || null;
    runMessageActionMotion(messageEl, action);
    return messageEl;
}

export function runMessageActionMotionForIds(documentRef, msgIds, action = 'default') {
    const ids = Array.isArray(msgIds) ? msgIds : [msgIds];
    ids.forEach((msgId) => runMessageActionMotionById(documentRef, msgId, action));
}
