import { createTabAlertController } from './chat-tab-alerts.js';

function normalizeTabLabel(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

export function createChatTabTitleRuntime({
    chatHeader,
    chatTitle,
    documentRef = document,
    windowRef = window,
    titleSeparator = ' \u2022 ',
} = {}) {
    const baseTabTitle = String(documentRef.title || 'sun').trim() || 'sun';

    function buildTabBaseTitle() {
        const activeChatToken = String(chatHeader?.getAttribute('data-partner-id') || '').trim();
        const activeChatName = normalizeTabLabel(chatTitle?.textContent);
        if (!activeChatToken || !activeChatName) return baseTabTitle;
        return `${activeChatName}${titleSeparator}${baseTabTitle}`;
    }

    const tabAlertController = createTabAlertController({
        baseTitle: baseTabTitle,
        blinkIntervalMs: 900,
        getTitle: () => documentRef.title || '',
        setTitle: (nextTitle) => {
            documentRef.title = String(nextTitle || baseTabTitle);
        },
        setIntervalFn: (handler, delay) => windowRef.setInterval(handler, delay),
        clearIntervalFn: (timerId) => windowRef.clearInterval(timerId),
    });

    tabAlertController.setBaseTitle(buildTabBaseTitle());
    if (windowRef.MutationObserver) {
        const syncTabBaseTitle = () => {
            tabAlertController.setBaseTitle(buildTabBaseTitle());
        };
        if (chatTitle) {
            const chatTitleObserver = new windowRef.MutationObserver(syncTabBaseTitle);
            chatTitleObserver.observe(chatTitle, {
                childList: true,
                characterData: true,
                subtree: true,
            });
        }
        if (chatHeader) {
            const chatHeaderObserver = new windowRef.MutationObserver(syncTabBaseTitle);
            chatHeaderObserver.observe(chatHeader, {
                attributes: true,
                attributeFilter: ['data-partner-id'],
            });
        }
    }

    return { tabAlertController };
}
