function readPrivateKeyPemFromSessionApi(scopeWindow) {
    const api = scopeWindow?.sunPrivateKeySession;
    if (!api || typeof api.getPrivateKeyPem !== 'function') return '';
    return String(api.getPrivateKeyPem() || '').trim();
}

export function readRuntimePrivateKeyPem({ isEmbedMode = false, scopeWindow = window } = {}) {
    const localPem = readPrivateKeyPemFromSessionApi(scopeWindow);
    if (localPem) return localPem;

    if (!isEmbedMode) return '';

    try {
        const parentWindow = scopeWindow?.parent;
        if (!parentWindow || parentWindow === scopeWindow) return '';
        return readPrivateKeyPemFromSessionApi(parentWindow);
    } catch (_) {
        return '';
    }
}

export function hasRuntimePrivateKey(options = {}) {
    return Boolean(readRuntimePrivateKeyPem(options));
}
