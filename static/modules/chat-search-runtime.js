import { initSearchOverlayGlobalContent } from './search-overlay-global-content.js';
import { createUserSearchResultsRuntime } from './user-search-results.js';
import { getCsrfToken } from './csrf.js';

const RECENT_SEARCHES_KEY = 'sun_recent_searches';
const RECENT_SEARCHES_MAX = 8;

function loadRecentSearches() {
    try {
        return JSON.parse(localStorage.getItem(RECENT_SEARCHES_KEY) || '[]');
    } catch (_) {
        return [];
    }
}

function saveRecentSearches(list) {
    try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(list));
    } catch (_) {}
}

function addRecentSearch(query) {
    const trimmed = String(query || '').trim();
    if (!trimmed || trimmed.length < 2) return;
    let list = loadRecentSearches().filter((q) => q !== trimmed);
    list.unshift(trimmed);
    if (list.length > RECENT_SEARCHES_MAX) list = list.slice(0, RECENT_SEARCHES_MAX);
    saveRecentSearches(list);
}

export function createChatSearchRuntime({
    documentRef = document,
    windowRef = window,
    setTimeoutFn = setTimeout,
    requestAnimationFrameFn = requestAnimationFrame,
    contactsList,
    chatsSearchHint,
    paletteFrequentSection,
    paletteFrequentChats,
    paletteLocalSection,
    paletteLocalResults,
    commandPaletteActions,
    modalSearchInput,
    modalSearchResults,
    modalEl,
    withAppRoot,
    fetchImpl = fetch,
    decodeChatMessages,
    closeAnimatedDialog,
    openAnimatedDialog,
    showToast,
    sendDialogRequest,
    openGroupCreateModal,
    loadContacts,
    resolveContactItemByChatId,
    resolveContactItemByUserId,
    escapeHtml,
    applyFallbackAvatarTint,
    formatLastSeenText,
} = {}) {
    function setChatsSearchHintVisible(visible) {
        if (!chatsSearchHint) return;
        chatsSearchHint.style.display = visible ? '' : 'none';
    }

    function renderContactAvatarFromItem(item, className, fallbackName) {
        const sourceAvatarEl = item?.querySelector?.('.contact-avatar');
        const avatarTint = String(sourceAvatarEl?.getAttribute('data-avatar-tint') || '').trim();
        const avatarTintAttr = avatarTint
            ? ` data-avatar-tint="${escapeHtml(avatarTint)}"`
            : '';
        const imgEl = sourceAvatarEl?.querySelector?.('img.contact-avatar__img');
        const imgSrc = String(imgEl?.getAttribute('src') || '').trim();
        if (imgSrc) {
            const imgAlt = String(imgEl?.getAttribute('alt') || fallbackName || 'Avatar').trim();
            return `<div class="${className}"${avatarTintAttr}><img class="contact-avatar__img" src="${escapeHtml(imgSrc)}" alt="${escapeHtml(imgAlt)}" loading="lazy" decoding="async"></div>`;
        }
        const initials = String(sourceAvatarEl?.textContent || '').replace(/\s+/g, ' ').trim()
            || String(fallbackName || '?').slice(0, 2).toUpperCase();
        return `<div class="${className}"${avatarTintAttr}>${escapeHtml(initials)}</div>`;
    }

    // --- \u041d\u0435\u0434\u0430\u0432\u043d\u0438\u0435 \u043f\u043e\u0438\u0441\u043a\u0438 ---
    const recentSection = documentRef.getElementById('paletteRecentSearchSection');
    const recentResultsEl = documentRef.getElementById('paletteRecentSearchResults');
    const recentClearBtn = documentRef.getElementById('paletteRecentClearBtn');

    function renderRecentSearches() {
        if (!recentSection || !recentResultsEl) return;
        const list = loadRecentSearches();
        if (!list.length) {
            recentSection.hidden = true;
            return;
        }
        recentSection.hidden = false;
        recentResultsEl.innerHTML = list.map((q) => `
            <button type="button" class="palette-recent-item" data-recent-query="${escapeHtml(q)}">
                <span class="palette-recent-item-icon"><i class="bi bi-clock-history"></i></span>
                <span class="palette-recent-item-text">${escapeHtml(q)}</span>
            </button>
        `).join('');
    }

    recentClearBtn?.addEventListener('click', () => {
        saveRecentSearches([]);
        renderRecentSearches();
    });

    recentResultsEl?.addEventListener('click', (event) => {
        const btn = event.target.closest('.palette-recent-item');
        if (!btn) return;
        const query = String(btn.getAttribute('data-recent-query') || '').trim();
        if (!query) return;
        const visibleInput = documentRef.getElementById('searchInput');
        if (visibleInput) {
            visibleInput.value = query;
            visibleInput.dispatchEvent(new Event('input', { bubbles: true }));
            visibleInput.focus();
        }
    });

    // --- \u0421\u043a\u0440\u043e\u043b\u043b \u043a\u043e\u043b\u0451\u0441\u0438\u043a\u043e\u043c \u043f\u043e \u0447\u0430\u0441\u0442\u044b\u043c \u043a\u043e\u043d\u0442\u0430\u043a\u0442\u0430\u043c ---
    paletteFrequentChats?.addEventListener('wheel', (event) => {
        const hasOverflowX = paletteFrequentChats.scrollWidth > paletteFrequentChats.clientWidth + 1;
        if (!hasOverflowX) return;
        const deltaMode = Number(event.deltaMode) || 0;
        const unit = deltaMode === 1 ? 16 : (deltaMode === 2 ? paletteFrequentChats.clientWidth : 1);
        const deltaX = Number(event.deltaX || 0) * unit;
        const deltaY = Number(event.deltaY || 0) * unit;
        const primary = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
        if (!Number.isFinite(primary) || primary === 0) return;
        const before = paletteFrequentChats.scrollLeft;
        paletteFrequentChats.scrollLeft += primary;
        if (paletteFrequentChats.scrollLeft !== before) event.preventDefault();
    }, { passive: false });

    function getActiveChatId() {
        const activeItem = documentRef.querySelector('#contactsList .contact-item.active');
        return activeItem ? String(activeItem.getAttribute('data-chat-id') || '') : '';
    }

    function renderFrequentChats() {
        if (!paletteFrequentSection || !paletteFrequentChats) return;

        const activeChatId = getActiveChatId();

        const allItems = Array.from(documentRef.querySelectorAll('#contactsList .contact-item[data-chat-id]'));
        const frequentItems = allItems
            .filter((item) => {
                return String(item.getAttribute('data-is-group') || '0') !== '1';
            })
            .sort((a, b) => {
                const aPinned = String(a.getAttribute('data-pinned') || '') === '1';
                const bPinned = String(b.getAttribute('data-pinned') || '') === '1';
                if (aPinned !== bPinned) return aPinned ? -1 : 1;

                const aTs = Number(a.getAttribute('data-last-message-ts') || 0);
                const bTs = Number(b.getAttribute('data-last-message-ts') || 0);
                if (aTs !== bTs) return bTs - aTs;

                const aName = String(a.querySelector('.contact-name')?.textContent || '').toLowerCase();
                const bName = String(b.querySelector('.contact-name')?.textContent || '').toLowerCase();
                return aName.localeCompare(bName);
            })
            .slice(0, 10);

        if (!frequentItems.length) {
            paletteFrequentSection.style.display = 'none';
            paletteFrequentChats.innerHTML = '';
            return;
        }

        paletteFrequentSection.style.display = '';
        paletteFrequentChats.innerHTML = frequentItems.map((item) => {
            const chatId = escapeHtml(String(item.getAttribute('data-chat-id') || ''));
            const rawName = String(item.querySelector('.contact-name')?.textContent || '\u0427\u0430\u0442');
            const name = escapeHtml(rawName);
            const isActive = activeChatId && chatId === escapeHtml(activeChatId) ? ' is-active-chat' : '';
            const avatarHtml = renderContactAvatarFromItem(item, 'contact-avatar search-frequent-chat-btn-avatar', rawName);
            return `
                <button type="button" class="search-frequent-chat-btn${isActive}" data-chat-id="${chatId}">
                    ${avatarHtml}
                    <span class="search-frequent-chat-btn-name">${name}</span>
                </button>
            `;
        }).join('');

        paletteFrequentChats.querySelectorAll('.search-frequent-chat-btn .contact-avatar').forEach((avatarEl) => {
            if (avatarEl.querySelector('img')) return;
            const label = String(
                avatarEl.closest('.search-frequent-chat-btn')?.querySelector('.search-frequent-chat-btn-name')?.textContent
                || '',
            ).trim();
            applyFallbackAvatarTint(avatarEl, label);
        });
    }

    function renderPaletteLocalMatches(query) {
        if (!paletteLocalSection || !paletteLocalResults) return;

        const normalizedQuery = String(query || '').trim().toLowerCase();
        if (!normalizedQuery) {
            paletteLocalSection.style.display = 'none';
            paletteLocalResults.innerHTML = '';
            renderFrequentChats();
            renderRecentSearches();
            setChatsSearchHintVisible(false);
            return;
        }

        if (recentSection) recentSection.hidden = true;

        if (paletteFrequentSection) {
            paletteFrequentSection.style.display = 'none';
        }

        const items = Array.from(documentRef.querySelectorAll('#contactsList .contact-item'));
        const matches = items.filter((item) => {
            const name = String(item.querySelector('.contact-name')?.textContent || '').toLowerCase();
            const username = String(item.querySelector('.contact-last-msg')?.textContent || '').toLowerCase();
            const publicKey = String(item.getAttribute('data-public-key') || '').toLowerCase();
            return name.includes(normalizedQuery) || username.includes(normalizedQuery) || publicKey.includes(normalizedQuery);
        }).slice(0, 8);

        if (!matches.length) {
            paletteLocalSection.style.display = 'none';
            paletteLocalResults.innerHTML = '';
            setChatsSearchHintVisible(true);
            return;
        }

        setChatsSearchHintVisible(false);
        paletteLocalSection.style.display = '';
        paletteLocalResults.innerHTML = matches.map((item) => {
            const rawName = String(item.querySelector('.contact-name')?.textContent || '\u0427\u0430\u0442');
            const name = escapeHtml(rawName);
            const sub = escapeHtml(String(item.querySelector('.contact-last-msg')?.textContent || ''));
            const chatId = escapeHtml(String(item.getAttribute('data-chat-id') || ''));
            const avatarHtml = renderContactAvatarFromItem(item, 'contact-avatar command-palette-result-avatar', rawName);
            return `
                <div class="command-palette-result">
                    <div class="command-palette-result-meta">
                        ${avatarHtml}
                        <div class="command-palette-result-copy">
                            <strong>${name}</strong>
                            <span>${sub}</span>
                        </div>
                    </div>
                    <button type="button" class="command-palette-result-btn open-chat-btn" data-chat-id="${chatId}">
                        \u041E\u0442\u043A\u0440\u044B\u0442\u044C
                    </button>
                </div>
            `;
        }).join('');
        paletteLocalResults.querySelectorAll('.command-palette-result .contact-avatar').forEach((avatarEl) => {
            if (avatarEl.querySelector('img')) return;
            const label = String(
                avatarEl.closest('.command-palette-result')?.querySelector('.command-palette-result-copy strong')?.textContent
                || '',
            ).trim();
            applyFallbackAvatarTint(avatarEl, label);
        });
    }

    function openPaletteChat(chatId) {
        if (!chatId || !contactsList) return;
        const item = resolveContactItemByChatId?.(chatId);
        if (!item) return;
        const visibleInput = documentRef.getElementById('searchInput');
        const currentQuery = String(visibleInput?.value || '').trim();
        if (currentQuery.length >= 2) addRecentSearch(currentQuery);
        if (typeof windowRef.closeCommandPalette === 'function') {
            windowRef.closeCommandPalette();
        } else {
            closeAnimatedDialog?.(documentRef.getElementById('newChatModal'));
        }
        item.click();
    }

    function buildSearchResultsLoaderHtml() {
        return `
            <div class="search-results-loader" role="status" aria-live="polite">
                <div class="search-results-loader__item">
                    <div class="search-results-loader__avatar sun-skeleton-block"></div>
                    <div class="search-results-loader__lines">
                        <div class="sun-skeleton-line"></div>
                        <div class="sun-skeleton-line"></div>
                    </div>
                </div>
                <div class="search-results-loader__item">
                    <div class="search-results-loader__avatar sun-skeleton-block"></div>
                    <div class="search-results-loader__lines">
                        <div class="sun-skeleton-line"></div>
                        <div class="sun-skeleton-line"></div>
                    </div>
                </div>
            </div>
        `;
    }

    function normalizeSearchUser(user) {
        if (!user || typeof user !== 'object') return null;
        const parsedId = Number.parseInt(user.userId ?? user.user_id, 10);
        if (!Number.isFinite(parsedId) || parsedId <= 0) return null;
        const displayName = String(user.display_name || user.username || `\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C ${parsedId}`).trim();
        const username = String(user.username || '').trim();
        const avatarUrl = String(user.avatar_url || '').trim();
        const canGroupAddDirect = user.can_group_add_direct !== false;
        return {
            user_id: parsedId,
            display_name: displayName || `\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C ${parsedId}`,
            username,
            avatar_url: avatarUrl,
            can_group_add_direct: canGroupAddDirect,
        };
    }

    async function openChatByIdWhenReady(chatId) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return;

        const maxAttempts = 8;
        const retryDelayMs = 220;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
            const contactItem = resolveContactItemByChatId?.(normalizedChatId);
            if (contactItem) {
                contactItem.click();
                return;
            }
            await new Promise((resolve) => setTimeoutFn(resolve, retryDelayMs));
            if (attempt === 2 || attempt === 5) {
                await loadContacts?.({ immediate: true, attemptInitialChatRestore: false });
            }
        }
    }

    const searchOverlayGlobalContentController = initSearchOverlayGlobalContent({
        overlayEl: modalEl,
        resolveAppUrl: withAppRoot,
        fetchImpl: windowRef.authFetch || windowRef.fetch?.bind(windowRef) || fetchImpl,
        decodeMessages: (messages) => decodeChatMessages?.(messages),
        contactsRoot: contactsList,
        openChatById: (chatId) => openChatByIdWhenReady(chatId),
        focusMessageInCurrentChat: (msgId, options) => windowRef._scrollToMsg?.(msgId, options),
        closeOverlay: () => {
            if (typeof windowRef.closeCommandPalette === 'function') {
                windowRef.closeCommandPalette();
                return;
            }
            closeAnimatedDialog?.(documentRef.getElementById('newChatModal'));
        },
        showToast,
    });

    modalEl?.addEventListener('sun-search-overlay-tab-changed', (event) => {
        const tabId = String(event?.detail?.tabId || '').trim();
        if (tabId === 'chats') {
            const visibleSearchInput = documentRef.getElementById('searchInput');
            const query = String(visibleSearchInput?.value || '').trim();
            renderPaletteLocalMatches(query);
            searchOverlayGlobalContentController?.refreshChatLookup?.();
            return;
        }
        if (tabId === 'contacts') {
            modalSearchInput?.dispatchEvent(new Event('input', { bubbles: true }));
        }
    });

    commandPaletteActions?.addEventListener('click', (event) => {
        const actionBtn = event.target.closest('[data-palette-action]');
        if (!actionBtn) return;
        const action = String(actionBtn.getAttribute('data-palette-action') || '').trim();
        if (action === 'contact') {
            documentRef.querySelector('.search-overlay__tab[data-search-tab="contacts"]')?.click();
            documentRef.getElementById('searchInput')?.focus();
            return;
        }
        if (action === 'settings') {
            windowRef.closeCommandPalette?.() || closeAnimatedDialog?.(documentRef.getElementById('newChatModal'));
            windowRef.openSettingsOverlay?.('settings');
            return;
        }
        if (action === 'qr') {
            windowRef.closeCommandPalette?.() || closeAnimatedDialog?.(documentRef.getElementById('newChatModal'));
            windowRef.openMyQrModal?.();
            return;
        }

        if (action === 'group') {
            windowRef.closeCommandPalette?.() || closeAnimatedDialog?.(documentRef.getElementById('newChatModal'));
            openGroupCreateModal?.();
            return;
        }

        if (action === 'theme') {
            documentRef.getElementById('sidebarThemeToggleBtn')?.click();
            windowRef.closeCommandPalette?.();
            return;
        }

        documentRef.getElementById('searchInput')?.focus();
    });

    modalEl?.addEventListener('click', (event) => {
        const qrBtn = event.target.closest('.user-search-panel__qr[data-palette-action="qr"]');
        if (!qrBtn) return;
        windowRef.closeCommandPalette?.() || closeAnimatedDialog?.(documentRef.getElementById('newChatModal'));
        windowRef.openMyQrModal?.();
    });

    paletteLocalResults?.addEventListener('click', (event) => {
        const openBtn = event.target.closest('.open-chat-btn');
        if (!openBtn) return;
        openPaletteChat(openBtn.getAttribute('data-chat-id'));
    });

    paletteFrequentChats?.addEventListener('click', (event) => {
        const openBtn = event.target.closest('.search-frequent-chat-btn');
        if (!openBtn) return;
        openPaletteChat(openBtn.getAttribute('data-chat-id'));
    });

    function isContactsSearchTabActive() {
        const activeTab = documentRef.querySelector('.search-overlay__tab.is-active[data-search-tab]');
        return String(activeTab?.getAttribute('data-search-tab') || '') === 'contacts';
    }

    function translateSearchLabel(value) {
        const i18nApi = windowRef.SUN_I18N;
        if (i18nApi && typeof i18nApi.translateText === 'function') {
            return i18nApi.translateText(String(value ?? ''));
        }
        return String(value ?? '');
    }

    function isRemoteUserSearchReady(query) {
        return query.length >= 3 || query.length > 40 || query.includes('BEGIN') || query.includes('PUBLIC');
    }

    async function acceptSearchDialogRequest(senderPublicKey) {
        const normalizedKey = String(senderPublicKey || '').trim();
        if (!normalizedKey) {
            return { success: false, error: translateSearchLabel('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u0438\u043D\u044F\u0442\u044C \u0437\u0430\u043F\u0440\u043E\u0441.') };
        }
        try {
            const response = await fetchImpl(withAppRoot('/accept_request'), {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({ sender_public_key: normalizedKey }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.success) {
                return {
                    success: false,
                    error: payload?.error || translateSearchLabel('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u0438\u043D\u044F\u0442\u044C \u0437\u0430\u043F\u0440\u043E\u0441.'),
                };
            }
            await loadContacts?.({ immediate: true, attemptInitialChatRestore: false });
            if (payload.chat_id) {
                await openChatByIdWhenReady(payload.chat_id);
            }
            return payload;
        } catch (err) {
            console.warn('[UserSearch] accept request failed', err);
            return { success: false, error: translateSearchLabel('\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u0440\u0438\u043D\u044F\u0442\u044C \u0437\u0430\u043F\u0440\u043E\u0441.') };
        }
    }

    const userSearchResultsRuntime = createUserSearchResultsRuntime({
        contactsRoot: contactsList,
        resultsRoot: modalSearchResults,
        escapeHtml,
        applyFallbackAvatarTint,
        translateLabel: translateSearchLabel,
        resolveContactItemByUserId,
        openChatById: openPaletteChat,
        sendDialogRequest,
        acceptDialogRequest: acceptSearchDialogRequest,
        showToast,
    });

    let remoteUserSearchTimer = 0;
    let remoteUserSearchSeq = 0;
    let remoteUserSearchAbortController = null;

    function cancelRemoteUserSearch() {
        remoteUserSearchSeq += 1;
        if (remoteUserSearchTimer) {
            windowRef.clearTimeout(remoteUserSearchTimer);
            remoteUserSearchTimer = 0;
        }
        if (remoteUserSearchAbortController) {
            remoteUserSearchAbortController.abort();
            remoteUserSearchAbortController = null;
        }
    }

    function runRemoteContactsSearch(query) {
        if (!modalSearchResults) return;
        const requestSeq = ++remoteUserSearchSeq;
        if (remoteUserSearchAbortController) {
            remoteUserSearchAbortController.abort();
            remoteUserSearchAbortController = null;
        }
        const AbortControllerCtor = windowRef.AbortController;
        remoteUserSearchAbortController = typeof AbortControllerCtor === 'function'
            ? new AbortControllerCtor()
            : null;
        const fetchOptions = remoteUserSearchAbortController
            ? { signal: remoteUserSearchAbortController.signal }
            : undefined;

        fetchImpl(withAppRoot(`/search_users?q=${encodeURIComponent(query)}&limit=20`), fetchOptions)
            .then(r => r.json())
            .then(response => {
                if (requestSeq !== remoteUserSearchSeq) return;
                const results = response.results || response.users || [];
                userSearchResultsRuntime.render({
                    query,
                    remoteResults: response.success && results ? results : [],
                    remoteState: response.success ? 'loaded' : 'error',
                    minQueryLength: response.min_query_length || 3,
                });
            })
            .catch((err) => {
                if (err?.name === 'AbortError' || requestSeq !== remoteUserSearchSeq) return;
                userSearchResultsRuntime.render({ query, remoteState: 'error' });
            });
    }

    function scheduleRemoteContactsSearch(query) {
        remoteUserSearchSeq += 1;
        if (remoteUserSearchTimer) {
            windowRef.clearTimeout(remoteUserSearchTimer);
            remoteUserSearchTimer = 0;
        }
        if (remoteUserSearchAbortController) {
            remoteUserSearchAbortController.abort();
            remoteUserSearchAbortController = null;
        }
        userSearchResultsRuntime.render({ query, remoteState: 'loading' });
        remoteUserSearchTimer = windowRef.setTimeout(() => {
            remoteUserSearchTimer = 0;
            runRemoteContactsSearch(query);
        }, 220);
    }

    if (modalSearchInput) {
        modalSearchInput.addEventListener('input', function() {
            const query = modalSearchInput.value.trim();
            renderPaletteLocalMatches(query);
            const contactsTabActive = isContactsSearchTabActive();
            if (!contactsTabActive) {
                cancelRemoteUserSearch();
                return;
            }
            if (!query || !isRemoteUserSearchReady(query)) {
                cancelRemoteUserSearch();
                userSearchResultsRuntime.render({ query, remoteState: 'idle' });
                return;
            }
            scheduleRemoteContactsSearch(query);
        });
    }

    if (modalSearchResults) {
        modalSearchResults.addEventListener('click', function(e) {
            if (userSearchResultsRuntime.handleClick(e)) {
                const button = e.target instanceof Element ? e.target.closest('.send-request-btn') : null;
                if (button) {
                    const visibleInput = documentRef.getElementById('searchInput');
                    const currentQuery = String(visibleInput?.value || '').trim();
                    if (currentQuery.length >= 2) addRecentSearch(currentQuery);
                }
            }
        });
    }

    function openCommandPaletteModal() {
        if (typeof windowRef.openCommandPalette === 'function' && windowRef.openCommandPalette !== openCommandPaletteModal) {
            windowRef.openCommandPalette('');
            return;
        }
        const modal = documentRef.getElementById('newChatModal');
        const input = documentRef.getElementById('searchUserInput');
        const results = documentRef.getElementById('searchUserResults');
        if (!modal) return;
        if (results) results.innerHTML = '';
        if (input) input.value = '';
        openAnimatedDialog?.(modal, { focusTarget: input });
        requestAnimationFrameFn(() => {
            try { input?.focus({ preventScroll: true }); } catch (_) {}
        });
    }

    documentRef.getElementById('emptyStatePrimaryBtn')?.addEventListener('click', () => {
        windowRef.openCommandPalette?.();
    });

    documentRef.getElementById('emptyStateSecondaryBtn')?.addEventListener('click', () => {
        windowRef.openMyQrModal?.();
    });

    return {
        setChatsSearchHintVisible,
        renderFrequentChats,
        renderPaletteLocalMatches,
        renderRecentSearches,
        openPaletteChat,
        buildSearchResultsLoaderHtml,
        normalizeSearchUser,
        openChatByIdWhenReady,
        openCommandPaletteModal,
    };
}
