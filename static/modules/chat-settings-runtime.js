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
    function ChatContainer(chatId = getCurrentChatId(), options = {}) {
        renderChatMessages(chatId, options);
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
            try {
                windowRef.localStorage?.setItem(messageScaleStorageKey, scale.toFixed(2));
            } catch (_) {
                // Ignore storage write failures.
            }
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
        const storedScale = (() => {
            try {
                return windowRef.localStorage?.getItem(messageScaleStorageKey);
            } catch (_) {
                return null;
            }
        })();

        applyMessageScale(storedScale || 1, { persist: false, rerender: false });
        refreshVisibleTimePreferenceRendering(documentRef);
        windowRef.addEventListener('storage', (event) => {
            const key = String(event.key || '');
            if (key === messageScaleStorageKey) {
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
