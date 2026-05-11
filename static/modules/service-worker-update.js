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

    const onControllerChange = () => {
        if (!hadControllerOnBind || reloadedAfterControllerChange) {
            return;
        }
        reloadedAfterControllerChange = true;
        window.location.reload();
    };

    const triggerUpdateCheck = () => {
        void safeRegistrationUpdate(registration);
    };

    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange);
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
        document.removeEventListener('visibilitychange', onVisibilityChange);
        window.clearInterval(intervalId);
    };
}
