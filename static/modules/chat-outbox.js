// Outbox: persistent queue for outgoing socket messages that could not be
// delivered immediately (offline / disconnected socket). Stores already
// encrypted payloads — server idempotency via request_id prevents duplicates
// on retry. E2E invariant preserved: no plaintext is ever stored here.

const DB_VERSION = 1;
const STORE_OUTBOX = 'outbox';
const INDEX_CREATED_AT = 'byCreatedAt';
const ENTRY_TTL_MS = 24 * 60 * 60 * 1000;

let activeDb = null;
let activeUserId = '';
let _openingPromise = null;

function warn(message, error) {
    if (error) {
        console.warn(`[chat-outbox] ${message}`, error);
        return;
    }
    console.warn(`[chat-outbox] ${message}`);
}

function canUseIndexedDb() {
    return typeof indexedDB !== 'undefined';
}

function normalizeUserId(value) {
    return String(value ?? '').trim();
}

function buildDbName(userId) {
    return `sunmessenger_outbox_${normalizeUserId(userId)}`;
}

function openDb(dbName) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(dbName, DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            let store = null;
            if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
                store = db.createObjectStore(STORE_OUTBOX, { keyPath: 'clientId' });
            } else {
                store = request.transaction?.objectStore(STORE_OUTBOX) || null;
            }
            if (store && !store.indexNames.contains(INDEX_CREATED_AT)) {
                store.createIndex(INDEX_CREATED_AT, 'createdAt', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Failed to open outbox DB.'));
        request.onblocked = () => warn(`Open blocked for ${dbName}.`);
    });
}

export async function openOutbox(userId) {
    const normalized = normalizeUserId(userId);
    if (!normalized || !canUseIndexedDb()) return null;
    if (activeDb && activeUserId === normalized) return activeDb;
    // Если уже идёт открытие — ждём его завершения, не запускаем параллельное
    if (_openingPromise) return _openingPromise;
    _openingPromise = (async () => {
        if (activeDb) await closeOutbox();
        try {
            const db = await openDb(buildDbName(normalized));
            activeDb = db;
            activeUserId = normalized;
            return db;
        } catch (error) {
            warn('openOutbox failed.', error);
            activeDb = null;
            activeUserId = '';
            return null;
        } finally {
            _openingPromise = null;
        }
    })();
    return _openingPromise;
}

export async function closeOutbox() {
    if (!activeDb) return;
    try { activeDb.close(); } catch (error) { warn('closeOutbox failed.', error); }
    activeDb = null;
    activeUserId = '';
}

export async function deleteOutbox(userId) {
    const normalized = normalizeUserId(userId);
    if (!normalized || !canUseIndexedDb()) return;
    if (activeDb && activeUserId === normalized) await closeOutbox();
    try {
        await new Promise((resolve, reject) => {
            const request = indexedDB.deleteDatabase(buildDbName(normalized));
            request.onsuccess = () => resolve();
            request.onerror = () => reject(request.error || new Error('Failed to delete outbox.'));
            request.onblocked = () => { warn('Delete blocked.'); resolve(); };
        });
    } catch (error) {
        warn('deleteOutbox failed.', error);
    }
}

function isValidEntry(entry) {
    if (!entry || typeof entry !== 'object') return false;
    if (!entry.clientId || typeof entry.clientId !== 'string') return false;
    if (!entry.eventName || typeof entry.eventName !== 'string') return false;
    if (!entry.payload || typeof entry.payload !== 'object') return false;
    return true;
}

export async function enqueueOutboxEntry(entry) {
    if (!activeDb) return false;
    if (!isValidEntry(entry)) return false;
    const record = {
        clientId: entry.clientId,
        eventName: entry.eventName,
        payload: entry.payload,
        createdAt: Number(entry.createdAt) || Date.now(),
        attempts: Number(entry.attempts) || 0,
    };
    try {
        await new Promise((resolve, reject) => {
            const tx = activeDb.transaction(STORE_OUTBOX, 'readwrite');
            tx.objectStore(STORE_OUTBOX).put(record);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('enqueue failed.'));
            tx.onabort = () => reject(tx.error || new Error('enqueue aborted.'));
        });
        return true;
    } catch (error) {
        warn('enqueueOutboxEntry failed.', error);
        return false;
    }
}

export async function removeOutboxEntry(clientId) {
    if (!activeDb || !clientId) return;
    try {
        await new Promise((resolve, reject) => {
            const tx = activeDb.transaction(STORE_OUTBOX, 'readwrite');
            tx.objectStore(STORE_OUTBOX).delete(String(clientId));
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error || new Error('remove failed.'));
            tx.onabort = () => reject(tx.error || new Error('remove aborted.'));
        });
    } catch (error) {
        warn('removeOutboxEntry failed.', error);
    }
}

