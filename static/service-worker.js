const VERSION = '2026-05-22-pwa-v2';
const CACHE_PREFIX = 'sunmessenger-pwa-';
const LEGACY_CACHE_PREFIX = 'sunmessenger-cache-';
const PRECACHE = `${CACHE_PREFIX}precache-${VERSION}`;
const RUNTIME = `${CACHE_PREFIX}runtime-${VERSION}`;
const NAVIGATION = `${CACHE_PREFIX}navigation-${VERSION}`;
const API = `${CACHE_PREFIX}api-${VERSION}`;
const OFFLINE_URL = '/static/offline.html';

const PRECACHE_URLS = [
    OFFLINE_URL,
    '/static/pages/offline.css',
    '/static/pages/pwa.css',
    '/static/manifest.json',
    '/static/icons/favicon-16x16.png',
    '/static/icons/favicon-32x32.png',
    '/static/icons/apple-touch-icon.png',
    '/static/icons/icon-192x192.png',
    '/static/icons/icon-512x512.png',
    '/static/icons/mstile-150x150.png',
    '/static/vendor/fonts.css',
    '/static/bootstrap.js',
    '/static/i18n-runtime.js',
    '/static/interface-theme.js',
    '/static/modules/pwa-runtime.js',
    '/static/modules/service-worker-update.js',
];

const CACHEABLE_NAVIGATION_PATHS = new Set([
    '/',
    '/chat',
    '/search',
    '/support/feedback',
]);

const CACHEABLE_API_PATHS = new Set([
    '/api/web_push/public_key',
]);

function sameOrigin(url) {
    return url.origin === self.location.origin;
}

function isStaticAsset(url) {
    return sameOrigin(url) && url.pathname.startsWith('/static/');
}

function isCacheableApi(url) {
    return sameOrigin(url) && CACHEABLE_API_PATHS.has(url.pathname);
}

function isNavigationRequest(request) {
    return request.mode === 'navigate'
        || (request.headers.get('accept') || '').includes('text/html');
}

function shouldCacheNavigation(request, response) {
    if (!response || response.status !== 200 || response.type !== 'basic' || response.redirected) {
        return false;
    }
    const requestUrl = new URL(request.url);
    if (!CACHEABLE_NAVIGATION_PATHS.has(requestUrl.pathname)) {
        return false;
    }
    if (requestUrl.searchParams.has('reset_client')) {
        return false;
    }
    const contentType = response.headers.get('content-type') || '';
    return contentType.includes('text/html');
}

function shouldCacheResponse(response) {
    return response && response.status === 200 && response.type === 'basic';
}

function shouldPreferFreshStatic(url) {
    return /\.(?:css|html|js|json|mjs|webmanifest)$/i.test(url.pathname);
}

async function cacheCoreAssets() {
    const cache = await caches.open(PRECACHE);
    await Promise.allSettled(
        PRECACHE_URLS.map((url) => {
            const request = new Request(url, { cache: 'reload' });
            return fetch(request).then((response) => {
                if (shouldCacheResponse(response)) {
                    return cache.put(request, response);
                }
                return null;
            });
        }),
    );
}

async function deleteOldCaches() {
    const cacheNames = await caches.keys();
    await Promise.all(
        cacheNames.map((cacheName) => {
            const isCurrent = cacheName === PRECACHE
                || cacheName === RUNTIME
                || cacheName === NAVIGATION
                || cacheName === API;
            if (cacheName.startsWith(CACHE_PREFIX) && !isCurrent) {
                return caches.delete(cacheName);
            }
            if (cacheName.startsWith(LEGACY_CACHE_PREFIX)) {
                return caches.delete(cacheName);
            }
            return null;
        }),
    );
}

async function clearPrivateRuntimeCaches() {
    const cacheNames = await caches.keys();
    await Promise.all(
        cacheNames.map((cacheName) => {
            if (!cacheName.startsWith(CACHE_PREFIX)) {
                return null;
            }
            if (cacheName.startsWith(`${CACHE_PREFIX}precache-`)) {
                return null;
            }
            return caches.delete(cacheName);
        }),
    );
}

async function cacheStaticAsset(request) {
    const cached = await caches.match(request);
    const cache = await caches.open(RUNTIME);
    const networkPromise = fetch(request).then((response) => {
        if (shouldCacheResponse(response)) {
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    });

    if (cached) {
        networkPromise.catch(() => {});
        return cached;
    }
    return networkPromise;
}

async function networkFirstStaticAsset(request) {
    const cache = await caches.open(RUNTIME);
    try {
        const response = await fetch(request);
        if (shouldCacheResponse(response)) {
            await cache.put(request, response.clone());
        }
        return response;
    } catch (_error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        return Response.error();
    }
}

async function cacheApiRequest(request) {
    const cache = await caches.open(API);
    try {
        const response = await fetch(request);
        if (shouldCacheResponse(response)) {
            await cache.put(request, response.clone());
        }
        return response;
    } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        throw error;
    }
}

