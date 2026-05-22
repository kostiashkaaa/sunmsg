import { bindServiceWorkerUpdateLifecycle } from './service-worker-update.js';

const SERVICE_WORKER_URL = '/service-worker.js';
const SERVICE_WORKER_SCOPE = '/';
const PWA_CACHE_PREFIX = 'sunmessenger-pwa-';
const LEGACY_CACHE_PREFIX = 'sunmessenger-cache-';
const BACKGROUND_SYNC_TAG = 'sun-outbox-sync';
const PWA_CAPABLE_CLASS = 'sun-pwa-capable';
const PWA_STANDALONE_CLASS = 'sun-pwa-standalone';

let registrationPromise = null;
let updateNoticeEl = null;
let viewportSyncFrame = 0;

function canUseServiceWorker() {
    return window.isSecureContext && 'serviceWorker' in navigator;
}

function translate(text) {
    const api = window.SUN_I18N;
    if (api && typeof api.translateText === 'function') {
        return api.translateText(text);
    }
    return text;
}

function isStandaloneDisplayMode() {
    return window.navigator?.standalone === true
        || window.matchMedia?.('(display-mode: standalone)')?.matches
        || window.matchMedia?.('(display-mode: fullscreen)')?.matches;
}

function roundedPx(value) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return 0;
    return Math.round(number * 100) / 100;
}

function setRootPxVar(root, name, value) {
    root.style.setProperty(name, `${roundedPx(value)}px`);
}

function applyDisplayModeState() {
    const standalone = isStandaloneDisplayMode();
    const root = document.documentElement;
    root.classList.add(PWA_CAPABLE_CLASS);
    root.classList.toggle(PWA_STANDALONE_CLASS, standalone);
    root.dataset.pwaDisplayMode = standalone ? 'standalone' : 'browser';

    if (document.body) {
        document.body.classList.add(PWA_CAPABLE_CLASS);
        document.body.classList.toggle(PWA_STANDALONE_CLASS, standalone);
        document.body.dataset.pwaDisplayMode = standalone ? 'standalone' : 'browser';
    }

    return standalone;
}

function syncPwaViewportState() {
    viewportSyncFrame = 0;
    const root = document.documentElement;
    const standalone = applyDisplayModeState();
    const viewport = window.visualViewport;
    const fallbackHeight = window.innerHeight || root.clientHeight || 0;
    const fallbackWidth = window.innerWidth || root.clientWidth || 0;
    const visualHeight = standalone && viewport?.height ? viewport.height : fallbackHeight;
    const visualWidth = standalone && viewport?.width ? viewport.width : fallbackWidth;
    const offsetTop = standalone && viewport?.offsetTop ? viewport.offsetTop : 0;
    const offsetLeft = standalone && viewport?.offsetLeft ? viewport.offsetLeft : 0;
    const keyboardInset = Math.max(0, fallbackHeight - (Number(viewport?.height) || fallbackHeight) - offsetTop);

    setRootPxVar(root, '--pwa-vh', visualHeight || fallbackHeight);
    setRootPxVar(root, '--pwa-vw', visualWidth || fallbackWidth);
    setRootPxVar(root, '--pwa-vv-top', offsetTop);
    setRootPxVar(root, '--pwa-vv-left', offsetLeft);
    setRootPxVar(root, '--pwa-keyboard-inset', standalone ? keyboardInset : 0);
}

function schedulePwaViewportStateSync() {
    if (viewportSyncFrame) return;
    viewportSyncFrame = window.requestAnimationFrame(syncPwaViewportState);
}

