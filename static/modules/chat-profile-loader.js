const DEFAULT_PROFILE_STATS = { photos: 0, files: 0, links: 0 };

export function loadAndShowPartnerProfileFlow({
    resolveCurrentPartnerId = () => '',
    setCurrentPartnerId = () => {},
    bumpProfileLoadToken = () => 0,
    getProfileLoadToken = () => 0,
    setProfileLoading = () => {},
    resetProfileScroll = () => {},
    openPartnerProfileDrawer = () => {},
    closeProfileMoreMenu = () => {},
    syncMuteButton = () => {},
    renderProfileMediaPanel = () => {},
    fetchUserProfile = async () => null,
    applyChatBlockState = () => {},
    normalizeBlockState = (value) => value,
    getCurrentBlockState = () => ({}),
    getCurrentContactPublicKey = () => '',
    getCurrentPartnerData = () => null,
    isChatBlocked = () => false,
    renderPartnerProfile = () => {},
    revealProfileDrawerContent = () => {},
    showToast = () => {},
} = {}) {
    const partnerId = resolveCurrentPartnerId();
    if (!partnerId) return;
    setCurrentPartnerId(partnerId);
    const currentProfileLoadToken = bumpProfileLoadToken();
    setProfileLoading(true);
    resetProfileScroll();
    openPartnerProfileDrawer();
    closeProfileMoreMenu();
    syncMuteButton();
    renderProfileMediaPanel();

    fetchUserProfile(partnerId)
        .then((p) => {
            if (currentProfileLoadToken !== getProfileLoadToken()) return;
            if (!p?.success) {
                setProfileLoading(false);
                return;
            }
            if (p.block_state) applyChatBlockState(p.block_state, { syncChatRoom: false });
            const normalizedProfile = {
                ...p,
                user_id: p.user_id ?? partnerId,
                display_name: p.display_name || p.username || '',
                username: p.username || '',
                online: Boolean(p.online),
                last_seen: p.last_seen || null,
                created_at: p.created_at || null,
                restricted: Boolean(p.restricted),
                public_key: p.public_key || getCurrentContactPublicKey() || '',
                avatar_url: p.avatar_url || null,
                bio: p.bio || '',
                stats: p.stats || DEFAULT_PROFILE_STATS,
                block_state: normalizeBlockState(p.block_state || getCurrentBlockState()),
                _saved_messages_profile: p._saved_messages_profile === true,
                _message_count: Math.max(0, Number(p._message_count) || 0),
            };
            renderPartnerProfile(normalizedProfile);
            renderProfileMediaPanel();
            revealProfileDrawerContent();
            setProfileLoading(false);
        })
        .catch(() => {
            if (currentProfileLoadToken !== getProfileLoadToken()) return;
            const currentPartnerData = getCurrentPartnerData();
            if (currentPartnerData) {
                renderPartnerProfile({
                    ...currentPartnerData,
                    restricted: isChatBlocked(),
                    stats: currentPartnerData.stats || DEFAULT_PROFILE_STATS,
                });
                renderProfileMediaPanel();
                revealProfileDrawerContent();
                setProfileLoading(false);
                return;
            }
            setProfileLoading(false);
            showToast('Не удалось загрузить профиль пользователя.', 'warning');
        });
}
