/**
 * chat-skeleton-ui.js
 * Injects shimmer skeleton rows into chat while history is loading,
 * and inserts the unread divider when first-unread message id is known.
 */

const SKELETON_ROW_COUNT = 7;
const SKELETON_WIDTHS = [
    [42, false], [68, true], [55, false], [35, true],
    [72, false], [48, true], [60, false],
];

/**
 * Inject skeleton rows into chatMessages el.
 * @param {HTMLElement} chatMessages
 * @returns {function} cleanup — removes the skeleton rows
 */
export function showChatSkeleton(chatMessages) {
    if (!chatMessages) return () => {};

    const rows = [];
    const frag = document.createDocumentFragment();

    SKELETON_WIDTHS.slice(0, SKELETON_ROW_COUNT).forEach(([widthPct, isSelf], i) => {
        const row = document.createElement('div');
        row.className = `chat-skeleton-row${isSelf ? ' chat-skeleton-row--self' : ''}`;
        row.setAttribute('aria-hidden', 'true');
        row.style.animationDelay = `${i * 40}ms`;

        if (!isSelf) {
            const avatar = document.createElement('div');
            avatar.className = 'chat-skeleton-avatar';
            row.appendChild(avatar);
        }

        const bubble = document.createElement('div');
        bubble.className = 'chat-skeleton-bubble';
        bubble.style.width = `${widthPct}%`;
        bubble.style.animationDelay = `${i * 40}ms`;
        row.appendChild(bubble);

        rows.push(row);
        frag.appendChild(row);
    });

    chatMessages.prepend(frag);

    return function removeSkeleton() {
        rows.forEach((row) => row.remove());
    };
}

/**
 * Insert unread divider before the first unread message.
 * @param {HTMLElement} chatMessages
 * @param {string|number} firstUnreadId  — data-msg-id of first unread
 * @param {string} label                 — text shown in divider
 * @returns {HTMLElement|null}           — the divider element, or null
 */
export function insertUnreadDivider(chatMessages, firstUnreadId, label = 'Новые сообщения') {
    if (!chatMessages || !firstUnreadId) return null;

    // Remove any existing divider
    chatMessages.querySelector('.chat-unread-divider')?.remove();

    const msgEl = chatMessages.querySelector(
        `.message[data-msg-id="${CSS.escape(String(firstUnreadId))}"]`
    );
    if (!msgEl) return null;

    const divider = document.createElement('div');
    divider.className = 'chat-unread-divider';
    divider.setAttribute('role', 'separator');
    divider.setAttribute('aria-label', label);
    divider.innerHTML = `<span>${label}</span>`;

    msgEl.before(divider);
    return divider;
}

/**
 * Remove the unread divider if present.
 * @param {HTMLElement} chatMessages
 */
export function removeUnreadDivider(chatMessages) {
    chatMessages?.querySelector('.chat-unread-divider')?.remove();
}
