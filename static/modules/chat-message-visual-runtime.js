import { applyEmojiGraphics } from './utils.js';
import { runMessageStateMotion } from './message-action-motion.js';
import {
    isCurrentUserReactionReactor as baseIsCurrentUserReactionReactor,
    buildCurrentUserReactionReactor as baseBuildCurrentUserReactionReactor,
    normalizeMessageReactions as baseNormalizeMessageReactions,
    buildMessageReactionsHtml as baseBuildMessageReactionsHtml,
} from './reactions.js';
import { withStableChatScroll } from './chat-scroll-stability.js';

const REACTION_ROW_STATE_CLASSES = [
    'reaction-row--active',
    'reaction-row--syncing',
    'reaction-row--failed',
    'reaction-row--disabled',
];

const REACTION_PILL_STATE_CLASSES = [
    'reaction-pill--pending',
    'reaction-pill--removing',
    'reaction-pill--failed',
    'reaction-pill--disabled',
];

export function createChatMessageVisualRuntime({
    documentRef = document,
    windowRef = window,
    getCurrentChatId,
    getChatMessages,
    getChatState,
    getCurrentUserPublicKey,
    getCurrentDisplayName,
    getCurrentUsername,
    getCurrentAvatarUrl,
    getKeepChatPinnedToBottom,
    isChatViewportPinnedToBottom,
    setChatScrollTop,
    saveChatScrollPosition,
    updateJumpToNewMessagesButton,
    requestAnimationFrameFn = requestAnimationFrame,
    isCurrentChatGroup = () => false,
} = {}) {
    function getCurrentUserContext() {
        const currentUsername = String(getCurrentUsername?.() || '').trim();
        return {
            currentUserPublicKey: String(getCurrentUserPublicKey?.() || '').trim(),
            currentDisplayName: String(getCurrentDisplayName?.() || currentUsername || '\u0412\u044B').trim(),
            currentUsername,
            currentAvatarUrl: String(getCurrentAvatarUrl?.() || '').trim(),
        };
    }

    function isCurrentUserReactionReactor(reactor) {
        return baseIsCurrentUserReactionReactor(reactor, getCurrentUserContext().currentUserPublicKey);
    }

    function buildCurrentUserReactionReactor() {
        return baseBuildCurrentUserReactionReactor(getCurrentUserContext());
    }

    function normalizeMessageReactions(rawReactions) {
        return baseNormalizeMessageReactions(rawReactions, {
            currentUserPublicKey: getCurrentUserContext().currentUserPublicKey,
        });
    }

    function buildMessageReactionsHtml(msgId, rawReactions, opts = {}) {
        const isGroupChat = Boolean(opts.isGroupChat ?? isCurrentChatGroup?.());
        return baseBuildMessageReactionsHtml(msgId, rawReactions, {
            currentUserPublicKey: getCurrentUserContext().currentUserPublicKey,
            isGroupChat,
        });
    }

    function shouldPinStableMutationToBottom() {
        return Boolean(getKeepChatPinnedToBottom?.()) && Boolean(isChatViewportPinnedToBottom?.());
    }

    function resolveCurrentChatMessageElementById(messageId) {
        const numericMessageId = Number(messageId);
        if (!Number.isFinite(numericMessageId) || numericMessageId <= 0) return null;
        return getChatMessages?.()?.querySelector(`.message[data-msg-id="${numericMessageId}"]`) || null;
    }

    function resolveMessageReactionRow(messageEl) {
        if (!messageEl) return null;
        return messageEl.querySelector('.message-stack > .message-reactions')
            || messageEl.querySelector('.message-reactions')
            || null;
    }

    function clearReactionStateClasses(rowEl) {
        if (!rowEl) return;
        REACTION_ROW_STATE_CLASSES.forEach((className) => {
            if (className === 'reaction-row--active') return;
            rowEl.classList.remove(className);
        });
        rowEl.querySelectorAll('.reaction-pill').forEach((pill) => {
            REACTION_PILL_STATE_CLASSES.forEach((className) => pill.classList.remove(className));
        });
    }

    function applyReactionOperationUiState(operation, { syncing = false, failed = false, disabled = false } = {}) {
        if (!operation) return;
        if (String(operation.chatId || '') !== String(getCurrentChatId?.() || '')) return;
        const messageEl = resolveCurrentChatMessageElementById(operation.messageId);
        if (!messageEl) return;
        const rowEl = resolveMessageReactionRow(messageEl);
        if (!rowEl) return;

        rowEl.classList.toggle('reaction-row--syncing', Boolean(syncing));
        rowEl.classList.toggle('reaction-row--failed', Boolean(failed));
        rowEl.classList.toggle('reaction-row--disabled', Boolean(disabled));

        const targetEmoji = String(operation.emoji || '').trim();
        if (!targetEmoji) {
            if (!syncing) clearReactionStateClasses(rowEl);
            return;
        }

        const targetPill = Array.from(rowEl.querySelectorAll('.reaction-pill')).find(
            (pill) => String(pill.getAttribute('data-emoji') || '').trim() === targetEmoji,
        ) || null;
        if (!targetPill) {
            if (!syncing) clearReactionStateClasses(rowEl);
            return;
        }

        targetPill.classList.toggle('reaction-pill--pending', Boolean(syncing));
        targetPill.classList.toggle('reaction-pill--removing', Boolean(syncing) && String(operation.mode || '') === 'remove');
        targetPill.classList.toggle('reaction-pill--failed', Boolean(failed));
        targetPill.classList.toggle('reaction-pill--disabled', Boolean(disabled));
        if (!syncing && !failed && !disabled) {
            REACTION_PILL_STATE_CLASSES.forEach((className) => targetPill.classList.remove(className));
        }
    }

    function resolveMessageReactionLayoutState(messageEl, bubble = messageEl?.querySelector('.bubble')) {
        if (!messageEl || !bubble) {
            return {
                isMediaBubble: false,
                isAudioBubble: false,
                isVisualMediaBubble: false,
                hasVisualCaption: false,
                useOutsidePlacement: false,
            };
        }

        const isImageBubble = bubble.classList.contains('bubble--image');
        const isVideoBubble = bubble.classList.contains('bubble--video');
        const isAudioBubble = bubble.classList.contains('bubble--audio');
        const isVisualMediaBubble = isImageBubble || isVideoBubble;
        const hasVisualCaption = bubble.classList.contains('bubble--image-has-caption')
            || bubble.classList.contains('bubble--video-has-caption');
        const useOutsidePlacement = Boolean(isVisualMediaBubble && !hasVisualCaption);

        messageEl.classList.toggle('message-reactions-outside', useOutsidePlacement);
        messageEl.classList.toggle('message-reactions-inside', !useOutsidePlacement);

        return {
            isMediaBubble: isImageBubble || isVideoBubble || isAudioBubble,
            isAudioBubble,
            isVisualMediaBubble,
            hasVisualCaption,
            useOutsidePlacement,
        };
    }

    function syncMessageBubbleLayoutClasses(messageEl) {
        if (!messageEl) return;
        const stack = messageEl.querySelector('.message-stack');
        if (!stack) return;
        const bubble = messageEl.querySelector('.bubble');
        if (!bubble) return;

        const { isMediaBubble, isAudioBubble, useOutsidePlacement } = resolveMessageReactionLayoutState(messageEl, bubble);
        const directChildren = Array.from(bubble.children || []);
        const messageText = directChildren.find((child) => child.classList?.contains('message-text')) || null;
        const audioBody = directChildren.find((child) => child.classList?.contains('audio-message-body')) || null;

        let footer = directChildren.find((child) => child.classList?.contains('message-footer')) || null;
        if (!footer) {
            footer = documentRef.createElement('div');
            footer.className = 'message-footer';
            bubble.append(footer);
        } else {
            directChildren
                .filter((child) => child !== footer && child.classList?.contains('message-footer'))
                .forEach((extraFooter) => extraFooter.remove());
        }

        const meta = bubble.querySelector(':scope > .msg-meta, :scope > .message-meta')
            || audioBody?.querySelector(':scope > .msg-meta, :scope > .message-meta')
            || footer.querySelector(':scope > .msg-meta, :scope > .message-meta')
            || null;
        if (meta && meta.parentElement !== footer) {
            footer.append(meta);
        }

        const allReactionRows = Array.from(messageEl.querySelectorAll('.message-reactions'));
        let keptReactionRow = null;
        allReactionRows.forEach((row) => {
            if (!keptReactionRow) {
                keptReactionRow = row;
                return;
            }
            row.remove();
        });
        const hasReactionItems = Boolean(keptReactionRow?.querySelector('.reaction-pill'));
        const useOutsidePlacementFinal = Boolean(useOutsidePlacement);

        if (keptReactionRow) {
            const targetReactionContainer = useOutsidePlacementFinal ? stack : footer;
            if (keptReactionRow.parentElement !== targetReactionContainer) {
                targetReactionContainer.append(keptReactionRow);
            }
            keptReactionRow.classList.toggle('has-items', hasReactionItems);
        }

        footer.classList.toggle('has-reactions', Boolean(!useOutsidePlacementFinal && hasReactionItems));
        bubble.classList.toggle('bubble--text', Boolean(messageText) && !isMediaBubble);
        bubble.classList.toggle('bubble--has-message-text', Boolean(messageText));
        bubble.classList.toggle('bubble--text-has-reactions', Boolean(!useOutsidePlacementFinal && hasReactionItems && messageText));
        const hasPinMeta = Boolean(footer.querySelector('.msg-pin'));
        const hasEditedMeta = Boolean(footer.querySelector('.msg-edited'));
        const hasGroupReadersMeta = Boolean(footer.querySelector('.msg-group-readers'));
        const hasDecorativeTextChild = Boolean(
            directChildren.some((child) => (
                child !== messageText
                && child !== footer
                && (
                    child.classList?.contains('message-link-preview')
                    || child.classList?.contains('message-sender-label')
                    || child.classList?.contains('reply-quote')
                    || child.classList?.contains('forward-quote')
                )
            )),
        );
        bubble.classList.toggle('bubble--simple-text', Boolean(
            messageText
            && !isMediaBubble
            && !hasReactionItems
            && !messageEl.classList.contains('message-emoji-only')
            && !hasDecorativeTextChild
        ));
        bubble.classList.toggle('bubble--text-meta-pinned', hasPinMeta);
        bubble.classList.toggle('bubble--text-meta-edited', hasEditedMeta);
        bubble.classList.toggle('bubble--text-meta-readers', hasGroupReadersMeta);
        bubble.classList.toggle('bubble--audio-footer-meta', Boolean(isAudioBubble));
        bubble.classList.toggle('bubble--has-footer', Boolean(meta));
        stack.classList.toggle('message-stack--audio', Boolean(isAudioBubble));
        messageEl.classList.toggle('message-reactions-outside', useOutsidePlacementFinal);
        messageEl.classList.toggle('message-reactions-inside', !useOutsidePlacementFinal);
    }

    function invalidateStateHeightIndex(state) {
        if (!state) return;
        state.heightIndex = null;
        state.heightIndexRevision = (Number(state.heightIndexRevision) || 0) + 1;
    }

    function refreshMessageHeightCache(messageEl, options = {}) {
        const chatMessages = getChatMessages?.();
        const currentChatId = getCurrentChatId?.();
        if (!messageEl || !chatMessages || !currentChatId) return;
        const key = messageEl.getAttribute('data-message-key');
        if (!key) return;
        const shouldPinToBottom = options.keepBottomPinned ?? Boolean(getKeepChatPinnedToBottom?.());

        requestAnimationFrameFn(() => {
            if (!chatMessages.contains(messageEl)) return;
            const state = getChatState?.(currentChatId);
            const height = Math.ceil(messageEl.getBoundingClientRect().height);
            if (!state || !Number.isFinite(height) || height <= 0) return;
            if (state.messageHeights.get(key) !== height) {
                invalidateStateHeightIndex(state);
            }
            state.messageHeights.set(key, height);
            if (shouldPinToBottom) {
                setChatScrollTop?.(chatMessages.scrollHeight);
                saveChatScrollPosition?.(currentChatId);
                updateJumpToNewMessagesButton?.();
            }
        });
    }

    function patchPinnedMessageState(messageEl, isPinned) {
        if (!messageEl) return;
        return withStableChatScroll(messageEl, () => {
            const meta = messageEl.querySelector('.msg-meta, .message-meta');
            if (!meta) return;
            const wasPinned = messageEl.classList.contains('message-pinned');

            let pinEl = meta.querySelector('.msg-pin');
            if (isPinned) {
                if (!pinEl) {
                    pinEl = documentRef.createElement('span');
                    pinEl.className = 'msg-pin';
                    pinEl.title = '\u0417\u0430\u043A\u0440\u0435\u043F\u043B\u0435\u043D\u043E';
                    pinEl.innerHTML = '<i class="bi bi-pin-angle-fill"></i>';
                    const editedEl = meta.querySelector('.msg-edited');
                    const timeEl = meta.querySelector('.msg-time');
                    if (editedEl) {
                        editedEl.before(pinEl);
                    } else if (timeEl) {
                        timeEl.before(pinEl);
                    } else {
                        meta.prepend(pinEl);
                    }
                }
            } else {
                pinEl?.remove();
            }

            messageEl.classList.toggle('message-pinned', Boolean(isPinned));
            syncMessageBubbleLayoutClasses(messageEl);
            refreshMessageHeightCache(messageEl, { keepBottomPinned: shouldPinStableMutationToBottom() });
            if (wasPinned !== Boolean(isPinned)) {
                runMessageStateMotion(messageEl, isPinned ? 'pin' : 'unpin');
            }
        }, { pinToBottom: shouldPinStableMutationToBottom() });
    }

    function clearPinnedMessageStates() {
        getChatMessages?.()?.querySelectorAll('.message.message-pinned, .message .msg-pin').forEach((node) => {
            const messageEl = node.classList?.contains('message') ? node : node.closest('.message');
            if (messageEl) {
                patchPinnedMessageState(messageEl, false);
            }
        });
    }

    function patchFavoriteMessageState(messageEl, isFavorite) {
        if (!messageEl) return;
        return withStableChatScroll(messageEl, () => {
            const meta = messageEl.querySelector('.msg-meta, .message-meta');
            if (!meta) return;
            const wasFavorite = messageEl.classList.contains('message-favorite');

            let favoriteEl = meta.querySelector('.msg-favorite');
            if (isFavorite) {
                if (!favoriteEl) {
                    favoriteEl = documentRef.createElement('span');
                    favoriteEl.className = 'msg-favorite';
                    favoriteEl.title = '\u0412 \u0438\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u043C';
                    favoriteEl.innerHTML = '<i class="bi bi-star-fill"></i>';
                    const pinEl = meta.querySelector('.msg-pin');
                    const editedEl = meta.querySelector('.msg-edited');
                    const timeEl = meta.querySelector('.msg-time');
                    if (pinEl) {
                        pinEl.before(favoriteEl);
                    } else if (editedEl) {
                        editedEl.before(favoriteEl);
                    } else if (timeEl) {
                        timeEl.before(favoriteEl);
                    } else {
                        meta.prepend(favoriteEl);
                    }
                }
            } else {
                favoriteEl?.remove();
            }

            messageEl.classList.toggle('message-favorite', Boolean(isFavorite));
            syncMessageBubbleLayoutClasses(messageEl);
            refreshMessageHeightCache(messageEl, { keepBottomPinned: shouldPinStableMutationToBottom() });
            if (wasFavorite !== Boolean(isFavorite)) {
                runMessageStateMotion(messageEl, isFavorite ? 'favorite' : 'unfavorite');
            }
        }, { pinToBottom: shouldPinStableMutationToBottom() });
    }

    function clearFavoriteMessageStates() {
        getChatMessages?.()?.querySelectorAll('.message.message-favorite, .message .msg-favorite').forEach((node) => {
            const messageEl = node.classList?.contains('message') ? node : node.closest('.message');
            if (messageEl) {
                patchFavoriteMessageState(messageEl, false);
            }
        });
    }

    function patchMessageReactions(messageEl, reactions, { animate = false, animatedEmoji = '' } = {}) {
        if (!messageEl) return;
        const msgId = Number(messageEl.getAttribute('data-msg-id'));
        if (!Number.isFinite(msgId) || msgId <= 0) return;
        const highlightedEmoji = String(animatedEmoji || '').trim();
        const shouldPinToBottom = shouldPinStableMutationToBottom();

        return withStableChatScroll(messageEl, () => {
            const stack = messageEl.querySelector('.message-stack');
            if (!stack) return;
            const bubble = stack.querySelector('.bubble');
            if (!bubble) return;
            const { useOutsidePlacement } = resolveMessageReactionLayoutState(messageEl, bubble);
            const existingFooter = bubble.querySelector(':scope > .message-footer');
            const targetContainer = useOutsidePlacement ? stack : (existingFooter || bubble);
            let currentRow = null;
            const allRows = Array.from(stack.querySelectorAll('.message-reactions'));
            allRows.forEach((row) => {
                const isInTarget = row.parentElement === targetContainer;
                if (isInTarget && !currentRow) {
                    currentRow = row;
                    return;
                }
                row.remove();
            });
            const nextMarkup = buildMessageReactionsHtml(msgId, reactions);

            if (!nextMarkup) {
                currentRow?.remove();
                syncMessageBubbleLayoutClasses(messageEl);
                refreshMessageHeightCache(messageEl, { keepBottomPinned: shouldPinToBottom });
                return;
            }

            const template = documentRef.createElement('template');
            template.innerHTML = nextMarkup.trim();
            const nextRow = Array.from(template.content.children)
                .find((child) => child?.classList?.contains('message-reactions')) || null;

            const isNewRow = !currentRow;
            let updatedRow = currentRow;
            if (!nextRow) {
                currentRow?.remove();
                targetContainer.insertAdjacentHTML('beforeend', nextMarkup);
                updatedRow = Array.from(targetContainer.children).find((child) => child?.classList?.contains('message-reactions')) || null;
            } else if (!updatedRow) {
                targetContainer.append(nextRow);
                updatedRow = nextRow;
            } else {
                const preservedRowStateClasses = REACTION_ROW_STATE_CLASSES.filter((className) => updatedRow.classList.contains(className));
                updatedRow.className = nextRow.className;
                updatedRow.setAttribute('data-msg-id', String(msgId));
                preservedRowStateClasses.forEach((className) => updatedRow.classList.add(className));

                const syncPill = (targetPill, sourcePill) => {
                    if (!targetPill || !sourcePill) return;
                    const nextEmoji = String(sourcePill.getAttribute('data-emoji') || '').trim();
                    const preservedPillStateClasses = REACTION_PILL_STATE_CLASSES.filter((className) => targetPill.classList.contains(className));
                    targetPill.className = sourcePill.className;
                    targetPill.setAttribute('data-msg-id', String(msgId));
                    targetPill.setAttribute('data-emoji', nextEmoji);
                    preservedPillStateClasses.forEach((className) => targetPill.classList.add(className));
                    targetPill.innerHTML = sourcePill.innerHTML;
                };

                const currentPills = Array.from(updatedRow.querySelectorAll(':scope > .reaction-pill'));
                const currentPillByEmoji = new Map();
                currentPills.forEach((pill) => {
                    const emoji = String(pill.getAttribute('data-emoji') || '').trim();
                    if (!emoji || currentPillByEmoji.has(emoji)) return;
                    currentPillByEmoji.set(emoji, pill);
                });

                const nextPills = Array.from(nextRow.querySelectorAll(':scope > .reaction-pill'));
                const nextEmojiSet = new Set();
                nextPills.forEach((sourcePill) => {
                    const emoji = String(sourcePill.getAttribute('data-emoji') || '').trim();
                    if (!emoji) return;
                    nextEmojiSet.add(emoji);

                    const existingPill = currentPillByEmoji.get(emoji);
                    if (existingPill) {
                        syncPill(existingPill, sourcePill);
                        updatedRow.append(existingPill);
                        return;
                    }

                    updatedRow.append(sourcePill.cloneNode(true));
                });

                currentPillByEmoji.forEach((pill, emoji) => {
                    if (!nextEmojiSet.has(emoji)) {
                        pill.remove();
                    }
                });
            }

            if (updatedRow && animate && isNewRow) {
                updatedRow.classList.add('reaction-row--reveal');
                const onRevealEnd = () => {
                    updatedRow.classList.remove('reaction-row--reveal');
                    updatedRow.removeEventListener('animationend', onRevealEnd);
                };
                updatedRow.addEventListener('animationend', onRevealEnd);
                windowRef.setTimeout(() => {
                    updatedRow.classList.remove('reaction-row--reveal');
                    updatedRow.removeEventListener('animationend', onRevealEnd);
                }, 400);
            }
            if (updatedRow && animate) {
                updatedRow.classList.add('is-updated');
                windowRef.setTimeout(() => updatedRow.classList.remove('is-updated'), 220);
                if (highlightedEmoji) {
                    const targetPill = Array.from(updatedRow.querySelectorAll(':scope > .reaction-pill'))
                        .find((pill) => String(pill.getAttribute('data-emoji') || '').trim() === highlightedEmoji);
                    if (targetPill) {
                        targetPill.classList.add('reaction-just-added');
                        const onEnd = () => {
                            targetPill.classList.remove('reaction-just-added');
                            targetPill.removeEventListener('animationend', onEnd);
                        };
                        targetPill.addEventListener('animationend', onEnd);
                        windowRef.setTimeout(() => {
                            targetPill.classList.remove('reaction-just-added');
                            targetPill.removeEventListener('animationend', onEnd);
                        }, 400);
                    }
                }
            }
            if (updatedRow) applyEmojiGraphics(updatedRow);
            syncMessageBubbleLayoutClasses(messageEl);
            refreshMessageHeightCache(messageEl, { keepBottomPinned: shouldPinToBottom });
        }, { pinToBottom: shouldPinToBottom });
    }

    return {
        isCurrentUserReactionReactor,
        buildCurrentUserReactionReactor,
        normalizeMessageReactions,
        buildMessageReactionsHtml,
        applyReactionOperationUiState,
        syncMessageBubbleLayoutClasses,
        patchPinnedMessageState,
        clearPinnedMessageStates,
        patchFavoriteMessageState,
        clearFavoriteMessageStates,
        refreshMessageHeightCache,
        patchMessageReactions,
    };
}
