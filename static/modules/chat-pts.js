export function normalizePositiveChatPts(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return null;
    const normalized = Math.floor(numeric);
    return normalized > 0 ? normalized : null;
}
