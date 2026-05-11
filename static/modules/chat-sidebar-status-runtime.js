import { createSidebarStatusController } from './chat-sidebar-status-controller.js';

export function createChatSidebarStatusRuntime({
    windowRef = window,
    computeSidebarStatusSnapshot,
    runSidebarStatusActionFn,
    syncSidebarStatusBarFn,
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
    sidebarProfileShortcut = null,
    sidebarStatusBar = null,
    sidebarStatusSettingsBtn = null,
    sidebarElements = {},
    syncChatConnectionStatus = () => {},
} = {}) {
    const sidebarStatusController = createSidebarStatusController({
        computeSidebarStatusSnapshot,
        runSidebarStatusActionFn,
        syncSidebarStatusBarFn,
        getHasNetwork,
        getSocketConnected,
        getHasSocketConnectedOnce,
        getHasSocketConnectionIssue,
        setSocketConnectionIssue,
        socketConnect,
        reportActivity,
        getVisibilityState,
        getHasPrivateKey,
        openDeviceQrHub,
        openMyQrModal,
        openSettingsOverlay,
        showToast,
        sidebarElements,
    });

    function getSidebarStatusSnapshot() {
        return sidebarStatusController?.getSidebarStatusSnapshot() || {};
    }

    function runSidebarStatusAction(action, { silent = false } = {}) {
        sidebarStatusController?.runSidebarStatusAction(action, { silent });
    }

    function syncSidebarStatusBar() {
        sidebarStatusController?.syncSidebarStatusBar();
    }

    sidebarProfileShortcut?.addEventListener('click', () => {
        openSettingsOverlay?.('settings');
    });

    sidebarStatusBar?.addEventListener('click', () => {
        const action = sidebarStatusBar?.dataset.action || getSidebarStatusSnapshot().action;
        runSidebarStatusAction(action);
    });

    sidebarStatusSettingsBtn?.addEventListener('click', () => {
        openSettingsOverlay?.('settings');
    });

    const syncConnectionUi = () => {
        syncSidebarStatusBar();
        syncChatConnectionStatus();
    };
    windowRef.addEventListener('online', syncConnectionUi);
    windowRef.addEventListener('offline', syncConnectionUi);
    windowRef.addEventListener('focus', syncConnectionUi);
    syncSidebarStatusBar();

    return {
        getSidebarStatusSnapshot,
        runSidebarStatusAction,
        syncSidebarStatusBar,
    };
}
