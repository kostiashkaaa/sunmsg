import { withAppRoot } from './app-url.js';

export function markMessagesAsReadFlow({
    chatId,
    isBlockedChat,
    getCsrfToken,
    onSuccess,
} = {}) {
    if (isBlockedChat(chatId)) return;
    fetch(withAppRoot('/mark_messages_read'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
        body: JSON.stringify({ chat_id: chatId }),
    })
        .then((response) => response.json())
        .then((response) => {
            if (response.success) onSuccess?.();
        })
        .catch(() => {});
}

function tr(value) {
    const api = window.SUN_I18N;
    if (api && typeof api.translateText === 'function') {
        return api.translateText(value);
    }
    return String(value ?? '');
}

export function createOnlineStatusStateController({
    syncChatConnectionStatus = () => {},
    baseUpdateOnlineStatusUI = () => {},
} = {}) {
    let currentPresenceState = { online: false, lastSeen: null, loading: false };
    let onlineStatusRequestSequence = 0;
    let syncHandler = syncChatConnectionStatus;
    let renderHandler = baseUpdateOnlineStatusUI;

    function configure({
        syncChatConnectionStatus: nextSyncHandler,
        baseUpdateOnlineStatusUI: nextRenderHandler,
    } = {}) {
        if (typeof nextSyncHandler === 'function') {
            syncHandler = nextSyncHandler;
        }
        if (typeof nextRenderHandler === 'function') {
            renderHandler = nextRenderHandler;
        }
    }

    function getState() {
        return currentPresenceState;
    }

    function reset({ loading = false } = {}) {
        currentPresenceState = {
            online: false,
            lastSeen: null,
            loading: Boolean(loading),
        };
        syncHandler();
    }

    function applyOnlineStatus(online, lastSeen) {
        currentPresenceState = {
            online: Boolean(online),
            lastSeen: lastSeen || null,
            loading: false,
        };
        syncHandler();
    }

    function markPending() {
        currentPresenceState = {
            ...currentPresenceState,
            loading: true,
        };
        syncHandler();
    }

    function clearPending() {
        currentPresenceState = {
            ...currentPresenceState,
            loading: false,
        };
        syncHandler();
    }

    function renderBlockedState() {
        currentPresenceState = {
            ...currentPresenceState,
            loading: false,
        };
        renderHandler(false, null);
    }

    function nextRequestId() {
        onlineStatusRequestSequence += 1;
        return onlineStatusRequestSequence;
    }

    function shouldApplyResult(requestId, userId, currentContactId) {
        return (
            requestId === onlineStatusRequestSequence
            && String(currentContactId || '') === String(userId || '')
        );
    }

    return {
        configure,
        getState,
        reset,
        applyOnlineStatus,
        markPending,
        clearPending,
        renderBlockedState,
        nextRequestId,
        shouldApplyResult,
    };
}

