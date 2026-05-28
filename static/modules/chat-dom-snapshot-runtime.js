export function createChatDomSnapshotRuntime({
    snapshotLimit = 5,
    getChatMessages,
    getChatState,
    getExistingChatState,
    getCurrentChatId,
    getChatScrollPositions,
    renderChatMessages,
    setKeepChatPinnedToBottom,
    setSuppressChatScrollHandling,
    disconnectLazyMediaHydrationObserver,
    registerMediaElementsForLazyHydration,
    requestAnimationFrameFn,
    persistentStorage = null,
    persistentStorageKey = 'sun_chat_dom_snapshot_v1',
    persistentSnapshotMaxAgeMs = 30 * 60 * 1000,
    persistentSnapshotMaxHtmlLength = 650000,
    currentUserId = '',
} = {}) {
    const requestFrame = typeof requestAnimationFrameFn === 'function'
        ? requestAnimationFrameFn
        : (handler) => setTimeout(handler, 0);
    const chatDomSnapshotOrder = [];
    const snapshotVersion = 1;
    const normalizedCurrentUserId = String(currentUserId || '').trim();

    function getPersistentStorage() {
        if (persistentStorage) return persistentStorage;
        try {
            return globalThis.sessionStorage || null;
        } catch (_) {
            return null;
        }
    }

    function normalizeSnapshotSource(value) {
        return String(value || '').trim();
    }

    function sanitizeSnapshotFragment(root) {
        root?.querySelectorAll?.('script, iframe, object, embed')?.forEach((node) => node.remove());
        root?.querySelectorAll?.('*')?.forEach((node) => {
            Array.from(node.attributes || []).forEach((attr) => {
                if (String(attr.name || '').toLowerCase().startsWith('on')) {
                    node.removeAttribute(attr.name);
                }
            });
        });
    }

    function applySnapshotCspSafeStyles(root) {
        root?.querySelectorAll?.('.chat-virtual-spacer[data-spacer-height]')?.forEach((node) => {
            const height = Number.parseFloat(node.getAttribute('data-spacer-height') || '');
            if (Number.isFinite(height) && height >= 0) {
                node.style.height = `${Math.round(height)}px`;
            }
        });
        root?.querySelectorAll?.('[data-media-aspect-ratio]')?.forEach((node) => {
            const ratio = normalizeSnapshotSource(node.getAttribute('data-media-aspect-ratio'));
            if (ratio) node.style.setProperty('--media-aspect-ratio', ratio);
        });
        root?.querySelectorAll?.('[data-message-sender-color]')?.forEach((node) => {
            const color = normalizeSnapshotSource(node.getAttribute('data-message-sender-color'));
            if (color) node.style.setProperty('--message-sender-color', color);
        });
    }

    function markRestoredSnapshotMediaLoaded(mediaEl) {
        if (!mediaEl) return;
        mediaEl.setAttribute?.('data-loaded', '1');
        mediaEl.classList?.add?.('is-loaded');
        mediaEl.closest?.('.image-wrapper, .video-preview, .album-cell')?.classList?.add?.('is-loaded');
    }

    function wireRestoredSnapshotMediaState(root) {
        root?.querySelectorAll?.('.file-msg-img, .album-cell-img')?.forEach((imgEl) => {
            const markLoaded = () => markRestoredSnapshotMediaLoaded(imgEl);
            const markError = () => imgEl.closest?.('.image-wrapper, .album-cell')?.classList?.add?.('is-loaded');
            if (imgEl.complete && Number(imgEl.naturalWidth) > 0) {
                markLoaded();
                return;
            }
            imgEl.addEventListener?.('load', markLoaded, { once: true });
            imgEl.addEventListener?.('error', markError, { once: true });
        });
        root?.querySelectorAll?.('.file-msg-video-preview, .album-cell-video')?.forEach((videoEl) => {
            const markLoaded = () => markRestoredSnapshotMediaLoaded(videoEl);
            if (Number(videoEl.readyState) >= 1) {
                markLoaded();
                return;
            }
            videoEl.addEventListener?.('loadedmetadata', markLoaded, { once: true });
            videoEl.addEventListener?.('loadeddata', markLoaded, { once: true });
        });
    }

    function buildPersistentSnapshotHtml(chatMessages) {
        if (!chatMessages?.cloneNode) return '';
        const clone = chatMessages.cloneNode(true);
        sanitizeSnapshotFragment(clone);
        clone.querySelectorAll?.('.selected, .selecting, .msg-animate-in, .msg-animate-self, .msg-animate-other')
            ?.forEach((node) => {
                node.classList.remove('selected', 'selecting', 'msg-animate-in', 'msg-animate-self', 'msg-animate-other');
            });
        clone.querySelectorAll?.('.chat-virtual-spacer')?.forEach((node) => {
            const height = Number.parseFloat(node.style?.height || '');
            if (Number.isFinite(height) && height >= 0) {
                node.setAttribute('data-spacer-height', String(Math.round(height)));
            }
        });
        clone.querySelectorAll?.('[src]')?.forEach((node) => {
            const src = normalizeSnapshotSource(node.getAttribute('src'));
            if (!src.startsWith('blob:')) return;
            node.removeAttribute('src');
            node.removeAttribute('data-loaded');
            node.classList.remove('is-loaded');
            node.closest?.('.image-wrapper, .video-preview, .album-cell')?.classList?.remove?.('is-loaded');
        });
        return clone.innerHTML || '';
    }

    function writePersistentChatDomSnapshot(chatId, chatMessages, state, scrollTop) {
        const storage = getPersistentStorage();
        if (!storage || !chatId || !chatMessages) return;
        const html = buildPersistentSnapshotHtml(chatMessages);
        if (!html.trim() || html.length > persistentSnapshotMaxHtmlLength) {
            try { storage.removeItem(persistentStorageKey); } catch (_) {}
            return;
        }
        const payload = {
            version: snapshotVersion,
            userId: normalizedCurrentUserId,
            chatId: String(chatId),
            html,
            scrollTop: Math.max(0, Number(scrollTop) || 0),
            range: state?.lastRenderRange ? { ...state.lastRenderRange } : null,
            messagesLength: Array.isArray(state?.messages) ? state.messages.length : 0,
            savedAt: Date.now(),
        };
        try {
            storage.setItem(persistentStorageKey, JSON.stringify(payload));
        } catch (_) {}
    }

    function readPersistentChatDomSnapshot(chatId) {
        const storage = getPersistentStorage();
        if (!storage || !chatId) return null;
        try {
            const parsed = JSON.parse(storage.getItem(persistentStorageKey) || 'null');
            if (!parsed || parsed.version !== snapshotVersion) return null;
            if (String(parsed.userId || '') !== normalizedCurrentUserId) return null;
            if (String(parsed.chatId || '') !== String(chatId)) return null;
            if (!String(parsed.html || '').trim()) return null;
            const savedAt = Number(parsed.savedAt) || 0;
            if (savedAt && Date.now() - savedAt > persistentSnapshotMaxAgeMs) return null;
            return parsed;
        } catch (_) {
            return null;
        }
    }

    function touchChatDomSnapshotLRU(chatId) {
        const key = String(chatId);
        const idx = chatDomSnapshotOrder.indexOf(key);
        if (idx >= 0) chatDomSnapshotOrder.splice(idx, 1);
        chatDomSnapshotOrder.push(key);
        while (chatDomSnapshotOrder.length > snapshotLimit) {
            const oldKey = chatDomSnapshotOrder.shift();
            const oldState = getExistingChatState?.(oldKey);
            if (oldState) oldState.domSnapshot = null;
        }
    }

    function dropChatDomSnapshotLRU(chatId) {
        const key = String(chatId);
        const idx = chatDomSnapshotOrder.indexOf(key);
        if (idx >= 0) chatDomSnapshotOrder.splice(idx, 1);
    }

    function invalidateChatDomSnapshot(chatIdOrState) {
        const state = (chatIdOrState && typeof chatIdOrState === 'object' && 'messages' in chatIdOrState)
            ? chatIdOrState
            : (chatIdOrState ? getChatState?.(chatIdOrState) : null);
        if (!state) return;
        if (state.domSnapshot) state.domSnapshot = null;
        if (typeof chatIdOrState === 'string' || typeof chatIdOrState === 'number') {
            dropChatDomSnapshotLRU(chatIdOrState);
        }
    }

    function captureChatDomSnapshot(chatId) {
        const chatMessages = getChatMessages?.();
        if (!chatMessages || !chatId) return;
        const state = getChatState?.(chatId);
        if (!state?.initialized || !state.lastRenderRange) return;
        if (chatMessages.childNodes.length === 0) return;
        const nodes = Array.from(chatMessages.childNodes);
        const scrollTop = Math.max(0, chatMessages.scrollTop || 0);
        state.domSnapshot = {
            nodes,
            range: { ...state.lastRenderRange },
            scrollTop,
            messagesLength: state.messages.length,
        };
        writePersistentChatDomSnapshot(chatId, chatMessages, state, scrollTop);
        touchChatDomSnapshotLRU(chatId);
    }

    function restoreChatDomSnapshot(chatId) {
        const chatMessages = getChatMessages?.();
        if (!chatMessages || !chatId) return false;
        const state = getChatState?.(chatId);
        const snap = state?.domSnapshot;
        if (!snap || !snap.nodes?.length) return false;
        if (!state.lastRenderRange) return false;
        if (snap.range.start !== state.lastRenderRange.start || snap.range.end !== state.lastRenderRange.end) return false;
        if (snap.messagesLength !== state.messages.length) return false;
        try {
            chatMessages.replaceChildren(...snap.nodes);
        } catch (_) {
            return false;
        }
        disconnectLazyMediaHydrationObserver?.();
        registerMediaElementsForLazyHydration?.(chatMessages);
        state.domSnapshot = null;
        dropChatDomSnapshotLRU(chatId);

        const targetTop = Number.isFinite(snap.scrollTop) ? snap.scrollTop : 0;
        setSuppressChatScrollHandling?.(true);
        requestFrame(() => {
            const activeMessages = getChatMessages?.();
            if (!activeMessages) {
                setSuppressChatScrollHandling?.(false);
                return;
            }
            if (!chatId || String(chatId) !== String(getCurrentChatId?.())) {
                setSuppressChatScrollHandling?.(false);
                return;
            }
            activeMessages.scrollTop = targetTop;
            registerMediaElementsForLazyHydration?.(activeMessages);
            requestFrame(() => {
                const nextMessages = getChatMessages?.();
                if (
                    nextMessages
                    && chatId
                    && String(chatId) === String(getCurrentChatId?.())
                    && Math.abs(nextMessages.scrollTop - targetTop) > 1
                ) {
                    nextMessages.scrollTop = targetTop;
                }
                registerMediaElementsForLazyHydration?.(getChatMessages?.());
                setSuppressChatScrollHandling?.(false);
            });
        });
        return true;
    }

    function restorePersistentChatDomSnapshot(chatId) {
        const chatMessages = getChatMessages?.();
        if (!chatMessages || !chatId) return false;
        if (chatMessages.querySelector?.('.message[data-message-key]')) return false;
        const snap = readPersistentChatDomSnapshot(chatId);
        if (!snap) return false;

        const template = document.createElement('template');
        template.innerHTML = String(snap.html || '');
        sanitizeSnapshotFragment(template.content);
        try {
            chatMessages.replaceChildren(template.content);
        } catch (_) {
            return false;
        }

        applySnapshotCspSafeStyles(chatMessages);
        wireRestoredSnapshotMediaState(chatMessages);
        disconnectLazyMediaHydrationObserver?.();
        registerMediaElementsForLazyHydration?.(chatMessages);

        const state = getChatState?.(chatId);
        const targetTop = Math.max(0, Number(snap.scrollTop) || 0);
        if (state) {
            state.savedScrollTop = targetTop;
            state.hasSavedScrollTop = true;
        }
        setSuppressChatScrollHandling?.(true);
        requestFrame(() => {
            const activeMessages = getChatMessages?.();
            if (
                activeMessages
                && chatId
                && String(chatId) === String(getCurrentChatId?.())
            ) {
                activeMessages.scrollTop = targetTop;
                registerMediaElementsForLazyHydration?.(activeMessages);
            }
            setSuppressChatScrollHandling?.(false);
        });
        return true;
    }

    function resolveSavedChatScrollTop(chatId = getCurrentChatId?.()) {
        if (!chatId) return null;
        const key = String(chatId);
        const chatScrollPositions = getChatScrollPositions?.();
        if (chatScrollPositions?.has(key)) {
            const storedTop = Number(chatScrollPositions.get(key));
            if (Number.isFinite(storedTop)) return storedTop;
        }
        const state = getChatState?.(chatId);
        if (state?.hasSavedScrollTop && Number.isFinite(state.savedScrollTop)) {
            return state.savedScrollTop;
        }
        return null;
    }

    function renderChatAtBottom(chatId = getCurrentChatId?.()) {
        if (!chatId) return;
        renderChatMessages?.(chatId, { force: true, scrollToBottom: true });
        setKeepChatPinnedToBottom?.(true);
    }

    return {
        invalidateChatDomSnapshot,
        captureChatDomSnapshot,
        restoreChatDomSnapshot,
        restorePersistentChatDomSnapshot,
        resolveSavedChatScrollTop,
        renderChatAtBottom,
        dropChatDomSnapshotLRU,
    };
}
