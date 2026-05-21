import { STANDARD_SINGLE_CHECK_UI_HTML } from './check-glyph.js';
import { showDialogRequestAttention } from './chat-dialog-request-attention.js';
import { applyFallbackAvatarTint, buildAvatarInitials, tr } from './utils.js';

const getInitials = buildAvatarInitials;

function buildDialogRequestItemHtml(data, escapeHtml) {
    const displayName = data.sender_display_name || data.sender_username || '';
    const username = data.sender_username || '';
    const avatar = data.sender_avatar || '';
    const initials = getInitials(displayName || username);
    const avatarHtml = avatar
        ? `<img class="contact-avatar__img" src="${escapeHtml(avatar)}" alt="${escapeHtml(displayName || username || '\u0410\u0432\u0430\u0442\u0430\u0440')}">`
        : escapeHtml(initials);

    return `
        <div class="contact-avatar contact-avatar--request">${avatarHtml}</div>
        <div class="req-info">
            <div class="req-name-row">
                <span class="req-kind-badge">Запрос</span>
                <span class="req-name">${escapeHtml(displayName || username || 'Запрос')}</span>
            </div>
            <div class="req-username">Хочет начать диалог${username ? ` · @${escapeHtml(username)}` : ''}</div>
        </div>
        <div class="req-actions">
            <button class="req-btn accept" data-key="${escapeHtml(data.sender_public_key)}"><span class="req-btn-label">Принять</span></button>
            <button class="req-btn decline" data-key="${escapeHtml(data.sender_public_key)}"><span class="req-btn-label">Отклонить</span></button>
        </div>
    `;
}

function buildGroupInviteRequestItemHtml(data, escapeHtml) {
    const displayName = data.sender_display_name || data.sender_username || '';
    const username = data.sender_username || '';
    const avatar = data.sender_avatar || '';
    const requestId = Number.parseInt(String(data.request_id || '').trim(), 10);
    const chatName = String(data.chat_name || '').trim();
    const initials = getInitials(displayName || username);
    const avatarHtml = avatar
        ? `<img class="contact-avatar__img" src="${escapeHtml(avatar)}" alt="${escapeHtml(displayName || username || '\u0410\u0432\u0430\u0442\u0430\u0440')}">`
        : escapeHtml(initials);
    const subtitle = chatName
        ? `\u041F\u0440\u0438\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u0435 \u0432 \u0433\u0440\u0443\u043F\u043F\u0443: ${escapeHtml(chatName)}`
        : '\u041F\u0440\u0438\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u0435 \u0432 \u0433\u0440\u0443\u043F\u043F\u0443';

    return `
        <div class="contact-avatar contact-avatar--request">${avatarHtml}</div>
        <div class="req-info">
            <div class="req-name-row">
                <span class="req-kind-badge">Запрос</span>
                <span class="req-name">${escapeHtml(displayName || username || 'Запрос')}</span>
            </div>
            <div class="req-username">${subtitle}${username ? ` · @${escapeHtml(username)}` : ''}</div>
        </div>
        <div class="req-actions">
            <button class="req-btn accept" data-request-kind="group_invite" data-request-id="${Number.isFinite(requestId) && requestId > 0 ? requestId : ''}"><span class="req-btn-label">\u041f\u0440\u0438\u043d\u044f\u0442\u044c</span></button>
            <button class="req-btn decline" data-request-kind="group_invite" data-request-id="${Number.isFinite(requestId) && requestId > 0 ? requestId : ''}"><span class="req-btn-label">\u041e\u0442\u043a\u043b\u043e\u043d\u0438\u0442\u044c</span></button>
        </div>
    `;
}

function findDialogRequestActionButtonBySenderKey(dialogRequestsList, senderPublicKey) {
    if (!dialogRequestsList) return null;
    const normalizedSenderKey = String(senderPublicKey || '');
    if (!normalizedSenderKey) return null;

    const actionButtons = dialogRequestsList.querySelectorAll('.req-btn[data-key]');
    for (const button of actionButtons) {
        if (String(button.getAttribute('data-key') || '') === normalizedSenderKey) {
            return button;
        }
    }
    return null;
}

function findDialogRequestActionButtonByRequestId(dialogRequestsList, requestId) {
    if (!dialogRequestsList) return null;
    const normalizedRequestId = String(requestId || '').trim();
    if (!normalizedRequestId) return null;

    const actionButtons = dialogRequestsList.querySelectorAll('.req-btn[data-request-id]');
    for (const button of actionButtons) {
        if (String(button.getAttribute('data-request-id') || '') === normalizedRequestId) {
            return button;
        }
    }
    return null;
}

