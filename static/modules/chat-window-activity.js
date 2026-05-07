export function isWindowActiveForUnreadHandling({ doc = document } = {}) {
    return doc.visibilityState === 'visible' && doc.hasFocus();
}
