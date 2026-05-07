const DEFAULT_LAST_USER_ID_STORAGE_KEY = 'last_user_id';

function readStoredString(storage, key) {
    try {
        return String(storage?.getItem(key) || '').trim();
    } catch (_) {
        return '';
    }
}

function writeStoredString(storage, key, value) {
    const normalized = String(value || '').trim();
    if (!normalized) return;
    try {
        storage?.setItem(key, normalized);
    } catch (_) {
        // Ignore storage failures.
    }
}

function removeStoredString(storage, key) {
    try {
        storage?.removeItem(key);
    } catch (_) {
        // Ignore storage failures.
    }
}

export function buildEncryptedCacheMessageFromSocketPayload(data) {
    if (!data || typeof data !== 'object') return null;
    const messageId = Number(data.id);
    if (!Number.isFinite(messageId) || messageId <= 0) return null;
    const chatId = String(data.chat_id || '').trim();
    if (!chatId) return null;
    return {
        id: messageId,
        chat_id: chatId,
        sender_user_id: Number(data.sender_user_id) || null,
        sender_public_key: data.sender_public_key || '',
        sender_display_name: String(data.sender_display_name || '').trim(),
        sender_username: String(data.sender_username || '').trim(),
        sender_avatar_url: String(data.sender_avatar_url || '').trim(),
        message: data.message || '',
        message_type: data.message_type || 'text',
        created_at: data.created_at || '',
        is_read: Boolean(data.is_read),
        read_at: String(data.read_at || '').trim() || null,
        is_delivered: Boolean(data.is_delivered),
        voice_listened_by_partner: Boolean(data.voice_listened_by_partner),
        is_edited: Boolean(data.is_edited),
        reply_to_id: data.reply_to_id || null,
        reply_message: data.reply_message || null,
        reply_sender_pub: data.reply_sender_pub || null,
        forward_from_name: String(data.forward_from_name || '').trim(),
        forward_from_user_id: Number(data.forward_from_user_id) || null,
        reactions: Array.isArray(data.reactions) ? data.reactions : [],
    };
}

export function createChatIdbRuntime({
    chatIdb,
    currentUserId = '',
    storage = window.localStorage,
    lastUserIdStorageKey = DEFAULT_LAST_USER_ID_STORAGE_KEY,
} = {}) {
    const normalizedCurrentUserId = String(currentUserId || '').trim();
    let chatIdbReady = false;
    let chatIdbInitPromise = Promise.resolve(false);

    function readStoredLastUserId() {
        return readStoredString(storage, lastUserIdStorageKey);
    }

    function writeStoredLastUserId(userId) {
        writeStoredString(storage, lastUserIdStorageKey, userId);
    }

    function clearStoredLastUserId() {
        removeStoredString(storage, lastUserIdStorageKey);
    }

    function isReady() {
        return chatIdbReady;
    }

    async function ensureReady() {
        if (chatIdbReady) return true;
        try {
            await chatIdbInitPromise;
        } catch (_) {}
        return chatIdbReady;
    }

    async function init() {
        chatIdbInitPromise = (async () => {
            if (!normalizedCurrentUserId) return false;
            try {
                const previousUserId = readStoredLastUserId();
                if (previousUserId && previousUserId !== normalizedCurrentUserId) {
                    await chatIdb.deleteChatDb(previousUserId).catch(() => {});
                }
                const db = await chatIdb.openChatDb(normalizedCurrentUserId);
                chatIdbReady = Boolean(db);
                if (chatIdbReady) {
                    writeStoredLastUserId(normalizedCurrentUserId);
                }
                return chatIdbReady;
            } catch (error) {
                console.warn('Chat IDB init failed:', error);
                chatIdbReady = false;
                return false;
            }
        })();
        return chatIdbInitPromise;
    }

    async function appendEncryptedMessages(chatId, messages) {
        if (!chatId || !await ensureReady()) return;
        const normalizedMessages = (Array.isArray(messages) ? messages : [])
            .filter((message) => message && typeof message === 'object');
        if (!normalizedMessages.length) return;
        chatIdb.appendCachedMessages(chatId, normalizedMessages).catch(() => {});
    }

    function syncDeletedMessages(chatId, ids) {
        if (!chatId || !chatIdbReady) return;
        chatIdb.removeCachedMessages(chatId, ids).catch(() => {});
    }

    function dropChatCache(chatId) {
        if (!chatId || !chatIdbReady) return;
        chatIdb.deleteCachedChat(chatId).catch(() => {});
    }

    async function clearOnLogout() {
        const targetUserId = normalizedCurrentUserId || readStoredLastUserId();
        if (await ensureReady()) {
            await chatIdb.clearAllCache().catch(() => {});
        }
        if (targetUserId) {
            await chatIdb.deleteChatDb(targetUserId).catch(() => {});
        }
        chatIdbReady = false;
        clearStoredLastUserId();
    }

    async function close() {
        if (!chatIdbReady) return;
        await chatIdb.closeChatDb().catch(() => {});
        chatIdbReady = false;
    }

    return {
        init,
        isReady,
        ensureReady,
        appendEncryptedMessages,
        syncDeletedMessages,
        dropChatCache,
        clearOnLogout,
        close,
    };
}
