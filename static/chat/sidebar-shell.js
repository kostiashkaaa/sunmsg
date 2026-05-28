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

    function getContactItems() {
        if (!contactsList) return [];
        return Array.from(contactsList.querySelectorAll('.contact-item[data-chat-id]'));
    }

    function isContactItemVisible(item) {
        if (!(item instanceof HTMLElement)) return false;
        if (item.hidden) return false;
        if (item.getAttribute('aria-hidden') === 'true') return false;
        if (item.style.display === 'none') return false;
        return true;
    }

    function ensureContactItemId(item, index) {
        if (item.id) return item.id;
        const token = String(item.getAttribute('data-chat-id') || index || 'chat')
            .trim()
            .replace(/[^a-zA-Z0-9_-]+/g, '-')
            .replace(/^-+|-+$/g, '') || String(index || 'chat');
        item.id = `chat-contact-option-${token}`;
        return item.id;
    }

    function syncContactItemsA11y({ focusItem = null } = {}) {
        const items = getContactItems();
        const activeItem = getActiveContactItem() || items.find((item) => item.classList.contains('active')) || null;
        if (activeItem) activeContactItem = activeItem;
        const tabbableItem = focusItem && items.includes(focusItem)
            ? focusItem
            : activeItem || items.find(isContactItemVisible) || items[0] || null;

        items.forEach((item, index) => {
            item.setAttribute('role', 'option');
            const isSelected = item === activeItem;
            item.setAttribute('aria-selected', isSelected ? 'true' : 'false');
            item.tabIndex = item === tabbableItem ? 0 : -1;
            ensureContactItemId(item, index + 1);
        });

        if (activeItem) {
            contactsList?.setAttribute('aria-activedescendant', ensureContactItemId(activeItem, 1));
        } else {
            contactsList?.removeAttribute('aria-activedescendant');
        }
    }

    function setActiveContactItem(nextItem) {
        const currentItem = getActiveContactItem();
        if (currentItem === nextItem) {
            syncContactItemsA11y({ focusItem: currentItem });
            return currentItem;
        }
        if (currentItem) currentItem.classList.remove('active');

        if (nextItem && contactsList?.contains(nextItem)) {
            activeContactItem = nextItem;
            activeContactItem.classList.add('active');
            syncContactItemsA11y({ focusItem: activeContactItem });
            return activeContactItem;
        }

        activeContactItem = null;
        syncContactItemsA11y();
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

    syncContactItemsA11y();

    return {
        getActiveContactItem,
        setActiveContactItem,
        syncContactItemsA11y,
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
