const GROUP_ROLES = ['owner', 'admin', 'moderator', 'member'];
const GROUP_SANCTIONS = ['mute_temp', 'ban_temp', 'ban_perma'];

function normalizeRoleValue(role) {
    return String(role || '').trim().toLowerCase();
}

export function normalizeGroupRole(role) {
    const normalized = normalizeRoleValue(role);
    if (GROUP_ROLES.includes(normalized)) return normalized;
    return 'member';
}

export function groupRoleLabel(role) {
    const normalized = normalizeGroupRole(role);
    if (normalized === 'owner') return 'Owner';
    if (normalized === 'admin') return 'Admin';
    if (normalized === 'moderator') return 'Moderator';
    return 'Member';
}

export function formatGroupSanctionSummary(sanction, { formatLastSeenText } = {}) {
    if (!sanction) return '';
    const actionType = String(sanction.action_type || '').trim().toLowerCase();
    const expiresAt = String(sanction.expires_at || '').trim();
    if (actionType === 'mute_temp') {
        return expiresAt && typeof formatLastSeenText === 'function'
            ? `Muted until ${formatLastSeenText(expiresAt)}`
            : 'Muted';
    }
    if (actionType === 'ban_temp') {
        return expiresAt && typeof formatLastSeenText === 'function'
            ? `Banned until ${formatLastSeenText(expiresAt)}`
            : 'Banned';
    }
    if (actionType === 'ban_perma') return 'Banned permanently';
    return actionType || 'Restricted';
}

async function parseJsonSafe(response) {
    return response.json().catch(() => ({}));
}

export function createGroupModerationApi({
    withAppRoot,
    getCsrfToken,
    showToast,
    loadContacts,
    getCurrentGroupProfile,
    getCurrentChatId,
    refreshCurrentGroupProfileIfVisible,
    fetchImpl = fetch,
} = {}) {
    async function updateGroupMemberRole(targetUserId, role, { onLocalRoleUpdated } = {}) {
        const profile = getCurrentGroupProfile?.();
        if (!profile) return;
        const chatId = String(profile.chat_id || getCurrentChatId?.() || '').trim();
        if (!chatId) return;
        try {
            const response = await fetchImpl(withAppRoot('/api/chats/group/set_role'), {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({
                    chat_id: chatId,
                    target_user_id: targetUserId,
                    role,
                }),
            });
            const payload = await parseJsonSafe(response);
            if (!response.ok || !payload?.success) {
                throw new Error(payload?.error || 'Не удалось изменить роль.');
            }
            onLocalRoleUpdated?.(targetUserId, role);
            showToast('Роль обновлена.', 'success');
        } catch (error) {
            showToast(error?.message || 'Не удалось изменить роль.', 'danger');
        }
    }

    async function removeGroupMember(targetUserId) {
        const profile = getCurrentGroupProfile?.();
        if (!profile) return;
        const chatId = String(profile.chat_id || getCurrentChatId?.() || '').trim();
        if (!chatId) return;
        try {
            const response = await fetchImpl(withAppRoot('/api/chats/group/remove_member'), {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({
                    chat_id: chatId,
                    target_user_id: targetUserId,
                }),
            });
            const payload = await parseJsonSafe(response);
            if (!response.ok || !payload?.success) {
                throw new Error(payload?.error || 'Failed to remove member.');
            }
            showToast('Member removed.', 'success');
            await loadContacts({ immediate: true, attemptInitialChatRestore: false });
            refreshCurrentGroupProfileIfVisible?.();
        } catch (error) {
            showToast(error?.message || 'Failed to remove member.', 'danger');
        }
    }

    async function applyGroupMemberSanction(targetUserId, actionType, durationSeconds = 0) {
        const profile = getCurrentGroupProfile?.();
        if (!profile) return;
        const chatId = String(profile.chat_id || getCurrentChatId?.() || '').trim();
        if (!chatId) return;
        try {
            const response = await fetchImpl(withAppRoot('/api/chats/group/sanctions'), {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({
                    chat_id: chatId,
                    target_user_id: targetUserId,
                    action_type: actionType,
                    duration_seconds: Number(durationSeconds) || 0,
                    reason_code: 'group_moderation',
                }),
            });
            const payload = await parseJsonSafe(response);
            if (!response.ok || !payload?.success) {
                throw new Error(payload?.error || 'Failed to apply group sanction.');
            }
            showToast('Sanction applied.', 'success');
            await loadContacts({ immediate: true, attemptInitialChatRestore: false });
            refreshCurrentGroupProfileIfVisible?.();
        } catch (error) {
            showToast(error?.message || 'Failed to apply group sanction.', 'danger');
        }
    }

    async function submitGroupSanctionAppeal(sanctionId) {
        const parsedSanctionId = Number.parseInt(String(sanctionId || '').trim(), 10);
        if (!Number.isFinite(parsedSanctionId) || parsedSanctionId <= 0) return;
        try {
            const response = await fetchImpl(withAppRoot('/api/moderation/appeals'), {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({
                    sanction_id: parsedSanctionId,
                    text: 'Please review this group sanction.',
                }),
            });
            const payload = await parseJsonSafe(response);
            if (!response.ok || !payload?.success) {
                throw new Error(payload?.error || 'Failed to submit appeal.');
            }
            showToast('Appeal submitted.', 'success');
            refreshCurrentGroupProfileIfVisible?.();
        } catch (error) {
            showToast(error?.message || 'Failed to submit appeal.', 'danger');
        }
    }

    return {
        updateGroupMemberRole,
        removeGroupMember,
        applyGroupMemberSanction,
        submitGroupSanctionAppeal,
    };
}

