export function initChatShellSidebar() {
    const requestsShortcutBtn = document.getElementById('requestsShortcutBtn');

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
    window.updateSidebarTabCounts = updateSidebarTabCounts;
    window.switchSidebarTab = switchSidebarTab;

    return {
        switchSidebarTab,
        updateSidebarTabCounts,
        scheduleGroupLabelsUpdate,
    };
}
