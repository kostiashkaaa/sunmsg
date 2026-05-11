// Reaction normalization, rendering, and optimistic update logic
import { escapeHtml } from './utils.js';

export const REACTION_PICKER_EMOJIS = [
    '\u{1F44D}', // 👍
    '\u{2764}\u{FE0F}', // ❤️
    '\u{1F602}', // 😂
    '\u{1F62E}', // 😮
    '\u{1F622}', // 😢
    '\u{1F525}', // 🔥
    '\u{1F44F}', // 👏
    '\u{1F389}', // 🎉
    '\u{1F440}', // 👀
    '\u{1F60D}', // 😍
    '\u{1F929}', // 🤩
    '\u{1F631}', // 😱
    '\u{1F92F}', // 🤯
    '\u{1F914}', // 🤔
    '\u{1F44C}', // 👌
    '\u{1F44E}', // 👎
    '\u{1F60A}', // 😊
    '\u{1F60E}', // 😎
    '\u{1F973}', // 🥳
    '\u{1F923}', // 🤣
    '\u{1F92A}', // 🤪
    '\u{1F92C}', // 🤬
    '\u{1F634}', // 😴
    '\u{1F970}', // 🥰
    '\u{1F607}', // 😇
    '\u{1F91D}', // 🤝
    '\u{1F64F}', // 🙏
    '\u{1F4AA}', // 💪
    '\u{2705}', // ✅
    '\u{274C}', // ❌
    '\u{1F680}', // 🚀
    '\u{1F381}', // 🎁
];

export function normalizeReactionReactor(rawReactor) {
    if (!rawReactor || typeof rawReactor !== 'object') return null;
    const parsedUserId = Number.parseInt(rawReactor.userId ?? rawReactor.user_id, 10);
    const userId = Number.isFinite(parsedUserId) && parsedUserId > 0 ? parsedUserId : null;
    const publicKey = String((rawReactor.publicKey ?? rawReactor.public_key) || '').trim() || null;
    const displayName = String((rawReactor.displayName ?? rawReactor.display_name) || '').trim();
    const username = String(rawReactor.username || '').trim();
    const avatarUrl = String((rawReactor.avatarUrl ?? rawReactor.avatar_url) || '').trim() || null;
    if (!userId && !publicKey && !displayName && !username && !avatarUrl) return null;
    return { userId, publicKey, displayName, username, avatarUrl };
}

export function getReactionReactorKey(reactor) {
    if (!reactor || typeof reactor !== 'object') return '';
    if (reactor.publicKey) return `pk:${reactor.publicKey}`;
    if (Number.isFinite(reactor.userId) && reactor.userId > 0) return `id:${reactor.userId}`;
    const username = String(reactor.username || '').trim().toLowerCase();
    if (username) return `un:${username}`;
    const displayName = String(reactor.displayName || '').trim().toLowerCase();
    if (displayName) return `dn:${displayName}`;
    return '';
}

export function normalizeReactionReactors(rawReactors) {
    const reactors = [];
    const keyToIndex = new Map();
    (Array.isArray(rawReactors) ? rawReactors : []).forEach((rawReactor) => {
        const reactor = normalizeReactionReactor(rawReactor);
        if (!reactor) return;
        const key = getReactionReactorKey(reactor);
        if (key && keyToIndex.has(key)) {
            const index = keyToIndex.get(key);
            const prev = reactors[index];
            reactors[index] = {
                ...prev,
                userId: reactor.userId ?? prev.userId,
                publicKey: reactor.publicKey || prev.publicKey || null,
                displayName: reactor.displayName || prev.displayName || '',
                username: reactor.username || prev.username || '',
                avatarUrl: reactor.avatarUrl || prev.avatarUrl || null,
            };
            return;
        }
        if (key) keyToIndex.set(key, reactors.length);
        reactors.push(reactor);
    });
    return reactors;
}

export function isCurrentUserReactionReactor(reactor, currentUserPublicKey) {
    const myPublicKey = String(currentUserPublicKey || '').trim();
    if (!myPublicKey || !reactor || typeof reactor !== 'object') return false;
    return String(reactor.publicKey || '').trim() === myPublicKey;
}

