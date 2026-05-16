// delete-chat.js - delete chat / leave group modal dialog

import { getErrorMessage } from './utils.js';
import { showToast } from './dialogs.js';
import { activateFocusTrap, deactivateFocusTrap } from './focus-trap.js';
import { getCsrfToken } from './csrf.js';
import { closeAnimatedOverlay, openAnimatedOverlay } from './chat-shell-ui.js';
import { withAppRoot } from './app-url.js';

const LEAVE_GROUP_ERROR_MAP = {
    'Transfer ownership before leaving the group.':
        'Передайте права владельца другому участнику, прежде чем покинуть группу.',
    'Group chat not found.': 'Группа не найдена.',
    'Forbidden.': 'Недостаточно прав.',
    'Authorization required.': 'Требуется авторизация.',
    'Invalid payload.': 'Некорректный запрос.',
    'chat_id is required.': 'Не указан идентификатор чата.',
};

function localizeLeaveGroupError(rawError) {
    const text = typeof rawError === 'string' ? rawError.trim() : '';
    if (text && LEAVE_GROUP_ERROR_MAP[text]) return LEAVE_GROUP_ERROR_MAP[text];
    return getErrorMessage(rawError);
}

function buildModalContent({ isGroup = false } = {}) {
    const title = isGroup ? '\u041F\u043E\u043A\u0438\u043D\u0443\u0442\u044C \u0433\u0440\u0443\u043F\u043F\u0443' : '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0447\u0430\u0442';
    const text = isGroup
        ? '\u0412\u044B \u043F\u0435\u0440\u0435\u0441\u0442\u0430\u043D\u0435\u0442\u0435 \u0432\u0438\u0434\u0435\u0442\u044C \u044D\u0442\u0443 \u0433\u0440\u0443\u043F\u043F\u0443. \u0418\u0441\u0442\u043E\u0440\u0438\u044F \u0443 \u0434\u0440\u0443\u0433\u0438\u0445 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432 \u043E\u0441\u0442\u0430\u043D\u0435\u0442\u0441\u044F.'
        : '\u0412\u044B\u0431\u0435\u0440\u0438\u0442\u0435, \u043A\u0430\u043A \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u0447\u0430\u0442. \u0423\u0434\u0430\u043B\u0435\u043D\u0438\u0435 \u0434\u043B\u044F \u043E\u0431\u043E\u0438\u0445 \u0431\u0435\u0437\u0432\u043E\u0437\u0432\u0440\u0430\u0442\u043D\u043E.';
    const primaryText = isGroup ? '\u041F\u043E\u043A\u0438\u043D\u0443\u0442\u044C \u0433\u0440\u0443\u043F\u043F\u0443' : '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0442\u043E\u043B\u044C\u043A\u043E \u0443 \u043C\u0435\u043D\u044F';
    const secondaryButton = isGroup
        ? ''
        : `
            <button type="button" id="delForBoth" class="delete-chat-action delete-chat-action--danger">
                <i class="bi bi-exclamation-triangle-fill"></i>
                <span>\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0443 \u043E\u0431\u043E\u0438\u0445 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u043E\u0432</span>
            </button>
        `;

    return `
        <div class="delete-chat-modal-card">
            <h5 class="delete-chat-modal-title">${title}</h5>
            <p class="delete-chat-modal-text">${text}</p>
            <p class="delete-chat-modal-error" id="deleteChatModalError" role="alert" hidden></p>
            <div class="delete-chat-actions">
                <button type="button" id="delForMe" class="delete-chat-action delete-chat-action--surface">
                    <i class="bi bi-trash3"></i>
                    <span>${primaryText}</span>
                </button>
                ${secondaryButton}
                <button type="button" id="delCancel" class="delete-chat-action delete-chat-action--ghost">
                    \u041E\u0442\u043C\u0435\u043D\u0430
                </button>
            </div>
        </div>
    `;
}

