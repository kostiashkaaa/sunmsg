const DB_VERSION = 1;
const STORE_CHATS = 'chats';
const INDEX_UPDATED_AT = 'byUpdatedAt';
const MAX_MESSAGES_PER_CHAT = 500;

let activeDb = null;
let activeUserId = '';

function warn(message, error) {
    if (error) {
        console.warn(`[chat-idb] ${message}`, error);
        return;
    }
    console.warn(`[chat-idb] ${message}`);
}

function canUseIndexedDb() {
    return typeof indexedDB !== 'undefined';
}

function normalizeUserId(userId) {
    return String(userId ?? '').trim();
}

function normalizeChatId(chatId) {
    return String(chatId ?? '').trim();
}

function buildDbName(userId) {
    return `sunmessenger_chat_${normalizeUserId(userId)}`;
}

function safeMessageId(value) {
    const normalized = Number(value);
    return Number.isFinite(normalized) && normalized > 0 ? normalized : null;
}

function mergeAndTrimMessages(existingMessages, incomingMessages, maxMessages = MAX_MESSAGES_PER_CHAT) {
    const byId = new Map();
    const addMessage = (message) => {
        if (!message || typeof message !== 'object') return;
        const messageId = safeMessageId(message.id);
        if (messageId === null) return;
        byId.set(messageId, message);
    };

    (Array.isArray(existingMessages) ? existingMessages : []).forEach(addMessage);
    (Array.isArray(incomingMessages) ? incomingMessages : []).forEach(addMessage);

    const merged = Array.from(byId.entries())
        .sort((a, b) => a[0] - b[0])
        .map((entry) => entry[1]);

    if (merged.length <= maxMessages) return merged;
    return merged.slice(-maxMessages);
}

function resolveBounds(messages, fallback = {}) {
    const list = Array.isArray(messages) ? messages : [];
    const firstFromFallback = safeMessageId(fallback.firstId);
    const lastFromFallback = safeMessageId(fallback.lastId);

    const firstFromMessages = list.length ? safeMessageId(list[0]?.id) : null;
    const lastFromMessages = list.length ? safeMessageId(list[list.length - 1]?.id) : null;

    return {
        firstId: firstFromMessages ?? firstFromFallback ?? 0,
        lastId: lastFromMessages ?? lastFromFallback ?? 0,
    };
}

function openIndexedDb(dbName) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, DB_VERSION);

        request.onupgradeneeded = () => {
            const db = request.result;
            let store = null;
            if (!db.objectStoreNames.contains(STORE_CHATS)) {
                store = db.createObjectStore(STORE_CHATS, { keyPath: 'chat_id' });
            } else {
                store = request.transaction?.objectStore(STORE_CHATS) || null;
            }

            if (store && !store.indexNames.contains(INDEX_UPDATED_AT)) {
                store.createIndex(INDEX_UPDATED_AT, 'updatedAt', { unique: false });
            }
        };

        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Failed to open IndexedDB.'));
        request.onblocked = () => warn(`Open blocked for ${dbName}.`);
    });
}

export async function openChatDb(userId) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId || !canUseIndexedDb()) return null;

    if (activeDb && activeUserId === normalizedUserId) {
        return activeDb;
    }

    if (activeDb) {
        await closeChatDb();
    }

    try {
        const db = await openIndexedDb(buildDbName(normalizedUserId));
        activeDb = db;
        activeUserId = normalizedUserId;
        return db;
    } catch (error) {
        warn('openChatDb failed.', error);
        activeDb = null;
        activeUserId = '';
        return null;
    }
}

export async function closeChatDb() {
    if (!activeDb) return;
    try {
        activeDb.close();
    } catch (error) {
        warn('closeChatDb failed.', error);
    } finally {
        activeDb = null;
        activeUserId = '';
    }
}

export async function deleteChatDb(userId) {
    const normalizedUserId = normalizeUserId(userId);
    if (!normalizedUserId || !canUseIndexedDb()) return;

    if (activeDb && activeUserId === normalizedUserId) {
        await closeChatDb();
    }

    const dbName = buildDbName(normalizedUserId);
    try {
        await new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(dbName);
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error || new Error('Failed to delete database.'));
            request.onblocked = () => {
                warn(`Delete blocked for ${dbName}.`);
                resolve();
            };
        });
    } catch (error) {
        warn('deleteChatDb failed.', error);
    }
}

export async function readCachedMessages(chatId) {
    const key = normalizeChatId(chatId);
    if (!activeDb || !key) return null;

    try {
        const row = await new Promise((resolve, reject) => {
            const tx = activeDb.transaction(STORE_CHATS, 'readonly');
            const request = tx.objectStore(STORE_CHATS).get(key);
            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => reject(request.error || new Error('Failed to read cache.'));
            tx.onerror = () => reject(tx.error || new Error('Failed to read cache transaction.'));
        });
        if (!row) return null;
        return {
            messages: Array.isArray(row.messages) ? row.messages : [],
            updatedAt: Number(row.updatedAt) || 0,
            lastId: safeMessageId(row.lastId) || 0,
            firstId: safeMessageId(row.firstId) || 0,
        };
    } catch (error) {
        warn('readCachedMessages failed.', error);
        return null;
    }
}

