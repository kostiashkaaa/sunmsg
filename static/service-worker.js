const CACHE_PREFIX = 'sunmessenger-cache-';

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(Promise.resolve());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => Promise.all(
                cacheNames.map((cacheName) => {
                    if (cacheName.startsWith(CACHE_PREFIX)) {
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
    const chatId = payload.chat_id ? String(payload.chat_id) : null;
    const callId = payload.call_id ? String(payload.call_id) : null;
    const requireInteraction = Boolean(payload.requireInteraction);

    event.waitUntil(
        self.registration.showNotification(title, {
            body,
            icon,
            badge,
            tag,
            requireInteraction,
            data: { url, chat_id: chatId, call_id: callId },
        })
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
        })
    );
});