export async function listOutboxEntries() {
    if (!activeDb) return [];
    try {
        return await new Promise((resolve, reject) => {
            const tx = activeDb.transaction(STORE_OUTBOX, 'readonly');
            const request = tx.objectStore(STORE_OUTBOX).index(INDEX_CREATED_AT).getAll();
            request.onsuccess = () => {
                const rows = Array.isArray(request.result) ? request.result : [];
                resolve(rows.filter(isValidEntry));
            };
            request.onerror = () => reject(request.error || new Error('list failed.'));
        });
    } catch (error) {
        warn('listOutboxEntries failed.', error);
        return [];
    }
}

export async function pruneExpiredEntries(now = Date.now(), ttlMs = ENTRY_TTL_MS) {
    if (!activeDb) return [];
    const cutoff = Number(now) - Number(ttlMs);
    const expiredIds = [];
    try {
        const entries = await listOutboxEntries();
        entries.forEach((entry) => {
            if (Number(entry.createdAt) < cutoff) expiredIds.push(entry.clientId);
        });
        for (const id of expiredIds) {
            await removeOutboxEntry(id);
        }
    } catch (error) {
        warn('pruneExpiredEntries failed.', error);
    }
    return expiredIds;
}

export function createOutboxRuntime({
    currentUserId = '',
    onEntryExpired = null,
    onEntryDrained = null,
} = {}) {
    const normalizedUserId = normalizeUserId(currentUserId);
    let ready = false;
    let initPromise = Promise.resolve(false);
    let draining = false;
    let cachedCount = 0;
    const changeListeners = new Set();

    function notifyChange() {
        changeListeners.forEach((listener) => {
            try { listener(cachedCount); } catch (_) {}
        });
    }

    async function refreshCount() {
        if (!ready) {
            cachedCount = 0;
            return 0;
        }
        try {
            const entries = await listOutboxEntries();
            cachedCount = entries.length;
        } catch (_) {
            cachedCount = 0;
        }
        notifyChange();
        return cachedCount;
    }

    async function init() {
        initPromise = (async () => {
            if (!normalizedUserId) return false;
            try {
                const db = await openOutbox(normalizedUserId);
                ready = Boolean(db);
                if (ready) {
                    const expired = await pruneExpiredEntries();
                    if (expired.length && typeof onEntryExpired === 'function') {
                        expired.forEach((clientId) => {
                            try { onEntryExpired(clientId); } catch (_) {}
                        });
                    }
                    await refreshCount();
                }
                return ready;
            } catch (error) {
                warn('init failed.', error);
                ready = false;
                return false;
            }
        })();
        return initPromise;
    }

    async function ensureReady() {
        if (ready) return true;
        try { await initPromise; } catch (_) {}
        return ready;
    }

    async function enqueue({ clientId, eventName, payload }) {
        if (!await ensureReady()) return false;
        const ok = await enqueueOutboxEntry({
            clientId,
            eventName,
            payload,
            createdAt: Date.now(),
        });
        if (ok) await refreshCount();
        return ok;
    }

    async function remove(clientId) {
        if (!await ensureReady()) return;
        await removeOutboxEntry(clientId);
        await refreshCount();
    }

    async function drainOnce(emitSocket) {
        if (typeof emitSocket !== 'function') return 0;
        if (draining) return 0;
        if (!await ensureReady()) return 0;
        draining = true;
        let sent = 0;
        try {
            const expired = await pruneExpiredEntries();
            if (expired.length && typeof onEntryExpired === 'function') {
                expired.forEach((clientId) => {
                    try { onEntryExpired(clientId); } catch (_) {}
                });
            }
            const entries = await listOutboxEntries();
            for (const entry of entries) {
                const ok = emitSocket(entry.eventName, entry.payload, { requireConnected: true });
                if (!ok) break;
                sent += 1;
                if (typeof onEntryDrained === 'function') {
                    try { onEntryDrained(entry.clientId); } catch (_) {}
                }
            }
            if (sent > 0) await refreshCount();
        } finally {
            draining = false;
        }
        return sent;
    }

    function onCountChange(listener) {
        if (typeof listener !== 'function') return () => {};
        changeListeners.add(listener);
        try { listener(cachedCount); } catch (_) {}
        return () => { changeListeners.delete(listener); };
    }

    function getCount() {
        return cachedCount;
    }

    async function close() {
        if (!ready) return;
        await closeOutbox().catch(() => {});
        ready = false;
    }

    async function clearOnLogout() {
        const targetUserId = normalizedUserId;
        if (await ensureReady()) {
            const entries = await listOutboxEntries();
            for (const entry of entries) {
                await removeOutboxEntry(entry.clientId);
            }
        }
        if (targetUserId) {
            await deleteOutbox(targetUserId).catch(() => {});
        }
        ready = false;
    }

    return {
        init,
        ensureReady,
        isReady: () => ready,
        enqueue,
        remove,
        drainOnce,
        close,
        clearOnLogout,
        getCount,
        onCountChange,
        refreshCount,
    };
}
