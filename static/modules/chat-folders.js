const ALLOWED_FOLDER_INCLUDES = new Set(['all', 'direct', 'groups', 'unread', 'pinned']);
const MAX_USER_FOLDERS = 24;
const MAX_FOLDER_TITLE_LENGTH = 32;
const MAX_FOLDER_CHAT_IDS = 250;

export const SYSTEM_CHAT_FOLDERS = [
    { id: 'all', title: 'Все', include: 'all', included_chat_ids: [], excluded_chat_ids: [], order: 0, system: true },
    { id: 'direct', title: 'Личные', include: 'direct', included_chat_ids: [], excluded_chat_ids: [], order: 1, system: true },
    { id: 'groups', title: 'Группы', include: 'groups', included_chat_ids: [], excluded_chat_ids: [], order: 2, system: true },
    { id: 'unread', title: 'Непрочитанные', include: 'unread', included_chat_ids: [], excluded_chat_ids: [], order: 3, system: true },
];

function normalizeFolderTitle(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, MAX_FOLDER_TITLE_LENGTH);
}

function normalizeFolderInclude(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return ALLOWED_FOLDER_INCLUDES.has(normalized) ? normalized : 'all';
}

function normalizeChatIdList(value) {
    if (!Array.isArray(value)) return [];
    const result = [];
    const seen = new Set();
    for (const rawId of value) {
        const chatId = String(rawId || '').trim();
        if (!chatId || seen.has(chatId)) continue;
        result.push(chatId);
        seen.add(chatId);
        if (result.length >= MAX_FOLDER_CHAT_IDS) break;
    }
    return result;
}

function normalizeFolderId(value, fallbackIndex = 0) {
    const raw = String(value || '').trim().toLowerCase();
    const safe = raw.replace(/[^a-z0-9_-]/g, '').slice(0, 48);
    return safe || `folder_${fallbackIndex + 1}`;
}

