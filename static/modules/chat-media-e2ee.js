const ENCRYPTED_MEDIA_MAGIC = 'SUNENC1\n';
const ENCRYPTED_MEDIA_EXTENSION = 'sunenc';
const ENCRYPTED_MEDIA_FRAGMENT_KEY = 'sun_media_e2ee';

function bytesToBase64(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary);
}

function base64ToBytes(value) {
    const binary = atob(String(value || ''));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
        out[i] = binary.charCodeAt(i);
    }
    return out;
}

function base64UrlEncodeJson(value) {
    const json = JSON.stringify(value || {});
    const bytes = new TextEncoder().encode(json);
    return bytesToBase64(bytes)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function base64UrlDecodeJson(value) {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const bytes = base64ToBytes(padded);
    return JSON.parse(new TextDecoder().decode(bytes));
}

function normalizeEncryptedUploadName(fileName) {
    const cleanName = String(fileName || 'file').replace(/\0/g, '').trim() || 'file';
    return cleanName.toLowerCase().endsWith(`.${ENCRYPTED_MEDIA_EXTENSION}`)
        ? cleanName
        : `${cleanName}.${ENCRYPTED_MEDIA_EXTENSION}`;
}

export async function encryptChatMediaFile(file) {
    if (!(file instanceof Blob)) {
        return { uploadFile: file, metadata: null };
    }
    const key = await crypto.subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        true,
        ['encrypt', 'decrypt'],
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = await file.arrayBuffer();
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext);
    const rawKey = new Uint8Array(await crypto.subtle.exportKey('raw', key));
    const magic = new TextEncoder().encode(ENCRYPTED_MEDIA_MAGIC);
    const encryptedBytes = new Uint8Array(magic.length + ciphertext.byteLength);
    encryptedBytes.set(magic, 0);
    encryptedBytes.set(new Uint8Array(ciphertext), magic.length);

    const originalName = String(file.name || 'file');
    const uploadFile = new File(
        [encryptedBytes],
        normalizeEncryptedUploadName(originalName),
        { type: 'application/octet-stream' },
    );
    return {
        uploadFile,
        metadata: {
            v: 1,
            key: bytesToBase64(rawKey),
            iv: bytesToBase64(iv),
            mime: String(file.type || 'application/octet-stream').toLowerCase(),
            name: originalName,
            size: Number(file.size) || 0,
        },
    };
}

export function appendEncryptedMediaFragment(rawUrl, metadata) {
    if (!metadata?.key || !metadata?.iv) return String(rawUrl || '');
    try {
        const url = new URL(String(rawUrl || ''), window.location.origin);
        const params = new URLSearchParams(url.hash.replace(/^#/, ''));
        params.set(ENCRYPTED_MEDIA_FRAGMENT_KEY, base64UrlEncodeJson(metadata));
        url.hash = params.toString();
        if (url.origin === window.location.origin) {
            return `${url.pathname}${url.search}${url.hash}`;
        }
        return url.href;
    } catch (_) {
        return String(rawUrl || '');
    }
}

export function parseEncryptedMediaUrl(rawUrl) {
    try {
        const url = new URL(String(rawUrl || ''), window.location.origin);
        const params = new URLSearchParams(url.hash.replace(/^#/, ''));
        const encoded = params.get(ENCRYPTED_MEDIA_FRAGMENT_KEY);
        if (!encoded) return null;
        params.delete(ENCRYPTED_MEDIA_FRAGMENT_KEY);
        url.hash = params.toString();
        const metadata = base64UrlDecodeJson(encoded);
        if (!metadata?.key || !metadata?.iv) return null;
        return {
            fetchUrl: url.origin === window.location.origin
                ? `${url.pathname}${url.search}`
                : `${url.origin}${url.pathname}${url.search}`,
            metadata,
        };
    } catch (_) {
        return null;
    }
}

export async function decryptChatMediaBlob(encryptedBlob, metadata) {
    if (!(encryptedBlob instanceof Blob) || !metadata?.key || !metadata?.iv) {
        return encryptedBlob;
    }
    const encryptedBytes = new Uint8Array(await encryptedBlob.arrayBuffer());
    const magic = new TextEncoder().encode(ENCRYPTED_MEDIA_MAGIC);
    for (let i = 0; i < magic.length; i += 1) {
        if (encryptedBytes[i] !== magic[i]) {
            throw new Error('Invalid encrypted media payload.');
        }
    }
    const ciphertext = encryptedBytes.slice(magic.length);
    const key = await crypto.subtle.importKey(
        'raw',
        base64ToBytes(metadata.key),
        { name: 'AES-GCM' },
        false,
        ['decrypt'],
    );
    const plaintext = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: base64ToBytes(metadata.iv) },
        key,
        ciphertext,
    );
    return new Blob([plaintext], {
        type: String(metadata.mime || 'application/octet-stream').toLowerCase(),
    });
}

export function isEncryptedMediaUrl(rawUrl) {
    return Boolean(parseEncryptedMediaUrl(rawUrl));
}
