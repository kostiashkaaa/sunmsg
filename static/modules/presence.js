// presence.js - typing indicators and online status display
import { tr, activeLocale, escapeHtml } from './utils.js';

const sidebarTypingSnapshotByChat = {};
const typingEntriesByChat = new Map();
const typingTimersByKey = new Map();
let lastSeenIntervalId = 0;
let languageListenerBound = false;

function sanitizeTypingLabel(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 64);
}

function resolveTypingName(entry) {
    const displayName = sanitizeTypingLabel(entry?.sender_display_name);
    if (displayName) return displayName;
    const username = sanitizeTypingLabel(entry?.sender_username);
    return username ? `@${username.replace(/^@+/, '')}` : tr('\u0423\u0447\u0430\u0441\u0442\u043D\u0438\u043A');
}

function isGroupChatById(chatId) {
    const key = String(chatId || '').trim();
    if (!key) return false;
    const item = document.querySelector(`.contact-item[data-chat-id="${CSS.escape(key)}"]`);
    return String(item?.getAttribute('data-is-group') || '') === '1';
}

const TYPING_KIND_PRIORITY = {
    text: 1,
    voice: 2,
    upload_file: 3,
    upload_voice: 4,
    send_file: 5,
    send_voice: 6,
};

function normalizeTypingKind(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(TYPING_KIND_PRIORITY, normalized)
        ? normalized
        : 'text';
}

function resolveDominantTypingKind(entries) {
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) return 'text';
    let dominant = 'text';
    let dominantPriority = TYPING_KIND_PRIORITY.text;
    list.forEach((entry) => {
        const kind = normalizeTypingKind(entry?.typing_kind);
        const priority = TYPING_KIND_PRIORITY[kind] || TYPING_KIND_PRIORITY.text;
        if (priority > dominantPriority) {
            dominant = kind;
            dominantPriority = priority;
        }
    });
    return dominant;
}

function resolveTypingActionLabel(kind, { plural = false } = {}) {
    const normalized = normalizeTypingKind(kind);
    if (normalized === 'voice') {
        return plural ? tr('\u0437\u0430\u043F\u0438\u0441\u044B\u0432\u0430\u044E\u0442 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u044B\u0435') : tr('\u0437\u0430\u043F\u0438\u0441\u044B\u0432\u0430\u0435\u0442 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0435');
    }
    if (normalized === 'upload_file') {
        return plural ? tr('\u0437\u0430\u0433\u0440\u0443\u0436\u0430\u044E\u0442 \u0444\u0430\u0439\u043B\u044B') : tr('\u0437\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u0442 \u0444\u0430\u0439\u043B');
    }
    if (normalized === 'upload_voice') {
        return plural ? tr('\u0437\u0430\u0433\u0440\u0443\u0436\u0430\u044E\u0442 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u044B\u0435') : tr('\u0437\u0430\u0433\u0440\u0443\u0436\u0430\u0435\u0442 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0435');
    }
    if (normalized === 'send_file') {
        return plural ? tr('\u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u044E\u0442 \u0444\u0430\u0439\u043B\u044B') : tr('\u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u0435\u0442 \u0444\u0430\u0439\u043B');
    }
    if (normalized === 'send_voice') {
        return plural ? tr('\u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u044E\u0442 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u044B\u0435') : tr('\u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u0435\u0442 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0435');
    }
    return plural ? tr('\u043F\u0435\u0447\u0430\u0442\u0430\u044E\u0442') : tr('\u043F\u0435\u0447\u0430\u0442\u0430\u0435\u0442');
}

function buildTypingPhrase(entries, { includeNames = true } = {}) {
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) return '';
    const dominantKind = resolveDominantTypingKind(list);
    const singleAction = resolveTypingActionLabel(dominantKind, { plural: false });
    const pluralAction = resolveTypingActionLabel(dominantKind, { plural: true });
    if (!includeNames) {
        if (list.length === 1) return singleAction;
        if (list.length === 2) return pluralAction;
        return `${list.length} ${pluralAction}...`;
    }
    if (list.length === 1) {
        return `${resolveTypingName(list[0])} ${singleAction}`;
    }
    if (list.length === 2) {
        return `${resolveTypingName(list[0])}, ${resolveTypingName(list[1])} ${pluralAction}`;
    }
    return `${list.length} ${pluralAction}...`;
}

function resolveTypingKindIconClass(kind) {
    const normalized = normalizeTypingKind(kind);
    if (normalized === 'voice' || normalized === 'upload_voice') return 'bi bi-mic-fill';
    if (normalized === 'upload_file') return 'bi bi-upload';
    if (normalized === 'send_file' || normalized === 'send_voice') return 'bi bi-send-fill';
    return '';
}

