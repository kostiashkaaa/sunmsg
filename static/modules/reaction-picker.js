import { setMotionOriginFromPoint, waitForMotionEnd } from './motion.js';
import { REACTION_PICKER_EMOJIS } from './reactions.js';
import { initReactionEmojiPopup } from './reaction-emoji-popup.js';
import { applyEmojiGraphics } from './utils.js';

export function initReactionPickerController({
    pickerEl,
    contextMenuEl,
    getCurrentContextMessageId,
    resolveMessageElement,
    onSelectEmoji,
} = {}) {
    const QUICK_REACTION_COUNT = 7;
    const PICKER_MOTION_TIMEOUT_MS = 120;
    let activeMessageId = null;
    let activeAnchorEl = null;
    let pickerTransitionSeq = 0;
    let positionRafId = 0;
    let viewportBoundsLock = null;
    let quickContainerEl = null;
    let expandToggleEl = null;

    function createPickerItem(emoji) {
        const normalized = String(emoji || '').trim();
        if (!REACTION_PICKER_EMOJIS.includes(normalized)) return null;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'reaction-picker__item';
        button.setAttribute('data-emoji', normalized);
        button.setAttribute('aria-label', `Reaction ${normalized}`);
        button.textContent = normalized;
        return button;
    }

    function renderPickerItems(container, emojis) {
        if (!container) return;
        const fragment = document.createDocumentFragment();
        emojis.forEach((emoji) => {
            const item = createPickerItem(emoji);
            if (item) fragment.append(item);
        });
        container.replaceChildren(fragment);
        applyEmojiGraphics(container);
    }

    function uniqueValidEmojis(values) {
        const seen = new Set();
        const normalized = [];
        (Array.isArray(values) ? values : []).forEach((value) => {
            const emoji = String(value || '').trim();
            if (!REACTION_PICKER_EMOJIS.includes(emoji)) return;
            if (seen.has(emoji)) return;
            seen.add(emoji);
            normalized.push(emoji);
        });
        return normalized;
    }

    function findDirectChildByClass(parent, className) {
        if (!parent || !className) return null;
        return Array.from(parent.children || []).find(
            (child) => child?.classList?.contains(className)
        ) || null;
    }

    function ensurePickerStructure() {
        if (!pickerEl) return;
        const legacyTopItems = Array.from(pickerEl.children || []).filter(
            (child) => child?.classList?.contains('reaction-picker__item')
        );

        let rowEl = findDirectChildByClass(pickerEl, 'reaction-picker__row');
        if (!rowEl) {
            rowEl = document.createElement('div');
            rowEl.className = 'reaction-picker__row';
            pickerEl.prepend(rowEl);
        }

        quickContainerEl = rowEl.querySelector('.reaction-picker__quick');
        if (!quickContainerEl) {
            quickContainerEl = document.createElement('div');
            quickContainerEl.className = 'reaction-picker__quick';
            rowEl.prepend(quickContainerEl);
        }

        expandToggleEl = rowEl.querySelector('[data-reaction-expand-toggle]');
        if (!expandToggleEl) {
            expandToggleEl = document.createElement('button');
            expandToggleEl.type = 'button';
            expandToggleEl.className = 'reaction-picker__expand-toggle';
            expandToggleEl.setAttribute('data-reaction-expand-toggle', '1');
            expandToggleEl.setAttribute('aria-expanded', 'false');
            expandToggleEl.setAttribute('aria-haspopup', 'dialog');
            expandToggleEl.setAttribute('aria-label', 'More reactions');
            expandToggleEl.innerHTML = '<i class="bi bi-chevron-down" aria-hidden="true"></i>';
            rowEl.append(expandToggleEl);
        }

        const legacyExpanded = findDirectChildByClass(pickerEl, 'reaction-picker__expanded');
        if (legacyExpanded) {
            legacyExpanded.remove();
        }

        const legacyEmojis = uniqueValidEmojis(
            legacyTopItems.map((button) => button.getAttribute('data-emoji') || button.textContent || '')
        );
        const existingQuickEmojis = uniqueValidEmojis(
            Array.from(quickContainerEl.querySelectorAll('.reaction-picker__item'))
                .map((button) => button.getAttribute('data-emoji') || button.textContent || '')
        );
        const quickSource = existingQuickEmojis.length
            ? existingQuickEmojis
            : (legacyEmojis.length ? legacyEmojis : REACTION_PICKER_EMOJIS);

        renderPickerItems(quickContainerEl, quickSource.slice(0, QUICK_REACTION_COUNT));
        legacyTopItems.forEach((item) => item.remove());
    }

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
        const safeBottom = inputRect && inputRect.top > safeTop && inputRect.top < top + height
            ? inputRect.top
            : top + height;
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

    function getPickerAnchorRect() {
        if (!pickerEl) return null;
        return pickerEl.getBoundingClientRect();
    }

    const reactionEmojiPopup = initReactionEmojiPopup({
        allowedEmojis: REACTION_PICKER_EMOJIS,
        getAnchorRect: getPickerAnchorRect,
        getViewportBounds,
        onSelectEmoji: (emoji) => {
            const msgId = Number(activeMessageId);
            if (!Number.isFinite(msgId) || msgId <= 0) return;
            onSelectEmoji?.(msgId, emoji);
            closeReactionPicker();
        },
        onOpen: () => {
            if (!expandToggleEl) return;
            expandToggleEl.setAttribute('aria-expanded', 'true');
            const icon = expandToggleEl.querySelector('i');
            if (icon) {
                icon.className = 'bi bi-chevron-up';
            }
        },
        onClose: () => {
            if (!expandToggleEl) return;
            expandToggleEl.setAttribute('aria-expanded', 'false');
            const icon = expandToggleEl.querySelector('i');
            if (icon) {
                icon.className = 'bi bi-chevron-down';
            }
        },
        onQuickListChange: (nextQuickEmojis) => {
            if (!quickContainerEl) return;
            renderPickerItems(quickContainerEl, nextQuickEmojis.slice(0, QUICK_REACTION_COUNT));
        },
    });

    function schedulePositionReactionPicker() {
        if (!pickerEl) return;
        const isPickerVisible = pickerEl.classList.contains('active') || pickerEl.classList.contains('is-opening');
        if (!isPickerVisible && !reactionEmojiPopup.isOpen()) return;
        if (viewportBoundsLock) return;
        if (positionRafId) return;
        positionRafId = window.requestAnimationFrame(() => {
            positionRafId = 0;
            positionReactionPicker();
        });
    }

    function clearScheduledPosition() {
        if (!positionRafId) return;
        window.cancelAnimationFrame(positionRafId);
        positionRafId = 0;
    }

    ensurePickerStructure();
    renderPickerItems(
        quickContainerEl,
        reactionEmojiPopup.getQuickEmojis(QUICK_REACTION_COUNT),
    );

    function clearActiveReactionRow() {
        if (activeAnchorEl?.closest) {
            const activeRow = activeAnchorEl.closest('.message-reactions');
            if (activeRow) {
                activeRow.classList.remove('reaction-row--active');
            }
        }
        const msgId = Number(activeMessageId);
        if (!Number.isFinite(msgId) || msgId <= 0) return;
        const messageEl = resolveMessageElement?.(msgId);
        const rowEl = messageEl?.querySelector?.('.message-reactions');
        rowEl?.classList?.remove('reaction-row--active');
    }

    function hideContextMenuForEmojiPopup() {
        if (!contextMenuEl) return;
        contextMenuEl.dispatchEvent(new CustomEvent('sun:context-menu-hide', {
            detail: { immediate: true },
        }));
        if (
            contextMenuEl.getAttribute('aria-hidden') === 'true'
            && !contextMenuEl.classList.contains('is-open')
            && !contextMenuEl.classList.contains('is-opening')
            && !contextMenuEl.classList.contains('is-closing')
        ) {
            return;
        }
        contextMenuEl.classList.remove('is-opening', 'is-open', 'is-closing');
        contextMenuEl.setAttribute('aria-hidden', 'true');
        contextMenuEl.style.left = '-9999px';
        contextMenuEl.style.top = '-9999px';
    }

    function closeReactionPicker() {
        if (!pickerEl) return;
        const isPickerActive = pickerEl.classList.contains('active')
            || pickerEl.classList.contains('is-opening')
            || pickerEl.classList.contains('is-closing');
        if (!isPickerActive && !reactionEmojiPopup.isOpen()) return;

        clearScheduledPosition();
        reactionEmojiPopup.close();

        if (!isPickerActive) {
            clearActiveReactionRow();
            activeMessageId = null;
            activeAnchorEl = null;
            return;
        }

        const closeSeq = ++pickerTransitionSeq;
        pickerEl.classList.remove('active', 'is-opening');
        pickerEl.classList.add('is-closing');
        clearActiveReactionRow();
        activeMessageId = null;
        activeAnchorEl = null;
        viewportBoundsLock = null;
        waitForMotionEnd(pickerEl, PICKER_MOTION_TIMEOUT_MS).then(() => {
            if (closeSeq !== pickerTransitionSeq) return;
            pickerEl.classList.remove('is-closing');
            pickerEl.style.left = '-9999px';
            pickerEl.style.top = '-9999px';
        });
    }

    function positionReactionPicker() {
        if (!pickerEl || !activeAnchorEl) return;
        if (!document.body.contains(activeAnchorEl)) {
            closeReactionPicker();
            return;
        }

        const anchorRect = activeAnchorEl.getBoundingClientRect();
        const bounds = getViewportBounds();
        const margin = 10;
        const maxPickerWidth = Math.max(220, bounds.right - bounds.left - margin * 2);

        pickerEl.style.left = '0px';
        pickerEl.style.top = '0px';
        pickerEl.style.maxWidth = `${Math.round(maxPickerWidth)}px`;
        const pickerRect = pickerEl.getBoundingClientRect();

        const isContextMenuVisible = Boolean(
            contextMenuEl
            && contextMenuEl.getAttribute('aria-hidden') !== 'true'
            && (contextMenuEl.classList.contains('is-open') || contextMenuEl.classList.contains('is-opening'))
        );
        const isContextMenuMode = Boolean(
            isContextMenuVisible
            && activeAnchorEl === contextMenuEl
            && Number(getCurrentContextMessageId?.()) === Number(activeMessageId),
        );

        if (isContextMenuMode) {
            const gap = 4;
            const menuRect = contextMenuEl.getBoundingClientRect();
            let left = menuRect.left + (menuRect.width / 2) - (pickerRect.width / 2);
            const topAbove = menuRect.top - pickerRect.height - gap;
            const topBelow = menuRect.bottom + gap;
            const canPlaceAbove = topAbove >= bounds.top + margin;
            const canPlaceBelow = (topBelow + pickerRect.height) <= (bounds.bottom - margin);
            let top = topAbove;
            if (!canPlaceAbove && canPlaceBelow) {
                top = topBelow;
            }

            left = clamp(left, bounds.left + margin, bounds.right - pickerRect.width - margin);
            top = clamp(top, bounds.top + margin, bounds.bottom - pickerRect.height - margin);
            pickerEl.style.left = `${Math.round(left)}px`;
            pickerEl.style.top = `${Math.round(top)}px`;
            reactionEmojiPopup.position();
            return;
        }

        let left = anchorRect.left + (anchorRect.width / 2) - (pickerRect.width / 2);
        let top = anchorRect.top - pickerRect.height - 10;
        if (top < bounds.top + margin) {
            top = anchorRect.bottom + 10;
        }

        left = clamp(left, bounds.left + margin, bounds.right - pickerRect.width - margin);
        top = clamp(top, bounds.top + margin, bounds.bottom - pickerRect.height - margin);
        pickerEl.style.left = `${Math.round(left)}px`;
        pickerEl.style.top = `${Math.round(top)}px`;
        reactionEmojiPopup.position();
    }

    function openReactionPicker(messageId, anchorEl) {
        const numericMessageId = Number(messageId);
        if (!pickerEl || !anchorEl) return;
        if (!Number.isFinite(numericMessageId) || numericMessageId <= 0) return;

        activeMessageId = numericMessageId;
        activeAnchorEl = anchorEl;
        viewportBoundsLock = null;
        viewportBoundsLock = getViewportBounds();
        const openSeq = ++pickerTransitionSeq;
        clearScheduledPosition();
        reactionEmojiPopup.close();
        pickerEl.classList.remove('active', 'is-closing');
        pickerEl.classList.add('is-opening');
        positionReactionPicker();
        const anchorRect = anchorEl.getBoundingClientRect();
        setMotionOriginFromPoint(
            pickerEl,
            anchorRect.left + anchorRect.width / 2,
            anchorRect.top + anchorRect.height / 2,
        );
        window.requestAnimationFrame(() => {
            if (openSeq !== pickerTransitionSeq) return;
            pickerEl.classList.add('active');
            window.requestAnimationFrame(() => {
                if (openSeq !== pickerTransitionSeq) return;
                pickerEl.classList.remove('is-opening');
            });
        });
    }

    function openReactionPickerForMessage(messageId, anchorEl = null) {
        const numericMessageId = Number(messageId);
        if (!Number.isFinite(numericMessageId) || numericMessageId <= 0) return;
        if (pickerEl?.classList.contains('active')) {
            if (activeMessageId === numericMessageId) {
                closeReactionPicker();
                return;
            }
            closeReactionPicker();
        }

        const messageEl = resolveMessageElement?.(numericMessageId);
        if (!messageEl) return;
        const reactionRow = messageEl.querySelector('.message-reactions');
        if (reactionRow) {
            reactionRow.classList.add('reaction-row--active');
        }
        const anchor = anchorEl || reactionRow || messageEl.querySelector('.bubble') || messageEl;
        openReactionPicker(numericMessageId, anchor);
    }

    pickerEl?.addEventListener('click', async (event) => {
        const expandToggle = event.target.closest('[data-reaction-expand-toggle]');
        if (expandToggle && pickerEl.contains(expandToggle)) {
            event.preventDefault();
            event.stopPropagation();
            const msgId = Number(activeMessageId);
            if (!Number.isFinite(msgId) || msgId <= 0) {
                closeReactionPicker();
                return;
            }
            if (reactionEmojiPopup.isOpen()) {
                reactionEmojiPopup.close();
            } else {
                hideContextMenuForEmojiPopup();
                await reactionEmojiPopup.open();
                reactionEmojiPopup.position();
            }
            return;
        }

        const button = event.target.closest('.reaction-picker__item');
        if (!button) return;
        const emoji = String(button.getAttribute('data-emoji') || '').trim();
        const msgId = Number(activeMessageId);
        if (!Number.isFinite(msgId) || msgId <= 0) {
            closeReactionPicker();
            return;
        }
        reactionEmojiPopup.rememberEmoji(emoji);
        onSelectEmoji?.(msgId, emoji);
        closeReactionPicker();
    });

    document.addEventListener('click', (event) => {
        const pickerVisible = Boolean(
            pickerEl
            && (pickerEl.classList.contains('active') || pickerEl.classList.contains('is-opening'))
        );
        if (!pickerVisible && !reactionEmojiPopup.isOpen()) return;
        const target = event.target;
        const clickedInsidePicker = pickerEl?.contains(target);
        const clickedInsideEmojiPopup = reactionEmojiPopup.contains(target);
        const clickedReactionControl = target?.closest?.('.reaction-pill');
        if (!clickedInsidePicker && !clickedInsideEmojiPopup && !clickedReactionControl) {
            closeReactionPicker();
        }
    });

    window.addEventListener('resize', () => {
        schedulePositionReactionPicker();
    }, { passive: true });
    window.addEventListener('scroll', () => {
        schedulePositionReactionPicker();
    }, { passive: true });
    window.visualViewport?.addEventListener('resize', () => {
        schedulePositionReactionPicker();
    });
    window.visualViewport?.addEventListener('scroll', () => {
        schedulePositionReactionPicker();
    });

    return {
        closeReactionPicker,
        positionReactionPicker,
        openReactionPicker,
        openReactionPickerForMessage,
        isOpen() {
            return Boolean(pickerEl?.classList.contains('active') || reactionEmojiPopup.isOpen());
        },
        getActiveMessageId() {
            return activeMessageId;
        },
    };
}
