export function createChatSettingsRuntime({
    uiState,
    chatArea,
    chatStates,
    chatMessages,
    getCurrentChatId,
    renderChatMessages,
    chatDefaultMessageHeight,
    messageScaleStorageKey,
    timeFormatStorageKey,
    refreshVisibleTimePreferenceRendering,
    muteChatBtn,
    toggleCurrentChatMuted,
    closeHeaderDropdown,
    e2eIndicator,
    documentRef = document,
    windowRef = window,
} = {}) {
    const MESSAGE_SCALE_MOBILE_QUERY = '(max-width: 768px)';

    function ChatContainer(chatId = getCurrentChatId(), options = {}) {
        renderChatMessages(chatId, options);
    }

    function isMobileMessageScaleScope() {
        if (typeof windowRef.matchMedia === 'function') {
            return Boolean(windowRef.matchMedia(MESSAGE_SCALE_MOBILE_QUERY).matches);
        }
        return Number(windowRef.innerWidth || 0) > 0 && Number(windowRef.innerWidth) <= 768;
    }

    function getMessageScaleScope() {
        return isMobileMessageScaleScope() ? 'mobile' : 'desktop';
    }

    function getScopedMessageScaleStorageKey(scope = getMessageScaleScope()) {
        return `${messageScaleStorageKey}:${scope}`;
    }

    function readStoredMessageScale() {
        try {
            const scope = getMessageScaleScope();
            const scopedValue = windowRef.localStorage?.getItem(getScopedMessageScaleStorageKey(scope));
            if (scopedValue !== null && scopedValue !== undefined) return scopedValue;
            return scope === 'desktop'
                ? windowRef.localStorage?.getItem(messageScaleStorageKey)
                : null;
        } catch (_) {
            return null;
        }
    }

    function persistMessageScale(scale) {
        try {
            const scope = getMessageScaleScope();
            const value = scale.toFixed(2);
            windowRef.localStorage?.setItem(getScopedMessageScaleStorageKey(scope), value);
            if (scope === 'desktop') {
                windowRef.localStorage?.setItem(messageScaleStorageKey, value);
            }
        } catch (_) {
            // Ignore storage write failures.
        }
    }

    function clampMessageScale(value) {
        const parsed = Number.parseFloat(value);
        if (!Number.isFinite(parsed)) return 1;
        return Math.min(1.3, Math.max(0.9, parsed));
    }

    function applyMessageScale(value, { persist = true, rerender = true } = {}) {
        const scale = clampMessageScale(value);
        uiState.messageScale = scale;

        if (chatArea) {
            chatArea.style.setProperty('--chat-message-scale', scale.toFixed(2));
        }
        chatStates.forEach((chatState) => {
            chatState.messageHeights = new Map();
            chatState.averageMessageHeight = chatDefaultMessageHeight;
            chatState.lastRenderRange = null;
        });

        if (persist) {
            persistMessageScale(scale);
        }

        const currentChatId = getCurrentChatId();
        if (rerender && currentChatId && chatMessages) {
            ChatContainer(currentChatId, { force: true, scrollTop: chatMessages.scrollTop });
        }
    }

    if (typeof windowRef !== 'undefined') {
        windowRef.applyChatMessageScale = function (value, options = {}) {
            applyMessageScale(value, Object.assign({ persist: true, rerender: true }, options || {}));
        };
    }

    function SettingsPanel() {
        let activeMessageScaleScope = getMessageScaleScope();

        applyMessageScale(readStoredMessageScale() || 1, { persist: false, rerender: false });
        refreshVisibleTimePreferenceRendering(documentRef);

        const syncScaleForViewport = () => {
            const nextScope = getMessageScaleScope();
            if (nextScope === activeMessageScaleScope) return;
            activeMessageScaleScope = nextScope;
            applyMessageScale(readStoredMessageScale() || 1, { persist: false, rerender: true });
        };

        const scaleMediaQuery = typeof windowRef.matchMedia === 'function'
            ? windowRef.matchMedia(MESSAGE_SCALE_MOBILE_QUERY)
            : null;
        if (scaleMediaQuery) {
            if (typeof scaleMediaQuery.addEventListener === 'function') {
                scaleMediaQuery.addEventListener('change', syncScaleForViewport);
            } else if (typeof scaleMediaQuery.addListener === 'function') {
                scaleMediaQuery.addListener(syncScaleForViewport);
            }
        } else {
            windowRef.addEventListener('resize', syncScaleForViewport);
        }

        windowRef.addEventListener('storage', (event) => {
            const key = String(event.key || '');
            const scope = getMessageScaleScope();
            const scopedKey = getScopedMessageScaleStorageKey(scope);
            if (key === scopedKey || (scope === 'desktop' && key === messageScaleStorageKey)) {
                applyMessageScale(event.newValue || 1, { persist: false, rerender: true });
                return;
            }
            if (key === timeFormatStorageKey) {
                refreshVisibleTimePreferenceRendering(documentRef);
            }
        });

        muteChatBtn?.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleCurrentChatMuted();
            closeHeaderDropdown();
        });

        e2eIndicator?.addEventListener('click', (event) => {
            event.preventDefault();
        });
    }

    return {
        ChatContainer,
        applyMessageScale,
        SettingsPanel,
    };
}