function buildTypingInlineHtml(text, kind, { withSidebarMarker = false } = {}) {
    const label = escapeHtml(sanitizeTypingLabel(text));
    const normalizedKind = normalizeTypingKind(kind);
    const iconClass = resolveTypingKindIconClass(normalizedKind);
    const markerAttr = withSidebarMarker ? ' data-typing-indicator="1"' : '';
    const iconHtml = iconClass
        ? `<span class="typing-indicator-glyph" aria-hidden="true"><i class="${iconClass}"></i></span>`
        : '';
    return `<span class="typing-indicator-inline typing-indicator-inline--${normalizedKind}" data-typing-kind="${normalizedKind}"${markerAttr}><span class="typing-indicator-label">${label}</span>${iconHtml}<span class="typing-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span></span>`;
}

function renderTypingText(text, kind = 'text') {
    const typingIndicator = document.getElementById('typingIndicator');
    if (!typingIndicator) return;
    typingIndicator.innerHTML = buildTypingInlineHtml(text, kind);
}

function showTyping(text, kind = 'text') {
    const typingIndicator = document.getElementById('typingIndicator');
    const chatOnlineStatus = document.getElementById('chatOnlineStatus');
    if (chatOnlineStatus) chatOnlineStatus.style.display = 'none';
    if (typingIndicator) {
        if (text) renderTypingText(text, kind);
        typingIndicator.style.display = 'block';
    }
}

function hideTyping() {
    const typingIndicator = document.getElementById('typingIndicator');
    const chatOnlineStatus = document.getElementById('chatOnlineStatus');
    if (typingIndicator) typingIndicator.style.display = 'none';
    if (chatOnlineStatus) chatOnlineStatus.style.display = 'block';
}

function showSidebarTyping(chatId, text, kind = 'text') {
    const chatIdKey = String(chatId || '');
    if (!chatIdKey) return;
    const item = document.querySelector(`.contact-item[data-chat-id="${CSS.escape(chatIdKey)}"]`);
    if (!item) return;
    const lastMessage = item.querySelector('.contact-last-msg');
    if (!lastMessage) return;
    if (!Object.prototype.hasOwnProperty.call(sidebarTypingSnapshotByChat, chatId)) {
        sidebarTypingSnapshotByChat[chatId] = lastMessage.innerHTML;
    }
    const typingLabel = sanitizeTypingLabel(text || tr('\u043F\u0435\u0447\u0430\u0442\u0430\u0435\u0442'));
    lastMessage.innerHTML = buildTypingInlineHtml(typingLabel, kind, { withSidebarMarker: true });
}

function hideSidebarTyping(chatId) {
    const chatIdKey = String(chatId || '');
    if (!chatIdKey) return;
    const item = document.querySelector(`.contact-item[data-chat-id="${CSS.escape(chatIdKey)}"]`);
    if (!item) return;
    const lastMessage = item.querySelector('.contact-last-msg');
    if (!lastMessage) return;
    if (Object.prototype.hasOwnProperty.call(sidebarTypingSnapshotByChat, chatId)) {
        lastMessage.innerHTML = sidebarTypingSnapshotByChat[chatId];
        delete sidebarTypingSnapshotByChat[chatId];
    }
}

function makeLastSeenText(lastSeen) {
    if (!lastSeen) return tr('\u043D\u0435 \u0432 \u0441\u0435\u0442\u0438');
    const date = new Date(lastSeen.replace(' ', 'T') + 'Z');
    const diff = Math.floor((new Date() - date) / 60000);
    if (diff < 1) return tr('\u0431\u044B\u043B(\u0430) \u0432 \u0441\u0435\u0442\u0438 \u0442\u043E\u043B\u044C\u043A\u043E \u0447\u0442\u043E');
    if (diff < 60) return `${tr('\u0431\u044B\u043B(\u0430) \u0432 \u0441\u0435\u0442\u0438')} ${diff} ${tr('\u043C\u0438\u043D. \u043D\u0430\u0437\u0430\u0434')}`;
    if (diff < 1440) return `${tr('\u0431\u044B\u043B(\u0430) \u0432 \u0441\u0435\u0442\u0438')} ${Math.floor(diff / 60)} ${tr('\u0447. \u043D\u0430\u0437\u0430\u0434')}`;
    return `${tr('\u0431\u044B\u043B(\u0430) \u0432 \u0441\u0435\u0442\u0438')} ${date.toLocaleDateString(activeLocale())}`;
}

function refreshLastSeenLabel() {
    const status = document.getElementById('chatOnlineStatus');
    if (!status || status.style.display === 'none') return;
    if (status.dataset.state === 'online') return;
    const lastSeen = status.getAttribute('data-last-seen');
    if (lastSeen) status.textContent = makeLastSeenText(lastSeen);
}

function senderTypingKey(data) {
    const id = Number(data?.sender_user_id);
    if (Number.isFinite(id) && id > 0) return `uid:${id}`;
    const label = sanitizeTypingLabel(data?.sender_display_name || data?.sender_username || '');
    return `name:${label || 'unknown'}`;
}

