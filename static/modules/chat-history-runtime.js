import { withAppRoot } from './app-url.js';
import { normalizeMentionUserIds } from './chat-mentions.js';
import { normalizeGroupReaders } from './chat-group-read-receipts.js';

const INITIAL_SNAPSHOT_CACHE_LIMIT = 200;

export async function mapWithConcurrency(items, limit, mapper) {
    const source = Array.isArray(items) ? items : [];
    if (!source.length) return [];

    const safeLimit = Math.max(1, Math.min(Number(limit) || 1, source.length));
    const results = new Array(source.length);
    let nextIndex = 0;

    async function worker() {
        while (true) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            if (currentIndex >= source.length) return;
            results[currentIndex] = await mapper(source[currentIndex], currentIndex);
        }
    }

    const workers = Array.from({ length: safeLimit }, () => worker());
    await Promise.all(workers);
    return results;
}

export function createChatHistoryRuntime(ctx = {}) {
    let decryptWorker = null;
    let decryptWorkerFailed = false;
    let decryptWorkerRequestSeq = 0;
    const decryptWorkerPending = new Map();

    function shouldAnimateHistoryReveal() {
        return true;
    }

    function requestChatHistoryPage(chatId, {
        beforeId = null,
        afterId = null,
        limit = ctx.chatHistoryPageSize,
        includePins = null,
        includeFavorites = null,
        signal = null,
    } = {}) {
        const safeLimit = Math.max(
            1,
            Math.min(ctx.chatHistoryMaxPageSize, Number(limit) || ctx.chatHistoryPageSize),
        );
        const requestData = { chat_id: chatId, limit: safeLimit };
        if (Number.isFinite(beforeId) && beforeId > 0) {
            requestData.before_id = beforeId;
        }
        if (Number.isFinite(afterId) && afterId > 0) {
            requestData.after_id = afterId;
        }
        if (typeof includePins === 'boolean') {
            requestData.include_pins = includePins ? '1' : '0';
        }
        if (typeof includeFavorites === 'boolean') {
            requestData.include_favorites = includeFavorites ? '1' : '0';
        }

        const params = new URLSearchParams(requestData);
        const fetchImpl = ctx.fetchImpl || fetch;
        const resolveAppUrl = typeof ctx.resolveAppUrl === 'function'
            ? ctx.resolveAppUrl
            : withAppRoot;
        return fetchImpl(resolveAppUrl(`/get_chat_history?${params}`), { signal: signal || undefined })
            .then((r) => {
                if (!r.ok) throw new Error(r.status);
                return r.json();
            });
    }

    function rejectAllDecryptWorkerPending(message) {
        for (const pending of decryptWorkerPending.values()) {
            try {
                pending.reject(new Error(message || 'Decrypt worker unavailable.'));
            } catch (_) {}
        }
        decryptWorkerPending.clear();
    }

    function ensureDecryptWorker() {
        if (decryptWorker) return decryptWorker;
        if (decryptWorkerFailed) return null;
        const WorkerCtor = ctx.WorkerCtor || (typeof Worker !== 'undefined' ? Worker : null);
        if (!WorkerCtor) {
            decryptWorkerFailed = true;
            return null;
        }

        try {
            const resolveAppUrl = typeof ctx.resolveAppUrl === 'function'
                ? ctx.resolveAppUrl
                : withAppRoot;
            decryptWorker = new WorkerCtor(ctx.decryptWorkerUrl || resolveAppUrl('/static/workers/decrypt-worker.js'));
        } catch (err) {
            console.warn('Decrypt worker init failed:', err);
            decryptWorkerFailed = true;
            decryptWorker = null;
            return null;
        }

        decryptWorker.addEventListener('message', (event) => {
            const data = event?.data || {};
            const requestId = String(data.requestId || '');
            if (!requestId) return;
            const pending = decryptWorkerPending.get(requestId);
            if (!pending) return;
            decryptWorkerPending.delete(requestId);

            if (data.success) {
                pending.resolve(Array.isArray(data.results) ? data.results : []);
                return;
            }
            pending.reject(new Error(String(data.error || 'Decrypt worker failed.')));
        });

        decryptWorker.addEventListener('error', (event) => {
            console.warn('Decrypt worker error:', event?.message || event);
            rejectAllDecryptWorkerPending('Decrypt worker crashed.');
            try {
                decryptWorker?.terminate();
            } catch (_) {}
            decryptWorker = null;
            decryptWorkerFailed = true;
        });

        return decryptWorker;
    }

    function requestDecryptBatchViaWorker(privateKeyPem, jobs) {
        const worker = ensureDecryptWorker();
        if (!worker || !privateKeyPem) {
            return Promise.resolve(null);
        }
        const list = Array.isArray(jobs) ? jobs : [];
        if (!list.length) {
            return Promise.resolve([]);
        }

        const requestId = `dec_${Date.now()}_${++decryptWorkerRequestSeq}`;
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                if (!decryptWorkerPending.has(requestId)) return;
                decryptWorkerPending.delete(requestId);
                reject(new Error('Decrypt worker timed out.'));
            }, ctx.chatDecryptWorkerTimeoutMs);

            decryptWorkerPending.set(requestId, {
                resolve: (result) => {
                    clearTimeout(timeoutId);
                    resolve(result);
                },
                reject: (err) => {
                    clearTimeout(timeoutId);
                    reject(err);
                },
            });

            try {
                worker.postMessage({
                    type: 'decrypt_batch',
                    requestId,
                    privateKeyPem,
                    jobs: list,
                });
            } catch (err) {
                clearTimeout(timeoutId);
                decryptWorkerPending.delete(requestId);
                reject(err);
            }
        });
    }

    async function decodeChatMessages(rawMessages) {
        const source = Array.isArray(rawMessages) ? rawMessages : [];
        if (!source.length) return [];

        const privateKeyPem = ctx.getPrivateKeyPem();
        const currentUserPublicKey = ctx.getCurrentUserPublicKey();
        const currentUserId = ctx.getCurrentUserId?.();
        const currentPartnerData = ctx.getCurrentPartnerData();
        const isMessageFromCurrentUser = (msg) => {
            const senderUserId = Number(msg?.sender_user_id);
            const normalizedCurrentUserId = Number(currentUserId);
            if (
                Number.isFinite(senderUserId)
                && senderUserId > 0
                && Number.isFinite(normalizedCurrentUserId)
                && normalizedCurrentUserId > 0
            ) {
                return senderUserId === normalizedCurrentUserId;
            }
            return String(msg?.sender_public_key || '').trim() === String(currentUserPublicKey || '').trim();
        };
        const toDecodedMessage = (msg, decMessage, replyText) => {
            const isSelf = isMessageFromCurrentUser(msg);
            const normalizedMentionedUserIds = normalizeMentionUserIds(msg.mentioned_user_ids);
            const normalizedMentionedUsernames = Array.isArray(msg.mentioned_usernames)
                ? msg.mentioned_usernames
                    .map((value) => String(value || '').trim().toLowerCase())
                    .filter(Boolean)
                : [];
            const normalizedGroupReaders = normalizeGroupReaders(msg.group_readers);
            const groupReadCountRaw = Number(msg.group_read_count);
            const normalizedGroupReadCount = Number.isFinite(groupReadCountRaw) && groupReadCountRaw >= 0
                ? Math.floor(groupReadCountRaw)
                : normalizedGroupReaders.length;
            return {
                id: msg.id,
                sender: isSelf ? 'self' : 'other',
                senderUserId: Number(msg.sender_user_id) || null,
                senderPublicKey: String(msg.sender_public_key || '').trim(),
                senderDisplayName: String(msg.sender_display_name || '').trim(),
                senderUsername: String(msg.sender_username || '').trim(),
                senderAvatarUrl: String(msg.sender_avatar_url || '').trim(),
                message: decMessage,
                message_type: msg.message_type || 'text',
                encrypted: ctx.isEncryptedPayload(msg.message),
                is_read: Boolean(msg.is_read),
                read_at: String(msg.read_at || '').trim() || null,
                is_delivered: Boolean(msg.is_delivered),
                voice_listened_by_partner: Boolean(msg.voice_listened_by_partner),
                is_edited: Boolean(msg.is_edited),
                created_at: msg.created_at,
                replyToId: msg.reply_to_id || null,
                replyToText: replyText,
                replyToSender: msg.reply_sender_pub === currentUserPublicKey
                    ? '\u0412\u044B'
                    : (currentPartnerData?.display_name || '\u0421\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A'),
                forwardFromName: String(msg.forward_from_name || '').trim(),
                forwardFromUserId: Number(msg.forward_from_user_id) || null,
                group_read_count: normalizedGroupReadCount,
                group_readers: normalizedGroupReaders,
                mentionedUserIds: normalizedMentionedUserIds,
                mentionedUsernames: normalizedMentionedUsernames,
                expires_at: msg.expires_at ? Number(msg.expires_at) : null,
                reactions: ctx.normalizeMessageReactions(msg.reactions),
                album_id: String(msg.album_id || '').trim() || null,
            };
        };

        if (privateKeyPem) {
            const workerJobs = source.map((msg, index) => ({
                index,
                message: msg.message,
                isSelf: isMessageFromCurrentUser(msg),
                senderPublicKey: String(msg.sender_public_key || '').trim(),
                hasReply: Boolean(msg.reply_to_id && msg.reply_message),
                replyMessage: msg.reply_message || '',
                replyIsSelf: msg.reply_sender_pub === currentUserPublicKey,
                replySenderPublicKey: String(msg.reply_sender_pub || '').trim(),
            }));

            try {
                const workerResults = await requestDecryptBatchViaWorker(privateKeyPem, workerJobs);
                if (Array.isArray(workerResults) && workerResults.length === source.length) {
                    const byIndex = new Map();
                    for (const item of workerResults) {
                        const index = Number(item?.index);
                        if (!Number.isFinite(index) || index < 0) continue;
                        byIndex.set(index, item);
                    }
                    if (byIndex.size === source.length) {
                        const decodedFromWorker = source.map((msg, index) => {
                            const item = byIndex.get(index) || {};
                            const decMessage = typeof item.message === 'string' ? item.message : (msg.message || '');
                            const replyText = (msg.reply_to_id && msg.reply_message)
                                ? (typeof item.reply === 'string' ? item.reply : '??')
                                : '';
                            return toDecodedMessage(msg, decMessage, replyText);
                        });
                        return ctx.enrichDecodedMessagesVisualMeta(decodedFromWorker);
                    }
                }
            } catch (err) {
                console.warn('Decrypt worker batch failed, fallback to main thread:', err);
            }
        }

        const decryptCache = new Map();
        const decryptCached = async (payload, isSelf, expectedSenderPublicKey = '') => {
            if (!ctx.isEncryptedPayload(payload)) return payload;
            const key = `${isSelf ? '1' : '0'}:${String(expectedSenderPublicKey || '')}:${String(payload || '')}`;
            if (!decryptCache.has(key)) {
                decryptCache.set(key, ctx.decryptForDisplay(privateKeyPem, payload, isSelf, expectedSenderPublicKey));
            }
            return decryptCache.get(key);
        };

        const decodedMessages = await mapWithConcurrency(
            source,
            ctx.chatDecryptConcurrency,
            async (msg) => {
                const isSelf = isMessageFromCurrentUser(msg);
                let decMessage = msg.message;
                decMessage = await decryptCached(msg.message, isSelf, String(msg.sender_public_key || '').trim());

                let replyText = '';
                if (msg.reply_to_id && msg.reply_message) {
                    const replyIsSelf = msg.reply_sender_pub === currentUserPublicKey;
                    try {
                        replyText = await decryptCached(msg.reply_message, replyIsSelf, String(msg.reply_sender_pub || '').trim());
                    } catch (_) {
                        replyText = '??';
                    }
                }

                return toDecodedMessage(msg, decMessage, replyText);
            },
        );
        return ctx.enrichDecodedMessagesVisualMeta(decodedMessages);
    }

    async function restorePinnedBar(pins, options = {}) {
        const normalizedPins = ctx.normalizePinnedMessages(pins);
        if (!normalizedPins.length) {
            ctx.hidePinnedBar();
            return;
        }

        const privateKeyPem = ctx.getPrivateKeyPem();
        const currentUserPublicKey = ctx.getCurrentUserPublicKey();
        const decryptedPins = await Promise.all(normalizedPins.map(async (pin) => {
            let pinPreview = pin.message_content || '';
            if (!privateKeyPem && ctx.isEncryptedPayload(pinPreview)) {
                pinPreview = '?? \u041F\u0440\u0438\u0432\u0430\u0442\u043D\u044B\u0439 \u043A\u043B\u044E\u0447 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D';
            } else {
                try {
                    const isSelf = pin.sender_pub === currentUserPublicKey;
                    pinPreview = await ctx.decryptForDisplay(privateKeyPem, pinPreview, isSelf, String(pin.sender_pub || '').trim());
                } catch (_) {}
            }
            return {
                messageId: pin.message_id,
                preview: pinPreview,
            };
        }));
        ctx.setPinnedBarMessages(decryptedPins, { activeMessageId: options.activeMessageId });
    }

    async function restoreFavoriteBar(favorites, options = {}) {
        const normalizedFavorites = ctx.normalizeFavoriteMessages(favorites);
        if (!normalizedFavorites.length) {
            ctx.hideFavoriteBar();
            return;
        }

        const privateKeyPem = ctx.getPrivateKeyPem();
        const currentUserPublicKey = ctx.getCurrentUserPublicKey();
        const decryptedFavorites = await Promise.all(normalizedFavorites.map(async (favorite) => {
            let favoritePreview = favorite.message_content || '';
            if (!privateKeyPem && ctx.isEncryptedPayload(favoritePreview)) {
                favoritePreview = '?? \u041f\u0440\u0438\u0432\u0430\u0442\u043d\u044b\u0439 \u043a\u043b\u044e\u0447 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d';
            } else {
                try {
                    const isSelf = favorite.sender_pub === currentUserPublicKey;
                    favoritePreview = await ctx.decryptForDisplay(privateKeyPem, favoritePreview, isSelf, String(favorite.sender_pub || '').trim());
                } catch (_) {}
            }
            return {
                messageId: favorite.message_id,
                preview: favoritePreview,
            };
        }));
        ctx.setFavoriteBarMessages(decryptedFavorites, { activeMessageId: options.activeMessageId });
    }

    function buildRenderableMessageSignature(messages) {
        const rows = Array.isArray(messages) ? messages : [];
        if (!rows.length) return 'empty';
        return rows.map((msg) => {
            const reactionSignature = Array.isArray(msg?.reactions)
                ? msg.reactions.map((reaction) => ([
                    String(reaction?.emoji || ''),
                    String(reaction?.count || 0),
                    String(Boolean(reaction?.reactedByCurrentUser)),
                ].join('\u001c'))).join('\u001d')
                : '';
            const groupReadersSignature = Array.isArray(msg?.group_readers)
                ? msg.group_readers.map((reader) => ([
                    String(reader?.user_id || reader?.userId || ''),
                    String(reader?.read_at || reader?.readAt || ''),
                ].join('\u001a'))).join('\u001b')
                : '';
            return [
                String(msg?.id || ''),
                String(msg?.sender || ''),
                String(msg?.senderUserId || ''),
                String(msg?.senderPublicKey || ''),
                String(msg?.senderDisplayName || ''),
                String(msg?.senderUsername || ''),
                String(msg?.senderAvatarUrl || ''),
                String(msg?.message || ''),
                String(msg?.message_type || ''),
                String(Boolean(msg?.encrypted)),
                String(Boolean(msg?.is_read)),
                String(msg?.read_at || ''),
                String(Boolean(msg?.is_delivered)),
                String(Boolean(msg?.voice_listened_by_partner)),
                String(Boolean(msg?.is_edited)),
                String(msg?.created_at || ''),
                String(msg?.replyToId || ''),
                String(msg?.replyToText || ''),
                String(msg?.replyToSender || ''),
                String(msg?.forwardFromName || ''),
                String(msg?.forwardFromUserId || ''),
                String(msg?.group_read_count || 0),
                groupReadersSignature,
                reactionSignature,
            ].join('\u001f');
        }).join('\u001e');
    }

    function hasRenderableMessageDiff(currentMessages, nextMessages) {
        const currentRows = Array.isArray(currentMessages) ? currentMessages : [];
        const nextRows = Array.isArray(nextMessages) ? nextMessages : [];
        if (currentRows.length !== nextRows.length) return true;
        return buildRenderableMessageSignature(currentRows) !== buildRenderableMessageSignature(nextRows);
    }

    function syncTotalMessagesFromResponse(state, response) {
        const total = Number(response?.total_messages);
        if (Number.isFinite(total) && total >= 0) {
            state.totalMessages = Math.floor(total);
        }
    }

    async function fetchChatHistory(chatId) {
        if (!chatId) return;

        const state = ctx.getChatState(chatId);
        if (state.isLoadingInitial) return;
        const requestToken = ++state.historyRequestToken;

        if (state.initialized) {
            ctx.applyChatBlockState(state.blockState || {}, { syncChatRoom: true });
            ctx.resetOpenChatUnreadCounter();
            ctx.showChatContent(true);
            ctx.setChatStageLoading(false);
            ctx.setHistoryLoading(false);
            await restorePinnedBar(state.pins || [], { activeMessageId: state.activePinMessageId });
            await restoreFavoriteBar(state.favorites || [], { activeMessageId: state.activeFavoriteMessageId });

            if (ctx.restoreChatDomSnapshot(chatId)) {
                ctx.setKeepChatPinnedToBottom(ctx.isChatNearBottom());
                ctx.schedulePostRenderUiRefresh({ searchFilter: true, jumpButton: true, e2ePill: true, expiryBadges: true, albums: true });
                return;
            }

            const restored = ctx.resolveSavedChatScrollTop(chatId);
            if (Number.isFinite(restored)) {
                ctx.renderChatMessages(chatId, { force: true, scrollTop: restored });
                ctx.setKeepChatPinnedToBottom(ctx.isChatNearBottom());
            } else {
                ctx.renderChatAtBottom(chatId);
            }
            return;
        }

        let restoredFromCache = false;
        if (!state.initialized && await ctx.ensureChatIdbReady()) {
            const cached = await ctx.readCachedMessages(chatId).catch(() => null);
            if (
                cached?.messages?.length
                && String(chatId) === String(ctx.getCurrentChatId())
                && requestToken === state.historyRequestToken
            ) {
                const decodedCachedMessages = await decodeChatMessages(cached.messages);
                if (String(chatId) === String(ctx.getCurrentChatId()) && requestToken === state.historyRequestToken) {
                    ctx.setChatMessages(chatId, decodedCachedMessages, { resetHeights: true });
                    decodedCachedMessages.forEach((msg) => state.renderedKeys.add(ctx.getMessageKey(msg)));
                    state.hasMoreBefore = true;
                    state.initialized = true;
                    state.savedScrollTop = 0;
                    state.hasSavedScrollTop = false;
                    restoredFromCache = true;
                    await ctx.renderChatMessagesStable(chatId, {
                        scrollToBottom: true,
                        animateReveal: shouldAnimateHistoryReveal(),
                    });
                    ctx.setKeepChatPinnedToBottom(true);
                    ctx.resetOpenChatUnreadCounter();
                    ctx.setChatStageLoading(false);
                    ctx.setHistoryLoading(false);
                }
            }
        }

        if (requestToken !== state.historyRequestToken) return;
        if (String(chatId) !== String(ctx.getCurrentChatId())) return;

        const requestController = ctx.createHistoryAbortController(
            ctx.historyInitialAbortControllers,
            chatId,
        );
        state.isLoadingInitial = true;
        const shouldShowNetworkLoading = !restoredFromCache;
        if (String(chatId) === String(ctx.getCurrentChatId())) {
            if (shouldShowNetworkLoading) {
                ctx.setChatStageLoading(true);
            }
        }
        try {
            const lastKnownId = state.messages.length
                ? Number(state.messages[state.messages.length - 1]?.id)
                : null;
            // After restoring from local cache, fetch a fresh window once so cached
            // status/reaction metadata for existing messages is synchronized.
            const useAfterId = !restoredFromCache && Number.isFinite(lastKnownId) && lastKnownId > 0;
            const response = await requestChatHistoryPage(chatId, {
                afterId: useAfterId ? lastKnownId : null,
                limit: ctx.chatHistoryPageSize,
                includePins: true,
                includeFavorites: true,
                signal: requestController.signal,
            });
            if (requestToken !== state.historyRequestToken) return;
            if (String(chatId) !== String(ctx.getCurrentChatId())) return;
            if (!response?.success || !Array.isArray(response.messages)) {
                if (!restoredFromCache) {
                    ctx.showToast('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u0447\u0430\u0442\u0430.', 'danger');
                }
                return;
            }
            syncTotalMessagesFromResponse(state, response);

            ctx.setChatPinnedMessages(chatId, response.pins || (response.pin ? [response.pin] : []), {
                activeMessageId: ctx.getChatState(chatId).activePinMessageId,
            });
            ctx.setChatFavoriteMessages(chatId, response.favorites || [], {
                activeMessageId: ctx.getChatState(chatId).activeFavoriteMessageId,
            });
            state.blockState = ctx.normalizeBlockState(response.block_state || state.blockState || {});
            ctx.applyChatBlockState(state.blockState, { syncChatRoom: true });
            if (typeof ctx.onAutoDeleteSecondsLoaded === 'function' && 'auto_delete_seconds' in response) {
                ctx.onAutoDeleteSecondsLoaded(chatId, Number(response.auto_delete_seconds) || 0);
            }
            ctx.hidePinnedBar();
            await restorePinnedBar(state.pins, { activeMessageId: state.activePinMessageId });
            ctx.hideFavoriteBar();
            await restoreFavoriteBar(state.favorites, { activeMessageId: state.activeFavoriteMessageId });
            ctx.resetOpenChatUnreadCounter();

            if (useAfterId) {
                state.initialized = true;
                state.hasMoreBefore = state.hasMoreBefore || Boolean(response.has_more_before);
                if (response.messages.length) {
                    const decodedDeltaMessages = await decodeChatMessages(response.messages);
                    if (requestToken !== state.historyRequestToken) return;
                    if (String(chatId) !== String(ctx.getCurrentChatId())) return;
                    decodedDeltaMessages.forEach((message) => {
                        ctx.upsertChatMessage(chatId, message, { append: true });
                        state.renderedKeys.add(ctx.getMessageKey(message));
                    });
                    ctx.renderChatMessages(chatId, {
                        force: true,
                        scrollToBottom: ctx.getKeepChatPinnedToBottom(),
                    });
                    ctx.appendEncryptedMessagesToCache(chatId, response.messages).catch(() => {});
                    ctx.pruneCachedChats(100).catch(() => {});
                }
            } else {
                const decodedMessages = await decodeChatMessages(response.messages);
                if (requestToken !== state.historyRequestToken) return;
                const shouldRerenderMessages = hasRenderableMessageDiff(state.messages, decodedMessages);
                if (shouldRerenderMessages) {
                    ctx.setChatMessages(chatId, decodedMessages, { resetHeights: true });
                    decodedMessages.forEach((msg) => state.renderedKeys.add(ctx.getMessageKey(msg)));
                    state.hasMoreBefore = Boolean(response.has_more_before);
                    state.initialized = true;
                    state.savedScrollTop = 0;
                    state.hasSavedScrollTop = false;

                    const storedTop = ctx.resolveSavedChatScrollTop(chatId);
                    if (Number.isFinite(storedTop)) {
                        await ctx.renderChatMessagesStable(chatId, {
                            scrollTop: storedTop,
                            animateReveal: shouldAnimateHistoryReveal(),
                            suppressHydrationMask: restoredFromCache,
                        });
                        ctx.setKeepChatPinnedToBottom(ctx.isChatNearBottom());
                    } else {
                        await ctx.renderChatMessagesStable(chatId, {
                            scrollToBottom: true,
                            animateReveal: shouldAnimateHistoryReveal(),
                            suppressHydrationMask: restoredFromCache,
                        });
                        ctx.setKeepChatPinnedToBottom(true);
                    }
                } else {
                    state.hasMoreBefore = Boolean(response.has_more_before);
                    state.initialized = true;
                    state.savedScrollTop = 0;
                    state.hasSavedScrollTop = false;
                    if (!state.lastRenderRange && state.messages.length === 0 && decodedMessages.length === 0) {
                        ctx.renderChatMessages(chatId, { force: true, scrollToBottom: true });
                        ctx.setKeepChatPinnedToBottom(true);
                    }
                }

                if (ctx.isChatIdbReady() && response.messages.length) {
                    const firstId = Number(response.messages[0]?.id) || 0;
                    const lastId = Number(response.messages[response.messages.length - 1]?.id) || 0;
                    ctx.writeCachedMessages(
                        chatId,
                        response.messages.slice(-INITIAL_SNAPSHOT_CACHE_LIMIT),
                        { firstId, lastId },
                    ).catch(() => {});
                    ctx.pruneCachedChats(100).catch(() => {});
                }
            }

            const contactItem = ctx.resolveContactItemByChatId(chatId);
            if (contactItem) {
                const badge = contactItem.querySelector('.unread-badge');
                if (badge) {
                    badge.style.display = 'none';
                    badge.textContent = '0';
                }
            }
            ctx.setChatStageLoading(false);
        } catch (error) {
            if (ctx.isAbortError(error)) return;
            if (String(chatId) === String(ctx.getCurrentChatId())) {
                ctx.setChatStageLoading(false);
                if (!restoredFromCache) {
                    ctx.showToast('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0438\u0441\u0442\u043E\u0440\u0438\u044E \u0447\u0430\u0442\u0430.', 'danger');
                }
            }
        } finally {
            ctx.releaseHistoryAbortController(
                ctx.historyInitialAbortControllers,
                chatId,
                requestController,
            );
            if (requestToken === state.historyRequestToken) {
                state.isLoadingInitial = false;
            }
            if (String(chatId) === String(ctx.getCurrentChatId())) {
                ctx.setChatStageLoading(false);
                ctx.setHistoryLoading(false);
            }
        }
    }

    async function loadOlderMessages(chatId) {
        const chatMessages = ctx.chatMessagesEl;
        if (!chatId || String(chatId) !== String(ctx.getCurrentChatId()) || !chatMessages) return false;

        const state = ctx.getChatState(chatId);
        if (
            !state.initialized
            || state.isLoadingInitial
            || state.isLoadingOlder
            || !state.hasMoreBefore
            || !state.messages.length
        ) {
            return false;
        }

        const oldestMessage = state.messages[0];
        const beforeId = Number(oldestMessage?.id);
        if (!Number.isFinite(beforeId) || beforeId <= 0) return false;

        state.isLoadingOlder = true;
        const requestToken = ++state.historyOlderToken;
        const previousScrollHeight = chatMessages.scrollHeight;
        const previousScrollTop = chatMessages.scrollTop;
        const requestController = ctx.createHistoryAbortController(
            ctx.historyOlderAbortControllers,
            chatId,
        );
        chatMessages.classList.add('is-loading-history');

        try {
            const response = await requestChatHistoryPage(chatId, {
                beforeId,
                limit: ctx.chatHistoryPageSize,
                includePins: false,
                includeFavorites: false,
                signal: requestController.signal,
            });
            if (requestToken !== state.historyOlderToken) return false;
            if (String(chatId) !== String(ctx.getCurrentChatId())) return false;
            if (!response?.success || !Array.isArray(response.messages) || response.messages.length === 0) {
                syncTotalMessagesFromResponse(state, response);
                state.hasMoreBefore = Boolean(response?.has_more_before);
                return false;
            }
            syncTotalMessagesFromResponse(state, response);

            const decodedMessages = await decodeChatMessages(response.messages);
            if (requestToken !== state.historyOlderToken) return false;
            ctx.prependChatMessages(chatId, decodedMessages);
            decodedMessages.forEach((msg) => state.renderedKeys.add(ctx.getMessageKey(msg)));
            state.hasMoreBefore = Boolean(response.has_more_before);
            ctx.renderChatMessages(chatId, {
                force: true,
                preserveHeightDelta: true,
                previousScrollHeight,
                previousScrollTop,
            });
            ctx.appendEncryptedMessagesToCache(chatId, response.messages).catch(() => {});
            return true;
        } catch (error) {
            if (ctx.isAbortError(error)) return false;
            if (String(chatId) === String(ctx.getCurrentChatId())) {
                ctx.showToast('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u0441\u0442\u0430\u0440\u044B\u0435 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F.', 'danger');
            }
            return false;
        } finally {
            ctx.releaseHistoryAbortController(
                ctx.historyOlderAbortControllers,
                chatId,
                requestController,
            );
            if (requestToken === state.historyOlderToken) {
                state.isLoadingOlder = false;
            }
            chatMessages.classList.remove('is-loading-history');
        }
    }

    function dispose() {
        if (!decryptWorker) return;
        rejectAllDecryptWorkerPending('Decrypt worker terminated.');
        try {
            decryptWorker.terminate();
        } catch (_) {}
        decryptWorker = null;
    }

    return {
        decodeChatMessages,
        restorePinnedBar,
        restoreFavoriteBar,
        fetchChatHistory,
        loadOlderMessages,
        rejectAllDecryptWorkerPending,
        dispose,
    };
}
