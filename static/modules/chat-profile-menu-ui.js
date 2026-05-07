export function createProfileMoreMenuController({
    profileMoreMenu = null,
    profileMoreBtn = null,
    openFloatingPanel = () => {},
    closeFloatingPanel = () => {},
    syncProfileMoreMenuChatActions = () => {},
} = {}) {
    function closeProfileMoreMenu() {
        if (!profileMoreMenu) return;
        closeFloatingPanel(profileMoreMenu, 'active', 300);
        profileMoreMenu.setAttribute('aria-hidden', 'true');
        profileMoreBtn?.setAttribute('aria-expanded', 'false');
    }

    function toggleProfileMoreMenu(forceState) {
        if (!profileMoreMenu) return;
        const shouldOpen = typeof forceState === 'boolean'
            ? forceState
            : !(profileMoreMenu.classList.contains('active') || profileMoreMenu.classList.contains('is-opening'));
        if (shouldOpen) {
            syncProfileMoreMenuChatActions();
        }
        if (shouldOpen) {
            openFloatingPanel(profileMoreMenu, 'active');
        } else {
            closeProfileMoreMenu();
        }
        profileMoreMenu.setAttribute('aria-hidden', shouldOpen ? 'false' : 'true');
        profileMoreBtn?.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
    }

    return {
        closeProfileMoreMenu,
        toggleProfileMoreMenu,
    };
}
