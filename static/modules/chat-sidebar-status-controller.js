export function createSidebarStatusController({
    computeSidebarStatusSnapshot = () => ({}),
    runSidebarStatusActionFn = () => {},
    syncSidebarStatusBarFn = () => {},
    getHasNetwork = () => true,
    getSocketConnected = () => false,
    getHasSocketConnectedOnce = () => false,
    getHasSocketConnectionIssue = () => false,
    setSocketConnectionIssue = () => {},
    socketConnect = () => {},
    reportActivity = () => {},
    getVisibilityState = () => 'visible',
    getHasPrivateKey = () => false,
    openDeviceQrHub = null,
    openMyQrModal = null,
    openSettingsOverlay = null,
    showToast = () => {},
    sidebarElements = {},
} = {}) {
    function getSidebarStatusSnapshot() {
        return computeSidebarStatusSnapshot({
            hasNetwork: getHasNetwork(),
            socketConnected: getSocketConnected(),
            hasSocketConnectedOnce: getHasSocketConnectedOnce(),
            hasSocketConnectionIssue: getHasSocketConnectionIssue(),
        });
    }

    function runSidebarStatusAction(action, { silent = false } = {}) {
        runSidebarStatusActionFn(
            action,
            {
                getHasNetwork,
                syncSidebarStatusBar,
                showToast,
                isSocketConnected: getSocketConnected,
                setSocketConnectionIssue,
                socketConnect,
                reportActivity,
                getVisibilityState,
                getHasPrivateKey,
                openDeviceQrHub,
                openMyQrModal,
                openSettingsOverlay,
            },
            { silent },
        );
    }

    function syncSidebarStatusBar() {
        const snapshot = getSidebarStatusSnapshot();
        syncSidebarStatusBarFn(sidebarElements, snapshot);
    }

    return {
        getSidebarStatusSnapshot,
        runSidebarStatusAction,
        syncSidebarStatusBar,
    };
}
