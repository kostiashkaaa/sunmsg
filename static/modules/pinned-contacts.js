import { withAppRoot } from './app-url.js';
import {
    afterNextFrame,
    getMotionDurationTokenMs,
    getMotionEasingToken,
    getVelocityAwareDurationMs,
    waitForMotionEnd,
} from './motion.js';

export function updatePinIcon(itemOrChatId, isPinned, { root = document } = {}) {
    const item = typeof itemOrChatId === 'string'
        ? root.querySelector(`.contact-item[data-chat-id="${itemOrChatId}"]`)
        : itemOrChatId;
    if (!item) return;

    // Pinned state is represented by ordering and data attributes only.
    // Keep sidebar visually clean: no explicit pin icon.
    const icon = item.querySelector('.pin-icon');
    icon?.remove();
}

function prefersReducedMotion() {
    if (document.documentElement.classList.contains('perf-lite')) {
        return true;
    }
    const motionLevel = String(document.documentElement.getAttribute('data-motion-level') || 'full').toLowerCase();
    if (motionLevel !== 'lite') {
        return false;
    }
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (_) {
        return false;
    }
}

const activeReorderMotionByItem = new WeakMap();

function clearReorderMotion(item, state) {
    if (!item) return;
    const activeState = activeReorderMotionByItem.get(item);
    if (state && activeState !== state) return;
    item.style.removeProperty('transition');
    item.style.removeProperty('transform');
    item.style.removeProperty('will-change');
    if (activeState?.onEnd) {
        item.removeEventListener('transitionend', activeState.onEnd);
    }
    activeReorderMotionByItem.delete(item);
}

function animateContactReorder(orderedItems, previousTopByItem) {
    if (prefersReducedMotion()) return;
    const minDurationMs = getMotionDurationTokenMs('--motion-duration-fast', 180);
    const maxDurationMs = getMotionDurationTokenMs('--motion-duration-base', 260);
    const reorderEasing = getMotionEasingToken('--motion-ease-enter', 'cubic-bezier(.4,0,.2,1)');
    const animatedItems = [];
    orderedItems.forEach((item) => {
        clearReorderMotion(item);
        const previousTop = previousTopByItem.get(item);
        if (!Number.isFinite(previousTop)) return;
        const nextTop = item.getBoundingClientRect().top;
        const deltaY = previousTop - nextTop;
        if (Math.abs(deltaY) < 0.5) return;
        const durationMs = getVelocityAwareDurationMs(Math.abs(deltaY), {
            minToken: '--motion-duration-fast',
            maxToken: '--motion-duration-base',
            fallbackMinMs: minDurationMs,
            fallbackMaxMs: maxDurationMs,
        });
        item.style.transition = 'none';
        item.style.transform = `translate3d(0, ${deltaY.toFixed(2)}px, 0)`;
        item.style.willChange = 'transform';
        animatedItems.push({ item, durationMs });
    });
    if (!animatedItems.length) return;

    afterNextFrame(() => {
        animatedItems.forEach(({ item, durationMs }) => {
            const motionState = { onEnd: null };
            const onTransitionEnd = (event) => {
                if (event.target !== item || event.propertyName !== 'transform') return;
                clearReorderMotion(item, motionState);
            };
            motionState.onEnd = onTransitionEnd;
            activeReorderMotionByItem.set(item, motionState);
            item.addEventListener('transitionend', onTransitionEnd);
            item.style.transition = `transform ${durationMs}ms ${reorderEasing}`;
            item.style.transform = 'translate3d(0, 0, 0)';
            waitForMotionEnd(item, durationMs + 80).then(() => {
                clearReorderMotion(item, motionState);
            });
        });
    });
}

export function applyPinnedState(item, {
    isPinned,
    pinOrder,
    pinnedCount = 0,
} = {}) {
    if (!item) return;

    item.setAttribute('data-pinned', isPinned ? '1' : '0');
    item.setAttribute('draggable', isPinned ? 'true' : 'false');

    if (isPinned) {
        const nextOrder = Number.isFinite(Number(pinOrder))
            ? Number(pinOrder)
            : pinnedCount;
        item.setAttribute('data-pin-order', String(nextOrder));
    } else {
        item.removeAttribute('data-pin-order');
    }

    updatePinIcon(item, isPinned);
}

