export function syncE2EPillState({
    getPrivateKeyPem,
    getCurrentContactPublicKey,
    getCurrentChatId,
    isCurrentChatGroup,
    getChatState,
    e2ePillWrap,
    e2eIndicator,
}) {
    const hasPrivateKey = Boolean(getPrivateKeyPem());
    const hasContactKey = Boolean(getCurrentContactPublicKey());
    const currentChatId = getCurrentChatId();
    const active = hasPrivateKey && hasContactKey && Boolean(currentChatId);
    const state = active ? getChatState(currentChatId) : null;
    const messageCount = Array.isArray(state?.messages) ? state.messages.length : 0;
    const showPill = active && messageCount > 0 && messageCount <= 3;

    if (e2ePillWrap) {
        e2ePillWrap.style.display = showPill ? '' : 'none';
    }
    if (e2eIndicator) {
        e2eIndicator.style.display = 'none';
        e2eIndicator.hidden = true;
        e2eIndicator.setAttribute('aria-pressed', 'false');
    }

    _syncE2eeStatusBadge({ currentChatId, isCurrentChatGroup, state });
}

function _syncE2eeStatusBadge({ currentChatId, isCurrentChatGroup, state }) {
    const ui = window.e2eeStatusUI;
    if (!ui) return;

    if (!currentChatId) {
        ui.hide();
        return;
    }

    // Определяем протокол по последнему расшифрованному сообщению в состоянии чата
    const proto = _detectProtoFromState(state);
    if (proto) {
        ui.setStatus(proto);
    } else if (typeof isCurrentChatGroup === 'function' && isCurrentChatGroup()) {
        // Групповой чат без истории — ещё нет протокола
        ui.hide();
    } else {
        // 1:1 чат без истории — скрываем до первого сообщения
        ui.hide();
    }
}

function _detectProtoFromState(state) {
    if (!state || !Array.isArray(state.messages) || !state.messages.length) return null;
    // Ищем последнее сообщение с зашифрованным payload
    for (let i = state.messages.length - 1; i >= 0; i--) {
        const msg = state.messages[i];
        const raw = msg?.message || msg?.raw_message || msg?.content || '';
        if (typeof raw !== 'string' || !raw.trim().startsWith('{')) continue;
        try {
            const payload = JSON.parse(raw);
            if (payload?.v === 3 && payload?.proto) return payload.proto;
            if (payload?.v === 2 || payload?.encrypted_message || payload?.encrypted_key) return 'legacy';
        } catch (_) { /* ignore */ }
    }
    return null;
}