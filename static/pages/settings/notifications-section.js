import { ensurePwaServiceWorkerRegistration } from '../../modules/pwa-runtime.js';

function base64UrlToUint8Array(base64Url) {
    const text = String(base64Url || '').trim();
    const padding = '='.repeat((4 - (text.length % 4)) % 4);
    const base64 = (text + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = window.atob(base64);
    const output = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i += 1) {
        output[i] = raw.charCodeAt(i);
    }
    return output;
}

export function initNotificationsSection({ api, tr, showAlert }) {
    const permissionEl = document.getElementById('pushPermissionState');
    const subscriptionEl = document.getElementById('pushSubscriptionState');
    const enableBtn = document.getElementById('enablePushBtn');
    const disableBtn = document.getElementById('disablePushBtn');

    if (!permissionEl || !subscriptionEl || !enableBtn || !disableBtn) {
        return {
            loadPushState: async () => {},
        };
    }

    const supportAvailable = () => (
        window.isSecureContext
        && 'serviceWorker' in navigator
        && 'PushManager' in window
        && 'Notification' in window
    );

    let registration = null;
    let pushConfig = null;
    let pushLifecycleSeq = 0;

    async function ensureRegistration() {
        if (!supportAvailable()) return null;
        if (registration) return registration;
        registration = await ensurePwaServiceWorkerRegistration();
        return registration;
    }

    async function ensurePushConfig() {
        if (pushConfig) return pushConfig;
        pushConfig = await api.getWebPushPublicKey();
        return pushConfig;
    }

    async function getCurrentSubscription() {
        const reg = await ensureRegistration();
        if (!reg) return null;
        return reg.pushManager.getSubscription();
    }

    function setButtonsState({ busy = false, canEnable = false, canDisable = false } = {}) {
        enableBtn.disabled = busy || !canEnable;
        disableBtn.disabled = busy || !canDisable;
    }

    async function loadPushState() {
        const loadSeq = ++pushLifecycleSeq;
        if (!supportAvailable()) {
            permissionEl.textContent = tr('Недоступно в этом браузере или в небезопасном контексте.');
            subscriptionEl.textContent = tr('Недоступно');
            setButtonsState({ canEnable: false, canDisable: false });
            return;
        }

        setButtonsState({ busy: true });
        try {
            const config = await ensurePushConfig();
            if (loadSeq !== pushLifecycleSeq) return;
            if (!config?.enabled) {
                permissionEl.textContent = tr('Отключено на сервере');
                subscriptionEl.textContent = tr('Недоступно');
                setButtonsState({ canEnable: false, canDisable: false });
                return;
            }

            const permission = Notification.permission;
            const subscription = await getCurrentSubscription();
            if (loadSeq !== pushLifecycleSeq) return;

            permissionEl.textContent = permission;
            subscriptionEl.textContent = subscription
                ? tr('Подписка активна')
                : tr('Подписка не активна');

            setButtonsState({
                canEnable: permission !== 'denied' && !subscription,
                canDisable: Boolean(subscription),
            });
        } catch (_err) {
            if (loadSeq !== pushLifecycleSeq) return;
            permissionEl.textContent = tr('Ошибка');
            subscriptionEl.textContent = tr('Ошибка');
            setButtonsState({ canEnable: false, canDisable: false });
        }
    }

    async function enablePush() {
        const actionSeq = ++pushLifecycleSeq;
        if (!supportAvailable()) {
            showAlert('Push не поддерживается в этом браузере.', 'warning');
            return;
        }

        setButtonsState({ busy: true });
        try {
            const config = await ensurePushConfig();
            if (actionSeq !== pushLifecycleSeq) return;
            if (!config?.enabled || !config?.publicKey) {
                showAlert('Push отключен на стороне сервера.', 'warning');
                await loadPushState();
                return;
            }

            let permission = Notification.permission;
            if (permission !== 'granted') {
                permission = await Notification.requestPermission();
                if (actionSeq !== pushLifecycleSeq) return;
            }
            if (permission !== 'granted') {
                showAlert('Разрешение на уведомления не выдано.', 'warning');
                await loadPushState();
                return;
            }

            const reg = await ensureRegistration();
            let subscription = await reg.pushManager.getSubscription();
            if (actionSeq !== pushLifecycleSeq) return;
            if (!subscription) {
                subscription = await reg.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: base64UrlToUint8Array(config.publicKey),
                });
                if (actionSeq !== pushLifecycleSeq) return;
            }

            await api.subscribeWebPush(subscription.toJSON());
            if (actionSeq !== pushLifecycleSeq) return;
            showAlert('Push-уведомления включены.', 'success');
            await loadPushState();
        } catch (err) {
            if (actionSeq !== pushLifecycleSeq) return;
            showAlert(String(err?.message || 'Не удалось включить push-уведомления.'), 'danger');
            await loadPushState();
        }
    }

    async function disablePush() {
        const actionSeq = ++pushLifecycleSeq;
        if (!supportAvailable()) return;

        setButtonsState({ busy: true });
        try {
            const subscription = await getCurrentSubscription();
            if (actionSeq !== pushLifecycleSeq) return;
            const endpoint = String(subscription?.endpoint || '').trim();
            if (subscription) {
                try {
                    await subscription.unsubscribe();
                } catch (_) {}
            }
            await api.unsubscribeWebPush(endpoint || undefined);
            if (actionSeq !== pushLifecycleSeq) return;
            showAlert('Push-уведомления отключены.', 'success');
            await loadPushState();
        } catch (err) {
            if (actionSeq !== pushLifecycleSeq) return;
            showAlert(String(err?.message || 'Не удалось отключить push-уведомления.'), 'danger');
            await loadPushState();
        }
    }

    enableBtn.addEventListener('click', () => {
        enablePush();
    });
    disableBtn.addEventListener('click', () => {
        disablePush();
    });

    loadPushState();

    return {
        loadPushState,
    };
}
