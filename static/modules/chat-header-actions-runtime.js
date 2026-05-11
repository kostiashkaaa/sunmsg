import { initContactContextMenu } from './chat-overlays.js';
import { initPinnedContactsDnD } from './pinned-contacts.js';
import { handleProfileHeaderOpen as handleProfileHeaderOpenFlow } from './chat-profile-open.js';

export function bindChatHeaderActionsRuntime({
    documentRef = document,
    windowRef = window,
    contactsList,
    deleteChatBtn,
    headerSearchCalendarBtn,
    reportUserMenuBtn,
    chatHeader,
    chatPartnerHeaderLink,
    headerDropdown,
    profileMoreMenu,
    pinnedChatsLimit,
    getCurrentChatId,
    getCurrentDisplayName,
    getCurrentUsername,
    getChatState,
    isCurrentChatGroup,
    closeHeaderDropdown,
    toggleHeaderDropdown,
    clearLocalChatDataAfterDeletion,
    loadContacts,
    getCsrfToken,
    showToast,
    showDeleteChatDialog,
    isChatMuted,
    toggleChatMuted,
    getPinnedContactsCount,
    applyPinnedStateForChat,
    dateNavigatorOpen,
    isSelectionMode,
    toggleSelectionMode,
    handleProfileAction,
    loadOlderMessages,
    formatTime,
    resolveCurrentPartnerId,
    setCurrentPartnerId,
    isProfileDrawerOpen,
    loadAndShowPartnerProfile,
    closeProfileMoreMenu,
} = {}) {
    deleteChatBtn?.addEventListener('click', (event) => {
        event.stopPropagation();
        closeHeaderDropdown?.();
        const targetChatId = String(getCurrentChatId?.() || '').trim();
        if (!targetChatId) return;
        showDeleteChatDialog?.(targetChatId, {
            onDeleted: () => clearLocalChatDataAfterDeletion?.(targetChatId),
            onReload: loadContacts,
            isGroup: Boolean(isCurrentChatGroup?.()),
        });
    });

    initContactContextMenu({
        contactsList,
        menuEl: documentRef.getElementById('contactContextMenu'),
        pinButtonEl: documentRef.getElementById('ctxPinChat'),
        unpinButtonEl: documentRef.getElementById('ctxUnpinChat'),
        toggleMuteButtonEl: documentRef.getElementById('ctxToggleMuteChat'),
        deleteButtonEl: documentRef.getElementById('ctxDeleteChat'),
        getCsrfToken,
        showToast,
        showDeleteChatDialog,
        onDeleteChat: (deletedChatId) => clearLocalChatDataAfterDeletion?.(deletedChatId),
        onReloadChats: loadContacts,
        isChatMuted,
        onToggleMute: ({ chatId }) => {
            toggleChatMuted?.(chatId);
        },
        maxPinnedCount: pinnedChatsLimit,
        getPinnedCount: getPinnedContactsCount,
        onPinStateChange: ({ chatId, isPinned, pinOrder }) => {
            applyPinnedStateForChat?.(chatId, { isPinned, pinOrder });
        },
    });

    initPinnedContactsDnD({
        contactsList,
        getCsrfToken,
    });

    documentRef.getElementById('headerMoreBtn')?.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleHeaderDropdown?.();
    });

    documentRef.getElementById('searchChatMenuBtn')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeHeaderDropdown?.();
        documentRef.getElementById('searchChatBtn')?.click();
    });

    headerSearchCalendarBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!getCurrentChatId?.()) return;
        dateNavigatorOpen?.('');
    });

    documentRef.getElementById('selectMessagesMenuBtn')?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        closeHeaderDropdown?.();
        if (!isSelectionMode?.()) {
            toggleSelectionMode?.(true);
        }
    });

    documentRef.getElementById('exportChatBtn')?.addEventListener('click', async () => {
        closeHeaderDropdown?.();
        await exportChatHistory();
    });

    reportUserMenuBtn?.addEventListener('click', () => {
        closeHeaderDropdown?.();
        void handleProfileAction?.('report-user');
    });

    documentRef.addEventListener('sun-close-header-dropdown', () => closeHeaderDropdown?.());
    documentRef.addEventListener('click', (event) => {
        if (headerDropdown && !event.target.closest('.header-more-actions')) {
            closeHeaderDropdown?.();
        }
        if (profileMoreMenu && !event.target.closest('.profile-topbar-more')) {
            closeProfileMoreMenu?.();
        }
    });

    const profileOpenIgnoreSelector = [
        '#backBtnMobile',
        '#pinnedBar',
        '.pinned-bar',
        '.btn-icon',
        '.header-more-actions',
        '.header-dropdown',
        '.dropdown-item',
        '.header-search-wrap',
        '.header-selection-wrap',
        'input',
        'textarea',
        'button',
        'a',
    ].join(', ');

    function handleProfileHeaderOpen(event) {
        handleProfileHeaderOpenFlow({
            event,
            resolveCurrentPartnerId,
            profileOpenIgnoreSelector,
            setCurrentPartnerId,
            setChatPartnerHeaderId: (value) => {
                chatPartnerHeaderLink?.setAttribute('data-partner-id', value);
            },
            setChatHeaderPartnerId: (value) => {
                chatHeader?.setAttribute('data-partner-id', value);
            },
            isProfileDrawerOpen,
            loadAndShowPartnerProfile,
        });
    }

    chatHeader?.addEventListener('click', handleProfileHeaderOpen);
    chatPartnerHeaderLink?.addEventListener('click', handleProfileHeaderOpen);
    chatPartnerHeaderLink?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        handleProfileHeaderOpen(event);
    });

    async function exportChatHistory() {
        const currentChatId = getCurrentChatId?.();
        if (!currentChatId) return;
        const state = getChatState?.(currentChatId);
        while (state.hasMoreBefore && !state.isLoadingOlder) {
            const loaded = await loadOlderMessages?.(currentChatId);
            if (!loaded) break;
        }
        const partnerName = chatHeader?.querySelector('#chatTitle')?.textContent
            || documentRef.getElementById('chatTitle')?.textContent
            || '\u0421\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A';
        const myName = getCurrentDisplayName?.() || getCurrentUsername?.() || '\u0412\u044B';
        const lines = [
            `\u0427\u0430\u0442 \u0441 ${partnerName}`,
            `\u042D\u043A\u0441\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u043E: ${new Date().toLocaleString('ru')}`,
            '-'.repeat(40),
        ];
        state.messages.forEach((msg) => {
            const sender = msg.sender === 'self' ? myName : partnerName;
            const time = formatTime?.(msg.created_at) || '';
            const content = typeof msg.message === 'string' ? msg.message : '[\u0444\u0430\u0439\u043B]';
            lines.push(`[${time}] ${sender}: ${content}`);
        });
        const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = documentRef.createElement('a');
        link.href = url;
        link.download = `chat_${partnerName}_${new Date().toISOString().slice(0, 10)}.txt`;
        link.click();
        URL.revokeObjectURL(url);
        showToast?.('\u0418\u0441\u0442\u043E\u0440\u0438\u044F \u044D\u043A\u0441\u043F\u043E\u0440\u0442\u0438\u0440\u043E\u0432\u0430\u043D\u0430', 'success');
    }

    return {
        exportChatHistory,
    };
}
