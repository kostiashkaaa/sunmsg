import { waitForMotionEnd } from '../modules/motion.js';

export function createThreadShell({
    historyLoadingIndicator,
    chatStageLoader = null,
    getCurrentChatId,
    getChatMessagesElement,
}) {
    function isChatSurfaceVisible(chatMessages = getChatMessagesElement()) {
        return Boolean(
            getCurrentChatId()
            && chatMessages
            && chatMessages.style.display !== 'none'
            && !chatMessages.classList.contains('chat-messages--hidden')
        );
    }

    function setLoadingElementActive(element, isActive) {
        if (!element) return;
        element.classList.toggle('active', Boolean(isActive));
        element.setAttribute('aria-hidden', isActive ? 'false' : 'true');
    }

    function setHistoryLoading(isLoading) {
        const chatMessages = getChatMessagesElement();
        if (!historyLoadingIndicator) return;
        if (!isChatSurfaceVisible(chatMessages)) {
            setLoadingElementActive(historyLoadingIndicator, false);
            return;
        }
        setLoadingElementActive(historyLoadingIndicator, Boolean(isLoading));
    }

    function setChatStageLoading(isLoading) {
        const chatMessages = getChatMessagesElement();
        const shouldShow = Boolean(isLoading) && isChatSurfaceVisible(chatMessages);
        if (!chatStageLoader) {
            setHistoryLoading(shouldShow);
            return;
        }
        setLoadingElementActive(chatStageLoader, shouldShow);
        if (chatMessages) {
            if (shouldShow) {
                chatMessages.setAttribute('aria-busy', 'true');
            } else {
                chatMessages.removeAttribute('aria-busy');
            }
        }
        if (shouldShow) {
            setLoadingElementActive(historyLoadingIndicator, false);
        }
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
        mobileCloseTransitionSeq += 1;
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
        chatArea.classList.remove('mobile-open', 'mobile-revealing', 'mobile-closing', 'mobile-swipe-back-dragging');
        chatArea.style.removeProperty('--mobile-exit-swipe-shift');
        sidebar.classList.remove('mobile-returning', 'mobile-hiding');
        sidebar.style.display = '';
    }

    function closeMobileChatView({ leaveRoom = true, animated = true } = {}) {
        mobileOpenTransitionSeq += 1;
        if (!isMobileViewport() || !chatArea.classList.contains('mobile-open')) {
            if (leaveRoom) leaveCurrentChatRoom();
            chatArea.classList.remove('mobile-open', 'mobile-revealing', 'mobile-closing', 'mobile-swipe-back-dragging');
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
        chatArea.classList.remove('mobile-revealing', 'mobile-swipe-back-dragging');
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
