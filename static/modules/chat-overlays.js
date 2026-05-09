import { withAppRoot } from './app-url.js';
import { setMotionOriginFromPoint, waitForMotionEnd } from './motion.js';

export function initContactContextMenu({
    contactsList,
    menuEl,
    pinButtonEl,
    unpinButtonEl,
    toggleMuteButtonEl,
    deleteButtonEl,
    getCsrfToken,
    showToast,
    showDeleteChatDialog,
    onDeleteChat,
    onReloadChats,
    onPinStateChange,
    onToggleMute,
    isChatMuteRestricted = (contactItem) => String(contactItem?.getAttribute?.('data-saved-messages') || '') === '1',
    isChatMuted = () => false,
    maxPinnedCount = null,
    getPinnedCount = () => 0,
    fetchImpl = window.fetch.bind(window),
} = {}) {
    let targetChatId = null;
    let menuTransitionSeq = 0;
    let pendingLongPress = null;
    let suppressClickUntil = 0;
    const LONG_PRESS_DELAY_MS = 420;
    const LONG_PRESS_MOVE_TOLERANCE_PX = 10;

    function isMobileViewport() {
        try {
            return Boolean(window.matchMedia?.('(max-width: 768px)')?.matches);
        } catch (_) {
            return false;
        }
    }

    function syncMuteButton(chatId) {
        if (!toggleMuteButtonEl) return;
        const muted = Boolean(isChatMuted?.(chatId));
        const icon = toggleMuteButtonEl.querySelector('i');
        const label = toggleMuteButtonEl.querySelector('span');
        if (icon) {
            icon.className = muted ? 'bi bi-bell' : 'bi bi-bell-slash';
        }
        if (label) {
            label.textContent = muted ? '\u0412\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F' : '\u041E\u0442\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0443\u0432\u0435\u0434\u043E\u043C\u043B\u0435\u043D\u0438\u044F';
        }
        toggleMuteButtonEl.setAttribute('aria-pressed', muted ? 'true' : 'false');
    }

    function hasPinnedLimit() {
        return Number.isFinite(Number(maxPinnedCount)) && Number(maxPinnedCount) > 0;
    }

    function canPinMoreChats() {
        if (!hasPinnedLimit()) return true;
        return Number(getPinnedCount?.() || 0) < Number(maxPinnedCount);
    }

    function escapeSelectorValue(value) {
        const raw = String(value || '');
        if (window.CSS?.escape) return window.CSS.escape(raw);
        return raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    }

    function resolveContactItemByChatId(chatId) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId || !contactsList) return null;
        return contactsList.querySelector(`.contact-item[data-chat-id="${escapeSelectorValue(normalizedChatId)}"]`);
    }

    function isChatMuteBlocked(chatId, contactItem = null) {
        const normalizedChatId = String(chatId || '').trim();
        const item = contactItem || resolveContactItemByChatId(normalizedChatId);
        try {
            return Boolean(isChatMuteRestricted(item, normalizedChatId));
        } catch (_) {
            return false;
        }
    }

    function showContactContextMenu(x, y, chatId, isPinned, contactItem = null) {
        if (!menuEl) return;
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) {
            hideContactContextMenu();
            return;
        }
        const targetItem = contactItem || resolveContactItemByChatId(normalizedChatId);
        const muteBlocked = isChatMuteBlocked(normalizedChatId, targetItem);
        const isSavedMessages = String(targetItem?.getAttribute('data-saved-messages') || '') === '1';
        const openSeq = ++menuTransitionSeq;
        targetChatId = normalizedChatId;
        if (pinButtonEl) pinButtonEl.hidden = isPinned;
        if (unpinButtonEl) unpinButtonEl.hidden = !isPinned;
        if (toggleMuteButtonEl) {
            toggleMuteButtonEl.hidden = muteBlocked;
        }
        if (deleteButtonEl) {
            const label = deleteButtonEl.querySelector('span');
            if (label) {
                label.textContent = isSavedMessages ? 'Очистить историю' : 'Удалить чат';
            } else {
                deleteButtonEl.innerHTML = `<i class="bi bi-trash3"></i> ${isSavedMessages ? 'Очистить историю' : 'Удалить чат'}`;
            }
        }
        if (pinButtonEl) {
            const pinLimitReached = !isPinned && !canPinMoreChats();
            pinButtonEl.setAttribute('aria-disabled', pinLimitReached ? 'true' : 'false');
            pinButtonEl.title = pinLimitReached && hasPinnedLimit()
                ? `\u041C\u0430\u043A\u0441\u0438\u043C\u0443\u043C ${Number(maxPinnedCount)} \u0437\u0430\u043A\u0440\u0435\u043F\u043B\u0451\u043D\u043D\u044B\u0445 \u0447\u0430\u0442\u043E\u0432`
                : '';
        }
        syncMuteButton(chatId);

        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const w = menuEl.offsetWidth || 214;
        const h = menuEl.offsetHeight || 132;
        menuEl.style.left = `${x + w > vw ? vw - w - 8 : x}px`;
        menuEl.style.top = `${y + h > vh ? y - h : y}px`;
        setMotionOriginFromPoint(menuEl, x, y);
        menuEl.classList.remove('is-closing');
        menuEl.classList.add('is-opening');
        menuEl.setAttribute('aria-hidden', 'false');
        window.requestAnimationFrame(() => {
            if (!menuEl || openSeq !== menuTransitionSeq) return;
            menuEl.classList.add('is-open');
            menuEl.classList.remove('is-opening');
        });
    }

    function hideContactContextMenu() {
        targetChatId = null;
        if (!menuEl) return;
        const closeSeq = ++menuTransitionSeq;
        menuEl.classList.remove('is-opening', 'is-open');
        menuEl.classList.add('is-closing');
        menuEl.setAttribute('aria-hidden', 'true');
        waitForMotionEnd(menuEl, 220).then(() => {
            if (!menuEl || closeSeq !== menuTransitionSeq) return;
            menuEl.classList.remove('is-closing');
        });
    }

    async function updatePinnedState(chatId, endpoint, isPinned) {
        try {
            const response = await fetchImpl(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify({ chat_id: chatId }),
            });
            const payload = await response.json();
            if (!payload.success) {
                showToast(payload.error || (isPinned ? '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u0447\u0430\u0442' : '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u0447\u0430\u0442'), 'danger');
                return;
            }

            onPinStateChange?.({
                chatId,
                isPinned,
                pinOrder: payload?.pin_order,
            });
        } catch (_) {
            showToast(isPinned ? '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u0447\u0430\u0442' : '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u0447\u0430\u0442', 'danger');
        }
    }

    contactsList?.addEventListener('contextmenu', (event) => {
        const item = event.target.closest('.contact-item');
        if (!item) return;
        event.preventDefault();
        showContactContextMenu(
            event.clientX,
            event.clientY,
            item.getAttribute('data-chat-id'),
            item.getAttribute('data-pinned') === '1',
            item,
        );
    });

    function clearPendingLongPress() {
        if (!pendingLongPress) return;
        if (pendingLongPress.timerId) {
            window.clearTimeout(pendingLongPress.timerId);
        }
        pendingLongPress = null;
    }

    contactsList?.addEventListener('touchstart', (event) => {
        if (!isMobileViewport()) return;
        const touch = event.touches?.[0];
        if (!touch) return;
        const item = event.target.closest('.contact-item');
        if (!item) {
            clearPendingLongPress();
            return;
        }
        const chatId = String(item.getAttribute('data-chat-id') || '').trim();
        if (!chatId) return;

        clearPendingLongPress();
        const startX = touch.clientX;
        const startY = touch.clientY;
        const isPinned = item.getAttribute('data-pinned') === '1';
        const timerId = window.setTimeout(() => {
            if (!pendingLongPress) return;
            suppressClickUntil = Date.now() + 650;
            showContactContextMenu(startX, startY, chatId, isPinned, item);
            pendingLongPress = null;
        }, LONG_PRESS_DELAY_MS);
        pendingLongPress = {
            timerId,
            startX,
            startY,
        };
    }, { passive: true });

    contactsList?.addEventListener('touchmove', (event) => {
        if (!pendingLongPress) return;
        const touch = event.touches?.[0];
        if (!touch) return;
        const dx = Math.abs(touch.clientX - pendingLongPress.startX);
        const dy = Math.abs(touch.clientY - pendingLongPress.startY);
        if (dx > LONG_PRESS_MOVE_TOLERANCE_PX || dy > LONG_PRESS_MOVE_TOLERANCE_PX) {
            clearPendingLongPress();
        }
    }, { passive: true });

    contactsList?.addEventListener('touchend', () => {
        clearPendingLongPress();
    }, { passive: true });

    contactsList?.addEventListener('touchcancel', () => {
        clearPendingLongPress();
    }, { passive: true });

    contactsList?.addEventListener('click', (event) => {
        if (Date.now() > suppressClickUntil) return;
        const item = event.target.closest('.contact-item');
        if (!item) return;
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
    }, true);

    document.addEventListener('click', (event) => {
        if (menuEl && !menuEl.contains(event.target)) {
            hideContactContextMenu();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') hideContactContextMenu();
    });

    pinButtonEl?.addEventListener('click', () => {
        const chatId = targetChatId;
        hideContactContextMenu();
        if (!chatId) return;
        if (!canPinMoreChats()) {
            showToast(hasPinnedLimit()
                ? `\u041C\u043E\u0436\u043D\u043E \u0437\u0430\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u043D\u0435 \u0431\u043E\u043B\u0435\u0435 ${Number(maxPinnedCount)} \u0447\u0430\u0442\u043E\u0432.`
                : '\u041B\u0438\u043C\u0438\u0442 \u0437\u0430\u043A\u0440\u0435\u043F\u043B\u0451\u043D\u043D\u044B\u0445 \u0447\u0430\u0442\u043E\u0432 \u0434\u043E\u0441\u0442\u0438\u0433\u043D\u0443\u0442.', 'warning');
            return;
        }
        updatePinnedState(chatId, withAppRoot('/pin_chat'), true);
    });

    unpinButtonEl?.addEventListener('click', () => {
        const chatId = targetChatId;
        hideContactContextMenu();
        if (!chatId) return;
        updatePinnedState(chatId, withAppRoot('/unpin_chat'), false);
    });

    toggleMuteButtonEl?.addEventListener('click', async () => {
        const chatId = targetChatId;
        hideContactContextMenu();
        if (!chatId) return;
        if (isChatMuteBlocked(chatId)) return;
        try {
            await onToggleMute?.({ chatId, muted: Boolean(isChatMuted?.(chatId)) });
        } catch (_) {
            // Best effort: caller handles toast on error.
        }
    });

    deleteButtonEl?.addEventListener('click', () => {
        const chatId = targetChatId;
        hideContactContextMenu();
        if (!chatId) return;
        const targetItem = resolveContactItemByChatId(chatId);
        const isGroup = String(targetItem?.getAttribute('data-is-group') || '') === '1';
        showDeleteChatDialog(chatId, {
            onDeleted: () => onDeleteChat?.(chatId),
            onReload: onReloadChats,
            isGroup,
        });
    });

    return {
        showContactContextMenu,
        hideContactContextMenu,
    };
}

