let attentionBound = false;
let dismissedForCount = 0;

function isEnglish() {
    return String(document.documentElement?.lang || '')
        .toLowerCase()
        .startsWith('en');
}

function getCopy() {
    if (isEnglish()) {
        return {
            dialogTitle: 'New dialog request',
            groupTitle: 'New group invitation',
            open: 'Open request',
            dismiss: 'Hide notification',
            countText: (count) => (
                count === 1
                    ? 'You have 1 incoming request. Open it and press Accept.'
                    : `You have ${count} incoming requests. Open them and press Accept.`
            ),
            dialogText: (name) => `${name} wants to start a dialog. Open the request and press Accept.`,
            groupText: (name, groupName) => (
                groupName
                    ? `${name} invites you to "${groupName}". Open the request and press Accept.`
                    : `${name} sent a group invitation. Open the request and press Accept.`
            ),
        };
    }

    return {
        dialogTitle: 'Новый запрос на диалог',
        groupTitle: 'Новое приглашение в группу',
        open: 'Открыть запрос',
        dismiss: 'Скрыть уведомление',
            countText: (count) => (
                count === 1
                    ? 'У вас 1 входящий запрос. Откройте его и нажмите «Принять».'
                    : `У вас ${count} входящих запросов. Откройте список и нажмите «Принять».`
            ),
        dialogText: (name) => `${name} хочет начать диалог. Откройте запрос и нажмите «Принять».`,
        groupText: (name, groupName) => (
            groupName
                ? `${name} приглашает в группу «${groupName}». Откройте запрос и нажмите «Принять».`
                : `${name} отправил приглашение в группу. Откройте запрос и нажмите «Принять».`
        ),
    };
}

function currentRequestCount() {
    return document.querySelectorAll(
        [
            '#dialogRequestsList .request-item:not([data-request-direction="outgoing"])',
            '#contactsList .contact-item--dialog-request:not([data-request-direction="outgoing"])',
        ].join(', '),
    ).length;
}

function isRequestsTabActive() {
    return String(document.body?.dataset?.sidebarTab || '') === 'all';
}

function resolveSenderName(data) {
    return String(data?.sender_display_name || data?.sender_username || '').trim()
        || (isEnglish() ? 'A contact' : 'Собеседник');
}

function setAttentionVisible(visible) {
    const banner = document.getElementById('dialogRequestAttention');
    if (!banner) return;

    banner.hidden = !visible;
    banner.setAttribute('aria-hidden', visible ? 'false' : 'true');
    banner.classList.toggle('is-visible', visible);
}

function openRequestsView() {
    if (typeof window.focusDialogRequests === 'function') {
        window.focusDialogRequests();
    } else if (typeof window.switchSidebarTab === 'function') {
        window.switchSidebarTab('all');
    } else {
        document.querySelector('.sidebar-tab[data-tab="all"]')?.click();
    }

    setAttentionVisible(false);
    requestAnimationFrame(() => {
        const firstAction = document.querySelector(
            '#contactsList .contact-item--dialog-request .req-btn.accept, #dialogRequestsList .req-btn.accept',
        );
        try {
            firstAction?.focus({ preventScroll: true });
        } catch (_) {
            firstAction?.focus();
        }
    });
}

function bindAttention() {
    if (attentionBound) return;
    attentionBound = true;

    document.getElementById('dialogRequestAttentionOpen')?.addEventListener('click', openRequestsView);
    document.getElementById('dialogRequestAttentionDismiss')?.addEventListener('click', () => {
        dismissedForCount = currentRequestCount();
        setAttentionVisible(false);
    });
    window.addEventListener('sun-sidebar-tab-changed', (event) => {
        if (event?.detail?.tab === 'all') {
            setAttentionVisible(false);
        }
    });
}

function updateAttentionCopy({ title, text, count }) {
    const copy = getCopy();
    const titleEl = document.getElementById('dialogRequestAttentionTitle');
    const textEl = document.getElementById('dialogRequestAttentionText');
    const countEl = document.getElementById('dialogRequestAttentionCount');
    const openBtn = document.getElementById('dialogRequestAttentionOpen');
    const dismissBtn = document.getElementById('dialogRequestAttentionDismiss');

    if (titleEl) titleEl.textContent = title || copy.dialogTitle;
    if (textEl) textEl.textContent = text || copy.countText(count);
    if (countEl) countEl.textContent = count > 0 ? String(count > 99 ? '99+' : count) : '';
    if (openBtn) openBtn.textContent = copy.open;
    if (dismissBtn) dismissBtn.setAttribute('aria-label', copy.dismiss);
}

export function showDialogRequestAttention(data = {}, options = {}) {
    bindAttention();

    const count = Math.max(1, Number(options.count || currentRequestCount()) || 1);
    const requestKind = String(options.requestKind || data?.request_kind || '').trim();
    const copy = getCopy();
    const senderName = resolveSenderName(data);
    const title = requestKind === 'group_invite' ? copy.groupTitle : copy.dialogTitle;
    const text = requestKind === 'group_invite'
        ? copy.groupText(senderName, String(data?.chat_name || '').trim())
        : copy.dialogText(senderName);

    dismissedForCount = 0;
    updateAttentionCopy({ title, text, count });
    setAttentionVisible(!isRequestsTabActive());
}

export function syncDialogRequestAttentionCount(count) {
    bindAttention();

    const safeCount = Math.max(0, Number(count || 0) || 0);
    if (safeCount <= 0) {
        dismissedForCount = 0;
        setAttentionVisible(false);
        return;
    }
    if (safeCount < dismissedForCount) {
        dismissedForCount = safeCount;
    }

    updateAttentionCopy({
        title: getCopy().dialogTitle,
        text: getCopy().countText(safeCount),
        count: safeCount,
    });

    if (!isRequestsTabActive() && safeCount > dismissedForCount) {
        setAttentionVisible(true);
    }
}
