const URL_PATTERN = /((https?:\/\/|www\.)[^\s<]+)/gi;
const MENTION_PATTERN = /(^|[^A-Za-z0-9_])@([A-Za-z0-9_]{1,50})(?![A-Za-z0-9_])/gi;

export function extractMentionUsernames(text, { maxMentions = 32 } = {}) {
    const rawText = String(text || '');
    if (!rawText) return [];
    const normalizedLimit = Math.max(1, Number(maxMentions) || 1);
    const mentions = [];
    const seen = new Set();
    MENTION_PATTERN.lastIndex = 0;
    let match;
    while ((match = MENTION_PATTERN.exec(rawText)) !== null) {
        const username = String(match[2] || '').trim().toLowerCase();
        if (!username || seen.has(username)) continue;
        seen.add(username);
        mentions.push(username);
        if (mentions.length >= normalizedLimit) break;
    }
    return mentions;
}

export function normalizeMentionUserIds(rawIds) {
    if (!Array.isArray(rawIds)) return [];
    const normalized = [];
    const seen = new Set();
    rawIds.forEach((value) => {
        const userId = Number(value);
        if (!Number.isFinite(userId) || userId <= 0 || seen.has(userId)) return;
        seen.add(userId);
        normalized.push(Math.floor(userId));
    });
    return normalized;
}

export function isCurrentUserMentioned({
    mentionedUserIds = [],
    currentUserId = null,
    currentUsername = '',
    text = '',
} = {}) {
    const normalizedCurrentUserId = Number(currentUserId);
    if (Number.isFinite(normalizedCurrentUserId) && normalizedCurrentUserId > 0) {
        if (normalizeMentionUserIds(mentionedUserIds).includes(Math.floor(normalizedCurrentUserId))) {
            return true;
        }
    }

    const normalizedCurrentUsername = String(currentUsername || '').trim().replace(/^@+/, '').toLowerCase();
    if (!normalizedCurrentUsername) return false;
    return extractMentionUsernames(text).includes(normalizedCurrentUsername);
}

function appendTextWithMentions(fragment, text, { currentUsername = '' } = {}) {
    const rawText = String(text || '');
    if (!rawText) return;
    const normalizedCurrentUsername = String(currentUsername || '').trim().replace(/^@+/, '').toLowerCase();
    MENTION_PATTERN.lastIndex = 0;
    let cursor = 0;
    let match;
    while ((match = MENTION_PATTERN.exec(rawText)) !== null) {
        const fullMatchIndex = match.index;
        const boundary = String(match[1] || '');
        const username = String(match[2] || '');
        const mentionStart = fullMatchIndex + boundary.length;
        const mentionEnd = mentionStart + 1 + username.length;

        if (fullMatchIndex > cursor) {
            fragment.appendChild(document.createTextNode(rawText.slice(cursor, fullMatchIndex)));
        }
        if (boundary) {
            fragment.appendChild(document.createTextNode(boundary));
        }

        const mentionEl = document.createElement('span');
        mentionEl.className = 'message-mention';
        mentionEl.textContent = `@${username}`;
        mentionEl.setAttribute('data-mention-username', username.toLowerCase());
        if (normalizedCurrentUsername && username.toLowerCase() === normalizedCurrentUsername) {
            mentionEl.classList.add('message-mention--self');
        }
        fragment.appendChild(mentionEl);
        cursor = mentionEnd;
    }

    if (cursor < rawText.length) {
        fragment.appendChild(document.createTextNode(rawText.slice(cursor)));
    }
}

export function renderMessageTextWithMentions(targetEl, content, options = {}) {
    if (!targetEl) return;
    const rawText = String(content ?? '');
    const fragment = document.createDocumentFragment();
    let cursor = 0;
    URL_PATTERN.lastIndex = 0;
    let match;

    while ((match = URL_PATTERN.exec(rawText)) !== null) {
        const index = match.index;
        const rawUrl = match[0];
        if (index > cursor) {
            appendTextWithMentions(
                fragment,
                rawText.slice(cursor, index),
                options,
            );
        }
        const href = /^https?:\/\//i.test(rawUrl) ? rawUrl : `https://${rawUrl}`;
        if (/^https?:\/\//i.test(href)) {
            const anchor = document.createElement('a');
            anchor.href = href;
            anchor.target = '_blank';
            anchor.rel = 'noopener noreferrer';
            anchor.textContent = rawUrl;
            fragment.appendChild(anchor);
        } else {
            fragment.appendChild(document.createTextNode(rawUrl));
        }
        cursor = index + rawUrl.length;
    }

    if (cursor < rawText.length) {
        appendTextWithMentions(fragment, rawText.slice(cursor), options);
    }

    targetEl.replaceChildren(fragment);
}
