const DEFAULT_REFRESH_MS = 15000;

function normalizeProfileUserId(profile = {}) {
    const raw = profile.user_id ?? profile.userId ?? '';
    const value = String(raw || '').trim();
    return value && /^\d+$/.test(value) ? value : '';
}

export function createProfileSpotifyLiveUpdater({
    fetchUserProfile = async () => null,
    getCurrentPartnerId = () => '',
    getCurrentPartnerData = () => null,
    isProfileDrawerOpen = () => false,
    renderPartnerProfile = () => {},
    intervalMs = DEFAULT_REFRESH_MS,
} = {}) {
    let timerId = 0;
    let activeUserId = '';
    let inFlight = false;

    function stop() {
        if (!timerId) return;
        window.clearInterval(timerId);
        timerId = 0;
        activeUserId = '';
        inFlight = false;
    }

    async function refresh() {
        if (!activeUserId || inFlight) return;
        if (!isProfileDrawerOpen()) {
            stop();
            return;
        }

        const currentPartnerId = String(getCurrentPartnerId() || '').trim();
        if (currentPartnerId && currentPartnerId !== activeUserId) {
            stop();
            return;
        }

        inFlight = true;
        try {
            const payload = await fetchUserProfile(activeUserId);
            if (!payload?.success || payload?._group_profile) return;
            renderPartnerProfile({
                ...(getCurrentPartnerData() || {}),
                ...payload,
                user_id: payload.user_id ?? activeUserId,
            });
        } catch (_) {
            // The next interval will retry; profile rendering should stay as-is.
        } finally {
            inFlight = false;
        }
    }

    function sync(profile = {}) {
        const userId = normalizeProfileUserId(profile);
        if (!userId || profile._group_profile || profile._saved_messages_profile) {
            stop();
            return;
        }
        if (activeUserId === userId && timerId) return;

        stop();
        activeUserId = userId;
        timerId = window.setInterval(refresh, Math.max(5000, Number(intervalMs) || DEFAULT_REFRESH_MS));
    }

    return {
        stop,
        sync,
    };
}
