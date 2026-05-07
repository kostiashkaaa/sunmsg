import {
    claimTransferSession,
    getTransferSessionDetails,
    submitTransferSession,
} from './api.js';

import {
    getRuntimePrivateKeyPem,
    persistPrivateKeyPem,
    SESSION_ID_RE,
    TRANSFER_CONTEXT_PREFIX,
} from './state.js';

import {
    clearReceivePolling,
    showToast,
} from './ui.js';

function base64urlEncode(bytesLike) {
    const bytes = bytesLike instanceof Uint8Array ? bytesLike : new Uint8Array(bytesLike);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i += 1) {
        binary += String.fromCharCode(bytes[i]);
    }
    return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64urlDecode(text) {
    const normalized = String(text || '').replace(/-/g, '+').replace(/_/g, '/');
    const pad = '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = window.atob(normalized + pad);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        out[i] = binary.charCodeAt(i);
    }
    return out;
}

function utf8Bytes(value) {
    return new TextEncoder().encode(String(value || ''));
}

function concatBytes(a, b) {
    const first = a instanceof Uint8Array ? a : new Uint8Array(a);
    const second = b instanceof Uint8Array ? b : new Uint8Array(b);
    const out = new Uint8Array(first.length + second.length);
    out.set(first, 0);
    out.set(second, first.length);
    return out;
}

export function parseTransferCode(rawValue) {
    const text = String(rawValue || '').trim();
    if (!text) return { kind: '', sessionId: '', username: '' };

    const loginMatch = text.match(/(?:sun-key-login|skl):([A-Za-z0-9_-]{16,128})/i);
    if (loginMatch) {
        return { kind: 'login', sessionId: loginMatch[1], username: '' };
    }
    const directMatch = text.match(/sun-key-transfer:([A-Za-z0-9_-]{16,128})/i);
    if (directMatch) {
        return { kind: 'device', sessionId: directMatch[1], username: '' };
    }
    const profilePrefixMatch = text.match(/(?:sun-user|su):([a-z0-9_]{1,50})/i);
    if (profilePrefixMatch) {
        return { kind: 'profile', sessionId: '', username: String(profilePrefixMatch[1] || '').toLowerCase() };
    }

    try {
        const parsed = new URL(text);
        const usernamePathMatch = String(parsed.pathname || '').match(/(?:^|\/)u\/([a-z0-9_]{1,50})\/?$/i);
        if (usernamePathMatch) {
            return { kind: 'profile', sessionId: '', username: String(usernamePathMatch[1] || '').toLowerCase() };
        }
        const queryValue = String(parsed.searchParams.get('kt') || '').trim();
        if (SESSION_ID_RE.test(queryValue)) return { kind: 'device', sessionId: queryValue, username: '' };
        const hashValue = String(parsed.hash || '').replace(/^#/, '').trim();
        const hashMatch = hashValue.match(/kt=([A-Za-z0-9_-]{16,128})/i);
        if (hashMatch) return { kind: 'device', sessionId: hashMatch[1], username: '' };
    } catch (_) {}

    if (SESSION_ID_RE.test(text)) {
        return { kind: 'device', sessionId: text, username: '' };
    }
    return { kind: '', sessionId: '', username: '' };
}

export async function deriveTransferKey({ privateKey, publicKey, sessionId }) {
    const sharedBits = await crypto.subtle.deriveBits(
        {
            name: 'ECDH',
            public: publicKey,
        },
        privateKey,
        256,
    );
    const context = utf8Bytes(`${TRANSFER_CONTEXT_PREFIX}${sessionId}`);
    const digestInput = concatBytes(new Uint8Array(sharedBits), context);
    const digest = await crypto.subtle.digest('SHA-256', digestInput);
    return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptPrivateKeyPem({ privateKeyPem, aesKey }) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = utf8Bytes(privateKeyPem);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aesKey, plaintext);
    return {
        cipherText: base64urlEncode(new Uint8Array(ciphertext)),
        iv: base64urlEncode(iv),
    };
}

