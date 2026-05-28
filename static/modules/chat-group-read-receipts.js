import { escapeHtml, tr } from './utils.js';

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
    if (!isGroupChat || !isSelf) return '';
    const readers = normalizeGroupReaders(message?.group_readers);
    const rawCount = Number(message?.group_read_count);
    const readCount = Number.isFinite(rawCount) && rawCount >= 0
        ? Math.floor(rawCount)
        : readers.length;
    if (readCount <= 0) return '';

    const readerNames = readers
        .slice(0, 5)
        .map((reader) => String(reader.display_name || reader.username || '').trim())
        .filter(Boolean);
    const title = readerNames.length
        ? readerNames.join(', ')
        : `${readCount} ${tr('прочитали')}`;
    return `<span class="msg-group-readers" title="${escapeHtml(title)}" aria-label="${escapeHtml(title)}"><i class="bi bi-eye-fill" aria-hidden="true"></i><span>${readCount}</span></span>`;
}

export function applyGroupReadMetaToElement(messageEl, message, { isGroupChat = false } = {}) {
    if (!messageEl) return;
    const metaEl = messageEl.querySelector('.msg-meta, .message-meta');
    if (!metaEl) return;
    const nextHtml = buildGroupReadMetaHtml(message, {
        isGroupChat,
        isSelf: message?.sender === 'self',
    });
    const current = metaEl.querySelector('.msg-group-readers');
    if (!nextHtml) {
        current?.remove();
        return;
    }
    if (current) {
        current.outerHTML = nextHtml;
        return;
    }
    const timeEl = metaEl.querySelector('.msg-time');
    if (timeEl) {
        timeEl.insertAdjacentHTML('beforebegin', nextHtml);
        return;
    }
    metaEl.insertAdjacentHTML('afterbegin', nextHtml);
}