export function sortContactsList(contactsList) {
    if (!contactsList) return;

    const getContactLastMessageTs = (item) => {
        const numeric = Number(item.getAttribute('data-last-message-ts'));
        if (Number.isFinite(numeric) && numeric > 0) return numeric;
        const raw = String(item.getAttribute('data-last-message-time') || '').trim();
        if (!raw) return Number.MIN_SAFE_INTEGER;
        const parsed = Date.parse(raw);
        return Number.isFinite(parsed) ? parsed : Number.MIN_SAFE_INTEGER;
    };

    const items = Array.from(contactsList.querySelectorAll('.contact-item'));
    const indexed = items.map((item, index) => ({ item, index }));
    const pinned = indexed
        .filter(({ item }) => item.getAttribute('data-pinned') === '1')
        .sort((a, b) => {
            const aOrder = Number(a.item.getAttribute('data-pin-order'));
            const bOrder = Number(b.item.getAttribute('data-pin-order'));
            const safeA = Number.isFinite(aOrder) ? aOrder : Number.MAX_SAFE_INTEGER;
            const safeB = Number.isFinite(bOrder) ? bOrder : Number.MAX_SAFE_INTEGER;
            if (safeA !== safeB) return safeA - safeB;
            return a.index - b.index;
        })
        .map(({ item }) => item);
    const unpinned = indexed
        .filter(({ item }) => item.getAttribute('data-pinned') !== '1')
        .sort((a, b) => {
            const aTs = getContactLastMessageTs(a.item);
            const bTs = getContactLastMessageTs(b.item);
            if (aTs !== bTs) return bTs - aTs;
            return a.index - b.index;
        })
        .map(({ item }) => item);
    const ordered = [...pinned, ...unpinned];
    const isSameOrder = ordered.length === items.length
        && ordered.every((item, index) => item === items[index]);
    if (isSameOrder) return;

    const previousTopByItem = new Map(
        items.map((item) => [item, item.getBoundingClientRect().top]),
    );
    const fragment = document.createDocumentFragment();
    ordered.forEach((item) => fragment.appendChild(item));
    contactsList.appendChild(fragment);
    if (contactsList.classList.contains('is-hydrating-contacts')) return;
    animateContactReorder(ordered, previousTopByItem);
}

export function initPinnedContactsDnD({
    contactsList,
    getCsrfToken,
    fetchImpl = window.fetch.bind(window),
} = {}) {
    let dragSrc = null;

    function savePinnedOrder() {
        if (!contactsList) return;
        const pinnedItems = Array.from(contactsList.querySelectorAll('.contact-item[data-pinned="1"]'));
        const chatIds = pinnedItems.map((item) => item.getAttribute('data-chat-id'));
        pinnedItems.forEach((item, index) => item.setAttribute('data-pin-order', String(index)));
        if (!chatIds.length) return;

        fetchImpl(withAppRoot('/reorder_pinned_chats'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
            body: JSON.stringify({ chat_ids: chatIds }),
        }).catch(() => {});
    }

    contactsList?.addEventListener('dragstart', (event) => {
        const item = event.target.closest('.contact-item');
        if (!item || item.getAttribute('data-pinned') !== '1') {
            event.preventDefault();
            return;
        }
        dragSrc = item;
        item.classList.add('dragging');
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', item.getAttribute('data-chat-id') || '');
    });

    contactsList?.addEventListener('dragover', (event) => {
        event.preventDefault();
        const target = event.target.closest('.contact-item');
        if (!dragSrc || !target || target === dragSrc || target.getAttribute('data-pinned') !== '1') return;
        event.dataTransfer.dropEffect = 'move';
        const rect = target.getBoundingClientRect();
        const mid = rect.top + rect.height / 2;
        if (event.clientY < mid) {
            contactsList.insertBefore(dragSrc, target);
        } else {
            contactsList.insertBefore(dragSrc, target.nextSibling);
        }
    });

    contactsList?.addEventListener('dragend', () => {
        if (dragSrc) dragSrc.classList.remove('dragging');
        dragSrc = null;
        savePinnedOrder();
    });

    return {
        savePinnedOrder,
    };
}
