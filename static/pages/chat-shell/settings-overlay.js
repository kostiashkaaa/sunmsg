export function initChatShellSettingsOverlay(options = {}) {
    const withAppRoot = options.withAppRoot || ((value) => value);
    const markFirstRunCompleted = options.markFirstRunCompleted || (() => {});
    const onThemeUpdated = options.onThemeUpdated || (() => Promise.resolve());
    const onLanguageUpdated = options.onLanguageUpdated || (() => {});
    const onAvatarUpdated = options.onAvatarUpdated || (() => {});
    const onRedecrypt = options.onRedecrypt || (() => {});
    const onWeatherLabelUpdated = options.onWeatherLabelUpdated || (() => {});

    const commandLauncherInput = document.getElementById('searchInput');
    const settingsOverlay = document.getElementById('settingsOverlay');
    const settingsOverlayBackdrop = document.getElementById('settingsOverlayBackdrop');

    let settingsOverlayPhase = 'closed';
    let settingsOverlayTransitionSeq = 0;
    let settingsOverlayScrollLocked = false;
    let settingsOverlayBodyOverflow = '';
    let settingsOverlayBodyPaddingRight = '';
    let settingsPanelInitialized = false;
    let settingsPanelInitPromise = null;
    let commandPaletteOpenPromise = null;
    const dialogTransitionState = new WeakMap();
    const SETTINGS_OVERLAY_GLOW_CLASS = 'settings-overlay--brand-glow';

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

    function restartSettingsOverlayGlow() {
        if (!settingsOverlay) return;
        settingsOverlay.classList.remove(SETTINGS_OVERLAY_GLOW_CLASS);
        // Repaint the same overlay node so the brand glow is restored on every open.
        void settingsOverlay.offsetWidth;
        settingsOverlay.classList.add(SETTINGS_OVERLAY_GLOW_CLASS);
    }

    function clearSettingsOverlayGlow() {
        settingsOverlay?.classList.remove(SETTINGS_OVERLAY_GLOW_CLASS);
    }

    function initSettingsPanelOnce() {
        if (settingsPanelInitialized && settingsPanelInitPromise) return settingsPanelInitPromise;
        settingsPanelInitialized = true;
        settingsPanelInitPromise = import('../settings/orchestrator.js')
            .then(({ initSettingsPage }) => {
                initSettingsPage();
            })
            .catch((err) => {
                console.warn('[settings-overlay] Failed to init settings panel', err);
                settingsPanelInitialized = false;
                settingsPanelInitPromise = null;
            });
        return settingsPanelInitPromise;
    }

    function scrollSettingsPanelToSection(section) {
        // Trigger nav-shell section switch via custom event
        document.dispatchEvent(new CustomEvent('sun-settings-navigate', {
            detail: { section },
            bubbles: false,
        }));
        window.requestAnimationFrame(() => {
            const el = document.getElementById(`section-${section}`);
            if (!el) return;
            try {
                el.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (_) {}
        });
    }

    function navigateSettingsPanelToSection(section) {
        const targetSection = String(section || 'profile').trim() || 'profile';
        const readyPromise = initSettingsPanelOnce() || Promise.resolve();
        void readyPromise
            .then(() => {
                window.requestAnimationFrame(() => scrollSettingsPanelToSection(targetSection));
            })
            .catch(() => {
                scrollSettingsPanelToSection(targetSection);
            });
    }

    function openCommandPalette(prefill = '') {
        const visibleInput = document.getElementById('searchInput');
        if (visibleInput && typeof prefill === 'string' && prefill) {
            visibleInput.value = prefill;
        }
        if (!commandPaletteOpenPromise) {
            commandPaletteOpenPromise = import('../../modules/search-overlay.js')
                .then(({ initSearchOverlay }) => initSearchOverlay())
                .catch((error) => {
                    commandPaletteOpenPromise = null;
                    throw error;
                });
        }
        void commandPaletteOpenPromise
            .then((controller) => {
                controller?.openCommandPalette?.(prefill);
            })
            .catch((error) => {
                console.warn('Failed to open command palette', error);
                if (visibleInput) {
                    try { visibleInput.focus({ preventScroll: true }); } catch (_) {}
                }
            });
        markFirstRunCompleted();
    }

    function closeSettingsOverlay() {
        if (!settingsOverlay) return;
        if (settingsOverlayPhase === 'closing') return;
        if (!settingsOverlay.classList.contains('active') && settingsOverlayPhase === 'closed') return;
        const closeSeq = ++settingsOverlayTransitionSeq;
        settingsOverlayPhase = 'closing';
        clearSettingsOverlayGlow();
        settingsOverlay.classList.remove('is-opening');
        settingsOverlay.classList.remove('active');
        settingsOverlay.classList.add('is-closing');
        settingsOverlay.setAttribute('aria-hidden', 'true');

        const transitionTarget = settingsOverlay.querySelector('.settings-overlay-panel') || settingsOverlay;
        waitForAnimationEnd(transitionTarget, maxTransitionMs(transitionTarget, 280)).then(() => {
            if (closeSeq !== settingsOverlayTransitionSeq) return;
            settingsOverlay.classList.remove('active', 'is-closing', 'is-opening');
            settingsOverlayPhase = 'closed';
            unlockSettingsOverlayScroll();
        });
    }

    function openSettingsOverlay(section = 'profile') {
        const targetSection = String(section || 'profile').trim() || 'profile';

        if (!settingsOverlay) {
            window.location.href = withAppRoot('/chat');
            markFirstRunCompleted();
            return;
        }

        // Init settings JS lazily on first open
        const readyPromise = initSettingsPanelOnce() || Promise.resolve();

        if (settingsOverlay.classList.contains('active')) {
            restartSettingsOverlayGlow();
            navigateSettingsPanelToSection(targetSection);
            markFirstRunCompleted();
            return;
        }

        settingsOverlayPhase = 'opening';
        lockSettingsOverlayScroll();
        settingsOverlay.setAttribute('aria-hidden', 'false');
        settingsOverlay.classList.remove('is-closing');
        settingsOverlay.classList.add('is-opening');
        restartSettingsOverlayGlow();

        const openSeq = ++settingsOverlayTransitionSeq;
        requestAnimationFrame(() => {
            if (openSeq !== settingsOverlayTransitionSeq) return;
            settingsOverlay.classList.add('active');
            settingsOverlay.classList.remove('is-opening');
            settingsOverlayPhase = 'open';
            void readyPromise.then(() => {
                window.requestAnimationFrame(() => scrollSettingsPanelToSection(targetSection));
            }).catch(() => {
                scrollSettingsPanelToSection(targetSection);
            });
        });

        markFirstRunCompleted();
    }

    function applyMotionSettingsFromDetail(detail) {
        const rawPerformanceMode = String(detail?.performanceMode || '').trim().toLowerCase();
        const safePerformanceMode = rawPerformanceMode === 'lite' || rawPerformanceMode === 'full' || rawPerformanceMode === 'auto'
            ? rawPerformanceMode
            : 'auto';
        const rawMotionLevel = String(detail?.motionLevel || '').trim().toLowerCase();
        const safeMotionLevel = rawMotionLevel === 'full' || rawMotionLevel === 'balanced' || rawMotionLevel === 'lite' || rawMotionLevel === 'auto'
            ? rawMotionLevel
            : 'auto';
        const animationsEnabled = safePerformanceMode !== 'lite' && safeMotionLevel !== 'lite';
        const appliedMotionLevel = animationsEnabled
            ? (safeMotionLevel === 'auto' ? 'full' : safeMotionLevel)
            : 'lite';

        document.documentElement.classList.toggle('perf-lite', !animationsEnabled);
        document.documentElement.setAttribute('data-performance-mode', animationsEnabled ? 'full' : 'lite');
        document.documentElement.setAttribute('data-motion-level', appliedMotionLevel);
        window.SUN_PERFORMANCE_MODE = {
            ...(window.SUN_PERFORMANCE_MODE || {}),
            preference: safePerformanceMode,
            isLite: !animationsEnabled,
        };
        window.SUN_MOTION = {
            ...(window.SUN_MOTION || {}),
            preference: safeMotionLevel,
            level: appliedMotionLevel,
            forceAnimations: animationsEnabled,
        };
    }

    // Listen for CustomEvents dispatched by settings orchestrator (replaces postMessage)
    document.addEventListener('sun-settings-close', () => {
        closeSettingsOverlay();
    });

    document.addEventListener('sun-settings-ready', () => {
        // Panel is already visible in DOM, nothing to do
    });

    document.addEventListener('sun-settings-theme-updated', () => {
        onThemeUpdated().catch(() => {});
    });
    document.addEventListener('sun-settings-interface-theme-updated', () => {
        onThemeUpdated().catch(() => {});
    });
    document.addEventListener('sun-settings-chat-appearance-updated', () => {
        onThemeUpdated().catch(() => {});
    });

    document.addEventListener('sun-settings-language-updated', (event) => {
        onLanguageUpdated(event.detail?.language, {
            persist: event.detail?.persisted !== false,
        });
    });

    document.addEventListener('sun-settings-message-scale-updated', (event) => {
        if (typeof window.applyChatMessageScale === 'function') {
            window.applyChatMessageScale(event.detail?.scale, { persist: false, rerender: true });
        }
    });

    document.addEventListener('sun-settings-motion-updated', (event) => {
        applyMotionSettingsFromDetail(event.detail || {});
    });

    document.addEventListener('sun-settings-avatar-updated', (event) => {
        onAvatarUpdated({
            avatarUrl: event.detail?.avatarUrl,
            displayName: event.detail?.displayName,
            username: event.detail?.username,
        });
    });

    document.addEventListener('sun-settings-redecrypt', () => {
        onRedecrypt();
        closeSettingsOverlay();
    });

    document.addEventListener('sun-settings-weather-label-updated', (event) => {
        onWeatherLabelUpdated(event.detail || {});
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

    window.openCommandPalette = openCommandPalette;
    window.openSettingsOverlay = openSettingsOverlay;
    window.closeSettingsOverlay = closeSettingsOverlay;
    window.sunDialogController = {
        openAnimatedDialog,
        closeAnimatedDialog,
    };

    return {
        openCommandPalette,
        openSettingsOverlay,
        closeSettingsOverlay,
        openAnimatedDialog,
        closeAnimatedDialog,
        attachAnimatedDialog,
        notifySettingsPrivateKeyStatus: () => {},
    };
}
