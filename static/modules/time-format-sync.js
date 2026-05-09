import { formatTime, formatFullTimestamp, formatSidebarTime } from './utils.js';

function resolveContactTimestamp(contactItem) {
    if (!contactItem || typeof contactItem.getAttribute !== 'function') return '';
    const hasDraft = String(contactItem.getAttribute('data-has-draft') || '') === '1';
    if (hasDraft) {
        return String(
            contactItem.getAttribute('data-draft-updated-at')
            || contactItem.getAttribute('data-last-message-time')
            || ''
        ).trim();
    }
    return String(
        contactItem.getAttribute('data-last-message-time')
        || contactItem.getAttribute('data-raw-last-message-time')
        || ''
    ).trim();
}

export function refreshVisibleTimePreferenceRendering(root = document) {
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;

    scope.querySelectorAll('.msg-time[data-created-at]').forEach((timeEl) => {
        const createdAt = String(timeEl.getAttribute('data-created-at') || '').trim();
        if (!createdAt) return;
        timeEl.textContent = formatTime(createdAt);
        timeEl.title = formatFullTimestamp(createdAt);
    });

    scope.querySelectorAll('.contact-item').forEach((contactItem) => {
        const timeEl = contactItem.querySelector('.contact-time');
        if (!timeEl) return;
        const timestamp = resolveContactTimestamp(contactItem);
        timeEl.textContent = formatSidebarTime(timestamp);
    });

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function' && typeof window.Event === 'function') {
        window.dispatchEvent(new Event('sun-time-format-changed'));
    }
}