export async function decryptPrivateKeyPem({ cipherText, iv, aesKey }) {
    const ciphertextBytes = base64urlDecode(cipherText);
    const ivBytes = base64urlDecode(iv);
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: ivBytes },
        aesKey,
        ciphertextBytes,
    );
    return new TextDecoder().decode(plaintext);
}

export async function claimAndApplyIfReady(receiveState, options = {}) {
    const closeReceiveModal = options.closeReceiveModal || (() => {});
    if (!receiveState.sessionId || !receiveState.receiverPrivateKey) return;

    const { response, payload } = await claimTransferSession(receiveState.sessionId);
    if (!response.ok) {
        if (response.status === 410) {
            throw new Error(String(payload.error || 'Сессия переноса истекла.'));
        }
        if (response.status === 404) {
            throw new Error('Сессия переноса не найдена.');
        }
        return;
    }
    if (!payload.success || payload.state !== 'submitted') {
        return;
    }

    const senderPublicJwk = payload.sender_public_jwk;
    const cipherText = String(payload.cipher_text || '');
    const iv = String(payload.iv || '');
    if (!senderPublicJwk || !cipherText || !iv) {
        throw new Error('Повреждён payload переноса ключа.');
    }

    const senderPublicKey = await crypto.subtle.importKey(
        'jwk',
        senderPublicJwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        [],
    );
    const aesKey = await deriveTransferKey({
        privateKey: receiveState.receiverPrivateKey,
        publicKey: senderPublicKey,
        sessionId: receiveState.sessionId,
    });
    const privateKeyPem = await decryptPrivateKeyPem({ cipherText, iv, aesKey });
    if (!/BEGIN [A-Z ]*PRIVATE KEY/.test(privateKeyPem)) {
        throw new Error('Расшифрованные данные ключа имеют неверный формат.');
    }

    const staged = await persistPrivateKeyPem(privateKeyPem);
    if (!staged) {
        throw new Error('Не удалось безопасно сохранить ключ на этом устройстве.');
    }

    clearReceivePolling(receiveState);
    showToast('Ключ успешно перенесён на это устройство.', 'success');
    if (typeof receiveState.onSuccess === 'function') {
        try { await receiveState.onSuccess(); } catch (_) {}
    }
    closeReceiveModal();
}

export async function submitTransferForSession(payload) {
    const normalizedSessionId = String(payload?.sessionId || '').trim();
    const transferKind = String(payload?.kind || '').trim().toLowerCase();
    if (!SESSION_ID_RE.test(normalizedSessionId)) {
        throw new Error('Некорректный код QR.');
    }
    if (transferKind !== 'device' && transferKind !== 'login') {
        throw new Error('Неизвестный формат QR-кода.');
    }
    const privateKeyPem = getRuntimePrivateKeyPem();
    if (!privateKeyPem) {
        throw new Error('На этом устройстве нет расшифрованного ключа для передачи.');
    }

    const { basePath, detailsResp } = await getTransferSessionDetails(normalizedSessionId, transferKind);
    if (!detailsResp.response.ok || !detailsResp.payload.success) {
        throw new Error(String(detailsResp.payload.error || 'Сессия переноса недоступна.'));
    }

    const receiverPublicKey = await crypto.subtle.importKey(
        'jwk',
        detailsResp.payload.receiver_public_jwk,
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        [],
    );
    const senderKeyPair = await crypto.subtle.generateKey(
        { name: 'ECDH', namedCurve: 'P-256' },
        true,
        ['deriveBits'],
    );
    const senderPublicJwk = await crypto.subtle.exportKey('jwk', senderKeyPair.publicKey);
    const aesKey = await deriveTransferKey({
        privateKey: senderKeyPair.privateKey,
        publicKey: receiverPublicKey,
        sessionId: normalizedSessionId,
    });
    const encrypted = await encryptPrivateKeyPem({ privateKeyPem, aesKey });
    const submitResp = await submitTransferSession(basePath, {
        sender_public_jwk: senderPublicJwk,
        cipher_text: encrypted.cipherText,
        iv: encrypted.iv,
    });
    if (!submitResp.response.ok || !submitResp.payload.success) {
        throw new Error(String(submitResp.payload.error || 'Не удалось передать ключ.'));
    }
}
