const PRIVATE_KEY_STATUS_EVENT = 'sun-private-key-status-changed';
let fallbackPrivateKeyPem = '';

function getBridgeApi() {
    return window.sunPrivateKeySession || null;
}

function fallbackNotify() {
    window.dispatchEvent(new Event(PRIVATE_KEY_STATUS_EVENT));
}

export function getPrivateKeyPem() {
    const api = getBridgeApi();
    if (api && typeof api.getPrivateKeyPem === 'function') {
        return String(api.getPrivateKeyPem() || '');
    }
    return fallbackPrivateKeyPem;
}

export function hasPrivateKeyPem() {
    return Boolean(getPrivateKeyPem());
}

export function setPrivateKeyPem(pem, options = {}) {
    const api = getBridgeApi();
    if (api && typeof api.setPrivateKeyPem === 'function') {
        return api.setPrivateKeyPem(pem, options);
    }
    fallbackPrivateKeyPem = String(pem || '').trim();
    if (options?.notify !== false) fallbackNotify();
    return Boolean(fallbackPrivateKeyPem);
}

export async function clearPrivateKeyPem(options = {}) {
    const api = getBridgeApi();
    if (api && typeof api.clearPrivateKeyPem === 'function') {
        return api.clearPrivateKeyPem(options);
    }
    fallbackPrivateKeyPem = '';
    if (options?.notify !== false) fallbackNotify();
}

export async function restoreWrappedPrivateKey(options = {}) {
    const api = getBridgeApi();
    if (api && typeof api.restoreWrappedPrivateKey === 'function') {
        return api.restoreWrappedPrivateKey(options);
    }
    if (options?.notify !== false) fallbackNotify();
    return false;
}

export async function stagePrivateKeyForRedirect(pem, options = {}) {
    const api = getBridgeApi();
    if (api && typeof api.stagePrivateKeyForRedirect === 'function') {
        return api.stagePrivateKeyForRedirect(pem, options);
    }
    setPrivateKeyPem(pem, { notify: false });
    if (options?.notify !== false) fallbackNotify();
    return false;
}

export function notifyPrivateKeyStatusChanged() {
    const api = getBridgeApi();
    if (api && typeof api.notifyPrivateKeyStatusChanged === 'function') {
        api.notifyPrivateKeyStatusChanged();
        return;
    }
    fallbackNotify();
}
