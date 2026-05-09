import { setMotionOriginFromPoint, waitForMotionEnd } from './motion.js';
import { REACTION_PICKER_EMOJIS } from './reactions.js';

export function initReactionPickerController({
    pickerEl,
    contextMenuEl,
    getCurrentContextMessageId,
    resolveMessageElement,
    onSelectEmoji,
} = {}) {
    const QUICK_REACTION_COUNT = 9;
    let activeMessageId = null;
    let activeAnchorEl = null;
    let pickerTransitionSeq = 0;
    let positionRafId = 0;

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

        let quickEl = rowEl.querySelector('.reaction-picker__quick');
        if (!quickEl) {
            quickEl = document.createElement('div');
            quickEl.className = 'reaction-picker__quick';
            rowEl.prepend(quickEl);
        }

        let expandToggle = rowEl.querySelector('[data-reaction-expand-toggle]');
        if (!expandToggle) {
            expandToggle = document.createElement('button');
            expandToggle.type = 'button';
            expandToggle.className = 'reaction-picker__expand-toggle';
            expandToggle.setAttribute('data-reaction-expand-toggle', '1');
            expandToggle.setAttribute('aria-expanded', 'false');
            expandToggle.setAttribute('aria-label', 'Show more reactions');
            expandToggle.innerHTML = '<i class="bi bi-chevron-down" aria-hidden="true"></i>';
            rowEl.append(expandToggle);
        }

        let expandedEl = findDirectChildByClass(pickerEl, 'reaction-picker__expanded');
        if (!expandedEl) {
            expandedEl = document.createElement('div');
            expandedEl.className = 'reaction-picker__expanded';
            expandedEl.hidden = true;
            pickerEl.append(expandedEl);
        }

        if (!expandedEl.id) {
            expandedEl.id = 'reactionPickerExpanded';
        }
        expandToggle.setAttribute('aria-controls', expandedEl.id);

        const legacyEmojis = uniqueValidEmojis(
            legacyTopItems.map((button) => button.getAttribute('data-emoji') || button.textContent || '')
        );
        const existingQuickEmojis = uniqueValidEmojis(
            Array.from(quickEl.querySelectorAll('.reaction-picker__item'))
                .map((button) => button.getAttribute('data-emoji') || button.textContent || '')
        );
        const quickSource = existingQuickEmojis.length
            ? existingQuickEmojis
            : (legacyEmojis.length ? legacyEmojis : REACTION_PICKER_EMOJIS);
        const quickEmojis = quickSource.slice(0, QUICK_REACTION_COUNT);

        renderPickerItems(quickEl, quickEmojis);
        renderPickerItems(expandedEl, REACTION_PICKER_EMOJIS);
        legacyTopItems.forEach((item) => item.remove());
    }

    function schedulePositionReactionPicker() {
        if (!pickerEl) return;
        if (
            !pickerEl.classList.contains('active')
            && !pickerEl.classList.contains('is-opening')
        ) return;
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

    function setExpandedState(isExpanded, { reposition = false } = {}) {
        if (!pickerEl) return;
        const expanded = Boolean(isExpanded);
        pickerEl.classList.toggle('is-expanded', expanded);
        const expandedEl = pickerEl.querySelector('.reaction-picker__expanded');
        if (expandedEl) {
            expandedEl.hidden = !expanded;
        }
        const toggleButton = pickerEl.querySelector('[data-reaction-expand-toggle]');
        if (toggleButton) {
            toggleButton.setAttribute('aria-expanded', expanded ? 'true' : 'false');
            const icon = toggleButton.querySelector('i');
            if (icon) {
                icon.className = expanded ? 'bi bi-chevron-up' : 'bi bi-chevron-down';
            }
        }
        if (reposition && (pickerEl.classList.contains('active') || pickerEl.classList.contains('is-opening'))) {
            schedulePositionReactionPicker();
        }
    }

    function getViewportBounds() {
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

    function closeReactionPicker() {
        if (!pickerEl) return;
        if (
            !pickerEl.classList.contains('active')
            && !pickerEl.classList.contains('is-opening')
            && !pickerEl.classList.contains('is-closing')
        ) return;
        clearScheduledPosition();
        const closeSeq = ++pickerTransitionSeq;
        pickerEl.classList.remove('active', 'is-opening');
        pickerEl.classList.add('is-closing');
        const activeRow = activeAnchorEl?.closest?.('.message-reactions');
        if (activeRow) {
            activeRow.classList.remove('reaction-row--active');
        }
        setExpandedState(false);
        activeMessageId = null;
        activeAnchorEl = null;
        waitForMotionEnd(pickerEl, 180).then(() => {
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
    }

    function openReactionPicker(messageId, anchorEl) {
        const numericMessageId = Number(messageId);
        if (!pickerEl || !anchorEl) return;
        if (!Number.isFinite(numericMessageId) || numericMessageId <= 0) return;

        activeMessageId = numericMessageId;
        activeAnchorEl = anchorEl;
        const openSeq = ++pickerTransitionSeq;
        clearScheduledPosition();
        pickerEl.classList.remove('active', 'is-closing');
        setExpandedState(false);
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

    pickerEl?.addEventListener('click', (event) => {
        const expandToggle = event.target.closest('[data-reaction-expand-toggle]');
        if (expandToggle && pickerEl.contains(expandToggle)) {
            event.preventDefault();
            event.stopPropagation();
            setExpandedState(!pickerEl.classList.contains('is-expanded'), { reposition: true });
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
        onSelectEmoji?.(msgId, emoji);
        closeReactionPicker();
    });

    document.addEventListener('click', (event) => {
        if (!pickerEl || !pickerEl.classList.contains('active')) return;
        const clickedInsidePicker = pickerEl.contains(event.target);
        const clickedReactionControl = event.target.closest('.reaction-pill');
        if (!clickedInsidePicker && !clickedReactionControl) {
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
            return Boolean(pickerEl?.classList.contains('active'));
        },
        getActiveMessageId() {
            return activeMessageId;
        },
    };
}
