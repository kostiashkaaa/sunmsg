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
    let handledEmojiPointerOpen = false;
    let handledEmojiPointerTimer = null;
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

    function getHeaderMoreButton() {
        return headerDropdown?.ownerDocument?.getElementById('headerMoreBtn') || null;
    }

    function setHeaderDropdownExpanded(isExpanded) {
        getHeaderMoreButton()?.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    }

    function getHeaderDropdownItems() {
        return Array.from(headerDropdown?.querySelectorAll('[role="menuitem"]') || [])
            .filter((item) => !item.hidden && item.getAttribute('aria-hidden') !== 'true');
    }

    function focusHeaderDropdownItem(index = 0) {
        const items = getHeaderDropdownItems();
        if (!items.length) return;
        const safeIndex = Math.max(0, Math.min(index, items.length - 1));
        windowRef.requestAnimationFrame(() => {
            items[safeIndex]?.focus?.({ preventScroll: true });
        });
    }

    function closeHeaderDropdown(options = {}) {
        const { returnFocus = false } = options || {};
        setHeaderDropdownExpanded(false);
        const closePromise = closeFloatingPanel(headerDropdown, 'active', 120);
        if (returnFocus) {
            Promise.resolve(closePromise).finally(() => {
                getHeaderMoreButton()?.focus?.({ preventScroll: true });
            });
        }
        return closePromise;
    }

    function toggleHeaderDropdown(options = {}) {
        const { focusFirst = false, returnFocus = false } = options || {};
        if (!headerDropdown) return;
        if (headerDropdown.classList.contains('active') || headerDropdown.classList.contains('is-opening')) {
            closeHeaderDropdown({ returnFocus });
            return;
        }
        openFloatingPanel(headerDropdown, 'active');
        setHeaderDropdownExpanded(true);
        if (focusFirst) focusHeaderDropdownItem(0);
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

    function isMobileViewport() {
        return windowRef.innerWidth <= 768;
    }

    let emojiWarmupScheduled = false;
    function scheduleEmojiPickerWarmup(delayMs = 0) {
        if (!isMobileViewport() || emojiPickerInitPromise || emojiWarmupScheduled) return;
        emojiWarmupScheduled = true;
        const runWarmup = () => {
            emojiWarmupScheduled = false;
            ensureEmojiPicker().catch((error) => {
                console.warn('Failed to warm up emoji picker', error);
            });
        };
        if (delayMs > 0) {
            windowRef.setTimeout(runWarmup, delayMs);
            return;
        }
        if (typeof windowRef.requestIdleCallback === 'function') {
            windowRef.requestIdleCallback(runWarmup, { timeout: 900 });
            return;
        }
        windowRef.setTimeout(runWarmup, 120);
    }

    function dispatchEmojiOpen() {
        const documentRef = messageInput?.ownerDocument || windowRef.document;
        documentRef?.dispatchEvent(new windowRef.CustomEvent('sun-open-emoji-picker'));
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

    // Mobile: load the emoji module and open the picker on pointerdown so the
    // emoji button never steals focus from the textarea (preventDefault). The
    // emoji sheet has a fixed CSS height — no keyboard measuring needed.
    emojiBtn?.addEventListener('pointerdown', async (event) => {
        if (emojiPickerInitPromise) return;
        if (!isMobileViewport()) return;

        event.preventDefault();
        event.stopImmediatePropagation();
        windowRef.clearTimeout(handledEmojiPointerTimer);
        handledEmojiPointerOpen = true;
        try {
            await ensureEmojiPicker();
            dispatchEmojiOpen();
        } catch (error) {
            console.warn('Failed to initialize emoji picker', error);
        } finally {
            handledEmojiPointerTimer = windowRef.setTimeout(() => {
                handledEmojiPointerOpen = false;
            }, 450);
        }
    }, { capture: true });

    emojiBtn?.addEventListener('click', async (event) => {
        if (handledEmojiPointerOpen) {
            event.preventDefault();
            event.stopImmediatePropagation();
            windowRef.clearTimeout(handledEmojiPointerTimer);
            handledEmojiPointerOpen = false;
            return;
        }
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

    messageInput?.addEventListener('focus', () => {
        scheduleEmojiPickerWarmup();
    }, { passive: true });
    scheduleEmojiPickerWarmup(350);

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
