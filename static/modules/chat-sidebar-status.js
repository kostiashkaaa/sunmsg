function setSidebarChipState(chipEl, state, title) {
    if (!chipEl) return;
    chipEl.dataset.state = state;
    chipEl.title = title || '';
    chipEl.setAttribute('aria-label', title || '');
}

export function computeSidebarStatusSnapshot({
    hasNetwork = true,
    socketConnected = false,
    hasSocketConnectedOnce = false,
    hasSocketConnectionIssue = false,
} = {}) {
    let overallState = 'ok';
    let action = 'device';
    let title = '\u0423\u0441\u0442\u0440\u043E\u0439\u0441\u0442\u0432\u043E \u0433\u043E\u0442\u043E\u0432\u043E';
    let hint = '\u041D\u0430\u0436\u043C\u0438\u0442\u0435, \u0447\u0442\u043E\u0431\u044B \u043F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u0432\u0430\u0448 QR';

    const syncChipState = !hasNetwork
        ? 'danger'
        : (socketConnected ? 'ok' : 'warn');
    const syncChipTitle = !hasNetwork
        ? 'SYNC \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D \u0431\u0435\u0437 \u0441\u0435\u0442\u0438'
        : (socketConnected
            ? 'SYNC \u0430\u043A\u0442\u0438\u0432\u0435\u043D'
            : 'SYNC \u043E\u0431\u043D\u043E\u0432\u043B\u044F\u0435\u0442\u0441\u044F');

    if (!hasNetwork) {
        overallState = 'danger';
        action = 'sync';
        title = 'SYNC \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D';
        hint = '\u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u0435';
    } else if (!socketConnected && (hasSocketConnectedOnce || hasSocketConnectionIssue)) {
        overallState = 'warn';
        action = 'sync';
        title = '\u0421\u0432\u044F\u0437\u044C \u043E\u0431\u043D\u043E\u0432\u043B\u044F\u0435\u0442\u0441\u044F';
        hint = '\u041D\u0430\u0436\u043C\u0438\u0442\u0435, \u0447\u0442\u043E\u0431\u044B \u043E\u0431\u043D\u043E\u0432\u0438\u0442\u044C \u0441\u043E\u0435\u0434\u0438\u043D\u0435\u043D\u0438\u0435';
    }

    return {
        overallState,
        action,
        title,
        hint,
        hasNetwork: Boolean(hasNetwork),
        syncChipState,
        syncChipTitle,
    };
}

export function syncSidebarStatusBar(ui = {}, snapshot = {}) {
    const {
        sidebarSyncChip,
        sidebarStatusBar,
        sidebarStatusTitle,
        sidebarStatusHint,
    } = ui;

    setSidebarChipState(
        sidebarSyncChip,
        snapshot.syncChipState || 'warn',
        snapshot.syncChipTitle || '',
    );

    if (sidebarStatusBar) {
        sidebarStatusBar.dataset.state = snapshot.overallState || 'warn';
        sidebarStatusBar.dataset.action = snapshot.action || 'device';
        sidebarStatusBar.title = snapshot.hint || '';
        const labelTitle = snapshot.title || '';
        const labelHint = snapshot.hint || '';
        sidebarStatusBar.setAttribute(
            'aria-label',
            labelHint ? `${labelTitle}. ${labelHint}` : labelTitle,
        );
    }
    if (sidebarStatusTitle) sidebarStatusTitle.textContent = snapshot.title || '';
    if (sidebarStatusHint) sidebarStatusHint.textContent = snapshot.hint || '';
}

export function runSidebarStatusAction(action, deps = {}, options = {}) {
    const { silent = false } = options;
    const {
        getHasNetwork = () => true,
        syncSidebarStatusBar = () => {},
        showToast = () => {},
        isSocketConnected = () => false,
        setSocketConnectionIssue = () => {},
        socketConnect = () => {},
        reportActivity = () => {},
        getVisibilityState = () => 'visible',
        getHasPrivateKey = () => false,
        openDeviceQrHub = null,
        openMyQrModal = null,
        openSettingsOverlay = null,
    } = deps;

    if (action === 'sync') {
        if (!getHasNetwork()) {
            showToast('\u0411\u0435\u0437 \u0441\u0435\u0442\u0438 \u043F\u0435\u0440\u0435\u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E.', 'warning');
            return;
        }
        if (isSocketConnected()) {
            reportActivity(getVisibilityState() === 'visible');
            syncSidebarStatusBar();
            if (!silent) showToast('SYNC \u0443\u0436\u0435 \u0430\u043A\u0442\u0438\u0432\u0435\u043D.', 'success');
            return;
        }
        setSocketConnectionIssue(true);
        syncSidebarStatusBar();
        try {
            socketConnect();
        } catch (_err) {
            // Ignore and let the built-in reconnection keep running.
        }
        if (!silent) showToast('\u041E\u0431\u043D\u043E\u0432\u043B\u044F\u0435\u043C SYNC…', 'info');
        return;
    }

    if (getHasPrivateKey()) {
        if (typeof openDeviceQrHub === 'function') {
            openDeviceQrHub();
            return;
        }
        if (typeof openMyQrModal === 'function') {
            openMyQrModal();
            return;
        }
        return;
    }
    if (typeof openSettingsOverlay === 'function') {
        openSettingsOverlay('keys');
    }
}
