export function createChatLazyUiRuntime({
    messageInput,
    headerSearchWrap,
    closeSearchBtn,
    chatHeader,
    headerSearchInput,
    headerDropdown,
    sidebarSearchInput,
    emojiBtn,
    searchChatBtn,
    sideResizer,
    closeFloatingPanel,
    openFloatingPanel,
    isProfileDrawerOpen,
    closePartnerProfileDrawer,
    sendDialogRequest,
    windowRef = window,
} = {}) {
    let applyActiveMessageSearchFilterImpl = () => {};
    let emojiPickerInitPromise = null;
    let messageSearchInitPromise = null;
    let sidebarSearchInitPromise = null;
    let isSidebarSearchReady = false;
    let sidebarResizeInitPromise = null;

    function applyActiveMessageSearchFilter() {
        applyActiveMessageSearchFilterImpl();
    }

    function closeMessageSearchOverlay() {
        if (!headerSearchWrap?.classList.contains('active')) return false;
        if (closeSearchBtn) {
            closeSearchBtn.click();
            return true;
        }
        headerSearchWrap.classList.remove('active');
        chatHeader?.classList.remove('chat-header--search-active');
        if (headerSearchInput) {
            headerSearchInput.value = '';
            headerSearchInput.blur();
        }
        applyActiveMessageSearchFilter();
        return true;
    }

    function closeHeaderDropdown() {
        return closeFloatingPanel(headerDropdown, 'active', 120);
    }

    function toggleHeaderDropdown() {
        if (!headerDropdown) return;
        if (headerDropdown.classList.contains('active') || headerDropdown.classList.contains('is-opening')) {
            closeHeaderDropdown();
            return;
        }
        openFloatingPanel(headerDropdown, 'active');
    }

    function ensureEmojiPicker() {
        if (emojiPickerInitPromise) {
            return emojiPickerInitPromise;
        }
        emojiPickerInitPromise = import('./emoji.js')
            .then(({ initEmojiPicker }) => {
                initEmojiPicker(messageInput);
            })
            .catch((error) => {
                emojiPickerInitPromise = null;
                throw error;
            });
        return emojiPickerInitPromise;
    }

    function ensureMessageSearch() {
        if (messageSearchInitPromise) {
            return messageSearchInitPromise;
        }
        messageSearchInitPromise = import('./message-search.js')
            .then((module) => {
                applyActiveMessageSearchFilterImpl = module.applyActiveMessageSearchFilter;
                module.initMessageSearch();
            })
            .catch((error) => {
                messageSearchInitPromise = null;
                throw error;
            });
        return messageSearchInitPromise;
    }

    function ensureSidebarSearch() {
        if (isSidebarSearchReady) {
            return Promise.resolve();
        }
        if (sidebarSearchInitPromise) {
            return sidebarSearchInitPromise;
        }
        sidebarSearchInitPromise = import('./sidebar-search.js')
            .then(({ initSidebarSearch }) => {
                initSidebarSearch({ onAddUser: (userId, displayName) => sendDialogRequest(userId, displayName) });
                isSidebarSearchReady = true;
            })
            .catch((error) => {
                sidebarSearchInitPromise = null;
                throw error;
            });
        return sidebarSearchInitPromise;
    }

    function ensureSidebarResize() {
        if (sidebarResizeInitPromise) {
            return sidebarResizeInitPromise;
        }
        sidebarResizeInitPromise = import('./sidebar-resize.js')
            .then(({ initSidebarResize }) => {
                initSidebarResize();
            })
            .catch((error) => {
                sidebarResizeInitPromise = null;
                throw error;
            });
        return sidebarResizeInitPromise;
    }

    sidebarSearchInput?.addEventListener('click', async (event) => {
        if (isSidebarSearchReady) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
            await ensureSidebarSearch();
            queueMicrotask(() => sidebarSearchInput.click());
        } catch (error) {
            console.warn('Failed to initialize sidebar search', error);
        }
    }, { capture: true });

    sidebarSearchInput?.addEventListener('focus', async (event) => {
        if (isSidebarSearchReady) return;
        event.stopImmediatePropagation();
        try {
            await ensureSidebarSearch();
            queueMicrotask(() => {
                try { sidebarSearchInput.focus({ preventScroll: true }); } catch (_) {}
            });
        } catch (error) {
            console.warn('Failed to initialize sidebar search', error);
        }
    }, { capture: true });

    emojiBtn?.addEventListener('click', async (event) => {
        if (isProfileDrawerOpen()) {
            await closePartnerProfileDrawer();
        }
        if (emojiPickerInitPromise) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
            await ensureEmojiPicker();
            queueMicrotask(() => emojiBtn.click());
        } catch (error) {
            console.warn('Failed to initialize emoji picker', error);
        }
    }, { capture: true });

    searchChatBtn?.addEventListener('click', async (event) => {
        if (messageSearchInitPromise) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
            await ensureMessageSearch();
            queueMicrotask(() => searchChatBtn.click());
        } catch (error) {
            console.warn('Failed to initialize message search', error);
        }
    }, { capture: true });

    sideResizer?.addEventListener('mousedown', async (event) => {
        if (sidebarResizeInitPromise) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        try {
            await ensureSidebarResize();
            queueMicrotask(() => {
                sideResizer.dispatchEvent(new windowRef.MouseEvent('mousedown', {
                    bubbles: true,
                    cancelable: true,
                    clientX: event.clientX,
                    clientY: event.clientY,
                    button: event.button,
                }));
            });
        } catch (error) {
            console.warn('Failed to initialize sidebar resize', error);
        }
    }, { capture: true });

    return {
        applyActiveMessageSearchFilter,
        closeMessageSearchOverlay,
        closeHeaderDropdown,
        toggleHeaderDropdown,
        ensureEmojiPicker,
        ensureMessageSearch,
        ensureSidebarSearch,
        ensureSidebarResize,
    };
}