function findDialogRequestItemByPeerKey(dialogRequestsList, peerPublicKey) {
    if (!dialogRequestsList) return null;
    const normalizedPeerKey = String(peerPublicKey || '');
    if (!normalizedPeerKey) return null;

    const requestItems = dialogRequestsList.querySelectorAll('.request-item[data-request-peer-key]');
    for (const item of requestItems) {
        if (String(item.getAttribute('data-request-peer-key') || '') === normalizedPeerKey) {
            return item;
        }
    }
    return null;
}

export function registerSystemSocketHandlers({
    socket,
    escapeHtml,
    loadContacts,
    getCurrentChatId,
    closeChatUI,
    showToast,
    resolveContactItemByChatId,
    hideSidebarTyping,
    chatStates,
    chatScrollPositions,
    dialogRequestsList,
    dialogRequestsSection,
    updateDialogRequestsBadge,
    clearPendingReactionOp,
    applyChatBlockState,
    updateContact,
    sortContactsList,
    getCurrentBlockState,
    resolveContactItemByPublicKey,
    getCurrentContactPublicKey,
    getCurrentContactId,
    getChatState,
    normalizeBlockState,
    emitSocket,
    hideTyping,
    isDialogRequestsMuted = () => false,
    dropChatCache,
    loadDialogRequests = null,
    onChatDraftUpdated = null,
    refreshCurrentGroupProfileIfVisible = null,
    onChatAutoDeleteUpdated = null,
} = {}) {
    socket.on('chat_deleted', (data) => {
        const deletedChatId = String(data?.chat_id || '');
        if (!deletedChatId) {
            loadContacts();
            return;
        }

        const wasCurrent = String(getCurrentChatId() || '') === deletedChatId;
        if (wasCurrent) {
            closeChatUI();
            showToast(tr('\u0421\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A \u0443\u0434\u0430\u043B\u0438\u043B \u044D\u0442\u043E\u0442 \u0447\u0430\u0442'), 'warning');
        }

        const staleItem = resolveContactItemByChatId(deletedChatId);
        if (staleItem) {
            staleItem.remove();
        }
        hideSidebarTyping(deletedChatId);
        chatStates.delete(deletedChatId);
        chatScrollPositions.delete(deletedChatId);
        dropChatCache?.(deletedChatId);
        loadContacts();
    });

    socket.on('new_dialog_request', (data) => {
        if (!dialogRequestsList || !dialogRequestsSection) return;

        const existingButton = findDialogRequestActionButtonBySenderKey(
            dialogRequestsList,
            data?.sender_public_key,
        );
        if (existingButton) existingButton.closest('.request-item')?.remove();

        const item = document.createElement('div');
        item.className = 'request-item';
        item.setAttribute('data-request-kind', 'dialog');
        item.setAttribute('data-request-direction', 'incoming');
        if (data?.sender_public_key) item.setAttribute('data-request-peer-key', data.sender_public_key);
        item.innerHTML = buildDialogRequestItemHtml(data, escapeHtml).trim();
        applyFallbackAvatarTint(
            item.querySelector('.contact-avatar'),
            data?.sender_display_name || data?.sender_username || '?',
        );
        dialogRequestsList.appendChild(item);
        dialogRequestsSection.classList.add('has-requests');
        updateDialogRequestsBadge();
        showDialogRequestAttention(data, { requestKind: 'dialog' });
    });

    socket.on('new_group_invite_request', (data) => {
        if (!dialogRequestsList || !dialogRequestsSection) return;

        const existingButton = findDialogRequestActionButtonByRequestId(
            dialogRequestsList,
            data?.request_id,
        );
        if (existingButton) existingButton.closest('.request-item')?.remove();

        const item = document.createElement('div');
        item.className = 'request-item';
        item.setAttribute('data-request-kind', 'group_invite');
        item.setAttribute('data-request-direction', 'incoming');
        if (data?.sender_public_key) item.setAttribute('data-request-peer-key', data.sender_public_key);
        item.innerHTML = buildGroupInviteRequestItemHtml(data, escapeHtml).trim();
        applyFallbackAvatarTint(
            item.querySelector('.contact-avatar'),
            data?.sender_display_name || data?.sender_username || '?',
        );
        dialogRequestsList.appendChild(item);
        dialogRequestsSection.classList.add('has-requests');
        updateDialogRequestsBadge();
        showDialogRequestAttention(data, { requestKind: 'group_invite' });
    });


    socket.on('dialog_request_updated', (data) => {
        const btn = findDialogRequestActionButtonBySenderKey(
            dialogRequestsList,
            data?.sender_public_key,
        );
        const item = btn?.closest('.request-item')
            || findDialogRequestItemByPeerKey(
                dialogRequestsList,
                data?.sender_public_key || data?.receiver_public_key || data?.public_key,
            );
        if (item) item.remove();
        else loadDialogRequests?.();
        updateDialogRequestsBadge();
    });

    socket.on('group_invite_request_updated', (data) => {
        const btn = findDialogRequestActionButtonByRequestId(
            dialogRequestsList,
            data?.request_id,
        );
        const item = btn?.closest('.request-item');
        if (item) item.remove();
        updateDialogRequestsBadge();
    });

    socket.on('chat_created', (data) => {
        if (!data.contact) return;
        window.closeCommandPalette?.();
        loadDialogRequests?.();
        updateContact(data.contact).finally(() => {
            sortContactsList();
            Promise.resolve(loadContacts({ immediate: true, attemptInitialChatRestore: false }));
        });
    });

    socket.on('group_chat_created', (data) => {
        const chatId = String(data?.chat_id || '').trim();
        if (chatId) {
            Promise.resolve(updateContact({
                chatId,
                is_group: true,
                members_count: Number(data?.members_count || 0),
                display_name: String(data?.chat_name || 'Group chat').trim(),
                username: '',
                public_key: '',
                avatar_url: String(data?.chat_avatar_url || '').trim(),
                group_description: String(data?.chat_description || '').trim(),
                last_message: '',
                last_message_time: null,
                unreadCount: 0,
                last_sender_id: null,
                last_message_is_read: false,
                last_message_is_delivered: false,
                blocked_by_me: false,
                blocked_me: false,
                is_pinned: false,
                pin_order: 0,
                has_draft: false,
                draft_text: '',
                draft_updated_at: null,
            })).finally(() => {
                sortContactsList?.();
            });
        }
        Promise.resolve(loadContacts({ immediate: true, attemptInitialChatRestore: false }));
    });

    socket.on('group_members_added', () => {
        Promise.resolve(loadContacts({ immediate: true, attemptInitialChatRestore: false }));
        refreshCurrentGroupProfileIfVisible?.();
    });

    socket.on('group_chat_updated', () => {
        Promise.resolve(loadContacts({ immediate: true, attemptInitialChatRestore: false }));
        refreshCurrentGroupProfileIfVisible?.();
    });

    socket.on('group_members_updated', () => {
        Promise.resolve(loadContacts({ immediate: true, attemptInitialChatRestore: false }));
        refreshCurrentGroupProfileIfVisible?.();
    });

    socket.on('group_member_sanctioned', () => {
        Promise.resolve(loadContacts({ immediate: true, attemptInitialChatRestore: false }));
        refreshCurrentGroupProfileIfVisible?.();
    });

    socket.on('you_are_blocked', (data) => {
        const blockerKey = String(data?.blocker_public_key || '');
        const contactItem = resolveContactItemByPublicKey(blockerKey);
        if (contactItem) {
            contactItem.setAttribute('data-blocked-me', '1');
            contactItem.querySelector('.status-dot')?.classList.remove('online');
        }

        if (
            blockerKey === getCurrentContactPublicKey()
            || (data.chat_id && String(data.chat_id) === String(getCurrentChatId()))
        ) {
            const currentBlockState = getCurrentBlockState();
            applyChatBlockState(
                {
                    blocked_by_me: currentBlockState.blocked_by_me,
                    blocked_me: true,
                },
                { syncChatRoom: true },
            );
            showToast(tr('\u0412\u044B \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u044B'), 'warning');
        }
    });

    socket.on('chat_block_state', (data) => {
        const chatId = data?.chat_id;
        if (chatId) {
            const item = resolveContactItemByChatId(chatId);
            if (item) {
                item.setAttribute('data-blocked-by-me', data.blocked_by_me ? '1' : '0');
                item.setAttribute('data-blocked-me', data.blocked_me ? '1' : '0');
                const dot = item.querySelector('.status-dot');
                const isBlocked = Boolean(data.blocked_by_me || data.blocked_me);
                if (dot && isBlocked) dot.classList.remove('online');
            }
            const state = getChatState(chatId);
            state.blockState = normalizeBlockState(data);
        }
        loadContacts();

        const sameChat = chatId && String(chatId) === String(getCurrentChatId());
        const samePartner = data?.partner_user_id
            && String(data.partner_user_id) === String(getCurrentContactId());
        if (sameChat || samePartner) {
            applyChatBlockState(data, { syncChatRoom: true });
        }
    });

    socket.on('force_leave_chat', (data) => {
        if (!data?.chat_id) return;
        if (String(data.chat_id) !== String(getCurrentChatId())) return;
        emitSocket('leave', { chat_id: getCurrentChatId() });
        if (typeof hideTyping === 'function') hideTyping();
    });

    socket.on('chat_draft_updated', (data) => {
        if (!data || typeof data !== 'object') return;
        if (typeof onChatDraftUpdated === 'function') {
            onChatDraftUpdated(data);
            return;
        }
        loadContacts();
    });

    socket.on('chat_auto_delete_updated', (data) => {
        if (!data || typeof data !== 'object') return;
        if (typeof onChatAutoDeleteUpdated === 'function') {
            onChatAutoDeleteUpdated(data);
        }
    });
}


