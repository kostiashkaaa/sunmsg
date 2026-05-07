export function withAppRoot(path) {
    const raw = String(path || '').trim();
    if (!raw) return '/';
    if (/^[a-z][a-z0-9+\-.]*:/i.test(raw) || raw.startsWith('//') || raw.startsWith('#')) {
        return raw;
    }
    const rootRaw = String(window.SUN_BOOTSTRAP?.app?.root || window.SUN_APP_ROOT || '').trim();
    const root = !rootRaw || rootRaw === '/'
        ? ''
        : (rootRaw.startsWith('/') ? rootRaw : `/${rootRaw}`).replace(/\/+$/, '');
    if (!root) {
        return raw.startsWith('/') ? raw : `/${raw.replace(/^\/+/, '')}`;
    }
    if (raw.startsWith('/')) {
        if (raw === root || raw.startsWith(`${root}/`) || raw.startsWith(`${root}?`) || raw.startsWith(`${root}#`)) {
            return raw;
        }
        return `${root}${raw}`;
    }
    return `${root}/${raw.replace(/^\/+/, '')}`;
}

export function getCsrfToken() {
    return String(document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '');
}

export async function apiRequest(path, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = Object.assign({}, options.headers || {});
    if (!headers['X-CSRFToken']) {
        headers['X-CSRFToken'] = getCsrfToken();
    }
    if (options.body !== undefined && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
    const response = await fetch(withAppRoot(path), {
        method,
        credentials: 'include',
        headers,
        body: options.body,
    });
    let payload = {};
    try {
        payload = await response.json();
    } catch (_) {
        payload = {};
    }
    return { response, payload };
}

export async function createReceiveSession() {
    const keyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits'],
    );
    const receiverPublicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
    const { response, payload } = await apiRequest('/api/key_transfer/sessions', {
        method: 'POST',
        body: JSON.stringify({ receiver_public_jwk: receiverPublicJwk }),
    });
    if (!response.ok || !payload.success) {
        throw new Error(String(payload.error || 'Не удалось создать сессию переноса ключа.'));
    }
    return {
        sessionId: String(payload.session_id || ''),
        qrText: String(payload.qr_text || ''),
        expiresIn: Number(payload.expires_in_seconds || 0),
        privateKey: keyPair.privateKey,
    };
}

export async function claimTransferSession(sessionId) {
    return apiRequest(`/api/key_transfer/sessions/${encodeURIComponent(sessionId)}/claim`);
}

export async function getTransferSessionDetails(sessionId, transferKind) {
    const basePath = transferKind === 'login'
        ? `/api/key_transfer/login/sessions/${encodeURIComponent(sessionId)}`
        : `/api/key_transfer/sessions/${encodeURIComponent(sessionId)}`;
    const detailsResp = await apiRequest(basePath);
    return { basePath, detailsResp };
}

export async function submitTransferSession(basePath, payload) {
    return apiRequest(`${basePath}/submit`, {
        method: 'POST',
        body: JSON.stringify(payload),
    });
}
