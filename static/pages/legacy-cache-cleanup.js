(function () {
            function clearLegacySunCache() {
                if ('serviceWorker' in navigator) {
                    navigator.serviceWorker.getRegistrations()
                        .then((registrations) => Promise.all(registrations.map((registration) => {
                            const scriptUrl = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || '';
                            if (scriptUrl.includes('/static/service-worker.js') || scriptUrl.includes('/service-worker.js')) {
                                return registration.unregister();
                            }
                            return null;
                        })))
                        .catch(() => {});
                }
                if ('caches' in window) {
                    caches.keys()
                        .then((keys) => Promise.all(keys
                            .filter((key) => key.startsWith('sunmessenger-cache-'))
                            .map((key) => caches.delete(key))))
                        .catch(() => {});
                }
            }

            window.addEventListener('load', clearLegacySunCache, { once: true });
        })();
