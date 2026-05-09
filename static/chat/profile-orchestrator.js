export function createProfileOrchestrator(options = {}) {
    const {
        profileDrawer,
        partnerProfileDrawer,
        profileLayout,
        profileOnlineDot,
        profileMetaUsername,
        profileMetaCreatedAt,
        profileMetaUserId,
        resolveCurrentPartnerIdFlow,
        loadAndShowPartnerProfileFlow,
        renderProfileHeaderFn,
        renderProfileStatsFn,
        renderProfileMetaFn,
        renderPartnerProfileFn,
        handleProfileActionFn,
        isChatBlocked,
        setProfileLoading,
        closeProfileMoreMenu,
        syncMuteButton,
        renderProfileMediaPanel,
        applyChatBlockState,
        normalizeBlockState,
        getCurrentBlockState,
        getCurrentContactPublicKey,
        getCurrentPartnerData,
        setCurrentPartnerData,
        getCurrentPartnerId,
        setCurrentPartnerId,
        getCurrentContactId,
        getHeaderPartnerId,
        getActiveContactId,
        resolveContactItemByChatId,
        getCurrentChatId,
        toggleCurrentChatMuted,
        updateChatPinnedState,
        showDeleteChatDialog,
        closeChatUI,
        loadContacts,
        scheduleComposerFocus,
        copyTextToClipboard,
        showToast,
        sendContactRequest,
        updateBlockButtons,
        bumpProfileLoadToken,
        getProfileLoadToken,
        fetchUserProfile,
        afterRenderPartnerProfile = null,
    } = options;

    function isProfileDrawerOpen() {
        return profileDrawer.isOpen();
    }

    function resolveCurrentPartnerId() {
        return resolveCurrentPartnerIdFlow({
            getCurrentPartnerId,
            getCurrentContactId,
            getHeaderPartnerId,
            getActiveContactId,
            getCurrentPartnerData,
        });
    }

    function openPartnerProfileDrawer() {
        profileDrawer.open();
    }

    function closePartnerProfileDrawer() {
        if (!partnerProfileDrawer) return Promise.resolve(false);
        bumpProfileLoadToken();
        closeProfileMoreMenu();
        const closePromise = profileDrawer.close();
        setProfileLoading(false);
        if (profileLayout) profileLayout.scrollTop = 0;
        return closePromise;
    }

    function renderProfileHeader(profile) {
        renderProfileHeaderFn(profile, {
            isChatBlocked,
            profileOnlineDot,
        });
    }

    function renderProfileStats(statsPayload) {
        renderProfileStatsFn(statsPayload);
    }

    function renderProfileMeta(profile) {
        renderProfileMetaFn(profile, {
            metaUsername: profileMetaUsername,
            metaCreatedAt: profileMetaCreatedAt,
            metaUserId: profileMetaUserId,
            currentPartnerId: getCurrentPartnerId(),
        });
    }

    function renderPartnerProfile(profilePayload) {
        const merged = renderPartnerProfileFn(profilePayload, {
            existingProfile: getCurrentPartnerData() || {},
            currentPartnerId: getCurrentPartnerId(),
            isChatBlocked,
            profileOnlineDot,
            metaUsername: profileMetaUsername,
            metaCreatedAt: profileMetaCreatedAt,
            metaUserId: profileMetaUserId,
        });
        setCurrentPartnerData(merged);
        if (typeof afterRenderPartnerProfile === 'function') {
            afterRenderPartnerProfile(merged);
        }
        updateBlockButtons();
        return merged;
    }

    async function handleProfileAction(action) {
        closeProfileMoreMenu();

        if (action === 'toggle-mute') {
            if (!getCurrentChatId()) {
                showToast('Сначала откройте чат.', 'warning');
                return;
            }
            toggleCurrentChatMuted();
            return;
        }

        if (action === 'toggle-pin') {
            const currentChatId = getCurrentChatId();
            if (!currentChatId) {
                showToast('Сначала откройте чат.', 'warning');
                return;
            }
            const currentItem = resolveContactItemByChatId(currentChatId);
            const isPinned = currentItem?.getAttribute('data-pinned') === '1';
            const updated = await updateChatPinnedState(currentChatId, !isPinned);
            if (updated) {
                showToast(isPinned ? 'Чат откреплён' : 'Чат закреплён', 'success');
            }
            return;
        }

        if (action === 'delete-chat') {
            const currentChatId = getCurrentChatId();
            if (!currentChatId) {
                showToast('Сначала откройте чат.', 'warning');
                return;
            }
            const currentProfile = getCurrentPartnerData() || {};
            showDeleteChatDialog(currentChatId, {
                onDeleted: closeChatUI,
                onReload: loadContacts,
                isGroup: Boolean(currentProfile?._group_profile),
            });
            return;
        }

        await handleProfileActionFn(action, {
            currentProfile: getCurrentPartnerData() || {},
            closeDrawer: closePartnerProfileDrawer,
            isChatBlocked,
            scheduleComposerFocus,
            copyTextToClipboard,
            showToast,
            sendContactRequest,
        });
    }

    function loadAndShowPartnerProfile({ revealProfileDrawerContent }) {
        loadAndShowPartnerProfileFlow({
            resolveCurrentPartnerId,
            setCurrentPartnerId,
            bumpProfileLoadToken,
            getProfileLoadToken,
            setProfileLoading,
            resetProfileScroll: () => {
                if (profileLayout) profileLayout.scrollTop = 0;
            },
            openPartnerProfileDrawer,
            closeProfileMoreMenu,
            syncMuteButton,
            renderProfileMediaPanel,
            fetchUserProfile,
            applyChatBlockState,
            normalizeBlockState,
            getCurrentBlockState,
            getCurrentContactPublicKey,
            getCurrentPartnerData,
            isChatBlocked,
            renderPartnerProfile,
            revealProfileDrawerContent,
            showToast,
        });
    }

    return {
        isProfileDrawerOpen,
        resolveCurrentPartnerId,
        openPartnerProfileDrawer,
        closePartnerProfileDrawer,
        renderProfileHeader,
        renderProfileStats,
        renderProfileMeta,
        renderPartnerProfile,
        handleProfileAction,
        loadAndShowPartnerProfile,
    };
}

