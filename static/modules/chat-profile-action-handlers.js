export function createProfileContactRequestSender({
    fetchImpl = fetch,
    resolveAppUrl = (path) => path,
    getCsrfToken = () => '',
    getErrorMessage = (error, fallback = '') => error?.message || String(error || fallback),
    showToast = () => {},
    loadDialogRequests = () => {},
} = {}) {
    return async function sendProfileContactRequest({ userId, displayName } = {}) {
        const normalizedUserId = Number.parseInt(String(userId || '').trim(), 10);
        if (!Number.isFinite(normalizedUserId) || normalizedUserId <= 0) {
            console.warn('[ProfileContactRequest] invalid user id');
            return false;
        }
        try {
            const response = await fetchImpl(resolveAppUrl('/send_request'), {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({ contact_user_id: normalizedUserId }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.success) {
                console.warn('[ProfileContactRequest] send failed', getErrorMessage(payload?.error || 'Не удалось отправить запрос.'));
                return false;
            }
            loadDialogRequests?.();
            return true;
        } catch (err) {
            console.warn('[ProfileContactRequest] send request failed', err);
            return false;
        }
    };
}

export function createProfileActionHandler({
    profileOrchestrator,
    profileMetaUserId = null,
    closeProfileMoreMenu = () => {},
    getCurrentPartnerData = () => null,
    openReportModal = () => {},
    showToast = () => {},
} = {}) {
    return async function handleProfileAction(action) {
        if (action === 'report-user') {
            closeProfileMoreMenu();
            const partnerData = getCurrentPartnerData() || {};
            if (partnerData._group_profile) {
                showToast('Жалоба на группу пока не поддерживается. Если нужно, откройте профиль участника и отправьте жалобу на него.', 'info');
                return;
            }
            const parsedTargetId = Number.parseInt(
                String(partnerData.userId || profileMetaUserId?.textContent || '').trim(),
                10,
            );
            if (!Number.isFinite(parsedTargetId) || parsedTargetId <= 0) {
                showToast('Невозможно пожаловаться: для этого чата недоступен идентификатор пользователя.', 'warning');
                return;
            }
            openReportModal({
                targetType: 'user',
                targetId: String(parsedTargetId),
                messageId: null,
                displayName: String(partnerData.display_name || '').trim(),
                username: String(partnerData.username || '').replace(/^@+/, '').trim(),
            });
            return;
        }
        await profileOrchestrator.handleProfileAction(action);
    };
}
