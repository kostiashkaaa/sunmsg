import { createVisualViewportCssSyncer } from './mobile-viewport.js';
import { createMobileThreadShell } from '../chat/thread-shell.js';
import { initMobileBackSwipe } from '../chat/mobile-back-swipe.js';

export function createChatMobileViewportRuntime({
    documentRef = document,
    windowRef = window,
    requestAnimationFrameFn = requestAnimationFrame,
    cancelAnimationFrameFn = cancelAnimationFrame,
    setTimeoutFn = setTimeout,
    resizeObserverCtor = window.ResizeObserver,
    chatBottomThresholdPx = 96,
    chatArea,
    sidebar,
    chatMessages,
    chatInputArea,
    messageInput,
    messageForm,
    composerRow,
    headerSearchWrap,
    headerDropdown,
    partnerProfileDrawer,
    reactionPicker,
    backBtnMobile,
    prefersReducedMotion,
    leaveCurrentChatRoom,
    closeChatUI,
    isProfileDrawerOpen,
    getCurrentChatId,
    getLastMobileKeyboardDismissAt,
    getKeepChatPinnedToBottom,
    setChatScrollTop,
    saveChatScrollPosition,
    updateJumpToNewMessagesButton,
} = {}) {
    let bottomInsetFrame = 0;
    let viewportEventsBound = false;
    let chatInputResizeObserver = null;

    const mobileThreadShell = createMobileThreadShell({
        chatArea,
        sidebar,
        prefersReducedMotion,
        scheduleComposerFocus,
        leaveCurrentChatRoom,
        isMobileViewport: () => isMobileViewport(),
    });

    const mobileBackSwipeController = initMobileBackSwipe({
        isMobileViewport: () => isMobileViewport(),
        chatArea,
        sidebar,
        isProfileDrawerOpen,
        getCurrentChatId,
        closeChatUI,
        closeMobileChatView,
    });

    const runVisualViewportCssSync = createVisualViewportCssSyncer({
        appVhVar: '--app-vh',
        appVwVar: '--app-vw',
        topOffsetVar: '--vv-top-offset',
        leftOffsetVar: '--vv-left-offset',
        keyboardInsetVar: '--vv-keyboard-inset',
        composerBottomInsetVar: '--mobile-composer-bottom-inset',
    });

    function resizeComposerInput() {
        if (!messageInput) return;
        messageInput.style.height = '0px';
        const computed = windowRef.getComputedStyle(messageInput);
        const maxHeight = Number.parseFloat(computed.maxHeight) || 136;
        const minHeight = Number.parseFloat(computed.minHeight) || 32;
        const targetHeight = Math.min(messageInput.scrollHeight, maxHeight);
        messageInput.style.height = `${Math.max(targetHeight, minHeight)}px`;
        messageInput.classList.toggle('composer-scroll', messageInput.scrollHeight > maxHeight + 1);
        updateChatMessagesBottomInset();
    }

    function openChat() {
        backBtnMobile?.setAttribute('aria-hidden', 'false');
        mobileThreadShell.openChat();
    }

    function isMobileViewport() {
        return windowRef.matchMedia('(max-width: 768px)').matches;
    }

    function closeMobileChatView({ leaveRoom = true, animated = true } = {}) {
        mobileThreadShell.closeMobileChatView({ leaveRoom, animated });
        backBtnMobile?.setAttribute('aria-hidden', 'true');
    }

    function isComposerFocusBlocked() {
        if (!messageInput || messageInput.disabled) return true;
        if (headerSearchWrap?.classList.contains('active')) return true;
        if (headerDropdown?.classList.contains('active')) return true;
        if (partnerProfileDrawer?.classList.contains('active')) return true;
        if (documentRef.querySelector('.modal.show')) return true;
        if (documentRef.getElementById('deleteChatModal')) return true;
        const captionModal = documentRef.getElementById('captionModal');
        if (captionModal?.classList.contains('is-open') && !captionModal.classList.contains('is-closing')) return true;
        const keyRestoreModal = documentRef.getElementById('keyRestoreModal');
        if (keyRestoreModal?.classList.contains('is-open') && !keyRestoreModal.classList.contains('is-closing')) return true;
        if (documentRef.getElementById('lightbox')?.classList.contains('active')) return true;

        const contextMenu = documentRef.getElementById('messageContextMenu');
        const isContextMenuOpen = Boolean(
            contextMenu
            && contextMenu.getAttribute('aria-hidden') !== 'true'
            && (contextMenu.classList.contains('is-open') || contextMenu.classList.contains('is-opening')),
        );
        if (isContextMenuOpen) return true;
        if (reactionPicker && reactionPicker.classList.contains('active')) return true;
        return false;
    }

    function resetHorizontalViewportDrift() {
        const targets = [
            documentRef.scrollingElement,
            documentRef.documentElement,
            documentRef.body,
            chatArea,
            chatMessages,
            chatInputArea,
        ];
        for (const target of targets) {
            if (!target) continue;
            try {
                if (target.scrollLeft) target.scrollLeft = 0;
            } catch (_) {
                // Some browser internals expose read-only scroll containers.
            }
        }
    }

    function scheduleComposerFocus({ delay = 0, force = false } = {}) {
        if (!messageInput) return;
        windowRef.setTimeout(() => {
            if (!force) {
                if (isComposerFocusBlocked()) return;
                const active = documentRef.activeElement;
                if (active && active !== documentRef.body && active !== messageInput && !active.closest('#messageForm, #composerRow')) {
                    return;
                }
                if (windowRef.matchMedia('(pointer: coarse)').matches && Date.now() - Number(getLastMobileKeyboardDismissAt?.() || 0) < 450) {
                    return;
                }
            } else if (isComposerFocusBlocked()) {
                return;
            }
            if (force && windowRef.matchMedia('(pointer: coarse)').matches && documentRef.activeElement !== messageInput) return;

            requestAnimationFrameFn(() => {
                if (messageInput.disabled || isComposerFocusBlocked()) return;
                const end = messageInput.value.length;
                resetHorizontalViewportDrift();
                messageInput.focus({ preventScroll: true });
                try {
                    messageInput.setSelectionRange(end, end);
                } catch (_) {
                    // setSelectionRange may throw in some browsers/input modes.
                }
                resetHorizontalViewportDrift();
                requestAnimationFrameFn(resetHorizontalViewportDrift);
                windowRef.setTimeout(resetHorizontalViewportDrift, 80);
            });
        }, delay);
    }

    function isChatViewportPinnedToBottom(thresholdPx = chatBottomThresholdPx) {
        if (!chatMessages) return true;
        const maxScrollTop = Math.max(0, chatMessages.scrollHeight - chatMessages.clientHeight);
        const distance = maxScrollTop - chatMessages.scrollTop;
        return distance <= thresholdPx;
    }

    function syncChatViewportToBottomIfNeeded(shouldPin) {
        const currentChatId = getCurrentChatId?.();
        if (!shouldPin || !chatMessages || !currentChatId) return;
        requestAnimationFrameFn(() => {
            const nextChatId = getCurrentChatId?.();
            if (!chatMessages || !nextChatId) return;
            setChatScrollTop?.(chatMessages.scrollHeight);
            saveChatScrollPosition?.(nextChatId);
            updateJumpToNewMessagesButton?.();
        });
    }

    function applyChatMessagesBottomInset() {
        if (!chatArea) return;
        const shouldPinToBottom = Boolean(getKeepChatPinnedToBottom?.());
        const areaStyles = windowRef.getComputedStyle(chatArea);
        const floatingGap = Number.parseFloat(areaStyles.getPropertyValue('--floating-composer-gap')) || 16;
        const messageToComposerGap = 8;
        let reserve = floatingGap;
        let inputHeight = 0;
        if (chatInputArea) {
            const cs = windowRef.getComputedStyle(chatInputArea);
            const isVisible = cs.display !== 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0';
            if (isVisible) {
                inputHeight = Math.ceil(chatInputArea.getBoundingClientRect().height);
                if (inputHeight > 0) reserve = inputHeight + floatingGap + messageToComposerGap;
            }
        }
        chatArea.style.setProperty('--input-height', `${Math.max(0, inputHeight)}px`);
        chatArea.style.setProperty('--floating-composer-reserve', `${reserve}px`);
        syncChatViewportToBottomIfNeeded(shouldPinToBottom);
    }

    function syncVisualViewportCssVars() {
        runVisualViewportCssSync();
    }

    function syncViewportAndInsets(options = {}) {
        syncVisualViewportCssVars();
        updateChatMessagesBottomInset(options);
    }

    function updateChatMessagesBottomInset(options = {}) {
        if (!chatArea) return;
        if (options.immediate) {
            if (bottomInsetFrame) {
                cancelAnimationFrameFn(bottomInsetFrame);
                bottomInsetFrame = 0;
            }
            applyChatMessagesBottomInset();
            return;
        }
        if (bottomInsetFrame) return;
        bottomInsetFrame = requestAnimationFrameFn(() => {
            bottomInsetFrame = 0;
            applyChatMessagesBottomInset();
        });
    }

    function bindViewportEvents() {
        if (viewportEventsBound) return;
        viewportEventsBound = true;

        backBtnMobile?.addEventListener('click', () => {
            if (documentRef.getElementById('emojiPicker')?.classList.contains('active')) {
                documentRef.dispatchEvent(new CustomEvent('sun-close-emoji-picker'));
                return;
            }
            if (getCurrentChatId?.()) {
                closeChatUI?.();
                return;
            }
            closeMobileChatView({ leaveRoom: true, animated: true });
        });

        if (typeof resizeObserverCtor !== 'undefined' && chatInputArea) {
            chatInputResizeObserver = new resizeObserverCtor(() => {
                updateChatMessagesBottomInset();
            });
            chatInputResizeObserver.observe(chatInputArea);
        }

        windowRef.addEventListener('resize', syncViewportAndInsets);
        if (windowRef.visualViewport) {
            windowRef.visualViewport.addEventListener('resize', syncViewportAndInsets);
            windowRef.visualViewport.addEventListener('scroll', syncViewportAndInsets);
        }
        documentRef.addEventListener('focusin', (event) => {
            if (event.target?.closest?.('#messageForm, #composerRow')) {
                syncViewportAndInsets({ immediate: true });
            }
        });
        documentRef.addEventListener('focusout', (event) => {
            if (event.target?.closest?.('#messageForm, #composerRow')) {
                // First sync catches the initial keyboard-dismiss frame.
                // Second sync covers the full iOS keyboard dismiss animation.
                setTimeoutFn(() => syncViewportAndInsets({ immediate: true }), 80);
                setTimeoutFn(() => syncViewportAndInsets({ immediate: true }), 350);
            }
        });
        syncViewportAndInsets({ immediate: true });
    }

    return {
        resizeComposerInput,
        openChat,
        isMobileViewport,
        closeMobileChatView,
        isComposerFocusBlocked,
        resetHorizontalViewportDrift,
        scheduleComposerFocus,
        isChatViewportPinnedToBottom,
        syncChatViewportToBottomIfNeeded,
        applyChatMessagesBottomInset,
        syncVisualViewportCssVars,
        syncViewportAndInsets,
        updateChatMessagesBottomInset,
        bindViewportEvents,
        getMobileBackSwipeController: () => mobileBackSwipeController,
        getChatInputResizeObserver: () => chatInputResizeObserver,
    };
}
