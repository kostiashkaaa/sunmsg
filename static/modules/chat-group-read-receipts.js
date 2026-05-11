export function normalizeGroupReaders(rawReaders) {
    if (!Array.isArray(rawReaders)) return [];
    const normalized = [];
    const seen = new Set();
    rawReaders.forEach((reader) => {
        const userId = Number(reader?.user_id);
        if (!Number.isFinite(userId) || userId <= 0 || seen.has(userId)) return;
        seen.add(userId);
        normalized.push({
            user_id: userId,
            display_name: String(reader?.display_name || '').trim(),
            username: String(reader?.username || '').trim(),
            read_at: String(reader?.read_at || '').trim() || null,
        });
    });
    return normalized;
}

export function normalizeGroupReadUpdate(rawUpdate) {
    const messageId = Number(rawUpdate?.message_id ?? rawUpdate?.messageId);
    if (!Number.isFinite(messageId) || messageId <= 0) return null;
    const readers = normalizeGroupReaders(rawUpdate?.readers);
    const countRaw = Number(rawUpdate?.read_count ?? rawUpdate?.readCount);
    const readCount = Number.isFinite(countRaw) && countRaw >= 0
        ? Math.floor(countRaw)
        : readers.length;
    const latestReadAt = String((rawUpdate?.latest_read_at ?? rawUpdate?.latestReadAt) || '').trim() || null;
    return {
        messageId,
        readCount,
        readers,
        latestReadAt,
    };
}

export function applyGroupReadUpdateToMessage(message, rawUpdate) {
    if (!message || message.sender !== 'self') return message;
    const update = normalizeGroupReadUpdate(rawUpdate);
    if (!update) return message;

    const previousReaders = normalizeGroupReaders(message.group_readers);
    const previousCount = Number(message.group_read_count) || 0;
    const sameCount = previousCount === update.readCount;
    const sameReaders = previousReaders.length === update.readers.length
        && previousReaders.every((reader, index) => {
            const nextReader = update.readers[index];
            return nextReader
                && Number(reader.user_id) === Number(nextReader.user_id)
                && String(reader.read_at || '') === String(nextReader.read_at || '');
        });
    const nextReadAt = update.latestReadAt || (update.readCount > 0 ? (message.read_at || null) : null);
    const isRead = update.readCount > 0;
    const sameReadFlags = Boolean(message.is_read) === isRead
        && String(message.read_at || '') === String(nextReadAt || '');
    if (sameCount && sameReaders && sameReadFlags) {
        return message;
    }

    return {
        ...message,
        group_read_count: update.readCount,
        group_readers: update.readers,
        is_read: isRead,
        is_delivered: true,
        pending: false,
        read_at: nextReadAt,
    };
}

export function buildGroupReadMetaHtml(message, { isGroupChat = false, isSelf = false } = {}) {
    void message;
    void isGroupChat;
    void isSelf;
    return '';
}

export function applyGroupReadMetaToElement(messageEl, message, { isGroupChat = false } = {}) {
    if (!messageEl) return;
    const metaEl = messageEl.querySelector('.msg-meta, .message-meta');
    if (!metaEl) return;
    void message;
    void isGroupChat;
    metaEl.querySelector('.msg-group-readers')?.remove();
}
