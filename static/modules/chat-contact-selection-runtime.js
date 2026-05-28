export function bindChatContactSelectionRuntime({
    windowRef = window,
    documentRef = document,
    consoleRef = console,
    contactsList = null,
    messageInput = null,
    chatArea = null,
    chatTitle = null,
    chatHeader = null,
    chatPartnerHeaderLink = null,
    partnerProfileDrawer = null,
    closeCommandPalette = () => {},
    setActiveContactItem = () => {},
    flushDraftSaveForChat = () => {},
    saveChatScrollPosition = () => {},
    abortHistoryRequestsForChat = () => {},
    prefersReducedMotionSetting = () => false,
    isMobileViewport = () => false,
    closeReactionPicker = () => {},
    isVoiceRecordingActive = () => false,
    stopVoiceRecording = () => Promise.resolve(),
    captureChatDomSnapshot = () => {},
    getCurrentChatId = () => null,
    setCurrentChatId = () => {},
    setCurrentContactId = () => {},
    hideTyping = () => {},
    syncDraftPreviewForContact = () => {},
    tabAlertController = null,
    persistLastActiveChatId = () => {},
    syncBrowserUrlForActiveChat = () => {},
    setCurrentContactPublicKey = () => {},
    getCurrentContactPublicKey = () => '',
    escapeHtml = (value) => String(value ?? ''),
    applyFallbackAvatarTint = () => {},
    updateE2EIndicator = () => {},
    applyChatBlockState = () => {},
    getChatState = () => null,
    savedMessagesUi = null,
    prefillComposerDraftFromContactItem = () => {},
    loadDraftForChat = () => {},
    syncForwardDraftBarForCurrentChat = () => {},
    resetOpenChatUnreadCounter = () => {},
    closeMessageActionsBar = () => {},
    isEditingMessage = () => false,
    cancelEdit = () => {},
    isSelectionMode = () => false,
    toggleSelectionMode = () => {},
    showChatContent = () => {},
    scheduleComposerFocus = () => {},
    setCurrentPartnerLegacyGlobals = () => ({}),
    normalizeBlockState = (state) => state,
    onlineStatusController = null,
    getCurrentPartnerData = () => null,
    formatGroupMembersCountLabel = (value) => String(value ?? ''),
    loadOnlineStatus = () => {},
    fetchChatHistory = () => Promise.resolve(),
    showToast = () => {},
    loadAndShowPartnerProfile = () => {},
    emitSocket = () => {},
    isChatBlocked = () => false,
    joinChatRoom = () => {},
    openChat = () => {},
    onInitialChatRestoreStart = () => {},
    onInitialChatRestoreSettled = () => {},
    restoreLastActiveChatSelection = () => false,
    isInitialChatRestoreDeferred = () => false,
    isE2eActivationLocked = () => false,
    requestE2eActivation = () => {},
    getHasAttemptedInitialChatRestore = () => false,
    setHasAttemptedInitialChatRestore = () => {},
} = {}) {
    if (!contactsList) return;

    function scrollContactIntoViewIfClipped(contactItem) {
        const scrollParent = contactItem?.closest?.('#sidebarScrollArea');
        if (!scrollParent) return;

        const itemRect = contactItem.getBoundingClientRect();
        const parentRect = scrollParent.getBoundingClientRect();
        const topDelta = itemRect.top - parentRect.top;
        const bottomDelta = itemRect.bottom - parentRect.bottom;
        const tolerancePx = 1;

        if (topDelta < -tolerancePx) {
            scrollParent.scrollTop += topDelta;
        } else if (bottomDelta > tolerancePx) {
            scrollParent.scrollTop += bottomDelta;
        }
    }

    function isSelectableContactItem(contactItem) {
        return Boolean(
            contactItem
            && contactsList.contains(contactItem)
            && contactItem.matches('.contact-item[data-chat-id]')
            && String(contactItem.getAttribute('data-request-kind') || '') !== 'dialog',
        );
    }

    function getVisibleContactItems() {
        return Array.from(contactsList.querySelectorAll('.contact-item[data-chat-id]'))
            .filter((item) => isSelectableContactItem(item))
            .filter((item) => !item.hidden && item.style.display !== 'none' && item.getAttribute('aria-hidden') !== 'true');
    }

    function setContactFocus(contactItem) {
        if (!isSelectableContactItem(contactItem)) return;
        const items = getVisibleContactItems();
        items.forEach((item) => {
            item.tabIndex = item === contactItem ? 0 : -1;
        });
        try {
            contactItem.focus({ preventScroll: true });
        } catch (_) {
            contactItem.focus?.();
        }
        scrollContactIntoViewIfClipped(contactItem);
    }

    function moveContactFocus(currentItem, direction) {
        const items = getVisibleContactItems();
        if (!items.length) return;
        const currentIndex = Math.max(0, items.indexOf(currentItem));
        let nextIndex = currentIndex;
        if (direction === 'first') {
            nextIndex = 0;
        } else if (direction === 'last') {
            nextIndex = items.length - 1;
        } else {
            nextIndex = (currentIndex + direction + items.length) % items.length;
        }
        setContactFocus(items[nextIndex]);
    }

    function activateContactItem(contactItem, event = null) {
        if (!isSelectableContactItem(contactItem)) return;
        if (isE2eActivationLocked()) {
            event?.preventDefault?.();
            event?.stopPropagation?.();
            requestE2eActivation();
            return;
        }

        const isInitialRestoreActivation = contactItem.dataset?.chatInitialRestore === '1';
        if (isInitialRestoreActivation) {
            onInitialChatRestoreStart();
        }

        closeCommandPalette();
        setActiveContactItem(contactItem);
        scrollContactIntoViewIfClipped(contactItem);

        const previousChatId = getCurrentChatId();
        const previousDraftValue = String(messageInput?.value || '');
        const nextChatId = contactItem.getAttribute('data-chat-id');
        if (previousChatId && String(previousChatId) !== String(nextChatId)) {
            void flushDraftSaveForChat(previousChatId, previousDraftValue, { force: true });
        }
        if (previousChatId) saveChatScrollPosition(previousChatId);
        if (previousChatId && String(previousChatId) !== String(nextChatId)) {
            abortHistoryRequestsForChat(previousChatId);
            const reduceMotion = prefersReducedMotionSetting();
            const useDesktopSwitchMotion = !isMobileViewport() && !reduceMotion;
            if (chatArea && useDesktopSwitchMotion) {
                chatArea.classList.remove('is-switching');
            }
        }
        closeReactionPicker();
        if (isVoiceRecordingActive()) {
            stopVoiceRecording({ reason: 'cancel' }).catch(() => {});
        }

        if (previousChatId && String(previousChatId) !== String(nextChatId)) {
            captureChatDomSnapshot(previousChatId);
        }

        setCurrentChatId(nextChatId);
        const nextContactId = contactItem.getAttribute('data-contact-id');
        setCurrentContactId(nextContactId);
        const isGroupChat = String(contactItem.getAttribute('data-is-group') || '') === '1';
        chatArea?.classList.toggle('is-group-chat', isGroupChat);
        const isSwitchingChat = String(previousChatId || '') !== String(nextChatId || '');
        if (isSwitchingChat) {
            hideTyping();
        }
        if (isSwitchingChat && previousChatId) {
            syncDraftPreviewForContact(previousChatId, previousDraftValue, new Date().toISOString());
        }
        tabAlertController.clearAlertForChat(nextChatId);
        persistLastActiveChatId(nextChatId);
        syncBrowserUrlForActiveChat(contactItem);
        setCurrentContactPublicKey(contactItem.getAttribute('data-public-key'));
        const contactBlockState = {
            blocked_by_me: contactItem.getAttribute('data-blocked-by-me') === '1',
            blocked_me: contactItem.getAttribute('data-blocked-me') === '1',
        };

        const nameEl = contactItem.querySelector('.contact-name');
        const nameText = nameEl ? nameEl.textContent : '';
        chatTitle.textContent = nameText;

        const partnerAvatar = documentRef.getElementById('chatPartnerAvatar');
        if (partnerAvatar) {
            const avatarEl = contactItem.querySelector('.contact-avatar');
            if (avatarEl) {
                const img = avatarEl.querySelector('img');
                if (img) {
                    partnerAvatar.removeAttribute('data-avatar-tint');
                    partnerAvatar.innerHTML = `<img class="contact-avatar__img" src="${escapeHtml(img.getAttribute('src'))}" alt="\u0410\u0432\u0430\u0442\u0430\u0440 \u0441\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A\u0430">`;
                } else {
                    partnerAvatar.textContent = avatarEl.firstChild.textContent.trim();
                    const sourceTint = String(avatarEl.getAttribute('data-avatar-tint') || '').trim();
                    if (sourceTint) {
                        partnerAvatar.setAttribute('data-avatar-tint', sourceTint);
                    } else {
                        applyFallbackAvatarTint(partnerAvatar, nameText);
                    }
                }
            }
            partnerAvatar.style.display = 'flex';
        }

        updateE2EIndicator();
        applyChatBlockState(contactBlockState, { syncChatRoom: false });
        getChatState(nextChatId);
        const isSavedMessagesChat = savedMessagesUi.applyChatMode({
            contactItem,
            chatId: nextChatId,
        });
        if (isSwitchingChat) {
            prefillComposerDraftFromContactItem(contactItem);
            void loadDraftForChat(nextChatId, { fallbackContactItem: contactItem });
        }
        syncForwardDraftBarForCurrentChat();
        resetOpenChatUnreadCounter();
        closeMessageActionsBar();
        if (isEditingMessage()) {
            cancelEdit();
        }
        if (isSelectionMode()) {
            toggleSelectionMode(false);
        }
        showChatContent(true, { renderInitializedChat: false });
        if (windowRef.innerWidth > 768) {
            scheduleComposerFocus({ force: true });
        }

        const contactId = contactItem.getAttribute('data-contact-id');
        const membersCount = Math.max(0, Number(contactItem.getAttribute('data-members-count') || 0) || 0);
        const { partnerId } = setCurrentPartnerLegacyGlobals({
            isGroupChat,
            currentChatId: nextChatId,
            contactId,
            contactUsername: contactItem.getAttribute('data-contact-username'),
            displayName: nameText,
            currentContactPublicKey: getCurrentContactPublicKey(),
            contactBlockState,
            normalizeBlockState,
            membersCount,
        });
        chatPartnerHeaderLink?.setAttribute('data-partner-id', contactId || partnerId);
        chatHeader?.setAttribute('data-partner-id', contactId || partnerId);
        if (isSavedMessagesChat) {
            onlineStatusController.reset({ loading: false });
            savedMessagesUi.syncCurrentChatMeta({
                chatId: nextChatId,
                contactId: nextContactId,
            });
        } else if (isGroupChat) {
            onlineStatusController.reset({ loading: false });
            const onlineStatusEl = documentRef.getElementById('chatOnlineStatus');
            if (onlineStatusEl) {
                const knownMembersCount = Number(getCurrentPartnerData()?.members_count || 0);
                onlineStatusEl.textContent = formatGroupMembersCountLabel(knownMembersCount);
                onlineStatusEl.classList.remove('chat-online-status--hidden');
                onlineStatusEl.style.display = 'block';
                onlineStatusEl.setAttribute('data-last-seen', '');
                onlineStatusEl.dataset.state = 'group';
            }
        } else {
            onlineStatusController.reset({ loading: true });
            loadOnlineStatus(contactId);
        }

        const historyLoad = fetchChatHistory(nextChatId).catch((error) => {
            consoleRef.error('Failed to fetch chat history:', error);
            showToast('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u0447\u0430\u0442\u0430.', 'danger');
        });
        if (isInitialRestoreActivation) {
            historyLoad.finally(() => {
                onInitialChatRestoreSettled();
            });
        }

        if (partnerProfileDrawer && partnerProfileDrawer.classList.contains('active')) {
            loadAndShowPartnerProfile();
        }

        if (previousChatId !== nextChatId) {
            if (previousChatId) emitSocket('leave', { chat_id: previousChatId });
            if (!isChatBlocked()) {
                joinChatRoom(nextChatId);
            }
        }

        if (!isChatBlocked()) {
            emitSocket('messages_seen', { chat_id: nextChatId });
        }

        if (isMobileViewport()) {
            openChat({ animated: !isInitialRestoreActivation });
        }

        documentRef.dispatchEvent(new CustomEvent('sun:chat:opened', {
            detail: { chatId: nextChatId, chatType: isGroupChat || isSavedMessagesChat ? 'group' : 'direct' },
        }));
    }

    contactsList.addEventListener('click', (event) => {
        const contactItem = event.target.closest('.contact-item');
        activateContactItem(contactItem, event);
    });

    contactsList.addEventListener('keydown', (event) => {
        const contactItem = event.target.closest('.contact-item');
        if (!isSelectableContactItem(contactItem)) return;

        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activateContactItem(contactItem, event);
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            moveContactFocus(contactItem, 1);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            moveContactFocus(contactItem, -1);
        } else if (event.key === 'Home') {
            event.preventDefault();
            moveContactFocus(contactItem, 'first');
        } else if (event.key === 'End') {
            event.preventDefault();
            moveContactFocus(contactItem, 'last');
        }
    });

    if (!getHasAttemptedInitialChatRestore() && !isInitialChatRestoreDeferred()) {
        setHasAttemptedInitialChatRestore(restoreLastActiveChatSelection());
    }
}
