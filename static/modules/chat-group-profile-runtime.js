import {
    getCurrentGroupMediaAvailability,
    resolveGroupTabByAvailability,
    syncGroupTabVisibility,
} from './chat-group-profile-tabs.js';
import {
    normalizeGroupRole,
    groupRoleLabel,
    formatGroupSanctionSummary,
} from './chat-group-moderation.js';

export function createChatGroupProfileRuntime({
    documentRef = document,
    windowRef = window,
    currentUserId,
    getCurrentChatId,
    getChatState,
    getCurrentPartnerData,
    isCurrentChatGroup,
    isProfileDrawerOpen,
    loadAndShowPartnerProfile,
    syncGroupPermissionsPanel,
    escapeHtml,
    applyFallbackAvatarTint,
    formatLastSeenText,
    profileDeleteChatMenuBtn,
    groupEditAvatarPreview,
    groupEditMembersList,
    profileGroupMembers,
    profileGroupTabs,
    profileMediaSection,
    getProfileMediaPanelController,
    partnerProfileDrawer,
    profileMoreMenu,
    profileGroupEditBtn,
    profileGroupSection,
    profileTopbarTitle,
    profileDisplayName,
    profileLargeAvatar,
    profileLastSeen,
    chatTitle,
    getGroupInviteLinkController,
} = {}) {
    let profileGroupActiveTab = 'members';
    let currentGroupProfile = null;

    function getCurrentGroupProfile() {
        return currentGroupProfile;
    }

    function setCurrentGroupPermissions(nextPermissions) {
        if (!currentGroupProfile) return;
        currentGroupProfile.group_permissions = { ...nextPermissions };
    }

    function buildMemberInitials(displayName, username) {
        const source = String(displayName || username || '?').trim();
        return source.split(/\s+/).slice(0, 2).map((chunk) => chunk[0] || '').join('').toUpperCase() || '?';
    }

    function resolveMemberDisplayName(member) {
        return String(member?.display_name || member?.username || `Пользователь ${member?.user_id || ''}`).trim();
    }

    function formatGroupPresence(member) {
        if (member?.online) return 'в сети';
        const lastSeen = String(member?.last_seen || '').trim();
        if (!lastSeen) return 'был(а) недавно';
        return formatLastSeenText(lastSeen);
    }

    function formatGroupMembersCountLabel(rawCount) {
        const count = Math.max(0, Number(rawCount) || 0);
        const language = String(windowRef.SUN_I18N?.getLanguage?.() || '').toLowerCase();
        if (language === 'en') {
            return `${count} ${count === 1 ? 'member' : 'members'}`;
        }
        const mod10 = count % 10;
        const mod100 = count % 100;
        if (mod10 === 1 && mod100 !== 11) return `${count} участник`;
        if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${count} участника`;
        return `${count} участников`;
    }

    function syncGroupDangerActionLabel(profile) {
        const isGroup = Boolean(profile?._group_profile);
        const menuDeleteLabel = profileDeleteChatMenuBtn?.querySelector('span');
        if (menuDeleteLabel) {
            menuDeleteLabel.textContent = isGroup ? 'Покинуть группу' : 'Удалить чат';
        }
    }

    function renderGroupEditAvatar(profile) {
        if (!groupEditAvatarPreview) return;
        const displayName = String(profile?.display_name || '').trim();
        const avatarUrl = String(profile?.avatar_url || '').trim();
        const initials = buildMemberInitials(displayName || 'Группа', '');
        if (avatarUrl) {
            groupEditAvatarPreview.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName || 'Group')}">`;
            return;
        }
        groupEditAvatarPreview.textContent = initials;
    }

    function renderGroupEditMembers(profile) {
        if (!groupEditMembersList) return;
        const members = Array.isArray(profile?.members) ? profile.members : [];
        if (!members.length) {
            groupEditMembersList.innerHTML = '<div class="profile-group-members-empty">Участники пока не добавлены.</div>';
            return;
        }
        const myUserId = Number(currentUserId || 0);
        const myRole = normalizeGroupRole(profile?.my_role);
        const permissions = profile?.permissions || {};
        const canManageRoles = Boolean(permissions?.can_manage_roles || profile?.can_manage_admins);
        const canKick = Boolean(permissions?.can_kick);
        const canBan = Boolean(permissions?.can_ban);
        groupEditMembersList.innerHTML = members.map((member) => {
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
                            Назначить модератором
                        </button>
                    `;
                } else if (role === 'moderator') {
                    roleActionHtml = `
                        <button type="button" class="group-edit-member-role-btn" data-group-role-target="${userId}" data-group-role-next="member">
                            Сделать участником
                        </button>
                    `;
                } else if (role === 'admin' && myRole === 'owner') {
                    roleActionHtml = `
                        <button type="button" class="group-edit-member-role-btn" data-group-role-target="${userId}" data-group-role-next="moderator">
                            Снять администратора
                        </button>
                    `;
                }
                if (myRole === 'owner' && role !== 'owner') {
                    roleActionHtml += `
                        <button type="button" class="group-edit-member-role-btn" data-group-role-target="${userId}" data-group-role-next="owner">
                            Передать владельца
                        </button>
                    `;
                }
                if (myRole === 'owner' && ['member', 'moderator'].includes(role)) {
                    roleActionHtml += `
                        <button type="button" class="group-edit-member-role-btn" data-group-role-target="${userId}" data-group-role-next="admin">
                            Назначить администратором
                        </button>
                    `;
                }
            }

            const moderationActions = [];
            if (canKick && canMutateMember) {
                moderationActions.push(
                    `<button type="button" class="group-edit-member-role-btn" data-group-remove-target="${userId}">Удалить участника</button>`,
                );
            }
            if (canBan && canMutateMember) {
                moderationActions.push(
                    `<button type="button" class="group-edit-member-role-btn" data-group-sanction-target="${userId}" data-group-sanction-action="mute_temp" data-group-sanction-duration="3600">Мут на 1 ч</button>`,
                );
                moderationActions.push(
                    `<button type="button" class="group-edit-member-role-btn" data-group-sanction-target="${userId}" data-group-sanction-action="ban_temp" data-group-sanction-duration="86400">Бан на 24 ч</button>`,
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

    function renderGroupMembers(profile) {
        if (!profileGroupMembers) return;
        const members = Array.isArray(profile?.members) ? profile.members : [];
        if (!members.length) {
            profileGroupMembers.innerHTML = '<div class="profile-group-members-empty">Участники пока не добавлены.</div>';
            return;
        }
        const myUserId = Number(currentUserId || 0);
        const pendingAppealId = Number(profile?.my_pending_group_appeal?.appeal_id || 0);

        profileGroupMembers.innerHTML = members.map((member) => {
            const memberUserId = Number(member?.user_id || 0);
            const displayName = resolveMemberDisplayName(member);
            const username = String(member.username || '').trim();
            const memberRowClickable = memberUserId > 0;
            const role = normalizeGroupRole(member?.role);
            const roleLabel = groupRoleLabel(role);
            const avatarUrl = String(member.avatar_url || '').trim();
            const avatarHtml = avatarUrl
                ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">`
                : escapeHtml(buildMemberInitials(displayName, username));
            const activeSanction = member?.active_sanction || null;
            const sanctionLabel = formatGroupSanctionSummary(activeSanction, { formatLastSeenText });
            const subtitle = sanctionLabel || formatGroupPresence(member);
            const canAppealOwnSanction = Boolean(
                activeSanction
                && memberUserId > 0
                && memberUserId === myUserId
                && Number(activeSanction.sanction_id || 0) > 0
                && pendingAppealId <= 0,
            );
            const appealActionHtml = canAppealOwnSanction
                ? `<button type="button" class="group-edit-member-role-btn" data-group-appeal-sanction-id="${Number(activeSanction.sanction_id)}">Обжаловать</button>`
                : '';
            const pendingAppealHtml = (
                activeSanction
                && memberUserId === myUserId
                && pendingAppealId > 0
            ) ? '<div class="profile-group-member-meta">Appeal is pending review.</div>' : '';
            return `
                <div class="profile-group-member${memberRowClickable ? ' profile-group-member--clickable' : ''}"${memberRowClickable ? ` data-group-member-user-id="${memberUserId}" data-group-member-username="${escapeHtml(username)}" role="button" tabindex="0"` : ''}>
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

    function setGroupProfileTab(tabKey) {
        const normalized = String(tabKey || '').trim().toLowerCase();
        const requestedTab = ['members', 'media', 'files', 'links'].includes(normalized) ? normalized : 'members';
        const mediaAvailability = getCurrentGroupMediaAvailability({
            chatId: getCurrentChatId?.(),
            getChatState,
        });
        syncGroupTabVisibility(profileGroupTabs, mediaAvailability);
        const nextTab = resolveGroupTabByAvailability(requestedTab, mediaAvailability);
        profileGroupActiveTab = nextTab;

        if (profileGroupTabs) {
            profileGroupTabs.querySelectorAll('[data-group-tab]').forEach((btn) => {
                const active = String(btn.getAttribute('data-group-tab') || '') === nextTab;
                btn.classList.toggle('is-active', active);
                btn.setAttribute('aria-selected', active ? 'true' : 'false');
            });
        }

        const showMembers = nextTab === 'members';
        profileGroupMembers?.classList.toggle('profile-group-section--hidden', !showMembers);
        if (profileMediaSection) {
            profileMediaSection.style.display = showMembers ? 'none' : '';
        }

        const profileMediaPanelController = getProfileMediaPanelController?.();
        if (!showMembers && profileMediaPanelController) {
            const mappedTab = nextTab === 'files' ? 'files' : nextTab === 'links' ? 'links' : 'media';
            profileMediaPanelController.renderProfileMediaPanel({ preferredTab: mappedTab });
        }
    }

    function applyGroupProfileUi(profile) {
        const isGroupProfile = Boolean(profile?._group_profile);
        const canEditGroup = Boolean(profile?.can_edit_group);
        const permissions = profile?.permissions || {};
        const canOpenGroupManagePanel = Boolean(
            canEditGroup
            || permissions?.can_manage_roles
            || permissions?.can_kick
            || permissions?.can_ban,
        );
        currentGroupProfile = isGroupProfile ? profile : null;
        syncGroupPermissionsPanel(currentGroupProfile);
        const profileUsernameLine = documentRef.getElementById('profileUsernameLine');
        const profileBioLine = documentRef.getElementById('profileBioLine');
        const profileMetaBio = documentRef.getElementById('profileMetaBio');
        const profileBioLabel = profileBioLine?.querySelector('.profile-info-label') || null;
        const profileRequestLine = documentRef.getElementById('profileRequestLine');
        const profilePrivateLine = documentRef.getElementById('profilePrivateLine');
        const copyUsernameMenuItem = profileMoreMenu?.querySelector('[data-profile-action="copy-username"]');
        const reportUserMenuItem = profileMoreMenu?.querySelector('[data-profile-action="report-user"]');
        const messageMenuItem = profileMoreMenu?.querySelector('[data-profile-action="message"]');

        partnerProfileDrawer?.classList.toggle('is-group-profile', isGroupProfile);
        syncGroupDangerActionLabel(profile);
        profileGroupEditBtn?.classList.toggle('profile-group-edit-btn--hidden', !(isGroupProfile && canOpenGroupManagePanel));
        profileGroupSection?.classList.toggle('profile-group-section--hidden', !isGroupProfile);
        if (profileUsernameLine) profileUsernameLine.style.display = isGroupProfile ? 'none' : '';
        if (isGroupProfile) {
            profileRequestLine?.classList.add('profile-info-line--hidden');
            profilePrivateLine?.classList.add('profile-info-line--hidden');
            if (profileRequestLine) profileRequestLine.style.display = 'none';
            if (profilePrivateLine) profilePrivateLine.style.display = 'none';
        }
        if (profileBioLine) {
            if (!isGroupProfile) {
                profileBioLine.style.display = '';
                if (profileBioLabel) profileBioLabel.textContent = 'О себе';
            } else {
                const description = String(
                    profile?.description
                    || profile?.chat_description
                    || profile?.group_description
                    || '',
                ).trim();
                profileBioLine.classList.toggle('profile-info-line--hidden', !description);
                profileBioLine.style.display = description ? '' : 'none';
                if (profileMetaBio) profileMetaBio.textContent = description;
                if (profileBioLabel) profileBioLabel.textContent = 'Описание';
            }
        }
        if (copyUsernameMenuItem) copyUsernameMenuItem.style.display = isGroupProfile ? 'none' : '';
        if (reportUserMenuItem) reportUserMenuItem.style.display = isGroupProfile ? 'none' : '';
        if (messageMenuItem) messageMenuItem.style.display = isGroupProfile ? 'none' : '';

        if (!isGroupProfile) {
            if (profileTopbarTitle) profileTopbarTitle.textContent = 'Информация';
            if (profileMediaSection) profileMediaSection.style.display = '';
            return;
        }

        if (profileTopbarTitle) profileTopbarTitle.textContent = 'Информация о группе';
        const membersCount = Number(profile?.members_count || 0);
        const partnerData = getCurrentPartnerData?.() || {};
        const groupDisplayName = String(
            profile?.display_name
            || profile?.chat_name
            || partnerData?.display_name
            || chatTitle?.textContent
            || 'Group chat'
        ).trim();
        if (profileDisplayName) {
            profileDisplayName.textContent = groupDisplayName;
        }
        if (profileLargeAvatar) {
            const avatarUrl = String(profile?.avatar_url || '').trim();
            if (avatarUrl) {
                profileLargeAvatar.removeAttribute('data-avatar-tint');
                profileLargeAvatar.innerHTML = `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(groupDisplayName || 'Group')}">`;
            } else {
                profileLargeAvatar.textContent = buildMemberInitials(groupDisplayName, '');
                applyFallbackAvatarTint(profileLargeAvatar, groupDisplayName);
            }
        }
        if (profileLastSeen) {
            profileLastSeen.textContent = formatGroupMembersCountLabel(membersCount);
        }
        if (isCurrentChatGroup?.() && String(getCurrentChatId?.() || '') === String(profile?.chat_id || '')) {
            const headerStatus = documentRef.getElementById('chatOnlineStatus');
            if (headerStatus) {
                headerStatus.textContent = formatGroupMembersCountLabel(membersCount);
                headerStatus.classList.remove('chat-online-status--hidden');
                headerStatus.style.display = 'block';
                headerStatus.setAttribute('data-last-seen', '');
                headerStatus.dataset.state = 'group';
            }
        }

        renderGroupMembers(profile);
        renderGroupEditMembers(profile);
        renderGroupEditAvatar(profile);
        setGroupProfileTab(profileGroupActiveTab);

        const inviteLinkContainer = documentRef.getElementById('groupInviteLinkContainer');
        const inviteLinkCtrl = typeof getGroupInviteLinkController === 'function'
            ? getGroupInviteLinkController()
            : null;
        const chatId = String(profile?.chat_id || '');
        if (inviteLinkContainer && inviteLinkCtrl && chatId) {
            const canManage = Boolean(profile?.can_edit_group);
            inviteLinkCtrl.renderInviteLinkSection(inviteLinkContainer, chatId, { canManage });
        }
    }

    function refreshCurrentGroupProfileIfVisible() {
        if (!getCurrentChatId?.()) return;
        if (!isCurrentChatGroup?.()) return;
        if (!isProfileDrawerOpen?.()) return;
        loadAndShowPartnerProfile?.();
    }

    function updateLocalMemberRole(updatedUserId, nextRole) {
        if (!currentGroupProfile?.members) return;
        currentGroupProfile.members = currentGroupProfile.members.map((member) => {
            if (Number(member?.user_id) !== Number(updatedUserId)) return member;
            return { ...member, role: nextRole };
        });
        renderGroupMembers(currentGroupProfile);
        renderGroupEditMembers(currentGroupProfile);
    }

    function getActiveGroupTab() {
        return profileGroupActiveTab;
    }

    return {
        getCurrentGroupProfile,
        setCurrentGroupPermissions,
        buildMemberInitials,
        resolveMemberDisplayName,
        formatGroupPresence,
        formatGroupMembersCountLabel,
        renderGroupEditAvatar,
        renderGroupEditMembers,
        renderGroupMembers,
        setGroupProfileTab,
        applyGroupProfileUi,
        refreshCurrentGroupProfileIfVisible,
        updateLocalMemberRole,
        getActiveGroupTab,
    };
}
