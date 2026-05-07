export function normalizeGroupRole(role) {
    const normalized = String(role || '').trim().toLowerCase();
    if (['owner', 'admin', 'moderator', 'member'].includes(normalized)) return normalized;
    return 'member';
}

export function groupRoleLabel(role) {
    const normalized = normalizeGroupRole(role);
    if (normalized === 'owner') return 'Owner';
    if (normalized === 'admin') return 'Admin';
    if (normalized === 'moderator') return 'Moderator';
    return 'Member';
}

export function formatGroupSanctionSummary(sanction, formatLastSeenText) {
    if (!sanction) return '';
    const actionType = String(sanction.action_type || '').trim().toLowerCase();
    const expiresAt = String(sanction.expires_at || '').trim();
    if (actionType === 'mute_temp') {
        return expiresAt ? `Muted until ${formatLastSeenText(expiresAt)}` : 'Muted';
    }
    if (actionType === 'ban_temp') {
        return expiresAt ? `Banned until ${formatLastSeenText(expiresAt)}` : 'Banned';
    }
    if (actionType === 'ban_perma') return 'Banned permanently';
    return actionType || 'Restricted';
}

export function buildGroupEditMembersHtml({
    profile,
    currentUserId,
    resolveMemberDisplayName,
    buildMemberInitials,
    escapeHtml,
} = {}) {
    const members = Array.isArray(profile?.members) ? profile.members : [];
    if (!members.length) {
        return '<div class="profile-group-members-empty">\u0423\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u044B.</div>';
    }
    const myUserId = Number(currentUserId || 0);
    const myRole = normalizeGroupRole(profile?.my_role);
    const permissions = profile?.permissions || {};
    const canManageRoles = Boolean(permissions?.can_manage_roles || profile?.can_manage_admins);
    const canKick = Boolean(permissions?.can_kick);
    const canBan = Boolean(permissions?.can_ban);

    return members.map((member) => {
        const userId = Number(member?.user_id || 0);
        const displayName = resolveMemberDisplayName(member);
        const role = normalizeGroupRole(member?.role);
        const roleLabel = groupRoleLabel(role);
        const avatarUrl = String(member?.avatar_url || '').trim();
        const avatarHtml = avatarUrl
            ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">`
            : escapeHtml(buildMemberInitials(displayName, member?.username || ''));
        const canMutateMember = userId > 0 && userId !== myUserId;

        let roleActionHtml = '';
        if (canManageRoles && canMutateMember) {
            if (role === 'member') {
                roleActionHtml = `
                    <button type="button" class="group-edit-member-role-btn" data-group-role-target="${userId}" data-group-role-next="moderator">
                        Set moderator
                    </button>
                `;
            } else if (role === 'moderator') {
                roleActionHtml = `
                    <button type="button" class="group-edit-member-role-btn" data-group-role-target="${userId}" data-group-role-next="member">
                        Set member
                    </button>
                `;
            } else if (role === 'admin' && myRole === 'owner') {
                roleActionHtml = `
                    <button type="button" class="group-edit-member-role-btn" data-group-role-target="${userId}" data-group-role-next="moderator">
                        Revoke admin
                    </button>
                `;
            }
            if (myRole === 'owner' && role !== 'owner') {
                roleActionHtml += `
                    <button type="button" class="group-edit-member-role-btn" data-group-role-target="${userId}" data-group-role-next="owner">
                        Transfer owner
                    </button>
                `;
            } else if (myRole === 'owner' && ['member', 'moderator'].includes(role)) {
                roleActionHtml += `
                    <button type="button" class="group-edit-member-role-btn" data-group-role-target="${userId}" data-group-role-next="admin">
                        Set admin
                    </button>
                `;
            }
        }

        const moderationActions = [];
        if (canKick && canMutateMember) {
            moderationActions.push(
                `<button type="button" class="group-edit-member-role-btn" data-group-remove-target="${userId}">Remove</button>`,
            );
        }
        if (canBan && canMutateMember) {
            moderationActions.push(
                `<button type="button" class="group-edit-member-role-btn" data-group-sanction-target="${userId}" data-group-sanction-action="mute_temp" data-group-sanction-duration="3600">Mute 1h</button>`,
            );
            moderationActions.push(
                `<button type="button" class="group-edit-member-role-btn" data-group-sanction-target="${userId}" data-group-sanction-action="ban_temp" data-group-sanction-duration="86400">Ban 24h</button>`,
            );
        }
        return `
            <div class="group-edit-member-row">
                <div class="group-edit-member-avatar">${avatarHtml}</div>
                <div class="group-edit-member-copy">
                    <div class="group-edit-member-name">${escapeHtml(displayName)}</div>
                    <div class="group-edit-member-meta">${escapeHtml(roleLabel)}</div>
                </div>
                <div class="group-edit-member-actions">
                    ${roleActionHtml}
                    ${moderationActions.join('')}
                </div>
            </div>
        `;
    }).join('');
}