export function initDeleteMessagesModal({
    modalEl,
    cancelButtonEl,
    confirmButtonEl,
    deleteForBothCheckEl,
    deleteForBothWrapEl,
    titleEl,
    isChatBlocked,
    getBlockedNoticeText,
    currentBlockState,
    resolveMessageElement,
    openDialog,
    closeDialog,
    onConfirm,
    onBlocked,
    onAfterConfirm,
} = {}) {
    let pendingMessageIds = [];

    function openDeleteModal(msgIds) {
        if (isChatBlocked()) {
            onBlocked?.(getBlockedNoticeText(currentBlockState()));
            return;
        }

        pendingMessageIds = Array.isArray(msgIds) ? msgIds : [msgIds];
        if (titleEl) {
            titleEl.textContent = pendingMessageIds.length > 1
                ? `\u0423\u0434\u0430\u043B\u0438\u0442\u044C ${pendingMessageIds.length} \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F?`
                : '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u044D\u0442\u043E \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435?';
        }

        const allMine = pendingMessageIds.every((id) => {
            const el = resolveMessageElement(id);
            return Boolean(el?.classList.contains('self'));
        });

        if (deleteForBothWrapEl) {
            deleteForBothWrapEl.style.display = allMine ? 'block' : 'none';
        }
        if (deleteForBothCheckEl) {
            deleteForBothCheckEl.checked = false;
        }

        openDialog(modalEl);
    }

    cancelButtonEl?.addEventListener('click', () => closeDialog(modalEl));
    modalEl?.addEventListener('click', (event) => {
        if (event.target === modalEl) closeDialog(modalEl);
    });
    modalEl?.addEventListener('cancel', (event) => {
        event.preventDefault();
        closeDialog(modalEl);
    });

    confirmButtonEl?.addEventListener('click', () => {
        if (isChatBlocked()) {
            closeDialog(modalEl);
            return;
        }
        if (!pendingMessageIds.length) return;

        const mode = deleteForBothCheckEl?.checked ? 'for_both' : 'for_me';
        onConfirm?.({
            messageIds: pendingMessageIds,
            mode,
        });
        closeDialog(modalEl);
        onAfterConfirm?.();
    });

    return {
        openDeleteModal,
    };
}
