export function bindChatRuntimeWindowEvents({
    windowRef = window,
    consoleRef = console,
    refreshPrivateKeyDependentUi,
    refreshLocalizedRuntimeUi,
    loadContacts,
    syncChatConnectionStatus,
} = {}) {
    windowRef.addEventListener('sun-private-key-status-changed', () => {
        refreshPrivateKeyDependentUi().catch((error) => {
            consoleRef.warn('Private key UI refresh failed:', error);
        });
    });

    windowRef.addEventListener('sun-ui-language-changed', (event) => {
        const hydrated = event?.detail?.hydrated;
        refreshLocalizedRuntimeUi({ hydrated });
        const shouldReloadContacts = hydrated === true || typeof hydrated === 'undefined';
        if (shouldReloadContacts) {
            loadContacts({ immediate: true }).catch(() => {});
        }
        syncChatConnectionStatus();
    });
}
