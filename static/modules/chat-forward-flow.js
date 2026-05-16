// Forward (пересылка) flow: модальное окно выбора чата, превью драфта,
// шифрование под получателя, отправка. Вынесено из chat.js без изменения
// поведения — все внешние зависимости приходят через deps.

import { applyEmojiGraphics, buildAvatarInitials, escapeHtml, generateRequestId } from './utils.js';

const FORWARD_ALLOWED_MESSAGE_TYPES = new Set(['text', 'link', 'photo', 'video', 'audio', 'file', 'voice']);

export function createChatForwardFlow(deps = {}) {
    const {
        // DOM
        contactsList,
        forwardDraftBar,
        forwardDraftLabel,
        forwardDraftText,
        cancelForwardDraftBtn,
        messageForwardModal,
        messageForwardSearchInput,
        messageForwardSubmitBtn,
        messageForwardSelectedInfo,
        messageForwardTargets,
        // state getters
        getCurrentChatId,
        getCurrentDisplayName,
        getCurrentUsername,
        getCurrentUserPublicKey,
        getCurrentUserId,
        getPrivateKeyPem,
        // helpers
        formatGroupMembersCountLabel,
        formatLastSeenText,
        parseSunFilePayload,
        findMessageById,
        waitForMotionEnd,
        applyFallbackAvatarTint,
        updateVoiceRecordButtonState,
        emitSocket,
        openAnimatedDialog,
        closeAnimatedDialog,
        getMessageSelectionController,
        toggleSelectionMode,
        openChatByIdWhenReady,
        scheduleComposerFocus,
        showToast,
        getErrorMessage,
    } = deps;

    let forwardModalActionInFlight = false;
    const forwardSourceMessageIds = new Set();
    const forwardComposerDraftByChatId = new Map();

    function renderForwardAvatarContent(sourceAvatarEl, displayName) {
        const imgEl = sourceAvatarEl?.querySelector?.('img.contact-avatar__img');
        const imgSrc = String(imgEl?.getAttribute('src') || '').trim();
        if (imgSrc) {
            const imgAlt = String(imgEl?.getAttribute('alt') || displayName || 'Avatar').trim();
            return `<img class="contact-avatar__img" src="${escapeHtml(imgSrc)}" alt="${escapeHtml(imgAlt)}" loading="lazy" decoding="async">`;
        }
        const initials = String(sourceAvatarEl?.textContent || '').replace(/\s+/g, ' ').trim()
            || buildAvatarInitials(displayName);
        return escapeHtml(initials);
    }

    function resolveForwardContactRows() {
        if (!contactsList) return [];
        const rows = [];
        const items = Array.from(contactsList.querySelectorAll('.contact-item[data-chat-id]'));
        const currentUserIdText = String(getCurrentUserId?.() || '').trim();
        items.forEach((item, orderIndex) => {
            const chatId = String(item.getAttribute('data-chat-id') || '').trim();
            if (!chatId) return;
            const displayName = String(item.querySelector('.contact-name')?.textContent || '').trim()
                || String(item.getAttribute('data-contact-username') || '').trim()
                || chatId;
            const username = String(item.getAttribute('data-contact-username') || '').trim();
            const publicKey = String(item.getAttribute('data-public-key') || '').trim();
            const contactId = String(item.getAttribute('data-contact-id') || '').trim();
            const isGroup = String(item.getAttribute('data-is-group') || '') === '1';
            const isSaved = Boolean(currentUserIdText && contactId && contactId === currentUserIdText);
            const isPinned = String(item.getAttribute('data-pinned') || '') === '1';
            const pinOrderRaw = Number.parseInt(String(item.getAttribute('data-pin-order') || ''), 10);
            const pinOrder = Number.isFinite(pinOrderRaw) ? pinOrderRaw : null;
            const membersCount = Math.max(0, Number(item.getAttribute('data-members-count') || 0) || 0);
            const isOnline = Boolean(item.querySelector('.contact-avatar .status-dot.online'));
            const lastSeenRaw = String(item.getAttribute('data-last-seen') || '').trim();
            const sourceAvatarEl = item.querySelector('.contact-avatar');
            const avatarHtml = renderForwardAvatarContent(sourceAvatarEl, displayName);
            const avatarTint = String(sourceAvatarEl?.getAttribute('data-avatar-tint') || '').trim();
            const statusText = isSaved
                ? 'сохранённые сообщения'
                : (isGroup
                    ? formatGroupMembersCountLabel(membersCount)
                    : (isOnline
                        ? 'в сети'
                        : (lastSeenRaw ? formatLastSeenText(lastSeenRaw) : 'не в сети')));
            rows.push({
                chatId,
                displayName,
                username,
                publicKey,
                isGroup,
                isSaved,
                isPinned,
                pinOrder,
                orderIndex,
                avatarHtml,
                avatarTint,
                statusText,
            });
        });
        return rows;
    }

    function inferForwardMessageType(messageType, plainText) {
        const normalizedType = String(messageType || '').trim().toLowerCase();
        if (FORWARD_ALLOWED_MESSAGE_TYPES.has(normalizedType)) {
            return normalizedType;
        }
        const filePayload = parseSunFilePayload(plainText);
        if (filePayload) {
            const mime = String(filePayload.mime || '').trim().toLowerCase();
            if (mime.startsWith('image/')) return 'photo';
            if (mime.startsWith('video/')) return 'video';
            if (mime.startsWith('audio/')) return 'audio';
            return 'file';
        }
        if (/((https?:\/\/|www\.)[^\s<]+)/i.test(String(plainText || ''))) {
            return 'link';
        }
        return 'text';
    }

    function resolveForwardSourceMessages(messageIds) {
        const sourceChatId = String(getCurrentChatId?.() || '').trim();
        if (!sourceChatId) return [];
        const resolved = [];
        messageIds.forEach((rawId) => {
            const numericId = Number.parseInt(String(rawId || ''), 10);
            if (!Number.isFinite(numericId) || numericId <= 0) return;
            const element = document.querySelector(`.message[data-msg-id="${numericId}"]`);
            const stateMessage = findMessageById(sourceChatId, numericId);
            const plainText = String(element?.getAttribute('data-message-content') || stateMessage?.message || '').trim();
            if (!plainText) return;
            const messageType = inferForwardMessageType(stateMessage?.message_type, plainText);
            const sourceForwardName = String(stateMessage?.forwardFromName || stateMessage?.forward_from_name || '').trim();
            const sourceSenderName = String(
                stateMessage?.senderDisplayName
                || stateMessage?.sender_display_name
                || (stateMessage?.sender === 'self' ? (getCurrentDisplayName?.() || getCurrentUsername?.() || 'Вы') : '')
                || '',
            ).trim();
            const forwardFromName = sourceForwardName || sourceSenderName;
            const sourceForwardUserId = Number(stateMessage?.forwardFromUserId || stateMessage?.forward_from_user_id);
            const sourceSenderUserId = Number(stateMessage?.senderUserId || stateMessage?.sender_user_id);
            const forwardFromUserId = Number.isFinite(sourceForwardUserId) && sourceForwardUserId > 0
                ? sourceForwardUserId
                : (Number.isFinite(sourceSenderUserId) && sourceSenderUserId > 0 ? sourceSenderUserId : null);
            resolved.push({
                messageId: numericId,
                plainText,
                messageType,
                forwardFromName,
                forwardFromUserId,
            });
        });
        return resolved;
    }

    function normalizeForwardDraftMessageCountLabel(count) {
        const safeCount = Math.max(0, Number(count) || 0);
        const mod10 = safeCount % 10;
        const mod100 = safeCount % 100;
        if (mod10 === 1 && mod100 !== 11) return `${safeCount} сообщение`;
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${safeCount} сообщения`;
        return `${safeCount} сообщений`;
    }

    function buildForwardDraftPreviewText(sourceMessages) {
        if (!Array.isArray(sourceMessages) || !sourceMessages.length) return '';
        const firstLine = String(sourceMessages[0]?.plainText || '').replace(/\s+/g, ' ').trim();
        if (!firstLine) return '';
        if (firstLine.length <= 140) return firstLine;
        return `${firstLine.slice(0, 140).trimEnd()}...`;
    }

    function showForwardDraftBar() {
        if (!forwardDraftBar) return;
        forwardDraftBar.classList.remove('link-draft-bar--hidden', 'is-closing');
        forwardDraftBar.style.display = 'flex';
        forwardDraftBar.setAttribute('aria-hidden', 'false');
        requestAnimationFrame(() => forwardDraftBar.classList.add('is-visible'));
    }

    function hideForwardDraftBar() {
        if (!forwardDraftBar) return;
        forwardDraftBar.classList.remove('is-visible');
        forwardDraftBar.classList.add('is-closing');
        forwardDraftBar.setAttribute('aria-hidden', 'true');
        waitForMotionEnd(forwardDraftBar, 220).then(() => {
            if (forwardDraftBar.classList.contains('is-visible')) return;
            forwardDraftBar.classList.add('link-draft-bar--hidden');
            forwardDraftBar.classList.remove('is-closing');
            forwardDraftBar.style.display = 'none';
        });
    }

    function getForwardComposerDraftForChat(chatId) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return null;
        return forwardComposerDraftByChatId.get(normalizedChatId) || null;
    }

    function hasPendingForwardDraftForCurrentChat() {
        return Boolean(getForwardComposerDraftForChat(getCurrentChatId?.()));
    }

    function syncForwardDraftBarForCurrentChat() {
        const draft = getForwardComposerDraftForChat(getCurrentChatId?.());
        if (!draft) {
            hideForwardDraftBar();
            updateVoiceRecordButtonState?.();
            return;
        }
        if (forwardDraftLabel) {
            forwardDraftLabel.textContent = `Переслать ${normalizeForwardDraftMessageCountLabel(draft.messages.length)}`;
        }
        if (forwardDraftText) {
            forwardDraftText.textContent = buildForwardDraftPreviewText(draft.messages);
            applyEmojiGraphics(forwardDraftText);
        }
        showForwardDraftBar();
        updateVoiceRecordButtonState?.();
    }

    function clearForwardComposerDraft(chatId) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return;
        forwardComposerDraftByChatId.delete(normalizedChatId);
        syncForwardDraftBarForCurrentChat();
    }

    function setForwardComposerDraft(chatId, sourceMessages) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId || !Array.isArray(sourceMessages) || !sourceMessages.length) return;
        const normalizedMessages = sourceMessages.map((message) => ({
            messageId: Number(message?.messageId) || 0,
            plainText: String(message?.plainText || ''),
            messageType: inferForwardMessageType(message?.messageType, message?.plainText),
            forwardFromName: String(message?.forwardFromName || '').trim(),
            forwardFromUserId: Number(message?.forwardFromUserId) || null,
        })).filter((message) => message.messageId > 0 && message.plainText.trim());
        if (!normalizedMessages.length) return;
        forwardComposerDraftByChatId.set(normalizedChatId, {
            targetChatId: normalizedChatId,
            messages: normalizedMessages,
            createdAt: Date.now(),
        });
        syncForwardDraftBarForCurrentChat();
    }

    function updateForwardModalState() {
        if (messageForwardSearchInput) {
            messageForwardSearchInput.disabled = forwardModalActionInFlight;
        }
        if (messageForwardSubmitBtn) {
            messageForwardSubmitBtn.disabled = true;
            messageForwardSubmitBtn.textContent = forwardModalActionInFlight ? 'Пересылка...' : 'Выберите чат';
        }
    }

    function renderForwardSelectedInfo() {
        if (!messageForwardSelectedInfo) return;
        messageForwardSelectedInfo.textContent = `Выбрано сообщений: ${forwardSourceMessageIds.size}.`;
    }

    function renderForwardTargets() {
        if (!messageForwardTargets) return;
        const query = String(messageForwardSearchInput?.value || '').trim().toLowerCase();
        const rows = resolveForwardContactRows().filter((row) => {
            if (!query) return true;
            return row.displayName.toLowerCase().includes(query)
                || row.username.toLowerCase().includes(query)
                || row.chatId.toLowerCase().includes(query)
                || String(row.statusText || '').toLowerCase().includes(query);
        });
        if (!rows.length) {
            messageForwardTargets.innerHTML = '<p class="forward-targets-empty">Чаты не найдены.</p>';
            return;
        }

        const isPinnedRow = (row) => row.isSaved || row.isPinned;
        const pinnedRows = rows.filter(isPinnedRow);
        const recentRows = rows.filter((row) => !isPinnedRow(row));
        const sortBySidebarOrder = (left, right) => {
            const leftPinned = isPinnedRow(left);
            const rightPinned = isPinnedRow(right);
            if (leftPinned && rightPinned) {
                if (left.isSaved !== right.isSaved) return left.isSaved ? -1 : 1;
                const leftPinOrder = Number.isFinite(left.pinOrder) ? left.pinOrder : Number.MAX_SAFE_INTEGER;
                const rightPinOrder = Number.isFinite(right.pinOrder) ? right.pinOrder : Number.MAX_SAFE_INTEGER;
                if (leftPinOrder !== rightPinOrder) return leftPinOrder - rightPinOrder;
            }
            return left.orderIndex - right.orderIndex;
        };
        pinnedRows.sort(sortBySidebarOrder);
        recentRows.sort(sortBySidebarOrder);

        const renderRow = (row) => {
            const avatarTintAttr = row.avatarTint
                ? ` data-avatar-tint="${escapeHtml(row.avatarTint)}"`
                : '';
            return `
                <button
                    type="button"
                    class="group-create-result-item forward-target-row"
                    data-forward-target-chat-id="${escapeHtml(row.chatId)}"
                >
                    <span class="forward-target-avatar"${avatarTintAttr}>${row.avatarHtml}</span>
                    <span class="forward-target-copy">
                        <span class="group-create-result-name forward-target-name">${escapeHtml(row.displayName)}</span>
                        <span class="group-create-result-username forward-target-status">${escapeHtml(row.statusText)}</span>
                    </span>
                </button>
            `;
        };
        const renderSection = (title, sectionRows) => {
            if (!sectionRows.length) return '';
            return `
                <section class="forward-target-section">
                    <h6 class="forward-target-section-title">${escapeHtml(title)}</h6>
                    <div class="forward-target-section-items">${sectionRows.map(renderRow).join('')}</div>
                </section>
            `;
        };

        if (query) {
            messageForwardTargets.innerHTML = rows.map(renderRow).join('');
        } else {
            messageForwardTargets.innerHTML = `${renderSection('Закреплённые', pinnedRows)}${renderSection('Недавние', recentRows)}`;
        }

        messageForwardTargets.querySelectorAll('.forward-target-avatar').forEach((avatarEl) => {
            if (!(avatarEl instanceof HTMLElement)) return;
            if (avatarEl.querySelector('img')) return;
            const name = String(avatarEl.closest('.forward-target-row')?.querySelector('.forward-target-name')?.textContent || '').trim();
            applyFallbackAvatarTint(avatarEl, name);
        });
    }

    function resetForwardModalState() {
        forwardModalActionInFlight = false;
        forwardSourceMessageIds.clear();
        if (messageForwardSearchInput) messageForwardSearchInput.value = '';
        renderForwardSelectedInfo();
        renderForwardTargets();
        updateForwardModalState();
    }

    function openForwardModal(messageIds) {
        if (!messageForwardModal) return;
        forwardSourceMessageIds.clear();
        (Array.isArray(messageIds) ? messageIds : [messageIds]).forEach((rawId) => {
            const numericId = Number.parseInt(String(rawId || ''), 10);
            if (!Number.isFinite(numericId) || numericId <= 0) return;
            forwardSourceMessageIds.add(String(numericId));
        });
        forwardModalActionInFlight = false;
        if (messageForwardSearchInput) messageForwardSearchInput.value = '';
        renderForwardSelectedInfo();
        renderForwardTargets();
        updateForwardModalState();
        openAnimatedDialog(messageForwardModal, { focusTarget: messageForwardSearchInput || messageForwardSubmitBtn });
    }

    async function encryptForForwardTarget(contactRow, plainText) {
        if (contactRow.isGroup) {
            return plainText;
        }
        const publicKey = String(contactRow.publicKey || '').trim();
        if (!publicKey) {
            throw new Error(`Не найден ключ шифрования для чата ${contactRow.displayName}.`);
        }
        if (!getPrivateKeyPem?.()) {
            throw new Error('Нет приватного ключа. Войдите заново с вашим ключом.');
        }
        const userPublicKey = getCurrentUserPublicKey?.();
        if (!userPublicKey) {
            throw new Error('Не найден ваш публичный ключ. Обновите страницу и войдите заново.');
        }
        return window.e2e.encryptMessageE2E(publicKey, userPublicKey, plainText);
    }

    async function forwardMessagesToTargets(sourceMessages, targetRows) {
        let sentCount = 0;
        for (const targetRow of targetRows) {
            for (const sourceMessage of sourceMessages) {
                const encryptedPayload = await encryptForForwardTarget(targetRow, sourceMessage.plainText);
                const emitted = emitSocket('send_message', {
                    message: encryptedPayload,
                    chat_id: targetRow.chatId,
                    message_type: sourceMessage.messageType,
                    client_id: generateRequestId(),
                    reply_to_id: null,
                    forward_from_name: String(sourceMessage.forwardFromName || '').trim() || null,
                    forward_from_user_id: Number(sourceMessage.forwardFromUserId) || null,
                }, { requireConnected: true });
                if (!emitted) {
                    throw new Error('Связь с сервером ещё не восстановилась. Повторите пересылку через пару секунд.');
                }
                sentCount += 1;
            }
        }
        return sentCount;
    }

    async function openTargetChatWithForwardDraft(chatId, sourceMessages) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId || !sourceMessages.length) return;
        setForwardComposerDraft(normalizedChatId, sourceMessages);
        closeAnimatedDialog(messageForwardModal);
        const selectionController = getMessageSelectionController?.();
        if (selectionController?.isSelectionMode()) {
            toggleSelectionMode?.(false);
        }
        await openChatByIdWhenReady(normalizedChatId);
        syncForwardDraftBarForCurrentChat();
        scheduleComposerFocus?.({ force: true });
    }

    async function handleForwardTargetSelection(chatId) {
        if (forwardModalActionInFlight) return;
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return;
        const sourceMessages = resolveForwardSourceMessages(Array.from(forwardSourceMessageIds));
        if (!sourceMessages.length) {
            showToast('Не удалось подготовить сообщения для пересылки.', 'warning');
            return;
        }
        const contactByChatId = new Map(resolveForwardContactRows().map((row) => [row.chatId, row]));
        const targetRow = contactByChatId.get(normalizedChatId);
        if (!targetRow) {
            showToast('Чат не найден. Обновите список контактов.', 'warning');
            return;
        }

        if (targetRow.isSaved) {
            forwardModalActionInFlight = true;
            updateForwardModalState();
            try {
                const sentCount = await forwardMessagesToTargets(sourceMessages, [targetRow]);
                showToast(`Переслано сообщений: ${sentCount}.`, 'success');
                closeAnimatedDialog(messageForwardModal);
                const selectionController = getMessageSelectionController?.();
                if (selectionController?.isSelectionMode()) {
                    toggleSelectionMode?.(false);
                }
            } catch (error) {
                showToast(getErrorMessage(error, 'Не удалось переслать сообщения.'), 'danger');
            } finally {
                forwardModalActionInFlight = false;
                updateForwardModalState();
            }
            return;
        }

        await openTargetChatWithForwardDraft(normalizedChatId, sourceMessages);
    }

    // Wiring
    messageForwardTargets?.addEventListener('click', (event) => {
        const button = event.target.closest('[data-forward-target-chat-id]');
        if (!(button instanceof HTMLElement)) return;
        const chatId = String(button.getAttribute('data-forward-target-chat-id') || '').trim();
        if (!chatId) return;
        void handleForwardTargetSelection(chatId);
    });

    messageForwardSearchInput?.addEventListener('input', () => {
        renderForwardTargets();
    });

    messageForwardSearchInput?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const firstTarget = messageForwardTargets?.querySelector('[data-forward-target-chat-id]');
        if (!(firstTarget instanceof HTMLElement)) return;
        const chatId = String(firstTarget.getAttribute('data-forward-target-chat-id') || '').trim();
        if (!chatId) return;
        void handleForwardTargetSelection(chatId);
    });

    messageForwardSubmitBtn?.addEventListener('click', () => {
        const firstTarget = messageForwardTargets?.querySelector('[data-forward-target-chat-id]');
        if (!(firstTarget instanceof HTMLElement)) return;
        const chatId = String(firstTarget.getAttribute('data-forward-target-chat-id') || '').trim();
        if (!chatId) return;
        void handleForwardTargetSelection(chatId);
    });

    messageForwardModal?.addEventListener('close', () => {
        resetForwardModalState();
    });

    cancelForwardDraftBtn?.addEventListener('click', () => {
        clearForwardComposerDraft(getCurrentChatId?.());
        scheduleComposerFocus?.({ force: true });
    });

    return {
        openForwardModal,
        getForwardComposerDraftForChat,
        hasPendingForwardDraftForCurrentChat,
        syncForwardDraftBarForCurrentChat,
        clearForwardComposerDraft,
        setForwardComposerDraft,
        resolveForwardSourceMessages,
        resolveForwardContactRows,
        forwardMessagesToTargets,
    };
}
