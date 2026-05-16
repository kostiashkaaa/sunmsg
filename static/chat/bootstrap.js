export async function initChatBootstrap({ restoreWrappedPrivateKey, initSunRipple }) {
    const bootstrapData = window.SUN_BOOTSTRAP || {};
    const bootstrapUser = bootstrapData.user || {};
    const bootstrapSocketConfig = bootstrapData.socketio || window.SUN_SOCKETIO_CONFIG || {};

    await restoreWrappedPrivateKey();
    initSunRipple();

    return {
        bootstrapData,
        bootstrapUser,
        bootstrapSocketConfig,
    };
}
