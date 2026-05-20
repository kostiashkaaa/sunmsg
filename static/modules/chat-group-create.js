import { escapeHtml, tr } from './utils.js';

const GROUP_MEMBER_LIMIT = 200000;

function readInt(value) {
    const parsed = Number.parseInt(String(value || '').trim(), 10);
    return Number.isFinite(parsed) ? parsed : 0;
}

function readBooleanFlag(value, fallback = true) {
    if (value === true || value === false) return value;
    if (typeof value === 'number') return value > 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on') return true;
        if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off') return false;
    }
    return Boolean(fallback);
}

function buildFallbackUserName(userId) {
    return `${tr('Пользователь')} ${userId}`;
}


function normalizeCandidate(user) {
    if (!user || typeof user !== 'object') return null;
    const parsedId = readInt(user.userId ?? user.user_id);
    if (parsedId <= 0) return null;
    const displayName = String(user.display_name || user.username || buildFallbackUserName(parsedId)).trim();
    const username = String(user.username || '').trim().replace(/^@+/, '');
    const avatarUrl = String(user.avatar_url || '').trim();
    const canGroupAddDirect = readBooleanFlag(user.can_group_add_direct, true);
    return {
        user_id: parsedId,
        display_name: displayName || buildFallbackUserName(parsedId),
        username,
        avatar_url: avatarUrl,
        can_group_add_direct: canGroupAddDirect,
    };
}

