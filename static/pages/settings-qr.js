import { applySunQrBrand } from './qr-brand.js';

function getQrContainer() {
    return document.getElementById('qrCodeContainer');
}

function getPublicKeyTextarea() {
    return document.getElementById('publicKeyTextarea');
}

function getProfileQrPayload() {
    const bootstrapUsername = String(window.SUN_BOOTSTRAP?.user?.currentUsername || '').trim().toLowerCase();
    const datasetUsername = String(document.body?.dataset?.currentUsername || '').trim().toLowerCase();
    const username = bootstrapUsername || datasetUsername;
    if (/^[a-z0-9_]{1,50}$/.test(username)) {
        return `su:${username}`;
    }

    const pubKeyTextarea = getPublicKeyTextarea();
    return String(pubKeyTextarea?.value || '').trim();
}

export async function initSettingsQr() {
    const container = getQrContainer();
    if (!container) return false;
    if (container.querySelector('canvas') || container.querySelector('img')) return true;

    const payload = getProfileQrPayload();
    if (!payload) return false;

    try {
        await window.ensureQrCodeLibrary();
        new QRCode(container, {
            text: payload,
            width: 200,
            height: 200,
            colorDark: '#1a1a2e',
            colorLight: '#ffffff',
            correctLevel: QRCode.CorrectLevel.M,
        });
        applySunQrBrand(container, { logoRatio: 0.26 });
        return true;
    } catch (_) {
        container.innerHTML = '<p style="color:red;font-size:12px;">\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0437\u0434\u0430\u0442\u044C QR-\u043A\u043E\u0434</p>';
        return false;
    }
}

export function downloadSettingsQr() {
    const container = getQrContainer();
    if (!container) return false;

    const img = container.querySelector('img');
    const canvas = container.querySelector('canvas');

    let dataUrl = '';
    if (canvas) {
        dataUrl = canvas.toDataURL('image/png');
    } else if (img) {
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = img.naturalWidth || 200;
        tmpCanvas.height = img.naturalHeight || 200;
        const ctx = tmpCanvas.getContext('2d');
        if (!ctx) return false;
        ctx.drawImage(img, 0, 0);
        dataUrl = tmpCanvas.toDataURL('image/png');
    } else {
        return false;
    }

    const anchor = document.createElement('a');
    anchor.href = dataUrl;
    anchor.download = 'sun-messenger-qr.png';
    anchor.click();
    return true;
}
