import { waitForMotionEnd } from './motion.js';

const GROUP_SLOW_MODE_PRESETS = [0, 5, 10, 30, 60, 300, 900, 3600];

function toBool(value, fallback = false) {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value > 0;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    }
    return Boolean(fallback);
}

function normalizeSlowMode(value) {
    const parsed = Number.parseInt(String(value ?? '').trim(), 10);
    if (!Number.isFinite(parsed)) return 0;
    return GROUP_SLOW_MODE_PRESETS.includes(parsed) ? parsed : 0;
}

export function normalizeGroupPermissions(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
        members_can_send_messages: toBool(source.members_can_send_messages, true),
        members_can_send_media: toBool(source.members_can_send_media, true),
        members_can_add_members: toBool(source.members_can_add_members, false),
        members_can_pin_messages: toBool(source.members_can_pin_messages, false),
        members_can_change_info: toBool(source.members_can_change_info, false),
        slow_mode_seconds: normalizeSlowMode(source.slow_mode_seconds),
    };
}

function formatSlowModeLabel(seconds) {
    const normalized = normalizeSlowMode(seconds);
    if (normalized <= 0) return 'Сообщения без задержки';
    if (normalized < 60) return `Медленный режим ${normalized} сек`;
    if (normalized < 3600) return `Медленный режим ${Math.round(normalized / 60)} мин`;
    return 'Медленный режим 1 ч';
}

export function buildGroupPermissionsSummary(raw) {
    const perms = normalizeGroupPermissions(raw);
    if (!perms.members_can_send_messages) {
        return 'Участники не могут писать';
    }
    return formatSlowModeLabel(perms.slow_mode_seconds);
}

