export function updateGlobalUnreadTabCount({ doc = document } = {}) {
    let total = 0;
    doc.querySelectorAll('#contactsList .contact-item .unread-badge').forEach((badge) => {
        if (badge.style.display !== 'none') {
            const count = Number.parseInt(badge.textContent, 10);
            if (!Number.isNaN(count)) total += count;
        }
    });
    const tabBadge = doc.getElementById('unreadTabCount');
    if (tabBadge) {
        tabBadge.textContent = total > 0 ? String(total) : '';
    }
}

export function setContactUnreadBadge({
    chatId,
    count,
    resolveContactItemByChatId = () => null,
    isChatMuted = () => false,
    updateGlobalUnreadTabCount: updateGlobalUnreadTabCountFn = () => {},
} = {}) {
    if (!chatId) return;
    const contactItem = resolveContactItemByChatId(chatId);
    if (!contactItem) return;
    const badge = contactItem.querySelector('.unread-badge');
    if (!badge) return;

    const safeCount = Math.max(0, Number(count) || 0);
    const muted = isChatMuted(chatId);

    if (safeCount > 0) {
        badge.textContent = safeCount > 99 ? '99+' : String(safeCount);
        badge.style.display = '';
        badge.classList.remove('unread-badge--hidden');
        badge.classList.toggle('unread-badge--muted', Boolean(muted));
    } else {
        badge.textContent = '';
        badge.style.display = 'none';
        badge.classList.add('unread-badge--hidden');
        badge.classList.remove('unread-badge--muted');
    }

    updateGlobalUnreadTabCountFn();

    const timeMetaEl = contactItem.querySelector('.contact-time-meta');
    if (!timeMetaEl) return;
    if (muted && safeCount > 0) {
        timeMetaEl.style.color = 'var(--text-muted)';
    } else if (safeCount > 0) {
        timeMetaEl.style.color = 'var(--accent)';
    } else {
        timeMetaEl.style.removeProperty('color');
    }
}
