export function initReplyBar({
    barEl,
    textEl,
    labelEl,
    inputEl,
    inputAreaEl,
    formEl,
    renderMessagePreviewHtml,
    applyEmojiGraphics,
} = {}) {
    let replyToId = null;
    let replyToText = '';
    let replyToSender = '';
    let hideTimerId = 0;
    let replyMotionSeq = 0;

    function clearHideTimer() {
        if (!hideTimerId) return;
        window.clearTimeout(hideTimerId);
        hideTimerId = 0;
    }

    function scheduleReplyBarLayoutSync() {}

    function mountReplyBar() {
        if (!barEl) return;
        clearHideTimer();
        const seq = ++replyMotionSeq;
        barEl.classList.remove('is-closing');
        barEl.style.display = 'flex';
        barEl.setAttribute('aria-hidden', 'false');
        inputAreaEl?.classList.add('has-reply-banner');
        requestAnimationFrame(() => {
            if (seq !== replyMotionSeq) return;
            barEl.classList.add('is-visible');
        });
    }

    function unmountReplyBar() {
        if (!barEl) return;
        clearHideTimer();
        const seq = ++replyMotionSeq;
        barEl.classList.remove('is-visible');
        barEl.classList.add('is-closing');
        barEl.setAttribute('aria-hidden', 'true');
        inputAreaEl?.classList.remove('has-reply-banner');
        waitForBannerMotionEnd(barEl, 300).then(() => {
            if (seq !== replyMotionSeq) return;
            if (replyToId) return;
            barEl.classList.remove('is-closing');
            barEl.style.display = 'none';
            hideTimerId = 0;
        });
    }

    function startReply(msgId, text, senderLabel) {
        replyToId = msgId;
        replyToText = text;
        replyToSender = senderLabel;

        mountReplyBar();
        if (labelEl) labelEl.textContent = senderLabel || '\u041E\u0442\u0432\u0435\u0442';
        if (textEl) {
            textEl.innerHTML = renderMessagePreviewHtml(text, {
                maxLen: 120,
                emptyText: '…',
                defaultPhotoText: '\u0424\u043E\u0442\u043E',
                mediaTokenStyle: 'plain',
            });
            applyEmojiGraphics(textEl);
        }
        scheduleReplyBarLayoutSync();
        inputEl?.focus();
    }

    function cancelReply() {
        replyToId = null;
        replyToText = '';
        replyToSender = '';
        unmountReplyBar();
    }

    function getReplyState() {
        return {
            replyToId,
            replyToText,
            replyToSender,
        };
    }

    return {
        startReply,
        cancelReply,
        getReplyState,
    };
}