export function buildGroupMembersHtml({
    profile,
    currentUserId,
    resolveMemberDisplayName,
    buildMemberInitials,
    escapeHtml,
    formatGroupPresence,
    formatLastSeenText,
} = {}) {
    const members = Array.isArray(profile?.members) ? profile.members : [];
    if (!members.length) {
        return '<div class="profile-group-members-empty">\u0423\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0438 \u043F\u043E\u043A\u0430 \u043D\u0435 \u0434\u043E\u0431\u0430\u0432\u043B\u0435\u043D\u044B.</div>';
    }
    const myUserId = Number(currentUserId || 0);
    const pendingAppealId = Number(profile?.my_pending_group_appeal?.appeal_id || 0);

    return members.map((member) => {
        const memberUserId = Number(member?.user_id || 0);
        const displayName = resolveMemberDisplayName(member);
        const username = String(member.username || '').trim();
        const role = normalizeGroupRole(member?.role);
        const roleLabel = groupRoleLabel(role);
        const avatarUrl = String(member.avatar_url || '').trim();
        const avatarHtml = avatarUrl
            ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">`
            : escapeHtml(buildMemberInitials(displayName, username));
        const activeSanction = member?.active_sanction || null;
        const sanctionLabel = formatGroupSanctionSummary(activeSanction, formatLastSeenText);
        const subtitle = sanctionLabel || formatGroupPresence(member);
        const canAppealOwnSanction = Boolean(
            activeSanction
            && memberUserId > 0
            && memberUserId === myUserId
            && Number(activeSanction.sanction_id || 0) > 0
            && pendingAppealId <= 0,
        );
        const appealActionHtml = canAppealOwnSanction
            ? `<button type="button" class="group-edit-member-role-btn" data-group-appeal-sanction-id="${Number(activeSanction.sanction_id)}">Appeal</button>`
            : '';
        const pendingAppealHtml = (
            activeSanction
            && memberUserId === myUserId
            && pendingAppealId > 0
        ) ? '<div class="profile-group-member-meta">Appeal is pending review.</div>' : '';
        return `
            <div class="profile-group-member">
                <div class="profile-group-member-avatar">${avatarHtml}</div>
                <div class="profile-group-member-copy">
                    <div class="profile-group-member-name">${escapeHtml(displayName)}</div>
                    <div class="profile-group-member-meta">${escapeHtml(subtitle)}</div>
                    ${pendingAppealHtml}
                </div>
                <div class="profile-group-member-role-wrap">
                    <div class="profile-group-member-role">${escapeHtml(roleLabel)}</div>
                    ${appealActionHtml}
                </div>
            </div>
        `;
    }).join('');
}

export function createGroupModerationApi({
    withAppRoot,
    getCsrfToken,
    showToast,
    loadContacts,
    refreshCurrentGroupProfileIfVisible,
    getCurrentGroupProfile,
    getCurrentChatId,
} = {}) {
    async function postJson(path, payload) {
        const response = await fetch(withAppRoot(path), {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken(),
            },
            body: JSON.stringify(payload),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.success) {
            throw new Error(data?.error || 'Request failed.');
        }
        return data;
    }

    function resolveGroupChatId() {
        const profile = getCurrentGroupProfile?.();
        return String(profile?.chat_id || getCurrentChatId?.() || '').trim();
    }

    async function updateGroupMemberRole(targetUserId, role) {
        const chatId = resolveGroupChatId();
        if (!chatId) return;
        await postJson('/api/chats/group/set_role', {
            chat_id: chatId,
            target_user_id: targetUserId,
            role,
        });
        showToast?.('Role updated.', 'success');
        await loadContacts?.({ immediate: true, attemptInitialChatRestore: false });
        refreshCurrentGroupProfileIfVisible?.();
    }

    async function removeGroupMember(targetUserId) {
        const chatId = resolveGroupChatId();
        if (!chatId) return;
        await postJson('/api/chats/group/remove_member', {
            chat_id: chatId,
            target_user_id: targetUserId,
        });
        showToast?.('Member removed.', 'success');
        await loadContacts?.({ immediate: true, attemptInitialChatRestore: false });
        refreshCurrentGroupProfileIfVisible?.();
    }

    async function applyGroupMemberSanction(targetUserId, actionType, durationSeconds = 0) {
        const chatId = resolveGroupChatId();
        if (!chatId) return;
        await postJson('/api/chats/group/sanctions', {
            chat_id: chatId,
            target_user_id: targetUserId,
            action_type: actionType,
            duration_seconds: Number(durationSeconds) || 0,
            reason_code: 'group_moderation',
        });
        showToast?.('Sanction applied.', 'success');
        await loadContacts?.({ immediate: true, attemptInitialChatRestore: false });
        refreshCurrentGroupProfileIfVisible?.();
    }

    async function submitGroupSanctionAppeal(sanctionId) {
        const parsedSanctionId = Number.parseInt(String(sanctionId || '').trim(), 10);
        if (!Number.isFinite(parsedSanctionId) || parsedSanctionId <= 0) return;
        await postJson('/api/moderation/appeals', {
            sanction_id: parsedSanctionId,
            text: 'Please review this group sanction.',
        });
        showToast?.('Appeal submitted.', 'success');
        refreshCurrentGroupProfileIfVisible?.();
    }

    return {
        updateGroupMemberRole,
        removeGroupMember,
        applyGroupMemberSanction,
        submitGroupSanctionAppeal,
    };
}
