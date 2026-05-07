const DEFAULT_SIZE = 72;
const MIN_SIZE = 56;
const MAX_SIZE = 84;
const DEFAULT_RATIO = 0.26;

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function resolveQrNode(container) {
    if (!container) return null;
    return container.querySelector('canvas, img');
}

function resolveQrSize(qrNode) {
    if (!qrNode) return 0;
    if (qrNode instanceof HTMLCanvasElement) {
        return Math.max(
            Number(qrNode.width) || 0,
            Number(qrNode.height) || 0,
            Number(qrNode.clientWidth) || 0,
            Number(qrNode.clientHeight) || 0,
        );
    }
    if (qrNode instanceof HTMLImageElement) {
        return Math.max(
            Number(qrNode.naturalWidth) || 0,
            Number(qrNode.naturalHeight) || 0,
            Number(qrNode.clientWidth) || 0,
            Number(qrNode.clientHeight) || 0,
        );
    }
    return Math.max(
        Number(qrNode.clientWidth) || 0,
        Number(qrNode.clientHeight) || 0,
    );
}

function ensureBadge(container) {
    let badge = container.querySelector('.sun-qr-brand__badge');
    if (!badge) {
        badge = document.createElement('span');
        badge.className = 'sun-qr-brand__badge';
        badge.setAttribute('aria-hidden', 'true');
        const pulse = document.createElement('span');
        pulse.className = 'sun-qr-brand__pulse';
        const core = document.createElement('span');
        core.className = 'sun-qr-brand__core';
        badge.append(pulse, core);
        container.appendChild(badge);
    }
    return badge;
}

function runBrandAnimations(badge) {
    if (!badge || badge.dataset.animReady === '1') return;
    const core = badge.querySelector('.sun-qr-brand__core');
    const pulse = badge.querySelector('.sun-qr-brand__pulse');
    if (!core || !pulse || typeof core.animate !== 'function' || typeof pulse.animate !== 'function') return;

    core.animate(
        [
            { transform: 'scale(0.9)', opacity: 0.78 },
            { transform: 'scale(1)', opacity: 1 },
            { transform: 'scale(0.9)', opacity: 0.78 },
        ],
        {
            duration: 1350,
            iterations: Infinity,
            easing: 'ease-in-out',
        },
    );

    pulse.animate(
        [
            { transform: 'scale(0.82)', opacity: 0.52 },
            { transform: 'scale(1.24)', opacity: 0 },
            { transform: 'scale(1.24)', opacity: 0 },
        ],
        {
            duration: 1750,
            iterations: Infinity,
            easing: 'ease-out',
        },
    );

    badge.dataset.animReady = '1';
}

export function applySunQrBrand(container, options = {}) {
    if (!container) return false;
    const qrNode = resolveQrNode(container);
    if (!qrNode) return false;

    const qrSize = resolveQrSize(qrNode);
    // Keep the QR visual box deterministic so the center badge is aligned
    // to the actual QR area even when renderer output applies fluid sizing.
    if (qrSize > 0) {
        qrNode.style.width = `${qrSize}px`;
        qrNode.style.height = `${qrSize}px`;
        qrNode.style.display = 'block';
        qrNode.style.maxWidth = 'none';
        qrNode.style.margin = '0 auto';
    }
    const ratio = clamp(Number(options.logoRatio) || DEFAULT_RATIO, 0.2, 0.3);
    const badgeSize = clamp(Math.round(qrSize * ratio) || DEFAULT_SIZE, MIN_SIZE, MAX_SIZE);

    container.classList.add('sun-qr-brand');
    container.style.setProperty('--sun-qr-badge-size', `${badgeSize}px`);
    const badge = ensureBadge(container);
    runBrandAnimations(badge);
    return true;
}

export function clearSunQrBrand(container) {
    if (!container) return;
    const badge = container.querySelector('.sun-qr-brand__badge');
    if (badge) badge.remove();
    container.style.removeProperty('--sun-qr-badge-size');
}
