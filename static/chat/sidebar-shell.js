export function createSidebarShell(options = {}) {
    const contactsList = options.contactsList || null;
    const withAppRoot = options.withAppRoot || ((value) => value);
    const contactUsernamePattern = options.contactUsernamePattern || /^[a-z0-9_]{1,50}$/;
    const isMobileViewport = typeof options.isMobileViewport === 'function'
        ? options.isMobileViewport
        : () => false;

    let activeContactItem = null;

    function getActiveContactItem() {
        if (activeContactItem && contactsList?.contains(activeContactItem)) {
            return activeContactItem;
        }
        activeContactItem = null;
        return null;
    }

    function setActiveContactItem(nextItem) {
        const currentItem = getActiveContactItem();
        if (currentItem === nextItem) return currentItem;
        if (currentItem) currentItem.classList.remove('active');

        if (nextItem && contactsList?.contains(nextItem)) {
            activeContactItem = nextItem;
            activeContactItem.classList.add('active');
            return activeContactItem;
        }

        activeContactItem = null;
        return null;
    }

    function resolveContactItemByDataAttribute(attributeName, value) {
        const normalizedValue = String(value || '').trim();
        if (!normalizedValue || !contactsList) return null;

        const currentItem = getActiveContactItem();
        if (currentItem && String(currentItem.getAttribute(attributeName) || '').trim() === normalizedValue) {
            return currentItem;
        }

        const items = contactsList.querySelectorAll('.contact-item');
        for (const item of items) {
            if (String(item.getAttribute(attributeName) || '').trim() !== normalizedValue) continue;
            if (item.classList.contains('active')) {
                activeContactItem = item;
            }
            return item;
        }
        return null;
    }

    function resolveContactItemByChatId(chatId) {
        return resolveContactItemByDataAttribute('data-chat-id', chatId);
    }

    function resolveContactItemByUserId(userId) {
        return resolveContactItemByDataAttribute('data-contact-id', userId);
    }

    function normalizeContactUsername(value) {
        const normalized = String(value || '').trim().toLowerCase();
        if (!normalized) return '';
        return contactUsernamePattern.test(normalized) ? normalized : '';
    }

    function resolveContactItemByUsername(username) {
        const normalizedUsername = normalizeContactUsername(username);
        if (!normalizedUsername) return null;
        return resolveContactItemByDataAttribute('data-contact-username', normalizedUsername);
    }

    function resolveContactItemByPublicKey(publicKey) {
        return resolveContactItemByDataAttribute('data-public-key', publicKey);
    }

    function buildChatListUrl() {
        return withAppRoot('/chat');
    }

    function buildChatUrlForContactItem(contactItem) {
        if (!contactItem) return buildChatListUrl();
        const contactUsername = normalizeContactUsername(
            contactItem.getAttribute('data-contact-username') || '',
        );
        if (contactUsername) {
            return withAppRoot(`/chat/${encodeURIComponent(contactUsername)}`);
        }

        const contactUserId = String(contactItem.getAttribute('data-contact-id') || '').trim();
        if (contactUserId) {
            return withAppRoot(`/chat?user_id=${encodeURIComponent(contactUserId)}`);
        }
        return buildChatListUrl();
    }

    function writeBrowserUrl(nextUrl, { push = false } = {}) {
        const normalizedUrl = String(nextUrl || '').trim() || buildChatListUrl();
        const currentUrl = `${window.location.pathname}${window.location.search}`;
        if (currentUrl === normalizedUrl) return;
        if (push && window.history?.pushState) {
            window.history.pushState({}, '', normalizedUrl);
            return;
        }
        if (window.history?.replaceState) {
            window.history.replaceState({}, '', normalizedUrl);
        }
    }

    function replaceBrowserUrl(nextUrl) {
        writeBrowserUrl(nextUrl, { push: false });
    }

    function syncBrowserUrlForActiveChat(contactItem = null) {
        writeBrowserUrl(
            contactItem ? buildChatUrlForContactItem(contactItem) : buildChatListUrl(),
            { push: Boolean(contactItem && isMobileViewport()) },
        );
    }

    return {
        getActiveContactItem,
        setActiveContactItem,
        resolveContactItemByDataAttribute,
        resolveContactItemByChatId,
        resolveContactItemByUserId,
        normalizeContactUsername,
        resolveContactItemByUsername,
        resolveContactItemByPublicKey,
        buildChatListUrl,
        buildChatUrlForContactItem,
        replaceBrowserUrl,
        syncBrowserUrlForActiveChat,
    };
}
