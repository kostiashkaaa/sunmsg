import { waitForMotionEnd } from '../modules/motion.js';

export function createThreadShell({
    historyLoadingIndicator,
    getCurrentChatId,
    getChatMessagesElement,
}) {
    function setHistoryLoading(isLoading) {
        const chatMessages = getChatMessagesElement();
        if (!historyLoadingIndicator) return;
        if (!getCurrentChatId() || !chatMessages || chatMessages.style.display === 'none') {
            historyLoadingIndicator.classList.remove('active');
            return;
        }
        historyLoadingIndicator.classList.toggle('active', Boolean(isLoading));
    }

    function setChatStageLoading(isLoading) {
        setHistoryLoading(isLoading);
    }

    return {
        setHistoryLoading,
        setChatStageLoading,
    };
}

export function createMobileThreadShell({
    chatArea,
    sidebar,
    prefersReducedMotion,
    scheduleComposerFocus,
    leaveCurrentChatRoom,
    isMobileViewport,
}) {
    let mobileOpenTransitionSeq = 0;
    let mobileCloseTransitionSeq = 0;

    function completeMobileChatOpen() {
        chatArea.classList.remove('mobile-revealing');
        sidebar.classList.remove('mobile-hiding', 'mobile-returning');
        sidebar.style.display = 'none';
    }

    function openChat() {
        const reduceMotion = prefersReducedMotion();
        chatArea.classList.remove('mobile-closing', 'mobile-swipe-back-dragging');
        chatArea.style.removeProperty('--mobile-exit-swipe-shift');
        chatArea.classList.add('mobile-open');
        sidebar.classList.remove('mobile-returning');

        mobileOpenTransitionSeq += 1;

        const alreadyOpen = sidebar.style.display === 'none' && !chatArea.classList.contains('mobile-revealing');
        if (alreadyOpen) {
            scheduleComposerFocus({ delay: 0, force: true });
            return;
        }

        if (reduceMotion) {
            completeMobileChatOpen();
            scheduleComposerFocus({ delay: 0, force: true });
            return;
        }

        sidebar.style.display = '';
        chatArea.classList.remove('mobile-revealing');
        sidebar.classList.remove('mobile-hiding');

        // Restart keyframe animation on repeated open.
        void chatArea.offsetWidth;

        chatArea.classList.add('mobile-revealing');
        sidebar.classList.add('mobile-hiding');

        const transitionSeq = ++mobileOpenTransitionSeq;
        Promise.all([
            waitForMotionEnd(chatArea, 380),
            waitForMotionEnd(sidebar, 380),
        ]).then(() => {
            if (transitionSeq !== mobileOpenTransitionSeq) return;
            completeMobileChatOpen();
        });

        scheduleComposerFocus({ delay: 300, force: true });
    }

    function completeMobileChatClose() {
        mobileCloseTransitionSeq += 1;
        chatArea.classList.remove('mobile-open', 'mobile-closing', 'mobile-swipe-back-dragging');
        chatArea.style.removeProperty('--mobile-exit-swipe-shift');
        sidebar.classList.remove('mobile-returning', 'mobile-hiding');
        sidebar.style.display = '';
    }

    function closeMobileChatView({ leaveRoom = true, animated = true } = {}) {
        if (!isMobileViewport() || !chatArea.classList.contains('mobile-open')) {
            if (leaveRoom) leaveCurrentChatRoom();
            chatArea.classList.remove('mobile-open', 'mobile-closing', 'mobile-swipe-back-dragging');
            chatArea.style.removeProperty('--mobile-exit-swipe-shift');
            sidebar.classList.remove('mobile-returning');
            sidebar.style.display = '';
            return;
        }

        if (leaveRoom) leaveCurrentChatRoom();

        const reduceMotion = prefersReducedMotion();
        if (!animated || reduceMotion) {
            completeMobileChatClose();
            return;
        }

        if (chatArea.classList.contains('mobile-closing')) return;

        sidebar.style.display = '';
        sidebar.classList.add('mobile-returning');
        chatArea.classList.remove('mobile-swipe-back-dragging');
        chatArea.style.setProperty('--mobile-exit-swipe-shift', '0px');
        chatArea.classList.add('mobile-closing');

        const transitionSeq = ++mobileCloseTransitionSeq;
        waitForMotionEnd(chatArea, 360).then(() => {
            if (transitionSeq !== mobileCloseTransitionSeq) return;
            completeMobileChatClose();
        });
    }

    return {
        completeMobileChatOpen,
        openChat,
        completeMobileChatClose,
        closeMobileChatView,
    };
}
