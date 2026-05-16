import { setMotionOriginFromPoint, waitForMotionEnd } from './motion.js';

export function initMessageContextMenu({
    menuEl,
    replyItemEl,
    pinItemEl,
    favoriteItemEl,
    copyItemEl,
    forwardItemEl,
    editItemEl,
    selectItemEl,
    reportItemEl,
    deleteItemEl,
    deleteForAllItemEl,
    isChatBlocked,
    resolveMessageElement,
    getPartnerDisplayName,
    copyTextToClipboard,
    showToast,
    onReply,
    onEdit,
    onPin,
    onFavorite,
    onForward,
    onDelete,
    onDeleteForAll,
    onSelect,
    onReport,
    isCurrentUserGroupModerator = () => false,
} = {}) {
    let currentMessageId = null;
    let menuTransitionSeq = 0;
    let repositionRafId = 0;
    let viewportBoundsLock = null;

    function getViewportBounds() {
        if (viewportBoundsLock) {
            return { ...viewportBoundsLock };
        }
        const vv = window.visualViewport;
        const left = vv ? Number(vv.offsetLeft || 0) : 0;
        const top = vv ? Number(vv.offsetTop || 0) : 0;
        const width = vv ? Number(vv.width || window.innerWidth) : window.innerWidth;
        const height = vv ? Number(vv.height || window.innerHeight) : window.innerHeight;
        const headerRect = document.getElementById('chatHeader')?.getBoundingClientRect?.();
        const inputRect = document.querySelector('.chat-input-area')?.getBoundingClientRect?.();
        const safeTop = headerRect && headerRect.bottom > top && headerRect.bottom < top + height
            ? headerRect.bottom
            : top;
        const visualBottom = top + height;
        const keyboardActive = Boolean(document.documentElement?.classList?.contains('mobile-keyboard-active'));
        const safeBottom = !keyboardActive && inputRect && inputRect.top > safeTop && inputRect.top < visualBottom
            ? inputRect.top
            : visualBottom;
        return {
            left,
            top: safeTop,
            right: left + width,
            bottom: safeBottom,
        };
    }

    function clamp(value, min, max) {
        if (!Number.isFinite(value)) return min;
        if (!Number.isFinite(max) || max < min) return min;
        return Math.min(max, Math.max(min, value));
    }

    function resolveMessageAnchorRect(msgId) {
        const messageEl = resolveMessageElement?.(msgId);
        if (!messageEl) return null;
        const anchor = messageEl.querySelector('.bubble') || messageEl;
        return anchor.getBoundingClientRect();
    }

    function positionContextMenu(x, y, msgId) {
        if (!menuEl) return;
        const vv = window.visualViewport;
        const bounds = getViewportBounds();
        const margin = 8;
        const gap = 10;
        const viewportX = Number.isFinite(x) ? x + (vv ? Number(vv.offsetLeft || 0) : 0) : NaN;
        const viewportY = Number.isFinite(y) ? y + (vv ? Number(vv.offsetTop || 0) : 0) : NaN;

        const availableHeight = Math.max(160, bounds.bottom - bounds.top - margin * 2);
        menuEl.style.maxHeight = `${Math.round(availableHeight)}px`;
        menuEl.style.overflowY = 'auto';
        const menuRect = menuEl.getBoundingClientRect();
        const menuWidth = Math.max(190, Math.ceil(menuRect.width) || 0);
        const menuHeight = Math.max(120, Math.ceil(menuRect.height) || 0);
        const minLeft = bounds.left + margin;
        const maxLeft = bounds.right - menuWidth - margin;
        const minTop = bounds.top + margin;
        const maxTop = bounds.bottom - menuHeight - margin;

        const anchorRect = resolveMessageAnchorRect(msgId);
        let targetLeft = viewportX;
        let targetTop = viewportY;

        if (anchorRect) {
            const centeredLeft = anchorRect.left + (anchorRect.width - menuWidth) / 2;
            const aboveTop = anchorRect.top - menuHeight - gap;
            const belowTop = anchorRect.bottom + gap;
            const canPlaceAbove = aboveTop >= minTop;
            const canPlaceBelow = (belowTop + menuHeight) <= (bounds.bottom - margin);

            targetLeft = centeredLeft;
            if (canPlaceAbove) {
                targetTop = aboveTop;
            } else if (canPlaceBelow) {
                targetTop = belowTop;
            } else {
                const fallbackTop = Number.isFinite(viewportY) ? (viewportY - (menuHeight * 0.45)) : aboveTop;
                targetTop = fallbackTop;
            }
        } else {
            if (!Number.isFinite(targetLeft)) targetLeft = bounds.left + margin;
            if (!Number.isFinite(targetTop)) targetTop = bounds.top + margin;
            if (targetTop + menuHeight > bounds.bottom - margin) {
                targetTop = targetTop - menuHeight;
            }
        }

        menuEl.style.left = `${Math.round(clamp(targetLeft, minLeft, maxLeft))}px`;
        menuEl.style.top = `${Math.round(clamp(targetTop, minTop, maxTop))}px`;
    }

    function scheduleReposition() {
        if (!menuEl || !currentMessageId) return;
        const isVisible = menuEl.classList.contains('is-open') || menuEl.classList.contains('is-opening');
        if (!isVisible) return;
        if (viewportBoundsLock) return;
        if (repositionRafId) return;
        repositionRafId = window.requestAnimationFrame(() => {
            repositionRafId = 0;
            if (!menuEl || !currentMessageId) return;
            const anchorRect = resolveMessageAnchorRect(currentMessageId);
            if (!anchorRect) {
                hideContextMenu();
                return;
            }
            const anchorX = anchorRect.left + Math.min(anchorRect.width / 2, 64);
            const anchorY = anchorRect.bottom + 6;
            positionContextMenu(anchorX, anchorY, currentMessageId);
        });
    }

    function getVisibleContextMenuItems() {
        return [
            replyItemEl,
            pinItemEl,
            favoriteItemEl,
            copyItemEl,
            forwardItemEl,
            editItemEl,
            selectItemEl,
            reportItemEl,
            deleteItemEl,
            deleteForAllItemEl,
        ].filter((item) => item && !item.hidden && item.getAttribute('aria-hidden') !== 'true');
    }

    function focusContextMenuItem(index = 0) {
        const items = getVisibleContextMenuItems();
        if (!items.length) return;
        const safeIndex = Math.max(0, Math.min(index, items.length - 1));
        window.requestAnimationFrame(() => {
            items[safeIndex]?.focus?.({ preventScroll: true });
        });
    }

    function showContextMenu(x, y, msgId, isSelf, options = {}) {
        currentMessageId = msgId;
        if (!menuEl) return;
        const openSeq = ++menuTransitionSeq;

        const blocked = isChatBlocked();
        const messageEl = resolveMessageElement?.(msgId);
        const isOwnMessage = messageEl
            ? Boolean(messageEl.classList.contains('self'))
            : Boolean(isSelf);
        const canEdit = options?.canEdit !== false;
        // canDeleteForAll: explicit option takes priority, otherwise use moderator check
        const canDeleteForAll = Object.prototype.hasOwnProperty.call(options || {}, 'canDeleteForAll')
            ? Boolean(options.canDeleteForAll)
            : Boolean(isCurrentUserGroupModerator());
        viewportBoundsLock = null;
        viewportBoundsLock = getViewportBounds();
        if (replyItemEl) replyItemEl.hidden = blocked;
        if (editItemEl) editItemEl.hidden = blocked || !isOwnMessage || !canEdit;
        if (deleteItemEl) deleteItemEl.hidden = blocked;
        if (deleteForAllItemEl) deleteForAllItemEl.hidden = blocked || !canDeleteForAll;
        if (pinItemEl) pinItemEl.hidden = blocked;
        if (favoriteItemEl) favoriteItemEl.hidden = blocked;
        if (forwardItemEl) forwardItemEl.hidden = blocked;
        if (selectItemEl) selectItemEl.hidden = blocked;
        if (reportItemEl) reportItemEl.hidden = blocked || isOwnMessage;
        positionContextMenu(x, y, msgId);
        setMotionOriginFromPoint(menuEl, x, y);
        menuEl.classList.remove('is-closing');
        menuEl.classList.add('is-opening');
        menuEl.setAttribute('aria-hidden', 'false');
        window.requestAnimationFrame(() => {
            if (!menuEl || openSeq !== menuTransitionSeq) return;
            menuEl.classList.add('is-open');
            menuEl.classList.remove('is-opening');
            focusContextMenuItem(0);
        });
    }

    function hideContextMenu(options = {}) {
        currentMessageId = null;
        viewportBoundsLock = null;
        if (!menuEl) return;
        if (repositionRafId) {
            window.cancelAnimationFrame(repositionRafId);
            repositionRafId = 0;
        }
        const closeSeq = ++menuTransitionSeq;
        menuEl.classList.remove('is-opening', 'is-open');
        menuEl.setAttribute('aria-hidden', 'true');
        if (options?.immediate) {
            menuEl.classList.remove('is-closing');
            menuEl.style.left = '-9999px';
            menuEl.style.top = '-9999px';
            return;
        }
        menuEl.classList.add('is-closing');
        waitForMotionEnd(menuEl, 180).then(() => {
            if (!menuEl || closeSeq !== menuTransitionSeq) return;
            menuEl.classList.remove('is-closing');
        });
    }

    menuEl?.addEventListener('sun:context-menu-hide', (event) => {
        hideContextMenu(event?.detail || {});
    });

    document.addEventListener('click', (event) => {
        if (menuEl && !menuEl.contains(event.target)) {
            hideContextMenu();
        }
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') hideContextMenu();
    });
    menuEl?.addEventListener('keydown', (event) => {
        const items = getVisibleContextMenuItems();
        if (!items.length) return;
        const currentIndex = Math.max(0, items.indexOf(document.activeElement));
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusContextMenuItem((currentIndex + 1) % items.length);
            return;
        }
        if (event.key === 'ArrowUp') {
            event.preventDefault();
            focusContextMenuItem((currentIndex - 1 + items.length) % items.length);
            return;
        }
        if (event.key === 'Home') {
            event.preventDefault();
            focusContextMenuItem(0);
            return;
        }
        if (event.key === 'End') {
            event.preventDefault();
            focusContextMenuItem(items.length - 1);
        }
    });
    window.addEventListener('resize', scheduleReposition, { passive: true });
    window.addEventListener('scroll', scheduleReposition, { passive: true });
    window.visualViewport?.addEventListener('resize', scheduleReposition);
    window.visualViewport?.addEventListener('scroll', scheduleReposition);

    replyItemEl?.addEventListener('click', () => {
        if (isChatBlocked()) return;
        const msgId = currentMessageId;
        hideContextMenu();
        if (!msgId) return;

        const element = resolveMessageElement(msgId);
        if (!element) return;
        const text = element.getAttribute('data-message-content') || '';
        const isSelf = element.classList.contains('self');
        const sender = isSelf ? '\u0412\u044B' : getPartnerDisplayName();
        onReply?.(msgId, text, sender);
    });

    copyItemEl?.addEventListener('click', async () => {
        if (!currentMessageId) return;
        const element = resolveMessageElement(currentMessageId);
        const text = element ? (element.getAttribute('data-message-content') || '') : '';
        if (text) {
            const copied = await copyTextToClipboard(text);
            if (copied) showToast?.('\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E', 'success');
        }
        hideContextMenu();
    });

    forwardItemEl?.addEventListener('click', () => {
        if (isChatBlocked()) return;
        const msgId = currentMessageId ? String(currentMessageId) : '';
        if (!msgId) return;
        hideContextMenu();
        onForward?.(msgId);
    });

    editItemEl?.addEventListener('click', () => {
        if (isChatBlocked()) return;
        const msgId = currentMessageId;
        hideContextMenu();
        if (!msgId) return;
        const element = resolveMessageElement(msgId);
        if (element) {
            onEdit?.(msgId, element.getAttribute('data-message-content') || '');
        }
    });

    deleteItemEl?.addEventListener('click', () => {
        if (isChatBlocked()) return;
        const msgId = currentMessageId;
        hideContextMenu();
        if (msgId) onDelete?.(msgId);
    });

    deleteForAllItemEl?.addEventListener('click', () => {
        if (isChatBlocked()) return;
        const msgId = currentMessageId;
        hideContextMenu();
        if (msgId) onDeleteForAll?.(msgId);
    });

    pinItemEl?.addEventListener('click', () => {
        if (isChatBlocked()) return;
        const msgId = currentMessageId;
        hideContextMenu();
        if (msgId) onPin?.(msgId);
    });

    favoriteItemEl?.addEventListener('click', () => {
        if (isChatBlocked()) return;
        const msgId = currentMessageId;
        hideContextMenu();
        if (msgId) onFavorite?.(msgId);
    });

    selectItemEl?.addEventListener('click', () => {
        if (isChatBlocked()) return;
        const msgId = currentMessageId ? String(currentMessageId) : '';
        if (!msgId) return;
        const element = resolveMessageElement(msgId);
        if (element) {
            onSelect?.(msgId, element);
        }
        hideContextMenu();
    });

    reportItemEl?.addEventListener('click', () => {
        if (isChatBlocked()) return;
        const msgId = currentMessageId ? String(currentMessageId) : '';
        if (!msgId) return;
        const element = resolveMessageElement(msgId);
        hideContextMenu();
        onReport?.(msgId, element || null);
    });

    return {
        menuEl,
        showContextMenu,
        hideContextMenu,
        getCurrentMessageId() {
            return currentMessageId;
        },
        setDeleteForAllVisible(visible) {
            if (deleteForAllItemEl) deleteForAllItemEl.hidden = !visible;
        },
    };
}