async function cacheNavigationRequest(request) {
    const cache = await caches.open(NAVIGATION);
    try {
        const response = await fetch(request);
        if (shouldCacheNavigation(request, response)) {
            const requestUrl = new URL(request.url);
            const responseForRequest = response.clone();
            const responseForCanonical = response.clone();
            await cache.put(request, responseForRequest);
            if (requestUrl.pathname === '/chat') {
                await cache.put(new Request('/chat'), responseForCanonical);
            } else if (requestUrl.pathname === '/') {
                await cache.put(new Request('/'), responseForCanonical);
            }
        }
        return response;
    } catch (_error) {
        const requestUrl = new URL(request.url);
        return (await cache.match(request))
            || (requestUrl.pathname === '/chat' ? await cache.match('/chat') : null)
            || (await cache.match('/chat'))
            || (await cache.match('/'))
            || (await caches.match(OFFLINE_URL))
            || Response.error();
    }
}

async function broadcastMessage(message) {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clients.forEach((client) => {
        try {
            client.postMessage(message);
        } catch (_error) {}
    });
}

self.addEventListener('install', (event) => {
    event.waitUntil(
        cacheCoreAssets()
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        deleteOldCaches()
            .then(() => self.clients.claim()),
    );
});

self.addEventListener('message', (event) => {
    const data = event.data || {};
    if (data.type === 'SKIP_WAITING') {
        self.skipWaiting();
        return;
    }
    if (data.type === 'CLEAR_PRIVATE_CACHES') {
        event.waitUntil(clearPrivateRuntimeCaches());
    }
});

self.addEventListener('fetch', (event) => {
    const request = event.request;
    if (!request || request.method !== 'GET') return;

    const url = new URL(request.url);
    if (!sameOrigin(url)) return;
    if (url.pathname === '/service-worker.js') return;

    if (isNavigationRequest(request)) {
        event.respondWith(cacheNavigationRequest(request));
        return;
    }

    if (isCacheableApi(url)) {
        event.respondWith(cacheApiRequest(request));
        return;
    }

    if (isStaticAsset(url)) {
        event.respondWith(
            shouldPreferFreshStatic(url)
                ? networkFirstStaticAsset(request)
                : cacheStaticAsset(request),
        );
    }
});

self.addEventListener('sync', (event) => {
    if (event.tag !== 'sun-outbox-sync') return;
    event.waitUntil(
        broadcastMessage({
            type: 'SUN_BACKGROUND_SYNC',
            tag: event.tag,
        }),
    );
});

self.addEventListener('push', (event) => {
    const payload = (() => {
        try {
            return event.data ? event.data.json() : {};
        } catch (_error) {
            return {};
        }
    })();
    const title = String(payload.title || 'SUN Messenger');
    const body = String(payload.body || '');
    const url = String(payload.url || '/chat');
    const icon = String(payload.icon || '/static/icons/icon-192x192.png');
    const badge = String(payload.badge || '/static/icons/icon-192x192.png');
    const tag = String(payload.tag || 'sun-message');
    const chatId = payload.chat_id ? String(payload.chat_id) : null;
    const callId = payload.call_id ? String(payload.call_id) : null;
    const requireInteraction = Boolean(payload.requireInteraction);

    event.waitUntil(
        self.registration.showNotification(title, {
            body,
            icon,
            badge,
            tag,
            renotify: false,
            requireInteraction,
            data: { url, chat_id: chatId, call_id: callId },
        }),
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const notifData = event.notification?.data || {};
    const destination = String(notifData.url || '/chat');
    const chatId = notifData.chat_id ? String(notifData.chat_id) : null;

    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
            const origin = self.location.origin;
            const normalizedDestination = destination.startsWith('http')
                ? destination
                : `${origin}${destination.startsWith('/') ? destination : `/${destination}`}`;
            let destinationUrl = null;
            try {
                destinationUrl = new URL(normalizedDestination);
            } catch (_error) {
                destinationUrl = null;
            }

            function focusAndOpenChat(client) {
                const focusPromise = client.focus ? client.focus() : Promise.resolve(client);
                if (!chatId) return focusPromise;
                return focusPromise.then((focusedClient) => {
                    const target = focusedClient || client;
                    if (target && typeof target.postMessage === 'function') {
                        target.postMessage({ action: 'open_chat', chat_id: chatId });
                    }
                    return target;
                });
            }

            for (const client of clients) {
                if (!('focus' in client)) continue;
                if (client.url === normalizedDestination) {
                    return focusAndOpenChat(client);
                }
                if (destinationUrl) {
                    try {
                        const clientUrl = new URL(client.url);
                        const sameChatShell = clientUrl.origin === destinationUrl.origin
                            && clientUrl.pathname === destinationUrl.pathname
                            && destinationUrl.pathname.endsWith('/chat');
                        if (sameChatShell) {
                            if ('navigate' in client) {
                                return client.navigate(normalizedDestination).then((navigatedClient) => {
                                    return focusAndOpenChat(navigatedClient || client);
                                });
                            }
                            return focusAndOpenChat(client);
                        }
                    } catch (_error) {}
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(normalizedDestination);
            }
            return null;
        }),
    );
});
