function normalizeString(value) {
    return String(value || '').trim();
}

export function syncCurrentUserIdentityLegacyGlobals({
    bootstrapUser,
    currentDisplayName,
    currentUsername,
    currentAvatarUrl,
}) {
    const displayName = normalizeString(currentDisplayName);
    const username = normalizeString(currentUsername);
    const avatarUrl = normalizeString(currentAvatarUrl);

    if (bootstrapUser && typeof bootstrapUser === 'object') {
        bootstrapUser.currentDisplayName = displayName;
        bootstrapUser.currentUsername = username;
        bootstrapUser.currentAvatarUrl = avatarUrl;
    }

    window.currentDisplayName = displayName;
    window.currentUsername = username;
    window.currentAvatarUrl = avatarUrl;
}

export function setCurrentPartnerLegacyGlobals({
    isGroupChat,
    currentChatId,
    contactId,
    contactUsername,
    displayName,
    currentContactPublicKey,
    contactBlockState,
    normalizeBlockState,
    membersCount,
}) {
    const partnerId = isGroupChat ? String(currentChatId || '') : String(contactId || '');
    const parsedUserId = contactId ? Number(contactId) : null;
    const normalizedMembersCount = isGroupChat ? Math.max(0, Number(membersCount) || 0) : 0;
    const partnerData = {
        userId: Number.isFinite(parsedUserId) ? parsedUserId : null,
        display_name: normalizeString(displayName),
        username: normalizeString(contactUsername),
        public_key: normalizeString(currentContactPublicKey),
        block_state: typeof normalizeBlockState === 'function'
            ? normalizeBlockState(contactBlockState)
            : contactBlockState,
        chat_id: String(currentChatId || ''),
        _group_profile: Boolean(isGroupChat),
        members_count: normalizedMembersCount,
    };

    window.currentPartnerId = partnerId;
    window.currentPartnerData = partnerData;
    return { partnerId, partnerData };
}

export function createChatLegacyGlobalAccessors(windowRef = window) {
    const getCurrentPartnerData = () => windowRef.currentPartnerData;
    const setCurrentPartnerData = (value) => {
        windowRef.currentPartnerData = value;
        return value;
    };
    const getCurrentPartnerId = () => windowRef.currentPartnerId;
    const setCurrentPartnerId = (value) => {
        windowRef.currentPartnerId = value;
        return value;
    };
    const getCurrentContactPublicKey = () => windowRef.currentContactPublicKey;
    const setCurrentContactPublicKey = (value) => {
        windowRef.currentContactPublicKey = value;
        return value;
    };
    const getCurrentPartnerDisplayName = (fallback = '\u0421\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A') => (
        getCurrentPartnerData()?.display_name || fallback
    );
    const isCurrentPartnerSavedMessagesProfile = () => Boolean(getCurrentPartnerData()?._saved_messages_profile);
    const isCurrentPartnerGroupProfile = () => Boolean(getCurrentPartnerData()?._group_profile);
    const syncCurrentPartnerMembersCount = (membersCount) => {
        const normalizedMembersCount = Math.max(0, Number(membersCount) || 0);
        const partnerData = getCurrentPartnerData();
        if (partnerData && Number(partnerData.members_count) !== normalizedMembersCount) {
            partnerData.members_count = normalizedMembersCount;
        }
        return normalizedMembersCount;
    };
    const clearCurrentPartnerSession = () => {
        setCurrentContactPublicKey(null);
        setCurrentPartnerId(null);
    };

    return {
        getCurrentPartnerData,
        setCurrentPartnerData,
        getCurrentPartnerId,
        setCurrentPartnerId,
        getCurrentContactPublicKey,
        setCurrentContactPublicKey,
        getCurrentPartnerDisplayName,
        isCurrentPartnerSavedMessagesProfile,
        isCurrentPartnerGroupProfile,
        syncCurrentPartnerMembersCount,
        clearCurrentPartnerSession,
    };
}

export function exposeChatRuntimeLegacyGlobals({
    activateFocusTrap,
    deactivateFocusTrap,
    syncSidebarStatusBar,
    openCommandPaletteModal,
    scrollToMessage,
    startEditMessage,
    showContextMenu,
    toggleSelectionMode,
    refreshPrivateKeyDependentUi,
}) {
    if (typeof activateFocusTrap === 'function') {
        window._activateFocusTrap = activateFocusTrap;
    }
    if (typeof deactivateFocusTrap === 'function') {
        window._deactivateFocusTrap = deactivateFocusTrap;
    }
    if (typeof syncSidebarStatusBar === 'function') {
        window.syncSidebarStatusBar = syncSidebarStatusBar;
    }
    if (typeof openCommandPaletteModal === 'function' && typeof window.openCommandPalette !== 'function') {
        window.openCommandPalette = openCommandPaletteModal;
    }
    if (typeof scrollToMessage === 'function') {
        window._scrollToMsg = function(msgId, options = {}) {
            return scrollToMessage(msgId, options);
        };
    }
    if (typeof startEditMessage === 'function') {
        window.startEditMessage = startEditMessage;
    }
    if (typeof showContextMenu === 'function') {
        window.showContextMenu = showContextMenu;
    }
    if (typeof toggleSelectionMode === 'function') {
        window.toggleSelectionMode = toggleSelectionMode;
    }
    if (typeof refreshPrivateKeyDependentUi === 'function') {
        window._redecryptCurrentChat = refreshPrivateKeyDependentUi;
    }
}
