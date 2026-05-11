import { getCsrfToken } from './csrf.js';
import { bindServiceWorkerUpdateLifecycle } from './service-worker-update.js';

const PROMPT_ONCE_KEY = 'sun_web_push_prompted_v1';

function base64UrlToUint8Array(base64Url) {
    const text = String(base64Url || '').trim();
    const padding = '='.repeat((4 - (text.length % 4)) % 4);
    const base64 = (text + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
        output[i] = raw.charCodeAt(i);
    }
    return output;
}

async function postJson(authFetch, url, payload) {
    return authFetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRFToken': getCsrfToken(),
        },
        body: JSON.stringify(payload || {}),
    });
}

export async function initWebPush({
    authFetch,
    showToast = () => {},
    config = {},
} = {}) {
    const enabled = Boolean(config?.enabled);
    const publicKey = String(config?.publicKey || '').trim();
    if (!enabled || !publicKey) return;
    if (!window.isSecureContext) return;
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
        return;
    }
    if (typeof authFetch !== 'function') return;

    let registration = null;
    try {
        registration = await navigator.serviceWorker.register('/service-worker.js', { scope: '/' });
        bindServiceWorkerUpdateLifecycle({ registration });
    } catch (_error) {
        return;
    }

    async function syncSubscription() {
        if (!registration) return;
        const permission = Notification.permission;
        const existingSubscription = await registration.pushManager.getSubscription();

        if (permission !== 'granted') {
            if (existingSubscription) {
                const endpoint = String(existingSubscription.endpoint || '').trim();
                try { await existingSubscription.unsubscribe(); } catch (_error) {}
                if (endpoint) {
                    await postJson(authFetch, '/api/web_push/unsubscribe', { endpoint });
                }
            }
            return;
        }

        let subscription = existingSubscription;
        if (!subscription) {
            subscription = await registration.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: base64UrlToUint8Array(publicKey),
            });
        }

        await postJson(authFetch, '/api/web_push/subscribe', {
            subscription: subscription.toJSON(),
        });
    }

    try {
        await syncSubscription();
    } catch (_error) {
        // Non-blocking: push is optional.
    }

    if (Notification.permission !== 'default') return;
    if (localStorage.getItem(PROMPT_ONCE_KEY) === '1') return;

    const requestOnce = async () => {
        localStorage.setItem(PROMPT_ONCE_KEY, '1');
        try {
            const permission = await Notification.requestPermission();
            if (permission === 'granted') {
                await syncSubscription();
                showToast('Push-уведомления включены.', 'success');
            }
        } catch (_error) {
            // Ignore and keep chat flow uninterrupted.
        }
    };

    document.addEventListener(
        'click',
        () => {
            void requestOnce();
        },
        { once: true, passive: true },
    );
}
