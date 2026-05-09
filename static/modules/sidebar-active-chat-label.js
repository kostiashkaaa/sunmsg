function normalizeLabel(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
}

export function initSidebarActiveChatLabel({
    chatTitleEl = document.getElementById('chatTitle'),
    chatHeaderEl = document.getElementById('chatHeader'),
    sidebarBrandNameEl = document.querySelector('.sidebar-brand-name'),
} = {}) {
    if (!chatTitleEl || !sidebarBrandNameEl) return null;

    const defaultLabel = normalizeLabel(sidebarBrandNameEl.textContent) || 'sun';
    const observers = [];

    const applyLabel = () => {
        const activeChatToken = String(chatHeaderEl?.getAttribute('data-partner-id') || '').trim();
        const chatTitle = normalizeLabel(chatTitleEl.textContent);
        const nextLabel = activeChatToken && chatTitle ? chatTitle : defaultLabel;
        if (sidebarBrandNameEl.textContent !== nextLabel) {
            sidebarBrandNameEl.textContent = nextLabel;
        }
        sidebarBrandNameEl.setAttribute('title', nextLabel);
    };

    applyLabel();

    if (window.MutationObserver) {
        const chatTitleObserver = new MutationObserver(applyLabel);
        chatTitleObserver.observe(chatTitleEl, {
            childList: true,
            characterData: true,
            subtree: true,
        });
        observers.push(chatTitleObserver);

        if (chatHeaderEl) {
            const chatHeaderObserver = new MutationObserver(applyLabel);
            chatHeaderObserver.observe(chatHeaderEl, {
                attributes: true,
                attributeFilter: ['data-partner-id'],
            });
            observers.push(chatHeaderObserver);
        }
    }

    return {
        sync: applyLabel,
        destroy() {
            observers.forEach((observer) => observer.disconnect());
        },
    };
}
