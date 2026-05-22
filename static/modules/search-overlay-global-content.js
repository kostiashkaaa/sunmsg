import { collectMediaFromMessages } from './profile-media.js';
import { tr, escapeHtml, buildAvatarInitials } from './utils.js';

const TAB_TO_MEDIA_KEY = {
    media: 'media',
    links: 'links',
    files: 'files',
    music: 'audio',
    voice: 'voices',
};

const TAB_RESULT_LIMIT = {
    media: 180,
    links: 220,
    files: 220,
    audio: 220,
    voices: 220,
};

function isEncryptedMediaReference(src) {
    return String(src || '').includes('sun_media_e2ee=');
}

function buildMediaThumbAttrs(src) {
    const safeSrc = String(src || '').trim();
    const escapedSrc = escapeHtml(safeSrc);
    return isEncryptedMediaReference(safeSrc)
        ? `data-src="${escapedSrc}"`
        : `src="${escapedSrc}" data-src="${escapedSrc}"`;
}

function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n <= 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(seconds) {
    const s = Number(seconds);
    if (!Number.isFinite(s) || s <= 0) return '';
    const mm = Math.floor(s / 60);
    const ss = Math.floor(s % 60);
    return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}

function formatDate(rawIso) {
    if (!rawIso) return '';
    const normalized = String(rawIso).includes('T')
        ? String(rawIso)
        : `${String(rawIso).replace(' ', 'T')}Z`;
    const date = new Date(normalized);
    if (Number.isNaN(date.getTime())) return '';

    const api = window.SUN_I18N;
    const language = api && typeof api.getLanguage === 'function'
        ? api.getLanguage()
        : (document.documentElement.lang === 'en' ? 'en' : 'ru');
    const locale = language === 'en' ? 'en-US' : 'ru-RU';

    const now = new Date();
    const sameYear = date.getFullYear() === now.getFullYear();
    if (sameYear) {
        return date.toLocaleString(locale, {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
        });
    }
    return date.toLocaleDateString(locale, {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
    });
}

function resolveHostname(url) {
    try {
        return new URL(String(url || '')).hostname.replace(/^www\./, '');
    } catch (_) {
        return String(url || '');
    }
}

function fileExtension(name) {
    const match = String(name || '').match(/\.([a-z0-9]{1,8})$/i);
    return match ? match[1].toLowerCase() : '';
}

function fileIconClass(payload) {
    const mime = String(payload?.mime || '').toLowerCase();
    const ext = fileExtension(payload?.name);
    if (ext === 'pdf') return 'icon-pdf';
    if (['doc', 'docx', 'rtf', 'odt'].includes(ext)) return 'icon-doc';
    if (['xls', 'xlsx', 'csv', 'ods'].includes(ext)) return 'icon-xls';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(ext)) return 'icon-zip';
    if (mime.startsWith('image/')) return 'icon-img';
    if (mime.startsWith('video/')) return 'icon-vid';
    if (mime.startsWith('audio/')) return 'icon-aud';
    if (['txt', 'md', 'log'].includes(ext)) return 'icon-txt';
    return 'icon-default';
}

const pickInitials = buildAvatarInitials;

function readContactAvatarSnapshot(item, chatName) {
    const avatarEl = item?.querySelector?.('.contact-avatar');
    const imgEl = avatarEl?.querySelector?.('img.contact-avatar__img');
    const avatarImgSrc = String(imgEl?.getAttribute('src') || '').trim();
    const avatarAlt = String(imgEl?.getAttribute('alt') || chatName || 'Avatar').trim();
    const avatarTint = String(avatarEl?.getAttribute('data-avatar-tint') || '').trim();
    const initials = String(avatarEl?.textContent || '').replace(/\s+/g, ' ').trim() || pickInitials(chatName);
    return {
        avatarImgSrc,
        avatarAlt,
        avatarTint,
        initials,
    };
}