export function createChatConnectionStatusPresenter({
    getStatusElement,
    getCurrentChatId,
    getCurrentContactId,
    isChatBlocked,
    renderBlockedState,
    isNavigatorOnline,
    isSocketConnected,
    hasSocketConnectedOnce,
    hasSocketConnectionIssue,
    getPresenceState,
    baseUpdateOnlineStatusUI,
    resolveCustomStatus,
} = {}) {
    function setChatHeaderStatus(text, tone = 'muted') {
        const el = getStatusElement?.();
        if (!el) return;
        el.style.display = 'block';
        el.style.visibility = 'visible';
        el.style.opacity = '1';
        el.textContent = text;
        el.setAttribute('data-last-seen', '');
        el.dataset.connectionState = tone;
        if (tone === 'warning') {
            el.style.color = 'var(--warning)';
            return;
        }
        if (tone === 'success') {
            el.style.color = 'var(--success)';
            return;
        }
        el.style.color = 'var(--sub-text)';
    }

    function syncChatConnectionStatus() {
        const el = getStatusElement?.();
        if (!el) return;
        const activeChatId = getCurrentChatId?.();
        const activeContactId = getCurrentContactId?.();
        if (!activeChatId) {
            el.style.display = 'none';
            return;
        }
        if (typeof resolveCustomStatus === 'function') {
            const handled = resolveCustomStatus({
                statusElement: el,
                currentChatId: activeChatId,
                currentContactId: activeContactId,
            });
            if (handled) return;
        }
        if (!activeContactId) {
            el.style.display = 'none';
            return;
        }
        if (isChatBlocked?.()) {
            renderBlockedState?.();
            return;
        }
        if (isNavigatorOnline?.() === false) {
            setChatHeaderStatus('\u041D\u0435\u0442 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u044F', 'warning');
            return;
        }
        if (!isSocketConnected?.() && (hasSocketConnectedOnce?.() || hasSocketConnectionIssue?.())) {
            setChatHeaderStatus('\u0421\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u0435 \u043E\u0431\u043D\u043E\u0432\u043B\u044F\u0435\u0442\u0441\u044F', 'warning');
            return;
        }

        const currentPresenceState = getPresenceState?.() || {};
        if (currentPresenceState.loading) {
            setChatHeaderStatus('\u0421\u0442\u0430\u0442\u0443\u0441 \u043E\u0431\u043D\u043E\u0432\u043B\u044F\u0435\u0442\u0441\u044F', 'muted');
            return;
        }

        el.dataset.connectionState = 'presence';
        baseUpdateOnlineStatusUI?.(
            Boolean(currentPresenceState.online),
            currentPresenceState.lastSeen || null,
        );
    }

    return {
        setChatHeaderStatus,
        syncChatConnectionStatus,
    };
}

export function loadOnlineStatusFlow({
    userId,
    isChatBlocked,
    updateOnlineStatusUI,
    markOnlineStatusPending,
    clearOnlineStatusPending,
    shouldApplyResult,
    getCurrentPartnerData,
    getCurrentBlockState,
    normalizeBlockState,
    setCurrentPartnerData,
} = {}) {
    if (!userId) return;
    const canApplyResult = typeof shouldApplyResult === 'function'
        ? shouldApplyResult
        : () => true;
    if (isChatBlocked()) {
        updateOnlineStatusUI(false, null);
        return;
    }
    markOnlineStatusPending();
    fetch(withAppRoot(`/get_online_status?user_id=${encodeURIComponent(userId)}`))
        .then((response) => {
            if (!canApplyResult()) return null;
            if (response.status === 403) {
                updateOnlineStatusUI(false, null);
                clearOnlineStatusPending();
                return null;
            }
            return response.json();
        })
        .then((response) => {
            if (!canApplyResult()) return;
            if (!response?.success) {
                clearOnlineStatusPending();
                return;
            }
            const previousProfileData = getCurrentPartnerData() || {};
            const preservedBlockState = previousProfileData.block_state || getCurrentBlockState();
            setCurrentPartnerData({
                ...previousProfileData,
                userId,
                user_id: previousProfileData.user_id ?? (Number(userId) || null),
                display_name: response.display_name || previousProfileData.display_name || '',
                username: response.username || previousProfileData.username || '',
                online: response.online,
                last_seen: response.last_seen,
                avatar_url: response.avatar_url !== undefined ? response.avatar_url : previousProfileData.avatar_url,
                block_state: normalizeBlockState(preservedBlockState),
            });
            updateOnlineStatusUI(response.online, response.last_seen, response.stats);
            clearOnlineStatusPending();
        })
        .catch(() => {
            if (!canApplyResult()) return;
            clearOnlineStatusPending();
        });
}

