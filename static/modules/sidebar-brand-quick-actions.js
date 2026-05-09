const LONG_PRESS_MS = 350;
const DOUBLE_TAP_MS = 250;
const SWIPE_CLOSE_THRESHOLD_PX = 24;

function getUiCopy() {
    const isEnglish = String(document.documentElement.lang || '')
        .toLowerCase()
        .startsWith('en');

    if (isEnglish) {
        return {
            triggerLabel: 'Quick actions',
            newChat: 'New chat',
            requests: 'Requests',
            qr: 'My QR',
            support: 'Support',
            profile: 'Profile',
        };
    }

    return {
        triggerLabel: '\u0411\u044B\u0441\u0442\u0440\u044B\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044F',
        newChat: '\u041D\u043E\u0432\u044B\u0439 \u0447\u0430\u0442',
        requests: '\u0417\u0430\u043F\u0440\u043E\u0441\u044B',
        qr: '\u041C\u043E\u0439 QR',
        support: '\u0421\u0430\u043F\u043F\u043E\u0440\u0442',
        profile: '\u041F\u0440\u043E\u0444\u0438\u043B\u044C',
    };
}

function vibrateFeedback(durationMs = 12) {
    try {
        if (navigator.vibrate) navigator.vibrate(durationMs);
    } catch (_) {
        // Ignore unsupported vibration APIs.
    }
}

