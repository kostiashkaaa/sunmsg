import {
    getMotionDistanceTokenPx,
    getMotionDurationTokenMs,
    getMotionEasingToken,
    getVelocityAwareDurationMs,
    waitForMotionEnd,
} from '../../modules/motion.js';

export function initSettingsNavShell({
    tr,
    state,
    initSettingsQr,
    loadSessionDevices,
    closeSettingsSurface,
}) {
    const navItems = document.querySelectorAll('.nav-item[data-section]');
    const sections = document.querySelectorAll('section[id^="section-"]');
    const settingsContentEl = document.querySelector('.settings-content');
    const panelTitleEl = document.getElementById('settingsPanelTitle');
    const settingsNavEl = document.getElementById('settingsNav');
    const settingsNavToggleEl = document.getElementById('settingsNavToggle');
    const settingsNavToggleLabelEl = document.getElementById('settingsNavToggleLabel');
    const settingsNavListEl = document.getElementById('settingsNavList');
    const compactNavMedia = window.matchMedia('(max-width: 768px)');

    let mobileNavOpen = false;
    let activeSectionId = '';
    let sectionTransitionSeq = 0;

    const sectionTitles = {
        profile: 'Профиль',
        notifications: 'Уведомления и звук',
        'data-memory': 'Данные и память',
        privacy: 'Конфиденциальность',
        appearance: 'Общие настройки',
        'chat-style': 'Папки и стиль чатов',
        keys: 'Безопасность',
        account: 'Устройства',
        support: 'Язык и поддержка',
    };

    function isCompactNav() {
        return compactNavMedia.matches;
    }

    function setMobileNavOpen(nextState) {
        if (!settingsNavEl || !settingsNavToggleEl) return;
        mobileNavOpen = !!nextState;
        settingsNavEl.classList.toggle('mobile-open', mobileNavOpen);
        settingsNavToggleEl.setAttribute('aria-expanded', mobileNavOpen ? 'true' : 'false');
    }

    function updateNavToggleLabel(activeItem) {
        if (!settingsNavToggleLabelEl) return;
        const candidate = activeItem || document.querySelector('.nav-item[data-section].active');
        settingsNavToggleLabelEl.textContent = candidate?.textContent?.trim() || tr('Профиль');
    }

    function prefersReducedMotion() {
        if (document.documentElement.classList.contains('perf-lite')) return true;
        const motionLevel = String(document.documentElement.getAttribute('data-motion-level') || 'full').toLowerCase();
        if (motionLevel !== 'lite') return false;
        return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    }

    function scrollNavItemIntoView(item) {
        if (!item || typeof item.scrollIntoView !== 'function') return;
        const reducedMotion = prefersReducedMotion();
        item.scrollIntoView({
            block: 'nearest',
            inline: 'center',
            behavior: reducedMotion ? 'auto' : 'smooth',
        });
    }

    function syncCompactNavState() {
        if (!settingsNavEl || !settingsNavToggleEl) return;
        if (!isCompactNav()) {
            setMobileNavOpen(false);
        }
    }

    function bindDesktopHorizontalWheelScroll() {
        if (!settingsNavListEl) return;
        settingsNavListEl.addEventListener('wheel', (event) => {
            if (isCompactNav()) return;
            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
            const maxScrollLeft = settingsNavListEl.scrollWidth - settingsNavListEl.clientWidth;
            if (maxScrollLeft <= 1) return;
            const atLeftEdge = settingsNavListEl.scrollLeft <= 0;
            const atRightEdge = settingsNavListEl.scrollLeft >= (maxScrollLeft - 1);
            if ((event.deltaY < 0 && atLeftEdge) || (event.deltaY > 0 && atRightEdge)) return;
            event.preventDefault();
            settingsNavListEl.scrollLeft += event.deltaY;
        }, { passive: false });
    }

    sections.forEach((section) => {
        section.classList.add('settings-section');
    });

    function ensureVisibleActiveSection(preferredId = 'profile') {
        const active = Array.from(sections).find((section) => section.classList.contains('section-active'));
        if (active) return;
        const preferred = document.getElementById(`section-${preferredId}`);
        const fallback = preferred || sections[0];
        if (!fallback) return;
        sections.forEach((section) => {
            const isFallback = section === fallback;
            section.style.display = isFallback ? 'block' : 'none';
            section.classList.toggle('section-active', isFallback);
            section.classList.remove('section-entering', 'section-leaving');
        });
        if (settingsContentEl) {
            settingsContentEl.classList.remove('is-transitioning');
            settingsContentEl.style.minHeight = '';
        }
        activeSectionId = fallback.id.replace('section-', '') || preferredId;
    }

    function syncSectionTitle(id) {
        if (panelTitleEl) {
            panelTitleEl.textContent = tr(sectionTitles[id] || 'Настройки');
        }
    }

    function syncSectionNav(id) {
        let activeItem = null;
        navItems.forEach((item) => {
            const isActive = item.dataset.section === id;
            item.classList.toggle('active', isActive);
            if (isActive) {
                item.setAttribute('aria-current', 'page');
                activeItem = item;
            } else {
                item.removeAttribute('aria-current');
            }
        });
        updateNavToggleLabel(activeItem);
        if (activeItem) {
            scrollNavItemIntoView(activeItem);
        }
    }

    function runSectionSideEffects(id) {
        syncSectionTitle(id);
        syncSectionNav(id);

        if (id === 'keys' && !state.isQrGenerated()) {
            state.setQrGenerated(true);
            window.setTimeout(() => {
                initSettingsQr().catch(() => {});
            }, 50);
        }
        if (id === 'account') {
            loadSessionDevices();
        }
    }

    function cancelSectionAnimations(section) {
        if (!section || typeof section.getAnimations !== 'function') return;
        section.getAnimations().forEach((animation) => {
            try {
                animation.cancel();
            } catch (_) {}
        });
    }

    function animateSectionTransition(outgoing, incoming) {
        const reducedMotion = prefersReducedMotion();
        if (reducedMotion || !incoming || typeof incoming.animate !== 'function') {
            return;
        }

        cancelSectionAnimations(outgoing);
        cancelSectionAnimations(incoming);
        const compact = isCompactNav();
        const sectionOutCompactY = getMotionDistanceTokenPx('--motion-distance-section-out-compact-y', 14);
        const sectionOutDesktopX = getMotionDistanceTokenPx('--motion-distance-section-out-desktop-x', 22);
        const sectionInCompactY = getMotionDistanceTokenPx('--motion-distance-section-in-compact-y', 28);
        const sectionInDesktopX = getMotionDistanceTokenPx('--motion-distance-section-in-desktop-x', 34);
        const outgoingEnd = compact
            ? `translate3d(0, -${sectionOutCompactY}px, 0) scale(0.985)`
            : `translate3d(-${sectionOutDesktopX}px, 0, 0) scale(0.988)`;
        const incomingStart = compact
            ? `translate3d(0, ${sectionInCompactY}px, 0) scale(0.972)`
            : `translate3d(${sectionInDesktopX}px, 0, 0) scale(0.982)`;
        const outgoingBaseDuration = compact
            ? getMotionDurationTokenMs('--motion-duration-section-out-compact', 240)
            : getMotionDurationTokenMs('--motion-duration-section-out-desktop', 300);
        const incomingBaseDuration = compact
            ? getMotionDurationTokenMs('--motion-duration-section-in-compact', 360)
            : getMotionDurationTokenMs('--motion-duration-section-in-desktop', 500);
        const outgoingDuration = Math.max(
            outgoingBaseDuration,
            getVelocityAwareDurationMs(compact ? sectionOutCompactY : sectionOutDesktopX, {
                minToken: '--motion-duration-fast',
                maxToken: '--motion-duration-medium',
                fallbackMinMs: 180,
                fallbackMaxMs: 300,
            }),
        );
        const incomingDuration = Math.max(
            incomingBaseDuration,
            getVelocityAwareDurationMs(compact ? sectionInCompactY : sectionInDesktopX, {
                minToken: '--motion-duration-fast',
                maxToken: '--motion-duration-emphasis',
                fallbackMinMs: 180,
                fallbackMaxMs: 500,
            }),
        );
        const outgoingEasing = getMotionEasingToken('--motion-ease-exit', 'cubic-bezier(.4,0,.2,1)');
        const incomingEasing = getMotionEasingToken('--motion-ease-enter', 'cubic-bezier(.4,0,.2,1)');

        if (outgoing && typeof outgoing.animate === 'function') {
            outgoing.animate(
                [
                    { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)', filter: 'blur(0px)' },
                    { opacity: 0, transform: outgoingEnd, filter: 'blur(2px)' },
                ],
                {
                    duration: outgoingDuration,
                    easing: outgoingEasing,
                    fill: 'forwards',
                },
            );
        }

        incoming.animate(
            [
                { opacity: 0, transform: incomingStart, filter: 'blur(3px)' },
                { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)', filter: 'blur(0px)' },
            ],
            {
                duration: incomingDuration,
                easing: incomingEasing,
                fill: 'both',
            },
        );
    }

    function finalizeSectionTransition(outgoing, incoming) {
        cancelSectionAnimations(outgoing);
        cancelSectionAnimations(incoming);
        if (outgoing) {
            outgoing.style.display = 'none';
            outgoing.classList.remove('section-active', 'section-leaving');
        }
        if (incoming) {
            incoming.classList.remove('section-entering');
            incoming.classList.add('section-active');
        }
        if (settingsContentEl) {
            settingsContentEl.classList.remove('is-transitioning');
            settingsContentEl.style.minHeight = '';
        }
    }

    function showSection(id, pushState = true, { immediate = false } = {}) {
        const target = document.getElementById(`section-${id}`) || document.getElementById('section-profile');
        const resolvedId = target?.id?.replace('section-', '') || 'profile';
        const current = activeSectionId ? document.getElementById(`section-${activeSectionId}`) : null;
        const isSectionChange = activeSectionId !== resolvedId;

        if (!target) return;

        sectionTransitionSeq += 1;
        runSectionSideEffects(resolvedId);

        if (!current || immediate || current === target) {
            sections.forEach((section) => {
                const isActive = section === target;
                section.style.display = isActive ? 'block' : 'none';
                section.classList.toggle('section-active', isActive);
                section.classList.remove('section-entering', 'section-leaving');
            });
            if (settingsContentEl) {
                settingsContentEl.classList.remove('is-transitioning');
                settingsContentEl.style.minHeight = '';
            }
            activeSectionId = resolvedId;
            ensureVisibleActiveSection(resolvedId);
        } else {
            if (settingsContentEl) {
                const currentHeight = current.offsetHeight || 0;
                target.style.display = 'block';
                target.classList.remove('section-leaving');
                const nextHeight = target.offsetHeight || currentHeight;
                settingsContentEl.style.minHeight = `${Math.max(currentHeight, nextHeight)}px`;
                settingsContentEl.classList.add('is-transitioning');
            } else {
                target.style.display = 'block';
            }

            current.classList.remove('section-entering');
            current.classList.remove('section-active');
            current.classList.add('section-leaving');

            target.classList.remove('section-leaving');
            target.classList.remove('section-entering');
            void target.offsetWidth;
            target.classList.add('section-active', 'section-entering');
            animateSectionTransition(current, target);

            const transitionSeq = ++sectionTransitionSeq;
            const transitionFallbackMs = isCompactNav() ? 390 : 540;
            Promise.all([
                waitForMotionEnd(current, transitionFallbackMs),
                waitForMotionEnd(target, transitionFallbackMs),
            ]).then(() => {
                if (transitionSeq !== sectionTransitionSeq) return;
                finalizeSectionTransition(current, target);
                ensureVisibleActiveSection(resolvedId);
            });
            activeSectionId = resolvedId;
        }

        if (pushState) {
            history.pushState(null, null, `#${resolvedId}`);
        }

        if (isSectionChange && settingsContentEl) {
            settingsContentEl.scrollTop = 0;
        }
    }
    if (settingsNavToggleEl) {
        settingsNavToggleEl.addEventListener('click', () => {
            setMobileNavOpen(!mobileNavOpen);
        });
    }
    bindDesktopHorizontalWheelScroll();

    if (typeof compactNavMedia.addEventListener === 'function') {
        compactNavMedia.addEventListener('change', syncCompactNavState);
    } else if (typeof compactNavMedia.addListener === 'function') {
        compactNavMedia.addListener(syncCompactNavState);
    }

    document.addEventListener('click', (event) => {
        if (!mobileNavOpen || !isCompactNav() || !settingsNavEl) return;
        const target = event.target;
        if (target instanceof Node && settingsNavEl.contains(target)) return;
        setMobileNavOpen(false);
    });

    navItems.forEach((item) => {
        item.addEventListener('click', function (event) {
            event.preventDefault();
            showSection(this.dataset.section);
            if (isCompactNav()) {
                setMobileNavOpen(false);
            }
        });
    });

    syncCompactNavState();
    const initialHash = window.location.hash.substring(1);
    showSection(initialHash || 'profile', false, { immediate: true });
    ensureVisibleActiveSection(initialHash || 'profile');

    window.addEventListener('hashchange', () => {
        const nextHash = window.location.hash.substring(1) || 'profile';
        if (nextHash === activeSectionId) return;
        showSection(nextHash, false);
        if (isCompactNav()) {
            setMobileNavOpen(false);
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            if (mobileNavOpen && isCompactNav()) {
                event.preventDefault();
                setMobileNavOpen(false);
                return;
            }
            event.preventDefault();
            closeSettingsSurface();
        }
    });
}
