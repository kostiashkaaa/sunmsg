export function createPostRenderUiRefreshScheduler({
    requestAnimationFrameFn,
    applyActiveMessageSearchFilter,
    updateJumpToNewMessagesButton,
    syncE2EPillState,
    applyExpiryBadges,
    applyAlbums,
} = {}) {
    const requestFrame = typeof requestAnimationFrameFn === 'function'
        ? requestAnimationFrameFn
        : (handler) => setTimeout(handler, 0);

    let pendingPostRenderUiFrame = 0;
    let pendingSearchFilterRefresh = false;
    let pendingJumpButtonRefresh = false;
    let pendingE2EPillRefresh = false;
    let pendingExpiryBadgesRefresh = false;
    let pendingAlbumsRefresh = false;

    function schedulePostRenderUiRefresh({ searchFilter = false, jumpButton = false, e2ePill = false, expiryBadges = false, albums = false } = {}) {
        pendingSearchFilterRefresh = pendingSearchFilterRefresh || Boolean(searchFilter);
        pendingJumpButtonRefresh = pendingJumpButtonRefresh || Boolean(jumpButton);
        pendingE2EPillRefresh = pendingE2EPillRefresh || Boolean(e2ePill);
        pendingExpiryBadgesRefresh = pendingExpiryBadgesRefresh || Boolean(expiryBadges);
        pendingAlbumsRefresh = pendingAlbumsRefresh || Boolean(albums);
        if (pendingPostRenderUiFrame) return;

        pendingPostRenderUiFrame = requestFrame(() => {
            pendingPostRenderUiFrame = 0;
            const shouldRefreshSearch = pendingSearchFilterRefresh;
            const shouldRefreshJump = pendingJumpButtonRefresh;
            const shouldRefreshE2E = pendingE2EPillRefresh;
            const shouldRefreshExpiry = pendingExpiryBadgesRefresh;
            const shouldRefreshAlbums = pendingAlbumsRefresh;
            pendingSearchFilterRefresh = false;
            pendingJumpButtonRefresh = false;
            pendingE2EPillRefresh = false;
            pendingExpiryBadgesRefresh = false;
            pendingAlbumsRefresh = false;

            if (shouldRefreshSearch) applyActiveMessageSearchFilter?.();
            if (shouldRefreshJump) updateJumpToNewMessagesButton?.();
            if (shouldRefreshE2E) syncE2EPillState?.();
            if (shouldRefreshExpiry) applyExpiryBadges?.();
            if (shouldRefreshAlbums) applyAlbums?.();
        });
    }

    return { schedulePostRenderUiRefresh };
}
