import { bindServiceWorkerUpdateLifecycle } from './service-worker-update.js';

const SERVICE_WORKER_URL = '/service-worker.js';
const SERVICE_WORKER_SCOPE = '/';
const PWA_CACHE_PREFIX = 'sunmessenger-pwa-';
const LEGACY_CACHE_PREFIX = 'sunmessenger-cache-';
const BACKGROUND_SYNC_TAG = 'sun-outbox-sync';

let registrationPromise = null;
let updateNoticeEl = null;

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

window.SUN_PWA = {
    ready: ensurePwaServiceWorkerRegistration,
    registerBackgroundSync: registerPwaBackgroundSync,
    clearPrivateCaches: clearPrivatePwaCaches,
};

void ensurePwaServiceWorkerRegistration();
