// auth-fetch.js - fetch wrapper with single-flight refresh on 401.
// Exposes window.authFetch and window.refreshSession.

import { getCsrfToken, setCsrfToken } from './csrf.js';
import { withAppRoot } from './app-url.js';

let refreshInFlight = null;

function resolveFetchInput(input) {
    if (typeof input === 'string') {
        return withAppRoot(input);
    }
    return input;
}

export async function refreshSession() {
    if (refreshInFlight) return refreshInFlight;
    refreshInFlight = (async () => {
        try {
            const res = await fetch(withAppRoot('/api/refresh'), {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
            });
            if (!res.ok) return false;
            const data = await res.json().catch(() => null);
            if (!data || !data.success) return false;
            if (typeof data.csrf_token === 'string' && data.csrf_token) {
                setCsrfToken(data.csrf_token);
            }
            return true;
        } catch (_) {
            return false;
        } finally {
            setTimeout(() => {
                refreshInFlight = null;
            }, 0);
        }
    })();
    return refreshInFlight;
}

export async function authFetch(input, init) {
    const requestInput = resolveFetchInput(input);
    const opts = Object.assign({ credentials: 'same-origin' }, init || {});
    const response = await fetch(requestInput, opts);
    if (response.status !== 401) return response;

    const ok = await refreshSession();
    if (!ok) {
        try {
            window.location.href = withAppRoot('/');
        } catch (_) {}
        return response;
    }

    const retryOpts = Object.assign({}, opts);
    if (retryOpts.headers) {
        const refreshedToken = getCsrfToken();
        if (refreshedToken) {
            const nextHeaders = retryOpts.headers instanceof Headers
                ? new Headers(retryOpts.headers)
                : Object.assign({}, retryOpts.headers);
            if (nextHeaders instanceof Headers) {
                if (nextHeaders.has('X-CSRFToken')) {
                    nextHeaders.set('X-CSRFToken', refreshedToken);
                }
            } else if ('X-CSRFToken' in nextHeaders) {
                nextHeaders['X-CSRFToken'] = refreshedToken;
            }
            retryOpts.headers = nextHeaders;
        }
    }
    return fetch(requestInput, retryOpts);
}

window.authFetch = authFetch;
window.refreshSession = refreshSession;
