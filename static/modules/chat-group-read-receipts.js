import { escapeHtml } from './utils.js';

function resolveLocale() {
    const api = window.SUN_I18N;
    const language = api && typeof api.getLanguage === 'function'
        ? String(api.getLanguage() || '').trim().toLowerCase()
        : String(document.documentElement?.lang || '').trim().toLowerCase();
    return language.startsWith('en') ? 'en' : 'ru';
}

function buildReadLabel(count) {
    const safeCount = Math.max(0, Number(count) || 0);
    const locale = resolveLocale();
    if (locale === 'en') {
        return `Read by ${safeCount}`;
    }
    return `прочитали ${safeCount}`;
}

function resolveReaderDisplayName(reader = {}) {
    const displayName = String(reader.display_name || '').trim();
    if (displayName) return displayName;
    const username = String(reader.username || '').trim();
    if (username) return `@${username}`;
    return resolveLocale() === 'en' ? 'Member' : 'Участник';
}

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
    const latestReadAt = String(rawUpdate?.latest_read_at ?? rawUpdate?.latestReadAt || '').trim() || null;
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
    const count = Number(message?.group_read_count);
    const readCount = Number.isFinite(count) && count >= 0 ? Math.floor(count) : readers.length;
    if (readCount <= 0) return '';
    const label = buildReadLabel(readCount);
    const tooltip = readers.map((reader) => resolveReaderDisplayName(reader)).join(', ');
    const titleAttr = tooltip ? ` title="${escapeHtml(tooltip)}"` : '';
    return `<span class="msg-group-readers" data-group-read-count="${readCount}"${titleAttr}>${escapeHtml(label)}</span>`;
}

export function applyGroupReadMetaToElement(messageEl, message, { isGroupChat = false } = {}) {
    if (!messageEl) return;
    const metaEl = messageEl.querySelector('.msg-meta, .message-meta');
    if (!metaEl) return;
    const isSelf = messageEl.classList.contains('self');
    const readers = normalizeGroupReaders(message?.group_readers);
    const countRaw = Number(message?.group_read_count);
    const readCount = Number.isFinite(countRaw) && countRaw >= 0 ? Math.floor(countRaw) : readers.length;
    let indicatorEl = metaEl.querySelector('.msg-group-readers');

    if (!isGroupChat || !isSelf || readCount <= 0) {
        indicatorEl?.remove();
        return;
    }

    if (!indicatorEl) {
        indicatorEl = document.createElement('span');
        indicatorEl.className = 'msg-group-readers';
        const timeEl = metaEl.querySelector('.msg-time');
        if (timeEl) {
            timeEl.before(indicatorEl);
        } else {
            metaEl.prepend(indicatorEl);
        }
    }

    indicatorEl.textContent = buildReadLabel(readCount);
    indicatorEl.setAttribute('data-group-read-count', String(readCount));
    const tooltip = readers.map((reader) => resolveReaderDisplayName(reader)).join(', ');
    if (tooltip) {
        indicatorEl.setAttribute('title', tooltip);
    } else {
        indicatorEl.removeAttribute('title');
    }
}
