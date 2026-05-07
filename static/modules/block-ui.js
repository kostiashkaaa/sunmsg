// Block-state normalization and block notice UI toggles for chat composer.
export function normalizeBlockState(raw) {
    const blockedByMe = Boolean(raw?.blocked_by_me || raw?.blockedByMe);
    const blockedMe = Boolean(raw?.blocked_me || raw?.blockedMe);
    return {
        blocked_by_me: blockedByMe,
        blocked_me: blockedMe,
        is_blocked: blockedByMe || blockedMe,
    };
}

function getBlockNoticeText(state) {
    if (state.blocked_by_me && state.blocked_me) return '\u0412\u044B \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043B\u0438 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F \u0438 \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u044B';
    if (state.blocked_by_me) return '\u0412\u044B \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043B\u0438 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F';
    if (state.blocked_me) return '\u0412\u044B \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u044B';
    return '';
}

export function applyBlockNoticeUI(blockState, elements = {}) {
    const state = normalizeBlockState(blockState);
    const blocked = Boolean(state.is_blocked);
    const {
        chatBlockNotice,
        chatBlockNoticeText,
        chatUnblockBtn,
        messageInput,
        sendMessageBtn,
    } = elements;

    if (chatBlockNotice && chatBlockNoticeText) {
        chatBlockNotice.style.display = blocked ? 'flex' : 'none';
        chatBlockNoticeText.textContent = getBlockNoticeText(state);
    }
    if (chatUnblockBtn) {
        chatUnblockBtn.style.display = state.blocked_by_me ? 'inline-flex' : 'none';
    }
    if (messageInput) {
        messageInput.disabled = blocked;
    }
    if (sendMessageBtn) {
        sendMessageBtn.disabled = blocked;
    }
    return state;
}
