// Contact list rendering helpers for sidebar items and last-message metadata.
import {
    escapeHtml,
    formatSidebarTime,
    renderMessagePreviewHtml,
    applyEmojiGraphics,
} from './utils.js';
import {
    STANDARD_SINGLE_CHECK_TICK_HTML,
    STANDARD_DOUBLE_CHECK_TICK_HTML,
} from './check-glyph.js';

const ENCRYPTED_PREVIEW_LOADING_TOKEN = '__SUN_ENCRYPTED_LOADING__';

function isStatusTrueFlag(value) {
    if (value === true || value === 1) return true;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        return normalized === '1' || normalized === 'true' || normalized === 'yes';
    }
    return false;
}

function toMessageTimestamp(value) {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? String(parsed) : '';
}

function normalizeTickStatus(tickStatus) {
    if (typeof tickStatus === 'string') return tickStatus;
    if (isStatusTrueFlag(tickStatus?.pending)) return 'pending';
    if (isStatusTrueFlag(tickStatus?.is_read)) return 'read';
    if (isStatusTrueFlag(tickStatus?.is_delivered)) return 'delivered';
    return 'sent';
}

function buildSidebarTickHtml(tickStatus) {
    const status = normalizeTickStatus(tickStatus);
    if (status === 'pending') {
        return '<span class="sidebar-tick pending" title="Sending..."><i class="bi bi-clock"></i></span>';
    }
    if (status === 'read') {
        return `<span class="sidebar-tick read" title="Read">${STANDARD_DOUBLE_CHECK_TICK_HTML}</span>`;
    }
    if (status === 'delivered') {
        return `<span class="sidebar-tick delivered" title="Delivered">${STANDARD_DOUBLE_CHECK_TICK_HTML}</span>`;
    }
    if (status === 'sent') {
        return `<span class="sidebar-tick sent" title="Sent">${STANDARD_SINGLE_CHECK_TICK_HTML}</span>`;
    }
    return '';
}

function buildSidebarTimeMetaHtml(timeText, isSelf, deliveryState, isUnread) {
    const unreadClass = isUnread ? ' contact-time-meta--unread' : '';
    return `<span class="contact-time-meta${unreadClass}">${isSelf ? buildSidebarTickHtml(deliveryState) : ''}<span class="contact-time">${escapeHtml(timeText || '')}</span></span>`;
}

