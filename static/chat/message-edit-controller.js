export function createMessageEditController(options = {}) {
    const {
        getCurrentChatId,
        getChatState,
        findMessageIndex,
        parseUtcDate,
        formatFullTimestamp,
        contextReadInfo,
        contextReadInfoText,
        showToast,
        getReplyState,
        cancelReply,
        getIsEditingMessageId,
        setIsEditingMessageId,
        messageInput,
        resizeComposerInput,
        resetHorizontalViewportDrift,
        updateVoiceRecordButtonState,
        waitForMotionEnd,
    } = options;

    const MESSAGE_EDIT_WINDOW_SECONDS = 48 * 60 * 60;
    const MESSAGE_EDIT_WINDOW_MS = MESSAGE_EDIT_WINDOW_SECONDS * 1000;
    const TIME_FORMAT_STORAGE_KEY = 'sun_time_format_v1';
    let isEditingFilePayload = null;

    function isTwelveHourTimeFormat() {
        try {
            return String(window.localStorage.getItem(TIME_FORMAT_STORAGE_KEY) || '').trim().toLowerCase() === '12h';
        } catch (_) {
            return false;
        }
    }

    function getEditingFilePayload() {
        return isEditingFilePayload;
    }

    function resolveMessageCreatedAt(msgId) {
        const normalizedMsgId = Number(msgId);
        if (!Number.isFinite(normalizedMsgId) || normalizedMsgId <= 0) return '';

        const currentChatId = getCurrentChatId();
        if (currentChatId) {
            const state = getChatState(currentChatId);
            const messageIndex = findMessageIndex(state, (msg) => Number(msg.id) === normalizedMsgId);
            if (messageIndex >= 0) {
                const createdAt = String(state.messages[messageIndex]?.created_at || '').trim();
                if (createdAt) return createdAt;
            }
        }

        const messageEl = document.querySelector(`.message[data-msg-id="${normalizedMsgId}"]`);
        const messageTimeEl = messageEl?.querySelector('.msg-time');
        return String(messageTimeEl?.getAttribute('data-created-at') || '').trim();
    }

    function resolveMessageReadMeta(msgId, messageElHint = null) {
        const normalizedMsgId = Number(msgId);
        if (!Number.isFinite(normalizedMsgId) || normalizedMsgId <= 0) return { isRead: false, readAt: '' };
        const messageEl = messageElHint || document.querySelector(`.message[data-msg-id="${normalizedMsgId}"]`);
        const tickEl = messageEl?.querySelector('.msg-tick');
        const domIsRead = Boolean(tickEl?.classList.contains('read'));
        const domReadAt = String(tickEl?.getAttribute('data-read-at') || '').trim();
        if (messageElHint) return (domIsRead && domReadAt) ? { isRead: true, readAt: domReadAt } : { isRead: false, readAt: '' };

        const currentChatId = getCurrentChatId();
        if (currentChatId) {
            const state = getChatState(currentChatId);
            const messageIndex = findMessageIndex(state, (msg) => Number(msg.id) === normalizedMsgId);
            if (messageIndex >= 0) {
                const message = state.messages[messageIndex] || {};
                const stateIsRead = Boolean(message.is_read) && !Boolean(message.pending) && Boolean(message.is_delivered);
                const stateReadAt = String(message.read_at || '').trim();
                if (tickEl) {
                    if (!domIsRead) return { isRead: false, readAt: '' };
                    return { isRead: true, readAt: domReadAt || stateReadAt };
                }
                return { isRead: stateIsRead, readAt: stateIsRead ? stateReadAt : '' };
            }
        }
        return { isRead: domIsRead, readAt: domReadAt };
    }

    function formatContextMenuReadAt(rawReadAt, lang = 'ru') {
        const date = parseUtcDate(String(rawReadAt || '').trim());
        if (!date) return '--:--:--';
        const locale = lang === 'en' ? 'en-US' : 'ru-RU';
        const day = date.toLocaleDateString(locale, { day: 'numeric' });
        const month = date.toLocaleDateString(locale, { month: 'short' });
        const time = date.toLocaleTimeString(locale, {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: isTwelveHourTimeFormat(),
        });
        if (lang === 'en') {
            return `${month} ${day} at ${time}`;
        }
        return `${day} ${month} в ${time}`;
    }

    function isWithinMessageEditWindow(createdAtRaw) {
        const createdAt = parseUtcDate(String(createdAtRaw || '').trim());
        if (!createdAt) return true;
        const ageMs = Date.now() - createdAt.getTime();
        if (!Number.isFinite(ageMs) || ageMs < 0) return true;
        return ageMs <= MESSAGE_EDIT_WINDOW_MS;
    }

    function canEditMessageById(msgId) {
        const createdAtRaw = resolveMessageCreatedAt(msgId);
        if (!createdAtRaw) return true;
        return isWithinMessageEditWindow(createdAtRaw);
    }

    function isOwnMessageById(msgId) {
        const normalizedMsgId = Number(msgId);
        if (!Number.isFinite(normalizedMsgId) || normalizedMsgId <= 0) return false;

        const currentChatId = getCurrentChatId();
        if (currentChatId) {
            const state = getChatState(currentChatId);
            const messageIndex = findMessageIndex(state, (msg) => Number(msg.id) === normalizedMsgId);
            if (messageIndex >= 0) {
                return String(state.messages[messageIndex]?.sender || '') === 'self';
            }
        }

        const messageEl = document.querySelector(`.message[data-msg-id="${normalizedMsgId}"]`);
        return Boolean(messageEl?.classList?.contains('self'));
    }

    function updateContextMenuReadInfo(msgId, { isSelf = false, blocked = false, messageEl = null } = {}) {
        if (!contextReadInfo) return;
        const normalizedMsgId = Number(msgId);
        if (!isSelf || blocked || !Number.isFinite(normalizedMsgId) || normalizedMsgId <= 0) {
            contextReadInfo.hidden = true;
            return;
        }
        const createdAtRaw = resolveMessageCreatedAt(normalizedMsgId);
        if (createdAtRaw && !isWithinMessageEditWindow(createdAtRaw)) {
            contextReadInfo.hidden = true;
            return;
        }
        const { isRead, readAt } = resolveMessageReadMeta(normalizedMsgId, messageEl);
        if (!isRead) {
            contextReadInfo.hidden = true;
            return;
        }
        const createdAtDate = createdAtRaw ? parseUtcDate(createdAtRaw) : null;
        const readAtDate = readAt ? parseUtcDate(readAt) : null;
        if (createdAtDate && readAtDate && readAtDate.getTime() < createdAtDate.getTime()) {
            contextReadInfo.hidden = true;
            return;
        }
        const i18nApi = window.SUN_I18N;
        const currentLanguage = (i18nApi && typeof i18nApi.getLanguage === 'function')
            ? String(i18nApi.getLanguage() || '').trim().toLowerCase()
            : String(document.documentElement.lang || '').trim().toLowerCase();
        const lang = currentLanguage.startsWith('en') ? 'en' : 'ru';
        const formattedTime = readAt ? formatContextMenuReadAt(readAt, lang) : '--:--:--';
        if (contextReadInfoText) {
            contextReadInfoText.textContent = formattedTime;
        } else {
            contextReadInfo.textContent = formattedTime;
        }
        contextReadInfo.setAttribute('title', readAt ? formatFullTimestamp(readAt) : '');
        contextReadInfo.hidden = false;
    }

    function startEditMessage(msgId, oldContent) {
        if (!isOwnMessageById(msgId)) {
            showToast('Вы можете редактировать только свои сообщения.', 'warning');
            return;
        }
        if (!canEditMessageById(msgId)) {
            showToast('Время редактирования этого сообщения истекло.', 'warning');
            return;
        }
        if (getReplyState().replyToId) cancelReply();
        setIsEditingMessageId(msgId);
        isEditingFilePayload = null;

        let inputValue = oldContent;
        let bannerText = 'Редактирование сообщения';

        try {
            const p = JSON.parse(oldContent);
            if (p && p.__sunfile) {
                isEditingFilePayload = p;
                inputValue = p.caption || '';
                bannerText = 'Редактирование подписи к файлу';
            }
        } catch (_) {}

        const editBanner = document.getElementById('editMessageBanner');
        const bannerTitle = editBanner?.querySelector('strong');
        if (bannerTitle) bannerTitle.textContent = bannerText;

        messageInput.value = inputValue;
        resizeComposerInput();
        resetHorizontalViewportDrift();
        messageInput.focus({ preventScroll: true });
        resetHorizontalViewportDrift();
        messageInput.classList.add('editing-active');
        if (editBanner) {
            const seq = Number(editBanner.dataset.motionSeq || '0') + 1;
            editBanner.dataset.motionSeq = String(seq);
            editBanner.classList.remove('edit-message-banner--hidden', 'is-closing');
            editBanner.style.display = 'flex';
            requestAnimationFrame(() => {
                if (editBanner.dataset.motionSeq !== String(seq)) return;
                editBanner.classList.add('is-visible');
            });
        }
        showToast('Режим редактирования (Esc для отмены)', 'info');
        updateVoiceRecordButtonState();
    }

    function cancelEdit() {
        if (!getIsEditingMessageId() && !isEditingFilePayload) return;
        setIsEditingMessageId(null);
        isEditingFilePayload = null;
        messageInput.value = '';
        resizeComposerInput();
        messageInput.classList.remove('editing-active');
        const editBanner = document.getElementById('editMessageBanner');
        if (editBanner) {
            const seq = Number(editBanner.dataset.motionSeq || '0') + 1;
            editBanner.dataset.motionSeq = String(seq);
            editBanner.classList.remove('is-visible');
            editBanner.classList.add('is-closing');
            waitForMotionEnd(editBanner, 300).then(() => {
                if (editBanner.dataset.motionSeq !== String(seq)) return;
                editBanner.classList.remove('is-closing');
                editBanner.classList.add('edit-message-banner--hidden');
                editBanner.style.display = 'none';
            });
        }
        const bannerTitle = editBanner?.querySelector('strong');
        if (bannerTitle) bannerTitle.textContent = 'Редактирование сообщения';
        updateVoiceRecordButtonState();
    }

    return {
        getEditingFilePayload,
        resolveMessageCreatedAt,
        resolveMessageReadMeta,
        updateContextMenuReadInfo,
        formatContextMenuReadAt,
        isWithinMessageEditWindow,
        canEditMessageById,
        startEditMessage,
        cancelEdit,
    };
}
