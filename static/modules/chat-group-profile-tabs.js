import { collectMediaFromMessages } from './profile-media.js';

export function getCurrentGroupMediaAvailability({ chatId, getChatState }) {
    const normalizedChatId = String(chatId || '').trim();
    if (!normalizedChatId || typeof getChatState !== 'function') {
        return { media: false, files: false, links: false };
    }

    const state = getChatState(normalizedChatId);
    const media = collectMediaFromMessages(state?.messages || []);
    return {
        media: Array.isArray(media.media) && media.media.length > 0,
        files: Array.isArray(media.files) && media.files.length > 0,
        links: Array.isArray(media.links) && media.links.length > 0,
    };
}

export function syncGroupTabVisibility(groupTabsEl, availability) {
    if (!groupTabsEl) return;
    const tabButtons = Array.from(groupTabsEl.querySelectorAll('[data-group-tab]'));
    const visibleByTab = {
        members: true,
        media: Boolean(availability?.media),
        files: Boolean(availability?.files),
        links: Boolean(availability?.links),
    };

    let visibleCount = 0;
    tabButtons.forEach((btn) => {
        const key = String(btn.getAttribute('data-group-tab') || '').trim().toLowerCase();
        const isVisible = Boolean(visibleByTab[key]);
        btn.hidden = !isVisible;
        btn.setAttribute('aria-hidden', isVisible ? 'false' : 'true');
        if (!isVisible) {
            btn.classList.remove('is-active');
            btn.setAttribute('aria-selected', 'false');
        } else {
            visibleCount += 1;
        }
    });

    groupTabsEl.style.gridTemplateColumns = `repeat(${Math.max(1, visibleCount)}, minmax(0, 1fr))`;
}

export function resolveGroupTabByAvailability(requestedTab, availability) {
    if (requestedTab === 'members') return 'members';
    if (requestedTab === 'media' && availability.media) return 'media';
    if (requestedTab === 'files' && availability.files) return 'files';
    if (requestedTab === 'links' && availability.links) return 'links';
    if (availability.media) return 'media';
    if (availability.files) return 'files';
    if (availability.links) return 'links';
    return 'members';
}