export function bindPartnerBlockControls({
    blockPartnerBtn,
    chatUnblockBtn,
    getCurrentPartnerData,
    getCurrentBlockState,
    getCsrfToken,
    normalizeBlockState,
    applyChatBlockState,
    getCurrentChatId,
    resolveCurrentChatItem,
    closePartnerProfileDrawer,
    showToast,
    confirmDialog,
} = {}) {
    const confirmAction = typeof confirmDialog === 'function'
        ? confirmDialog
        : ({ message }) => Promise.resolve(window.confirm(message));

    blockPartnerBtn?.addEventListener('click', async (event) => {
        if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
        document.dispatchEvent(new Event('sun-close-header-dropdown'));
        const partnerData = getCurrentPartnerData() || {};
        let partnerId = Number(partnerData.userId);
        if (!Number.isFinite(partnerId) || partnerId <= 0) {
            const activeContact = document.querySelector('#contactsList .contact-item.active');
            const fallbackId = Number(activeContact?.getAttribute('data-contact-id') || window.currentPartnerId || 0);
            if (Number.isFinite(fallbackId) && fallbackId > 0) {
                partnerId = fallbackId;
            } else {
                return;
            }
        }

        const currentBlockState = getCurrentBlockState();
        const byMe = Boolean(currentBlockState?.blocked_by_me);
        const endpoint = withAppRoot(byMe ? '/unblock_user' : '/block_user');
        const successText = tr(byMe ? '\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u0440\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D' : '\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D');
        const targetName = partnerData.display_name || partnerData.username || tr('\u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F');

        const confirmed = await confirmAction({
            title: tr(byMe ? '\u0420\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F?' : '\u0417\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F?'),
            message: byMe
                ? `${targetName} ${tr('\u0441\u043D\u043E\u0432\u0430 \u0441\u043C\u043E\u0436\u0435\u0442 \u043E\u0442\u043F\u0440\u0430\u0432\u043B\u044F\u0442\u044C \u0432\u0430\u043C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F.')}`
                : `${targetName} ${tr('\u0431\u043E\u043B\u044C\u0448\u0435 \u043D\u0435 \u0441\u043C\u043E\u0436\u0435\u0442 \u043F\u0438\u0441\u0430\u0442\u044C \u0432\u0430\u043C \u0438 \u0432\u0438\u0434\u0435\u0442\u044C \u0432\u0430\u0448 \u0441\u0442\u0430\u0442\u0443\u0441.')}`,
            confirmText: tr(byMe ? '\u0420\u0430\u0437\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C' : '\u0417\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u0442\u044C'),
            cancelText: tr('\u041E\u0442\u043C\u0435\u043D\u0430'),
            variant: byMe ? 'unblock' : 'block',
        });
        if (!confirmed) return;

        fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
            body: JSON.stringify({ blocked_user_id: partnerId }),
        })
            .then((response) => response.json())
            .then((response) => {
                if (!response?.success) {
                    showToast(`${tr('\u041E\u0448\u0438\u0431\u043A\u0430:')} ${response?.error?.message || response?.error || ''}`.trim(), 'danger');
                    return;
                }
                const nextState = normalizeBlockState(response.block_state || {
                    blocked_by_me: !byMe,
                    blocked_me: currentBlockState.blocked_me,
                });
                applyChatBlockState(nextState, { syncChatRoom: true });
                const activeItem = getCurrentChatId() ? resolveCurrentChatItem() : null;
                if (activeItem) {
                    activeItem.setAttribute('data-blocked-by-me', nextState.blocked_by_me ? '1' : '0');
                    activeItem.setAttribute('data-blocked-me', nextState.blocked_me ? '1' : '0');
                }
                closePartnerProfileDrawer();
                showToast(successText, 'success');
            })
            .catch(() => {
                showToast(tr('\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043E\u0431\u043D\u043E\u0432\u043B\u0435\u043D\u0438\u0438 \u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u043A\u0438.'), 'danger');
            });
    });

    chatUnblockBtn?.addEventListener('click', () => {
        if (!getCurrentBlockState()?.blocked_by_me) return;
        blockPartnerBtn?.click();
    });
}
