export async function initChatBootstrap({ restoreWrappedPrivateKey, initTelegramRipple }) {
    const bootstrapData = window.SUN_BOOTSTRAP || {};
    const bootstrapUser = bootstrapData.user || {};
    const bootstrapSocketConfig = bootstrapData.socketio || window.SUN_SOCKETIO_CONFIG || {};

    await restoreWrappedPrivateKey();
    initTelegramRipple();

    return {
        bootstrapData,
        bootstrapUser,
        bootstrapSocketConfig,
    };
}
