import {
    chatMatchesFolder,
    createChatFolder,
    getChatFolderTabValue,
    normalizeChatFolders,
    resolveSidebarFolder,
    toggleChatInFolder,
} from '../../modules/chat-folders.js';
import { initHorizontalDragScroll } from '../../modules/horizontal-drag-scroll.js';

export function initChatShellSidebar({
    clientPreferences = {},
    persistClientPreferences = null,
} = {}) {
    const sidebarTabs = document.getElementById('sidebarTabs');
    const userFolderTabs = document.getElementById('sidebarUserFolderTabs');
    const folderEditor = document.getElementById('chatFolderEditor');
    const folderTitleInput = document.getElementById('chatFolderTitleInput');
    const folderIncludeSelect = document.getElementById('chatFolderIncludeSelect');
    const folderSaveBtn = document.getElementById('chatFolderSaveBtn');
    const folderCancelBtn = document.getElementById('chatFolderCancelBtn');

    let userFolders = normalizeChatFolders(
        clientPreferences?.chatFolders
        || window.SUN_CLIENT_PREFERENCES?.get?.()?.chatFolders
        || [],
    );
    let pendingFolderChatId = '';

    initHorizontalDragScroll(sidebarTabs);

    function scheduleGroupLabelsUpdate() {
        // Group labels were removed from sidebar; keep a no-op for existing call sites.
    }

    function getActiveTab() {
        return String(document.body?.dataset?.sidebarTab || 'all');
    }

    function getSectionRequestCount() {
        return document.getElementById('dialogRequestsList')?.children?.length || 0;
    }

    function getFirstRequestRow() {
        return document.querySelector('#contactsList .contact-item--dialog-request')
            || document.querySelector('#dialogRequestsList .request-item');
    }

    function syncBootstrapPreferences(nextPreferences) {
        if (!nextPreferences || typeof nextPreferences !== 'object') return;
        if (window.SUN_BOOTSTRAP?.user) {
            window.SUN_BOOTSTRAP.user.clientPreferences = nextPreferences;
        }
    }

    async function persistFolders() {
        const patch = { chatFolders: normalizeChatFolders(userFolders) };
        let nextPreferences = patch;
        if (typeof window.SUN_CLIENT_PREFERENCES?.merge === 'function') {
            nextPreferences = window.SUN_CLIENT_PREFERENCES.merge(patch);
        } else {
            nextPreferences = {
                ...(clientPreferences || {}),
                ...patch,
                updatedAt: new Date().toISOString(),
            };
        }
        syncBootstrapPreferences(nextPreferences);
        if (typeof persistClientPreferences === 'function') {
            await persistClientPreferences(nextPreferences);
        }
    }

    function renderUserFolderTabs() {
        if (!userFolderTabs) return;
        userFolderTabs.replaceChildren();
        userFolders.forEach((folder) => {
            const button = document.createElement('button');
            button.className = 'sidebar-tab sidebar-user-folder-tab';
            button.type = 'button';
            button.dataset.tab = getChatFolderTabValue(folder);
            button.dataset.folderId = folder.id;
            button.textContent = folder.title;
            button.setAttribute('title', folder.title);
            userFolderTabs.appendChild(button);
        });
    }

    function updateFolderActiveState(activeTab) {
        document.querySelectorAll('.sidebar-tab[data-tab]').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.tab === activeTab);
        });
    }

    function shouldShowRequestsForTab(tabValue) {
        return String(tabValue || '') === 'all' && getSectionRequestCount() > 0;
    }

    function applySidebarFolderFilter() {
        const activeTab = getActiveTab();
        const folder = resolveSidebarFolder(activeTab, userFolders);
        const resolvedTab = getChatFolderTabValue(folder);
        if (resolvedTab !== activeTab) {
            document.body.dataset.sidebarTab = resolvedTab;
        }

        updateFolderActiveState(resolvedTab);

        const contacts = document.querySelectorAll('#contactsList .contact-item');
        contacts.forEach((item) => {
            item.style.display = chatMatchesFolder(item, folder) ? '' : 'none';
        });

        const reqSection = document.getElementById('dialogRequestsSection');
        if (reqSection) {
            reqSection.style.display = shouldShowRequestsForTab(resolvedTab) ? '' : 'none';
        }
    }

    function switchSidebarTab(tab) {
        const folder = resolveSidebarFolder(tab, userFolders);
        const normalizedTab = getChatFolderTabValue(folder);
        document.body.dataset.sidebarTab = normalizedTab;
        applySidebarFolderFilter();

        window.dispatchEvent(new CustomEvent('sun-sidebar-tab-changed', {
            detail: { tab: normalizedTab, folder },
        }));
        scheduleGroupLabelsUpdate();
    }

    function updateSidebarTabCounts() {
        const unreadCountEl = document.getElementById('unreadTabCount');
        if (!unreadCountEl) return;
        let total = 0;
        document.querySelectorAll('#contactsList .contact-item .unread-badge').forEach((badge) => {
            if (badge.classList.contains('unread-badge--hidden')) return;
            if (badge.style.display === 'none') return;
            const count = Number.parseInt((badge.textContent || '').trim(), 10);
            if (Number.isFinite(count) && count > 0) total += count;
        });
        unreadCountEl.textContent = total > 0 ? total : '';
    }

    function focusDialogRequests() {
        switchSidebarTab('all');
        const section = getFirstRequestRow() || document.getElementById('dialogRequestsSection');
        const scrollArea = document.getElementById('sidebarScrollArea');
        if (section && scrollArea) {
            scrollArea.scrollTo({ top: Math.max(0, section.offsetTop - 8), behavior: 'smooth' });
        }
        window.requestAnimationFrame(() => {
            const firstAction = document.querySelector(
                '#contactsList .contact-item--dialog-request .req-btn.accept, #dialogRequestsList .req-btn.accept',
            );
            try {
                firstAction?.focus({ preventScroll: true });
            } catch (_) {
                firstAction?.focus?.();
            }
        });
    }

    function closeFolderEditor() {
        if (!folderEditor) return;
        pendingFolderChatId = '';
        folderEditor.hidden = true;
        folderEditor.classList.remove('is-open');
    }

    function openFolderEditor({ initialChatId = '' } = {}) {
        if (!folderEditor) return;
        pendingFolderChatId = String(initialChatId || '').trim();
        folderEditor.hidden = false;
        folderEditor.classList.add('is-open');
        if (folderTitleInput) folderTitleInput.value = '';
        if (folderIncludeSelect) folderIncludeSelect.value = 'all';
        window.requestAnimationFrame(() => {
            try {
                folderTitleInput?.focus({ preventScroll: true });
            } catch (_) {
                folderTitleInput?.focus?.();
            }
        });
    }

    async function saveFolderFromEditor() {
        const folder = createChatFolder({
            title: folderTitleInput?.value,
            include: folderIncludeSelect?.value,
            existingFolders: userFolders,
        });
        if (!folder) {
            try {
                folderTitleInput?.focus({ preventScroll: true });
            } catch (_) {
                folderTitleInput?.focus?.();
            }
            return;
        }

        const folderWithPendingChat = pendingFolderChatId
            ? { ...folder, included_chat_ids: [pendingFolderChatId] }
            : folder;
        pendingFolderChatId = '';
        userFolders = normalizeChatFolders([...userFolders, folderWithPendingChat]);
        renderUserFolderTabs();
        closeFolderEditor();
        switchSidebarTab(getChatFolderTabValue(folder));
        try {
            await persistFolders();
        } catch (error) {
            console.warn('[ChatFolders] save failed', error);
        }
    }

    async function deleteUserFolder(folderId) {
        const normalizedFolderId = String(folderId || '').trim();
        const folder = userFolders.find((item) => item.id === normalizedFolderId);
        if (!folder) return;
        if (!window.confirm(`Удалить папку «${folder.title}»?`)) return;

        const deletedTab = getChatFolderTabValue(folder);
        userFolders = userFolders.filter((item) => item.id !== normalizedFolderId);
        renderUserFolderTabs();
        if (getActiveTab() === deletedTab) {
            switchSidebarTab('all');
        } else {
            applySidebarFolderFilter();
        }
        try {
            await persistFolders();
        } catch (error) {
            console.warn('[ChatFolders] delete failed', error);
        }
    }

    async function pickFolderForChat(chatId) {
        const normalizedChatId = String(chatId || '').trim();
        if (!normalizedChatId) return;
        if (!userFolders.length) {
            openFolderEditor({ initialChatId: normalizedChatId });
            return;
        }

        const lines = userFolders.map((folder, index) => {
            const selected = folder.included_chat_ids.includes(normalizedChatId) ? ' ✓' : '';
            return `${index + 1}. ${folder.title}${selected}`;
        }).join('\n');
        const choice = window.prompt(`Папка для чата:\n${lines}`, '1');
        const index = Number.parseInt(String(choice || '').trim(), 10) - 1;
        if (!Number.isFinite(index) || index < 0 || index >= userFolders.length) return;

        const targetFolder = userFolders[index];
        const updatedFolder = toggleChatInFolder(targetFolder, normalizedChatId);
        if (!updatedFolder) return;
        userFolders = normalizeChatFolders(
            userFolders.map((folder) => (folder.id === targetFolder.id ? updatedFolder : folder)),
        );
        renderUserFolderTabs();
        applySidebarFolderFilter();
        try {
            await persistFolders();
        } catch (error) {
            console.warn('[ChatFolders] chat toggle failed', error);
        }
    }

    sidebarTabs?.addEventListener('click', (event) => {
        const createButton = event.target.closest('#chatFolderCreateBtn');
        if (createButton) {
            event.preventDefault();
            if (folderEditor?.hidden) openFolderEditor();
            else closeFolderEditor();
            return;
        }

        const button = event.target.closest('.sidebar-tab[data-tab]');
        if (!button) return;
        event.preventDefault();
        switchSidebarTab(button.dataset.tab || 'all');
    });

    sidebarTabs?.addEventListener('contextmenu', (event) => {
        const button = event.target.closest('.sidebar-user-folder-tab[data-folder-id]');
        if (!button) return;
        event.preventDefault();
        void deleteUserFolder(button.dataset.folderId);
    });

    folderSaveBtn?.addEventListener('click', () => {
        void saveFolderFromEditor();
    });
    folderCancelBtn?.addEventListener('click', closeFolderEditor);
    folderTitleInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            void saveFolderFromEditor();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            closeFolderEditor();
        }
    });
    folderIncludeSelect?.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            closeFolderEditor();
        }
    });

    function applyAvatarTints() {
        document.querySelectorAll('.contact-item .contact-avatar, .request-item .contact-avatar').forEach((avatar) => {
            if (avatar.querySelector('img')) return;
            if (avatar.hasAttribute('data-avatar-tint')) return;
            const name = (avatar.textContent || '').trim() || '?';
            let hash = 0;
            for (let i = 0; i < name.length; i += 1) {
                hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
            }
            avatar.setAttribute('data-avatar-tint', String(hash % 8));
        });
    }

    document.body.dataset.sidebarTab = String(
        document.querySelector('.sidebar-tab.active')?.getAttribute('data-tab') || 'all',
    );

    renderUserFolderTabs();
    applyAvatarTints();
    applySidebarFolderFilter();

    if (window.MutationObserver) {
        const observer = new MutationObserver(() => {
            applyAvatarTints();
            updateSidebarTabCounts();
            applySidebarFolderFilter();
        });
        const list = document.getElementById('contactsList');
        const requests = document.getElementById('dialogRequestsList');
        if (list) observer.observe(list, { childList: true, subtree: true });
        if (requests) observer.observe(requests, { childList: true, subtree: true });
    }

    updateSidebarTabCounts();
    window.updateSidebarTabCounts = updateSidebarTabCounts;
    window.switchSidebarTab = switchSidebarTab;
    window.applySidebarFolderFilter = applySidebarFolderFilter;
    window.focusDialogRequests = focusDialogRequests;
    window.SUN_CHAT_FOLDERS = {
        getUserFolders: () => normalizeChatFolders(userFolders),
        openEditor: openFolderEditor,
        pickFolderForChat,
    };

    return {
        switchSidebarTab,
        updateSidebarTabCounts,
        scheduleGroupLabelsUpdate,
        applySidebarFolderFilter,
        focusDialogRequests,
        pickFolderForChat,
    };
}