export function createChatGroupPermissionsController(deps = {}) {
    const {
        groupEditModal,
        groupEditOpenPermissionsBtn,
        groupEditPermissionsSummary,
        groupPermissionsPanel,
        groupPermissionsBackBtn,
        groupPermSendMessagesToggle,
        groupPermSendMediaToggle,
        groupPermAddMembersToggle,
        groupPermPinMessagesToggle,
        groupPermChangeInfoToggle,
        groupPermSlowModeList,
        withAppRoot,
        getCsrfToken,
        showToast,
        getCurrentGroupProfile,
        onPermissionsUpdated,
    } = deps;

    const toggleMap = {
        members_can_send_messages: groupPermSendMessagesToggle,
        members_can_send_media: groupPermSendMediaToggle,
        members_can_add_members: groupPermAddMembersToggle,
        members_can_pin_messages: groupPermPinMessagesToggle,
        members_can_change_info: groupPermChangeInfoToggle,
    };

    let currentPermissions = normalizeGroupPermissions(null);
    let isPanelOpen = false;
    let saveToken = 0;

    function setPermissionsSummary(raw) {
        if (!groupEditPermissionsSummary) return;
        groupEditPermissionsSummary.textContent = buildGroupPermissionsSummary(raw);
    }

    function renderSlowModeSelection() {
        const activeSlowMode = normalizeSlowMode(currentPermissions.slow_mode_seconds);
        const chips = Array.from(groupPermSlowModeList?.querySelectorAll('[data-group-slow-mode]') || []);
        chips.forEach((chip) => {
            const seconds = Number.parseInt(String(chip.getAttribute('data-group-slow-mode') || '').trim(), 10);
            const active = Number.isFinite(seconds) && seconds === activeSlowMode;
            chip.classList.toggle('is-active', active);
            chip.setAttribute('aria-selected', active ? 'true' : 'false');
        });
    }

    function renderPermissions() {
        Object.entries(toggleMap).forEach(([key, input]) => {
            if (!input) return;
            input.checked = Boolean(currentPermissions[key]);
        });
        renderSlowModeSelection();
        setPermissionsSummary(currentPermissions);
    }

    function applyPermissionsToProfile(rawPermissions) {
        const profile = getCurrentGroupProfile?.();
        if (!profile) return;
        profile.group_permissions = normalizeGroupPermissions(rawPermissions);
        setPermissionsSummary(profile.group_permissions);
        onPermissionsUpdated?.(profile.group_permissions);
    }

    function syncFromProfile(profile = null) {
        const nextProfile = profile || getCurrentGroupProfile?.();
        currentPermissions = normalizeGroupPermissions(nextProfile?.group_permissions || null);
        renderPermissions();
    }

    async function persistPermissions(previousPermissions) {
        const profile = getCurrentGroupProfile?.();
        const chatId = String(profile?.chat_id || '').trim();
        if (!chatId) return;
        const requestToken = ++saveToken;

        try {
            const response = await fetch(withAppRoot('/api/chats/group/update_permissions'), {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({
                    chat_id: chatId,
                    group_permissions: currentPermissions,
                }),
            });
            const payload = await response.json().catch(() => ({}));
            if (requestToken !== saveToken) return;
            if (!response.ok || !payload?.success) {
                throw new Error(payload?.error || 'Не удалось обновить разрешения группы.');
            }
            currentPermissions = normalizeGroupPermissions(payload.group_permissions || currentPermissions);
            applyPermissionsToProfile(currentPermissions);
            renderPermissions();
        } catch (error) {
            if (requestToken !== saveToken) return;
            currentPermissions = normalizeGroupPermissions(previousPermissions);
            applyPermissionsToProfile(currentPermissions);
            renderPermissions();
            showToast?.(error?.message || 'Не удалось обновить разрешения группы.', 'danger');
        }
    }

    function patchPermissions(patch) {
        const previousPermissions = { ...currentPermissions };
        currentPermissions = normalizeGroupPermissions({ ...currentPermissions, ...patch });
        renderPermissions();
        void persistPermissions(previousPermissions);
    }

    function openPermissionsPanel() {
        if (!groupPermissionsPanel) return;
        const profile = getCurrentGroupProfile?.();
        const canManage = Boolean(profile?.permissions?.can_change_group_settings || profile?.can_edit_group);
        if (!canManage) {
            showToast?.('У вас нет прав на изменение разрешений группы.', 'warning');
            return;
        }
        syncFromProfile(profile);
        isPanelOpen = true;
        groupPermissionsPanel.hidden = false;
        groupPermissionsPanel.classList.add('is-open');
        groupPermissionsPanel.setAttribute('aria-hidden', 'false');
    }

    async function closePermissionsPanel() {
        if (!groupPermissionsPanel || !isPanelOpen) return;
        isPanelOpen = false;
        groupPermissionsPanel.classList.remove('is-open');
        groupPermissionsPanel.setAttribute('aria-hidden', 'true');
        await waitForMotionEnd(groupPermissionsPanel, 200);
        if (!isPanelOpen) {
            groupPermissionsPanel.hidden = true;
        }
    }

    groupEditOpenPermissionsBtn?.addEventListener('click', () => {
        openPermissionsPanel();
    });

    groupPermissionsBackBtn?.addEventListener('click', () => {
        void closePermissionsPanel();
    });

    const groupEditCloseButtons = Array.from(groupEditModal?.querySelectorAll('[data-group-edit-close]') || []);
    groupEditCloseButtons.forEach((button) => {
        button.addEventListener('click', () => {
            void closePermissionsPanel();
        });
    });

    Object.entries(toggleMap).forEach(([key, input]) => {
        input?.addEventListener('change', () => {
            patchPermissions({ [key]: Boolean(input.checked) });
        });
    });

    groupPermSlowModeList?.addEventListener('click', (event) => {
        const chip = event.target.closest('[data-group-slow-mode]');
        if (!chip) return;
        const seconds = Number.parseInt(String(chip.getAttribute('data-group-slow-mode') || '').trim(), 10);
        if (!Number.isFinite(seconds)) return;
        patchPermissions({ slow_mode_seconds: normalizeSlowMode(seconds) });
    });

    groupEditModal?.addEventListener('keydown', (event) => {
        if (!isPanelOpen) return;
        if (event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        void closePermissionsPanel();
    });

    return {
        syncFromProfile,
        openPermissionsPanel,
        closePermissionsPanel,
        isPermissionsPanelOpen: () => isPanelOpen,
    };
}
