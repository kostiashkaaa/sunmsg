// presence.js - typing indicators and online status display

const sidebarTypingSnapshotByChat = {};
const typingEntriesByChat = new Map();
const typingTimersByKey = new Map();
let lastSeenIntervalId = 0;
let languageListenerBound = false;

function tr(value) {
    const api = window.SUN_I18N;
    if (api && typeof api.translateText === 'function') {
        return api.translateText(value);
    }
    return String(value ?? '');
}

function activeLocale() {
    const api = window.SUN_I18N;
    const language = api && typeof api.getLanguage === 'function'
        ? api.getLanguage()
        : (document.documentElement.lang || 'ru');
    return String(language || '').toLowerCase() === 'en' ? 'en-US' : 'ru-RU';
}

function sanitizeTypingLabel(value) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, 64);
}

function escapeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
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
    const item = document.querySelector(`.contact-item[data-chat-id="${key}"]`);
    return String(item?.getAttribute('data-is-group') || '') === '1';
}

function buildTypingPhrase(entries, { includeNames = true } = {}) {
    const list = Array.isArray(entries) ? entries : [];
    if (!list.length) return '';
    const hasVoiceRecording = list.some((entry) => String(entry?.typing_kind || 'text') === 'voice');
    const singleAction = hasVoiceRecording ? tr('\u0437\u0430\u043F\u0438\u0441\u044B\u0432\u0430\u0435\u0442 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0435') : tr('\u043F\u0435\u0447\u0430\u0442\u0430\u0435\u0442');
    const pluralAction = hasVoiceRecording ? tr('\u0437\u0430\u043F\u0438\u0441\u044B\u0432\u0430\u044E\u0442 \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u044B\u0435') : tr('\u043F\u0435\u0447\u0430\u0442\u0430\u044E\u0442');
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

function renderTypingText(text) {
    const typingIndicator = document.getElementById('typingIndicator');
    if (!typingIndicator) return;
    const label = escapeHtml(sanitizeTypingLabel(text));
    typingIndicator.innerHTML = `
        <span class="typing-indicator-inline">
            <span class="typing-indicator-label">${label}</span>
            <span class="typing-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
        </span>
    `;
}

function showTyping(text) {
    const typingIndicator = document.getElementById('typingIndicator');
    const chatOnlineStatus = document.getElementById('chatOnlineStatus');
    if (chatOnlineStatus) chatOnlineStatus.style.display = 'none';
    if (typingIndicator) {
        if (text) renderTypingText(text);
        typingIndicator.style.display = 'block';
    }
}

function hideTyping() {
    const typingIndicator = document.getElementById('typingIndicator');
    const chatOnlineStatus = document.getElementById('chatOnlineStatus');
    if (typingIndicator) typingIndicator.style.display = 'none';
    if (chatOnlineStatus) chatOnlineStatus.style.display = 'block';
}

function showSidebarTyping(chatId, text) {
    const item = document.querySelector(`.contact-item[data-chat-id="${chatId}"]`);
    if (!item) return;
    const lastMessage = item.querySelector('.contact-last-msg');
    if (!lastMessage) return;
    if (!Object.prototype.hasOwnProperty.call(sidebarTypingSnapshotByChat, chatId)) {
        sidebarTypingSnapshotByChat[chatId] = lastMessage.innerHTML;
    }
    const typingLabel = escapeHtml(sanitizeTypingLabel(text || tr('\u043F\u0435\u0447\u0430\u0442\u0430\u0435\u0442')));
    lastMessage.innerHTML = `<span class="typing-indicator-inline" data-typing-indicator="1"><span class="typing-indicator-label">${typingLabel}</span><span class="typing-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span></span>`;
}

function hideSidebarTyping(chatId) {
    const item = document.querySelector(`.contact-item[data-chat-id="${chatId}"]`);
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
    const phrase = buildTypingPhrase(entries, { includeNames: isGroupChatById(key) });
    showSidebarTyping(key, phrase);
    if (String(getChatId() || '') === key) showTyping(phrase);
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
        typing_kind: String(data?.typing_kind || 'text').trim().toLowerCase() === 'voice' ? 'voice' : 'text',
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

export function initPresence({ socket, getChatId, isChatBlocked }) {
    socket.on('partner_typing', (data) => {
        if (isChatBlocked(data.chat_id)) return;
        upsertTypingSignal(data, getChatId);
    });

    socket.on('partner_stop_typing', (data) => {
        if (isChatBlocked(data.chat_id)) return;
        removeTypingSignal(data, getChatId);
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