export function initPinnedBar({
    barEl,
    labelEl,
    textEl,
    unpinButtonEl,
    renderMessagePreviewHtml,
    applyEmojiGraphics,
    singularLabel = 'Закреплённое сообщение',
    pluralLabelTemplate = 'Закреплённые сообщения {current}/{total}',
    onScrollToMessage,
    onUnpin,
} = {}) {
    const labelNode = labelEl || barEl?.querySelector('.pinned-bar__label') || null;
    let pinnedMessages = [];
    let currentIndex = 0;
    let pinnedMotionSeq = 0;

    function normalizePinnedMessages(items) {
        if (!Array.isArray(items)) return [];
        const seen = new Set();
        return items.reduce((result, item) => {
            const messageId = Number(item?.messageId ?? item?.message_id);
            if (!Number.isFinite(messageId) || messageId <= 0 || seen.has(messageId)) {
                return result;
            }
            seen.add(messageId);
            result.push({
                messageId,
                preview: String(item?.preview ?? item?.message_content ?? ''),
                createdAt: String(item?.createdAt ?? item?.created_at ?? ''),
            });
            return result;
        }, []).sort((left, right) => {
            const leftTs = Date.parse(left.createdAt) || left.messageId;
            const rightTs = Date.parse(right.createdAt) || right.messageId;
            if (leftTs !== rightTs) return leftTs - rightTs;
            return left.messageId - right.messageId;
        });
    }

    function getCurrentPinnedMessage() {
        if (!pinnedMessages.length) return null;
        if (currentIndex < 0 || currentIndex >= pinnedMessages.length) {
            currentIndex = 0;
        }
        return pinnedMessages[currentIndex] || null;
    }

    function renderCurrentPinnedMessage() {
        const currentPinnedMessage = getCurrentPinnedMessage();
        if (!currentPinnedMessage) {
            hidePinnedBar();
            return;
        }

        if (labelNode) {
            labelNode.textContent = pinnedMessages.length > 1
                ? String(pluralLabelTemplate || '')
                    .replace('{current}', String(currentIndex + 1))
                    .replace('{total}', String(pinnedMessages.length))
                : String(singularLabel || '');
        }
        if (textEl) {
            textEl.innerHTML = renderMessagePreviewHtml(currentPinnedMessage.preview, { maxLen: 90, emptyText: '' });
            applyEmojiGraphics(textEl);
        }
        if (barEl) {
            const seq = ++pinnedMotionSeq;
            barEl.classList.remove('is-closing', 'pinned-bar--hidden');
            barEl.style.display = 'flex';
            barEl.setAttribute('aria-hidden', 'false');
            requestAnimationFrame(() => {
                if (seq !== pinnedMotionSeq) return;
                barEl.classList.add('is-visible');
            });
        }
    }

    function hidePinnedBar() {
        pinnedMessages = [];
        currentIndex = 0;
        if (!barEl) return;
        const seq = ++pinnedMotionSeq;
        barEl.classList.remove('is-visible');
        barEl.classList.add('is-closing');
        barEl.setAttribute('aria-hidden', 'true');
        waitForBannerMotionEnd(barEl, 300).then(() => {
            if (seq !== pinnedMotionSeq) return;
            barEl.classList.remove('is-closing');
            barEl.classList.add('pinned-bar--hidden');
            barEl.style.display = 'none';
        });
    }

    function setPinnedMessages(items, { activeMessageId = null } = {}) {
        pinnedMessages = normalizePinnedMessages(items);
        if (!pinnedMessages.length) {
            hidePinnedBar();
            return;
        }

        const normalizedActiveMessageId = Number(activeMessageId);
        if (Number.isFinite(normalizedActiveMessageId) && normalizedActiveMessageId > 0) {
            const nextIndex = pinnedMessages.findIndex((item) => item.messageId === normalizedActiveMessageId);
            currentIndex = nextIndex >= 0 ? nextIndex : 0;
        } else if (currentIndex >= pinnedMessages.length) {
            currentIndex = 0;
        }

        renderCurrentPinnedMessage();
    }

    function showPinnedBar(msgId, preview, options = {}) {
        const normalizedMessageId = Number(msgId);
        if (!Number.isFinite(normalizedMessageId) || normalizedMessageId <= 0) return;

        const nextMessages = normalizePinnedMessages([
            {
                messageId: normalizedMessageId,
                preview,
            },
            ...pinnedMessages.filter((item) => item.messageId !== normalizedMessageId),
        ]);
        setPinnedMessages(nextMessages, {
            activeMessageId: options.activeMessageId ?? normalizedMessageId,
        });
    }

    function removePinnedMessage(msgId) {
        const normalizedMessageId = Number(msgId);
        if (!Number.isFinite(normalizedMessageId) || normalizedMessageId <= 0) {
            hidePinnedBar();
            return;
        }
        const nextMessages = pinnedMessages.filter((item) => item.messageId !== normalizedMessageId);
        if (!nextMessages.length) {
            hidePinnedBar();
            return;
        }
        if (currentIndex >= nextMessages.length) {
            currentIndex = 0;
        }
        setPinnedMessages(nextMessages);
    }

    function advancePinnedMessage() {
        if (pinnedMessages.length <= 1) return;
        currentIndex = (currentIndex + 1) % pinnedMessages.length;
        renderCurrentPinnedMessage();
    }

    barEl?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (event.target.closest('#unpinBtn')) return;
        const currentPinnedMessage = getCurrentPinnedMessage();
        if (!currentPinnedMessage) return;
        onScrollToMessage?.(currentPinnedMessage.messageId);
        advancePinnedMessage();
    });

    unpinButtonEl?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        const currentPinnedMessage = getCurrentPinnedMessage();
        if (!currentPinnedMessage) return;
        onUnpin?.(currentPinnedMessage.messageId);
    });

    return {
        setPinnedMessages,
        showPinnedBar,
        removePinnedMessage,
        hidePinnedBar,
        getCurrentPinMessageId() {
            return getCurrentPinnedMessage()?.messageId || null;
        },
    };
}

function parseTimeMs(value) {
    const text = String(value || '').trim().toLowerCase();
    if (!text) return 0;
    if (text.endsWith('ms')) {
        const ms = Number.parseFloat(text.slice(0, -2));
        return Number.isFinite(ms) ? Math.max(0, ms) : 0;
    }
    if (text.endsWith('s')) {
        const seconds = Number.parseFloat(text.slice(0, -1));
        return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : 0;
    }
    const parsed = Number.parseFloat(text);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function getBannerMotionMs(element, fallbackMs = 300) {
    if (!element) return 0;
    if (document.documentElement.classList.contains('perf-lite')) return 0;
    const motionLevel = String(document.documentElement.getAttribute('data-motion-level') || 'full').toLowerCase();
    try {
        if (motionLevel === 'lite' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return 0;
    } catch (_) {}
    const style = window.getComputedStyle(element);
    const transitionMs = Math.max(0, ...String(style.transitionDuration || '').split(',').map(parseTimeMs))
        + Math.max(0, ...String(style.transitionDelay || '').split(',').map(parseTimeMs));
    const animationMs = Math.max(0, ...String(style.animationDuration || '').split(',').map(parseTimeMs))
        + Math.max(0, ...String(style.animationDelay || '').split(',').map(parseTimeMs));
    return Math.max(transitionMs, animationMs, fallbackMs);
}

function waitForBannerMotionEnd(element, fallbackMs = 300) {
    const timeoutMs = getBannerMotionMs(element, fallbackMs);
    if (!element || timeoutMs <= 0) return Promise.resolve();

    return new Promise((resolve) => {
        let done = false;
        let timeoutId = 0;
        const finish = () => {
            if (done) return;
            done = true;
            window.clearTimeout(timeoutId);
            element.removeEventListener('transitionend', onEnd);
            element.removeEventListener('animationend', onEnd);
            resolve();
        };
        const onEnd = (event) => {
            if (event.target !== element) return;
            finish();
        };
        element.addEventListener('transitionend', onEnd);
        element.addEventListener('animationend', onEnd);
        timeoutId = window.setTimeout(finish, timeoutMs + 60);
    });
}
