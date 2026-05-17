(function () {
    const RELOAD_MARKER = 'sun.legacyCacheCleanupReloaded.v1';

    function isSunServiceWorkerRegistration(registration) {
        const scriptUrl = registration.active?.scriptURL
            || registration.waiting?.scriptURL
            || registration.installing?.scriptURL
            || '';
        return scriptUrl.includes('/static/service-worker.js') || scriptUrl.includes('/service-worker.js');
    }

    async function clearLegacySunCache() {
        let cleared = false;

        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            await Promise.all(registrations.map((registration) => {
                if (!isSunServiceWorkerRegistration(registration)) {
                    return null;
                }
                cleared = true;
                return registration.unregister();
            }));
        }

        if ('caches' in window) {
            const keys = await caches.keys();
            const sunCacheKeys = keys.filter((key) => key.startsWith('sunmessenger-cache-'));
            if (sunCacheKeys.length > 0) {
                cleared = true;
            }
            await Promise.all(sunCacheKeys.map((key) => caches.delete(key)));
        }

        if (
            cleared
            && navigator.serviceWorker?.controller
            && window.sessionStorage?.getItem(RELOAD_MARKER) !== '1'
        ) {
            window.sessionStorage.setItem(RELOAD_MARKER, '1');
            window.location.reload();
            return;
        }

        window.sessionStorage?.removeItem(RELOAD_MARKER);
    }

    clearLegacySunCache().catch(() => {});
    window.addEventListener('load', () => {
        clearLegacySunCache().catch(() => {});
    }, { once: true });
})();
