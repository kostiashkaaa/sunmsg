export function resolveCurrentPartnerId({
    getCurrentPartnerId = () => null,
    getCurrentContactId = () => null,
    getHeaderPartnerId = () => '',
    getActiveContactId = () => '',
    getCurrentPartnerData = () => null,
} = {}) {
    const knownPartnerId = getCurrentPartnerId();
    if (knownPartnerId) return String(knownPartnerId);

    const currentContactId = getCurrentContactId();
    if (currentContactId) return String(currentContactId);

    const headerPartnerId = String(getHeaderPartnerId() || '').trim();
    if (headerPartnerId) return headerPartnerId;

    const activeContactId = String(getActiveContactId() || '').trim();
    if (activeContactId) return activeContactId;

    const currentPartnerData = getCurrentPartnerData() || {};
    const profileUserId = currentPartnerData.userId || currentPartnerData.user_id || currentPartnerData.chat_id || null;
    return profileUserId ? String(profileUserId) : '';
}

export function handleProfileHeaderOpen({
    event,
    resolveCurrentPartnerId = () => '',
    profileOpenIgnoreSelector = '',
    setCurrentPartnerId = () => {},
    setChatPartnerHeaderId = () => {},
    setChatHeaderPartnerId = () => {},
    isProfileDrawerOpen = () => false,
    loadAndShowPartnerProfile = () => {},
} = {}) {
    const partnerId = resolveCurrentPartnerId();
    if (!partnerId) return;

    const eventTarget = event?.target;
    if (eventTarget && profileOpenIgnoreSelector && eventTarget.closest?.(profileOpenIgnoreSelector)) return;

    setCurrentPartnerId(partnerId);
    setChatPartnerHeaderId(partnerId);
    setChatHeaderPartnerId(partnerId);

    if (isProfileDrawerOpen()) return;
    loadAndShowPartnerProfile();
}