function renderChatAvatarHtml(snapshot, chatName) {
    const tintAttr = snapshot?.avatarTint
        ? ` data-avatar-tint="${escapeHtml(snapshot.avatarTint)}"`
        : '';
    if (snapshot?.avatarImgSrc) {
        return `<div class="contact-avatar search-global-row-avatar"${tintAttr}><img class="contact-avatar__img" src="${escapeHtml(snapshot.avatarImgSrc)}" alt="${escapeHtml(snapshot.avatarAlt || chatName || 'Avatar')}" loading="lazy" decoding="async"></div>`;
    }
    return `<div class="contact-avatar search-global-row-avatar"${tintAttr}>${escapeHtml(snapshot?.initials || pickInitials(chatName))}</div>`;
}

function createEmptyCollections() {
    return {
        media: [],
        files: [],
        audio: [],
        voices: [],
        links: [],
    };
}

export function initSearchOverlayGlobalContent({
    overlayEl = null,
    resolveAppUrl = (url) => url,
    fetchImpl = null,
    decodeMessages = async (messages) => messages,
    contactsRoot = null,
    openChatById = async () => {},
    focusMessageInCurrentChat = async () => false,
    closeOverlay = () => {},
    showToast = () => {},
} = {}) {
    if (!overlayEl) return null;

    const panelMap = {
        media: document.getElementById('searchGlobalMediaResults'),
        links: document.getElementById('searchGlobalLinksResults'),
        files: document.getElementById('searchGlobalFilesResults'),
        music: document.getElementById('searchGlobalMusicResults'),
        voice: document.getElementById('searchGlobalVoiceResults'),
    };

    const hasAnyPanel = Object.values(panelMap).some(Boolean);
    if (!hasAnyPanel) return null;

    let activeTab = 'chats';
    let loadPromise = null;
    let chatLookup = new Map();
    let mediaCollections = createEmptyCollections();
    let messageMetaById = new Map();
    let tabRenderSeq = 0;
    let jumpSeq = 0;
    let audioPlaySeq = 0;

    function buildChatLookup() {
        const next = new Map();
        const source = contactsRoot && typeof contactsRoot.querySelectorAll === 'function'
            ? contactsRoot
            : document;

        source.querySelectorAll('#contactsList .contact-item[data-chat-id]').forEach((item) => {
            const chatId = String(item.getAttribute('data-chat-id') || '').trim();
            if (!chatId) return;
            const chatName = String(item.querySelector('.contact-name')?.textContent || '').trim();
            next.set(chatId, {
                chatName,
                avatar: readContactAvatarSnapshot(item, chatName),
            });
        });

        chatLookup = next;
    }

    function resolveChatMeta(meta) {
        const chatId = String(meta?.chatId || '').trim();
        const cached = chatLookup.get(chatId);
        const chatName = String(cached?.chatName || meta?.chatTitle || '').trim() || tr('Чат');

        if (cached?.avatar) {
            return {
                chatName,
                avatarHtml: renderChatAvatarHtml(cached.avatar, chatName),
            };
        }

        const initials = pickInitials(chatName);
        return {
            chatName,
            avatarHtml: renderChatAvatarHtml({ initials }, chatName),
        };
    }

    function setLoadingState(tabId) {
        const panel = panelMap[tabId];
        if (!panel) return;
        panel.innerHTML = `<div class="search-global-state">${escapeHtml(tr('Загружаем...'))}</div>`;
    }

    function setEmptyState(tabId) {
        const panel = panelMap[tabId];
        if (!panel) return;
        panel.innerHTML = `<div class="search-global-state">${escapeHtml(tr('Пока ничего не найдено'))}</div>`;
    }

    function extractDecodePayload(messages) {
        return messages.map((msg) => ({
            id: msg.id,
            sender_user_id: msg.sender_user_id,
            sender_public_key: msg.sender_public_key,
            sender_display_name: msg.sender_display_name,
            sender_username: msg.sender_username,
            sender_avatar_url: msg.sender_avatar_url,
            message: msg.message,
            message_type: msg.message_type,
            created_at: msg.created_at,
            reply_to_id: msg.reply_to_id,
            reply_message: msg.reply_message,
            reply_sender_pub: msg.reply_sender_pub,
            is_read: false,
            is_delivered: false,
            voice_listened_by_partner: false,
            is_edited: false,
            reactions: [],
        }));
    }

    async function ensureDataLoaded() {
        if (loadPromise) return loadPromise;

        loadPromise = (async () => {
            const requestUrl = resolveAppUrl('/search_global_content?limit=1800');
            const response = await (fetchImpl || fetch)(requestUrl);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const payload = await response.json();
            if (!payload?.success || !Array.isArray(payload.messages)) {
                throw new Error('Invalid response payload');
            }

            const rawMessages = payload.messages;
            const decodePayload = extractDecodePayload(rawMessages);
            const decodedMessages = await decodeMessages(decodePayload);

            const nextMeta = new Map();
            rawMessages.forEach((msg) => {
                const messageId = Number(msg.id);
                if (!Number.isFinite(messageId) || messageId <= 0) return;
                nextMeta.set(messageId, {
                    messageId,
                    chatId: String(msg.chat_id || '').trim(),
                    chatTitle: String(msg.chat_title || '').trim(),
                    chatAvatarUrl: String(msg.chat_avatar_url || '').trim(),
                    senderDisplayName: String(msg.sender_display_name || '').trim(),
                    createdAt: msg.created_at,
                });
            });

            mediaCollections = collectMediaFromMessages(Array.isArray(decodedMessages) ? decodedMessages : []);
            messageMetaById = nextMeta;
        })().catch((error) => {
            loadPromise = null;
            throw error;
        });

        return loadPromise;
    }

    function mediaItemMeta(entry) {
        const messageId = Number(entry?.msgId);
        if (!Number.isFinite(messageId) || messageId <= 0) return null;
        return messageMetaById.get(messageId) || null;
    }

    function renderMediaTab() {
        const panel = panelMap.media;
        if (!panel) return;

        const items = (mediaCollections.media || []).slice(0, TAB_RESULT_LIMIT.media);
        if (!items.length) {
            setEmptyState('media');
            return;
        }

        panel.innerHTML = '<div class="search-global-media-grid"></div>';
        const grid = panel.firstElementChild;

        items.forEach((entry) => {
            const payload = entry.payload || {};
            const src = String(payload.data || '').trim();
            const meta = mediaItemMeta(entry);
            const chatId = String(meta?.chatId || '').trim();
            const messageId = Number(entry.msgId);
            if (!src || !chatId || !Number.isFinite(messageId)) return;

            const chatMeta = resolveChatMeta(meta);
            const isVideo = String(entry.mediaKind || '') === 'video';
            const duration = formatDuration(payload.duration_seconds);

            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'search-global-media-card';
            card.setAttribute('data-search-global-jump', '1');
            card.setAttribute('data-chat-id', chatId);
            card.setAttribute('data-msg-id', String(messageId));
            card.innerHTML = `
                ${isVideo
                    ? `<video ${buildMediaThumbAttrs(src)} preload="metadata" muted playsinline></video>`
                    : `<img ${buildMediaThumbAttrs(src)} alt="" loading="lazy" decoding="async">`
                }
                <div class="search-global-media-card-meta">
                    <span class="search-global-media-card-chat">${escapeHtml(chatMeta.chatName)}</span>
                    ${duration ? `<span class="search-global-media-card-duration">${escapeHtml(duration)}</span>` : ''}
                </div>
            `;
            grid.appendChild(card);
            window._hydrateMediaPreviewThumbs?.(card);
        });

        if (!grid.children.length) {
            setEmptyState('media');
        }
    }

    function renderLinksTab() {
        const panel = panelMap.links;
        if (!panel) return;

        const items = (mediaCollections.links || []).slice(0, TAB_RESULT_LIMIT.links);
        if (!items.length) {
            setEmptyState('links');
            return;
        }

        panel.innerHTML = '<div class="search-global-list"></div>';
        const list = panel.firstElementChild;

        items.forEach((entry) => {
            const meta = mediaItemMeta(entry);
            const chatId = String(meta?.chatId || '').trim();
            const messageId = Number(entry.msgId);
            const url = String(entry.url || '').trim();
            if (!chatId || !Number.isFinite(messageId) || !url) return;

            const chatMeta = resolveChatMeta(meta);
            const host = resolveHostname(url);
            const dateText = formatDate(entry.createdAt || meta?.createdAt);

            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'search-global-row search-global-row--link';
            row.setAttribute('data-search-global-jump', '1');
            row.setAttribute('data-chat-id', chatId);
            row.setAttribute('data-msg-id', String(messageId));
            row.innerHTML = `
                <div class="search-global-row-main">
                    <div class="search-global-row-title">${escapeHtml(host)}</div>
                    <div class="search-global-row-sub">${escapeHtml(url)}</div>
                    <div class="search-global-row-meta">${escapeHtml(chatMeta.chatName)}${dateText ? ` • ${escapeHtml(dateText)}` : ''}</div>
                </div>
                <i class="bi bi-arrow-up-right-square"></i>
            `;
            list.appendChild(row);
        });

        if (!list.children.length) {
            setEmptyState('links');
        }
    }

    function renderFilesTab() {
        const panel = panelMap.files;
        if (!panel) return;

        const items = (mediaCollections.files || []).slice(0, TAB_RESULT_LIMIT.files);
        if (!items.length) {
            setEmptyState('files');
            return;
        }

        panel.innerHTML = '<div class="search-global-list"></div>';
        const list = panel.firstElementChild;

        items.forEach((entry) => {
            const payload = entry.payload || {};
            const meta = mediaItemMeta(entry);
            const chatId = String(meta?.chatId || '').trim();
            const messageId = Number(entry.msgId);
            if (!chatId || !Number.isFinite(messageId)) return;

            const chatMeta = resolveChatMeta(meta);
            const fileName = String(payload.name || tr('Файл')).trim() || tr('Файл');
            const ext = fileExtension(fileName) || (String(payload.mime || '').split('/').pop() || 'file');
            const dateText = formatDate(entry.createdAt || meta?.createdAt);
            const fileSub = [formatBytes(payload.size), dateText, chatMeta.chatName].filter(Boolean).join(' • ');

            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'search-global-row search-global-row--file';
            row.setAttribute('data-search-global-jump', '1');
            row.setAttribute('data-chat-id', chatId);
            row.setAttribute('data-msg-id', String(messageId));
            row.innerHTML = `
                <div class="profile-file-icon ${fileIconClass(payload)}">${escapeHtml(ext.slice(0, 4))}</div>
                <div class="search-global-row-main">
                    <div class="search-global-row-title">${escapeHtml(fileName)}</div>
                    <div class="search-global-row-meta">${escapeHtml(fileSub)}</div>
                </div>
                <i class="bi bi-arrow-up-right-square"></i>
            `;
            list.appendChild(row);
        });

        if (!list.children.length) {
            setEmptyState('files');
        }
    }

    function renderAudioTab({ key, isVoice }) {
        const panelId = isVoice ? 'voice' : 'music';
        const panel = panelMap[panelId];
        if (!panel) return;

        const items = (mediaCollections[key] || []).slice(0, TAB_RESULT_LIMIT[key]);
        if (!items.length) {
            setEmptyState(panelId);
            return;
        }

        panel.innerHTML = '<div class="search-global-list"></div>';
        const list = panel.firstElementChild;

        items.forEach((entry) => {
            const payload = entry.payload || {};
            const meta = mediaItemMeta(entry);
            const chatId = String(meta?.chatId || '').trim();
            const messageId = Number(entry.msgId);
            const audioSrc = String(payload.data || '').trim();
            if (!chatId || !Number.isFinite(messageId) || !audioSrc) return;

            const chatMeta = resolveChatMeta(meta);
            const dateText = formatDate(entry.createdAt || meta?.createdAt);
            const duration = formatDuration(payload.duration_seconds);
            const rowTitle = isVoice
                ? tr('Голосовое сообщение')
                : (String(payload.name || '').trim() || tr('Аудио'));
            const rowSub = [duration, chatMeta.chatName, dateText].filter(Boolean).join(' • ');

            const row = document.createElement('div');
            row.className = `search-global-row search-global-row--audio${isVoice ? ' search-global-row--voice' : ''}`;
            row.setAttribute('data-chat-id', chatId);
            row.setAttribute('data-msg-id', String(messageId));
            row.innerHTML = `
                <button type="button" class="search-global-play-btn" data-search-global-play aria-label="${escapeHtml(tr('Воспроизвести'))}">
                    <i class="bi bi-play-fill"></i>
                </button>
                <div class="search-global-row-main" data-search-global-jump="1" data-chat-id="${escapeHtml(chatId)}" data-msg-id="${escapeHtml(String(messageId))}">
                    <div class="search-global-row-title">${escapeHtml(rowTitle)}</div>
                    <div class="search-global-row-meta">${escapeHtml(rowSub)}</div>
                </div>
                <button type="button" class="search-global-jump-btn" data-search-global-jump="1" data-chat-id="${escapeHtml(chatId)}" data-msg-id="${escapeHtml(String(messageId))}" aria-label="${escapeHtml(tr('Перейти к сообщению'))}">
                    <i class="bi bi-arrow-up-right-square"></i>
                </button>
                <audio preload="metadata" hidden src="${escapeHtml(audioSrc)}"></audio>
            `;
            list.appendChild(row);
        });

        if (!list.children.length) {
            setEmptyState(panelId);
        }
    }

    function renderTab(tabId) {
        if (tabId === 'media') {
            renderMediaTab();
            return;
        }
        if (tabId === 'links') {
            renderLinksTab();
            return;
        }
        if (tabId === 'files') {
            renderFilesTab();
            return;
        }
        if (tabId === 'music') {
            renderAudioTab({ key: 'audio', isVoice: false });
            return;
        }
        if (tabId === 'voice') {
            renderAudioTab({ key: 'voices', isVoice: true });
        }
    }

    function stopOtherAudio(currentAudio) {
        Object.values(panelMap).forEach((panel) => {
            if (!panel) return;
            panel.querySelectorAll('audio').forEach((audio) => {
                if (audio === currentAudio) return;
                audio.pause();
                const row = audio.closest('.search-global-row--audio');
                row?.classList.remove('is-playing');
                const icon = row?.querySelector('[data-search-global-play] i');
                if (icon) icon.className = 'bi bi-play-fill';
            });
        });
    }

    function isTargetChatActive(chatId) {
        const activeItem = document.querySelector('#contactsList .contact-item.active[data-chat-id]');
        return String(activeItem?.getAttribute('data-chat-id') || '').trim() === String(chatId || '').trim();
    }

    async function openChatAndFocusMessage(chatId, messageId) {
        const normalizedChatId = String(chatId || '').trim();
        const normalizedMessageId = Number(messageId);
        if (!normalizedChatId || !Number.isFinite(normalizedMessageId) || normalizedMessageId <= 0) return;
        const currentJumpSeq = ++jumpSeq;

        closeOverlay?.();
        await openChatById(normalizedChatId);
        if (currentJumpSeq !== jumpSeq) return;

        for (let attempt = 0; attempt < 20; attempt += 1) {
            if (currentJumpSeq !== jumpSeq) return;
            if (!isTargetChatActive(normalizedChatId)) {
                await new Promise((resolve) => setTimeout(resolve, 120));
                continue;
            }
            const focused = await focusMessageInCurrentChat(normalizedMessageId, {
                align: 'center',
                smooth: true,
            });
            if (currentJumpSeq !== jumpSeq) return;
            if (focused) return;
            await new Promise((resolve) => setTimeout(resolve, attempt < 8 ? 160 : 240));
        }
        if (currentJumpSeq !== jumpSeq) return;

        showToast?.(tr('Не удалось перейти к сообщению.'), 'warning');
    }

    function onOverlayClick(event) {
        const playBtn = event.target.closest('[data-search-global-play]');
        if (playBtn) {
            event.preventDefault();
            event.stopPropagation();
            const row = playBtn.closest('.search-global-row--audio');
            const audio = row?.querySelector('audio');
            if (!row || !audio) return;

            const icon = playBtn.querySelector('i');
            if (!audio.paused) {
                audio.pause();
                row.classList.remove('is-playing');
                if (icon) icon.className = 'bi bi-play-fill';
                return;
            }

            stopOtherAudio(audio);
            const playSeq = ++audioPlaySeq;
            row.dataset.searchGlobalAudioPlaySeq = String(playSeq);
            audio.play().then(() => {
                if (!row.isConnected || row.dataset.searchGlobalAudioPlaySeq !== String(playSeq) || audio.paused) return;
                row.classList.add('is-playing');
                if (icon) icon.className = 'bi bi-pause-fill';
            }).catch(() => {});

            audio.onended = () => {
                if (!row.isConnected || row.dataset.searchGlobalAudioPlaySeq !== String(playSeq)) return;
                row.classList.remove('is-playing');
                if (icon) icon.className = 'bi bi-play-fill';
            };
            return;
        }

        const jumpTarget = event.target.closest('[data-search-global-jump]');
        if (!jumpTarget) return;
        event.preventDefault();
        event.stopPropagation();

        const chatId = jumpTarget.getAttribute('data-chat-id') || jumpTarget.closest('[data-chat-id]')?.getAttribute('data-chat-id');
        const messageId = jumpTarget.getAttribute('data-msg-id') || jumpTarget.closest('[data-msg-id]')?.getAttribute('data-msg-id');
        void openChatAndFocusMessage(chatId, messageId);
    }

    function onTabChanged(event) {
        const tabId = String(event?.detail?.tabId || '').trim();
        if (!Object.prototype.hasOwnProperty.call(TAB_TO_MEDIA_KEY, tabId)) {
            activeTab = tabId;
            tabRenderSeq += 1;
            return;
        }

        activeTab = tabId;
        const renderSeq = ++tabRenderSeq;
        setLoadingState(tabId);
        ensureDataLoaded()
            .then(() => {
                if (renderSeq !== tabRenderSeq || activeTab !== tabId) return;
                buildChatLookup();
                renderTab(tabId);
            })
            .catch((error) => {
                if (renderSeq !== tabRenderSeq || activeTab !== tabId) return;
                const panel = panelMap[tabId];
                if (panel) {
                    panel.innerHTML = `<div class="search-global-state">${escapeHtml(tr('Не удалось загрузить контент'))}</div>`;
                }
                console.warn('Failed to load global search content', error);
                showToast?.(tr('Не удалось загрузить глобальный контент поиска.'), 'danger');
            });
    }

    overlayEl.addEventListener('click', onOverlayClick);
    overlayEl.addEventListener('sun-search-overlay-tab-changed', onTabChanged);
    contactsRoot?.addEventListener?.('contacts:loading-state', () => {
        buildChatLookup();
    });
    buildChatLookup();

    return {
        refreshChatLookup: buildChatLookup,
        ensureDataLoaded,
        renderActiveTab: () => {
            if (Object.prototype.hasOwnProperty.call(TAB_TO_MEDIA_KEY, activeTab)) {
                renderTab(activeTab);
            }
        },
    };
}