export function buildCurrentUserReactionReactor({ currentUserPublicKey, currentDisplayName, currentUsername, currentAvatarUrl }) {
    return normalizeReactionReactor({
        public_key: currentUserPublicKey || '',
        display_name: currentDisplayName || currentUsername || '\u0412\u044B',
        username: currentUsername || '',
        avatar_url: currentAvatarUrl || '',
    });
}

export function buildReactionReactorInitials(reactor) {
    const source = String(reactor?.displayName || reactor?.username || '?').trim();
    if (!source) return '?';
    const parts = source.split(/\s+/).filter(Boolean).slice(0, 2);
    const initials = parts.map((part) => part[0] || '').join('');
    return (initials || source[0] || '?').toUpperCase();
}

export function buildReactionReactorsHtml(rawReactors) {
    const reactors = normalizeReactionReactors(rawReactors).slice(0, 2);
    if (!reactors.length) return '';
    const itemsHtml = reactors.map((reactor) => {
        const label = String(reactor.displayName || reactor.username || '\u041F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C').trim();
        if (reactor.avatarUrl) {
            return `<span class="reaction-reactor" title="${escapeHtml(label)}"><img src="${escapeHtml(reactor.avatarUrl)}" alt="${escapeHtml(label)}"></span>`;
        }
        return `<span class="reaction-reactor reaction-reactor--fallback" title="${escapeHtml(label)}">${escapeHtml(buildReactionReactorInitials(reactor))}</span>`;
    }).join('');
    return `<span class="reaction-pill__reactors" aria-hidden="true">${itemsHtml}</span>`;
}

export function normalizeMessageReactions(rawReactions, { currentUserPublicKey } = {}) {
    const merged = new Map();
    const isMe = (r) => isCurrentUserReactionReactor(r, currentUserPublicKey);
    (Array.isArray(rawReactions) ? rawReactions : []).forEach((item) => {
        const emoji = String(item?.emoji || '').trim();
        if (!REACTION_PICKER_EMOJIS.includes(emoji)) return;
        const reactors = normalizeReactionReactors(item?.reactors);
        const parsedCount = Number.parseInt(item?.count, 10);
        const reactedByMe = Boolean(item?.reactedByMe ?? item?.reacted_by_me) || reactors.some(isMe);
        const count = Math.max(
            Number.isFinite(parsedCount) ? parsedCount : 0,
            reactors.length || 0,
            reactedByMe ? 1 : 0,
        );
        if (count <= 0) return;
        const prev = merged.get(emoji);
        if (!prev) {
            merged.set(emoji, { emoji, count, reactedByMe, reactors });
            return;
        }
        const mergedReactors = normalizeReactionReactors([...(prev.reactors || []), ...reactors]);
        merged.set(emoji, {
            emoji,
            count: Math.max(prev.count, count, mergedReactors.length || 0),
            reactedByMe: prev.reactedByMe || reactedByMe,
            reactors: mergedReactors,
        });
    });
    const rank = new Map(REACTION_PICKER_EMOJIS.map((emoji, index) => [emoji, index]));
    return Array.from(merged.values()).sort((a, b) => {
        if (a.count !== b.count) return b.count - a.count;
        return (rank.get(a.emoji) ?? 999) - (rank.get(b.emoji) ?? 999);
    });
}

export function areMessageReactionsEqual(a, b, opts = {}) {
    const left = normalizeMessageReactions(a, opts);
    const right = normalizeMessageReactions(b, opts);
    const serializeReactor = (reactor) => [
        getReactionReactorKey(reactor),
        String(reactor?.avatarUrl || ''),
        String(reactor?.displayName || ''),
        String(reactor?.username || ''),
        String(reactor?.publicKey || ''),
        Number.isFinite(reactor?.userId) ? String(reactor.userId) : '',
    ].join('\u0001');

    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
        if (left[i].emoji !== right[i].emoji) return false;
        if (left[i].count !== right[i].count) return false;
        if (left[i].reactedByMe !== right[i].reactedByMe) return false;
        const lr = normalizeReactionReactors(left[i].reactors).map(serializeReactor).sort();
        const rr = normalizeReactionReactors(right[i].reactors).map(serializeReactor).sort();
        if (lr.length !== rr.length) return false;
        for (let r = 0; r < lr.length; r += 1) {
            if (lr[r] !== rr[r]) return false;
        }
    }
    return true;
}

