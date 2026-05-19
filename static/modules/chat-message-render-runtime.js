export function createChatMessageRenderRuntime({
    documentRef = document,
    requestAnimationFrameFn = requestAnimationFrame,
    cancelAnimationFrameFn = cancelAnimationFrame,
    performanceNowFn = () => performance.now(),
    chatBottomInertiaMinMs = 120,
    chatBottomInertiaMaxMs = 420,
    chatBottomInertiaPxToMs = 0.45,
    chatBottomThresholdPx = 96,
    chatHeightMeasureSampleLimit = 18,
    chatDefaultMessageHeight = 72,
    getCurrentChatId,
    getCurrentContactId,
    getChatMessages,
    getChatState,
    findMessageIndex,
    getMessageKey,
    getMessageDayKey,
    sumEstimatedHeights,
    getDesiredRenderRange,
    createVirtualSpacer,
    createDaySeparatorNode,
    messageGroup,
    messageItem,
    applyMessageEnterAnimation,
    syncMessageBubbleLayoutClasses,
    isSelectionMode,
    hasSelectedMessage,
    disconnectLazyMediaHydrationObserver,
    registerMediaElementsForLazyHydration,
    schedulePostRenderUiRefresh,
    saveChatScrollPosition,
    resizeComposerInput,
    updateChatMessagesBottomInset,
    isMobileViewport,
    triggerChatHistoryRevealAnimation,
    prefersReducedMotionSetting,
    scrollToBottom,
    syncSavedMessagesMeta,
    syncSelectedMessageAdjacency = () => {},
} = {}) {
    let pendingForcedChatRerenderFrame = 0;
    let pendingForcedChatRerenderChatId = '';
    let pendingForcedChatRerenderOptions = null;
    let chatVirtualRenderFrame = 0;
    let pendingVirtualRenderChatId = '';
    let pendingVirtualRenderOptions = null;
    let suppressChatScrollHandling = false;
    let pendingBottomScrollFrame = 0;
    let pendingBottomScroll = false;
    let bottomInertiaFrame = 0;
    let bottomInertiaToken = 0;
    let keepChatPinnedToBottom = false;
    let loadedMessageBlockAnimationSeq = 0;

    function getCurrentMessagesElement() {
        return getChatMessages?.() || null;
    }

    function getKeepChatPinnedToBottom() {
        return keepChatPinnedToBottom;
    }

    function setKeepChatPinnedToBottom(value) {
        keepChatPinnedToBottom = Boolean(value);
    }

    function getSuppressChatScrollHandling() {
        return suppressChatScrollHandling;
    }

    function setSuppressChatScrollHandling(value) {
        suppressChatScrollHandling = Boolean(value);
    }

    function cancelBottomInertiaScroll() {
        if (bottomInertiaFrame) {
            cancelAnimationFrameFn(bottomInertiaFrame);
            bottomInertiaFrame = 0;
        }
        bottomInertiaToken += 1;
    }

    function resetScrollRuntimeState() {
        keepChatPinnedToBottom = false;
        pendingBottomScroll = false;
        if (pendingBottomScrollFrame) {
            cancelAnimationFrameFn(pendingBottomScrollFrame);
            pendingBottomScrollFrame = 0;
        }
        cancelBottomInertiaScroll();
    }

    function setChatScrollTop(nextTop) {
        cancelBottomInertiaScroll();
        const chatMessages = getCurrentMessagesElement();
        if (!chatMessages) return;
        const maxScrollTop = Math.max(0, chatMessages.scrollHeight - chatMessages.clientHeight);
        const safeTop = Number.isFinite(nextTop) ? Math.max(0, Math.min(nextTop, maxScrollTop)) : 0;
        suppressChatScrollHandling = true;
        chatMessages.scrollTop = safeTop;
        requestAnimationFrameFn(() => {
            requestAnimationFrameFn(() => {
                suppressChatScrollHandling = false;
            });
        });
    }

    function isTailRangeRendered(chatId = getCurrentChatId?.()) {
        if (!chatId) return false;
        const state = getChatState?.(chatId);
        if (!state?.messages?.length) return true;
        const range = state.lastRenderRange;
        return Boolean(range && range.end >= state.messages.length);
    }

    function runBottomInertiaScroll() {
        const chatMessages = getCurrentMessagesElement();
        if (!chatMessages) return false;
        const fromTop = chatMessages.scrollTop;
        const initialTarget = Math.max(0, chatMessages.scrollHeight - chatMessages.clientHeight);
        const distance = initialTarget - fromTop;
        if (!Number.isFinite(distance) || distance <= 1) {
            chatMessages.scrollTop = initialTarget;
            return false;
        }
        if (prefersReducedMotionSetting?.()) {
            chatMessages.scrollTop = initialTarget;
            return false;
        }

        cancelBottomInertiaScroll();
        const token = bottomInertiaToken;
        const startedAt = performanceNowFn();
        const duration = Math.max(
            chatBottomInertiaMinMs,
            Math.min(chatBottomInertiaMaxMs, Math.round(distance * chatBottomInertiaPxToMs)),
        );

        const step = (now) => {
            const currentMessages = getCurrentMessagesElement();
            if (!currentMessages || token !== bottomInertiaToken) {
                bottomInertiaFrame = 0;
                return;
            }
            const elapsed = now - startedAt;
            const progress = Math.max(0, Math.min(1, elapsed / duration));
            const eased = 1 - Math.pow(1 - progress, 2.55);
            const targetTop = Math.max(0, currentMessages.scrollHeight - currentMessages.clientHeight);
            const nextTop = fromTop + ((targetTop - fromTop) * eased);
            currentMessages.scrollTop = nextTop;

            if (progress < 1) {
                bottomInertiaFrame = requestAnimationFrameFn(step);
                return;
            }
            currentMessages.scrollTop = targetTop;
            bottomInertiaFrame = 0;
        };

        bottomInertiaFrame = requestAnimationFrameFn(step);
        return true;
    }

    function isChatNearBottom(thresholdPx = chatBottomThresholdPx) {
        const chatMessages = getCurrentMessagesElement();
        if (!chatMessages) return true;
        const distance = chatMessages.scrollHeight - (chatMessages.scrollTop + chatMessages.clientHeight);
        return distance <= thresholdPx;
    }

    function setElementScrollToBottom(chatMessages) {
        if (!chatMessages) return false;
        const max = Math.max(0, chatMessages.scrollHeight - chatMessages.clientHeight);
        chatMessages.scrollTop = max;
        return true;
    }

    function requestAutoScrollToBottom({ ifNearBottom = false, smooth = true } = {}) {
        const chatMessages = getCurrentMessagesElement();
        const currentChatId = getCurrentChatId?.();
        if (!chatMessages || !currentChatId) return false;
        if (ifNearBottom && !isChatNearBottom()) return false;

        keepChatPinnedToBottom = true;
        pendingBottomScroll = true;
        if (bottomInertiaFrame) {
            pendingBottomScroll = false;
            return true;
        }
        if (pendingBottomScrollFrame) return true;

        pendingBottomScrollFrame = requestAnimationFrameFn(() => {
            pendingBottomScrollFrame = 0;
            if (!pendingBottomScroll) return;
            pendingBottomScroll = false;
            scrollToBottom?.({ smooth });
        });
        return true;
    }

    function invalidateStateHeightIndex(state) {
        if (!state) return;
        state.heightIndex = null;
        state.heightIndexRevision = (Number(state.heightIndexRevision) || 0) + 1;
    }

    function measureRenderedMessageHeights(state) {
        const chatMessages = getCurrentMessagesElement();
        if (!chatMessages) return;
        const rendered = chatMessages.querySelectorAll('.message[data-message-key]');
        if (!rendered.length) return;

        const totalRendered = rendered.length;
        const sampleLimit = Math.max(4, Math.min(chatHeightMeasureSampleLimit, totalRendered));
        const sampleIndexes = [];
        if (totalRendered <= sampleLimit) {
            for (let index = 0; index < totalRendered; index += 1) {
                sampleIndexes.push(index);
            }
        } else {
            const seen = new Set([0, totalRendered - 1]);
            const step = (totalRendered - 1) / Math.max(1, sampleLimit - 1);
            for (let slot = 1; slot < sampleLimit - 1; slot += 1) {
                seen.add(Math.round(slot * step));
            }
            sampleIndexes.push(...Array.from(seen).sort((left, right) => left - right));
        }

        let totalHeight = 0;
        let count = 0;
        let changed = false;
        sampleIndexes.forEach((index) => {
            const node = rendered[index];
            const key = node.getAttribute('data-message-key');
            const height = Math.ceil(node.offsetHeight || node.getBoundingClientRect().height);
            if (!key || !Number.isFinite(height) || height <= 0) return;
            if (state.messageHeights.get(key) !== height) {
                changed = true;
            }
            state.messageHeights.set(key, height);
            totalHeight += height;
            count += 1;
        });
        if (count > 0) {
            const nextAverage = Math.max(48, Math.round(totalHeight / count));
            if (state.averageMessageHeight !== nextAverage) {
                changed = true;
            }
            state.averageMessageHeight = nextAverage;
        }
        if (changed) {
            invalidateStateHeightIndex(state);
        }
    }

    function syncReusedMessageNodeState(node, msg, layout = {}) {
        if (!node || !msg) return;
        const groupClass = String(layout.groupClass || 'group-single');
        node.classList.remove('group-start', 'group-middle', 'group-end', 'group-single');
        node.classList.add(groupClass);
        node.style.removeProperty('--swipe-reply-shift');
        node.classList.remove('swipe-reply-dragging', 'swipe-reply-ready', 'swipe-reply-reset-immediate');
        node.classList.toggle('show-avatar', Boolean(layout.showAvatar));
        node.classList.toggle('selecting', Boolean(isSelectionMode?.()));
        if (msg.id && hasSelectedMessage?.(String(msg.id))) {
            node.classList.add('selected');
        } else {
            node.classList.remove('selected');
        }
    }

    function renderChatMessages(chatId = getCurrentChatId?.(), options = {}) {
        const chatMessages = getCurrentMessagesElement();
        const currentChatId = getCurrentChatId?.();
        if (!chatMessages || !chatId) return;
        if (String(chatId) !== String(currentChatId)) return;

        const state = getChatState?.(chatId);
        const forcedScrollTop = Number.isFinite(options.scrollTop) ? options.scrollTop : null;
        const anchorMessageKey = String(options.anchorMessageKey || '').trim();
        const hasScrollAnchor = Boolean(anchorMessageKey) && Number.isFinite(options.anchorOffsetTop);
        const effectiveScrollTop = options.scrollToBottom
            ? sumEstimatedHeights?.(state, 0, state.messages.length)
            : (forcedScrollTop ?? chatMessages.scrollTop);
        let range = getDesiredRenderRange?.(state, effectiveScrollTop);
        const activeVoiceMessageEl = chatMessages.querySelector('.file-msg-audio-player.is-playing')?.closest('.message[data-message-key]');
        const activeVoiceMessageKey = String(activeVoiceMessageEl?.getAttribute('data-message-key') || '');
        if (activeVoiceMessageKey) {
            const activeVoiceIndex = findMessageIndex?.(state, (msg) => getMessageKey?.(msg) === activeVoiceMessageKey);
            if (activeVoiceIndex >= 0 && (activeVoiceIndex < range.start || activeVoiceIndex >= range.end)) {
                range = {
                    start: Math.min(range.start, activeVoiceIndex),
                    end: Math.max(range.end, activeVoiceIndex + 1),
                };
            }
        }
        const needsForcedRender = Boolean(options.force || hasScrollAnchor || options.preserveHeightDelta || forcedScrollTop !== null || options.scrollToBottom);
        if (!needsForcedRender && state.lastRenderRange && state.lastRenderRange.start === range.start && state.lastRenderRange.end === range.end) {
            schedulePostRenderUiRefresh?.({ jumpButton: true });
            return;
        }

        const reusableMessageNodesByKey = new Map();
        if (!options.force) {
            chatMessages.querySelectorAll('.message[data-message-key]').forEach((node) => {
                const key = String(node.getAttribute('data-message-key') || '');
                if (!key || reusableMessageNodesByKey.has(key)) return;
                reusableMessageNodesByKey.set(key, node);
            });
        } else if (activeVoiceMessageEl && activeVoiceMessageKey) {
            reusableMessageNodesByKey.set(activeVoiceMessageKey, activeVoiceMessageEl);
        }

        const fragment = documentRef.createDocumentFragment();
        const topSpacerHeight = sumEstimatedHeights?.(state, 0, range.start);
        const bottomSpacerHeight = sumEstimatedHeights?.(state, range.end, state.messages.length);
        fragment.appendChild(createVirtualSpacer?.(topSpacerHeight));

        let previousDayKey = range.start > 0
            ? getMessageDayKey?.(state.messages[range.start - 1]?.created_at)
            : '';
        const suppressEnterAnimation = chatMessages.classList.contains('is-loading-history');
        state.messages.slice(range.start, range.end).forEach((msg, localIndex) => {
            const absoluteIndex = range.start + localIndex;
            const dayKey = getMessageDayKey?.(msg?.created_at);
            if (dayKey && dayKey !== previousDayKey) {
                fragment.appendChild(createDaySeparatorNode?.(msg.created_at, dayKey));
            }
            previousDayKey = dayKey;

            const msgKey = getMessageKey?.(msg);
            const isNew = !state.renderedKeys.has(msgKey);
            const groupLayout = messageGroup?.(state.messages, absoluteIndex);
            let messageNode = reusableMessageNodesByKey.get(msgKey) || null;
            if (messageNode) {
                syncReusedMessageNodeState(messageNode, msg, groupLayout);
            } else {
                messageNode = messageItem?.(msg, groupLayout);
                if (isNew && !suppressEnterAnimation) applyMessageEnterAnimation?.(messageNode, msg);
                if (isSelectionMode?.()) messageNode.classList.add('selecting');
                if (msg.id && hasSelectedMessage?.(String(msg.id))) {
                    messageNode.classList.add('selected');
                }
            }
            syncMessageBubbleLayoutClasses?.(messageNode);
            state.renderedKeys.add(msgKey);
            fragment.appendChild(messageNode);
        });

        fragment.appendChild(createVirtualSpacer?.(bottomSpacerHeight));
        state.lastRenderRange = range;
        chatMessages.replaceChildren(fragment);
        syncSelectedMessageAdjacency(chatMessages);
        disconnectLazyMediaHydrationObserver?.();
        registerMediaElementsForLazyHydration?.(chatMessages);
        measureRenderedMessageHeights(state);
        // Re-hydrate after scroll is restored (positions change after scrollTop is set)
        requestAnimationFrameFn(() => {
            const el = getChatMessages?.();
            if (el) registerMediaElementsForLazyHydration?.(el);
        });

        if (hasScrollAnchor) {
            const resolveAnchorEl = () => (
                Array.from(chatMessages.querySelectorAll('.message[data-message-key]'))
                    .find((node) => String(node.getAttribute('data-message-key') || '') === anchorMessageKey)
                || null
            );
            const restoreAnchorScroll = () => {
                const anchorEl = resolveAnchorEl();
                if (!anchorEl) return false;
                const containerRect = chatMessages.getBoundingClientRect();
                const anchorRect = anchorEl.getBoundingClientRect();
                const nextTop = chatMessages.scrollTop + (anchorRect.top - containerRect.top - options.anchorOffsetTop);
                setChatScrollTop(nextTop);
                return true;
            };

            if (!restoreAnchorScroll() && options.preserveHeightDelta && Number.isFinite(options.previousScrollTop) && Number.isFinite(options.previousScrollHeight)) {
                setChatScrollTop(options.previousScrollTop + (chatMessages.scrollHeight - options.previousScrollHeight));
            }
            requestAnimationFrameFn(() => {
                const currentMessages = getCurrentMessagesElement();
                if (!currentMessages) return;
                if (!chatId || String(chatId) !== String(getCurrentChatId?.())) return;
                restoreAnchorScroll();
            });
            saveChatScrollPosition?.(chatId);
            schedulePostRenderUiRefresh?.({ searchFilter: true, jumpButton: true, e2ePill: true, expiryBadges: true, albums: true });
        } else if (forcedScrollTop !== null) {
            setChatScrollTop(forcedScrollTop);
            requestAnimationFrameFn(() => {
                const currentMessages = getCurrentMessagesElement();
                if (!currentMessages) return;
                if (!chatId || String(chatId) !== String(getCurrentChatId?.())) return;
                if (Math.abs(forcedScrollTop - currentMessages.scrollTop) > 1) {
                    setChatScrollTop(forcedScrollTop);
                }
            });
            saveChatScrollPosition?.(chatId);
            schedulePostRenderUiRefresh?.({ searchFilter: true, jumpButton: true, e2ePill: true, expiryBadges: true, albums: true });
        } else if (options.preserveHeightDelta && Number.isFinite(options.previousScrollTop) && Number.isFinite(options.previousScrollHeight)) {
            const expectedTop = options.previousScrollTop + (chatMessages.scrollHeight - options.previousScrollHeight);
            setChatScrollTop(expectedTop);
            requestAnimationFrameFn(() => {
                const currentMessages = getCurrentMessagesElement();
                if (!currentMessages) return;
                if (!chatId || String(chatId) !== String(getCurrentChatId?.())) return;
                const stabilizedTop = options.previousScrollTop + (currentMessages.scrollHeight - options.previousScrollHeight);
                if (Math.abs(stabilizedTop - currentMessages.scrollTop) > 1) {
                    setChatScrollTop(stabilizedTop);
                }
            });
            saveChatScrollPosition?.(chatId);
            schedulePostRenderUiRefresh?.({ searchFilter: true, jumpButton: true, e2ePill: true, expiryBadges: true, albums: true });
        } else if (options.scrollToBottom) {
            suppressChatScrollHandling = true;
            setElementScrollToBottom(chatMessages);
            requestAnimationFrameFn(() => {
                const currentMessages = getCurrentMessagesElement();
                if (!currentMessages) {
                    suppressChatScrollHandling = false;
                    return;
                }
                setElementScrollToBottom(currentMessages);
                requestAnimationFrameFn(() => {
                    suppressChatScrollHandling = false;
                    saveChatScrollPosition?.(chatId);
                    schedulePostRenderUiRefresh?.({ jumpButton: true });
                });
            });
            schedulePostRenderUiRefresh?.({ searchFilter: true, jumpButton: true, e2ePill: true, expiryBadges: true, albums: true });
        } else {
            saveChatScrollPosition?.(chatId);
            schedulePostRenderUiRefresh?.({ searchFilter: true, jumpButton: true, e2ePill: true, expiryBadges: true, albums: true });
        }
        syncSavedMessagesMeta?.({
            chatId: getCurrentChatId?.(),
            contactId: getCurrentContactId?.(),
        });
    }

    function waitForPaintFrames(frameCount = 1) {
        const safeFrames = Math.max(1, Number(frameCount) || 1);
        return new Promise((resolve) => {
            const step = (remaining) => {
                requestAnimationFrameFn(() => {
                    if (remaining <= 1) {
                        resolve();
                        return;
                    }
                    step(remaining - 1);
                });
            };
            step(safeFrames);
        });
    }

    function shouldSkipLoadedMessageBlockAnimations() {
        try {
            return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
        } catch (_) {
            return false;
        }
    }

    function prepareLoadedMessageBlockAnimations(container) {
        if (!container || shouldSkipLoadedMessageBlockAnimations()) return null;
        const messageNodes = Array.from(container.querySelectorAll('.message'));
        if (!messageNodes.length) return null;
        const animationSeq = String(++loadedMessageBlockAnimationSeq);
        const entries = [];

        messageNodes.forEach((node) => {
            node.classList.remove('message-block-load-animate');
            node.classList.remove('message-block-load-visible');
            delete node.dataset.messageBlockLoadAnimationSeq;
        });

        messageNodes.forEach((node) => {
            const bubble = node.querySelector('.message-stack > .bubble') || node.querySelector('.bubble');
            if (!bubble) return;
            node.dataset.messageBlockLoadAnimationSeq = animationSeq;
            node.classList.add('message-block-load-animate');
            entries.push({ node, bubble });
        });

        if (!entries.length) return null;
        return { animationSeq, entries };
    }

    function runLoadedMessageBlockAnimations(prepared) {
        if (!prepared?.entries?.length) return;
        const { animationSeq, entries } = prepared;

        requestAnimationFrameFn(() => {
            entries.forEach(({ node, bubble }) => {
                if (node.dataset.messageBlockLoadAnimationSeq !== animationSeq) return;
                let timeoutId = 0;
                const clear = () => {
                    if (node.dataset.messageBlockLoadAnimationSeq !== animationSeq) return;
                    node.classList.remove('message-block-load-animate');
                    node.classList.remove('message-block-load-visible');
                    delete node.dataset.messageBlockLoadAnimationSeq;
                    bubble.removeEventListener('transitionend', onTransitionEnd);
                    if (timeoutId) {
                        globalThis.clearTimeout(timeoutId);
                        timeoutId = 0;
                    }
                };
                const onTransitionEnd = (event) => {
                    if (event.target !== bubble) return;
                    clear();
                };

                bubble.addEventListener('transitionend', onTransitionEnd);
                node.classList.add('message-block-load-visible');
                timeoutId = globalThis.setTimeout(clear, 420);
            });
        });
    }

    async function renderChatMessagesStable(chatId = getCurrentChatId?.(), options = {}) {
        const chatMessages = getCurrentMessagesElement();
        const currentChatId = getCurrentChatId?.();
        if (!chatMessages || !chatId) return;
        if (String(chatId) !== String(currentChatId)) return;

        const suppressHydrationMask = Boolean(options?.suppressHydrationMask);
        const shouldMaskHydration = Boolean(
            !suppressHydrationMask
            && !chatMessages.querySelector('.message[data-message-key]'),
        );
        resizeComposerInput?.();
        updateChatMessagesBottomInset?.({ immediate: true });
        chatMessages.classList.add('is-hydrating');
        if (shouldMaskHydration) {
            chatMessages.style.visibility = 'hidden';
        }

        try {
            const state = getChatState?.(chatId);
            const beforeAvg = state?.averageMessageHeight || chatDefaultMessageHeight;

            renderChatMessages(chatId, { ...options, force: true });
            await waitForPaintFrames(1);

            const currentMessages = getCurrentMessagesElement();
            if (currentMessages && String(chatId) === String(getCurrentChatId?.())) {
                const afterAvg = state?.averageMessageHeight || beforeAvg;
                const drift = Math.abs(afterAvg - beforeAvg) / Math.max(beforeAvg, 1);
                if (drift > 0.15 && !isMobileViewport?.()) {
                    updateChatMessagesBottomInset?.({ immediate: true });
                    renderChatMessages(chatId, { ...options, force: true });
                    await waitForPaintFrames(options.scrollToBottom ? 2 : 1);
                }
            }
        } finally {
            const currentMessages = getCurrentMessagesElement();
            if (!currentMessages) return;
            const preparedMessageBlockAnimations = options?.animateReveal && shouldMaskHydration
                ? prepareLoadedMessageBlockAnimations(currentMessages)
                : null;
            if (shouldMaskHydration) {
                currentMessages.style.visibility = '';
            }
            currentMessages.classList.remove('is-hydrating');
            runLoadedMessageBlockAnimations(preparedMessageBlockAnimations);
        }
    }

    function scheduleForcedCurrentChatRerender(options = {}) {
        const currentChatId = getCurrentChatId?.();
        const chatMessages = getCurrentMessagesElement();
        if (!currentChatId || !chatMessages) return;
        pendingForcedChatRerenderChatId = String(currentChatId);
        pendingForcedChatRerenderOptions = {
            force: true,
            scrollTop: chatMessages.scrollTop,
            ...(pendingForcedChatRerenderOptions || {}),
            ...options,
        };
        if (pendingForcedChatRerenderFrame) return;

        pendingForcedChatRerenderFrame = requestAnimationFrameFn(() => {
            const chatId = pendingForcedChatRerenderChatId;
            const rerenderOptions = pendingForcedChatRerenderOptions || { force: true };
            pendingForcedChatRerenderFrame = 0;
            pendingForcedChatRerenderChatId = '';
            pendingForcedChatRerenderOptions = null;
            if (!chatId || String(chatId) !== String(getCurrentChatId?.())) return;
            renderChatMessages(chatId, rerenderOptions);
        });
    }

    function mergeVirtualRenderOptions(base = null, incoming = null) {
        const merged = { ...(base || {}) };
        const next = incoming || {};

        if (next.force) merged.force = true;
        if (next.scrollToBottom) {
            merged.scrollToBottom = true;
            delete merged.scrollTop;
            delete merged.preserveHeightDelta;
            delete merged.previousScrollTop;
            delete merged.previousScrollHeight;
        }

        if (next.preserveHeightDelta) merged.preserveHeightDelta = true;
        if (Number.isFinite(next.previousScrollTop)) merged.previousScrollTop = next.previousScrollTop;
        if (Number.isFinite(next.previousScrollHeight)) merged.previousScrollHeight = next.previousScrollHeight;

        if (Number.isFinite(next.scrollTop)) {
            merged.scrollTop = next.scrollTop;
            delete merged.scrollToBottom;
        }

        return merged;
    }

    function scheduleVirtualChatRender(chatId = getCurrentChatId?.(), options = {}) {
        const targetChatId = String(chatId || '');
        if (!targetChatId || targetChatId !== String(getCurrentChatId?.())) return;

        pendingVirtualRenderChatId = targetChatId;
        pendingVirtualRenderOptions = mergeVirtualRenderOptions(pendingVirtualRenderOptions, options);

        if (pendingVirtualRenderOptions?.force) {
            if (chatVirtualRenderFrame) {
                cancelAnimationFrameFn(chatVirtualRenderFrame);
                chatVirtualRenderFrame = 0;
            }
            const immediateOptions = pendingVirtualRenderOptions || { force: true };
            pendingVirtualRenderChatId = '';
            pendingVirtualRenderOptions = null;
            renderChatMessages(targetChatId, immediateOptions);
            return;
        }

        if (chatVirtualRenderFrame) return;
        chatVirtualRenderFrame = requestAnimationFrameFn(() => {
            chatVirtualRenderFrame = 0;
            const scheduledChatId = pendingVirtualRenderChatId;
            const scheduledOptions = pendingVirtualRenderOptions || {};
            pendingVirtualRenderChatId = '';
            pendingVirtualRenderOptions = null;

            if (!scheduledChatId || scheduledChatId !== String(getCurrentChatId?.())) return;
            renderChatMessages(scheduledChatId, scheduledOptions);
        });
    }

    return {
        getKeepChatPinnedToBottom,
        setKeepChatPinnedToBottom,
        getSuppressChatScrollHandling,
        setSuppressChatScrollHandling,
        resetScrollRuntimeState,
        setChatScrollTop,
        cancelBottomInertiaScroll,
        isTailRangeRendered,
        runBottomInertiaScroll,
        isChatNearBottom,
        requestAutoScrollToBottom,
        measureRenderedMessageHeights,
        syncReusedMessageNodeState,
        renderChatMessages,
        renderChatMessagesStable,
        scheduleForcedCurrentChatRerender,
        scheduleVirtualChatRender,
    };
}
