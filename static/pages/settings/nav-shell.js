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
    const panelCloseBtn = document.getElementById('settingsPanelCloseBtn');
    const panelToolsEl = document.getElementById('settingsPanelTools');
    const settingsNavEl = document.getElementById('settingsNav');
    const settingsNavToggleEl = document.getElementById('settingsNavToggle');
    const settingsNavToggleLabelEl = document.getElementById('settingsNavToggleLabel');
    const settingsNavEditProfileBtnEl = document.getElementById('settingsNavEditProfileBtn');
    const settingsHeaderEditBtnEl = document.getElementById('settingsHeaderEditBtn');
    const settingsHeaderMoreBtnEl = document.getElementById('settingsHeaderMoreBtn');
    const settingsHeaderMenuEl = document.getElementById('settingsHeaderMenu');
    const settingsSearchInputEl = document.getElementById('settingsSearchInput');
    const settingsPanelBodyEl = document.querySelector('.settings-panel-body');
    const settingsOverlayFrameEl = document.getElementById('settingsOverlayFrame');
    const settingsSceneEl = document.getElementById('settingsPanelScene') || document.querySelector('.settings-scene');
    const settingsLayoutEl = document.querySelector('.settings-layout');
    const compactNavMedia = window.matchMedia('(max-width: 768px)');

    let mobileNavOpen = false;
    let activeSectionId = '';
    let activeNavKey = '';
    let sectionTransitionSeq = 0;
    let detailViewOpen = false;
    let headerMenuOpen = false;

    const sectionTitles = {
        profile: 'Изменить профиль',
        notifications: 'Уведомления',
        'data-memory': 'Данные и память',
        privacy: 'Конфиденциальность',
        language: 'Язык',
        'chat-behavior': 'Поведение чата',
        'sidebar-label': 'Верхний лейбл',
        'settings-transfer': 'Перенос настроек',
        account: 'Устройства',
        'account-danger': 'Аккаунт',
        'chat-style': 'Внешний вид',
        keys: 'Безопасность',
        support: 'Поддержка',
        integrations: 'Подключения',
    };
    const navKeyTitles = {
    };

    const sectionIdSet = new Set(Object.keys(sectionTitles));
    const homeSectionSet = new Set(['settings', 'home', 'menu']);
    const sectionAliases = {
        appearance: 'language',
    };

    function isHomeSection(value) {
        return homeSectionSet.has(String(value || '').trim().toLowerCase());
    }

    function getSettingsUxMode() {
        return compactNavMedia.matches ? 'mobile' : 'desktop';
    }

    function isCompactNav() {
        return getSettingsUxMode() === 'mobile';
    }

    function syncSettingsUxMode() {
        const mode = getSettingsUxMode();
        document.body.dataset.settingsUx = mode;
        if (settingsSceneEl) {
            settingsSceneEl.dataset.settingsUx = mode;
        }
    }

    function setMobileNavOpen(nextState) {
        if (!settingsNavEl || !settingsNavToggleEl) return;
        mobileNavOpen = !!nextState;
        settingsNavEl.classList.toggle('mobile-open', mobileNavOpen);
        settingsNavToggleEl.setAttribute('aria-expanded', mobileNavOpen ? 'true' : 'false');
    }

    function setHeaderMenuOpen(nextState) {
        if (!settingsHeaderMenuEl || !settingsHeaderMoreBtnEl) return;
        headerMenuOpen = !!nextState;
        settingsHeaderMenuEl.classList.toggle('settings-hidden', !headerMenuOpen);
        settingsHeaderMenuEl.setAttribute('aria-hidden', headerMenuOpen ? 'false' : 'true');
        settingsHeaderMoreBtnEl.setAttribute('aria-expanded', headerMenuOpen ? 'true' : 'false');
    }

    function resetDetailOuterScroll() {
        [
            settingsOverlayFrameEl,
            settingsSceneEl,
            settingsLayoutEl,
            settingsPanelBodyEl,
        ].forEach((el) => {
            if (el instanceof HTMLElement) {
                el.scrollTop = 0;
            }
        });
    }

    function setDetailView(nextState) {
        detailViewOpen = !!nextState;
        document.body.classList.toggle('settings-detail-open', detailViewOpen);
        document.body.classList.toggle('settings-home-open', !detailViewOpen);
        settingsNavEl?.classList.toggle('is-detail-open', detailViewOpen);
        settingsContentEl?.classList.toggle('is-detail-open', detailViewOpen);
        panelToolsEl?.classList.toggle('settings-hidden', detailViewOpen);
        if (detailViewOpen) {
            setHeaderMenuOpen(false);
            resetDetailOuterScroll();
        }
    }

    function prefersReducedMotion() {
        if (document.documentElement.classList.contains('perf-lite')) return true;
        const motionLevel = String(document.documentElement.getAttribute('data-motion-level') || 'full').toLowerCase();
        if (motionLevel !== 'lite') return false;
        return Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches);
    }

    function updateNavToggleLabel(activeItem, fallbackLabel = '') {
        if (!settingsNavToggleLabelEl) return;
        const label = activeItem?.querySelector('span:not(.nav-item-meta)')?.textContent?.trim()
            || activeItem?.textContent?.trim()
            || fallbackLabel
            || tr('Разделы');
        settingsNavToggleLabelEl.textContent = label;
    }

    function syncCompactNavState() {
        syncSettingsUxMode();
        if (!settingsNavEl || !settingsNavToggleEl) return;
        if (!isCompactNav()) {
            setMobileNavOpen(false);
        }
    }

    function runSearchFilter() {
        const query = String(settingsSearchInputEl?.value || '').trim().toLowerCase();
        const canFilterCards = String(settingsSearchInputEl?.dataset?.filterScope || '') === 'settings-cards';
        if (!canFilterCards) return;
        const cards = document.querySelectorAll('.settings-card');
        if (!cards.length) return;
        if (!query) {
            cards.forEach((card) => {
                card.hidden = false;
            });
            return;
        }
        cards.forEach((card) => {
            const cardText = String(card.textContent || '').toLowerCase();
            card.hidden = !cardText.includes(query);
        });
    }

    function syncSectionTitle(id, navKey = '') {
        if (!panelTitleEl) return;
        panelTitleEl.textContent = tr(navKeyTitles[navKey] || sectionTitles[id] || 'Настройки');
    }

    function syncSectionNav(id) {
        let activeItem = null;
        navItems.forEach((item) => {
            const navKey = String(item.dataset.navKey || item.dataset.section || '');
            const isActive = Boolean(activeNavKey)
                ? navKey === activeNavKey
                : (Boolean(id) && item.dataset.section === id);
            item.classList.toggle('active', isActive);
            if (isActive) {
                item.setAttribute('aria-current', 'page');
                activeItem = item;
            } else {
                item.removeAttribute('aria-current');
            }
        });
        const fallbackLabel = activeNavKey || id
            ? tr(navKeyTitles[activeNavKey] || sectionTitles[id] || 'Разделы')
            : '';
        updateNavToggleLabel(activeItem, fallbackLabel);
        if (activeItem && typeof activeItem.scrollIntoView === 'function') {
            activeItem.scrollIntoView({
                block: 'nearest',
                inline: 'nearest',
                behavior: 'auto',
            });
        }
    }

    function hideAllSections() {
        sections.forEach((section) => {
            section.style.display = 'none';
            section.classList.add('settings-hidden');
            section.classList.remove('section-active', 'section-entering', 'section-leaving');
        });
        if (settingsContentEl) {
            settingsContentEl.classList.remove('is-transitioning');
            settingsContentEl.style.minHeight = '';
        }
    }

    function runSectionSideEffects(id) {
        syncSectionTitle(id, activeNavKey);
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
        const sectionOutCompactX = getMotionDistanceTokenPx('--motion-distance-section-out-compact-x', 14);
        const sectionInCompactX = getMotionDistanceTokenPx('--motion-distance-section-in-compact-x', 18);
        const sectionOutDesktopDistance = 4;
        const sectionInDesktopDistance = 6;
        const outgoingEnd = compact
            ? `translate3d(-${sectionOutCompactX}px, 0, 0)`
            : 'translate3d(0, 4px, 0)';
        const incomingStart = compact
            ? `translate3d(${sectionInCompactX}px, 0, 0)`
            : 'translate3d(0, 6px, 0)';
        const outgoingDuration = Math.min(
            getVelocityAwareDurationMs(compact ? sectionOutCompactX : sectionOutDesktopDistance, {
                minToken: '--motion-duration-fast',
                maxToken: '--motion-duration-medium',
                fallbackMinMs: compact ? 90 : 80,
                fallbackMaxMs: compact ? 140 : 120,
            }),
            compact ? 140 : 120,
        );
        const incomingDuration = Math.min(
            getVelocityAwareDurationMs(compact ? sectionInCompactX : sectionInDesktopDistance, {
                minToken: '--motion-duration-fast',
                maxToken: '--motion-duration-emphasis',
                fallbackMinMs: compact ? 140 : 120,
                fallbackMaxMs: compact ? 210 : 170,
            }),
            compact ? 210 : 170,
        );
        const outgoingEasing = getMotionEasingToken('--motion-ease-exit', 'cubic-bezier(.32,0,.67,0)');
        const incomingEasing = getMotionEasingToken('--motion-ease-enter', 'cubic-bezier(.16,1,.3,1)');

        if (outgoing && typeof outgoing.animate === 'function') {
            outgoing.animate(
                [
                    { opacity: 1, transform: 'translate3d(0, 0, 0)' },
                    { opacity: 0, transform: outgoingEnd },
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
                { opacity: 0, transform: incomingStart },
                { opacity: 1, transform: 'translate3d(0, 0, 0)' },
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
            outgoing.classList.add('settings-hidden');
            outgoing.classList.remove('section-active', 'section-leaving');
        }
        if (incoming) {
            incoming.classList.remove('settings-hidden');
            incoming.classList.remove('section-entering');
            incoming.classList.add('section-active');
        }
        if (settingsContentEl) {
            settingsContentEl.classList.remove('is-transitioning');
            settingsContentEl.style.minHeight = '';
        }
    }

    function normalizeHashSection(hashValue) {
        const value = String(hashValue || '').trim().replace(/^#/, '');
        const resolvedValue = sectionAliases[value] || value;
        return sectionIdSet.has(resolvedValue) ? resolvedValue : '';
    }

    function showHome(pushState = true) {
        sectionTransitionSeq += 1;
        activeSectionId = '';
        activeNavKey = '';
        hideAllSections();
        syncSectionTitle('', '');
        syncSectionNav('');
        setDetailView(false);
        if (pushState) {
            history.pushState(null, null, '#settings');
        }
    }

    function showSection(id, pushState = true, { immediate = false, navKey = '', scrollTargetId = '' } = {}) {
        const resolvedId = normalizeHashSection(id) || 'profile';
        const target = document.getElementById(`section-${resolvedId}`) || document.getElementById('section-profile');
        if (!target) {
            showHome(pushState);
            return;
        }

        setDetailView(true);
        sectionTransitionSeq += 1;
        activeNavKey = navKey || resolvedId;
        runSectionSideEffects(resolvedId);
        const current = activeSectionId ? document.getElementById(`section-${activeSectionId}`) : null;
        const isSectionChange = activeSectionId !== resolvedId;

        if (!current || immediate || current === target) {
            sections.forEach((section) => {
                const isActive = section === target;
                section.style.display = isActive ? 'block' : 'none';
                section.classList.toggle('settings-hidden', !isActive);
                section.classList.toggle('section-active', isActive);
                section.classList.remove('section-entering', 'section-leaving');
            });
            if (settingsContentEl) {
                settingsContentEl.classList.remove('is-transitioning');
                settingsContentEl.style.minHeight = '';
            }
            if (!current && !immediate && isSectionChange) {
                animateSectionTransition(null, target);
            }
            activeSectionId = resolvedId;
        } else {
            if (settingsContentEl) {
                const currentHeight = current.offsetHeight || 0;
                target.style.display = 'block';
                target.classList.remove('settings-hidden');
                target.classList.remove('section-leaving');
                const nextHeight = target.offsetHeight || currentHeight;
                settingsContentEl.style.minHeight = `${Math.max(currentHeight, nextHeight)}px`;
                settingsContentEl.classList.add('is-transitioning');
            } else {
                target.style.display = 'block';
                target.classList.remove('settings-hidden');
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
            const transitionFallbackMs = isCompactNav() ? 240 : 190;
            Promise.all([
                waitForMotionEnd(current, transitionFallbackMs),
                waitForMotionEnd(target, transitionFallbackMs),
            ]).then(() => {
                if (transitionSeq !== sectionTransitionSeq) return;
                finalizeSectionTransition(current, target);
            });
            activeSectionId = resolvedId;
        }

        if (pushState) {
            history.pushState(null, null, `#${resolvedId}`);
        }

        if (isSectionChange && settingsContentEl) {
            settingsContentEl.scrollTop = 0;
        }

        if (scrollTargetId) {
            window.requestAnimationFrame(() => {
                const anchor = document.getElementById(scrollTargetId);
                if (!anchor) return;
                anchor.scrollIntoView({
                    block: 'start',
                    inline: 'nearest',
                    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
                });
            });
        }
    }

    function openSection(sectionId, { immediate = false, navKey = '', scrollTargetId = '' } = {}) {
        const normalized = normalizeHashSection(sectionId);
        if (!normalized) return;
        showSection(normalized, true, { immediate, navKey, scrollTargetId });
        if (isCompactNav()) {
            setMobileNavOpen(false);
        }
    }

    document.addEventListener('sun-settings-navigate', (event) => {
        const detail = event?.detail || {};
        const section = String(detail.section || '').trim();
        if (!section) return;
        if (isHomeSection(section)) {
            showHome(true);
            return;
        }
        openSection(section, {
            immediate: Boolean(detail.immediate),
            navKey: String(detail.navKey || section),
            scrollTargetId: String(detail.scrollTargetId || ''),
        });
    });

    settingsNavEditProfileBtnEl?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        openSection('profile', { navKey: 'profile' });
    });
    settingsHeaderEditBtnEl?.addEventListener('click', (event) => {
        event.preventDefault();
        openSection('profile', { navKey: 'profile' });
    });
    settingsHeaderMoreBtnEl?.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        setHeaderMenuOpen(!headerMenuOpen);
    });

    if (settingsNavToggleEl) {
        settingsNavToggleEl.addEventListener('click', () => {
            setMobileNavOpen(!mobileNavOpen);
        });
    }

    settingsSearchInputEl?.addEventListener('input', runSearchFilter);
    settingsSearchInputEl?.addEventListener('search', runSearchFilter);

    if (typeof compactNavMedia.addEventListener === 'function') {
        compactNavMedia.addEventListener('change', syncCompactNavState);
    } else if (typeof compactNavMedia.addListener === 'function') {
        compactNavMedia.addListener(syncCompactNavState);
    }

    document.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Node)) return;

        if (
            headerMenuOpen
            && settingsHeaderMenuEl
            && settingsHeaderMoreBtnEl
            && !settingsHeaderMenuEl.contains(target)
            && !settingsHeaderMoreBtnEl.contains(target)
        ) {
            setHeaderMenuOpen(false);
        }

        if (!mobileNavOpen || !isCompactNav() || !settingsNavEl) return;
        if (settingsNavEl.contains(target)) return;
        setMobileNavOpen(false);
    });

    navItems.forEach((item) => {
        item.addEventListener('click', function (event) {
            event.preventDefault();
            openSection(this.dataset.section, {
                navKey: String(this.dataset.navKey || this.dataset.section || ''),
                scrollTargetId: String(this.dataset.scrollTarget || ''),
            });
        });
    });

    panelCloseBtn?.addEventListener('click', (event) => {
        if (!detailViewOpen) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        showHome(true);
    }, true);

    syncCompactNavState();
    const initialSection = normalizeHashSection(window.location.hash.substring(1));
    if (initialSection) {
        showSection(initialSection, false, { immediate: true, navKey: initialSection });
    } else {
        showHome(false);
    }

    window.addEventListener('hashchange', () => {
        const nextSection = normalizeHashSection(window.location.hash.substring(1));
        if (!nextSection) {
            if (detailViewOpen) showHome(false);
            return;
        }
        if (nextSection === activeSectionId && detailViewOpen) return;
        showSection(nextSection, false, { navKey: nextSection });
        if (isCompactNav()) {
            setMobileNavOpen(false);
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        if (headerMenuOpen) {
            event.preventDefault();
            setHeaderMenuOpen(false);
            return;
        }
        if (mobileNavOpen && isCompactNav()) {
            event.preventDefault();
            setMobileNavOpen(false);
            return;
        }
        if (detailViewOpen) {
            event.preventDefault();
            showHome(true);
            return;
        }
        event.preventDefault();
        closeSettingsSurface();
    });
}
