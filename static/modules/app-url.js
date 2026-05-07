function normalizeAppRoot(value) {
    const raw = String(value ?? '').trim();
    if (!raw || raw === '/') return '';
    const prefixed = raw.startsWith('/') ? raw : `/${raw}`;
    return prefixed.replace(/\/+$/, '');
}

export function getAppRoot() {
    const bootstrapRoot = window.SUN_BOOTSTRAP?.app?.root;
    const globalRoot = window.SUN_APP_ROOT;
    const bodyRoot = document.body?.dataset?.appRoot;
    const htmlRoot = document.documentElement?.dataset?.appRoot;
    return normalizeAppRoot(bootstrapRoot || globalRoot || bodyRoot || htmlRoot || '');
}

export function withAppRoot(path) {
    const raw = String(path ?? '').trim();
    if (!raw) return getAppRoot() || '/';
    if (/^[a-z][a-z0-9+\-.]*:/i.test(raw) || raw.startsWith('//') || raw.startsWith('#')) {
        return raw;
    }

    const root = getAppRoot();
    if (!root) {
        if (raw.startsWith('/')) return raw;
        return `/${raw.replace(/^\/+/, '')}`;
    }

    if (raw.startsWith('/')) {
        if (raw === root || raw.startsWith(`${root}/`) || raw.startsWith(`${root}?`) || raw.startsWith(`${root}#`)) {
            return raw;
        }
        return `${root}${raw}`;
    }

    return `${root}/${raw.replace(/^\/+/, '')}`;
}
