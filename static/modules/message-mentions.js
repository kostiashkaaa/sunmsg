const GROUP_MENTION_PATTERN = /(^|[\s([{])@([A-Za-z0-9_.-]{1,64})/g;

export function extractMentionedUsernames(text, { maxMentions = 32 } = {}) {
    const source = String(text || '');
    const limit = Math.max(0, Number(maxMentions) || 0);
    const seen = new Set();
    const result = [];
    for (const match of source.matchAll(GROUP_MENTION_PATTERN)) {
        const username = String(match?.[2] || '').trim().toLowerCase();
        if (!username || seen.has(username)) continue;
        seen.add(username);
        result.push(username);
        if (result.length >= limit) break;
    }
    return result;
}