async function performDeleteRequest(chatId, mode, { onDeleted, onReload, isGroup = false } = {}) {
    const endpoint = isGroup ? '/api/chats/group/leave' : '/delete_chat';
    const payload = isGroup ? { chat_id: chatId } : { chat_id: chatId, mode };

    try {
        const rawResponse = await fetch(withAppRoot(endpoint), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
            body: JSON.stringify(payload),
        });
        const response = await rawResponse.json().catch(() => ({}));
        if (response.success) {
            onDeleted?.();
            onReload?.();
            if (isGroup) {
                if (response.group_disbanded) {
                    showToast('\u0413\u0440\u0443\u043F\u043F\u0430 \u0443\u0434\u0430\u043B\u0435\u043D\u0430', 'success');
                } else if (response.new_owner_user_id) {
                    showToast('\u0412\u044B \u043F\u043E\u043A\u0438\u043D\u0443\u043B\u0438 \u0433\u0440\u0443\u043F\u043F\u0443. \u041F\u0440\u0430\u0432\u0430 \u0432\u043B\u0430\u0434\u0435\u043B\u044C\u0446\u0430 \u043F\u0435\u0440\u0435\u0434\u0430\u043D\u044B \u0434\u0440\u0443\u0433\u043E\u043C\u0443 \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0443.', 'success');
                } else {
                    showToast('\u0412\u044B \u043F\u043E\u043A\u0438\u043D\u0443\u043B\u0438 \u0433\u0440\u0443\u043F\u043F\u0443', 'success');
                }
            } else {
                showToast(mode === 'for_both' ? '\u0427\u0430\u0442 \u0443\u0434\u0430\u043B\u0435\u043D \u0443 \u043E\u0431\u043E\u0438\u0445' : '\u0427\u0430\u0442 \u0443\u0434\u0430\u043B\u0435\u043D', 'success');
            }
            return { success: true };
        }
        const message = isGroup
            ? localizeLeaveGroupError(response.error)
            : getErrorMessage(response.error);
        showToast(`\u041E\u0448\u0438\u0431\u043A\u0430: ${message}`, 'danger');
        return { success: false, message };
    } catch (_) {
        const message = '\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0438 \u0437\u0430\u043F\u0440\u043E\u0441\u0430';
        showToast(message, 'danger');
        return { success: false, message };
    }
}

export function showDeleteChatDialog(chatId, { onDeleted, onReload, isGroup = false } = {}) {
    const oldModal = document.getElementById('deleteChatModal');
    if (oldModal) {
        deactivateFocusTrap(oldModal);
        oldModal.remove();
    }

    const modal = document.createElement('div');
    modal.id = 'deleteChatModal';
    modal.className = 'delete-chat-modal-overlay';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('aria-label', isGroup ? '\u0412\u044B\u0445\u043E\u0434 \u0438\u0437 \u0433\u0440\u0443\u043F\u043F\u044B' : '\u0423\u0434\u0430\u043B\u0435\u043D\u0438\u0435 \u0447\u0430\u0442\u0430');
    modal.innerHTML = buildModalContent({ isGroup });

    document.body.appendChild(modal);
    activateFocusTrap(modal);
    openAnimatedOverlay(modal);
    const delForMeBtn = document.getElementById('delForMe');
    const delForBothBtn = document.getElementById('delForBoth');
    const delCancelBtn = document.getElementById('delCancel');
    const errorEl = document.getElementById('deleteChatModalError');
    delForMeBtn?.focus();

    let isClosing = false;
    let isDeleting = false;
    const onEsc = (event) => {
        if (isDeleting) return;
        if (event.key === 'Escape') close();
    };
    document.addEventListener('keydown', onEsc);

    const close = ({ force = false } = {}) => {
        if (isClosing) return;
        if (isDeleting && !force) return;
        isClosing = true;
        deactivateFocusTrap(modal);
        closeAnimatedOverlay(modal).finally(() => {
            document.removeEventListener('keydown', onEsc);
            modal.remove();
        });
    };

    delCancelBtn?.addEventListener('click', () => close());
    modal.addEventListener('click', (event) => {
        if (isDeleting) return;
        if (event.target === modal) close();
    });

    const setDeletePending = (activeButton) => {
        isDeleting = true;
        modal.setAttribute('aria-busy', 'true');
        modal.classList.add('is-pending');
        if (errorEl) {
            errorEl.hidden = true;
            errorEl.textContent = '';
        }
        modal.querySelectorAll('.delete-chat-action').forEach((button) => {
            button.disabled = true;
            button.classList.toggle('is-pending', button === activeButton);
            button.setAttribute('aria-busy', button === activeButton ? 'true' : 'false');
        });
    };

    const clearDeletePending = () => {
        isDeleting = false;
        modal.setAttribute('aria-busy', 'false');
        modal.classList.remove('is-pending');
        modal.querySelectorAll('.delete-chat-action').forEach((button) => {
            button.disabled = false;
            button.classList.remove('is-pending');
            button.setAttribute('aria-busy', 'false');
        });
        delForMeBtn?.focus();
    };

    const showInlineError = (message) => {
        if (!errorEl) return;
        errorEl.textContent = message || '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0432\u044B\u043F\u043E\u043B\u043D\u0438\u0442\u044C \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435.';
        errorEl.hidden = false;
    };

    const runDelete = async (mode, options = {}, activeButton = null) => {
        if (isDeleting) return;
        setDeletePending(activeButton);
        const result = await performDeleteRequest(chatId, mode, { onDeleted, onReload, ...options });
        if (result?.success) {
            close({ force: true });
            return;
        }
        showInlineError(result?.message);
        clearDeletePending();
    };

    delForMeBtn?.addEventListener('click', () => {
        runDelete('for_me', { isGroup }, delForMeBtn);
    });

    delForBothBtn?.addEventListener('click', () => {
        runDelete('for_both', { isGroup: false }, delForBothBtn);
    });
}