function numericOrder(value, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeChatFolder(folder, index = 0) {
    if (!folder || typeof folder !== 'object' || Array.isArray(folder)) return null;
    const title = normalizeFolderTitle(folder.title);
    if (!title) return null;
    return {
        id: normalizeFolderId(folder.id, index),
        title,
        include: normalizeFolderInclude(folder.include),
        included_chat_ids: normalizeChatIdList(folder.included_chat_ids),
        excluded_chat_ids: normalizeChatIdList(folder.excluded_chat_ids),
        order: numericOrder(folder.order, index),
    };
}

export function normalizeChatFolders(value) {
    if (!Array.isArray(value)) return [];
    const result = [];
    const seenIds = new Set(SYSTEM_CHAT_FOLDERS.map((folder) => folder.id));
    value.forEach((folder, index) => {
        if (result.length >= MAX_USER_FOLDERS) return;
        const normalized = normalizeChatFolder(folder, index);
        if (!normalized || seenIds.has(normalized.id)) return;
        result.push(normalized);
        seenIds.add(normalized.id);
    });
    return result.sort((a, b) => {
        const orderDelta = numericOrder(a.order, 0) - numericOrder(b.order, 0);
        if (orderDelta !== 0) return orderDelta;
        return a.title.localeCompare(b.title, 'ru');
    });
}

export function getChatFolderTabValue(folder) {
    const id = String(folder?.id || '').trim();
    if (!id) return 'all';
    if (SYSTEM_CHAT_FOLDERS.some((systemFolder) => systemFolder.id === id)) return id;
    return `folder:${id}`;
}

export function resolveSidebarFolder(tabValue, userFolders = []) {
    const normalizedTab = String(tabValue || '').trim();
    const systemFolder = SYSTEM_CHAT_FOLDERS.find((folder) => folder.id === normalizedTab);
    if (systemFolder) return systemFolder;

    const userFolderId = normalizedTab.startsWith('folder:')
        ? normalizedTab.slice('folder:'.length)
        : normalizedTab;
    const normalizedUserFolders = normalizeChatFolders(userFolders);
    return normalizedUserFolders.find((folder) => folder.id === userFolderId) || SYSTEM_CHAT_FOLDERS[0];
}

function hasUnread(contactItem) {
    const badge = contactItem?.querySelector?.('.unread-badge');
    if (!badge) return false;
    if (badge.classList?.contains('unread-badge--hidden')) return false;
    if (badge.style?.display === 'none') return false;
    const count = Number.parseInt(String(badge.textContent || '').trim(), 10);
    return Number.isFinite(count) && count > 0;
}

function isDialogRequestItem(contactItem) {
    return String(contactItem?.getAttribute?.('data-request-kind') || '') === 'dialog';
}

function matchesIncludeRule(contactItem, include) {
    if (!contactItem) return false;
    if (isDialogRequestItem(contactItem)) {
        return include === 'all' || include === 'direct';
    }
    if (include === 'all') return true;
    if (include === 'direct') {
        return contactItem.getAttribute('data-is-group') !== '1'
            && contactItem.getAttribute('data-saved-messages') !== '1';
    }
    if (include === 'groups') return contactItem.getAttribute('data-is-group') === '1';
    if (include === 'unread') return hasUnread(contactItem);
    if (include === 'pinned') return contactItem.getAttribute('data-pinned') === '1';
    return true;
}

export function chatMatchesFolder(contactItem, folder) {
    if (!contactItem) return false;
    const chatId = String(contactItem.getAttribute?.('data-chat-id') || '').trim();
    if (!chatId && !isDialogRequestItem(contactItem)) return false;

    const normalizedFolder = normalizeChatFolder(folder, 0) || SYSTEM_CHAT_FOLDERS[0];
    const excluded = new Set(normalizedFolder.excluded_chat_ids);
    if (excluded.has(chatId)) return false;

    const included = new Set(normalizedFolder.included_chat_ids);
    if (included.has(chatId)) return true;
    if (normalizedFolder.include === 'all' && included.size > 0) return false;

    return matchesIncludeRule(contactItem, normalizedFolder.include);
}

export function toggleChatInFolder(folder, chatId) {
    const normalizedChatId = String(chatId || '').trim();
    const normalizedFolder = normalizeChatFolder(folder, 0);
    if (!normalizedFolder || !normalizedChatId) return normalizedFolder;

    const included = normalizedFolder.included_chat_ids.filter((id) => id !== normalizedChatId);
    const wasIncluded = included.length !== normalizedFolder.included_chat_ids.length;
    const excluded = normalizedFolder.excluded_chat_ids.filter((id) => id !== normalizedChatId);
    if (!wasIncluded) {
        included.push(normalizedChatId);
    }
    return {
        ...normalizedFolder,
        included_chat_ids: normalizeChatIdList(included),
        excluded_chat_ids: normalizeChatIdList(excluded),
    };
}

export function createChatFolder({ title, include, existingFolders = [], now = Date.now } = {}) {
    const safeTitle = normalizeFolderTitle(title);
    if (!safeTitle) return null;

    const folders = normalizeChatFolders(existingFolders);
    const existingIds = new Set([
        ...SYSTEM_CHAT_FOLDERS.map((folder) => folder.id),
        ...folders.map((folder) => folder.id),
    ]);
    const baseId = normalizeFolderId(
        `${safeTitle.toLowerCase().replace(/\s+/g, '_')}_${String(now()).slice(-6)}`,
        folders.length,
    );
    let id = baseId;
    let suffix = 2;
    while (existingIds.has(id)) {
        id = `${baseId}_${suffix}`;
        suffix += 1;
    }

    return {
        id,
        title: safeTitle,
        include: normalizeFolderInclude(include),
        included_chat_ids: [],
        excluded_chat_ids: [],
        order: folders.length ? Math.max(...folders.map((folder) => numericOrder(folder.order, 0))) + 1 : 0,
    };
}
