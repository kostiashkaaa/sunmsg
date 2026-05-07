import {
    getStoredString,
    getStoredStringList,
    setStoredStringList,
} from './chat-shell-ui.js';

export function createChatMutePreferences({
    storage = null,
    muteChatStorageKey = 'sun_chat_muted_v1',
    muteDialogRequestsStorageKey = 'sun_mute_dialog_requests_v1',
    bootstrapMuteDialogRequests = false,
} = {}) {
    const localStorageRef = storage || window.localStorage;

    function getMutedChatIds() {
        return getStoredStringList(muteChatStorageKey, localStorageRef);
    }

    function setMutedChatIds(ids) {
        setStoredStringList(muteChatStorageKey, ids, localStorageRef);
    }

    function isChatMuted(chatId) {
        if (!chatId) return false;
        return getMutedChatIds().includes(String(chatId));
    }

    function getDialogRequestsMutedFromStorage() {
        const raw = String(getStoredString(muteDialogRequestsStorageKey, localStorageRef) || '').trim();
        if (raw === '1' || raw.toLowerCase() === 'true') return true;
        if (raw === '0' || raw.toLowerCase() === 'false') return false;
        return null;
    }

    function isDialogRequestsMuted() {
        const fromStorage = getDialogRequestsMutedFromStorage();
        if (typeof fromStorage === 'boolean') return fromStorage;
        return Boolean(bootstrapMuteDialogRequests);
    }

    function initializeDialogRequestMutePreference() {
        const fromStorage = getDialogRequestsMutedFromStorage();
        if (typeof fromStorage === 'boolean') return;
        try {
            localStorageRef.setItem(
                muteDialogRequestsStorageKey,
                bootstrapMuteDialogRequests ? '1' : '0',
            );
        } catch (_) {}
    }

    return {
        getMutedChatIds,
        setMutedChatIds,
        isChatMuted,
        getDialogRequestsMutedFromStorage,
        isDialogRequestsMuted,
        initializeDialogRequestMutePreference,
    };
}