function bindPwaViewportState() {
    syncPwaViewportState();
    document.addEventListener('DOMContentLoaded', schedulePwaViewportStateSync, { once: true });
    window.addEventListener('resize', schedulePwaViewportStateSync, { passive: true });
    window.addEventListener('orientationchange', schedulePwaViewportStateSync, { passive: true });

    const viewport = window.visualViewport;
    if (viewport) {
        viewport.addEventListener('resize', schedulePwaViewportStateSync, { passive: true });
        viewport.addEventListener('scroll', schedulePwaViewportStateSync, { passive: true });
    }

    for (const query of ['(display-mode: standalone)', '(display-mode: fullscreen)']) {
        const media = window.matchMedia?.(query);
        if (!media) continue;
        if (typeof media.addEventListener === 'function') {
            media.addEventListener('change', schedulePwaViewportStateSync);
        } else if (typeof media.addListener === 'function') {
            media.addListener(schedulePwaViewportStateSync);
        }
    }
}

function showUpdateNotice() {
    if (updateNoticeEl) return;
    if (!document.body) {
        document.addEventListener('DOMContentLoaded', showUpdateNotice, { once: true });
        return;
    }

    updateNoticeEl = document.createElement('div');
    updateNoticeEl.className = 'sun-pwa-update';
    updateNoticeEl.setAttribute('role', 'status');
    updateNoticeEl.setAttribute('aria-live', 'polite');

    const text = document.createElement('span');
    text.className = 'sun-pwa-update__text';
    text.textContent = translate('Доступна новая версия SUN.');

    const button = document.createElement('button');
    button.className = 'sun-pwa-update__button';
    button.type = 'button';
    button.textContent = translate('Обновить');
    button.addEventListener('click', () => {
        window.location.reload();
    });

    updateNoticeEl.append(text, button);
    document.body.appendChild(updateNoticeEl);
}

function bindServiceWorkerMessages() {
    if (!canUseServiceWorker()) return;
    navigator.serviceWorker.addEventListener('message', (event) => {
        const data = event.data || {};
        if (data.type === 'SUN_BACKGROUND_SYNC') {
            window.dispatchEvent(new CustomEvent('sun-pwa-background-sync', {
                detail: { tag: data.tag || BACKGROUND_SYNC_TAG },
            }));
        }
    });
}

export async function ensurePwaServiceWorkerRegistration() {
    if (!canUseServiceWorker()) return null;
    if (registrationPromise) return registrationPromise;

    registrationPromise = navigator.serviceWorker.register(SERVICE_WORKER_URL, {
        scope: SERVICE_WORKER_SCOPE,
        updateViaCache: 'none',
    }).then((registration) => {
        bindServiceWorkerUpdateLifecycle({
            registration,
            onUpdateReady: showUpdateNotice,
        });
        return registration;
    }).catch(() => null);

    return registrationPromise;
}

export async function registerPwaBackgroundSync(tag = BACKGROUND_SYNC_TAG) {
    const registration = await ensurePwaServiceWorkerRegistration();
    if (!registration || !('sync' in registration)) {
        window.dispatchEvent(new CustomEvent('sun-pwa-background-sync-unavailable', {
            detail: { tag },
        }));
        return false;
    }
    try {
        await registration.sync.register(tag);
        return true;
    } catch (_error) {
        return false;
    }
}

export async function clearPrivatePwaCaches() {
    if (canUseServiceWorker()) {
        const controller = navigator.serviceWorker.controller;
        if (controller && typeof controller.postMessage === 'function') {
            controller.postMessage({ type: 'CLEAR_PRIVATE_CACHES' });
        }
    }

    if (!('caches' in window)) return;
    const names = await caches.keys();
    await Promise.all(names.map((name) => {
        if (name.startsWith(LEGACY_CACHE_PREFIX)) {
            return caches.delete(name);
        }
        if (!name.startsWith(PWA_CACHE_PREFIX)) {
            return null;
        }
        if (name.startsWith(`${PWA_CACHE_PREFIX}precache-`)) {
            return null;
        }
        return caches.delete(name);
    }));
}

bindServiceWorkerMessages();
bindPwaViewportState();

window.SUN_PWA = {
    ready: ensurePwaServiceWorkerRegistration,
    registerBackgroundSync: registerPwaBackgroundSync,
    clearPrivateCaches: clearPrivatePwaCaches,
};

void ensurePwaServiceWorkerRegistration();
