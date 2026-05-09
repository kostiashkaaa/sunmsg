// Composer event wiring and submit orchestration for chat input.
const SEND_SHORTCUT_STORAGE_KEY = 'sun_send_shortcut_mode_v1';
const SEND_SHORTCUT_ENTER = 'enter';
const SEND_SHORTCUT_CTRL_ENTER = 'ctrl_enter';

function normalizeSendShortcutMode(value) {
    const raw = String(value || '').trim().toLowerCase();
    return raw === SEND_SHORTCUT_CTRL_ENTER ? SEND_SHORTCUT_CTRL_ENTER : SEND_SHORTCUT_ENTER;
}

function readSendShortcutMode() {
    try {
        return normalizeSendShortcutMode(window.localStorage.getItem(SEND_SHORTCUT_STORAGE_KEY));
    } catch (_) {
        return SEND_SHORTCUT_ENTER;
    }
}

export function initComposer(opts = {}) {
    const {
        messageInput,
        messageForm,
        sendMessageBtn,
        replyCancelBtn,
        editCancelBtn,
        getChatId,
        isChatBlocked,
        isEditingMessageId,
        getReplyState,
        cancelReply,
        cancelEdit,
        emitSocket,
        encryptAndSend,
        showToast,
        resizeComposerInput,
        scheduleComposerFocus,
        onTyping,
        onStopTyping,
    } = opts;

    if (!messageInput || !messageForm) return;
    if (messageInput.dataset.composerBound === '1') return;
    messageInput.dataset.composerBound = '1';

    const resolveChatId = () => (typeof getChatId === 'function' ? getChatId() : null);
    const resolveEditing = () => (typeof isEditingMessageId === 'function' ? Boolean(isEditingMessageId()) : Boolean(isEditingMessageId));
    const resolveBlocked = () => (typeof isChatBlocked === 'function' ? Boolean(isChatBlocked()) : false);
    const isCoarsePointer = () => Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
    let touchSubmitInProgress = false;
    let submitInFlight = false;

    const submitComposerForm = () => {
        if (resolveBlocked() || submitInFlight) return false;
        if (typeof messageForm.requestSubmit === 'function') {
            messageForm.requestSubmit();
        } else {
            const submitEvent = new Event('submit', { cancelable: true, bubbles: true });
            messageForm.dispatchEvent(submitEvent);
        }
        return true;
    };

    const handleComposerSubmit = async (event) => {
        event.preventDefault();
        if (resolveBlocked() || submitInFlight) return;
        submitInFlight = true;

        onStopTyping?.();
        const rawContent = String(messageInput.value || '').replace(/\r\n/g, '\n');

        try {
            if (typeof encryptAndSend === 'function') {
                await encryptAndSend(rawContent, {
                    chatId: resolveChatId(),
                    isEditing: resolveEditing(),
                    replyState: typeof getReplyState === 'function' ? getReplyState() : null,
                });
            }
        } catch (err) {
            showToast?.(err?.message || '\u041E\u0448\u0438\u0431\u043A\u0430 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0438 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F.', 'danger');
        } finally {
            submitInFlight = false;
            if (isCoarsePointer()) {
                scheduleComposerFocus?.({ force: true });
                window.setTimeout(() => {
                    scheduleComposerFocus?.({ force: true });
                }, 120);
            }
        }
    };

    const earlyComposerKeydown = (event) => {
        if (event.key !== 'Enter') return;
        // On touch devices Enter should insert a new line; sending is button-only.
        if (isCoarsePointer()) return;
        const sendShortcutMode = readSendShortcutMode();
        const hasSendModifier = event.ctrlKey || event.metaKey;

        if (sendShortcutMode === SEND_SHORTCUT_CTRL_ENTER) {
            if (!hasSendModifier || event.shiftKey || event.isComposing) return;
        } else if (event.shiftKey || event.isComposing) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (messageInput.value.trim().length === 0 && !resolveEditing()) return;
        submitComposerForm();
    };

    messageForm.addEventListener('submit', handleComposerSubmit);
    messageInput.addEventListener('input', () => {
        resizeComposerInput?.();
        if (!resolveChatId() || resolveEditing() || resolveBlocked()) return;
        onTyping?.();
    });
    messageInput.onkeydown = earlyComposerKeydown;
    messageInput.addEventListener('keydown', earlyComposerKeydown, true);

    if (sendMessageBtn && messageInput) {
        const handleTouchSubmitStart = (event) => {
            if (isCoarsePointer()) {
                event.preventDefault();
                event.stopPropagation();
                if (touchSubmitInProgress || submitInFlight || sendMessageBtn.disabled) return;
                touchSubmitInProgress = true;
                submitComposerForm();

                scheduleComposerFocus?.({ force: true });
                window.setTimeout(() => {
                    scheduleComposerFocus?.({ force: true });
                    touchSubmitInProgress = false;
                }, 140);
            }
        };
        sendMessageBtn.addEventListener('pointerdown', handleTouchSubmitStart);
        sendMessageBtn.addEventListener('touchstart', handleTouchSubmitStart, { passive: false });
        sendMessageBtn.addEventListener('mousedown', handleTouchSubmitStart);
        sendMessageBtn.addEventListener('click', (event) => {
            if (!isCoarsePointer()) return;
            event.preventDefault();
            event.stopPropagation();
        });
    }

    replyCancelBtn?.addEventListener('click', () => cancelReply?.());
    editCancelBtn?.addEventListener('click', () => cancelEdit?.());
    resizeComposerInput?.();
}

