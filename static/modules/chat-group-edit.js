// Group edit flow: модалка редактирования группы (название, описание,
// аватар) + permission-guard. Вынесено из chat.js без изменений в
// поведении.

import { escapeHtml } from './utils.js';

export function createChatGroupEditController(deps = {}) {
    const {
        // DOM
        groupEditModal,
        groupEditTitleInput,
        groupEditDescriptionInput,
        groupEditAvatarInput,
        groupEditSubmitBtn,
        chatTitle,
        profileLargeAvatar,
        profileDisplayName,
        // state getters/setters
        getCurrentGroupProfile,
        getCurrentChatId,
        // helpers
        withAppRoot,
        getCsrfToken,
        openAnimatedDialog,
        closeAnimatedDialog,
        showToast,
        renderGroupEditAvatar,
        renderGroupEditMembers,
        loadContacts,
    } = deps;

    let groupEditSubmitting = false;
    let groupEditAvatarUploading = false;

    function getGroupEditNormalizedTitle() {
        return String(groupEditTitleInput?.value || '').trim();
    }

    function getGroupEditNormalizedDescription() {
        return String(groupEditDescriptionInput?.value || '').trim();
    }

    function hasGroupEditChanges() {
        const profile = getCurrentGroupProfile?.();
        if (!profile) return false;
        const nextTitle = getGroupEditNormalizedTitle();
        const nextDescription = getGroupEditNormalizedDescription();
        const prevTitle = String(profile.display_name || '').trim();
        const prevDescription = String(profile.description || '').trim();
        return nextTitle !== prevTitle || nextDescription !== prevDescription;
    }

    function updateGroupEditSubmitState() {
        if (!groupEditSubmitBtn) return;
        const titleLength = getGroupEditNormalizedTitle().length;
        const descriptionLength = getGroupEditNormalizedDescription().length;
        const canSubmit = !groupEditSubmitting
            && !groupEditAvatarUploading
            && titleLength >= 2
            && titleLength <= 120
            && descriptionLength <= 600
            && hasGroupEditChanges();
        groupEditSubmitBtn.disabled = !canSubmit;
        groupEditSubmitBtn.textContent = groupEditSubmitting ? 'Сохранение...' : 'Сохранить';
    }

    async function uploadGroupAvatar(file) {
        const profile = getCurrentGroupProfile?.();
        if (!file || !profile) return;
        const chatId = String(profile.chat_id || getCurrentChatId?.() || '').trim();
        if (!chatId) return;
        groupEditAvatarUploading = true;
        updateGroupEditSubmitState();
        try {
            const formData = new FormData();
            formData.append('chat_id', chatId);
            formData.append('avatar', file);
            const response = await fetch(withAppRoot('/api/chats/group/upload_avatar'), {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'X-CSRFToken': getCsrfToken(),
                },
                body: formData,
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload?.success) {
                throw new Error(payload?.error || 'Не удалось загрузить фото группы.');
            }
            const nextAvatarUrl = String(payload.chat_avatar_url || '').trim();
            if (profile) profile.avatar_url = nextAvatarUrl;
            if (window.currentPartnerData && window.currentPartnerData._group_profile) {
                window.currentPartnerData.avatar_url = nextAvatarUrl;
            }
            renderGroupEditAvatar?.(profile);
            if (profileLargeAvatar && nextAvatarUrl) {
                profileLargeAvatar.removeAttribute('data-avatar-tint');
                profileLargeAvatar.innerHTML = `<img src="${escapeHtml(nextAvatarUrl)}" alt="${escapeHtml(profile?.display_name || 'Group')}">`;
            }
            await loadContacts?.({ immediate: true, attemptInitialChatRestore: false });
            showToast('Фото группы обновлено.', 'success');
        } catch (error) {
            showToast(error?.message || 'Не удалось загрузить фото группы.', 'danger');
        } finally {
            groupEditAvatarUploading = false;
            if (groupEditAvatarInput) groupEditAvatarInput.value = '';
            updateGroupEditSubmitState();
        }
    }

    function openGroupEditModal() {
        const profile = getCurrentGroupProfile?.();
        if (!groupEditModal || !profile) return;
        const permissions = profile?.permissions || {};
        const canOpenManagePanel = Boolean(
            profile.can_edit_group
            || permissions?.can_manage_roles
            || permissions?.can_kick
            || permissions?.can_ban,
        );
        if (!canOpenManagePanel) {
            showToast('У вас нет прав на управление группой.', 'warning');
            return;
        }
        groupEditSubmitting = false;
        groupEditAvatarUploading = false;
        if (groupEditTitleInput) {
            groupEditTitleInput.value = String(profile.display_name || '').trim();
            groupEditTitleInput.setSelectionRange(0, groupEditTitleInput.value.length);
        }
        if (groupEditDescriptionInput) {
            groupEditDescriptionInput.value = String(profile.description || '').trim();
        }
        renderGroupEditAvatar?.(profile);
        renderGroupEditMembers?.(profile);
        updateGroupEditSubmitState();
        openAnimatedDialog(groupEditModal, { focusTarget: groupEditTitleInput });
    }

    async function submitGroupEdit() {
        const profile = getCurrentGroupProfile?.();
        if (groupEditSubmitting || !profile) return;
        const nextTitle = getGroupEditNormalizedTitle();
        const nextDescription = getGroupEditNormalizedDescription();
        if (nextTitle.length < 2 || nextTitle.length > 120) {
            showToast('Название группы должно быть длиной от 2 до 120 символов.', 'warning');
            updateGroupEditSubmitState();
            return;
        }
        if (nextDescription.length > 600) {
            showToast('Описание слишком длинное.', 'warning');
            updateGroupEditSubmitState();
            return;
        }
        const chatId = String(profile.chat_id || getCurrentChatId?.() || '').trim();
        if (!chatId) return;

        groupEditSubmitting = true;
        updateGroupEditSubmitState();
        try {
            const response = await fetch(withAppRoot('/api/chats/group/update'), {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({ chat_id: chatId, title: nextTitle, description: nextDescription }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.success) {
                throw new Error(String(payload.error || 'Не удалось обновить группу.'));
            }

            closeAnimatedDialog(groupEditModal);
            showToast('Настройки группы обновлены.', 'success');
            if (chatTitle) chatTitle.textContent = nextTitle;
            if (profile) {
                profile.display_name = nextTitle;
                profile.description = nextDescription;
            }
            if (window.currentPartnerData && window.currentPartnerData._group_profile) {
                window.currentPartnerData.display_name = nextTitle;
                window.currentPartnerData.description = nextDescription;
            }
            if (profileDisplayName) profileDisplayName.textContent = nextTitle;
            await loadContacts?.({ immediate: true, attemptInitialChatRestore: false });
        } catch (error) {
            showToast(error?.message || 'Не удалось обновить группу.', 'danger');
        } finally {
            groupEditSubmitting = false;
            updateGroupEditSubmitState();
        }
    }

    // Wiring
    groupEditTitleInput?.addEventListener('input', updateGroupEditSubmitState);
    groupEditDescriptionInput?.addEventListener('input', updateGroupEditSubmitState);

    groupEditAvatarInput?.addEventListener('change', () => {
        const file = groupEditAvatarInput.files?.[0];
        if (!file) return;
        void uploadGroupAvatar(file);
    });

    groupEditSubmitBtn?.addEventListener('click', () => {
        void submitGroupEdit();
    });

    groupEditTitleInput?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        void submitGroupEdit();
    });

    return {
        openGroupEditModal,
        updateGroupEditSubmitState,
    };
}
