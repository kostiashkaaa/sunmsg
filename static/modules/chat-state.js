// Chat and message state management — per-chat state store

export const CHAT_DEFAULT_MESSAGE_HEIGHT = 88;

const chatStates = new Map();

export function createChatState() {
    return {
        initialized: false,
        isLoadingInitial: false,
        isLoadingOlder: false,
        historyRequestToken: 0,
        historyOlderToken: 0,
        messages: [],
        hasMoreBefore: true,
        savedScrollTop: 0,
        blockState: { is_blocked: false, blocked_by_me: false, blocked_me: false },
        lastRenderRange: null,
        messageHeights: new Map(),
        averageMessageHeight: CHAT_DEFAULT_MESSAGE_HEIGHT,
        renderedKeys: new Set(),
    };
}

export function getChatState(chatId) {
    const key = String(chatId || '');
    if (!chatStates.has(key)) {
        chatStates.set(key, createChatState());
    }
    return chatStates.get(key);
}

export function getMessageKey(msg) {
    if (msg?.id) return `id:${msg.id}`;
    if (msg?.clientId) return `client:${msg.clientId}`;
    return `temp:${msg?.created_at || ''}:${msg?.message || ''}`;
}

export function findMessageIndex(state, predicate) {
    if (!state || typeof predicate !== 'function') return -1;
    for (let i = 0; i < state.messages.length; i += 1) {
        if (predicate(state.messages[i], i)) return i;
    }
    return -1;
}

export function findMessageById(chatId, msgId) {
    const state = getChatState(chatId);
    const index = findMessageIndex(state, (msg) => Number(msg.id) === Number(msgId));
    return index >= 0 ? state.messages[index] : null;
}

export function compareChatMessages(left, right) {
    const leftTs = _getMessageTimestamp(left);
    const rightTs = _getMessageTimestamp(right);
    if (leftTs !== rightTs) return leftTs - rightTs;

    const leftId = Number(left?.id);
    const rightId = Number(right?.id);
    const leftHasId = Number.isFinite(leftId) && leftId > 0;
    const rightHasId = Number.isFinite(rightId) && rightId > 0;
    if (leftHasId && rightHasId && leftId !== rightId) return leftId - rightId;
    if (leftHasId && !rightHasId) return -1;
    if (!leftHasId && rightHasId) return 1;
    return 0;
}

function _getMessageTimestamp(msg) {
    const createdAt = _parseUtcDate(msg?.created_at);
    if (createdAt) return createdAt.getTime();
    if (msg?.pending) return Number.MAX_SAFE_INTEGER - 1;
    return Number.MAX_SAFE_INTEGER;
}

function _parseUtcDate(rawValue) {
    if (!rawValue) return null;
    const s = String(rawValue).replace(' ', 'T');
    const d = new Date(/Z$/i.test(s) ? s : s + 'Z');
    return Number.isFinite(d.getTime()) ? d : null;
}

export function normalizeChatMessageOrder(state) {
    if (!state?.messages?.length) return;
    state.messages = state.messages
        .map((msg, index) => ({ msg, index }))
        .sort((a, b) => {
            const byMessage = compareChatMessages(a.msg, b.msg);
            if (byMessage !== 0) return byMessage;
            return a.index - b.index;
        })
        .map((entry) => entry.msg);
}

export function upsertChatMessage(chatId, message, { append = true } = {}) {
    const state = getChatState(chatId);
    const key = getMessageKey(message);
    const existingIndex = findMessageIndex(
        state,
        (item) => getMessageKey(item) === key || (message.id && Number(item.id) === Number(message.id))
    );
    if (existingIndex >= 0) {
        state.messages[existingIndex] = { ...state.messages[existingIndex], ...message };
        normalizeChatMessageOrder(state);
        return state.messages[existingIndex];
    }
    if (append) {
        state.messages.push(message);
    } else {
        state.messages.unshift(message);
    }
    normalizeChatMessageOrder(state);
    return message;
}

export function prependChatMessages(chatId, messages) {
    const state = getChatState(chatId);
    const incoming = Array.isArray(messages) ? messages : [];
    const deduped = incoming.filter(
        (msg) =>
            findMessageIndex(
                state,
                (item) =>
                    getMessageKey(item) === getMessageKey(msg) ||
                    (msg.id && Number(item.id) === Number(msg.id))
            ) === -1
    );
    if (!deduped.length) return 0;
    state.messages = [...deduped, ...state.messages];
    normalizeChatMessageOrder(state);
    return deduped.length;
}

export function removeChatMessages(chatId, msgIds, { onRemoved } = {}) {
    const ids = new Set(
        (Array.isArray(msgIds) ? msgIds : [msgIds])
            .map((id) => Number(id))
            .filter((id) => Number.isFinite(id) && id > 0)
    );
    if (!ids.size) return;
    const state = getChatState(chatId);
    state.messages = state.messages.filter((msg) => !ids.has(Number(msg.id)));
    if (typeof onRemoved === 'function') ids.forEach((id) => onRemoved(id));
}

export function setChatMessages(chatId, messages, { resetHeights = false } = {}) {
    const state = getChatState(chatId);
    state.messages = Array.isArray(messages) ? [...messages] : [];
    normalizeChatMessageOrder(state);
    if (resetHeights) {
        state.messageHeights = new Map();
        state.averageMessageHeight = CHAT_DEFAULT_MESSAGE_HEIGHT;
        state.renderedKeys = new Set();
    }
    state.lastRenderRange = null;
}

export function estimateMessageHeight(state, msg) {
    const cached = state.messageHeights.get(getMessageKey(msg));
    if (Number.isFinite(cached) && cached > 0) return cached;
    return state.averageMessageHeight || CHAT_DEFAULT_MESSAGE_HEIGHT;
}
