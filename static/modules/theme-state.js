export function readAppliedDarkMode() {
    try {
        const storedDark = localStorage.getItem('darkMode');
        if (storedDark === 'true') return true;
        if (storedDark === 'false') return false;
    } catch (_) {
        // Fall back to the class applied by early boot.
    }
    return Boolean(
        document.documentElement?.classList?.contains('dark-mode')
        || document.body?.classList?.contains('dark-mode'),
    );
}
