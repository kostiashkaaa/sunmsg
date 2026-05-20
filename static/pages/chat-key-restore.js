function getPrivateKeySessionApi() {
    return window.sunPrivateKeySession || null;
}

function withAppRoot(path) {
    const raw = String(path || '').trim();
    if (!raw) return '/';
    if (/^[a-z][a-z0-9+\-.]*:/i.test(raw) || raw.startsWith('//') || raw.startsWith('#')) {
        return raw;
    }
    const rootRaw = String(window.SUN_BOOTSTRAP?.app?.root || window.SUN_APP_ROOT || '').trim();
    const root = !rootRaw || rootRaw === '/'
        ? ''
        : (rootRaw.startsWith('/') ? rootRaw : `/${rootRaw}`).replace(/\/+$/, '');
    if (!root) {
        return raw.startsWith('/') ? raw : `/${raw.replace(/^\/+/, '')}`;
    }
    if (raw.startsWith('/')) {
        if (raw === root || raw.startsWith(`${root}/`) || raw.startsWith(`${root}?`) || raw.startsWith(`${root}#`)) {
            return raw;
        }
        return `${root}${raw}`;
    }
    return `${root}/${raw.replace(/^\/+/, '')}`;
}

function hasPrivateKeyForUi() {
    const api = getPrivateKeySessionApi();
    if (!api || typeof api.getPrivateKeyPem !== 'function') {
        return false;
    }
    return Boolean(api.getPrivateKeyPem());
}

async function persistPrivateKeyPem(privateKeyPem) {
    const api = getPrivateKeySessionApi();
    if (!api || typeof api.stagePrivateKeyForRedirect !== 'function') {
        return false;
    }
    return api.stagePrivateKeyForRedirect(privateKeyPem, {
        persistent: false,
        notify: true,
    });
}

function syncLockAlertVisibility() {
    const alertEl = document.getElementById('e2eLockAlert');
    if (!alertEl) return;
    alertEl.style.display = 'none';
}

syncLockAlertVisibility();
window.addEventListener('sun-private-key-status-changed', syncLockAlertVisibility);
window.addEventListener('focus', syncLockAlertVisibility);

