export function initMobileBackSwipe(options = {}) {
    const {
        isMobileViewport,
        chatArea,
        sidebar,
        isProfileDrawerOpen,
        getCurrentChatId,
        closeChatUI,
        closeMobileChatView,
    } = options;

    if (!chatArea || !sidebar) {
        return { dispose: () => {} };
    }

    const MOBILE_BACK_SWIPE_EDGE_PX = 44;
    const MOBILE_BACK_SWIPE_TRIGGER_PX = 86;
    const MOBILE_BACK_SWIPE_MAX_SHIFT_PX = 180;
    const MOBILE_BACK_SWIPE_MAX_VERTICAL_PX = 76;
    let mobileBackSwipeGesture = null;
    let mobileBackSwipeTrackingMoveBound = false;
    let mobileBackSwipeBlockingMoveBound = false;

    function canStartMobileBackSwipe(target) {
        if (!isMobileViewport()) return false;
        if (!chatArea.classList.contains('mobile-open')) return false;
        if (isProfileDrawerOpen()) return false;
        if (!(target instanceof Element)) return false;
        return !target.closest(
            '#messageForm,.chat-input-area button,.chat-input-area input,.chat-input-area textarea,' +
            '.context-menu,.emoji-picker,.reaction-picker,[role="dialog"],[data-profile-close],#partnerProfileDrawer,' +
            '.voice-playback-bar,#lightbox,.audio-player-progress,.audio-player-toggle,.audio-player-wave-wrap',
        );
    }

    function resetMobileBackSwipe({ keepSidebarVisible = false, immediate = false } = {}) {
        mobileBackSwipeGesture = null;
        unbindMobileBackSwipeMove();
        if (immediate) chatArea.classList.add('mobile-swipe-back-reset-immediate');
        chatArea.classList.remove('mobile-swipe-back-dragging');
        chatArea.style.removeProperty('--mobile-exit-swipe-shift');
        if (immediate) {
            requestAnimationFrame(() => {
                chatArea.classList.remove('mobile-swipe-back-reset-immediate');
            });
        }
        if (!keepSidebarVisible && !chatArea.classList.contains('mobile-closing')) {
            sidebar.classList.remove('mobile-returning');
            sidebar.style.display = 'none';
        }
    }

    function handleMobileBackSwipeStart(event) {
        if (mobileBackSwipeGesture || chatArea.classList.contains('mobile-closing')) return;
        const touch = event.changedTouches?.[0];
        if (!touch || touch.clientX > MOBILE_BACK_SWIPE_EDGE_PX) return;
        if (!canStartMobileBackSwipe(event.target)) return;

        mobileBackSwipeGesture = {
            startX: touch.clientX,
            startY: touch.clientY,
            currentX: touch.clientX,
            currentY: touch.clientY,
            dragging: false,
        };
        bindMobileBackSwipeTrackingMove();
        sidebar.style.display = '';
        sidebar.classList.add('mobile-returning');
    }

    function bindMobileBackSwipeTrackingMove() {
        if (mobileBackSwipeTrackingMoveBound) return;
        mobileBackSwipeTrackingMoveBound = true;
        chatArea.addEventListener('touchmove', handleMobileBackSwipePassiveMove, { passive: true });
        chatArea.addEventListener('touchend', handleMobileBackSwipeEnd, { passive: true });
        chatArea.addEventListener('touchcancel', handleMobileBackSwipeEnd, { passive: true });
    }

    function unbindMobileBackSwipeTrackingMove() {
        if (!mobileBackSwipeTrackingMoveBound) return;
        mobileBackSwipeTrackingMoveBound = false;
        chatArea.removeEventListener('touchmove', handleMobileBackSwipePassiveMove);
        chatArea.removeEventListener('touchend', handleMobileBackSwipeEnd);
        chatArea.removeEventListener('touchcancel', handleMobileBackSwipeEnd);
    }

    function bindMobileBackSwipeBlockingMove() {
        if (mobileBackSwipeBlockingMoveBound) return;
        mobileBackSwipeBlockingMoveBound = true;
        chatArea.addEventListener('touchmove', handleMobileBackSwipeBlockingMove, { passive: false });
    }

    function unbindMobileBackSwipeBlockingMove() {
        if (!mobileBackSwipeBlockingMoveBound) return;
        mobileBackSwipeBlockingMoveBound = false;
        chatArea.removeEventListener('touchmove', handleMobileBackSwipeBlockingMove);
    }

    function unbindMobileBackSwipeMove() {
        unbindMobileBackSwipeTrackingMove();
        unbindMobileBackSwipeBlockingMove();
    }

    function handleMobileBackSwipeMove(event, { allowPreventDefault = false } = {}) {
        const gesture = mobileBackSwipeGesture;
        if (!gesture) return;
        const touch = event.changedTouches?.[0];
        if (!touch) return;

        gesture.currentX = touch.clientX;
        gesture.currentY = touch.clientY;
        const dx = gesture.currentX - gesture.startX;
        const dy = Math.abs(gesture.currentY - gesture.startY);

        if (!gesture.dragging) {
            if (Math.abs(dx) < 8 && dy < 8) return;
            if (dx <= 0 || dy > Math.abs(dx)) {
                resetMobileBackSwipe({ keepSidebarVisible: false, immediate: true });
                return;
            }
            gesture.dragging = true;
            bindMobileBackSwipeBlockingMove();
        }

        if (dy > MOBILE_BACK_SWIPE_MAX_VERTICAL_PX) {
            resetMobileBackSwipe({ keepSidebarVisible: false, immediate: true });
            return;
        }

        const shift = Math.max(0, Math.min(MOBILE_BACK_SWIPE_MAX_SHIFT_PX, dx));
        chatArea.classList.add('mobile-swipe-back-dragging');
        chatArea.style.setProperty('--mobile-exit-swipe-shift', `${shift}px`);
        if (allowPreventDefault && event.cancelable) event.preventDefault();
    }

    function handleMobileBackSwipePassiveMove(event) {
        if (mobileBackSwipeBlockingMoveBound) return;
        handleMobileBackSwipeMove(event, { allowPreventDefault: false });
    }

    function handleMobileBackSwipeBlockingMove(event) {
        handleMobileBackSwipeMove(event, { allowPreventDefault: true });
    }

    function handleMobileBackSwipeEnd() {
        const gesture = mobileBackSwipeGesture;
        if (!gesture) return;
        const shift = Math.max(0, gesture.currentX - gesture.startX);
        const shouldClose = gesture.dragging && shift >= MOBILE_BACK_SWIPE_TRIGGER_PX;
        if (shouldClose) {
            mobileBackSwipeGesture = null;
            unbindMobileBackSwipeMove();
            if (getCurrentChatId()) {
                closeChatUI();
                return;
            }
            closeMobileChatView({ leaveRoom: true, animated: true });
            return;
        }
        resetMobileBackSwipe({ keepSidebarVisible: false });
    }

    chatArea.addEventListener('touchstart', handleMobileBackSwipeStart, { passive: true });

    return {
        dispose() {
            chatArea.removeEventListener('touchstart', handleMobileBackSwipeStart);
            unbindMobileBackSwipeMove();
        },
    };
}
