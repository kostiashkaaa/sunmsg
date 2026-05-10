function normalizeText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function parseTimestamp(rawValue) {
    const raw = normalizeText(rawValue);
    if (!raw) return Number.NEGATIVE_INFINITY;
    const direct = Date.parse(raw);
    if (Number.isFinite(direct)) return direct;
    const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const fallback = Date.parse(normalized);
    return Number.isFinite(fallback) ? fallback : Number.NEGATIVE_INFINITY;
}

function resolveActivityTimestamp(item) {
    const tsAttr = Number(item.getAttribute('data-last-message-ts') || '');
    if (Number.isFinite(tsAttr) && tsAttr > 0) return tsAttr;
    const rawActivity = item.getAttribute('data-last-message-time') || item.getAttribute('data-raw-last-message-time') || '';
    const parsed = parseTimestamp(rawActivity);
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function collectContacts(contactsRoot, query = '') {
    const root = contactsRoot && typeof contactsRoot.querySelectorAll === 'function'
        ? contactsRoot
        : document;
    const selector = root?.id === 'contactsList'
        ? '.contact-item[data-chat-id]'
        : '#contactsList .contact-item[data-chat-id]';
    const normalizedQuery = normalizeText(query).toLowerCase();

    const rows = Array.from(root.querySelectorAll(selector)).map((item, index) => {
        const chatId = normalizeText(item.getAttribute('data-chat-id'));
        const isGroup = item.getAttribute('data-is-group') === '1';
        const isSavedMessages = item.getAttribute('data-saved-messages') === '1';
        const displayName = normalizeText(item.querySelector('.contact-name')?.textContent || '');
        const username = normalizeText(item.getAttribute('data-contact-username') || '');
        const publicKey = normalizeText(item.getAttribute('data-public-key') || '');
        const isOnline = Boolean(item.querySelector('.status-dot.online'));
        const lastSeenRaw = normalizeText(item.getAttribute('data-last-seen') || '');
        const lastSeenTs = parseTimestamp(lastSeenRaw);
        const activityTs = resolveActivityTimestamp(item);
        const avatarEl = item.querySelector('.contact-avatar');
        const avatarImgSrc = normalizeText(avatarEl?.querySelector('img.contact-avatar__img')?.getAttribute('src') || '');
        const avatarTint = normalizeText(avatarEl?.getAttribute('data-avatar-tint') || '');
        const initials = displayName
            .split(/\s+/)
            .slice(0, 2)
            .map((chunk) => chunk[0] || '')
            .join('')
            .toUpperCase() || '?';

        return {
            item,
            index,
            chatId,
            isGroup,
            isSavedMessages,
            displayName,
            username,
            publicKey,
            isOnline,
            lastSeenRaw,
            lastSeenTs,
            activityTs,
            avatarImgSrc,
            avatarTint,
            initials,
        };
    }).filter((row) => {
        if (!row.chatId) return false;
        if (row.isGroup || row.isSavedMessages) return false;
        if (!normalizedQuery) return true;
        const haystack = `${row.displayName}\n${row.username}\n${row.publicKey}`.toLowerCase();
        return haystack.includes(normalizedQuery);
    });

    rows.sort((left, right) => {
        if (left.isOnline !== right.isOnline) return left.isOnline ? -1 : 1;

        const leftHasLastSeen = Number.isFinite(left.lastSeenTs);
        const rightHasLastSeen = Number.isFinite(right.lastSeenTs);
        if (!left.isOnline && leftHasLastSeen !== rightHasLastSeen) {
            return leftHasLastSeen ? -1 : 1;
        }

        if (!left.isOnline && leftHasLastSeen && rightHasLastSeen && left.lastSeenTs !== right.lastSeenTs) {
            return right.lastSeenTs - left.lastSeenTs;
        }

        if (left.activityTs !== right.activityTs) return right.activityTs - left.activityTs;

        const byName = left.displayName.localeCompare(right.displayName, undefined, { sensitivity: 'base' });
        if (byName !== 0) return byName;
        return left.index - right.index;
    });

    return rows;
}

function resolveStatusText(contact, labels, formatLastSeenText) {
    if (contact.isOnline) return labels.online;
    if (contact.lastSeenRaw && typeof formatLastSeenText === 'function') {
        const text = normalizeText(formatLastSeenText(contact.lastSeenRaw));
        if (text) return text;
    }
    if (Number.isFinite(contact.activityTs) && contact.activityTs > 0) {
        return labels.recently;
    }
    return labels.offline;
}

export function renderContactsDirectoryList({
    contactsRoot = null,
    resultsRoot = null,
    query = '',
    escapeHtml = (value) => String(value || ''),
    applyFallbackAvatarTint = null,
    formatLastSeenText = null,
    labels = {},
} = {}) {
    if (!resultsRoot || typeof resultsRoot.innerHTML !== 'string') return 0;

    const copy = {
        open: normalizeText(labels.open || 'Open'),
        online: normalizeText(labels.online || 'online'),
        offline: normalizeText(labels.offline || 'offline'),
        recently: normalizeText(labels.recently || 'active recently'),
        empty: normalizeText(labels.empty || 'Nothing found.'),
    };

    const contacts = collectContacts(contactsRoot, query);
    if (!contacts.length) {
        resultsRoot.innerHTML = `<p class="text-center">${escapeHtml(copy.empty)}</p>`;
        return 0;
    }

    resultsRoot.innerHTML = contacts.map((contact) => {
        const avatarHtml = contact.avatarImgSrc
            ? `<img class="contact-avatar__img" src="${escapeHtml(contact.avatarImgSrc)}" alt="${escapeHtml(contact.displayName || 'Avatar')}">`
            : escapeHtml(contact.initials);
        const avatarTintAttr = (!contact.avatarImgSrc && contact.avatarTint)
            ? ` data-avatar-tint="${escapeHtml(contact.avatarTint)}"`
            : '';
        const statusText = resolveStatusText(contact, copy, formatLastSeenText);
        const usernameText = contact.username ? ` @${contact.username.replace(/^@+/, '')}` : '';
        return `
            <div class="command-palette-result">
                <div class="command-palette-result-meta">
                    <div class="contact-avatar command-palette-result-avatar"${avatarTintAttr}>${avatarHtml}</div>
                    <div class="command-palette-result-copy">
                        <strong>${escapeHtml(contact.displayName || contact.username || 'User')}</strong>
                        <span>${escapeHtml(statusText)}${escapeHtml(usernameText)}</span>
                    </div>
                </div>
                <button type="button" class="command-palette-result-btn open-chat-btn" data-chat-id="${escapeHtml(contact.chatId)}">${escapeHtml(copy.open)}</button>
            </div>
        `;
    }).join('');

    if (typeof applyFallbackAvatarTint === 'function') {
        resultsRoot.querySelectorAll('.command-palette-result .contact-avatar').forEach((avatarEl) => {
            if (avatarEl.querySelector('img')) return;
            const label = normalizeText(
                avatarEl.closest('.command-palette-result')?.querySelector('.command-palette-result-copy strong')?.textContent || '',
            );
            applyFallbackAvatarTint(avatarEl, label);
        });
    }

    return contacts.length;
}