function getTypingEntries(chatId) {
    const key = String(chatId || '').trim();
    if (!key) return [];
    const entries = typingEntriesByChat.get(key);
    if (!entries || !entries.size) return [];
    return Array.from(entries.values());
}

function applyTypingUiForChat(chatId, getChatId) {
    const key = String(chatId || '').trim();
    if (!key) return;
    const entries = getTypingEntries(key);
    if (!entries.length) {
        hideSidebarTyping(key);
        if (String(getChatId() || '') === key) hideTyping();
        return;
    }
    const dominantKind = resolveDominantTypingKind(entries);
    const phrase = buildTypingPhrase(entries, { includeNames: isGroupChatById(key) });
    showSidebarTyping(key, phrase, dominantKind);
    if (String(getChatId() || '') === key) showTyping(phrase, dominantKind);
}

function pruneTypingState(chatId) {
    const key = String(chatId || '').trim();
    if (!key) return;
    const map = typingEntriesByChat.get(key);
    if (map && map.size === 0) {
        typingEntriesByChat.delete(key);
    }
}

function upsertTypingSignal(data, getChatId) {
    const chatId = String(data?.chat_id || '').trim();
    if (!chatId) return;
    const entryKey = senderTypingKey(data);
    const map = typingEntriesByChat.get(chatId) || new Map();
    map.set(entryKey, {
        sender_user_id: data?.sender_user_id,
        sender_display_name: data?.sender_display_name,
        sender_username: data?.sender_username,
        typing_kind: normalizeTypingKind(data?.typing_kind),
    });
    typingEntriesByChat.set(chatId, map);

    const timerKey = `${chatId}|${entryKey}`;
    const existingTimer = typingTimersByKey.get(timerKey);
    if (existingTimer) {
        clearTimeout(existingTimer);
    }
    const timeoutId = setTimeout(() => {
        const currentMap = typingEntriesByChat.get(chatId);
        currentMap?.delete(entryKey);
        pruneTypingState(chatId);
        typingTimersByKey.delete(timerKey);
        applyTypingUiForChat(chatId, getChatId);
    }, 3000);
    typingTimersByKey.set(timerKey, timeoutId);
    applyTypingUiForChat(chatId, getChatId);
}

function removeTypingSignal(data, getChatId) {
    const chatId = String(data?.chat_id || '').trim();
    if (!chatId) return;
    const entryKey = senderTypingKey(data);
    const map = typingEntriesByChat.get(chatId);
    map?.delete(entryKey);
    pruneTypingState(chatId);
    const timerKey = `${chatId}|${entryKey}`;
    const timerId = typingTimersByKey.get(timerKey);
    if (timerId) clearTimeout(timerId);
    typingTimersByKey.delete(timerKey);
    applyTypingUiForChat(chatId, getChatId);
}

function clearAllTypingState(getChatId) {
    for (const [chatId, map] of typingEntriesByChat) {
        map.clear();
        hideSidebarTyping(chatId);
    }
    typingEntriesByChat.clear();
    for (const timerId of typingTimersByKey.values()) {
        clearTimeout(timerId);
    }
    typingTimersByKey.clear();
    const currentChatId = String(typeof getChatId === 'function' ? getChatId() || '' : '').trim();
    if (currentChatId) hideTyping();
}

export function initPresence({ socket, getChatId, isChatBlocked }) {
    socket.on('partner_typing', (data) => {
        if (isChatBlocked(data.chat_id)) return;
        upsertTypingSignal(data, getChatId);
    });

    socket.on('partner_stop_typing', (data) => {
        if (isChatBlocked(data.chat_id)) return;
        removeTypingSignal(data, getChatId);
    });

    socket.on('disconnect', () => {
        clearAllTypingState(getChatId);
    });

    if (!lastSeenIntervalId) {
        lastSeenIntervalId = setInterval(refreshLastSeenLabel, 60000);
    }
    if (!languageListenerBound) {
        window.addEventListener('sun-ui-language-changed', refreshLastSeenLabel);
        languageListenerBound = true;
    }

    function updateOnlineStatusUI(online, lastSeen) {
        const status = document.getElementById('chatOnlineStatus');
        if (!status) return;
        status.style.display = 'block';
        status.style.visibility = 'visible';
        status.style.opacity = '1';
        status.setAttribute('data-last-seen', lastSeen || '');

        if (isChatBlocked()) {
            status.dataset.state = 'hidden';
            status.textContent = tr('\u0441\u0442\u0430\u0442\u0443\u0441 \u0441\u043A\u0440\u044B\u0442');
            return;
        }

        if (online) {
            status.dataset.state = 'online';
            status.textContent = tr('\u0432 \u0441\u0435\u0442\u0438');
            return;
        }

        status.dataset.state = 'offline';
        status.textContent = makeLastSeenText(lastSeen);
    }

    return {
        updateOnlineStatusUI,
        showTyping,
        hideTyping,
        showSidebarTyping,
        hideSidebarTyping,
    };
}
