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
    if (normalized === 'owner') return 'Владелец';
    if (normalized === 'admin') return 'Администратор';
    if (normalized === 'moderator') return 'Модератор';
    return 'Участник';
}

export function formatGroupSanctionSummary(sanction, { formatLastSeenText } = {}) {
    if (!sanction) return '';
    const actionType = String(sanction.action_type || '').trim().toLowerCase();
    const expiresAt = String(sanction.expires_at || '').trim();
    if (actionType === 'mute_temp') {
        return expiresAt && typeof formatLastSeenText === 'function'
            ? `Мут до ${formatLastSeenText(expiresAt)}`
            : 'Мут';
    }
    if (actionType === 'ban_temp') {
        return expiresAt && typeof formatLastSeenText === 'function'
            ? `Бан до ${formatLastSeenText(expiresAt)}`
            : 'Бан';
    }
    if (actionType === 'ban_perma') return 'Бан навсегда';
    return actionType || 'Ограничение';
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
                throw new Error(payload?.error || 'Не удалось удалить участника.');
            }
            showToast('Участник удалён.', 'success');
            await loadContacts({ immediate: true, attemptInitialChatRestore: false });
            refreshCurrentGroupProfileIfVisible?.();
        } catch (error) {
            showToast(error?.message || 'Не удалось удалить участника.', 'danger');
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
                throw new Error(payload?.error || 'Не удалось применить санкцию.');
            }
            showToast('Санкция применена.', 'success');
            await loadContacts({ immediate: true, attemptInitialChatRestore: false });
            refreshCurrentGroupProfileIfVisible?.();
        } catch (error) {
            showToast(error?.message || 'Не удалось применить санкцию.', 'danger');
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
                    text: 'Прошу пересмотреть санкцию в группе.',
                }),
            });
            const payload = await parseJsonSafe(response);
            if (!response.ok || !payload?.success) {
                throw new Error(payload?.error || 'Не удалось отправить апелляцию.');
            }
            showToast('Апелляция отправлена.', 'success');
            refreshCurrentGroupProfileIfVisible?.();
        } catch (error) {
            showToast(error?.message || 'Не удалось отправить апелляцию.', 'danger');
        }
    }

    return {
        updateGroupMemberRole,
        removeGroupMember,
        applyGroupMemberSanction,
        submitGroupSanctionAppeal,
    };
}

const GROUP_ROLE_CONFIRM_LABELS = {
    owner: '\u0432\u043B\u0430\u0434\u0435\u043B\u0435\u0446',
    admin: '\u0430\u0434\u043C\u0438\u043D\u0438\u0441\u0442\u0440\u0430\u0442\u043E\u0440',
    moderator: '\u043C\u043E\u0434\u0435\u0440\u0430\u0442\u043E\u0440',
    member: '\u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A',
};

const GROUP_SANCTION_CONFIRM_LABELS = {
    mute_temp: '\u043C\u0443\u0442',
    ban_temp: '\u0431\u0430\u043D',
    ban_perma: '\u0431\u0430\u043D',
};

function resolveMemberNameFromAction(button) {
    return String(
        button?.closest?.('.group-edit-member-row')?.querySelector?.('.group-edit-member-name')?.textContent
        || ''
    ).replace(/\s+/g, ' ').trim();
}

function formatMemberSuffix(name) {
    return name ? `: ${name}` : '';
}

function requestGroupActionConfirm(confirmDialog, options) {
    if (typeof confirmDialog === 'function') {
        return confirmDialog(options);
    }
    const fallbackConfirm = globalThis?.window?.confirm || globalThis?.confirm;
    if (typeof fallbackConfirm !== 'function') return Promise.resolve(false);
    return Promise.resolve(Boolean(fallbackConfirm(options?.message || options?.title || '')));
}

async function runMemberButtonAction(button, action) {
    if (!button || button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
        await action();
    } finally {
        if (button.isConnected) {
            button.disabled = false;
            button.setAttribute('aria-busy', 'false');
        }
    }
}