function openCommandPalette({ openDialog, prefill = '' } = {}) {
    if (typeof window.openCommandPalette === 'function') {
        window.openCommandPalette(prefill);
        return true;
    }

    const modal = document.getElementById('newChatModal');
    const input = document.getElementById('searchUserInput');
    const results = document.getElementById('searchUserResults');
    if (!modal) return false;

    if (input) {
        input.value = prefill;
        input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    if (results && !prefill) {
        results.innerHTML = '';
    }

    if (typeof openDialog === 'function') {
        openDialog(modal, { focusTarget: input });
    } else if (!modal.open) {
        modal.showModal();
    }

    requestAnimationFrame(() => {
        try {
            input?.focus({ preventScroll: true });
        } catch (_) {}
    });
    return true;
}

function switchToRequestsTab() {
    if (typeof window.switchSidebarTab === 'function') {
        window.switchSidebarTab('requests');
        return true;
    }
    document.getElementById('requestsShortcutBtn')?.click();
    return true;
}

function openQrCard() {
    if (typeof window.openMyQrModal === 'function') {
        window.openMyQrModal();
        return true;
    }
    return false;
}

function openProfileSettings() {
    const profileButton = document.getElementById('sidebarStatusSettingsBtn')
        || document.getElementById('sidebarProfileShortcut');
    if (!profileButton) return false;
    profileButton.click();
    return true;
}

function openSupportFeedback() {
    window.location.assign('/support/feedback');
    return true;
}

export function initSidebarBrandQuickActions({ openDialog = null } = {}) {
    const topCard = document.querySelector('.sidebar-top-card');
    const topRow = topCard?.querySelector('.sidebar-top-row');
    const brand = topRow?.querySelector('.sidebar-brand');
    const trigger = brand?.querySelector('.sidebar-brand-dot');

    if (!topCard || !topRow || !brand || !trigger) return null;
    if (document.getElementById('sidebarBrandQuickActions')) return null;

    const copy = getUiCopy();
    const panel = document.createElement('div');
    panel.className = 'sidebar-brand-quick-actions';
    panel.id = 'sidebarBrandQuickActions';
    panel.hidden = true;
    panel.setAttribute('hidden', '');
    panel.setAttribute('role', 'menu');
    panel.innerHTML = `
        <div class="sidebar-brand-quick-actions__logo" aria-hidden="true">
            <span class="sidebar-brand-quick-actions__logo-dot"></span>
            <span class="sidebar-brand-quick-actions__logo-text">sun</span>
        </div>
        <button type="button" class="sidebar-brand-quick-action" data-quick-action="new-chat">
            <i class="bi bi-chat-dots" aria-hidden="true"></i>
            <span class="sidebar-brand-quick-action__label">${copy.newChat}</span>
        </button>
        <button type="button" class="sidebar-brand-quick-action" data-quick-action="requests">
            <i class="bi bi-person-plus" aria-hidden="true"></i>
            <span class="sidebar-brand-quick-action__label">${copy.requests}</span>
        </button>
        <button type="button" class="sidebar-brand-quick-action" data-quick-action="qr">
            <i class="bi bi-qr-code" aria-hidden="true"></i>
            <span class="sidebar-brand-quick-action__label">${copy.qr}</span>
        </button>
        <button type="button" class="sidebar-brand-quick-action" data-quick-action="support">
            <i class="bi bi-life-preserver" aria-hidden="true"></i>
            <span class="sidebar-brand-quick-action__label">${copy.support}</span>
        </button>
        <button type="button" class="sidebar-brand-quick-action" data-quick-action="profile">
            <i class="bi bi-person-circle" aria-hidden="true"></i>
            <span class="sidebar-brand-quick-action__label">${copy.profile}</span>
        </button>
    `;

    const tabs = document.getElementById('sidebarTabs');
    if (tabs && tabs.parentElement === topCard) {
        topCard.insertBefore(panel, tabs);
    } else {
        topCard.appendChild(panel);
    }

    Array.from(panel.querySelectorAll('.sidebar-brand-quick-action')).forEach((button, index) => {
        button.style.setProperty('--quick-action-index', String(index));
        button.setAttribute('role', 'menuitem');
        const label = String(button.querySelector('.sidebar-brand-quick-action__label')?.textContent || '').trim();
        if (label) button.setAttribute('aria-label', label);
    });

    trigger.classList.add('sidebar-brand-dot--button');
    trigger.setAttribute('role', 'button');
    trigger.setAttribute('tabindex', '0');
    trigger.setAttribute('aria-label', copy.triggerLabel);
    trigger.setAttribute('aria-haspopup', 'menu');
    trigger.setAttribute('aria-controls', panel.id);
    trigger.setAttribute('aria-expanded', 'false');

    let panelOpen = false;
    let lastTapAt = 0;
    let longPressTimer = 0;
    let singleTapTimer = 0;
    let longPressTriggered = false;
    let triggerPointerId = null;
    let dragState = null;

    const suppressTriggerClick = (event) => {
        event.preventDefault();
    };

    function clearLongPressTimer() {
        if (!longPressTimer) return;
        window.clearTimeout(longPressTimer);
        longPressTimer = 0;
    }

    function clearSingleTapTimer() {
        if (!singleTapTimer) return;
        window.clearTimeout(singleTapTimer);
        singleTapTimer = 0;
    }

    function setTriggerExpanded(expanded) {
        trigger.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    }

    function openPanel() {
        if (panelOpen) return;
        panelOpen = true;
        panel.hidden = false;
        panel.removeAttribute('hidden');
        panel.classList.add('is-open');
        brand.classList.add('has-quick-actions');
        trigger.classList.add('is-active');
        setTriggerExpanded(true);
    }

    function closePanel({ focusTrigger = false } = {}) {
        if (!panelOpen) return;
        panelOpen = false;
        panel.classList.remove('is-open');
        panel.style.removeProperty('--quick-actions-drag-shift');
        panel.hidden = true;
        panel.setAttribute('hidden', '');
        brand.classList.remove('has-quick-actions');
        trigger.classList.remove('is-active');
        setTriggerExpanded(false);
        if (focusTrigger) {
            try {
                trigger.focus({ preventScroll: true });
            } catch (_) {}
        }
    }

    function togglePanel() {
        if (panelOpen) {
            closePanel();
            return;
        }
        openPanel();
    }

    function runQuickAction(action, { focusTrigger = false } = {}) {
        const actionKey = String(action || '').trim();
        if (!actionKey) return;

        if (actionKey === 'new-chat') {
            openCommandPalette({ openDialog, prefill: '' });
        } else if (actionKey === 'requests') {
            switchToRequestsTab();
        } else if (actionKey === 'qr') {
            openQrCard();
        } else if (actionKey === 'support') {
            openSupportFeedback();
        } else if (actionKey === 'profile') {
            openProfileSettings();
        }

        closePanel({ focusTrigger });
    }

    function clearTriggerPressedState() {
        trigger.classList.remove('is-pressed');
    }

    function stopTriggerGestureTracking() {
        clearLongPressTimer();
        clearTriggerPressedState();
        triggerPointerId = null;
    }

    function resetPanelDrag() {
        dragState = null;
        panel.style.removeProperty('--quick-actions-drag-shift');
    }

    function handleTriggerPointerDown(event) {
        if (event.button !== 0 && event.pointerType === 'mouse') return;

        clearSingleTapTimer();
        clearLongPressTimer();
        longPressTriggered = false;
        triggerPointerId = event.pointerId;
        trigger.classList.add('is-pressed');

        longPressTimer = window.setTimeout(() => {
            longPressTriggered = true;
            clearTriggerPressedState();
            vibrateFeedback(14);
            runQuickAction('new-chat');
        }, LONG_PRESS_MS);
    }

    function handleTriggerPointerMove(event) {
        if (triggerPointerId === null || event.pointerId !== triggerPointerId) return;
        const target = event.target;
        if (target instanceof Element && target.closest('.sidebar-brand')) return;
        stopTriggerGestureTracking();
    }

    function handleTriggerPointerUp(event) {
        if (triggerPointerId === null || event.pointerId !== triggerPointerId) return;

        stopTriggerGestureTracking();
        if (longPressTriggered) {
            longPressTriggered = false;
            return;
        }

        const now = Date.now();
        if (now - lastTapAt <= DOUBLE_TAP_MS) {
            lastTapAt = 0;
            clearSingleTapTimer();
            runQuickAction('new-chat');
            return;
        }

        lastTapAt = now;
        singleTapTimer = window.setTimeout(() => {
            singleTapTimer = 0;
            togglePanel();
        }, DOUBLE_TAP_MS + 12);
    }

    function handleTriggerPointerCancel() {
        stopTriggerGestureTracking();
        longPressTriggered = false;
    }

    function handleTriggerKeyDown(event) {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            clearSingleTapTimer();
            togglePanel();
            return;
        }
        if (event.key === 'Escape') {
            event.preventDefault();
            closePanel({ focusTrigger: true });
            return;
        }
        if (event.key === 'ArrowDown') {
            event.preventDefault();
            openPanel();
            panel.querySelector('.sidebar-brand-quick-action')?.focus();
        }
    }

    function handleDocumentPointerDown(event) {
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest('.sidebar-brand') || target.closest('#sidebarBrandQuickActions')) return;
        closePanel();
    }

    function handlePanelPointerDown(event) {
        if (!panelOpen) return;
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (event.target instanceof Element && event.target.closest('.sidebar-brand-quick-action')) return;
        dragState = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            dragging: false,
        };
    }

    function handlePanelPointerMove(event) {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        const dx = event.clientX - dragState.startX;
        const dy = event.clientY - dragState.startY;

        if (!dragState.dragging) {
            if (dy < 4 || Math.abs(dy) < Math.abs(dx)) return;
            dragState.dragging = true;
        }

        const shift = Math.max(0, Math.min(SWIPE_CLOSE_THRESHOLD_PX + 8, dy));
        panel.style.setProperty('--quick-actions-drag-shift', `${shift.toFixed(1)}px`);

        if (shift >= SWIPE_CLOSE_THRESHOLD_PX) {
            resetPanelDrag();
            closePanel();
        }
    }

    function handlePanelPointerEnd() {
        if (!dragState) return;
        resetPanelDrag();
    }

    function handlePanelActionClick(event) {
        const actionBtn = event.target instanceof Element
            ? event.target.closest('.sidebar-brand-quick-action[data-quick-action]')
            : null;
        if (!actionBtn) return;
        event.preventDefault();
        runQuickAction(actionBtn.getAttribute('data-quick-action'), { focusTrigger: true });
    }

    function handlePanelKeyDown(event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        closePanel({ focusTrigger: true });
    }

    trigger.addEventListener('pointerdown', handleTriggerPointerDown);
    trigger.addEventListener('pointermove', handleTriggerPointerMove);
    trigger.addEventListener('pointerup', handleTriggerPointerUp);
    trigger.addEventListener('pointercancel', handleTriggerPointerCancel);
    trigger.addEventListener('pointerleave', handleTriggerPointerCancel);
    trigger.addEventListener('click', suppressTriggerClick);
    trigger.addEventListener('keydown', handleTriggerKeyDown);

    document.addEventListener('pointerdown', handleDocumentPointerDown, true);
    document.addEventListener('keydown', handlePanelKeyDown);

    panel.addEventListener('pointerdown', handlePanelPointerDown);
    panel.addEventListener('pointermove', handlePanelPointerMove);
    panel.addEventListener('pointerup', handlePanelPointerEnd);
    panel.addEventListener('pointercancel', handlePanelPointerEnd);
    panel.addEventListener('click', handlePanelActionClick);

    return {
        open: openPanel,
        close: closePanel,
        destroy() {
            clearLongPressTimer();
            clearSingleTapTimer();
            trigger.removeEventListener('pointerdown', handleTriggerPointerDown);
            trigger.removeEventListener('pointermove', handleTriggerPointerMove);
            trigger.removeEventListener('pointerup', handleTriggerPointerUp);
            trigger.removeEventListener('pointercancel', handleTriggerPointerCancel);
            trigger.removeEventListener('pointerleave', handleTriggerPointerCancel);
            trigger.removeEventListener('click', suppressTriggerClick);
            trigger.removeEventListener('keydown', handleTriggerKeyDown);
            document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
            document.removeEventListener('keydown', handlePanelKeyDown);
            panel.removeEventListener('pointerdown', handlePanelPointerDown);
            panel.removeEventListener('pointermove', handlePanelPointerMove);
            panel.removeEventListener('pointerup', handlePanelPointerEnd);
            panel.removeEventListener('pointercancel', handlePanelPointerEnd);
            panel.removeEventListener('click', handlePanelActionClick);
            panel.remove();
            brand.classList.remove('has-quick-actions');
            trigger.classList.remove('is-active', 'is-pressed', 'sidebar-brand-dot--button');
            trigger.removeAttribute('role');
            trigger.removeAttribute('tabindex');
            trigger.removeAttribute('aria-label');
            trigger.removeAttribute('aria-haspopup');
            trigger.removeAttribute('aria-controls');
            trigger.removeAttribute('aria-expanded');
        },
    };
}