function escapeSelectorValue(value) {
    const raw = String(value || '');
    if (window.CSS?.escape) return window.CSS.escape(raw);
    return raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function isEncryptedPreviewLoadingToken(value) {
    return String(value || '').trim() === ENCRYPTED_PREVIEW_LOADING_TOKEN;
}

function resolveDraftLabelText(explicitLabel) {
    const rawExplicit = String(explicitLabel || '').trim();
    if (rawExplicit) return rawExplicit;
    const language = String(document.body?.dataset?.uiLanguage || '').trim().toLowerCase();
    return language === 'en' ? 'Draft:' : 'Черновик:';
}

function buildEncryptedPreviewLoadingHtml() {
    return `
        <span class="contact-last-msg-loading" role="status" aria-live="polite" aria-label="Decrypting message">
            <i class="bi bi-lock-fill contact-last-msg-loading__lock" aria-hidden="true"></i>
            <span class="contact-last-msg-loading__bars" aria-hidden="true">
                <span class="contact-last-msg-loading__bar contact-last-msg-loading__bar--main"></span>
                <span class="contact-last-msg-loading__bar contact-last-msg-loading__bar--tail"></span>
            </span>
        </span>
    `.trim();
}

function renderSidebarDraftHtml(draftText, { maxLen = 68, draftLabel = '' } = {}) {
    const labelText = resolveDraftLabelText(draftLabel);
    const previewHtml = renderMessagePreviewHtml(draftText, { isSelf: false, maxLen, emptyText: '' });
    return `<span class="contact-draft-label">${escapeHtml(labelText)}</span> <span class="contact-draft-preview">${previewHtml}</span>`;
}

function renderSidebarLastMessageHtml(messageText, { isSelf, maxLen = 68, isDraft = false, draftLabel = '' } = {}) {
    if (isEncryptedPreviewLoadingToken(messageText)) {
        return buildEncryptedPreviewLoadingHtml();
    }
    if (isDraft) {
        return renderSidebarDraftHtml(messageText, { maxLen, draftLabel });
    }
    return renderMessagePreviewHtml(messageText, { isSelf, maxLen, emptyText: '' });
}

function buildAvatarLoadingBarsHtml() {
    return `
        <span class="contact-avatar-loading" aria-hidden="true">
            <span class="contact-avatar-loading__bar contact-last-msg-loading__bar contact-last-msg-loading__bar--main"></span>
            <span class="contact-avatar-loading__bar contact-last-msg-loading__bar contact-last-msg-loading__bar--tail"></span>
        </span>
    `.trim();
}

function resolveAvatarState(avatarImage, avatarEl) {
    if (!avatarEl) return;
    if (!avatarImage) {
        avatarEl.classList.remove('avatar-loading');
        return;
    }

    avatarEl.classList.add('avatar-loading');
    const finish = () => {
        avatarEl.classList.remove('avatar-loading');
    };

    if (avatarImage.complete) {
        finish();
        return;
    }

    if (avatarImage.dataset.avatarLoadingBound === '1') return;
    avatarImage.dataset.avatarLoadingBound = '1';
    avatarImage.addEventListener('load', finish, { once: true });
    avatarImage.addEventListener('error', finish, { once: true });
}

export function hydrateContactAvatarLoading(root = document) {
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    const avatars = [];
    if (typeof Element !== 'undefined' && scope instanceof Element && scope.matches('.contact-avatar')) {
        avatars.push(scope);
    } else {
        avatars.push(...scope.querySelectorAll('.contact-avatar'));
    }

    avatars.forEach((avatarEl) => {
        resolveAvatarState(
            avatarEl.querySelector('img.contact-avatar__img'),
            avatarEl,
        );
    });
}

export function buildContactItemHtml(contact, currentChatId) {
    const chatId = contact?.chatId ?? '';
    const isSavedMessages = Boolean(contact?.is_saved_messages ?? contact?.isSavedMessages);
    const displayName = contact?.display_name || contact?.username || '';
    const initials = displayName
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((word) => word[0])
        .join('')
        .toUpperCase() || '?';
    const blockedByMe = Boolean(contact?.blocked_by_me);
    const blockedMe = Boolean(contact?.blocked_me);
    const isBlocked = blockedByMe || blockedMe;
    const isSelf = Boolean(contact?.is_self_last_sender ?? contact?.isSelfLastSender);
    const unreadCountRaw = isSavedMessages ? 0 : Number(contact?.unreadCount || 0);
    const unreadCount = Number.isFinite(unreadCountRaw) && unreadCountRaw > 0 ? unreadCountRaw : 0;
    const unread = unreadCount > 0;
    const unreadText = unreadCount > 99 ? '99+' : String(unreadCount);
    const muted = isSavedMessages ? false : Boolean(contact?.is_muted);
    const hasAvatar = Boolean(contact?.avatar_url);
    const avatarHtml = contact?.avatar_url
        ? `<img class="contact-avatar__img" src="${escapeHtml(contact.avatar_url)}" alt="${escapeHtml(displayName || 'Avatar')}" loading="lazy" decoding="async">`
        : escapeHtml(initials);
    const avatarLoadingBarsHtml = hasAvatar ? buildAvatarLoadingBarsHtml() : '';
    const muteIconHtml = muted ? '<i class="bi bi-bell-slash-fill mute-icon"></i>' : '';
    const isActive = String(chatId) === String(currentChatId);
    const hasPinOrder = contact?.is_pinned && Number.isFinite(Number(contact?.pin_order));
    const pinOrderAttr = hasPinOrder ? ` data-pin-order="${escapeHtml(String(Number(contact.pin_order)))}"` : '';
    const rawIsGroup = contact?.is_group;
    const isGroup = rawIsGroup === true
        || rawIsGroup === 1
        || rawIsGroup === '1'
        || String(rawIsGroup || '').trim().toLowerCase() === 'true';
    const membersCount = Math.max(0, Number(contact?.members_count) || 0);
    const draftTextRaw = String(contact?.draft_text || '');
    const hasDraft = Boolean(contact?.has_draft) && Boolean(draftTextRaw.trim());
    const draftText = hasDraft ? draftTextRaw : '';
    const lastMessageText = hasDraft ? draftText : (contact?.last_message || '');
    const previewIsSelf = hasDraft || isSavedMessages ? false : isSelf;
    const draftUpdatedAtRaw = String(contact?.draft_updated_at || '').trim();
    const lastMessageTimeRaw = String(contact?.last_message_time || '').trim();
    const previewTimestampRaw = hasDraft ? (draftUpdatedAtRaw || lastMessageTimeRaw) : lastMessageTimeRaw;
    const lastMessageTimestamp = toMessageTimestamp(previewTimestampRaw);
    const timeText = formatSidebarTime(previewTimestampRaw);
    const rawLastMsg = String(contact?.last_message || '');
    const rawLastSenderId = String(contact?.last_sender_id || '');
    const lastMessageHtml = renderSidebarLastMessageHtml(lastMessageText, {
        isSelf: previewIsSelf,
        maxLen: 68,
        isDraft: hasDraft,
        draftLabel: contact?.draft_label,
    });

    return `
<div class="contact-item ripple-target${isActive ? ' active' : ''}" data-chat-id="${escapeHtml(String(chatId))}" data-contact-id="${escapeHtml(String(contact?.userId || ''))}" data-contact-username="${escapeHtml(String(contact?.username || ''))}" data-public-key="${escapeHtml(String(contact?.public_key || ''))}" data-is-group="${isGroup ? '1' : '0'}" data-members-count="${escapeHtml(String(membersCount))}" data-blocked-by-me="${blockedByMe ? '1' : '0'}" data-blocked-me="${blockedMe ? '1' : '0'}" data-muted="${muted ? '1' : '0'}" data-saved-messages="${isSavedMessages ? '1' : '0'}" data-can-group-add-direct="${contact?.can_group_add_direct === false ? '0' : '1'}" data-pinned="${contact?.is_pinned ? '1' : '0'}"${pinOrderAttr} draggable="${contact?.is_pinned ? 'true' : 'false'}" data-raw-last-message="${escapeHtml(rawLastMsg)}" data-raw-last-message-time="${escapeHtml(lastMessageTimeRaw)}" data-last-sender-id="${escapeHtml(rawLastSenderId)}" data-last-seen="${escapeHtml(String(contact?.last_seen || ''))}" data-last-message-is-read="${isStatusTrueFlag(contact?.last_message_is_read) ? '1' : '0'}" data-last-message-is-delivered="${isStatusTrueFlag(contact?.last_message_is_delivered) ? '1' : '0'}" data-last-message-time="${escapeHtml(previewTimestampRaw)}" data-last-message-ts="${escapeHtml(lastMessageTimestamp)}" data-has-draft="${hasDraft ? '1' : '0'}" data-draft-text="${escapeHtml(draftText)}" data-draft-updated-at="${escapeHtml(draftUpdatedAtRaw)}">
    <div class="contact-avatar${hasAvatar ? ' avatar-loading' : ''}">
        ${avatarHtml}
        ${avatarLoadingBarsHtml}
        <div class="status-dot ${(contact?.is_online && !isBlocked) ? 'online' : ''}"></div>
    </div>
    <div class="contact-info">
        <div class="contact-name-row">
            <div class="contact-name-main">
                <span class="contact-name">${escapeHtml(displayName)}</span>
                ${muteIconHtml}
            </div>
            ${buildSidebarTimeMetaHtml(timeText, previewIsSelf, {
                is_read: isStatusTrueFlag(contact?.last_message_is_read),
                is_delivered: isStatusTrueFlag(contact?.last_message_is_delivered),
            }, unread)}
        </div>
        <div class="contact-last-msg-row">
            <span class="contact-last-msg">${lastMessageHtml}</span>
            <span class="unread-badge${unread ? '' : ' unread-badge--hidden'}">${unread ? unreadText : ''}</span>
        </div>
    </div>
</div>`;
}

export function updateSidebarContactTick(chatId, tickStatus, contactsRoot = document) {
    if (chatId === null || chatId === undefined) return;
    const escapedChatId = escapeSelectorValue(chatId);
    const root = contactsRoot && typeof contactsRoot.querySelector === 'function' ? contactsRoot : document;
    const contactItem = root.querySelector(`.contact-item[data-chat-id="${escapedChatId}"]`);
    if (!contactItem) return;
    const timeMetaEl = contactItem.querySelector('.contact-time-meta');
    if (!timeMetaEl) return;

    const nextStatus = normalizeTickStatus(tickStatus);
    let tickHtml = buildSidebarTickHtml(nextStatus);
    const currentTick = timeMetaEl.querySelector('.sidebar-tick');
    if (!tickHtml) {
        currentTick?.remove();
        return;
    }
    const currentStatus = currentTick
        ? normalizeTickStatus({
            pending: currentTick.classList.contains('pending'),
            is_read: currentTick.classList.contains('read'),
            is_delivered: currentTick.classList.contains('delivered'),
        })
        : '';
    if (currentTick && currentStatus !== 'read' && nextStatus === 'read') {
        tickHtml = tickHtml.replace('sidebar-tick read', 'sidebar-tick read sidebar-tick--read-enter');
    }
    if (currentTick) {
        currentTick.outerHTML = tickHtml;
        return;
    }
    timeMetaEl.insertAdjacentHTML('afterbegin', tickHtml);
}

export function updateActiveContactLastMessage(el, text, isSelf, deliveryState, createdAt, options = {}) {
    if (!el) return;
    const isDraft = Boolean(options?.isDraft);
    const isSavedMessages = String(el.getAttribute('data-saved-messages') || '') === '1';
    const draftText = String(options?.draftText ?? text ?? '');
    const normalizedText = isDraft ? draftText : String(text ?? '');
    const effectiveIsSelf = isDraft || isSavedMessages ? false : Boolean(isSelf);
    const draftLabel = options?.draftLabel;

    if (isDraft) {
        const draftUpdatedAt = String(createdAt || new Date().toISOString());
        el.setAttribute('data-has-draft', '1');
        el.setAttribute('data-draft-text', draftText);
        el.setAttribute('data-draft-updated-at', draftUpdatedAt);
    } else {
        el.setAttribute('data-has-draft', '0');
        el.setAttribute('data-draft-text', '');
        el.setAttribute('data-draft-updated-at', '');
        el.setAttribute('data-raw-last-message', normalizedText);
        el.setAttribute('data-last-message-is-read', isStatusTrueFlag(deliveryState?.is_read) ? '1' : '0');
        el.setAttribute('data-last-message-is-delivered', isStatusTrueFlag(deliveryState?.is_delivered) ? '1' : '0');
        if (createdAt) {
            el.setAttribute('data-raw-last-message-time', String(createdAt));
        }
    }

    const lastMsgEl = el.querySelector('.contact-last-msg');
    if (lastMsgEl) {
        lastMsgEl.innerHTML = renderSidebarLastMessageHtml(normalizedText, {
            isSelf: effectiveIsSelf,
            maxLen: 68,
            isDraft,
            draftLabel,
        });
        applyEmojiGraphics(lastMsgEl);
    }

    const timeMetaEl = el.querySelector('.contact-time-meta');
    if (!timeMetaEl) return;
    const unreadBadge = el.querySelector('.unread-badge');
    const isUnread = Boolean(unreadBadge && unreadBadge.style.display !== 'none');
    const normalizedCreatedAt = createdAt
        || el.getAttribute('data-last-message-time')
        || new Date().toISOString();
    el.setAttribute('data-last-message-time', String(normalizedCreatedAt));
    el.setAttribute('data-last-message-ts', toMessageTimestamp(normalizedCreatedAt));
    const timeText = formatSidebarTime(normalizedCreatedAt);
    timeMetaEl.outerHTML = buildSidebarTimeMetaHtml(
        timeText,
        effectiveIsSelf,
        {
            pending: isStatusTrueFlag(deliveryState?.pending),
            is_read: isStatusTrueFlag(deliveryState?.is_read),
            is_delivered: isStatusTrueFlag(deliveryState?.is_delivered),
        },
        isUnread,
    );
}
