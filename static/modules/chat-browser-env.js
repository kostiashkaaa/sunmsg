export function createChatBrowserEnv(windowRef = window, fallbackFetch = fetch) {
    const getFetch = () => windowRef.fetch?.bind(windowRef) || fallbackFetch;
    const getAuthFetch = () => windowRef.authFetch || getFetch();
    const getWebPushConfig = () => windowRef.SUN_BOOTSTRAP?.app?.webPush || windowRef.SUN_WEB_PUSH_CONFIG || {};
    const getLocationSearch = () => windowRef.location?.search || '';
    const getCurrentUserPublicKey = () => windowRef.currentUserPublicKey;
    const getCurrentDisplayName = () => windowRef.currentDisplayName;
    const getCurrentUsername = () => windowRef.currentUsername;
    const getCurrentAvatarUrl = () => windowRef.currentAvatarUrl;
    const getLocalStorage = () => windowRef.localStorage;
    const getSessionStorage = () => windowRef.sessionStorage;
    const setTimeoutFn = (...args) => windowRef.setTimeout(...args);
    const matchMedia = (query) => windowRef.matchMedia?.(query);
    const isMobileWidth = (maxWidth = 768) => windowRef.innerWidth <= maxWidth;
    const isCoarsePointer = () => Boolean(matchMedia('(pointer: coarse)')?.matches);

    function scheduleIdleTask(callback, { timeout = 1200, fallbackDelayMs = 0 } = {}) {
        if (typeof windowRef.requestIdleCallback === 'function') {
            windowRef.requestIdleCallback(() => callback(), { timeout });
            return;
        }
        setTimeoutFn(callback, fallbackDelayMs);
    }

    return {
        getFetch,
        getAuthFetch,
        getWebPushConfig,
        getLocationSearch,
        getCurrentUserPublicKey,
        getCurrentDisplayName,
        getCurrentUsername,
        getCurrentAvatarUrl,
        getLocalStorage,
        getSessionStorage,
        removeFavoriteChatsSnapshot: () => getLocalStorage()?.removeItem('sun.favorite_chats.v1'),
        scheduleIdleTask,
        setTimeout: setTimeoutFn,
        closeCommandPalette: () => windowRef.closeCommandPalette?.(),
        switchSidebarTab: (...args) => windowRef.switchSidebarTab?.(...args),
        openDeviceQrHub: (...args) => windowRef.openDeviceQrHub?.(...args),
        openMyQrModal: (...args) => windowRef.openMyQrModal?.(...args),
        openSettingsOverlay: (...args) => windowRef.openSettingsOverlay?.(...args),
        matchMedia,
        isMobileWidth,
        isCoarsePointer,
        getResizeObserverCtor: () => windowRef.ResizeObserver,
        openLightbox: (...args) => windowRef._openLightbox?.(...args),
    };
}