export function bindGroupModerationUiHandlers({
    groupEditMembersList,
    profileGroupMembers,
    updateGroupMemberRole,
    removeGroupMember,
    applyGroupMemberSanction,
    submitGroupSanctionAppeal,
    onGroupMemberClick,
} = {}) {
    groupEditMembersList?.addEventListener('click', (event) => {
        const roleBtn = event.target.closest('[data-group-role-target][data-group-role-next]');
        if (roleBtn) {
            const targetUserId = Number.parseInt(roleBtn.getAttribute('data-group-role-target') || '', 10);
            const nextRole = normalizeRoleValue(roleBtn.getAttribute('data-group-role-next') || '');
            if (!Number.isFinite(targetUserId) || targetUserId <= 0) return;
            if (!GROUP_ROLES.includes(nextRole)) return;
            void updateGroupMemberRole(targetUserId, nextRole);
            return;
        }

        const removeBtn = event.target.closest('[data-group-remove-target]');
        if (removeBtn) {
            const targetUserId = Number.parseInt(removeBtn.getAttribute('data-group-remove-target') || '', 10);
            if (!Number.isFinite(targetUserId) || targetUserId <= 0) return;
            void removeGroupMember(targetUserId);
            return;
        }

        const sanctionBtn = event.target.closest('[data-group-sanction-target][data-group-sanction-action]');
        if (!sanctionBtn) return;
        const targetUserId = Number.parseInt(sanctionBtn.getAttribute('data-group-sanction-target') || '', 10);
        const actionType = normalizeRoleValue(sanctionBtn.getAttribute('data-group-sanction-action') || '');
        const durationSeconds = Number.parseInt(
            String(sanctionBtn.getAttribute('data-group-sanction-duration') || '0').trim(),
            10,
        );
        if (!Number.isFinite(targetUserId) || targetUserId <= 0) return;
        if (!GROUP_SANCTIONS.includes(actionType)) return;
        void applyGroupMemberSanction(targetUserId, actionType, Number.isFinite(durationSeconds) ? durationSeconds : 0);
    });

    profileGroupMembers?.addEventListener('click', (event) => {
        const appealBtn = event.target.closest('[data-group-appeal-sanction-id]');
        if (appealBtn) {
            const sanctionId = Number.parseInt(appealBtn.getAttribute('data-group-appeal-sanction-id') || '', 10);
            if (!Number.isFinite(sanctionId) || sanctionId <= 0) return;
            void submitGroupSanctionAppeal(sanctionId);
            return;
        }

        const memberRow = event.target.closest('[data-group-member-user-id]');
        if (!memberRow) return;
        const insideActionButton = event.target.closest('button, a, [role="button"]');
        if (insideActionButton && !insideActionButton.isSameNode(memberRow)) return;

        const targetUserId = Number.parseInt(memberRow.getAttribute('data-group-member-user-id') || '', 10);
        if (!Number.isFinite(targetUserId) || targetUserId <= 0) return;
        onGroupMemberClick?.(targetUserId, memberRow);
    });

    profileGroupMembers?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        const memberRow = event.target.closest('[data-group-member-user-id]');
        if (!memberRow) return;
        const insideActionButton = event.target.closest('button, a, [role="button"]');
        if (insideActionButton && !insideActionButton.isSameNode(memberRow)) return;
        event.preventDefault();
        const targetUserId = Number.parseInt(memberRow.getAttribute('data-group-member-user-id') || '', 10);
        if (!Number.isFinite(targetUserId) || targetUserId <= 0) return;
        onGroupMemberClick?.(targetUserId, memberRow);
    });
}