export async function writeCachedMessages(chatId, messages, meta = {}) {
    const key = normalizeChatId(chatId);
    if (!activeDb || !key) return;

    try {
        const normalizedMessages = mergeAndTrimMessages([], messages);
        const bounds = resolveBounds(normalizedMessages, meta);
        const payload = {
            chat_id: key,
            messages: normalizedMessages,
            lastId: bounds.lastId,
            firstId: bounds.firstId,
            updatedAt: Date.now(),
        };

        await new Promise((resolve, reject) => {
            const tx = activeDb.transaction(STORE_CHATS, 'readwrite');
            tx.objectStore(STORE_CHATS).put(payload);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('Failed to write cache.'));
            tx.onabort = () => reject(tx.error || new Error('Cache write transaction aborted.'));
        });
    } catch (error) {
        warn('writeCachedMessages failed.', error);
    }
}

export async function appendCachedMessages(chatId, newMessages) {
    const key = normalizeChatId(chatId);
    const incoming = Array.isArray(newMessages) ? newMessages : [];
    if (!activeDb || !key || !incoming.length) return;

    try {
        await new Promise((resolve, reject) => {
            const tx = activeDb.transaction(STORE_CHATS, 'readwrite');
            const store = tx.objectStore(STORE_CHATS);
            const getRequest = store.get(key);

            getRequest.onerror = () => reject(getRequest.error || new Error('Failed to read cache row.'));
            getRequest.onsuccess = () => {
                const existing = getRequest.result || null;
                const mergedMessages = mergeAndTrimMessages(existing?.messages, incoming);
                const bounds = resolveBounds(mergedMessages, existing || {});
                store.put({
                    chat_id: key,
                    messages: mergedMessages,
                    lastId: bounds.lastId,
                    firstId: bounds.firstId,
                    updatedAt: Date.now(),
                });
            };

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('Failed to append cache.'));
            tx.onabort = () => reject(tx.error || new Error('Cache append transaction aborted.'));
        });
    } catch (error) {
        warn('appendCachedMessages failed.', error);
    }
}

export async function removeCachedMessages(chatId, messageIds) {
    const key = normalizeChatId(chatId);
    const ids = new Set(
        (Array.isArray(messageIds) ? messageIds : [messageIds])
            .map((id) => safeMessageId(id))
            .filter((id) => id !== null)
    );
    if (!activeDb || !key || !ids.size) return;

    try {
        await new Promise((resolve, reject) => {
            const tx = activeDb.transaction(STORE_CHATS, 'readwrite');
            const store = tx.objectStore(STORE_CHATS);
            const getRequest = store.get(key);

            getRequest.onerror = () => reject(getRequest.error || new Error('Failed to read cache row.'));
            getRequest.onsuccess = () => {
                const existing = getRequest.result || null;
                if (!existing) return;
                const nextMessages = (Array.isArray(existing.messages) ? existing.messages : [])
                    .filter((message) => !ids.has(safeMessageId(message?.id)));
                if (!nextMessages.length) {
                    store.delete(key);
                    return;
                }
                const bounds = resolveBounds(nextMessages, existing || {});
                store.put({
                    chat_id: key,
                    messages: nextMessages,
                    lastId: bounds.lastId,
                    firstId: bounds.firstId,
                    updatedAt: Date.now(),
                });
            };

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('Failed to remove cached messages.'));
            tx.onabort = () => reject(tx.error || new Error('Cache remove transaction aborted.'));
        });
    } catch (error) {
        warn('removeCachedMessages failed.', error);
    }
}

export async function pruneCachedChats(maxChats = 100) {
    const safeLimit = Math.max(1, Number(maxChats) || 100);
    if (!activeDb) return;

    try {
        await new Promise((resolve, reject) => {
            const tx = activeDb.transaction(STORE_CHATS, 'readwrite');
            const store = tx.objectStore(STORE_CHATS);
            if (!store.indexNames.contains(INDEX_UPDATED_AT)) {
                resolve();
                return;
            }

            const index = store.index(INDEX_UPDATED_AT);
            const keys = [];
            const cursorRequest = index.openCursor(null, 'next');

            cursorRequest.onerror = () => reject(cursorRequest.error || new Error('Failed to iterate cache rows.'));
            cursorRequest.onsuccess = () => {
                const cursor = cursorRequest.result;
                if (cursor) {
                    keys.push(cursor.primaryKey);
                    cursor.continue();
                    return;
                }

                const overflow = Math.max(0, keys.length - safeLimit);
                for (let i = 0; i < overflow; i += 1) {
                    store.delete(keys[i]);
                }
            };

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('Failed to prune cache.'));
            tx.onabort = () => reject(tx.error || new Error('Cache prune transaction aborted.'));
        });
    } catch (error) {
        warn('pruneCachedChats failed.', error);
    }
}

export async function clearAllCache() {
    if (!activeDb) return;
    try {
        await new Promise((resolve, reject) => {
            const tx = activeDb.transaction(STORE_CHATS, 'readwrite');
            tx.objectStore(STORE_CHATS).clear();
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('Failed to clear cache.'));
            tx.onabort = () => reject(tx.error || new Error('Cache clear transaction aborted.'));
        });
    } catch (error) {
        warn('clearAllCache failed.', error);
    }
}

export async function deleteCachedChat(chatId) {
    const key = normalizeChatId(chatId);
    if (!activeDb || !key) return;
    try {
        await new Promise((resolve, reject) => {
            const tx = activeDb.transaction(STORE_CHATS, 'readwrite');
            tx.objectStore(STORE_CHATS).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('Failed to delete chat cache.'));
            tx.onabort = () => reject(tx.error || new Error('Chat cache delete transaction aborted.'));
        });
    } catch (error) {
        warn('deleteCachedChat failed.', error);
    }
}