export function createChatGroupCreateController(deps = {}) {
    const {
        groupCreateModal,
        groupTitleInput,
        groupMemberSearchInput,
        groupCreateSelected,
        groupCreateSearchResults,
        groupCreateSubmitBtn,
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

    const groupCreateMembersStep = groupCreateModal?.querySelector('#groupCreateMembersStep') || null;
    const groupCreateTitleStep = groupCreateModal?.querySelector('#groupCreateTitleStep') || null;
    const groupCreateBackBtn = groupCreateModal?.querySelector('#groupCreateBackBtn') || null;
    const groupCreateTitleText = groupCreateModal?.querySelector('#groupCreateTitleText') || null;
    const groupCreateCountBadge = groupCreateModal?.querySelector('#groupCreateCountBadge') || null;

    const groupCreateMembers = new Map();
    let groupCreateSearchRequestSeq = 0;
    let groupCreateSubmitting = false;
    let groupCreateStep = 'members';
    let groupCreateLocalCandidates = [];

    function collectLocalCandidates() {
        const sidebarItems = Array.from(document.querySelectorAll('.contact-item[data-contact-id]'));
        const uniqueCandidates = new Map();

        for (const item of sidebarItems) {
            if (!item || item.dataset.isGroup === '1' || item.dataset.savedMessages === '1') continue;
            const userId = readInt(item.dataset.contactId);
            if (userId <= 0 || uniqueCandidates.has(userId)) continue;
            const displayName = String(item.querySelector('.contact-name')?.textContent || '').trim();
            const username = String(item.dataset.contactUsername || '').trim().replace(/^@+/, '');
            const avatarUrl = String(item.querySelector('.contact-avatar img')?.getAttribute('src') || '').trim();
            const canGroupAddDirect = readBooleanFlag(item.dataset.canGroupAddDirect, true);

            uniqueCandidates.set(userId, {
                user_id: userId,
                display_name: displayName || buildFallbackUserName(userId),
                username,
                avatar_url: avatarUrl,
                can_group_add_direct: canGroupAddDirect,
            });
        }

        return Array.from(uniqueCandidates.values()).sort((left, right) => {
            return String(left.display_name || '').localeCompare(String(right.display_name || ''), 'ru', { sensitivity: 'base' });
        });
    }

    function filterLocalCandidates(query) {
        const normalized = String(query || '').trim().toLowerCase();
        if (!normalized) return groupCreateLocalCandidates.slice(0, 80);
        return groupCreateLocalCandidates.filter((entry) => {
            const displayName = String(entry.display_name || '').toLowerCase();
            const username = String(entry.username || '').toLowerCase();
            return displayName.includes(normalized) || username.includes(normalized);
        });
    }

    function buildResultAvatarHtml(user) {
        const avatarUrl = String(user?.avatar_url || '').trim();
        const displayName = String(user?.display_name || user?.username || '?').trim();
        if (avatarUrl) {
            return `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(displayName)}">`;
        }
        const initials = displayName
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0] || '')
            .join('')
            .toUpperCase() || '?';
        return escapeHtml(initials);
    }

    function setGroupCreateStep(nextStep) {
        groupCreateStep = nextStep === 'title' ? 'title' : 'members';
        const showMembersStep = groupCreateStep === 'members';
        if (groupCreateMembersStep) {
            groupCreateMembersStep.hidden = !showMembersStep;
            groupCreateMembersStep.classList.toggle('is-active', showMembersStep);
        }
        if (groupCreateTitleStep) {
            groupCreateTitleStep.hidden = showMembersStep;
            groupCreateTitleStep.classList.toggle('is-active', !showMembersStep);
        }
        if (groupCreateTitleText) {
            groupCreateTitleText.textContent = showMembersStep ? tr('Добавить участников') : tr('Название группы');
        }
        if (groupCreateBackBtn) {
            groupCreateBackBtn.textContent = showMembersStep ? tr('Отмена') : tr('Назад');
        }
        if (showMembersStep) {
            groupMemberSearchInput?.focus({ preventScroll: true });
        } else {
            groupTitleInput?.focus({ preventScroll: true });
        }
        updateGroupCreateSubmitState();
    }

    function updateGroupCreateCountBadge() {
        if (!groupCreateCountBadge) return;
        const count = groupCreateMembers.size;
        groupCreateCountBadge.hidden = count === 0;
        groupCreateCountBadge.textContent = `${count} / ${GROUP_MEMBER_LIMIT}`;
    }

    function updateGroupCreateSubmitState() {
        if (!groupCreateSubmitBtn) return;
        const titleLength = String(groupTitleInput?.value || '').trim().length;
        const canProceed = groupCreateMembers.size > 0;
        const canCreate = canProceed && titleLength >= 2 && titleLength <= 120;
        const canSubmit = !groupCreateSubmitting && (groupCreateStep === 'members' ? canProceed : canCreate);

        groupCreateSubmitBtn.disabled = !canSubmit;
        if (groupCreateStep === 'members') {
            groupCreateSubmitBtn.textContent = tr('Далее');
            return;
        }
        groupCreateSubmitBtn.textContent = groupCreateSubmitting ? tr('Создание...') : tr('Создать');
    }

    function renderGroupCreateSelectedMembers() {
        if (!groupCreateSelected) return;
        const selected = Array.from(groupCreateMembers.values());
        if (!selected.length) {
            groupCreateSelected.innerHTML = `<span class="group-create-result-username">${escapeHtml(tr('Участники пока не выбраны.'))}</span>`;
            updateGroupCreateCountBadge();
            return;
        }

        const removeLabel = escapeHtml(tr('Удалить участника'));
        groupCreateSelected.innerHTML = selected
            .map((member) => `
                <span class="group-create-member-chip">
                    <span class="group-create-member-chip__avatar">${buildResultAvatarHtml(member)}</span>
                    <span>${escapeHtml(member.display_name)}</span>
                    <button type="button" data-group-remove-member-id="${member.user_id}" aria-label="${removeLabel}">&times;</button>
                </span>
            `)
            .join('');
        updateGroupCreateCountBadge();
    }

    function renderGroupCreateSearchResults(users) {
        if (!groupCreateSearchResults) return;
        const normalize = typeof normalizeSearchUser === 'function' ? normalizeSearchUser : normalizeCandidate;
        const normalizedUsersRaw = Array.isArray(users)
            ? users
                .map((entry) => normalize(entry))
                .filter(Boolean)
                .filter((entry) => !groupCreateMembers.has(entry.user_id))
            : [];
        const normalizedUsers = normalizedUsersRaw.filter((entry) => entry.can_group_add_direct !== false);

        if (!normalizedUsers.length) {
            groupCreateSearchResults.innerHTML = `<p class="text-center">${escapeHtml(tr('Пользователи не найдены.'))}</p>`;
            return;
        }

        const addLabel = escapeHtml(tr('Добавить'));
        groupCreateSearchResults.innerHTML = normalizedUsers
            .map((user) => `
                <button type="button" class="group-create-result-item" data-group-add-member-id="${user.user_id}" data-can-group-add-direct="${user.can_group_add_direct === false ? '0' : '1'}">
                    <span class="group-create-result-avatar">${buildResultAvatarHtml(user)}</span>
                    <span class="group-create-result-copy">
                        <span class="group-create-result-name">${escapeHtml(user.display_name)}</span>
                        <span class="group-create-result-username">@${escapeHtml(user.username || 'user')}</span>
                    </span>
                    <span class="group-create-result-add">${addLabel}</span>
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
        groupCreateLocalCandidates = collectLocalCandidates();
        renderGroupCreateSelectedMembers();
        setGroupCreateStep('members');
        renderGroupCreateSearchResults(groupCreateLocalCandidates);
    }

    function openGroupCreateModal() {
        if (!groupCreateModal) return;
        resetGroupCreateModal();
        openAnimatedDialog(groupCreateModal, { focusTarget: groupMemberSearchInput || groupTitleInput });
    }

    async function searchGroupMembers(query) {
        if (!groupCreateSearchResults) return;
        const normalized = String(query || '').trim();
        const requestSeq = ++groupCreateSearchRequestSeq;
        const localMatches = filterLocalCandidates(normalized);

        if (!normalized) {
            renderGroupCreateSearchResults(localMatches);
            return;
        }

        if (normalized.length < 3) {
            renderGroupCreateSearchResults(localMatches);
            return;
        }

        groupCreateSearchResults.innerHTML = buildSearchResultsLoaderHtml();
        try {
            const response = await fetch(withAppRoot(`/search_users?q=${encodeURIComponent(normalized)}&limit=40`), {
                credentials: 'same-origin',
            });
            const payload = await response.json().catch(() => ({}));
            if (requestSeq !== groupCreateSearchRequestSeq) return;
            const remoteUsers = Array.isArray(payload.results || payload.users) ? (payload.results || payload.users) : [];
            if (!response.ok || !payload.success) {
                renderGroupCreateSearchResults(localMatches);
                return;
            }

            const merged = new Map();
            localMatches.forEach((entry) => merged.set(entry.user_id, entry));
            const normalize = typeof normalizeSearchUser === 'function' ? normalizeSearchUser : normalizeCandidate;
            remoteUsers.map((entry) => normalize(entry)).filter(Boolean).forEach((entry) => {
                if (!merged.has(entry.user_id)) merged.set(entry.user_id, entry);
            });
            renderGroupCreateSearchResults(Array.from(merged.values()));
        } catch (_) {
            if (requestSeq !== groupCreateSearchRequestSeq) return;
            renderGroupCreateSearchResults(localMatches);
        }
    }

    async function submitGroupCreate() {
        if (groupCreateSubmitting) return;
        const memberIds = Array.from(groupCreateMembers.keys());
        if (!memberIds.length) {
            showToast(tr('Добавьте хотя бы одного участника.'), 'warning');
            updateGroupCreateSubmitState();
            return;
        }

        if (groupCreateStep === 'members') {
            setGroupCreateStep('title');
            return;
        }

        const title = String(groupTitleInput?.value || '').trim();
        if (title.length < 2 || title.length > 120) {
            showToast(tr('Название группы должно быть от 2 до 120 символов.'), 'warning');
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
                throw new Error(String(payload.error || tr('Не удалось создать группу.')));
            }

            await closeAnimatedDialog(groupCreateModal);
            showToast(tr('Группа создана.'), 'success');
            const requestedCount = Array.isArray(payload.requested_member_ids) ? payload.requested_member_ids.length : 0;
            if (requestedCount > 0) {
                showToast(
                    requestedCount === 1
                        ? tr('1 пользователь получил запрос на вступление.')
                        : `${requestedCount} ${tr('пользователей получили запрос на вступление.')}`,
                    'info',
                );
            }
            await loadContacts({ immediate: true, attemptInitialChatRestore: false });
            await openChatByIdWhenReady(payload.chat_id);
        } catch (error) {
            showToast(error?.message || tr('Не удалось создать группу.'), 'danger');
        } finally {
            groupCreateSubmitting = false;
            updateGroupCreateSubmitState();
        }
    }

    groupTitleInput?.addEventListener('input', () => {
        updateGroupCreateSubmitState();
    });

    groupMemberSearchInput?.addEventListener('input', () => {
        void searchGroupMembers(groupMemberSearchInput.value);
    });

    groupCreateBackBtn?.addEventListener('click', async () => {
        if (groupCreateStep === 'title') {
            setGroupCreateStep('members');
            return;
        }
        await closeAnimatedDialog(groupCreateModal);
    });

    groupCreateSearchResults?.addEventListener('click', (event) => {
        const addButton = event.target.closest('[data-group-add-member-id]');
        if (!addButton) return;
        if (readBooleanFlag(addButton.getAttribute('data-can-group-add-direct'), true) === false) return;
        const memberId = readInt(addButton.getAttribute('data-group-add-member-id'));
        if (memberId <= 0 || groupCreateMembers.has(memberId)) return;

        const resultName = String(addButton.querySelector('.group-create-result-name')?.textContent || buildFallbackUserName(memberId)).trim();
        const resultUsername = String(addButton.querySelector('.group-create-result-username')?.textContent || '')
            .replace(/^@/, '')
            .trim();
        const resultAvatar = String(addButton.querySelector('.group-create-result-avatar img')?.getAttribute('src') || '').trim();
        groupCreateMembers.set(memberId, {
            user_id: memberId,
            display_name: resultName || buildFallbackUserName(memberId),
            username: resultUsername,
            avatar_url: resultAvatar,
        });
        renderGroupCreateSelectedMembers();
        updateGroupCreateSubmitState();
        addButton.remove();
    });

    groupCreateSelected?.addEventListener('click', (event) => {
        const removeButton = event.target.closest('[data-group-remove-member-id]');
        if (!removeButton) return;
        const memberId = readInt(removeButton.getAttribute('data-group-remove-member-id'));
        if (memberId <= 0) return;
        groupCreateMembers.delete(memberId);
        renderGroupCreateSelectedMembers();
        updateGroupCreateSubmitState();
        void searchGroupMembers(groupMemberSearchInput?.value || '');
    });

    groupCreateSubmitBtn?.addEventListener('click', () => {
        void submitGroupCreate();
    });

    groupMemberSearchInput?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        const firstResult = groupCreateSearchResults?.querySelector('[data-group-add-member-id]');
        if (firstResult) {
            firstResult.click();
            return;
        }
        if (!groupCreateSubmitBtn?.disabled) {
            void submitGroupCreate();
        }
    });

    groupTitleInput?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        if (!groupCreateSubmitBtn?.disabled) {
            void submitGroupCreate();
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
