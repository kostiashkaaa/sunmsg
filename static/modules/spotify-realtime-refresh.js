import { withAppRoot } from './app-url.js';
import { getCsrfToken } from './csrf.js';

const SPOTIFY_REFRESH_INTERVAL_MS = 2500;
const SPOTIFY_REFRESH_RETRY_MS = 15000;

export function initSpotifyRealtimeRefresh({
    fetchImpl = globalThis.fetch?.bind(globalThis),
    documentRef = globalThis.document,
} = {}) {
    if (typeof fetchImpl !== 'function' || !documentRef) {
        return { refreshNow: () => Promise.resolve(), stop: () => {} };
    }

    let refreshTimer = 0;
    let stopped = false;
    let inFlight = false;

    function clearRefreshTimer() {
        if (!refreshTimer) return;
        globalThis.clearTimeout(refreshTimer);
        refreshTimer = 0;
    }

    function isVisible() {
        return documentRef.visibilityState !== 'hidden';
    }

    function stop() {
        stopped = true;
        clearRefreshTimer();
        documentRef.removeEventListener?.('visibilitychange', handleVisibilityChange);
    }

    function scheduleRefresh(delayMs = SPOTIFY_REFRESH_INTERVAL_MS) {
        clearRefreshTimer();
        if (stopped || !isVisible()) return;
        refreshTimer = globalThis.setTimeout(() => {
            refreshTimer = 0;
            void refreshNow();
        }, Math.max(0, Number(delayMs) || 0));
    }

    async function refreshNow() {
        if (stopped || inFlight || !isVisible()) return;
        inFlight = true;
        try {
            const response = await fetchImpl(withAppRoot('/spotify/refresh'), {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    Accept: 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
            });
            if (response.status === 401) {
                stop();
                return;
            }

            const payload = await response.json().catch(() => null);
            if (!response.ok || !payload?.success) {
                scheduleRefresh(SPOTIFY_REFRESH_RETRY_MS);
                return;
            }
            if (payload.configured === false || payload.connected === false) {
                stop();
                return;
            }
            scheduleRefresh(SPOTIFY_REFRESH_INTERVAL_MS);
        } catch (_) {
            scheduleRefresh(SPOTIFY_REFRESH_RETRY_MS);
        } finally {
            inFlight = false;
        }
    }

    function handleVisibilityChange() {
        if (!isVisible()) {
            clearRefreshTimer();
            return;
        }
        scheduleRefresh(0);
    }

    documentRef.addEventListener?.('visibilitychange', handleVisibilityChange);
    scheduleRefresh(0);

    return { refreshNow, stop };
}
