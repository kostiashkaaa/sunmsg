import { createChatMutePreferences } from './chat-mute-preferences.js';
import { createChatMuteUiController } from './chat-mute-ui.js';
import { syncProfileMoreMenuChatActions as syncProfileMoreMenuChatActionsFlow } from './chat-profile-menu-actions.js';

export function createChatMuteRuntime({
    storage,
    muteChatStorageKey,
    muteDialogRequestsStorageKey,
    bootstrapMuteDialogRequests = false,
    contactsList,
    muteChatBtn,
    deleteChatBtn,
    profileToggleMuteMenuBtn,
    profileToggleMuteMenuIcon,
    profileToggleMuteMenuLabel,
    profileTogglePinMenuBtn,
    profileTogglePinMenuIcon,
    profileTogglePinMenuLabel,
    profileDeleteChatMenuBtn,
    resolveContactItemByChatId,
    getCurrentChatId,
    canPinMoreChats,
    pinnedChatsLimit,
    showToast,
    documentRef = document,
} = {}) {
    const mutePreferences = createChatMutePreferences({
        storage,
        muteChatStorageKey,
        muteDialogRequestsStorageKey,
        bootstrapMuteDialogRequests,
    });

    function getMutedChatIds() {
        return mutePreferences.getMutedChatIds();
    }

    function getDialogRequestsMutedFromStorage() {
        return mutePreferences.getDialogRequestsMutedFromStorage();
    }

    function isDialogRequestsMuted() {
        return mutePreferences.isDialogRequestsMuted();
    }

    function initializeDialogRequestMutePreference() {
        mutePreferences.initializeDialogRequestMutePreference();
    }

    function setMutedChatIds(ids) {
        mutePreferences.setMutedChatIds(ids);
    }

    function isChatMuted(chatId) {
        return mutePreferences.isChatMuted(chatId);
    }

    const chatMuteUiController = createChatMuteUiController({
        contactsList,
        muteChatBtn,
        resolveContactItemByChatId,
        isChatMuted,
        getMutedChatIds,
        setMutedChatIds,
        getCurrentChatId,
        syncProfileMoreMenuChatActions: () => syncProfileMoreMenuChatActions(),
        showToast,
        doc: documentRef,
    });

    function applyContactMuteState(contactItem, muted) {
        chatMuteUiController.applyContactMuteState(contactItem, muted);
    }

    function syncContactMuteState(chatId) {
        chatMuteUiController.syncContactMuteState(chatId);
    }

    function syncAllContactsMuteState() {
        chatMuteUiController.syncAllContactsMuteState();
    }

    function syncProfileMoreMenuChatActions() {
        const currentChatId = getCurrentChatId();
        const currentItem = currentChatId ? resolveContactItemByChatId(currentChatId) : null;
        const isGroupChat = Boolean(currentItem && currentItem.getAttribute('data-is-group') === '1');
        if (deleteChatBtn) {
            deleteChatBtn.innerHTML = isGroupChat
                ? '<i class="bi bi-box-arrow-right"></i> \u041F\u043E\u043A\u0438\u043D\u0443\u0442\u044C \u0433\u0440\u0443\u043F\u043F\u0443'
                : '<i class="bi bi-trash3"></i> \u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0447\u0430\u0442';
        }
        syncProfileMoreMenuChatActionsFlow({
            currentChatId,
            resolveContactItemByChatId,
            isChatMuted,
            canPinMoreChats,
            pinnedChatsLimit,
            profileToggleMuteMenuBtn,
            profileToggleMuteMenuIcon,
            profileToggleMuteMenuLabel,
            profileTogglePinMenuBtn,
            profileTogglePinMenuIcon,
            profileTogglePinMenuLabel,
            profileDeleteChatMenuBtn,
        });
    }

    function syncMuteButton() {
        chatMuteUiController.syncMuteButton();
    }

    function toggleChatMuted(chatId, options = {}) {
        return chatMuteUiController.toggleChatMuted(chatId, options);
    }

    function toggleCurrentChatMuted(options = {}) {
        return chatMuteUiController.toggleCurrentChatMuted(options);
    }

    return {
        getMutedChatIds,
        getDialogRequestsMutedFromStorage,
        isDialogRequestsMuted,
        initializeDialogRequestMutePreference,
        setMutedChatIds,
        isChatMuted,
        applyContactMuteState,
        syncContactMuteState,
        syncAllContactsMuteState,
        syncProfileMoreMenuChatActions,
        syncMuteButton,
        toggleChatMuted,
        toggleCurrentChatMuted,
    };
}
