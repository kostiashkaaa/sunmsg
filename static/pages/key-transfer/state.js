export const SESSION_ID_RE = /^[A-Za-z0-9_-]{16,128}$/;
export const TRANSFER_CONTEXT_PREFIX = 'sun-key-transfer-v1:';

export const receiveState = {
    sessionId: '',
    receiverPrivateKey: null,
    pollTimer: 0,
    qrText: '',
    onSuccess: null,
};

export const scanState = {
    stream: null,
    detectTimer: 0,
    detectRaf: 0,
    handling: false,
    successHideTimer: 0,
};

export function getPrivateKeySessionApi() {
    return window.sunPrivateKeySession || null;
}

export function hasRuntimePrivateKey() {
    const api = getPrivateKeySessionApi();
    if (!api || typeof api.getPrivateKeyPem !== 'function') return false;
    return Boolean(String(api.getPrivateKeyPem() || '').trim());
}

export function getRuntimePrivateKeyPem() {
    const api = getPrivateKeySessionApi();
    if (!api || typeof api.getPrivateKeyPem !== 'function') return '';
    return String(api.getPrivateKeyPem() || '').trim();
}

export async function persistPrivateKeyPem(privateKeyPem) {
    const api = getPrivateKeySessionApi();
    if (!api || typeof api.stagePrivateKeyForRedirect !== 'function') {
        return false;
    }
    return api.stagePrivateKeyForRedirect(privateKeyPem, {
        persistent: false,
        notify: true,
    });
}
