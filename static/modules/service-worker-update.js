const DEFAULT_UPDATE_INTERVAL_MS = 5 * 60 * 1000;
const BOUND_REGISTRATIONS = new WeakSet();

async function safeRegistrationUpdate(registration) {
    if (!registration || typeof registration.update !== 'function') {
        return;
    }
    try {
        await registration.update();
    } catch (_error) {
        // Non-blocking: periodic update checks should not break page logic.
    }
}

export function bindServiceWorkerUpdateLifecycle({
    registration,
    updateIntervalMs = DEFAULT_UPDATE_INTERVAL_MS,
    onUpdateReady = null,
    autoReload = false,
    reloadDelayMs = 1200,
} = {}) {
    if (!registration || !window.isSecureContext || !('serviceWorker' in navigator)) {
        return () => {};
    }
    if (BOUND_REGISTRATIONS.has(registration)) {
        return () => {};
    }
    BOUND_REGISTRATIONS.add(registration);

    const hadControllerOnBind = Boolean(navigator.serviceWorker.controller);
    let reloadedAfterControllerChange = false;
    let notifiedUpdateReady = false;

    const notifyUpdateReady = (reason) => {
        if (notifiedUpdateReady) return;
        notifiedUpdateReady = true;
        const detail = { registration, reason };
        if (typeof onUpdateReady === 'function') {
            try { onUpdateReady(detail); } catch (_error) {}
        }
        window.dispatchEvent(new CustomEvent('sun-service-worker-update-ready', { detail }));
    };

    const activateWaitingWorker = () => {
        const waitingWorker = registration.waiting;
        if (waitingWorker && typeof waitingWorker.postMessage === 'function') {
            waitingWorker.postMessage({ type: 'SKIP_WAITING' });
        }
    };

    const onControllerChange = () => {
        if (!hadControllerOnBind || reloadedAfterControllerChange) {
            return;
        }
        reloadedAfterControllerChange = true;
        notifyUpdateReady('controllerchange');
        if (autoReload) {
            window.setTimeout(() => {
                window.location.reload();
            }, Math.max(0, Number(reloadDelayMs) || 0));
        }
    };

    const triggerUpdateCheck = () => {
        void safeRegistrationUpdate(registration);
    };

    const bindInstallingWorker = (worker) => {
        if (!worker || typeof worker.addEventListener !== 'function') return;
        worker.addEventListener('statechange', () => {
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                notifyUpdateReady('installed');
                activateWaitingWorker();
            }
        });
    };

    const onUpdateFound = () => {
        bindInstallingWorker(registration.installing);
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
    registration.addEventListener?.('updatefound', onUpdateFound);
    if (registration.waiting && navigator.serviceWorker.controller) {
        notifyUpdateReady('waiting');
        activateWaitingWorker();
    }
    triggerUpdateCheck();

    const intervalId = window.setInterval(triggerUpdateCheck, Math.max(30000, Number(updateIntervalMs) || DEFAULT_UPDATE_INTERVAL_MS));
    const onVisibilityChange = () => {
        if (document.visibilityState === 'visible') {
            triggerUpdateCheck();
        }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
        BOUND_REGISTRATIONS.delete(registration);
        navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange);
        registration.removeEventListener?.('updatefound', onUpdateFound);
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.clearInterval(intervalId);
    };
}
