import { withAppRoot } from './app-url.js';
import {
    applyListPerfGuard,
    getMotionStaggerStartMs,
    getMotionStaggerStepMs,
    shouldAnimateListItem,
    waitForMotionEnd,
} from './motion.js';

export function initChatContactsSidebar({
    contactsList,
    escapeHtml,
    getPrivateKeyPem,
    isEncryptedPayload,
    decryptForDisplay,
    getCurrentUserId,
    getCurrentChatId,
    applyPinnedState,
    sortContactsList,
    buildContactItemHtml,
    applyEmojiGraphics,
    applyChatBlockState,
    updateActiveContactLastMessage,
    hideSidebarTyping,
    getPinnedContactsCount,
    showToast,
    restoreLastActiveChatSelection,
    hasAttemptedInitialChatRestore,
    setHasAttemptedInitialChatRestore,
    hideAppBootOverlay,
    onRemovedChatState,
    clearStoredLastActiveChatId,
    getStoredLastActiveChatId,
    onContactRendered,
    contactsReloadDebounceMs = 180,
} = {}) {
    let contactsReloadTimer = null;
    let contactsImmediateReloadTimer = null;
    let contactsLoadInFlight = null;
    let queuedContactsReloadOptions = null;
    let scheduledContactsReloadOptions = null;
    let lastContactsLoadStartedAt = 0;
    let lastFullContactsPayloadSignature = '';
    const CONTACTS_DECRYPT_CONCURRENCY = 6;
    const CONTACTS_MAX_LIMIT = 200;
    const CONTACTS_IMMEDIATE_MIN_INTERVAL_MS = 220;
    const CONTACTS_LOADING_EVENT = 'sun-contacts-loading';
    const ENCRYPTED_PREVIEW_LOADING_TOKEN = '__SUN_ENCRYPTED_LOADING__';
    const AVATAR_LOADING_BARS_HTML = `
        <span class="contact-avatar-loading" aria-hidden="true"></span>
    `.trim();

    function isStatusTrueFlag(value) {
        if (value === true || value === 1) return true;
        if (typeof value === 'string') {
            const normalized = value.trim().toLowerCase();
            return normalized === '1' || normalized === 'true' || normalized === 'yes';
        }
        return false;
    }

    function prefersReducedMotion() {
        if (document.documentElement.classList.contains('perf-lite')) {
            return true;
        }
        const motionLevel = String(document.documentElement.getAttribute('data-motion-level') || 'full').toLowerCase();
        if (motionLevel !== 'lite') {
            return false;
        }
        try {
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch (_) {
            return false;
        }
    }

    function syncSidebarLoadingShellState() {
        if (!contactsList) return;
        const sidebar = contactsList.closest('.sidebar');
        if (!sidebar) return;
        const shouldShowShellLoading = contactsList.dataset.contactsLoading === '1'
            && contactsList.dataset.contactsLoadingPartial !== '1';
        sidebar.classList.toggle('sidebar--loading', shouldShowShellLoading);
        sidebar.setAttribute('data-sidebar-loading', shouldShowShellLoading ? '1' : '0');
    }

    function setContactsLoadingState(isLoading, { partial = false } = {}) {
        if (!contactsList) return;
        const isFullLoading = Boolean(isLoading) && !partial;
        contactsList.dataset.contactsLoading = isLoading ? '1' : '0';
        contactsList.dataset.contactsLoadingPartial = partial ? '1' : '0';
        contactsList.setAttribute('aria-busy', isLoading ? 'true' : 'false');
        contactsList.classList.toggle('contacts-list--loading', isFullLoading);
        syncSidebarLoadingShellState();
        try {
            contactsList.dispatchEvent(new CustomEvent(CONTACTS_LOADING_EVENT, {
                detail: {
                    loading: Boolean(isLoading),
                    partial: Boolean(partial),
                },
            }));
        } catch (_) {
            // no-op: CustomEvent is best-effort for legacy WebViews
        }
    }

    syncSidebarLoadingShellState();

    function animateContactEntry(item, renderIndex = 0) {
        if (!item || prefersReducedMotion()) return;
        if (item.dataset.sidebarEntryAnimated === '1') return;
        const totalItems = contactsList?.children?.length || 0;
        if (!shouldAnimateListItem(renderIndex, totalItems)) return;
        item.dataset.sidebarEntryAnimated = '1';
        const safeIndex = Math.max(0, Number(renderIndex) || 0);
        const staggerStart = getMotionStaggerStartMs();
        const staggerStep = getMotionStaggerStepMs();
        const delay = Math.max(0, Math.round(staggerStart + (safeIndex * staggerStep)));
        item.style.setProperty('--contact-enter-delay', `${delay}ms`);
        item.classList.add('contact-entering');
        const cleanup = () => {
            item.classList.remove('contact-entering');
            item.style.removeProperty('--contact-enter-delay');
        };
        waitForMotionEnd(item, 360 + delay).then(cleanup);
    }

    function normalizeContactsLimit(rawLimit) {
        const parsed = Number.parseInt(rawLimit, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) return null;
        return Math.max(1, Math.min(parsed, CONTACTS_MAX_LIMIT));
    }

    function normalizeLoadContactsOptions(options = {}) {
        return {
            limit: normalizeContactsLimit(options?.limit),
            attemptInitialChatRestore: options?.attemptInitialChatRestore !== false,
        };
    }

    function buildContactsPayloadSignature(contacts) {
        const rows = Array.isArray(contacts) ? contacts : [];
        if (!rows.length) return 'empty';
        return rows.map((item) => ([
            String(item?.chatId || ''),
            String(item?.last_message || ''),
            String(item?.last_message_time || ''),
            String(item?.draft_text || ''),
            String(item?.draft_updated_at || ''),
            String(item?.unreadCount || 0),
            String(item?.message_count ?? item?.messageCount ?? 0),
            String(item?.last_sender_id || ''),
            String(item?.last_message_is_read || 0),
            String(item?.last_message_is_delivered || 0),
            String(item?.blocked_by_me || 0),
            String(item?.blocked_me || 0),
            String(item?.is_online || 0),
            String(item?.display_name || ''),
            String(item?.avatar_url || ''),
            String(item?.is_pinned || 0),
            String(item?.pin_order || 0),
        ].join('\u001f'))).join('\u001e');
    }

    function hasContactDraft(contact) {
        const draftText = String(contact?.draft_text || '');
        return Boolean(contact?.has_draft) && Boolean(draftText.trim());
    }

    function shouldRenderSidebarDraftPreview(contactChatId, currentChatId, hasDraft) {
        if (!hasDraft) return false;
        const normalizedContactChatId = String(contactChatId || '').trim();
        if (!normalizedContactChatId) return false;
        const normalizedCurrentChatId = String(currentChatId || '').trim();
        return !normalizedCurrentChatId || normalizedContactChatId !== normalizedCurrentChatId;
    }

    function buildGetContactsUrl(limit) {
        const params = new URLSearchParams();
        if (Number.isFinite(limit) && limit > 0) {
            params.set('limit', String(limit));
        }
        const query = params.toString();
        return withAppRoot(query ? `/get_contacts?${query}` : '/get_contacts');
    }

    async function runWithConcurrency(items, limit, worker) {
        const queue = Array.isArray(items) ? items : [];
        const concurrency = Math.max(1, Number(limit) || 1);
        let cursor = 0;

        async function consumeNext() {
            while (cursor < queue.length) {
                const index = cursor;
                cursor += 1;
                await worker(queue[index], index);
            }
        }

        const workers = Array.from(
            { length: Math.min(concurrency, queue.length) },
            () => consumeNext(),
        );
        await Promise.all(workers);
    }

        function updateGlobalUnreadTabCount() {
        let total = 0;
        document.querySelectorAll('#contactsList .contact-item .unread-badge').forEach(badge => {
            if (badge.style.display !== 'none') {
                const count = parseInt(badge.textContent, 10);
                if (!isNaN(count)) total += count;
            }
        });
        const tabBadge = document.getElementById('unreadTabCount');
        if (tabBadge) {
            tabBadge.textContent = total > 0 ? total : '';
        }
    }

    function updateDialogRequestsBadge(dialogRequestsList, dialogRequestsSection) {
        if (!dialogRequestsList || !dialogRequestsSection) return;
        const count = dialogRequestsList.children.length;
        const countEl = document.getElementById('requestsCount');
        if (countEl) countEl.textContent = count > 0 ? `(${count})` : '';
        const requestsShortcutCount = document.getElementById('requestsShortcutCount');
        if (requestsShortcutCount) requestsShortcutCount.textContent = count > 0 ? (count > 99 ? '99+' : String(count)) : '';
        const requestsShortcutBtn = document.getElementById('requestsShortcutBtn');
        if (requestsShortcutBtn) {
            requestsShortcutBtn.classList.toggle('sidebar-requests-shortcut--hidden', count <= 0);
        }
        const activeSidebarTab = String(
            document.body?.dataset?.sidebarTab
            || document.querySelector('.sidebar-tab.active')?.getAttribute('data-tab')
            || 'all',
        );
        if (count === 0) {
            dialogRequestsSection.classList.remove('has-requests');
            dialogRequestsSection.style.display = 'none';
            if (activeSidebarTab === 'requests' && typeof window.switchSidebarTab === 'function') {
                window.switchSidebarTab('all');
            }
        } else {
            dialogRequestsSection.classList.add('has-requests');
            dialogRequestsSection.style.display = activeSidebarTab === 'requests' ? '' : 'none';
        }
    }

    function reconcileContactsList(serverContacts) {
        if (!contactsList) return;
        const incoming = Array.isArray(serverContacts) ? serverContacts : [];
        const validChatIds = new Set(
            incoming
                .map((c) => String(c?.chatId || '').trim())
                .filter(Boolean),
        );

        const existingItems = Array.from(contactsList.querySelectorAll('.contact-item[data-chat-id]'));
        existingItems.forEach((item) => {
            const chatId = String(item.getAttribute('data-chat-id') || '').trim();
            if (!chatId || validChatIds.has(chatId)) return;

            item.remove();
            hideSidebarTyping(chatId);
            onRemovedChatState(chatId);
        });

        const storedChatId = getStoredLastActiveChatId();
        if (storedChatId && !validChatIds.has(storedChatId)) {
            clearStoredLastActiveChatId(storedChatId);
        }

        // Do not force-close the active chat on contacts refresh.
        // A full contacts payload can be temporarily incomplete (pagination, race with sync),
        // while the chat itself is still valid. Explicit chat removal is handled by socket events.
        applyListPerfGuard(contactsList, { total: contactsList.children.length });
    }

    async function updateContact(contact, renderIndex = 0, options = {}) {
        const animateEntry = options?.animateEntry !== false;
        const deferSort = options?.deferSort === true;
        try {
            const blockedByMe = Boolean(contact.blocked_by_me);
            const blockedMe = Boolean(contact.blocked_me);
            const isBlocked = blockedByMe || blockedMe;
            let displayLastMessage = contact.last_message || '';
            if (isBlocked) {
                displayLastMessage = blockedByMe ? '🚫 \u0412\u044B \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043B\u0438 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044F' : '🚫 \u0412\u044B \u0437\u0430\u0431\u043B\u043E\u043A\u0438\u0440\u043E\u0432\u0430\u043D\u044B';
            }

            const privateKeyPem = getPrivateKeyPem();
            if (!isBlocked && isEncryptedPayload(displayLastMessage) && privateKeyPem) {
                try {
                    const isSelf = String(contact.last_sender_id) === String(getCurrentUserId());
                    displayLastMessage = await decryptForDisplay(privateKeyPem, displayLastMessage, isSelf);
                } catch (_) {
                    displayLastMessage = ENCRYPTED_PREVIEW_LOADING_TOKEN;
                }
            } else if (!isBlocked && isEncryptedPayload(displayLastMessage)) {
                displayLastMessage = ENCRYPTED_PREVIEW_LOADING_TOKEN;
            }

            const isSelfContact = String(contact.last_sender_id) === String(getCurrentUserId());
            const isSavedMessagesContact = Boolean(contact?.is_saved_messages ?? contact?.isSavedMessages);
            const currentChatId = getCurrentChatId();
            const hasDraft = hasContactDraft(contact);
            let draftText = hasDraft ? String(contact.draft_text || '') : '';
            if (!isBlocked && hasDraft && isEncryptedPayload(draftText)) {
                const privateKeyPem = getPrivateKeyPem();
                if (privateKeyPem) {
                    try {
                        draftText = await decryptForDisplay(privateKeyPem, draftText, true);
                    } catch (_) {
                        draftText = ENCRYPTED_PREVIEW_LOADING_TOKEN;
                    }
                } else {
                    draftText = ENCRYPTED_PREVIEW_LOADING_TOKEN;
                }
            }
            const shouldRenderDraftPreview = shouldRenderSidebarDraftPreview(contact.chatId, currentChatId, hasDraft);
            const previewMessage = shouldRenderDraftPreview ? draftText : displayLastMessage;
            const previewIsSelf = shouldRenderDraftPreview || isSavedMessagesContact ? false : isSelfContact;
            const previewTimestamp = shouldRenderDraftPreview
                ? String(contact.draft_updated_at || contact.last_message_time || '').trim()
                : contact.last_message_time;
            const previewStatus = shouldRenderDraftPreview
                ? { pending: false, is_read: false, is_delivered: false }
                : {
                    is_read: isStatusTrueFlag(contact.last_message_is_read),
                    is_delivered: isStatusTrueFlag(contact.last_message_is_delivered),
                };
            const unreadCount = isSavedMessagesContact
                ? 0
                : Math.max(0, Number(contact.unreadCount) || 0);
            const unread = unreadCount > 0;
            const existing = contact.chatId
                ? document.querySelector(`.contact-item[data-chat-id="${CSS.escape(String(contact.chatId))}"]`)
                : null;
            if (existing) {
                const rawIsGroup = contact?.is_group;
                const isGroup = rawIsGroup === true
                    || rawIsGroup === 1
                    || rawIsGroup === '1'
                    || String(rawIsGroup || '').trim().toLowerCase() === 'true';
                const membersCount = Math.max(0, Number(contact?.members_count) || 0);
                const messageCount = Math.max(0, Number(contact?.message_count ?? contact?.messageCount) || 0);
                const shouldShowOnline = Boolean(contact.is_online) && !isBlocked;
                existing.setAttribute('data-blocked-by-me', blockedByMe ? '1' : '0');
                existing.setAttribute('data-blocked-me', blockedMe ? '1' : '0');
                existing.setAttribute('data-contact-id', contact.userId || '');
                existing.setAttribute('data-public-key', contact.public_key || '');
                existing.setAttribute('data-is-group', isGroup ? '1' : '0');
                existing.setAttribute('data-members-count', String(membersCount));
                existing.setAttribute('data-message-count', String(messageCount));
                existing.setAttribute('data-raw-last-message', String(contact.last_message || ''));
                existing.setAttribute('data-raw-last-message-time', String(contact.last_message_time || ''));
                existing.setAttribute('data-last-sender-id', String(contact.last_sender_id || ''));
                existing.setAttribute('data-last-seen', String(contact.last_seen || ''));
                existing.setAttribute('data-last-message-is-read', isStatusTrueFlag(contact.last_message_is_read) ? '1' : '0');
                existing.setAttribute('data-last-message-is-delivered', isStatusTrueFlag(contact.last_message_is_delivered) ? '1' : '0');
                existing.setAttribute('data-saved-messages', isSavedMessagesContact ? '1' : '0');
                existing.setAttribute('data-has-draft', hasDraft ? '1' : '0');
                existing.setAttribute('data-draft-text', draftText);
                existing.setAttribute('data-draft-updated-at', String(contact.draft_updated_at || ''));
                applyPinnedState(existing, {
                    isPinned: Boolean(contact.is_pinned),
                    pinOrder: contact.pin_order,
                    pinnedCount: getPinnedContactsCount(),
                });

                const existingInitials = String(contact.display_name || contact.username || '?')
                    .trim()
                    .split(/\s+/)
                    .slice(0, 2)
                    .map((word) => word[0])
                    .join('')
                    .toUpperCase();
                const avatarEl = existing.querySelector('.contact-avatar');
                if (avatarEl) {
                    const statusDot = avatarEl.querySelector('.status-dot');
                    const statusDotHtml = statusDot ? statusDot.outerHTML : '<div class="status-dot"></div>';
                    const nextAvatarUrl = String(contact.avatar_url || '').trim();
                    const hasAvatar = Boolean(nextAvatarUrl);
                    const currentAvatarImg = avatarEl.querySelector('img.contact-avatar__img');
                    const currentAvatarUrl = String(currentAvatarImg?.getAttribute('src') || '').trim();
                    const canReuseExistingAvatarImage = Boolean(
                        hasAvatar
                        && currentAvatarImg
                        && currentAvatarUrl === nextAvatarUrl,
                    );
                    if (canReuseExistingAvatarImage) {
                        currentAvatarImg.setAttribute('alt', contact.display_name || contact.username || 'Avatar');
                        avatarEl.classList.remove('avatar-loading');
                    } else {
                        const existingAvatarHtml = hasAvatar
                            ? `<img class="contact-avatar__img" src="${escapeHtml(nextAvatarUrl)}" alt="${escapeHtml(contact.display_name || contact.username || 'Avatar')}" loading="lazy" decoding="async">`
                            : escapeHtml(existingInitials);
                        avatarEl.classList.toggle('avatar-loading', hasAvatar);
                        avatarEl.innerHTML = `${existingAvatarHtml}${hasAvatar ? AVATAR_LOADING_BARS_HTML : ''}${statusDotHtml}`;
                    }
                }
                const nameEl = existing.querySelector('.contact-name');
                if (nameEl) {
                    nameEl.textContent = contact.display_name || contact.username || '';
                }
                existing.querySelector('.status-dot')?.classList.toggle('online', shouldShowOnline);
                const badge = existing.querySelector('.unread-badge');
                if (badge) {
                    badge.textContent = unread ? (unreadCount > 99 ? '99+' : unreadCount) : '';
                    badge.style.display = unread ? '' : 'none';
                    badge.classList.toggle('unread-badge--hidden', !unread);
                }
                hideSidebarTyping(contact.chatId);
                updateActiveContactLastMessage(
                    existing,
                    previewMessage,
                    previewIsSelf,
                    previewStatus,
                    previewTimestamp,
                    {
                        isDraft: shouldRenderDraftPreview,
                        draftText,
                        draftUpdatedAt: String(contact.draft_updated_at || ''),
                        preserveDraft: hasDraft && !shouldRenderDraftPreview,
                    },
                );
                if (!deferSort) {
                    sortContactsList?.();
                }
                if (String(contact.chatId) === String(currentChatId)) {
                    applyChatBlockState({ blocked_by_me: blockedByMe, blocked_me: blockedMe }, { syncChatRoom: false });
                }
                onContactRendered?.(existing, contact);
                return;
            }

            const contactHtml = buildContactItemHtml(
                {
                    ...contact,
                    last_message: displayLastMessage,
                    is_self_last_sender: isSelfContact,
                    blocked_by_me: blockedByMe,
                    blocked_me: blockedMe,
                    unreadCount,
                    is_saved_messages: isSavedMessagesContact,
                },
                currentChatId,
            );
            const wrapper = document.createElement('div');
            wrapper.innerHTML = contactHtml.trim();
            const nextItem = wrapper.firstElementChild;
            if (!nextItem) return;
            applyEmojiGraphics(nextItem.querySelector('.contact-last-msg'));
            if (deferSort) {
                contactsList?.appendChild(nextItem);
            } else {
                contactsList?.prepend(nextItem);
            }
            if (animateEntry) {
                animateContactEntry(nextItem, renderIndex);
            }
            onContactRendered?.(nextItem, contact);
            if (String(contact.chatId) === String(currentChatId)) {
                applyChatBlockState({ blocked_by_me: blockedByMe, blocked_me: blockedMe }, { syncChatRoom: false });
            }
        } catch (err) {
            console.error(`updateContact ERROR for ${contact.username}:`, err);
        }
    }

    function loadContactsNow(options = {}) {
        lastContactsLoadStartedAt = Date.now();
        const normalizedOptions = normalizeLoadContactsOptions(options);
        const limit = normalizedOptions.limit;
        const attemptInitialChatRestore = normalizedOptions.attemptInitialChatRestore;
        const isPartialLoad = Number.isFinite(limit) && limit > 0;
        const hasRenderedContactsBeforeLoad = Boolean(
            contactsList?.querySelector('.contact-item[data-chat-id]'),
        );
        const shouldShowBlockingShell = !isPartialLoad && !hasRenderedContactsBeforeLoad;
        const isNonBlockingLoad = isPartialLoad || !shouldShowBlockingShell;

        if (contactsLoadInFlight) {
            queuedContactsReloadOptions = normalizedOptions;
            return contactsLoadInFlight;
        }

        contactsLoadInFlight = new Promise((resolve) => {
            setContactsLoadingState(true, { partial: isNonBlockingLoad });
            const shouldBatchHydrate = !isPartialLoad;
            const previousScrollTop = contactsList?.scrollTop || 0;
            const previousScrollHeight = contactsList?.scrollHeight || 0;
            if (shouldBatchHydrate) {
                contactsList?.classList.add('is-hydrating-contacts');
            }
            const authAwareFetch = window.authFetch || window.fetch.bind(window);
            authAwareFetch(buildGetContactsUrl(limit), { credentials: 'same-origin' })
                .then((response) => response.json())
                .then(async (response) => {
                    try {
                        if (response.success && response.contacts) {
                            const orderedContacts = Array.isArray(response.contacts)
                                ? [...response.contacts]
                                : [];
                            if (!isPartialLoad) {
                                const hasRenderedContacts = Boolean(
                                    contactsList?.querySelector('.contact-item[data-chat-id]'),
                                );
                                const nextSignature = buildContactsPayloadSignature(orderedContacts);
                                const hasPendingEncryptedPreview = Boolean(
                                    contactsList?.querySelector('.contact-last-msg-loading'),
                                );
                                const canRetryEncryptedPreviewDecrypt = Boolean(
                                    getPrivateKeyPem() && window.e2e?.decryptMessageE2E,
                                );
                                if (
                                    hasRenderedContacts
                                    && nextSignature === lastFullContactsPayloadSignature
                                    && (!hasPendingEncryptedPreview || !canRetryEncryptedPreviewDecrypt)
                                ) {
                                    if (attemptInitialChatRestore && !hasAttemptedInitialChatRestore()) {
                                        setHasAttemptedInitialChatRestore(true);
                                        restoreLastActiveChatSelection();
                                    }
                                    hideAppBootOverlay();
                                    return;
                                }
                                lastFullContactsPayloadSignature = nextSignature;
                                reconcileContactsList(orderedContacts);
                            }
                            await runWithConcurrency(
                                orderedContacts,
                                shouldBatchHydrate ? 1 : CONTACTS_DECRYPT_CONCURRENCY,
                                (contact, index) => updateContact(contact, index, {
                                    animateEntry: !shouldBatchHydrate,
                                    deferSort: shouldBatchHydrate,
                                }),
                            );
                            sortContactsList();
                            if (shouldBatchHydrate && contactsList) {
                                const nextScrollHeight = contactsList.scrollHeight || 0;
                                const scrollDelta = nextScrollHeight - previousScrollHeight;
                                contactsList.scrollTop = previousScrollTop <= 2
                                    ? 0
                                    : Math.max(0, previousScrollTop + scrollDelta);
                            }
                            if (attemptInitialChatRestore && !hasAttemptedInitialChatRestore()) {
                                setHasAttemptedInitialChatRestore(true);
                                restoreLastActiveChatSelection();
                            }
                        }
                        hideAppBootOverlay();
                    } catch (err) {
                        console.error('loadContacts processing error:', err);
                    } finally {
                        if (shouldBatchHydrate) {
                            window.requestAnimationFrame(() => {
                                contactsList?.classList.remove('is-hydrating-contacts');
                            });
                        }
                        resolve();
                    }
                })
                .catch(() => {
                    if (shouldBatchHydrate) {
                        contactsList?.classList.remove('is-hydrating-contacts');
                    }
                    hideAppBootOverlay();
                    showToast('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044C \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u044B.', 'danger');
                    resolve();
                })
                .finally(() => {
                    setContactsLoadingState(false, { partial: isNonBlockingLoad });
                });
        });

        return contactsLoadInFlight.finally(() => {
            contactsLoadInFlight = null;
            if (!queuedContactsReloadOptions) return;
            const nextOptions = queuedContactsReloadOptions;
            queuedContactsReloadOptions = null;
            loadContacts({
                immediate: true,
                limit: nextOptions.limit,
                attemptInitialChatRestore: nextOptions.attemptInitialChatRestore,
            });
        });
    }

    function loadContacts({ immediate = false, ...options } = {}) {
        const normalizedOptions = normalizeLoadContactsOptions(options);

        if (immediate) {
            if (contactsReloadTimer) {
                clearTimeout(contactsReloadTimer);
                contactsReloadTimer = null;
            }
            scheduledContactsReloadOptions = null;
            const now = Date.now();
            const elapsed = now - lastContactsLoadStartedAt;
            const waitMs = Math.max(0, CONTACTS_IMMEDIATE_MIN_INTERVAL_MS - elapsed);
            if (waitMs <= 0) {
                if (contactsImmediateReloadTimer) {
                    clearTimeout(contactsImmediateReloadTimer);
                    contactsImmediateReloadTimer = null;
                }
                return loadContactsNow(normalizedOptions);
            }

            queuedContactsReloadOptions = normalizedOptions;
            if (contactsImmediateReloadTimer) {
                return Promise.resolve();
            }
            contactsImmediateReloadTimer = setTimeout(() => {
                contactsImmediateReloadTimer = null;
                const nextOptions = queuedContactsReloadOptions || normalizeLoadContactsOptions();
                queuedContactsReloadOptions = null;
                loadContactsNow(nextOptions);
            }, waitMs);
            return Promise.resolve();
        }

        if (contactsReloadTimer) {
            clearTimeout(contactsReloadTimer);
        }
        scheduledContactsReloadOptions = normalizedOptions;
        contactsReloadTimer = setTimeout(() => {
            contactsReloadTimer = null;
            const nextOptions = scheduledContactsReloadOptions || normalizeLoadContactsOptions();
            scheduledContactsReloadOptions = null;
            loadContactsNow(nextOptions);
        }, contactsReloadDebounceMs);
        return Promise.resolve();
    }

    function updateSidebarForOtherChat(
        chatId,
        message,
        isSelf,
        timestamp,
        status = { is_read: false, is_delivered: false },
        setContactUnreadBadge,
    ) {
        const contactItem = chatId
            ? document.querySelector(`.contact-item[data-chat-id="${CSS.escape(String(chatId))}"]`)
            : null;
        if (!contactItem) {
            loadContacts();
            return;
        }
        hideSidebarTyping(chatId);
        const badge = contactItem.querySelector('.unread-badge');
        if (badge && !isSelf) {
            const current = Number.parseInt(badge.textContent, 10) || 0;
            setContactUnreadBadge(chatId, current + 1);
        }
        updateActiveContactLastMessage(contactItem, message, isSelf, status, timestamp);
        sortContactsList?.();
    }

    return {
        updateDialogRequestsBadge,
        reconcileContactsList,
        updateContact,
        loadContactsNow,
        loadContacts,
        updateSidebarForOtherChat,
    };
}
