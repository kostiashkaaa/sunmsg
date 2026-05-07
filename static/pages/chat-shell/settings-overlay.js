export function initChatShellSettingsOverlay(options = {}) {
    const withAppRoot = options.withAppRoot || ((value) => value);
    const markFirstRunCompleted = options.markFirstRunCompleted || (() => {});
    const onThemeUpdated = options.onThemeUpdated || (() => Promise.resolve());
    const onLanguageUpdated = options.onLanguageUpdated || (() => {});
    const onAvatarUpdated = options.onAvatarUpdated || (() => {});
    const onRedecrypt = options.onRedecrypt || (() => {});
    const isPrivateKeyUnlocked = options.isPrivateKeyUnlocked || (() => false);

    const commandLauncherInput = document.getElementById('searchInput');
    const settingsOverlay = document.getElementById('settingsOverlay');
    const settingsOverlayFrame = document.getElementById('settingsOverlayFrame');
    const settingsOverlayBackdrop = document.getElementById('settingsOverlayBackdrop');
    const settingsOverlayShell = document.getElementById('settingsOverlayShell');

    let settingsOverlayLoadTimer = 0;
    let settingsOverlayReadyTimer = 0;
    let settingsOverlayAwaitingReadySignal = false;
    let settingsOverlayPhase = 'closed';
    let settingsOverlayTransitionSeq = 0;
    let settingsOverlayScrollLocked = false;
    let settingsOverlayBodyOverflow = '';
    let settingsOverlayBodyPaddingRight = '';
    const dialogTransitionState = new WeakMap();

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

    function maxTransitionMs(element, fallbackMs = 220) {
        if (!element || prefersReducedMotion()) return 0;
        const style = getComputedStyle(element);
        const durations = String(style.transitionDuration || '')
            .split(',')
            .map((item) => parseDurationMs(item, 0));
        const delays = String(style.transitionDelay || '')
            .split(',')
            .map((item) => parseDurationMs(item, 0));
        const durationMax = durations.reduce((maxMs, currentMs) => Math.max(maxMs, currentMs), 0);
        const delayMax = delays.reduce((maxMs, currentMs) => Math.max(maxMs, currentMs), 0);
        return Math.max(durationMax + delayMax, fallbackMs);
    }

    function waitForAnimationEnd(element, fallbackMs) {
        if (!element || fallbackMs <= 0) return Promise.resolve();
        return new Promise((resolve) => {
            let settled = false;
            let timeoutId = 0;
            const onEnd = (event) => {
                if (event?.target !== element) return;
                finish();
            };
            const finish = () => {
                if (settled) return;
                settled = true;
                if (timeoutId) window.clearTimeout(timeoutId);
                element.removeEventListener('transitionend', onEnd);
                element.removeEventListener('animationend', onEnd);
                resolve();
            };
            element.addEventListener('transitionend', onEnd);
            element.addEventListener('animationend', onEnd);
            timeoutId = window.setTimeout(finish, fallbackMs + 50);
        });
    }

    function openAnimatedDialog(dialog) {
        if (!dialog) return;
        const state = dialogTransitionState.get(dialog) || {
            phase: 'closed',
            promise: null,
            lastFocused: null,
            seq: 0,
        };
        dialogTransitionState.set(dialog, state);
        if (state.phase === 'open' || state.phase === 'opening') return;

        const openSeq = ++state.seq;
        state.phase = 'opening';
        state.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        state.promise = null;
        dialog.classList.remove('is-closing');
        dialog.classList.add('is-opening');
        dialog.setAttribute('aria-hidden', 'false');
        if (!dialog.open) dialog.showModal();

        requestAnimationFrame(() => {
            if (openSeq !== state.seq) return;
            if (!dialog.open) return;
            dialog.classList.add('is-open');
            dialog.classList.remove('is-opening');
            state.phase = 'open';
        });
    }

    function closeAnimatedDialog(dialog) {
        if (!dialog) return Promise.resolve(false);
        const state = dialogTransitionState.get(dialog) || {
            phase: 'closed',
            promise: null,
            lastFocused: null,
            seq: 0,
        };
        dialogTransitionState.set(dialog, state);

        if (state.phase === 'closing' && state.promise) return state.promise;
        if (!dialog.open && !dialog.classList.contains('is-open')) {
            state.phase = 'closed';
            return Promise.resolve(false);
        }

        const closeSeq = ++state.seq;
        state.phase = 'closing';
        dialog.classList.remove('is-opening', 'is-open');
        dialog.classList.add('is-closing');
        dialog.setAttribute('aria-hidden', 'true');

        const waitMs = maxTransitionMs(dialog, 220);
        state.promise = waitForAnimationEnd(dialog, waitMs).then(() => {
            if (closeSeq !== state.seq) return false;
            if (dialog.open) dialog.close();
            dialog.classList.remove('is-closing', 'is-opening', 'is-open');
            state.phase = 'closed';
            const target = state.lastFocused;
            state.lastFocused = null;
            state.promise = null;
            if (target instanceof HTMLElement && document.contains(target)) {
                try { target.focus({ preventScroll: true }); } catch (_) {}
            }
            return true;
        });

        return state.promise;
    }

    function attachAnimatedDialog(dialog) {
        if (!dialog) return;
        dialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            closeAnimatedDialog(dialog);
        });
        dialog.addEventListener('click', (event) => {
            const rect = dialog.getBoundingClientRect();
            const isInside =
                event.clientX >= rect.left &&
                event.clientX <= rect.right &&
                event.clientY >= rect.top &&
                event.clientY <= rect.bottom;
            if (!isInside) {
                closeAnimatedDialog(dialog);
            }
        });
    }

    function setSettingsOverlayLoading(isLoading) {
        if (!settingsOverlay) return;
        settingsOverlay.setAttribute('data-loading', isLoading ? 'true' : 'false');
        if (settingsOverlayShell) {
            settingsOverlayShell.setAttribute('aria-hidden', isLoading ? 'false' : 'true');
        }
    }

    function clearSettingsOverlayTimers() {
        window.clearTimeout(settingsOverlayLoadTimer);
        window.clearTimeout(settingsOverlayReadyTimer);
    }

    function resolveSettingsOverlayReady() {
        settingsOverlayAwaitingReadySignal = false;
        window.clearTimeout(settingsOverlayReadyTimer);
        setSettingsOverlayLoading(false);
    }

    function lockSettingsOverlayScroll() {
        if (settingsOverlayScrollLocked) return;
        settingsOverlayBodyOverflow = document.body.style.overflow;
        settingsOverlayBodyPaddingRight = document.body.style.paddingRight;
        const scrollbarCompensation = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
        if (scrollbarCompensation > 0) {
            document.body.style.paddingRight = `${scrollbarCompensation}px`;
        }
        document.body.style.overflow = 'hidden';
        settingsOverlayScrollLocked = true;
    }

    function unlockSettingsOverlayScroll() {
        if (!settingsOverlayScrollLocked) return;
        document.body.style.overflow = settingsOverlayBodyOverflow;
        document.body.style.paddingRight = settingsOverlayBodyPaddingRight;
        settingsOverlayScrollLocked = false;
    }

    function openCommandPalette(prefill = '') {
        const visibleInput = document.getElementById('searchInput');
        if (visibleInput && typeof prefill === 'string' && prefill) {
            visibleInput.value = prefill;
        }
        if (typeof window.openCommandPalette === 'function' && window.openCommandPalette !== openCommandPalette) {
            window.openCommandPalette(prefill);
        } else if (visibleInput) {
            try { visibleInput.focus({ preventScroll: true }); } catch (_) {}
        }
        markFirstRunCompleted();
    }

    function closeSettingsOverlay() {
        if (!settingsOverlay) return;
        if (settingsOverlayPhase === 'closing') return;
        if (!settingsOverlay.classList.contains('active') && settingsOverlayPhase === 'closed') return;
        clearSettingsOverlayTimers();
        settingsOverlayAwaitingReadySignal = false;
        const closeSeq = ++settingsOverlayTransitionSeq;
        settingsOverlayPhase = 'closing';
        settingsOverlay.classList.remove('is-opening');
        settingsOverlay.classList.remove('active');
        settingsOverlay.classList.add('is-closing');
        settingsOverlay.setAttribute('aria-hidden', 'true');

        const transitionTarget = settingsOverlay.querySelector('.settings-overlay-panel') || settingsOverlay;
        waitForAnimationEnd(transitionTarget, maxTransitionMs(transitionTarget, 280)).then(() => {
            if (closeSeq !== settingsOverlayTransitionSeq) return;
            settingsOverlay.classList.remove('active', 'is-closing', 'is-opening');
            setSettingsOverlayLoading(false);
            settingsOverlayPhase = 'closed';
            unlockSettingsOverlayScroll();
        });
    }

    function openSettingsOverlay(section = 'profile') {
        if (!settingsOverlay || !settingsOverlayFrame) return;
        clearSettingsOverlayTimers();
        const nextSrc = withAppRoot(`/settings?embed=1#${encodeURIComponent(section)}`);
        const openSeq = ++settingsOverlayTransitionSeq;
        settingsOverlayPhase = 'opening';
        settingsOverlay.classList.remove('active', 'is-closing');
        settingsOverlay.classList.add('is-opening');
        settingsOverlay.setAttribute('aria-hidden', 'false');
        lockSettingsOverlayScroll();
        requestAnimationFrame(() => {
            if (openSeq !== settingsOverlayTransitionSeq) return;
            settingsOverlay.classList.add('active');
            requestAnimationFrame(() => {
                if (openSeq !== settingsOverlayTransitionSeq) return;
                settingsOverlay.classList.remove('is-opening');
                settingsOverlayPhase = 'open';
            });
        });
        setSettingsOverlayLoading(true);
        settingsOverlayAwaitingReadySignal = true;
        settingsOverlayReadyTimer = window.setTimeout(() => {
            if (!settingsOverlayAwaitingReadySignal) return;
            resolveSettingsOverlayReady();
        }, 5000);
        if (settingsOverlayFrame.getAttribute('src') !== nextSrc) {
            settingsOverlayFrame.setAttribute('src', nextSrc);
        } else {
            try {
                const nextHash = `#${encodeURIComponent(section)}`;
                const frameLocation = settingsOverlayFrame.contentWindow?.location;
                if (frameLocation && frameLocation.hash !== nextHash) {
                    frameLocation.hash = nextHash;
                }
            } catch (_) {}
            settingsOverlayLoadTimer = window.setTimeout(() => {
                if (!settingsOverlayAwaitingReadySignal) return;
                resolveSettingsOverlayReady();
            }, 120);
        }
        markFirstRunCompleted();
    }

    function notifySettingsPrivateKeyStatus() {
        const frameWindow = settingsOverlayFrame?.contentWindow;
        if (!frameWindow) return;
        try {
            frameWindow.postMessage({
                type: 'sun-settings-private-key-status',
                detail: { unlocked: Boolean(isPrivateKeyUnlocked()) },
            }, window.location.origin);
        } catch (_) {}
    }

    settingsOverlayFrame?.addEventListener('load', () => {
        window.clearTimeout(settingsOverlayLoadTimer);
        const frameWindow = settingsOverlayFrame.contentWindow;
        const isAboutBlank = settingsOverlayFrame.getAttribute('src') === 'about:blank'
            || frameWindow?.location?.href === 'about:blank';
        if (isAboutBlank) {
            resolveSettingsOverlayReady();
            return;
        }
        settingsOverlayLoadTimer = window.setTimeout(() => {
            if (!settingsOverlayAwaitingReadySignal) return;
            resolveSettingsOverlayReady();
        }, 1800);
        notifySettingsPrivateKeyStatus();
    });

    settingsOverlayBackdrop?.addEventListener('click', closeSettingsOverlay);
    settingsOverlay?.addEventListener('click', (event) => {
        if (!settingsOverlay.classList.contains('active')) return;
        const panel = settingsOverlay.querySelector('.settings-overlay-panel');
        if (panel && event.target instanceof Node && panel.contains(event.target)) return;
        closeSettingsOverlay();
    });

    document.addEventListener('keydown', (event) => {
        if ((event.ctrlKey || event.metaKey) && String(event.key || '').toLowerCase() === 'k') {
            event.preventDefault();
            openCommandPalette(commandLauncherInput?.value || '');
            return;
        }
        if (event.key === 'Escape' && settingsOverlay?.classList.contains('active')) {
            closeSettingsOverlay();
        }
    });

    window.addEventListener('message', (event) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === 'sun-settings-close') {
            closeSettingsOverlay();
        }
        if (event.data?.type === 'sun-settings-ready') {
            resolveSettingsOverlayReady();
        }
        if (event.data?.type === 'sun-settings-theme-updated'
            || event.data?.type === 'sun-settings-interface-theme-updated'
            || event.data?.type === 'sun-settings-chat-appearance-updated') {
            onThemeUpdated().catch(() => {});
        }
        if (event.data?.type === 'sun-settings-language-updated') {
            onLanguageUpdated(event.data?.detail?.language, {
                persist: event.data?.detail?.persisted !== false,
            });
        }
        if (event.data?.type === 'sun-settings-message-scale-updated') {
            if (typeof window.applyChatMessageScale === 'function') {
                window.applyChatMessageScale(event.data?.detail?.scale, { persist: false, rerender: true });
            }
        }
        if (event.data?.type === 'sun-settings-avatar-updated') {
            onAvatarUpdated({
                avatarUrl: event.data?.detail?.avatarUrl,
                displayName: event.data?.detail?.displayName,
                username: event.data?.detail?.username,
            });
        }
        if (event.data?.type === 'sun-settings-redecrypt') {
            onRedecrypt();
            closeSettingsOverlay();
        }
    });

    window.openCommandPalette = openCommandPalette;
    window.openSettingsOverlay = openSettingsOverlay;
    window.sunDialogController = {
        openAnimatedDialog,
        closeAnimatedDialog,
    };

    return {
        openCommandPalette,
        openSettingsOverlay,
        closeSettingsOverlay,
        resolveSettingsOverlayReady,
        notifySettingsPrivateKeyStatus,
        openAnimatedDialog,
        closeAnimatedDialog,
        attachAnimatedDialog,
    };
}
