const CACHE_NAME = 'sunmessenger-cache-v3';
const urlsToCache = [
    '/static/icons/icon-192x192.png',
    '/static/icons/icon-512x512.png',
];
const STATIC_PREFIX = '/static/';
const VERSION_QUERY_PARAM = 'v';
const MAX_STATIC_CACHE_ENTRIES = 180;
const MAX_CACHEABLE_RESPONSE_BYTES = 2 * 1024 * 1024;

function shouldCacheStaticRequest(url) {
    if (!(url instanceof URL)) {
        return false;
    }
    if (url.origin !== self.location.origin) {
        return false;
    }
    if (!url.pathname.startsWith(STATIC_PREFIX)) {
        return false;
    }
    return url.searchParams.has(VERSION_QUERY_PARAM);
}

async function canPersistResponse(response) {
    if (!response || !response.ok) {
        return false;
    }
    if (response.type !== 'basic') {
        return false;
    }
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_CACHEABLE_RESPONSE_BYTES) {
        return false;
    }
    return true;
}

async function pruneStaticCache(cache) {
    const keys = await cache.keys();
    const overflow = keys.length - MAX_STATIC_CACHE_ENTRIES;
    if (overflow <= 0) {
        return;
    }
    for (let index = 0; index < overflow; index += 1) {
        await cache.delete(keys[index]);
    }
}

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(urlsToCache);
        })
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') {
        return;
    }

    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then(async (response) => {
                if (shouldCacheStaticRequest(url) && await canPersistResponse(response)) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(async (cache) => {
                        cache.put(event.request, responseClone);
                        await pruneStaticCache(cache);
                    });
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});

self.addEventListener('activate', (event) => {
    const cacheWhitelist = [CACHE_NAME];
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheWhitelist.indexOf(cacheName) === -1) {
                        return caches.delete(cacheName);
                    }
                    return null;
                })
            ))
            .then(() => self.clients.claim())
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

    event.waitUntil(
        self.registration.showNotification(title, {
            body,
            icon,
            badge,
            tag,
            data: { url },
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const destination = String(event.notification?.data?.url || '/chat');
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

            for (const client of clients) {
                if (!('focus' in client)) continue;
                if (client.url === normalizedDestination) {
                    return client.focus();
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
                                    return (navigatedClient || client).focus();
                                });
                            }
                            return client.focus();
                        }
                    } catch (_error) {}
                }
            }
            if (self.clients.openWindow) {
                return self.clients.openWindow(normalizedDestination);
            }
            return null;
        })
    );
});
