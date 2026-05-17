import { collectMediaFromMessages } from './profile-media.js';

const DEFAULT_PAGE_LIMIT = 80;
const COLLECTION_KEYS = ['media', 'files', 'audio', 'voices', 'links'];

function createEmptyCollections() {
    return { media: [], files: [], audio: [], voices: [], links: [] };
}

function normalizeMessageId(value) {
    const id = Number(value);
    return Number.isFinite(id) && id > 0 ? id : 0;
}

function entryKey(kind, entry) {
    const msgId = normalizeMessageId(entry?.msgId);
    if (kind === 'links') {
        return `${msgId}:${String(entry?.url || '').trim()}`;
    }
    return String(msgId);
}

function cloneCollections(source) {
    const result = createEmptyCollections();
    COLLECTION_KEYS.forEach((key) => {
        result[key] = Array.isArray(source?.[key]) ? [...source[key]] : [];
    });
    return result;
}

export function mergeMediaCollections(...collections) {
    const result = createEmptyCollections();

    COLLECTION_KEYS.forEach((key) => {
        const seen = new Map();
        collections.forEach((collection) => {
            (Array.isArray(collection?.[key]) ? collection[key] : []).forEach((entry) => {
                const dedupeKey = entryKey(key, entry);
                if (!dedupeKey || seen.has(dedupeKey)) return;
                seen.set(dedupeKey, entry);
            });
        });
        result[key] = [...seen.values()].sort((a, b) => normalizeMessageId(b?.msgId) - normalizeMessageId(a?.msgId));
    });

    return result;
}

export function createProfileSharedContentIndex({
    fetchImpl = fetch,
    resolveAppUrl = (path) => path,
    decodeChatMessages = async (messages) => messages,
    pageLimit = DEFAULT_PAGE_LIMIT,
    backgroundDelayMs = 30,
} = {}) {
    const indexes = new Map();

    function getOrCreate(chatId) {
        const key = String(chatId || '').trim();
        if (!key) return null;
        if (!indexes.has(key)) {
            indexes.set(key, {
                media: createEmptyCollections(),
                nextBeforeId: null,
                hasMoreBefore: true,
                initialized: false,
                loading: false,
                backgroundPromise: null,
            });
        }
        return indexes.get(key);
    }

    function getCollections(chatId) {
        const entry = getOrCreate(chatId);
        return cloneCollections(entry?.media);
    }

    function getStatus(chatId) {
        const entry = getOrCreate(chatId);
        return {
            initialized: Boolean(entry?.initialized),
            loading: Boolean(entry?.loading),
            hasMoreBefore: Boolean(entry?.hasMoreBefore),
        };
    }

    async function loadNextPage(chatId) {
        const key = String(chatId || '').trim();
        const entry = getOrCreate(key);
        if (!key || !entry || entry.loading || (entry.initialized && !entry.hasMoreBefore)) {
            return false;
        }

        entry.loading = true;
        try {
            const params = new URLSearchParams({
                chat_id: key,
                type: 'all',
                limit: String(Math.max(1, Math.min(Number(pageLimit) || DEFAULT_PAGE_LIMIT, 120))),
            });
            if (entry.nextBeforeId) {
                params.set('before_id', String(entry.nextBeforeId));
            }

            const response = await fetchImpl(resolveAppUrl(`/api/chats/shared-content-candidates?${params.toString()}`));
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.success) {
                entry.hasMoreBefore = false;
                entry.initialized = true;
                return false;
            }

            const decodedMessages = await decodeChatMessages(payload.messages || []);
            entry.media = mergeMediaCollections(entry.media, collectMediaFromMessages(decodedMessages));
            entry.hasMoreBefore = Boolean(payload.has_more_before);
            entry.nextBeforeId = payload.next_before_id || null;
            entry.initialized = true;
            return Array.isArray(payload.messages) && payload.messages.length > 0;
        } finally {
            entry.loading = false;
        }
    }

    function loadUntilDone(chatId, {
        shouldContinue = () => true,
        onUpdate = () => {},
    } = {}) {
        const entry = getOrCreate(chatId);
        if (!entry || entry.backgroundPromise) return entry?.backgroundPromise || Promise.resolve(false);

        entry.backgroundPromise = (async () => {
            try {
                while (shouldContinue() && (!entry.initialized || entry.hasMoreBefore)) {
                    const loaded = await loadNextPage(chatId);
                    onUpdate();
                    if (!loaded && !entry.hasMoreBefore) break;
                    if (backgroundDelayMs > 0) {
                        await new Promise((resolve) => setTimeout(resolve, backgroundDelayMs));
                    }
                }
                return true;
            } finally {
                entry.backgroundPromise = null;
            }
        })();

        return entry.backgroundPromise;
    }

    return {
        getCollections,
        getStatus,
        loadNextPage,
        loadUntilDone,
    };
}
