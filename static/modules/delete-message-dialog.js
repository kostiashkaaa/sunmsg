import { buildAvatarInitials } from './utils.js';

const DEFAULT_PEER_NAME = '\u0421\u043E\u0431\u0435\u0441\u0435\u0434\u043D\u0438\u043A';
const DEFAULT_MEMBER_NAME = '\u0423\u0447\u0430\u0441\u0442\u043D\u0438\u043A';

function cleanText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

const getInitials = buildAvatarInitials;

function getWindowRef(messageEl) {
    return messageEl?.ownerDocument?.defaultView
        || (typeof window !== 'undefined' ? window : globalThis);
}

function getBootstrapUser(windowRef) {
    return windowRef?.SUN_BOOTSTRAP?.user || {};
}

function resolveCurrentUser(windowRef) {
    const bootstrapUser = getBootstrapUser(windowRef);
    const name = cleanText(
        windowRef?.currentDisplayName
        || bootstrapUser.currentDisplayName
        || windowRef?.currentUsername
        || bootstrapUser.currentUsername
        || '\u0412\u044B'
    );
    return {
        key: 'self',
        name,
        avatarUrl: cleanText(windowRef?.currentAvatarUrl || bootstrapUser.currentAvatarUrl),
    };
}

function resolvePartner(windowRef) {
    const partnerData = windowRef?.currentPartnerData || {};
    const isGroup = Boolean(partnerData._group_profile);
    const name = cleanText(partnerData.display_name || partnerData.username);
    return {
        isGroup,
        name,
        avatarUrl: cleanText(partnerData.avatar_url),
    };
}

function resolveGroupedSenderLabel(messageEl) {
    let current = messageEl;
    while (current?.classList?.contains('message')) {
        const label = cleanText(current.querySelector('.message-sender-label')?.textContent);
        if (label) return label;
        if (current.classList.contains('group-start') || current.classList.contains('group-single')) break;
        current = current.previousElementSibling;
    }
    return '';
}

function resolveMessageAuthor(messageEl) {
    const windowRef = getWindowRef(messageEl);
    if (!messageEl) {
        const partner = resolvePartner(windowRef);
        return {
            key: 'unknown',
            name: partner.isGroup ? DEFAULT_MEMBER_NAME : (partner.name || DEFAULT_PEER_NAME),
            avatarUrl: partner.isGroup ? '' : partner.avatarUrl,
        };
    }

    if (messageEl.classList.contains('self')) {
        return resolveCurrentUser(windowRef);
    }

    const partner = resolvePartner(windowRef);
    const avatarImg = messageEl.querySelector('.message-avatar-slot .message-avatar img');
    const profileTrigger = messageEl.querySelector('[data-profile-user-id]');
    const profileUserId = cleanText(profileTrigger?.getAttribute('data-profile-user-id'));
    const avatarFallback = cleanText(messageEl.querySelector('.message-avatar-slot .message-avatar')?.textContent);
    const name = cleanText(
        resolveGroupedSenderLabel(messageEl)
        || avatarImg?.getAttribute('alt')
        || (!partner.isGroup ? partner.name : '')
        || (avatarFallback.length > 1 ? avatarFallback : '')
        || (partner.isGroup ? DEFAULT_MEMBER_NAME : DEFAULT_PEER_NAME)
    );

    return {
        key: profileUserId ? `user:${profileUserId}` : `name:${name}`,
        name,
        avatarUrl: cleanText(
            avatarImg?.currentSrc
            || avatarImg?.getAttribute('src')
            || (!partner.isGroup ? partner.avatarUrl : '')
        ),
    };
}

function resolveDialogAuthor(messageEls) {
    const windowRef = getWindowRef(messageEls[0]);
    const partner = resolvePartner(windowRef);
    return {
        key: partner.isGroup ? 'group' : 'partner',
        name: partner.name || DEFAULT_PEER_NAME,
        avatarUrl: partner.avatarUrl,
    };
}

function getMessageWord(count) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return '\u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435';
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return '\u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F';
    return '\u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0439';
}

function renderAvatar(avatarEl, author) {
    if (!avatarEl) return;

    avatarEl.replaceChildren();
    avatarEl.classList.toggle('delete-confirm-modal__avatar--image', Boolean(author.avatarUrl));

    if (author.avatarUrl) {
        const img = avatarEl.ownerDocument.createElement('img');
        img.src = author.avatarUrl;
        img.alt = author.name;
        avatarEl.append(img);
        return;
    }

    avatarEl.textContent = getInitials(author.name);
}

function buildDeleteForBothLabel(windowRef) {
    const partner = resolvePartner(windowRef);
    if (partner.isGroup) return '\u0422\u0430\u043A\u0436\u0435 \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u0434\u043B\u044F \u0432\u0441\u0435\u0445';
    return `\u0422\u0430\u043A\u0436\u0435 \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u0434\u043B\u044F ${partner.name || DEFAULT_PEER_NAME}`;
}

export function updateDeleteMessageDialog({
    messageEls = [],
    titleEl = null,
    textEl = null,
    authorAvatarEl = null,
    authorNameEl = null,
    deleteForBothLabelEl = null,
} = {}) {
    const count = Math.max(1, messageEls.length);
    const author = resolveDialogAuthor(messageEls);

    if (titleEl) {
        titleEl.textContent = count === 1
            ? '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435'
            : `\u0423\u0434\u0430\u043B\u0438\u0442\u044C ${count} ${getMessageWord(count)}`;
    }
    if (textEl) {
        textEl.textContent = count === 1
            ? '\u0412\u044B \u0442\u043E\u0447\u043D\u043E \u0445\u043E\u0442\u0438\u0442\u0435 \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u044D\u0442\u043E \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435?'
            : '\u0412\u044B \u0442\u043E\u0447\u043D\u043E \u0445\u043E\u0442\u0438\u0442\u0435 \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u044D\u0442\u0438 \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F?';
    }
    if (authorNameEl) {
        authorNameEl.textContent = author.name;
    }
    renderAvatar(authorAvatarEl, author);

    if (deleteForBothLabelEl) {
        const windowRef = getWindowRef(messageEls[0]);
        deleteForBothLabelEl.textContent = buildDeleteForBothLabel(windowRef);
    }
}
