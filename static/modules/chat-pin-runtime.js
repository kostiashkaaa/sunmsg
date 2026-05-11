import {
    applyPinnedState,
    sortContactsList as sortContactsListFlow,
    updatePinIcon as updatePinIconFlow,
} from './pinned-contacts.js';

export function createChatPinRuntime({
    contactsList,
    resolveContactItemByChatId,
    getPinnedContactsCount,
    syncProfileMoreMenuChatActions,
    canPinMoreChats,
    pinnedChatsLimit,
    showToast,
    withAppRoot,
    getCsrfToken,
    fetchImpl = fetch,
} = {}) {
    function sortContactsList() {
        sortContactsListFlow(contactsList);
    }

    function applyPinnedStateForChat(chatId, { isPinned, pinOrder } = {}) {
        const item = resolveContactItemByChatId(chatId);
        if (item) {
            applyPinnedState(item, {
                isPinned,
                pinOrder,
                pinnedCount: getPinnedContactsCount(),
            });
        }
        sortContactsList();
        syncProfileMoreMenuChatActions();
    }

    async function updateChatPinnedState(chatId, isPinned) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return false;
        if (isPinned && !canPinMoreChats(normalizedChatId)) {
            showToast(`\u041C\u043E\u0436\u043D\u043E \u0437\u0430\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u043D\u0435 \u0431\u043E\u043B\u0435\u0435 ${pinnedChatsLimit} \u0447\u0430\u0442\u043E\u0432.`, 'warning');
            return false;
        }
        try {
            const response = await fetchImpl(withAppRoot(isPinned ? '/pin_chat' : '/unpin_chat'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
                body: JSON.stringify({ chat_id: normalizedChatId }),
            });
            const payload = await response.json();
            if (!payload?.success) {
                showToast(payload?.error || (isPinned ? '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u0447\u0430\u0442' : '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u0447\u0430\u0442'), 'danger');
                return false;
            }
            applyPinnedStateForChat(normalizedChatId, {
                isPinned,
                pinOrder: payload?.pin_order,
            });
            return true;
        } catch (_) {
            showToast(isPinned ? '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u0447\u0430\u0442' : '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0442\u043A\u0440\u0435\u043F\u0438\u0442\u044C \u0447\u0430\u0442', 'danger');
            return false;
        }
    }

    function updatePinIcon(chatId, isPinned) {
        updatePinIconFlow(chatId, isPinned);
    }

    return {
        applyPinnedStateForChat,
        updateChatPinnedState,
        updatePinIcon,
        sortContactsList,
    };
}
