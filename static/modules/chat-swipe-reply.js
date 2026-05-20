/**
 * chat-swipe-reply.js
 * Mobile swipe-to-reply gesture for chat messages.
 *
 * On touch devices, swiping a message bubble horizontally (right for incoming,
 * left for outgoing) reveals a reply icon and triggers startReply() on release.
 *
 * Thresholds:
 *   - TRIGGER (56px): fires reply action on release
 *   - MAX_DRAG (80px): clamps visual translation so it feels bounded
 *   - MIN_SWIPE (12px): ignores micro-taps and vertical scrolls
 *   - ANGLE (35deg): angle tolerance before locking to horizontal
 */

const TRIGGER_PX   = 56;
const MAX_DRAG_PX  = 80;
const MIN_SWIPE_PX = 12;
const ANGLE_DEG    = 35;

/**
 * @param {object} opts
 * @param {HTMLElement} opts.chatMessages  - scrollable message list container
 * @param {function}    opts.startReply    - startReply(msgId, text, senderLabel)
 * @param {function}    opts.getCurrentPartnerDisplayName
 * @param {function}    opts.showToast
 * @returns {{ dispose: function }}
 */
export function initSwipeReply({
    chatMessages,
    startReply,
    getCurrentPartnerDisplayName,
    showToast,
}) {
    if (!chatMessages) return { dispose: () => {} };

    // Only attach on touch devices
    if (!window.matchMedia('(pointer: coarse)').matches) return { dispose: () => {} };

    let touchState = null; // { msgEl, stack, icon, startX, startY, locked, triggered }

    function getMsgEl(target) {
        return target.closest('.message[data-msg-id]');
    }

    function getStack(msgEl) {
        return msgEl.querySelector('.message-stack');
    }

    function getOrCreateIcon(msgEl) {
        let icon = msgEl.querySelector('.message-swipe-icon');
        if (!icon) {
            icon = document.createElement('div');
            icon.className = 'message-swipe-icon';
            icon.setAttribute('aria-hidden', 'true');
            // Reply arrow SVG (minimal, 16px)
            icon.innerHTML = `<svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M2 8L7 3.5V6.5C11.5 6.5 13.5 8 13.5 12.5C12 10 10 9 7 9V12L2 8Z"
                      fill="currentColor" opacity="0.8"/>
            </svg>`;
            icon.style.color = 'var(--accent, #c4943c)';
            // Position relative to message-row-track
            const track = msgEl.querySelector('.message-row-track');
            if (track) {
                track.style.position = 'relative';
                track.appendChild(icon);
            } else {
                msgEl.style.position = 'relative';
                msgEl.appendChild(icon);
            }
        }
        return icon;
    }

    function isSelf(msgEl) {
        return msgEl.classList.contains('self');
    }

    function onTouchStart(e) {
        if (e.touches.length !== 1) return;
        const touch = e.touches[0];
        const msgEl = getMsgEl(e.target);
        if (!msgEl) return;

        // Don't intercept taps on interactive elements
        if (e.target.closest('button, a, input, textarea, [role="button"]')) return;

        const stack = getStack(msgEl);
        if (!stack) return;

        touchState = {
            msgEl,
            stack,
            icon: null,          // created lazily on first movement
            startX: touch.clientX,
            startY: touch.clientY,
            locked: false,       // direction locked after MIN_SWIPE
            lockedDir: null,     // 'h' = horizontal, 'v' = vertical
            triggered: false,
            self: isSelf(msgEl),
        };
    }

    function onTouchMove(e) {
        if (!touchState) return;
        const touch = e.touches[0];
        const dx = touch.clientX - touchState.startX;
        const dy = touch.clientY - touchState.startY;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (!touchState.locked && dist > MIN_SWIPE_PX) {
            const angle = Math.abs(Math.atan2(dy, dx) * (180 / Math.PI));
            // Horizontal swipe: angle < ANGLE_DEG or > 180-ANGLE_DEG
            const isHorizontal = angle < ANGLE_DEG || angle > (180 - ANGLE_DEG);
            touchState.lockedDir = isHorizontal ? 'h' : 'v';
            touchState.locked = true;
        }

        if (!touchState.locked || touchState.lockedDir === 'v') return;

        // For incoming (other) messages: right swipe (dx > 0)
        // For outgoing (self) messages: left swipe (dx < 0)
        const isCorrectDir = touchState.self ? dx < 0 : dx > 0;
        if (!isCorrectDir) {
            cleanup(true);
            return;
        }

        e.preventDefault(); // prevent scroll during horizontal swipe

        const rawDrag = Math.abs(dx);
        const drag = Math.min(rawDrag, MAX_DRAG_PX);
        // Ease drag with sqrt curve for natural feel
        const visualDrag = Math.sqrt(drag / MAX_DRAG_PX) * MAX_DRAG_PX;
        const translateX = touchState.self ? -visualDrag : visualDrag;
        const progress = Math.min(rawDrag / TRIGGER_PX, 1);

        // Lazy icon creation
        if (!touchState.icon) {
            touchState.icon = getOrCreateIcon(touchState.msgEl);
        }

        touchState.msgEl.classList.add('swipe-reply-active');
        touchState.stack.style.setProperty('--swipe-x', `${translateX}px`);
        touchState.stack.style.transform = `translateX(${translateX}px)`;
        touchState.stack.style.transition = 'none';

        // Icon opacity + scale scale from 0→1 as progress goes 0→1
        const iconOpacity = Math.min(progress * 1.4, 1);
        const iconScale = 0.7 + 0.3 * Math.min(progress * 1.2, 1);
        touchState.msgEl.style.setProperty('--swipe-icon-opacity', String(iconOpacity));
        touchState.msgEl.style.setProperty('--swipe-icon-scale', String(iconScale));

        if (rawDrag >= TRIGGER_PX && !touchState.triggered) {
            touchState.triggered = true;
            // Haptic feedback if available
            if (navigator.vibrate) navigator.vibrate(32);
            // Overshoot spring on icon
            if (touchState.icon) {
                touchState.icon.style.transform = `translateY(-50%) scale(1.25)`;
                requestAnimationFrame(() => {
                    if (touchState?.icon) {
                        touchState.icon.style.transform = '';
                    }
                });
            }
        }
    }

    function onTouchEnd() {
        if (!touchState) return;

        const { msgEl, triggered } = touchState;

        if (triggered) {
            const msgId = msgEl.dataset.msgId;
            const text = msgEl.getAttribute('data-message-content') || '';
            const selfMsg = msgEl.classList.contains('self');
            const sender = selfMsg ? 'Вы' : getCurrentPartnerDisplayName();
            startReply(msgId, text, sender);
        }

        cleanup(false);
    }

    function onTouchCancel() {
        cleanup(false);
    }

    function cleanup(immediate) {
        if (!touchState) return;
        const { msgEl, stack, icon } = touchState;
        touchState = null;

        msgEl.classList.remove('swipe-reply-active');
        msgEl.style.removeProperty('--swipe-icon-opacity');
        msgEl.style.removeProperty('--swipe-icon-scale');

        if (stack) {
            if (immediate) {
                stack.style.transition = 'none';
                stack.style.transform = 'translateX(0)';
            } else {
                // Spring snap back
                stack.style.transition = 'transform var(--dur-quick, 160ms) var(--ease-spring, cubic-bezier(0.34, 1.56, 0.64, 1))';
                stack.style.transform = 'translateX(0)';
                // Clear inline transition after animation
                stack.addEventListener('transitionend', () => {
                    stack.style.transform = '';
                    stack.style.transition = '';
                }, { once: true });
            }
            stack.style.removeProperty('--swipe-x');
        }

        if (icon) {
            icon.style.removeProperty('transform');
        }
    }

    chatMessages.addEventListener('touchstart',  onTouchStart,  { passive: true });
    chatMessages.addEventListener('touchmove',   onTouchMove,   { passive: false });
    chatMessages.addEventListener('touchend',    onTouchEnd,    { passive: true });
    chatMessages.addEventListener('touchcancel', onTouchCancel, { passive: true });

    return {
        dispose() {
            chatMessages.removeEventListener('touchstart',  onTouchStart);
            chatMessages.removeEventListener('touchmove',   onTouchMove);
            chatMessages.removeEventListener('touchend',    onTouchEnd);
            chatMessages.removeEventListener('touchcancel', onTouchCancel);
            if (touchState) cleanup(true);
        },
    };
}