export function bindGroupModerationUiHandlers({
    groupEditMembersList,
    profileGroupMembers,
    updateGroupMemberRole,
    removeGroupMember,
    applyGroupMemberSanction,
    submitGroupSanctionAppeal,
    onGroupMemberClick,
    confirmDialog,
} = {}) {
    groupEditMembersList?.addEventListener('click', (event) => {
        const roleBtn = event.target.closest('[data-group-role-target][data-group-role-next]');
        if (roleBtn) {
            const targetUserId = Number.parseInt(roleBtn.getAttribute('data-group-role-target') || '', 10);
            const nextRole = normalizeRoleValue(roleBtn.getAttribute('data-group-role-next') || '');
            if (!Number.isFinite(targetUserId) || targetUserId <= 0) return;
            if (!GROUP_ROLES.includes(nextRole)) return;
            const memberName = resolveMemberNameFromAction(roleBtn);
            void requestGroupActionConfirm(confirmDialog, {
                title: '\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C \u0440\u043E\u043B\u044C \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0430?',
                message: `\u0420\u043E\u043B\u044C ${GROUP_ROLE_CONFIRM_LABELS[nextRole] || nextRole} \u0431\u0443\u0434\u0435\u0442 \u043D\u0430\u0437\u043D\u0430\u0447\u0435\u043D\u0430 \u0441\u0440\u0430\u0437\u0443${formatMemberSuffix(memberName)}.`,
                confirmText: '\u0418\u0437\u043C\u0435\u043D\u0438\u0442\u044C',
                variant: nextRole === 'owner' ? 'danger' : 'warning',
                icon: nextRole === 'owner' ? 'warning' : 'info',
            }).then((confirmed) => {
                if (!confirmed) return;
                void runMemberButtonAction(roleBtn, () => updateGroupMemberRole(targetUserId, nextRole));
            });
            return;
        }

        const removeBtn = event.target.closest('[data-group-remove-target]');
        if (removeBtn) {
            const targetUserId = Number.parseInt(removeBtn.getAttribute('data-group-remove-target') || '', 10);
            if (!Number.isFinite(targetUserId) || targetUserId <= 0) return;
            const memberName = resolveMemberNameFromAction(removeBtn);
            void requestGroupActionConfirm(confirmDialog, {
                title: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C \u0443\u0447\u0430\u0441\u0442\u043D\u0438\u043A\u0430?',
                message: `\u0423\u0447\u0430\u0441\u0442\u043D\u0438\u043A \u0431\u0443\u0434\u0435\u0442 \u0443\u0434\u0430\u043B\u0451\u043D \u0438\u0437 \u0433\u0440\u0443\u043F\u043F\u044B${formatMemberSuffix(memberName)}.`,
                confirmText: '\u0423\u0434\u0430\u043B\u0438\u0442\u044C',
                variant: 'danger',
                icon: 'trash',
            }).then((confirmed) => {
                if (!confirmed) return;
                void runMemberButtonAction(removeBtn, () => removeGroupMember(targetUserId));
            });
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
        const memberName = resolveMemberNameFromAction(sanctionBtn);
        const label = GROUP_SANCTION_CONFIRM_LABELS[actionType] || actionType;
        void requestGroupActionConfirm(confirmDialog, {
            title: '\u041F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C \u043E\u0433\u0440\u0430\u043D\u0438\u0447\u0435\u043D\u0438\u0435?',
            message: `\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u0435 "${label}" \u0432\u0441\u0442\u0443\u043F\u0438\u0442 \u0432 \u0441\u0438\u043B\u0443 \u0441\u0440\u0430\u0437\u0443${formatMemberSuffix(memberName)}.`,
            confirmText: '\u041F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C',
            variant: actionType.includes('ban') ? 'danger' : 'warning',
            icon: 'warning',
        }).then((confirmed) => {
            if (!confirmed) return;
            void runMemberButtonAction(sanctionBtn, () => applyGroupMemberSanction(
                targetUserId,
                actionType,
                Number.isFinite(durationSeconds) ? durationSeconds : 0,
            ));
        });
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
