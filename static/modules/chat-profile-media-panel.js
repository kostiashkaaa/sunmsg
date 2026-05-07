import { collectMediaFromMessages, renderMediaTabs } from './profile-media.js?v=20260430j';

function createEmptyMediaCollections() {
    return { photos: [], videos: [], files: [], audio: [], voices: [], links: [] };
}

export function createProfileMediaPanelController({
    getCurrentChatId = () => null,
    getChatState = () => null,
    profileMediaTabs = null,
    profileMediaContent = null,
    profileMediaEmpty = null,
    partnerProfileDrawer = null,
    chatMessages = null,
    isProfileDrawerOpen = () => false,
    closePartnerProfileDrawer = () => {},
    loadOlderMessages = async () => false,
    openLightbox = null,
    scrollToMessage = null,
} = {}) {
    let profileMediaActiveTab = null;
    let profileMediaRenderFrame = 0;
    let profileMediaLoadToken = 0;

    function bumpLoadToken() {
        profileMediaLoadToken += 1;
        return profileMediaLoadToken;
    }

    function getLoadToken() {
        return profileMediaLoadToken;
    }

    function buildProfileMediaCollections(chatId = getCurrentChatId()) {
        if (!chatId) {
            return createEmptyMediaCollections();
        }
        const state = getChatState(chatId);
        return collectMediaFromMessages(state?.messages || []);
    }

    function syncProfileMediaEmptyState(message) {
        if (!profileMediaEmpty) return;
        const label = profileMediaEmpty.querySelector('span');
        if (label && message) {
            label.textContent = message;
        }
    }

    function openProfileMediaLightbox(kind, entry) {
        const src = String(entry?.payload?.data || '').trim();
        if (!src || !chatMessages || typeof openLightbox !== 'function') return;

        const proxy = document.createElement('button');
        proxy.type = 'button';
        proxy.className = 'file-msg-media-trigger profile-lightbox-proxy';
        proxy.setAttribute('data-media-kind', kind === 'video' ? 'video' : 'image');
        proxy.setAttribute('data-media-src', src);
        proxy.setAttribute('data-caption', String(entry?.payload?.caption || entry?.payload?.name || '').trim());
        proxy.style.display = 'none';
        chatMessages.appendChild(proxy);
        try {
            openLightbox(proxy);
        } finally {
            window.setTimeout(() => proxy.remove(), 0);
        }
    }

    function jumpToProfileMessage(msgId) {
        if (!msgId) return;
        closePartnerProfileDrawer();
        requestAnimationFrame(() => {
            scrollToMessage?.(msgId);
        });
    }

    function handleProfileMediaItemClick({ kind, entry, action } = {}) {
        if (!entry) return;

        if (kind === 'photo' || kind === 'video') {
            openProfileMediaLightbox(kind, entry);
            return;
        }

        if (kind === 'file') {
            const fileUrl = String(entry.payload?.data || '').trim();
            if (action === 'download' && fileUrl) {
                const link = document.createElement('a');
                link.href = fileUrl;
                if (entry.payload?.name) {
                    link.download = String(entry.payload.name);
                }
                link.rel = 'noopener';
                document.body.appendChild(link);
                link.click();
                link.remove();
                return;
            }
            jumpToProfileMessage(entry.msgId);
            return;
        }

        if (kind === 'audio' || kind === 'voice') {
            if (action === 'jump') {
                jumpToProfileMessage(entry.msgId);
            }
            return;
        }

        if (kind === 'link') {
            if (action === 'open') {
                window.open(String(entry.url || ''), '_blank', 'noopener,noreferrer');
                return;
            }
            jumpToProfileMessage(entry.msgId);
        }
    }

    function renderProfileMediaPanel({ preferredTab = profileMediaActiveTab } = {}) {
        if (!profileMediaTabs || !profileMediaContent || !partnerProfileDrawer) return;
        const mediaSection = profileMediaTabs.closest('.profile-media-section');

        const chatId = getCurrentChatId();
        const media = buildProfileMediaCollections(chatId);
        const state = chatId ? getChatState(chatId) : null;
        const hasMoreHistory = Boolean(state?.hasMoreBefore);
        const isLoadingHistory = Boolean(state?.isLoadingInitial || state?.isLoadingOlder);

        const activeTab = renderMediaTabs({
            tabsEl: profileMediaTabs,
            contentEl: profileMediaContent,
            emptyEl: profileMediaEmpty,
            media,
            activeKey: preferredTab,
            onTabChange: (nextKey) => {
                profileMediaActiveTab = nextKey;
                renderProfileMediaPanel({ preferredTab: nextKey });
            },
            onItemClick: handleProfileMediaItemClick,
        });

        profileMediaActiveTab = activeTab;

        const totalItems = Object.values(media).reduce((sum, items) => sum + (Array.isArray(items) ? items.length : 0), 0);
        if (!totalItems) {
            if (mediaSection) mediaSection.style.display = 'none';
            syncProfileMediaEmptyState(
                hasMoreHistory || isLoadingHistory
                    ? 'Ищем медиа и ссылки в истории…'
                    : 'Пока нет общего контента',
            );
            return;
        }

        if (mediaSection && mediaSection.style.display !== 'none') mediaSection.style.display = '';
        if (hasMoreHistory || isLoadingHistory) {
            const note = document.createElement('div');
            note.className = 'profile-media-footnote';
            note.textContent = isLoadingHistory
                ? 'Загружаем ещё сообщения из истории…'
                : 'Показан уже найденный контент. Остальная история подгружается в фоне.';
            profileMediaContent.appendChild(note);
        }
    }

    function scheduleProfileMediaPanelRefresh(chatId = getCurrentChatId(), options = {}) {
        if (!chatId || String(chatId) !== String(getCurrentChatId()) || !isProfileDrawerOpen()) return;
        if (options.force) {
            if (profileMediaRenderFrame) {
                cancelAnimationFrame(profileMediaRenderFrame);
                profileMediaRenderFrame = 0;
            }
            renderProfileMediaPanel({ preferredTab: profileMediaActiveTab });
            return;
        }
        if (profileMediaRenderFrame) return;
        profileMediaRenderFrame = requestAnimationFrame(() => {
            profileMediaRenderFrame = 0;
            renderProfileMediaPanel({ preferredTab: profileMediaActiveTab });
        });
    }

    async function loadProfileMediaHistory(chatId, loadToken = profileMediaLoadToken) {
        if (!chatId) return;
        const state = getChatState(chatId);
        if (!state?.initialized) return;

        while (
            loadToken === profileMediaLoadToken
            && String(chatId) === String(getCurrentChatId())
            && isProfileDrawerOpen()
            && state.hasMoreBefore
        ) {
            const loaded = await loadOlderMessages(chatId);
            scheduleProfileMediaPanelRefresh(chatId, { force: true });
            if (!loaded) break;
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    }

    return {
        bumpLoadToken,
        getLoadToken,
        renderProfileMediaPanel,
        scheduleProfileMediaPanelRefresh,
        loadProfileMediaHistory,
    };
}
