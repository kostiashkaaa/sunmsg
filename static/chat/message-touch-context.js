export function initMessageTouchContext(options = {}) {
    const {
        chatMessages,
        reactionPicker,
        contextMenu,
        messageSelectionController,
        closeReactionPicker,
        hideContextMenu,
        closeMessageActionsBar,
        toggleSelectionMode,
        toggleMessageSelection,
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
        positionReactionPicker,
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

    const MESSAGE_LONG_PRESS_MS = 360;
    const SWIPE_REPLY_TRIGGER_PX = 72;
    const SWIPE_REPLY_MAX_SHIFT_PX = 96;
    const SWIPE_REPLY_MAX_VERTICAL_PX = 52;
    let activeMessageTouchGesture = null;
    let suppressMessageTapUntil = 0;

    function prefersTouchMessageGestures() {
        try {
            return window.matchMedia('(pointer: coarse)').matches;
        } catch (_) {
            return false;
        }
    }

    function isInteractiveMessageTarget(target) {
        if (!(target instanceof Element)) return false;
        return Boolean(target.closest(
            'a,button,input,textarea,select,label,[contenteditable="true"],' +
            '.reaction-pill,.reaction-picker,.file-msg-media-trigger,.file-msg-link,' +
            '.audio-player,.audio-player-toggle,.audio-player-progress,.audio-player-speed,.reply-quote'
        ));
    }

    function isAudioControlTarget(target) {
        if (!(target instanceof Element)) return false;
        return Boolean(target.closest('.audio-player-toggle,.audio-player-speed,.file-msg-audio-wrap,.file-msg-audio-player'));
    }

    function isAudioSeekTarget(target) {
        if (!(target instanceof Element)) return false;
        return Boolean(target.closest('.audio-player-progress'));
    }

    function resolveContextMenuMessageTarget(target) {
        if (!(target instanceof Element)) return null;
        const bubbleEl = target.closest('.message[data-msg-id] .bubble');
        if (!bubbleEl || !chatMessages || !chatMessages.contains(bubbleEl)) return null;
        const messageEl = bubbleEl.closest('.message[data-msg-id]');
        return messageEl && chatMessages.contains(messageEl) ? messageEl : null;
    }

    function resolveMessageActionPayload(messageEl) {
        if (!messageEl) return null;
        const msgId = String(messageEl.getAttribute('data-msg-id') || '').trim();
        if (!msgId) return null;
        return {
            msgId,
            isSelf: messageEl.classList.contains('self'),
            isFile: Boolean(messageEl.querySelector('.file-msg-img, .file-msg-video-preview, .file-msg-audio-el, .file-msg-link')),
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
    }

    function openMessageContextMenuFor(msg, clientX, clientY, { withReactions = true, deferReactions = false } = {}) {
        if (!msg) return;
        closeReactionPicker();
        const msgId = msg.getAttribute('data-msg-id');
        const isSelf = msg.classList.contains('self');
        const isFile = Boolean(msg.querySelector('.file-msg-img, .file-msg-video-preview, .file-msg-audio-el, .file-msg-link'));
        const content = msg.getAttribute('data-message-content') || '';
        const canEdit = isSelf && !isFile && canEditMessageById(msgId);
        const blocked = isChatBlocked();
        if (contextReactionDivider) {
            contextReactionDivider.hidden = blocked;
        }
        if (contextReadInfo) {
            contextReadInfo.hidden = true;
        }
        updateContextMenuReadInfo(msgId, { isSelf, blocked, messageEl: msg });
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
                const anchor = contextMenu || msg.querySelector('.bubble') || msg;
                openReactionPickerForMessage(msgId, anchor);
                requestAnimationFrame(() => {
                    requestAnimationFrame(() => {
                        positionReactionPicker();
                    });
                });
            };
            if (deferReactions) {
                requestAnimationFrame(openReactions);
            } else {
                openReactions();
            }
        }
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

    function startMultiSelectFromMessage(messageEl) {
        const payload = resolveMessageActionPayload(messageEl);
        if (!payload) return;
        closeReactionPicker();
        hideContextMenu();
        closeMessageActionsBar();
        if (!messageSelectionController.isSelectionMode()) {
            toggleSelectionMode(true);
        }
        toggleMessageSelection(payload.msgId, messageEl);
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
        const interactiveTarget = isInteractiveMessageTarget(target);
        const audioControlTarget = isAudioControlTarget(target);
        const audioSeekTarget = isAudioSeekTarget(target);
        if (interactiveTarget && (!audioControlTarget || audioSeekTarget)) return;

        const payload = resolveMessageActionPayload(messageEl);
        if (!payload) return;

        const touch = event.touches[0];
        const longPressTimer = window.setTimeout(() => {
            if (!activeMessageTouchGesture) return;
            if (activeMessageTouchGesture.dragging) return;
            if (messageSelectionController.isSelectionMode()) return;
            activeMessageTouchGesture.longPressTriggered = true;
            suppressMessageTapUntil = Date.now() + 220;
            try {
                if (navigator.vibrate) navigator.vibrate(15);
            } catch (_) {}
            if (activeMessageTouchGesture.audioControlTarget) {
                openMessageContextMenuFor(messageEl, activeMessageTouchGesture.startX, activeMessageTouchGesture.startY, { withReactions: true });
                return;
            }
            startMultiSelectFromMessage(messageEl);
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
            audioControlTarget,
        };
    }

    function handleMessageTouchMove(event) {
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

        gesture.dragging = true;
        const shift = Math.max(0, Math.min(SWIPE_REPLY_MAX_SHIFT_PX, dx * 0.82));
        gesture.messageEl.style.setProperty('--swipe-reply-shift', `${shift.toFixed(1)}px`);
        gesture.messageEl.classList.add('swipe-reply-dragging');
        gesture.messageEl.classList.toggle('swipe-reply-ready', shift >= SWIPE_REPLY_TRIGGER_PX);
        event.preventDefault();
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

        const isTap = !gesture.dragging
            && !gesture.longPressTriggered
            && Math.abs(dx) < 8
            && dy < 8;

        resetMessageSwipeState(gesture.messageEl);
        activeMessageTouchGesture = null;

        if (canReply) {
            suppressMessageTapUntil = Date.now() + 220;
            beginSwipeReplyFromGesture(gesture);
            return;
        }

        if (!isTap) return;
        if (messageSelectionController.isSelectionMode()) return;
        if (isEditingMessageId()) return;
        const messageEl = gesture.messageEl;
        if (!messageEl || !messageEl.isConnected) return;
        const tapTarget = event?.target;
        if (tapTarget && isInteractiveMessageTarget(tapTarget)) return;

        const touch = event?.changedTouches?.[0];
        const x = touch ? touch.clientX : gesture.lastX;
        const y = touch ? touch.clientY : gesture.lastY;
        suppressMessageTapUntil = Date.now() + 280;
        if (event && typeof event.preventDefault === 'function') {
            try { event.preventDefault(); } catch (_) {}
        }
        openMessageContextMenuFor(messageEl, x, y, { withReactions: true });
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
            deferReactions: true,
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
    chatMessages.addEventListener('touchmove', handleMessageTouchMove, { passive: false });
    chatMessages.addEventListener('touchend', handleMessageTouchEnd, { passive: true });
    chatMessages.addEventListener('touchcancel', handleMessageTouchCancel, { passive: true });
    chatMessages.addEventListener('contextmenu', handleContextMenu);
    chatMessages.addEventListener('click', handleReactionPillClick);

    return {
        dispose() {
            chatMessages.removeEventListener('touchstart', handleMessageTouchStart);
            chatMessages.removeEventListener('touchmove', handleMessageTouchMove);
            chatMessages.removeEventListener('touchend', handleMessageTouchEnd);
            chatMessages.removeEventListener('touchcancel', handleMessageTouchCancel);
            chatMessages.removeEventListener('contextmenu', handleContextMenu);
            chatMessages.removeEventListener('click', handleReactionPillClick);
        },
    };
}
