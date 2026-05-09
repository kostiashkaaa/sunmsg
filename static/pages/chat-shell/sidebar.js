export function initChatShellSidebar() {
    const requestsShortcutBtn = document.getElementById('requestsShortcutBtn');
    const sidebar = document.getElementById('sidebar');
    const sidebarCollapseToggleBtn = document.getElementById('sidebarCollapseToggleBtn');
    const SIDEBAR_COLLAPSE_STORAGE_KEY = 'sun.sidebar.collapsed.v1';
    const COLLAPSE_LABEL = 'Сжать список чатов';
    const EXPAND_LABEL = 'Развернуть список чатов';
    const mobileSidebarQuery = typeof window.matchMedia === 'function'
        ? window.matchMedia('(max-width: 768px)')
        : null;

    function readPersistedSidebarCollapsedState() {
        try {
            return window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) === '1';
        } catch (_) {
            return false;
        }
    }

    function persistSidebarCollapsedState(collapsed) {
        try {
            window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, collapsed ? '1' : '0');
        } catch (_) {
            // Ignore storage availability issues.
        }
    }

    function syncSidebarCollapseToggleState(collapsed, isMobileViewport) {
        if (!sidebarCollapseToggleBtn) return;
        const appliedCollapsedState = !isMobileViewport && collapsed;
        const nextLabel = appliedCollapsedState ? EXPAND_LABEL : COLLAPSE_LABEL;
        sidebarCollapseToggleBtn.setAttribute('aria-pressed', appliedCollapsedState ? 'true' : 'false');
        sidebarCollapseToggleBtn.setAttribute('aria-label', nextLabel);
        sidebarCollapseToggleBtn.title = nextLabel;
    }

    let sidebarCollapsed = readPersistedSidebarCollapsedState();

    function applySidebarCollapsedState() {
        const isMobileViewport = Boolean(mobileSidebarQuery?.matches);
        if (sidebar) {
            sidebar.classList.toggle('sidebar--collapsed', !isMobileViewport && sidebarCollapsed);
        }
        syncSidebarCollapseToggleState(sidebarCollapsed, isMobileViewport);
    }

    function scheduleGroupLabelsUpdate() {
        // Group labels were removed from sidebar; keep a no-op for existing call sites.
    }

    function switchSidebarTab(tab) {
        const normalizedTab = ['all', 'requests'].includes(String(tab))
            ? String(tab)
            : 'all';
        const reqSection = document.getElementById('dialogRequestsSection');
        document.querySelectorAll('.sidebar-tab').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.tab === normalizedTab);
        });
        if (requestsShortcutBtn) {
            const requestsActive = normalizedTab === 'requests';
            requestsShortcutBtn.classList.toggle('active', requestsActive);
            requestsShortcutBtn.setAttribute('aria-pressed', requestsActive ? 'true' : 'false');
        }
        document.body.dataset.sidebarTab = normalizedTab;

        const contacts = document.querySelectorAll('#contactsList .contact-item');
        contacts.forEach((item) => {
            if (normalizedTab === 'all') {
                item.style.display = '';
            } else if (normalizedTab === 'requests') {
                item.style.display = 'none';
            }
        });

        if (normalizedTab === 'requests') {
            if (reqSection) {
                reqSection.style.display = '';
            }
        } else if (reqSection) {
            reqSection.style.display = 'none';
        }

        window.dispatchEvent(new CustomEvent('sun-sidebar-tab-changed', {
            detail: { tab: normalizedTab },
        }));
        scheduleGroupLabelsUpdate();
    }

    document.body.dataset.sidebarTab = String(
        document.querySelector('.sidebar-tab.active')?.getAttribute('data-tab') || 'all',
    );

    document.getElementById('sidebarTabs')?.addEventListener('click', (event) => {
        const button = event.target.closest('.sidebar-tab[data-tab]');
        if (!button) return;
        event.preventDefault();
        switchSidebarTab(button.dataset.tab || 'all');
    });

    requestsShortcutBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        const currentTab = String(document.body.dataset.sidebarTab || 'all');
        switchSidebarTab(currentTab === 'requests' ? 'all' : 'requests');
    });

    sidebarCollapseToggleBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        if (mobileSidebarQuery?.matches) return;
        sidebarCollapsed = !sidebarCollapsed;
        persistSidebarCollapsedState(sidebarCollapsed);
        applySidebarCollapsedState();
    });

    const handleSidebarViewportChange = () => applySidebarCollapsedState();
    if (mobileSidebarQuery) {
        if (typeof mobileSidebarQuery.addEventListener === 'function') {
            mobileSidebarQuery.addEventListener('change', handleSidebarViewportChange);
        } else if (typeof mobileSidebarQuery.addListener === 'function') {
            mobileSidebarQuery.addListener(handleSidebarViewportChange);
        }
    }

    function applyAvatarTints() {
        document.querySelectorAll('.contact-item .contact-avatar').forEach((avatar) => {
            if (avatar.querySelector('img')) return;
            if (avatar.hasAttribute('data-avatar-tint')) return;
            const name = (avatar.textContent || '').trim() || '?';
            let hash = 0;
            for (let i = 0; i < name.length; i += 1) {
                hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
            }
            avatar.setAttribute('data-avatar-tint', String(hash % 8));
        });
    }

    function updateSidebarTabCounts() {
        const unreadCountEl = document.getElementById('unreadTabCount');
        if (!unreadCountEl) return;
        let total = 0;
        document.querySelectorAll('#contactsList .contact-item .unread-badge').forEach((badge) => {
            if (badge.classList.contains('unread-badge--hidden')) return;
            if (badge.style.display === 'none') return;
            const count = Number.parseInt((badge.textContent || '').trim(), 10);
            if (Number.isFinite(count) && count > 0) total += count;
        });
        unreadCountEl.textContent = total > 0 ? total : '';
    }

    applyAvatarTints();
    if (window.MutationObserver) {
        const observer = new MutationObserver(() => applyAvatarTints());
        const list = document.getElementById('contactsList');
        if (list) observer.observe(list, { childList: true, subtree: true });
    }

    updateSidebarTabCounts();
    applySidebarCollapsedState();
    window.updateSidebarTabCounts = updateSidebarTabCounts;
    window.switchSidebarTab = switchSidebarTab;

    return {
        switchSidebarTab,
        updateSidebarTabCounts,
        scheduleGroupLabelsUpdate,
    };
}