(function () {
    const WORD_COUNT = 24;
    const modal = document.getElementById('keyRestoreModal');
    const grid = document.getElementById('keyRestoreGrid');
    const errEl = document.getElementById('keyRestoreError');
    const submitBtn = document.getElementById('keyRestoreSubmitBtn');

    if (!modal || !grid || !errEl || !submitBtn) return;

    let gridBound = false;
    let modalPhase = 'closed';
    let modalTransitionSeq = 0;
    let modalClosePromise = null;

    function prefersReducedMotion() {
        if (document.documentElement.classList.contains('perf-lite')) {
            return true;
        }
        const motionLevel = String(document.documentElement.getAttribute('data-motion-level') || 'full').toLowerCase();
        if (motionLevel !== 'lite') {
            return false;
        }
        try {
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch (_) {
            return false;
        }
    }

    function parseDurationMs(raw, fallbackMs = 0) {
        const value = String(raw || '').trim().toLowerCase();
        if (!value) return fallbackMs;
        if (value.endsWith('ms')) {
            const ms = Number.parseFloat(value.slice(0, -2));
            return Number.isFinite(ms) ? Math.max(0, ms) : fallbackMs;
        }
        if (value.endsWith('s')) {
            const seconds = Number.parseFloat(value.slice(0, -1));
            return Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : fallbackMs;
        }
        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? Math.max(0, parsed) : fallbackMs;
    }

    function getModalTransitionMs() {
        if (prefersReducedMotion()) return 0;
        const style = window.getComputedStyle(modal);
        const durations = String(style.transitionDuration || '')
            .split(',')
            .map((item) => parseDurationMs(item, 0));
        const delays = String(style.transitionDelay || '')
            .split(',')
            .map((item) => parseDurationMs(item, 0));
        const durationMax = durations.reduce((maxMs, currentMs) => Math.max(maxMs, currentMs), 0);
        const delayMax = delays.reduce((maxMs, currentMs) => Math.max(maxMs, currentMs), 0);
        return Math.max(durationMax + delayMax, 240);
    }

    function waitForAnimationEnd(fallbackMs) {
        if (fallbackMs <= 0) return Promise.resolve();
        return new Promise((resolve) => {
            let settled = false;
            let timeoutId = 0;
            const onEnd = (event) => {
                if (event?.target !== modal) return;
                finish();
            };
            const finish = () => {
                if (settled) return;
                settled = true;
                if (timeoutId) window.clearTimeout(timeoutId);
                modal.removeEventListener('transitionend', onEnd);
                modal.removeEventListener('animationend', onEnd);
                resolve();
            };
            modal.addEventListener('transitionend', onEnd);
            modal.addEventListener('animationend', onEnd);
            timeoutId = window.setTimeout(finish, fallbackMs + 50);
        });
    }

    function hideError() {
        errEl.textContent = '';
        errEl.classList.remove('is-visible');
    }

    function showError(message) {
        errEl.textContent = message;
        errEl.classList.add('is-visible');
    }

    function buildGrid() {
        grid.innerHTML = '';
        for (let i = 1; i <= WORD_COUNT; i++) {
            const wrap = document.createElement('div');
            wrap.className = 'key-restore-word-wrap';
            wrap.innerHTML = `<span class="key-restore-num">${i}</span>
                <input type="text" class="key-restore-input" data-idx="${i}" autocomplete="off" autocorrect="off" spellcheck="false">`;
            grid.appendChild(wrap);
        }

        if (gridBound) return;
        gridBound = true;

        // Paste anywhere in grid -> distribute words.
        grid.addEventListener('paste', (e) => {
            const text = (e.clipboardData || window.clipboardData).getData('text');
            const words = text.trim().split(/\s+/);
            if (words.length < 2) return;
            e.preventDefault();
            const inputs = grid.querySelectorAll('input');
            words.forEach((word, idx) => {
                if (inputs[idx]) inputs[idx].value = word.toLowerCase();
            });
            inputs[Math.min(words.length, WORD_COUNT - 1)]?.focus();
        });

        // Auto-advance on space/enter.
        grid.addEventListener('keydown', (e) => {
            if (e.key !== ' ' && e.key !== 'Enter') return;
            const inputs = Array.from(grid.querySelectorAll('input'));
            const idx = inputs.indexOf(e.target);
            if (idx === -1 || idx >= inputs.length - 1) return;
            e.preventDefault();
            inputs[idx + 1].focus();
        });
    }

    window.openKeyRestoreModal = function () {
        buildGrid();
        hideError();
        modalTransitionSeq += 1;
        modalClosePromise = null;
        modalPhase = 'opening';
        modal.classList.remove('is-closing');
        modal.classList.add('is-open', 'is-opening');
        modal.setAttribute('aria-hidden', 'false');
        window._activateFocusTrap?.(modal);
        requestAnimationFrame(() => {
            if (!modal.classList.contains('is-open')) return;
            modal.classList.remove('is-opening');
            modalPhase = 'open';
            modal.querySelector('input')?.focus();
        });
    };

    function closeModal() {
        if (modalPhase === 'closing' && modalClosePromise) return modalClosePromise;
        if (modalPhase === 'closed' && !modal.classList.contains('is-open')) return Promise.resolve(false);

        const closeSeq = ++modalTransitionSeq;
        modalPhase = 'closing';
        modal.classList.remove('is-opening', 'is-open');
        modal.classList.add('is-closing');
        modal.setAttribute('aria-hidden', 'true');
        window._deactivateFocusTrap?.(modal);

        modalClosePromise = waitForAnimationEnd(getModalTransitionMs()).then(() => {
            if (closeSeq !== modalTransitionSeq) return false;
            modal.classList.remove('is-closing');
            modalPhase = 'closed';
            modalClosePromise = null;
            return true;
        });
        return modalClosePromise;
    }

    document.getElementById('keyRestoreCloseBtn')?.addEventListener('click', closeModal);
    document.getElementById('keyRestoreCancelBtn')?.addEventListener('click', closeModal);
    document.getElementById('keyRestoreImportBtn')?.addEventListener('click', async () => {
        const keyTransferApi = window.sunKeyTransfer || null;
        if (!keyTransferApi || typeof keyTransferApi.openReceiveModal !== 'function') {
            showError('\u041C\u043E\u0434\u0443\u043B\u044C \u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0430 \u043A\u043B\u044E\u0447\u0430 \u043D\u0435 \u0437\u0430\u0433\u0440\u0443\u0436\u0435\u043D.');
            return;
        }
        await keyTransferApi.openReceiveModal({
            onSuccess: async () => {
                await closeModal();
                syncLockAlertVisibility();
                if (typeof window._redecryptCurrentChat === 'function') {
                    await window._redecryptCurrentChat();
                } else {
                    window.location.reload();
                }
            },
        });
    });
    modal.addEventListener('click', (e) => {
        if (e.target === modal) closeModal();
    });
    if (typeof document.addEventListener === 'function') {
        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && modal.classList.contains('is-open')) {
                closeModal();
            }
        });
    }
    document.getElementById('e2eLockAlert')?.addEventListener('click', () => {
        window.openKeyRestoreModal();
    });

    submitBtn.addEventListener('click', async () => {
        const words = Array.from(grid.querySelectorAll('input'))
            .map((input) => input.value.trim().toLowerCase())
            .filter(Boolean);

        if (words.length < 12) {
            showError('\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043D\u0435 \u043C\u0435\u043D\u0435\u0435 12 \u0441\u043B\u043E\u0432.');
            return;
        }

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<i class="bi bi-hourglass-split"></i> \u0420\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u043A\u0430…';
        hideError();

        try {
            const res = await fetch(withAppRoot('/api/get_login_vault'));
            if (!res.ok) throw new Error(`\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0434\u0430\u043D\u043D\u044B\u0435 \u0430\u043A\u043A\u0430\u0443\u043D\u0442\u0430 (${res.status})`);
            const data = await res.json();
            if (!data.login_vault) {
                throw new Error('\u0421\u0435\u0439\u0444 \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D. \u041F\u043E\u043F\u0440\u043E\u0431\u0443\u0439\u0442\u0435 \u0441\u0431\u0440\u043E\u0441\u0438\u0442\u044C \u043A\u043B\u044E\u0447\u0438 \u0432 \u043D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0430\u0445.');
            }

            const phrase = words.join(' ');
            const privateKeyPem = await window.mnemonic.decryptVault(phrase, data.login_vault);
            const persisted = await persistPrivateKeyPem(privateKeyPem);
            if (!persisted) {
                throw new Error('Не удалось безопасно активировать приватный ключ на этом устройстве.');
            }

            closeModal();
            syncLockAlertVisibility();

            if (typeof window._redecryptCurrentChat === 'function') {
                await window._redecryptCurrentChat();
            } else {
                window.location.reload();
            }
        } catch (err) {
            showError(err.message || '\u041D\u0435\u0432\u0435\u0440\u043D\u0430\u044F \u0444\u0440\u0430\u0437\u0430 \u0438\u043B\u0438 \u043F\u043E\u0432\u0440\u0435\u0436\u0434\u0451\u043D\u043D\u044B\u0439 \u0441\u0435\u0439\u0444.');
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = '<i class="bi bi-unlock-fill"></i> \u0420\u0430\u0441\u0448\u0438\u0444\u0440\u043E\u0432\u0430\u0442\u044C';
        }
    });
})();
