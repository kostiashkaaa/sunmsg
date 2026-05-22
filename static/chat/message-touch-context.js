export function initMessageTouchContext(options = {}) {
    const {
        chatMessages,
        reactionPicker,
        contextMenu,
        messageSelectionController,
        closeReactionPicker,
        hideContextMenu,
        closeMessageActionsBar,
        isEditingMessageId,
        showContextMenu,
        canEditMessageById,
        isChatBlocked,
        updateContextMenuReadInfo,
        contextReactionDivider,
        contextReadInfo,
        contextPinItem,
        contextFavoriteItem,
        isPinnedMessage,
        isFavoriteMessage,
        getCurrentChatId,
        messageActionsBarController,
        openReactionPickerForMessage,
        startReply,
        getCurrentPartnerDisplayName,
        showToast,
        getChatBlockNoticeText,
        getCurrentBlockState,
        emitReactionToggle,
        reactionPickerEmojis,
    } = options;

    if (!chatMessages) {
        return { dispose: () => {} };
    }

    const MESSAGE_LONG_PRESS_MS = 320;
    const DESKTOP_CONTEXT_HOVER_CLOSE_MS = 140;
    const SWIPE_REPLY_TRIGGER_PX = 72;
    const SWIPE_REPLY_MAX_SHIFT_PX = 96;
    const SWIPE_REPLY_MAX_VERTICAL_PX = 52;
    let activeMessageTouchGesture = null;
    let suppressMessageTapUntil = 0;
    let desktopContextHoverCloseTimer = 0;
    let desktopContextHoverCloseArmed = false;
    let swipeReplyBlockingMoveBound = false;
    let messageContextGestureSeq = 0;

    function prefersTouchMessageGestures() {
        try {
            return window.matchMedia('(pointer: coarse)').matches;
        } catch (_) {
            return false;
        }
    }

    function prefersDesktopContextHover() {
        try {
            return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
        } catch (_) {
            return false;
        }
    }

    function isDesktopContextHovered() {
        return Boolean(
            contextMenu?.matches?.(':hover')
            || reactionPicker?.matches?.(':hover')
        );
    }

    function clearDesktopContextHoverCloseTimer() {
        if (!desktopContextHoverCloseTimer) return;
        window.clearTimeout(desktopContextHoverCloseTimer);
        desktopContextHoverCloseTimer = 0;
    }

    function disarmDesktopContextHoverClose() {
        desktopContextHoverCloseArmed = false;
        clearDesktopContextHoverCloseTimer();
    }

    function scheduleDesktopContextHoverClose() {
        if (!desktopContextHoverCloseArmed) return;
        clearDesktopContextHoverCloseTimer();
        desktopContextHoverCloseTimer = window.setTimeout(() => {
            desktopContextHoverCloseTimer = 0;
            if (!desktopContextHoverCloseArmed || isDesktopContextHovered()) return;
            desktopContextHoverCloseArmed = false;
            messageContextGestureSeq += 1;
            closeReactionPicker();
            hideContextMenu();
        }, DESKTOP_CONTEXT_HOVER_CLOSE_MS);
    }

    function armDesktopContextHoverClose() {
        if (!prefersDesktopContextHover()) return;
        desktopContextHoverCloseArmed = true;
        clearDesktopContextHoverCloseTimer();
    }

    function handleDesktopContextPointerEnter() {
        if (!desktopContextHoverCloseArmed) return;
        clearDesktopContextHoverCloseTimer();
    }

    function handleDesktopContextPointerLeave() {
        scheduleDesktopContextHoverClose();
    }

    function isContextGestureBlockedTarget(target) {
        if (!(target instanceof Element)) return false;
        return Boolean(target.closest(
            'input,textarea,select,label,[contenteditable="true"],' +
            'button,a[href],[role="button"],' +
            '.reaction-pill,.reaction-picker,' +
            '.file-msg-media-trigger,.file-msg-link,.message-link-preview,.reply-quote,' +
            '.audio-player-toggle,.audio-player-progress,.audio-player-speed,' +
            '[data-open-profile-trigger],[data-call-message-trigger]'
        ));
    }

    function resolveContextMenuMessageTarget(target) {
        if (!(target instanceof Element)) return null;
        const messageEl = target.closest('.message[data-msg-id]');
        if (!messageEl || !chatMessages || !chatMessages.contains(messageEl)) return null;
        const contextSurface = target.closest('.bubble,.message-reactions,.message-stack');
        if (!contextSurface || !messageEl.contains(contextSurface)) return null;
        return messageEl && chatMessages.contains(messageEl) ? messageEl : null;
    }

    function resolveMessageActionPayload(messageEl) {
        if (!messageEl) return null;
        const msgId = String(messageEl.getAttribute('data-msg-id') || '').trim();
        if (!msgId) return null;
        const isSunfile = messageEl.getAttribute('data-is-sunfile') === '1';
        const isVoice = messageEl.getAttribute('data-is-voice') === '1';
        const isMedia = messageEl.getAttribute('data-is-media') === '1';
        const isFile = Boolean(messageEl.querySelector('.file-msg-img, .file-msg-video-preview, .file-msg-audio-el, .file-msg-link'));
        // Any sunfile payload except voice messages can have its caption edited
        const canEditFile = isSunfile && !isVoice;
        return {
            msgId,
            isSelf: messageEl.classList.contains('self'),
            isFile,
            isSunfile,
            isVoice,
            isMedia,
            canEditFile,
            content: messageEl.getAttribute('data-message-content') || '',
            messageEl,
        };
    }

    function resetMessageSwipeState(messageEl, immediate = false) {
        if (!messageEl) return;
        if (immediate) messageEl.classList.add('swipe-reply-reset-immediate');
        messageEl.style.removeProperty('--swipe-reply-shift');
        messageEl.classList.remove('swipe-reply-dragging', 'swipe-reply-ready');
        if (immediate) {
            requestAnimationFrame(() => {
                messageEl.classList.remove('swipe-reply-reset-immediate');
            });
        }
    }

    function clearActiveMessageTouchGesture({ immediateReset = false } = {}) {
        if (!activeMessageTouchGesture) return;
        if (activeMessageTouchGesture.longPressTimer) {
            window.clearTimeout(activeMessageTouchGesture.longPressTimer);
        }
        resetMessageSwipeState(activeMessageTouchGesture.messageEl, immediateReset);
        activeMessageTouchGesture = null;
        unbindSwipeReplyBlockingMove();
    }

    function openMessageContextMenuFor(
        msg,
        clientX,
        clientY,
        {
            withReactions = true,
            deferReactions = true,
            originTarget = null,
        } = {},
    ) {
        if (!msg || !msg.isConnected || !chatMessages.contains(msg)) return;
        const contextSeq = ++messageContextGestureSeq;
        disarmDesktopContextHoverClose();
        closeReactionPicker();
        const msgId = msg.getAttribute('data-msg-id');
        const isSelf = msg.classList.contains('self');
        const isFile = Boolean(msg.querySelector('.file-msg-img, .file-msg-video-preview, .file-msg-audio-el, .file-msg-link'));
        const isSunfile = msg.getAttribute('data-is-sunfile') === '1';
        const isVoice = msg.getAttribute('data-is-voice') === '1';
        const isMedia = msg.getAttribute('data-is-media') === '1';
        // Any sunfile payload except voice messages can have its caption edited
        const canEditFile = isSunfile && !isVoice;
        const content = msg.getAttribute('data-message-content') || '';
        const canEdit = isSelf && (!isFile || canEditFile) && canEditMessageById(msgId);
        const blocked = isChatBlocked();
        if (contextReactionDivider) {
            contextReactionDivider.hidden = blocked;
        }
        if (contextReadInfo) {
            contextReadInfo.hidden = true;
        }
        updateContextMenuReadInfo(msgId, {
            isSelf,
            blocked,
            messageEl: msg,
            triggerTarget: originTarget,
        });
        if (contextPinItem) {
            const normalizedMessageId = Number(msgId);
            const isPinned = Number.isFinite(normalizedMessageId) && isPinnedMessage(getCurrentChatId(), normalizedMessageId);
            contextPinItem.innerHTML = isPinned
                ? '<i class="bi bi-pin-angle-fill"></i> Открепить'
                : '<i class="bi bi-pin-angle"></i> Закрепить';
        }
        if (contextFavoriteItem) {
            const normalizedMessageId = Number(msgId);
            const isFavorite = Number.isFinite(normalizedMessageId) && isFavoriteMessage(getCurrentChatId(), normalizedMessageId);
            contextFavoriteItem.innerHTML = isFavorite
                ? '<i class="bi bi-star-fill"></i> \u0423\u0431\u0440\u0430\u0442\u044c \u0438\u0437 \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0433\u043e'
                : '<i class="bi bi-star"></i> \u0412 \u0438\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0435';
        }
        messageActionsBarController.setState(msgId, content, isFile, { canEdit });

        let x = clientX;
        let y = clientY;
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
            const rect = msg.getBoundingClientRect();
            x = rect.left + Math.min(rect.width / 2, 40);
            y = rect.bottom + 6;
        }
        showContextMenu(x, y, msgId, isSelf, isFile, { canEdit });
        if (!blocked && withReactions) {
            const openReactions = () => {
                if (
                    contextSeq !== messageContextGestureSeq
                    || !msg.isConnected
                    || !chatMessages.contains(msg)
                    || !contextMenu?.classList.contains('is-open')
                ) return;
                const anchor = contextMenu || msg.querySelector('.bubble') || msg;
                openReactionPickerForMessage(msgId, anchor);
            };
            if (deferReactions) {
                requestAnimationFrame(openReactions);
            } else {
                openReactions();
            }
        }
        armDesktopContextHoverClose();
        if (prefersTouchMessageGestures()) {
            const swallowSyntheticClick = (ev) => {
                const target = ev.target;
                if (
                    target instanceof Element
                    && (
                        reactionPicker?.contains(target)
                        || contextMenu?.contains(target)
                    )
                ) {
                    document.removeEventListener('click', swallowSyntheticClick, true);
                    return;
                }
                ev.stopPropagation();
                ev.preventDefault();
                document.removeEventListener('click', swallowSyntheticClick, true);
            };
            document.addEventListener('click', swallowSyntheticClick, true);
            window.setTimeout(() => {
                document.removeEventListener('click', swallowSyntheticClick, true);
            }, 400);
        }
    }

    function beginSwipeReplyFromGesture(gesture) {
        if (!gesture?.msgId || !gesture?.messageEl) return;
        const sender = gesture.isSelf ? 'Вы' : getCurrentPartnerDisplayName();
        startReply(gesture.msgId, gesture.content, sender);
    }

    function handleMessageTouchStart(event) {
        if (!prefersTouchMessageGestures()) return;
        if (messageSelectionController.isSelectionMode()) return;
        if (isEditingMessageId()) return;
        if (Date.now() < suppressMessageTapUntil) return;
        if (event.touches?.length !== 1) return;

        const target = event.target;
        const messageEl = resolveContextMenuMessageTarget(target);
        if (!messageEl) return;
        if (isContextGestureBlockedTarget(target)) return;

        const payload = resolveMessageActionPayload(messageEl);
        if (!payload) return;

        const touch = event.touches[0];
        const longPressTimer = window.setTimeout(() => {
            if (!activeMessageTouchGesture) return;
            if (activeMessageTouchGesture.dragging) return;
            if (messageSelectionController.isSelectionMode()) return;
            if (!messageEl.isConnected || !chatMessages.contains(messageEl)) {
                clearActiveMessageTouchGesture({ immediateReset: true });
                return;
            }
            activeMessageTouchGesture.longPressTriggered = true;
            suppressMessageTapUntil = Date.now() + 220;
            try {
                if (navigator.vibrate) navigator.vibrate(15);
            } catch (_) {}
            openMessageContextMenuFor(
                messageEl,
                activeMessageTouchGesture.startX,
                activeMessageTouchGesture.startY,
                { withReactions: true }
            );
        }, MESSAGE_LONG_PRESS_MS);

        clearActiveMessageTouchGesture({ immediateReset: true });
        activeMessageTouchGesture = {
            ...payload,
            startX: touch.clientX,
            startY: touch.clientY,
            lastX: touch.clientX,
            lastY: touch.clientY,
            dragging: false,
            longPressTriggered: false,
            longPressTimer,
        };
    }

    function bindSwipeReplyBlockingMove() {
        if (swipeReplyBlockingMoveBound) return;
        swipeReplyBlockingMoveBound = true;
        chatMessages.addEventListener('touchmove', handleBlockingMessageTouchMove, { passive: false });
    }

    function unbindSwipeReplyBlockingMove() {
        if (!swipeReplyBlockingMoveBound) return;
        swipeReplyBlockingMoveBound = false;
        chatMessages.removeEventListener('touchmove', handleBlockingMessageTouchMove);
    }

    function handleMessageTouchMove(event, { allowPreventDefault = false } = {}) {
        if (!activeMessageTouchGesture) return;
        if (!prefersTouchMessageGestures()) {
            clearActiveMessageTouchGesture({ immediateReset: true });
            return;
        }
        const touch = event.touches?.[0];
        if (!touch) return;
        const gesture = activeMessageTouchGesture;
        gesture.lastX = touch.clientX;
        gesture.lastY = touch.clientY;

        const dx = touch.clientX - gesture.startX;
        const dy = touch.clientY - gesture.startY;
        const absDx = Math.abs(dx);
        const absDy = Math.abs(dy);

        if (!gesture.dragging && absDy > 12 && absDy > absDx) {
            if (gesture.longPressTimer) {
                window.clearTimeout(gesture.longPressTimer);
                gesture.longPressTimer = null;
            }
            return;
        }
        if (gesture.longPressTriggered) return;

        const shouldDrag = dx > 10 && absDx > (absDy * 1.2);
        if (!gesture.dragging && !shouldDrag) return;

        if (gesture.longPressTimer) {
            window.clearTimeout(gesture.longPressTimer);
            gesture.longPressTimer = null;
        }

        if (!gesture.dragging) {
            bindSwipeReplyBlockingMove();
        }
        gesture.dragging = true;
        const shift = Math.max(0, Math.min(SWIPE_REPLY_MAX_SHIFT_PX, dx * 0.82));
        gesture.messageEl.style.setProperty('--swipe-reply-shift', `${shift.toFixed(1)}px`);
        gesture.messageEl.classList.add('swipe-reply-dragging');
        gesture.messageEl.classList.toggle('swipe-reply-ready', shift >= SWIPE_REPLY_TRIGGER_PX);
        if (allowPreventDefault && event.cancelable) event.preventDefault();
    }

    function handlePassiveMessageTouchMove(event) {
        if (swipeReplyBlockingMoveBound) return;
        handleMessageTouchMove(event, { allowPreventDefault: false });
    }

    function handleBlockingMessageTouchMove(event) {
        handleMessageTouchMove(event, { allowPreventDefault: true });
    }

    function handleMessageTouchEnd(event) {
        if (!activeMessageTouchGesture) return;
        const gesture = activeMessageTouchGesture;
        if (gesture.longPressTimer) {
            window.clearTimeout(gesture.longPressTimer);
            gesture.longPressTimer = null;
        }

        const dx = gesture.lastX - gesture.startX;
        const dy = Math.abs(gesture.lastY - gesture.startY);
        const canReply = gesture.dragging
            && !gesture.longPressTriggered
            && dx >= SWIPE_REPLY_TRIGGER_PX
            && dy <= SWIPE_REPLY_MAX_VERTICAL_PX
            && !isChatBlocked();

        resetMessageSwipeState(gesture.messageEl);
        activeMessageTouchGesture = null;
        unbindSwipeReplyBlockingMove();

        if (gesture.longPressTriggered) {
            if (event && typeof event.preventDefault === 'function') {
                try { event.preventDefault(); } catch (_) {}
            }
            return;
        }

        if (canReply) {
            suppressMessageTapUntil = Date.now() + 220;
            beginSwipeReplyFromGesture(gesture);
        }
    }

    function handleMessageTouchCancel() {
        clearActiveMessageTouchGesture();
    }

    function handleContextMenu(event) {
        const msg = resolveContextMenuMessageTarget(event.target);
        if (!msg) return;
        event.preventDefault();
        openMessageContextMenuFor(msg, event.clientX, event.clientY, {
            withReactions: true,
            originTarget: event.target,
        });
    }

    function handleReactionPillClick(event) {
        if (Date.now() < suppressMessageTapUntil) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        const reactionControl = event.target.closest('.reaction-pill');
        if (!reactionControl || !chatMessages.contains(reactionControl)) return;
        if (messageSelectionController.isSelectionMode()) return;

        event.preventDefault();
        event.stopPropagation();
        if (isChatBlocked()) {
            const reactionRow = reactionControl.closest('.message-reactions');
            reactionRow?.classList?.add('reaction-row--disabled');
            reactionControl.classList.add('reaction-pill--disabled');
            window.setTimeout(() => {
                reactionRow?.classList?.remove('reaction-row--disabled');
                reactionControl.classList.remove('reaction-pill--disabled');
            }, 700);
            showToast(getChatBlockNoticeText(getCurrentBlockState()), 'warning');
            return;
        }

        const msgId = Number(reactionControl.getAttribute('data-msg-id'));
        if (!Number.isFinite(msgId) || msgId <= 0) return;
        const emoji = String(reactionControl.getAttribute('data-emoji') || '').trim();
        if (!reactionPickerEmojis.includes(emoji)) return;
        reactionControl.classList.add('reaction-pill--pulse');
        window.setTimeout(() => reactionControl.classList.remove('reaction-pill--pulse'), 220);
        emitReactionToggle(msgId, emoji);
    }

    chatMessages.addEventListener('touchstart', handleMessageTouchStart, { passive: true });
    chatMessages.addEventListener('touchmove', handlePassiveMessageTouchMove, { passive: true });
    chatMessages.addEventListener('touchend', handleMessageTouchEnd, { passive: false });
    chatMessages.addEventListener('touchcancel', handleMessageTouchCancel, { passive: true });
    chatMessages.addEventListener('contextmenu', handleContextMenu);
    chatMessages.addEventListener('click', handleReactionPillClick);
    contextMenu?.addEventListener('pointerenter', handleDesktopContextPointerEnter);
    contextMenu?.addEventListener('pointerleave', handleDesktopContextPointerLeave);
    reactionPicker?.addEventListener('pointerenter', handleDesktopContextPointerEnter);
    reactionPicker?.addEventListener('pointerleave', handleDesktopContextPointerLeave);

    return {
        dispose() {
            chatMessages.removeEventListener('touchstart', handleMessageTouchStart);
            chatMessages.removeEventListener('touchmove', handlePassiveMessageTouchMove);
            unbindSwipeReplyBlockingMove();
            chatMessages.removeEventListener('touchend', handleMessageTouchEnd);
            chatMessages.removeEventListener('touchcancel', handleMessageTouchCancel);
            chatMessages.removeEventListener('contextmenu', handleContextMenu);
            chatMessages.removeEventListener('click', handleReactionPillClick);
            contextMenu?.removeEventListener('pointerenter', handleDesktopContextPointerEnter);
            contextMenu?.removeEventListener('pointerleave', handleDesktopContextPointerLeave);
            reactionPicker?.removeEventListener('pointerenter', handleDesktopContextPointerEnter);
            reactionPicker?.removeEventListener('pointerleave', handleDesktopContextPointerLeave);
            disarmDesktopContextHoverClose();
        },
    };
}