export function getReactionMessageKey(chatId, messageId) {
    return `${String(chatId || '')}:${Number(messageId) || 0}`;
}

export function computeOptimisticReactions(rawReactions, emoji, userContext) {
    const { currentUserPublicKey } = userContext;
    const isMe = (r) => isCurrentUserReactionReactor(r, currentUserPublicKey);
    const normalizedEmoji = String(emoji || '').trim();
    const reactions = normalizeMessageReactions(rawReactions, { currentUserPublicKey }).map((item) => ({
        ...item,
        reactors: normalizeReactionReactors(item.reactors),
    }));
    if (!REACTION_PICKER_EMOJIS.includes(normalizedEmoji)) return reactions;

    const withoutMe = (rawReactors) => normalizeReactionReactors(rawReactors).filter((r) => !isMe(r));
    const currentUserReactor = buildCurrentUserReactionReactor(userContext);
    const myReactionIndex = reactions.findIndex(
        (item) => item.reactedByMe || normalizeReactionReactors(item.reactors).some(isMe)
    );

    const removeMyReactionAt = (index) => {
        if (index < 0 || index >= reactions.length) return;
        const target = reactions[index];
        target.count = Math.max(0, Number(target.count || 0) - 1);
        target.reactedByMe = false;
        target.reactors = withoutMe(target.reactors);
        if (target.count <= 0) { reactions.splice(index, 1); return; }
        target.count = Math.max(target.count, target.reactors.length || 0);
    };

    if (myReactionIndex >= 0 && reactions[myReactionIndex].emoji === normalizedEmoji) {
        removeMyReactionAt(myReactionIndex);
        return normalizeMessageReactions(reactions, { currentUserPublicKey });
    }
    if (myReactionIndex >= 0) removeMyReactionAt(myReactionIndex);

    const sameEmojiIndex = reactions.findIndex((item) => item.emoji === normalizedEmoji);
    if (sameEmojiIndex >= 0) {
        const target = reactions[sameEmojiIndex];
        target.count += 1;
        target.reactedByMe = true;
        const reactorsWithoutMe = withoutMe(target.reactors);
        target.reactors = currentUserReactor ? [...reactorsWithoutMe, currentUserReactor] : reactorsWithoutMe;
        target.count = Math.max(target.count, target.reactors.length || 0, 1);
    } else {
        const nextReactors = currentUserReactor ? [currentUserReactor] : [];
        reactions.push({ emoji: normalizedEmoji, count: Math.max(1, nextReactors.length), reactedByMe: true, reactors: nextReactors });
    }
    return normalizeMessageReactions(reactions, { currentUserPublicKey });
}

export function buildMessageReactionsHtml(msgId, rawReactions, opts = {}) {
    const numericMsgId = Number(msgId);
    if (!Number.isFinite(numericMsgId) || numericMsgId <= 0) return '';
    const reactions = normalizeMessageReactions(rawReactions, opts);
    if (!reactions.length) return '';
    const pillsHtml = reactions.map((reaction) => {
        const mineClass = reaction.reactedByMe ? ' is-mine' : '';
        const reactorsHtml = buildReactionReactorsHtml(reaction.reactors);
        const countHtml = reaction.count > 1
            ? `<span class="reaction-pill__count">${escapeHtml(String(reaction.count))}</span>`
            : '';
        return `<button type="button" class="reaction-pill${mineClass}" data-msg-id="${numericMsgId}" data-emoji="${escapeHtml(reaction.emoji)}">
            <span class="reaction-pill__emoji">${escapeHtml(reaction.emoji)}</span>
            ${reactorsHtml}
            ${countHtml}
        </button>`;
    }).join('');
    return `<div class="message-reactions has-items" data-msg-id="${numericMsgId}">${pillsHtml}</div>`;
}

