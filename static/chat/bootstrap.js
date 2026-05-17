const PRIVATE_KEY_BOOT_RESTORE_TIMEOUT_MS = 1200;

async function restorePrivateKeyForBoot(restoreWrappedPrivateKey, timeoutMs) {
    if (typeof restoreWrappedPrivateKey !== 'function') return false;

    let timeoutId = 0;
    try {
        await Promise.race([
            Promise.resolve().then(() => restoreWrappedPrivateKey()),
            new Promise((resolve) => {
                timeoutId = setTimeout(resolve, Math.max(0, Number(timeoutMs) || 0));
            }),
        ]);
        return true;
    } catch (error) {
        console.warn('[ChatBootstrap] private key restore failed during boot', error);
        return false;
    } finally {
        if (timeoutId) clearTimeout(timeoutId);
    }
}

export async function initChatBootstrap({
    restoreWrappedPrivateKey,
    initSunRipple,
    privateKeyRestoreTimeoutMs = PRIVATE_KEY_BOOT_RESTORE_TIMEOUT_MS,
}) {
    const bootstrapData = window.SUN_BOOTSTRAP || {};
    const bootstrapUser = bootstrapData.user || {};
    const bootstrapSocketConfig = bootstrapData.socketio || window.SUN_SOCKETIO_CONFIG || {};

    await restorePrivateKeyForBoot(restoreWrappedPrivateKey, privateKeyRestoreTimeoutMs);
    initSunRipple();

    return {
        bootstrapData,
        bootstrapUser,
        bootstrapSocketConfig,
    };
}
