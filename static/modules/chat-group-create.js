// Group create flow: модалка создания новой группы — выбор участников через
// поиск, валидация title, submit на /api/chats/group/create + переход в чат.

import { escapeHtml } from './utils.js';

export function createChatGroupCreateController(deps = {}) {
    const {
        // DOM
        groupCreateModal,
        groupTitleInput,
        groupMemberSearchInput,
        groupCreateSelected,
        groupCreateSearchResults,
        groupCreateSubmitBtn,
        // helpers
        withAppRoot,
        getCsrfToken,
        openAnimatedDialog,
        closeAnimatedDialog,
        showToast,
        normalizeSearchUser,
        buildSearchResultsLoaderHtml,
        loadContacts,
        openChatByIdWhenReady,
    } = deps;

    const groupCreateMembers = new Map();
    let groupCreateSearchRequestSeq = 0;
    let groupCreateSubmitting = false;

    function updateGroupCreateSubmitState() {
        if (!groupCreateSubmitBtn) return;
        const titleLength = String(groupTitleInput?.value || '').trim().length;
        const canSubmit = !groupCreateSubmitting && titleLength >= 2 && titleLength <= 120 && groupCreateMembers.size > 0;
        groupCreateSubmitBtn.disabled = !canSubmit;
        groupCreateSubmitBtn.textContent = groupCreateSubmitting ? 'Создание...' : 'Создать';
    }

    function renderGroupCreateSelectedMembers() {
        if (!groupCreateSelected) return;
        const selected = Array.from(groupCreateMembers.values());
        if (!selected.length) {
            groupCreateSelected.innerHTML = '<span class="group-create-result-username">Участники пока не выбраны.</span>';
            return;
        }

        groupCreateSelected.innerHTML = selected
            .map((member) => `
                <span class="group-create-member-chip">
                    <span>${escapeHtml(member.display_name)}</span>
                    <button type="button" data-group-remove-member-id="${member.user_id}" aria-label="Удалить участника">&times;</button>
                </span>
            `)
            .join('');
    }

    function renderGroupCreateSearchResults(users) {
        if (!groupCreateSearchResults) return;
        const normalizedUsers = Array.isArray(users)
            ? users.map(normalizeSearchUser).filter(Boolean).filter((entry) => !groupCreateMembers.has(entry.user_id))
            : [];

        if (!normalizedUsers.length) {
            groupCreateSearchResults.innerHTML = '<p class="text-center">Пользователи не найдены.</p>';
            return;
        }

        groupCreateSearchResults.innerHTML = normalizedUsers
            .map((user) => `
                <button type="button" class="group-create-result-item" data-group-add-member-id="${user.user_id}">
                    <span>
                        <span class="group-create-result-name">${escapeHtml(user.display_name)}</span><br>
                        <span class="group-create-result-username">@${escapeHtml(user.username || 'неизвестно')}</span>
                    </span>
                    <span class="group-create-result-username">Добавить</span>
                </button>
            `)
            .join('');
    }

    function resetGroupCreateModal() {
        groupCreateMembers.clear();
        groupCreateSearchRequestSeq += 1;
        groupCreateSubmitting = false;
        if (groupTitleInput) groupTitleInput.value = '';
        if (groupMemberSearchInput) groupMemberSearchInput.value = '';
        if (groupCreateSearchResults) groupCreateSearchResults.innerHTML = '';
        renderGroupCreateSelectedMembers();
        updateGroupCreateSubmitState();
    }

    function openGroupCreateModal() {
        if (!groupCreateModal) return;
        resetGroupCreateModal();
        openAnimatedDialog(groupCreateModal, { focusTarget: groupTitleInput || groupMemberSearchInput });
    }

    async function searchGroupMembers(query) {
        if (!groupCreateSearchResults) return;
        const normalized = String(query || '').trim();
        const requestSeq = ++groupCreateSearchRequestSeq;

        if (!normalized) {
            groupCreateSearchResults.innerHTML = '';
            return;
        }
        if (normalized.length < 3) {
            groupCreateSearchResults.innerHTML = '<p class="text-center">Введите минимум 3 символа.</p>';
            return;
        }

        groupCreateSearchResults.innerHTML = buildSearchResultsLoaderHtml();
        try {
            const response = await fetch(withAppRoot(`/search_users?q=${encodeURIComponent(normalized)}&limit=20`), {
                credentials: 'same-origin',
            });
            const payload = await response.json().catch(() => ({}));
            if (requestSeq !== groupCreateSearchRequestSeq) return;
            const users = payload.results || payload.users || [];
            if (!response.ok || !payload.success) {
                groupCreateSearchResults.innerHTML = `<p class="text-center">${escapeHtml(payload.error || 'Поиск не удался.')}</p>`;
                return;
            }
            renderGroupCreateSearchResults(users);
        } catch (_) {
            if (requestSeq !== groupCreateSearchRequestSeq) return;
            groupCreateSearchResults.innerHTML = '<p class="text-center">Поиск не удался. Попробуйте снова.</p>';
        }
    }

    async function submitGroupCreate() {
        if (groupCreateSubmitting) return;
        const title = String(groupTitleInput?.value || '').trim();
        const memberIds = Array.from(groupCreateMembers.keys());
        if (title.length < 2 || title.length > 120) {
            showToast('Название группы должно быть от 2 до 120 символов.', 'warning');
            updateGroupCreateSubmitState();
            return;
        }
        if (!memberIds.length) {
            showToast('Добавьте хотя бы одного участника.', 'warning');
            updateGroupCreateSubmitState();
            return;
        }

        groupCreateSubmitting = true;
        updateGroupCreateSubmitState();
        try {
            const response = await fetch(withAppRoot('/api/chats/group/create'), {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({
                    title,
                    member_user_ids: memberIds,
                }),
            });
            const payload = await response.json().catch(() => ({}));
            if (!response.ok || !payload.success) {
                throw new Error(String(payload.error || 'Не удалось создать группу.'));
            }

            closeAnimatedDialog(groupCreateModal);
            showToast('Группа создана.', 'success');
            await loadContacts({ immediate: true, attemptInitialChatRestore: false });
            await openChatByIdWhenReady(payload.chat_id);
        } catch (error) {
            showToast(error?.message || 'Не удалось создать группу.', 'danger');
        } finally {
            groupCreateSubmitting = false;
            updateGroupCreateSubmitState();
        }
    }

    // Wiring
    groupTitleInput?.addEventListener('input', () => {
        updateGroupCreateSubmitState();
    });

    groupMemberSearchInput?.addEventListener('input', () => {
        void searchGroupMembers(groupMemberSearchInput.value);
    });

    groupCreateSearchResults?.addEventListener('click', (event) => {
        const addButton = event.target.closest('[data-group-add-member-id]');
        if (!addButton) return;
        const memberId = Number.parseInt(addButton.getAttribute('data-group-add-member-id') || '', 10);
        if (!Number.isFinite(memberId) || memberId <= 0 || groupCreateMembers.has(memberId)) return;

        const resultName = String(addButton.querySelector('.group-create-result-name')?.textContent || `Пользователь ${memberId}`).trim();
        const resultUsername = String(
            addButton.querySelector('.group-create-result-username')?.textContent || '',
        ).replace(/^@/, '').trim();
        groupCreateMembers.set(memberId, {
            user_id: memberId,
            display_name: resultName || `Пользователь ${memberId}`,
            username: resultUsername,
            avatar_url: '',
        });
        renderGroupCreateSelectedMembers();
        updateGroupCreateSubmitState();
        addButton.remove();
    });

    groupCreateSelected?.addEventListener('click', (event) => {
        const removeButton = event.target.closest('[data-group-remove-member-id]');
        if (!removeButton) return;
        const memberId = Number.parseInt(removeButton.getAttribute('data-group-remove-member-id') || '', 10);
        if (!Number.isFinite(memberId) || memberId <= 0) return;
        groupCreateMembers.delete(memberId);
        renderGroupCreateSelectedMembers();
        updateGroupCreateSubmitState();
        void searchGroupMembers(groupMemberSearchInput?.value || '');
    });

    groupCreateSubmitBtn?.addEventListener('click', () => {
        void submitGroupCreate();
    });

    groupMemberSearchInput?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            const firstResult = groupCreateSearchResults?.querySelector('[data-group-add-member-id]');
            if (firstResult) {
                firstResult.click();
                return;
            }
            if (!groupCreateSubmitBtn?.disabled) {
                void submitGroupCreate();
            }
        }
    });

    groupCreateModal?.addEventListener('close', () => {
        resetGroupCreateModal();
    });

    return {
        openGroupCreateModal,
        resetGroupCreateModal,
    };
}
