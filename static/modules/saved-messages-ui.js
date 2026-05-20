import { tr } from './utils.js';

function currentLang() {
    const api = window.SUN_I18N;
    const lang = api && typeof api.getLanguage === 'function'
        ? String(api.getLanguage() || '').toLowerCase()
        : String(document.documentElement.lang || 'ru').toLowerCase();
    return lang.startsWith('en') ? 'en' : 'ru';
}

function getSavedMessagesTitle() {
    return currentLang() === 'en' ? 'Saved Messages' : 'Избранное';
}

function formatMessageCount(count) {
    const safeCount = Math.max(0, Number(count) || 0);
    if (currentLang() === 'en') {
        return safeCount === 1 ? '1 message' : `${safeCount} messages`;
    }

    const mod10 = safeCount % 10;
    const mod100 = safeCount % 100;
    if (mod10 === 1 && mod100 !== 11) return `${safeCount} сообщение`;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${safeCount} сообщения`;
    return `${safeCount} сообщений`;
}

function countMessagesFromState(getChatState, chatId) {
    if (!chatId || typeof getChatState !== 'function') return 0;
    const state = getChatState(chatId);
    const messages = Array.isArray(state?.messages) ? state.messages : [];
    const loadedCount = messages.filter(Boolean).length;
    const total = Number(state?.totalMessages);
    if (Number.isFinite(total) && total >= 0) {
        return Math.max(loadedCount, Math.floor(total));
    }
    return loadedCount;
}

function readContactMessageCount(contactItem) {
    const value = Number(contactItem?.getAttribute?.('data-message-count'));
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null;
}

function paintSavedAvatar(avatarEl) {
    if (!avatarEl) return;
    avatarEl.classList.add('saved-messages-avatar');
    avatarEl.innerHTML = '<i class="bi bi-bookmark-fill" aria-hidden="true"></i>';
}

function applySavedHeaderStatus(chatOnlineStatusEl, text) {
    if (!chatOnlineStatusEl) return;
    chatOnlineStatusEl.textContent = text;
    chatOnlineStatusEl.style.display = '';
    chatOnlineStatusEl.classList.remove('chat-online-status--hidden');
    chatOnlineStatusEl.setAttribute('data-last-seen', '');
    chatOnlineStatusEl.dataset.state = 'saved';
}

export function createSavedMessagesUiController({
    currentUserId = '',
    getChatState = () => null,
    chatAreaEl = null,
    profileDrawerEl = null,
    chatTitleEl = null,
    chatOnlineStatusEl = null,
    chatPartnerAvatarEl = null,
    profileTopbarTitleEl = null,
    profileDisplayNameEl = null,
    profileLastSeenEl = null,
    profileLargeAvatarEl = null,
} = {}) {
    const normalizedCurrentUserId = String(currentUserId || '').trim();

    function isSavedContactId(contactId) {
        return normalizedCurrentUserId && String(contactId || '').trim() === normalizedCurrentUserId;
    }

    function isSavedContactItem(contactItem) {
        if (!contactItem) return false;
        return isSavedContactId(contactItem.getAttribute('data-contact-id'));
    }

    function applyContactItem(contactItem) {
        if (!contactItem || !isSavedContactItem(contactItem)) return false;
        contactItem.setAttribute('data-saved-messages', '1');
        const avatarEl = contactItem.querySelector('.contact-avatar');
        paintSavedAvatar(avatarEl);
        return true;
    }

    function syncTotalMessagesFromContactItem(chatId, contactItem) {
        if (!chatId || typeof getChatState !== 'function') return;
        const total = readContactMessageCount(contactItem);
        if (total === null) return;
        const state = getChatState(chatId);
        if (!state || typeof state !== 'object') return;
        state.totalMessages = total;
    }

    function applyChatMode({ contactItem, chatId } = {}) {
        const saved = Boolean(contactItem && isSavedContactItem(contactItem));
        chatAreaEl?.classList.toggle('is-saved-messages-chat', saved);
        if (!saved) {
            profileDrawerEl?.classList.remove('is-saved-messages-profile');
            chatPartnerAvatarEl?.classList.remove('saved-messages-avatar');
            return false;
        }
        applyContactItem(contactItem);
        syncTotalMessagesFromContactItem(chatId, contactItem);

        if (chatTitleEl) {
            chatTitleEl.textContent = getSavedMessagesTitle();
        }

        if (chatPartnerAvatarEl) {
            paintSavedAvatar(chatPartnerAvatarEl);
            chatPartnerAvatarEl.style.display = 'flex';
        }

        if (chatOnlineStatusEl) {
            const total = countMessagesFromState(getChatState, chatId);
            applySavedHeaderStatus(chatOnlineStatusEl, formatMessageCount(total));
        }

        return true;
    }

    function applyProfileMode({ chatId, contactId } = {}) {
        const saved = isSavedContactId(contactId);
        profileDrawerEl?.classList.toggle('is-saved-messages-profile', saved);
        if (!saved) return false;

        if (profileTopbarTitleEl) {
            profileTopbarTitleEl.textContent = tr('Информация');
        }
        if (profileDisplayNameEl) {
            profileDisplayNameEl.textContent = getSavedMessagesTitle();
        }
        if (profileLargeAvatarEl) {
            paintSavedAvatar(profileLargeAvatarEl);
        }
        if (profileLastSeenEl) {
            const total = countMessagesFromState(getChatState, chatId);
            profileLastSeenEl.textContent = formatMessageCount(total);
            profileLastSeenEl.dataset.lastSeenRaw = '';
            profileLastSeenEl.dataset.statusHidden = '0';
            profileLastSeenEl.dataset.isOnline = '0';
        }
        return true;
    }

    function syncCurrentChatMeta({ chatId, contactId } = {}) {
        if (!isSavedContactId(contactId)) return false;
        const total = countMessagesFromState(getChatState, chatId);
        if (chatOnlineStatusEl) {
            applySavedHeaderStatus(chatOnlineStatusEl, formatMessageCount(total));
        }
        if (profileDrawerEl?.classList.contains('is-saved-messages-profile') && profileLastSeenEl) {
            profileLastSeenEl.textContent = formatMessageCount(total);
        }
        return true;
    }

    function clearMode() {
        chatAreaEl?.classList.remove('is-saved-messages-chat');
        profileDrawerEl?.classList.remove('is-saved-messages-profile');
        chatPartnerAvatarEl?.classList.remove('saved-messages-avatar');
        profileLargeAvatarEl?.classList.remove('saved-messages-avatar');
    }

    function buildSavedProfilePayload({ contactId, chatId, publicKey = '' } = {}) {
        return {
            success: true,
            user_id: Number(contactId) || null,
            display_name: getSavedMessagesTitle(),
            username: '',
            online: false,
            last_seen: null,
            created_at: null,
            restricted: false,
            public_key: String(publicKey || ''),
            avatar_url: null,
            bio: '',
            stats: { photos: 0, files: 0, links: 0 },
            _saved_messages_profile: true,
            _message_count: countMessagesFromState(getChatState, chatId),
        };
    }

    function normalizeProfileAfterRender(profilePayload, { chatId, contactId } = {}) {
        applyProfileMode({ chatId, contactId });
        return profilePayload;
    }

    return {
        isSavedContactId,
        isSavedContactItem,
        applyContactItem,
        applyChatMode,
        applyProfileMode,
        syncCurrentChatMeta,
        clearMode,
        buildSavedProfilePayload,
        normalizeProfileAfterRender,
    };
}
