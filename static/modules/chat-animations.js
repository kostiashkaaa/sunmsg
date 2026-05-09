// Chat surface animations: вход/перерисовка/desktop->mobile-reveal.
// Каждая функция тщательно очищает свой timer/raf, чтобы повторные
// вызовы во время уже идущей анимации не дёргали dom-class hot loop.

import { applyListPerfGuard } from './motion.js';

export function createChatAnimationsController(deps = {}) {
    const {
        chatArea,
        chatMessages,
        prefersReducedMotionSetting,
        isMobileViewport,
    } = deps;

    let chatSurfaceEnterRafId = 0;
    let chatSurfaceEnterTimerId = 0;
    let chatHistoryRevealRafId = 0;
    let chatHistoryRevealTimerId = 0;
    let chatAnimateEnterTimerId = 0;
    let desktopMobileRevealTimerId = 0;

    function triggerChatSurfaceEnterAnimation() {
        if (!chatArea) return;
        if (prefersReducedMotionSetting?.()) return;
        if (isMobileViewport?.()) {
            chatArea.classList.remove('chat-surface-enter');
            return;
        }
        if (chatSurfaceEnterRafId) {
            cancelAnimationFrame(chatSurfaceEnterRafId);
            chatSurfaceEnterRafId = 0;
        }
        if (chatSurfaceEnterTimerId) {
            window.clearTimeout(chatSurfaceEnterTimerId);
            chatSurfaceEnterTimerId = 0;
        }
        chatArea.classList.remove('chat-surface-enter');
        chatSurfaceEnterRafId = requestAnimationFrame(() => {
            chatSurfaceEnterRafId = 0;
            chatArea.classList.add('chat-surface-enter');
            chatSurfaceEnterTimerId = window.setTimeout(() => {
                chatArea.classList.remove('chat-surface-enter');
                chatSurfaceEnterTimerId = 0;
            }, 460);
        });
    }

    function triggerChatHistoryRevealAnimation() {
        if (!chatArea) return;
        if (prefersReducedMotionSetting?.()) return;
        if (isMobileViewport?.()) {
            chatArea.classList.remove('chat-history-reveal', 'is-switching');
            return;
        }
        if (chatHistoryRevealRafId) {
            cancelAnimationFrame(chatHistoryRevealRafId);
            chatHistoryRevealRafId = 0;
        }
        if (chatHistoryRevealTimerId) {
            clearTimeout(chatHistoryRevealTimerId);
            chatHistoryRevealTimerId = 0;
        }
        if (chatMessages) {
            const visibleMessages = chatMessages.querySelectorAll('.message').length;
            applyListPerfGuard(chatMessages, {
                total: visibleMessages,
                dataAttr: 'data-motion-history-guard',
            });
        }
        chatArea.classList.remove('chat-history-reveal');
        chatHistoryRevealRafId = requestAnimationFrame(() => {
            chatHistoryRevealRafId = 0;
            chatArea.classList.remove('is-switching');
            chatArea.classList.add('chat-history-reveal');
            chatHistoryRevealTimerId = window.setTimeout(() => {
                chatArea.classList.remove('chat-history-reveal');
                chatHistoryRevealTimerId = 0;
            }, 640);
        });
    }

    function triggerChatAnimateEnter() {
        if (!chatArea) return;
        if (prefersReducedMotionSetting?.()) {
            chatArea.classList.remove('chat-animate-enter');
            return;
        }
        if (isMobileViewport?.()) {
            chatArea.classList.remove('chat-animate-enter');
            return;
        }
        if (chatAnimateEnterTimerId) {
            window.clearTimeout(chatAnimateEnterTimerId);
            chatAnimateEnterTimerId = 0;
        }
        chatArea.classList.remove('chat-animate-enter');
        void chatArea.offsetWidth;
        chatArea.classList.add('chat-animate-enter');
        chatAnimateEnterTimerId = window.setTimeout(() => {
            chatArea.classList.remove('chat-animate-enter');
            chatAnimateEnterTimerId = 0;
        }, 380);
    }

    function triggerDesktopMobileRevealAnimation() {
        if (!chatArea) return;
        if (isMobileViewport?.()) {
            chatArea.classList.remove('desktop-mobile-revealing');
            chatArea.classList.remove('is-switching');
            chatArea.classList.remove('chat-surface-enter', 'chat-history-reveal', 'chat-animate-enter');
            return;
        }
        if (document.documentElement.classList.contains('perf-lite')) {
            document.documentElement.classList.remove('perf-lite');
            document.documentElement.setAttribute('data-performance-mode', 'full');
            try {
                localStorage.setItem('sun_performance_mode', 'full');
            } catch (_) {}
        }
        const revealRunId = desktopMobileRevealTimerId + 1;
        desktopMobileRevealTimerId = revealRunId;
        const desktopRevealShiftPx = Math.min(Math.max(0, chatArea.clientWidth || 0), 420);
        chatArea.style.setProperty('--desktop-mobile-reveal-shift', `${desktopRevealShiftPx}px`);
        chatArea.classList.remove('desktop-mobile-revealing');
        chatArea.classList.remove('is-switching');
        chatArea.classList.remove('chat-surface-enter', 'chat-history-reveal', 'chat-animate-enter');
        void chatArea.offsetWidth;
        chatArea.classList.add('desktop-mobile-revealing');
        const revealAnimationDuration = Number.parseFloat(
            (window.getComputedStyle(chatArea).animationDuration || '0').split(',')[0]
        );
        if (!Number.isFinite(revealAnimationDuration) || revealAnimationDuration <= 0) {
            chatArea.classList.remove('desktop-mobile-revealing');
            return;
        }
        const onDesktopMobileRevealEnd = (event) => {
            if (event.target !== chatArea) return;
            if (event.animationName !== 'desktopMobileChatRevealIn') return;
            chatArea.removeEventListener('animationend', onDesktopMobileRevealEnd);
            if (revealRunId !== desktopMobileRevealTimerId) return;
            chatArea.classList.remove('desktop-mobile-revealing');
        };
        chatArea.addEventListener('animationend', onDesktopMobileRevealEnd);
    }

    function dispose() {
        if (chatSurfaceEnterRafId) {
            cancelAnimationFrame(chatSurfaceEnterRafId);
            chatSurfaceEnterRafId = 0;
        }
        if (chatSurfaceEnterTimerId) {
            window.clearTimeout(chatSurfaceEnterTimerId);
            chatSurfaceEnterTimerId = 0;
        }
        if (chatHistoryRevealRafId) {
            cancelAnimationFrame(chatHistoryRevealRafId);
            chatHistoryRevealRafId = 0;
        }
        if (chatHistoryRevealTimerId) {
            window.clearTimeout(chatHistoryRevealTimerId);
            chatHistoryRevealTimerId = 0;
        }
        if (chatAnimateEnterTimerId) {
            window.clearTimeout(chatAnimateEnterTimerId);
            chatAnimateEnterTimerId = 0;
        }
    }

    return {
        triggerChatSurfaceEnterAnimation,
        triggerChatHistoryRevealAnimation,
        triggerChatAnimateEnter,
        triggerDesktopMobileRevealAnimation,
        dispose,
    };
}
