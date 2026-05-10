// Sidebar search overlay.
//
// \u0420\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u043F\u043E\u0432\u0435\u0440\u0445 \u0441\u0443\u0449\u0435\u0441\u0442\u0432\u0443\u044E\u0449\u0435\u0433\u043E DOM \u043A\u043E\u043C\u0430\u043D\u0434-\u043F\u0430\u043B\u0438\u0442\u0440\u044B: \u043F\u0435\u0440\u0435\u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442 \u044D\u043B\u0435\u043C\u0435\u043D\u0442\u044B
// #searchUserInput, #searchUserResults, #paletteLocalSection, #paletteLocalResults
// \u0438 #commandPaletteActions, \u0447\u0442\u043E\u0431\u044B \u043D\u0435 \u043B\u043E\u043C\u0430\u0442\u044C \u043E\u0431\u0440\u0430\u0431\u043E\u0442\u0447\u0438\u043A\u0438, \u043D\u0430\u0432\u0435\u0448\u0430\u043D\u043D\u044B\u0435 \u0432 chat.js.
//
// \u0412\u0438\u0434\u0438\u043C\u043E\u0435 \u043F\u043E\u043B\u0435 — #searchInput \u0432 \u0448\u0430\u043F\u043A\u0435 \u0441\u0430\u0439\u0434\u0431\u0430\u0440\u0430. \u041B\u044E\u0431\u043E\u0439 \u0432\u0432\u043E\u0434 \u0432 \u043D\u0435\u0433\u043E \u0437\u0435\u0440\u043A\u0430\u043B\u0438\u0442\u0441\u044F
// \u0432 \u0441\u043A\u0440\u044B\u0442\u044B\u0439 #searchUserInput \u0438 \u0442\u0440\u0438\u0433\u0433\u0435\u0440\u0438\u0442 input-\u0441\u043E\u0431\u044B\u0442\u0438\u0435, \u043A\u043E\u0442\u043E\u0440\u043E\u0435 \u0443\u0436\u0435 \u0441\u043B\u0443\u0448\u0430\u0435\u0442
// chat.js (renderPaletteLocalMatches + fetch /search_users).

import {
    afterNextFrame,
    animateSearchPanelEntry,
    applyListPerfGuard,
    applyStaggerToChildren,
    waitForMotionEnd,
} from './motion.js';

const OPEN_CLASS = 'is-open';
const OPENING_CLASS = 'is-opening';
const CLOSING_CLASS = 'is-closing';
const SIDEBAR_DIMMED_CLASS = 'has-search-overlay';
const PANEL_ORDER = ['chats', 'contacts', 'actions', 'media', 'links', 'files', 'music', 'voice'];

export function initSearchOverlay() {
    const overlay = document.getElementById('newChatModal');
    const sidebar = document.getElementById('sidebar');
    const sidebarTopCard = sidebar?.querySelector('.sidebar-top-card');
    const visibleInput = document.getElementById('searchInput');
    const hiddenInput = document.getElementById('searchUserInput');
    const clearBtn = document.getElementById('searchClearBtn');
    const wrapper = document.getElementById('searchInputWrapper');
    const localSection = document.getElementById('paletteLocalSection');
    const localResults = document.getElementById('paletteLocalResults');
    const remoteResults = document.getElementById('searchUserResults');

    if (!overlay || !sidebar || !sidebarTopCard || !visibleInput || !hiddenInput) {
        return null;
    }

    const fallbackPlaceholder = String(visibleInput.getAttribute('placeholder') || 'Поиск');
    function tr(value) {
        const i18nApi = window.SUN_I18N;
        if (i18nApi && typeof i18nApi.translateText === 'function') {
            return i18nApi.translateText(value);
        }
        return String(value ?? '');
    }
    function syncSearchNetworkState() {
        const offline = navigator.onLine === false;
        wrapper?.setAttribute('data-network-state', offline ? 'offline' : 'online');
        const activeValue = String(visibleInput.value || '').trim();
        const onlinePlaceholder = String(tr('Поиск') || fallbackPlaceholder);
        if (offline && !activeValue) {
            visibleInput.setAttribute('placeholder', tr('Нет сети'));
        } else {
            visibleInput.setAttribute('placeholder', onlinePlaceholder);
        }
    }

    // \u041F\u0435\u0440\u0435\u043C\u0435\u0449\u0430\u0435\u043C overlay \u0438\u0437 \u043A\u043E\u043D\u0446\u0430 \u0434\u043E\u043A\u0443\u043C\u0435\u043D\u0442\u0430 \u0432 \u0441\u0430\u0439\u0434\u0431\u0430\u0440, \u043F\u043E\u0434 top-card.
    if (overlay.parentElement !== sidebar) {
        sidebar.insertBefore(overlay, sidebarTopCard.nextSibling);
    }
    overlay.hidden = true;
    overlay.setAttribute('aria-hidden', 'true');

    // \u0417\u0430\u043C\u0435\u0440 \u0432\u044B\u0441\u043E\u0442\u044B top-card → CSS-\u043F\u0435\u0440\u0435\u043C\u0435\u043D\u043D\u0430\u044F, \u0447\u0442\u043E\u0431\u044B overlay \u043D\u0430\u0447\u0438\u043D\u0430\u043B\u0441\u044F \u0440\u043E\u0432\u043D\u043E
    // \u043F\u043E\u0434 \u043F\u043E\u043B\u0435\u043C \u043F\u043E\u0438\u0441\u043A\u0430. Top-card \u043C\u043E\u0436\u0435\u0442 \u0440\u0430\u0441\u0442\u0438/\u0441\u0436\u0438\u043C\u0430\u0442\u044C\u0441\u044F (\u0432\u043A\u043B\u0430\u0434\u043A\u0438, \u0431\u0440\u0435\u043D\u0434),
    // \u043F\u043E\u044D\u0442\u043E\u043C\u0443 \u043F\u0435\u0440\u0435\u0441\u0447\u0438\u0442\u044B\u0432\u0430\u0435\u043C \u0447\u0435\u0440\u0435\u0437 ResizeObserver.
    // Overlay \u0434\u043E\u043B\u0436\u0435\u043D «\u0437\u0430\u043C\u0435\u0449\u0430\u0442\u044C» \u0432\u043A\u043B\u0430\u0434\u043A\u0438 \u0441\u0430\u0439\u0434\u0431\u0430\u0440\u0430 (\u0412\u0441\u0435/\u041D\u0435\u043F\u0440\u043E\u0447\u0438\u0442\u0430\u043D\u043D\u044B\u0435/\u0418\u0437\u0431\u0440\u0430\u043D\u043D\u043E\u0435)
    // \u0441\u0432\u043E\u0438\u043C\u0438 (\u0427\u0430\u0442\u044B/\u041A\u043E\u043D\u0442\u0430\u043A\u0442\u044B/\u0414\u0435\u0439\u0441\u0442\u0432\u0438\u044F), \u043F\u043E\u044D\u0442\u043E\u043C\u0443 \u0441\u0447\u0438\u0442\u0430\u0435\u043C \u0432\u044B\u0441\u043E\u0442\u0443 top-card \u0411\u0415\u0417
    // \u0441\u0430\u0439\u0434\u0431\u0430\u0440-\u0432\u043A\u043B\u0430\u0434\u043E\u043A — overlay \u0441\u0442\u0430\u0440\u0442\u0443\u0435\u0442 \u043F\u0440\u044F\u043C\u043E \u043F\u043E\u0434 \u043F\u043E\u043B\u0435\u043C \u043F\u043E\u0438\u0441\u043A\u0430 \u0438 \u0435\u0433\u043E \u0441\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u044B\u0435
    // tabs \u043B\u043E\u0436\u0430\u0442\u0441\u044F \u0440\u043E\u0432\u043D\u043E \u0442\u0443\u0434\u0430, \u0433\u0434\u0435 \u0431\u044B\u043B\u0438 sidebar-tabs.
    const sidebarTabsEl = document.getElementById('sidebarTabs');
    function syncTopCardHeight() {
        const cardRect = sidebarTopCard.getBoundingClientRect();
        let height = cardRect.height;
        if (sidebarTabsEl && sidebarTabsEl.parentElement === sidebarTopCard) {
            const tabsRect = sidebarTabsEl.getBoundingClientRect();
            // \u0412\u044B\u0447\u0438\u0442\u0430\u0435\u043C \u0432\u044B\u0441\u043E\u0442\u0443 \u0441\u0430\u0439\u0434\u0431\u0430\u0440-\u0432\u043A\u043B\u0430\u0434\u043E\u043A + \u0438\u0445 margin-top (6px \u043F\u043E \u0434\u0438\u0437\u0430\u0439\u043D\u0443).
            height = Math.max(0, height - tabsRect.height - 6);
        }
        sidebar.style.setProperty('--sidebar-top-card-height', `${Math.round(height)}px`);
    }
    syncTopCardHeight();
    if (typeof ResizeObserver !== 'undefined') {
        const ro = new ResizeObserver(syncTopCardHeight);
        ro.observe(sidebarTopCard);
        if (sidebarTabsEl) ro.observe(sidebarTabsEl);
    } else {
        window.addEventListener('resize', syncTopCardHeight);
    }

    const tabs = Array.from(overlay.querySelectorAll('[data-search-tab]'));
    const tabsScroller = overlay.querySelector('.search-overlay__tabs');
    const panels = Array.from(overlay.querySelectorAll('[data-search-panel]'));

    let isOpen = false;
    let activeTab = 'chats';
    let autoSwitchTimer = 0;
    let lastQuery = '';
    let transitionSeq = 0;
    let resultsObserver = null;

    function getPanel(tabId) {
        return panels.find((panel) => panel.getAttribute('data-search-panel') === tabId) || null;
    }

    function getPanelDirection(fromTab, toTab) {
        const fromIndex = PANEL_ORDER.indexOf(fromTab);
        const toIndex = PANEL_ORDER.indexOf(toTab);
        if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) return 1;
        return toIndex > fromIndex ? 1 : -1;
    }

    function setTab(tabId, { userInitiated = false } = {}) {
        if (!tabId) return;
        const previousTab = activeTab;
        const previousPanel = getPanel(previousTab);
        const nextPanel = getPanel(tabId);
        activeTab = tabId;
        tabs.forEach((tab) => {
            const isActive = tab.getAttribute('data-search-tab') === tabId;
            tab.classList.toggle('is-active', isActive);
            tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
        panels.forEach((panel) => {
            panel.hidden = panel !== nextPanel;
        });
        if (nextPanel && previousPanel !== nextPanel) {
            animateSearchPanelEntry(nextPanel, getPanelDirection(previousTab, tabId));
            applyStaggerToChildren(nextPanel, { selector: ':scope > *' });
        }
        if (userInitiated && tabId === 'contacts' && hiddenInput.value.trim().length >= 3) {
            // \u0422\u0440\u0438\u0433\u0433\u0435\u0440\u0438\u043C \u043F\u043E\u0432\u0442\u043E\u0440\u043D\u044B\u0439 \u043F\u043E\u0438\u0441\u043A, \u0435\u0441\u043B\u0438 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C \u0441\u0430\u043C \u043F\u0435\u0440\u0435\u0448\u0451\u043B \u043D\u0430 «\u041A\u043E\u043D\u0442\u0430\u043A\u0442\u044B».
            hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        overlay.dispatchEvent(new CustomEvent('sun-search-overlay-tab-changed', {
            detail: { tabId, userInitiated: Boolean(userInitiated) },
        }));
    }

    function open() {
        if (isOpen && !overlay.classList.contains(CLOSING_CLASS)) return;
        const openSeq = ++transitionSeq;
        isOpen = true;
        overlay.hidden = false;
        overlay.removeAttribute('hidden');
        overlay.classList.remove(CLOSING_CLASS);
        overlay.classList.add(OPENING_CLASS);
        overlay.setAttribute('aria-hidden', 'false');
        sidebar.classList.add(SIDEBAR_DIMMED_CLASS);
        if (clearBtn) clearBtn.hidden = false;
        const hasQuery = String(visibleInput.value || '').trim().length > 0;
        setTab(hasQuery ? 'chats' : 'actions');
        const activePanel = getPanel(activeTab);
        if (activePanel) {
            applyStaggerToChildren(activePanel, { selector: ':scope > *' });
        }
        syncOverlayPerfGuards();
        afterNextFrame(() => {
            if (openSeq !== transitionSeq) return;
            overlay.classList.add(OPEN_CLASS);
            overlay.classList.remove(OPENING_CLASS);
        });
    }

    function close({ keepValue = false, focusTrigger = false } = {}) {
        if (!isOpen) {
            overlay.hidden = true;
            overlay.setAttribute('hidden', '');
            overlay.setAttribute('aria-hidden', 'true');
            if (!keepValue) resetValue();
            return;
        }
        const closeSeq = ++transitionSeq;
        isOpen = false;
        overlay.classList.remove(OPEN_CLASS, OPENING_CLASS);
        overlay.classList.add(CLOSING_CLASS);
        overlay.setAttribute('aria-hidden', 'true');
        clearAutoSwitch();
        waitForMotionEnd(overlay, 320).then(() => {
            if (closeSeq !== transitionSeq || isOpen) return;
            overlay.classList.remove(CLOSING_CLASS);
            overlay.hidden = true;
            overlay.setAttribute('hidden', '');
            sidebar.classList.remove(SIDEBAR_DIMMED_CLASS);
            if (clearBtn) clearBtn.hidden = true;
            if (!keepValue) resetValue();
            if (focusTrigger) {
                try { visibleInput.blur(); } catch (_) {}
            }
        });
    }

    function resetValue() {
        if (visibleInput.value !== '') visibleInput.value = '';
        if (hiddenInput.value !== '') {
            hiddenInput.value = '';
            hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
        }
        lastQuery = '';
        syncSearchNetworkState();
    }

    function clearAutoSwitch() {
        if (autoSwitchTimer) {
            window.clearTimeout(autoSwitchTimer);
            autoSwitchTimer = 0;
        }
    }

    function scheduleAutoSwitchToContacts(query) {
        clearAutoSwitch();
        if (query.length < 3) return;
        autoSwitchTimer = window.setTimeout(() => {
            // \u0415\u0441\u043B\u0438 \u0430\u043A\u0442\u0438\u0432\u043D\u0430 \u0432\u043A\u043B\u0430\u0434\u043A\u0430 «\u0427\u0430\u0442\u044B» \u0438 \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E \u043D\u0438\u0447\u0435\u0433\u043E \u043D\u0435 \u043D\u0430\u0448\u043B\u0438 — \u043F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0430\u0435\u043C\u0441\u044F.
            if (activeTab !== 'chats') return;
            const hasLocal = localSection && localSection.style.display !== 'none'
                && localResults && localResults.children.length > 0;
            if (!hasLocal) setTab('contacts');
        }, 600);
    }

    function syncQuery() {
        const value = visibleInput.value;
        if (value === lastQuery) return;
        lastQuery = value;
        hiddenInput.value = value;
        hiddenInput.dispatchEvent(new Event('input', { bubbles: true }));
        syncOverlayPerfGuards();
        const trimmed = value.trim();
        if (!trimmed) {
            setTab('chats');
            clearAutoSwitch();
        } else if (activeTab === 'actions') {
            setTab('chats');
            scheduleAutoSwitchToContacts(trimmed);
        } else {
            scheduleAutoSwitchToContacts(trimmed);
        }
        syncSearchNetworkState();
    }

    visibleInput.addEventListener('focus', () => open());
    visibleInput.addEventListener('click', () => open());
    visibleInput.addEventListener('input', syncQuery);
    visibleInput.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            close({ focusTrigger: true });
        }
    });

    clearBtn?.addEventListener('click', (event) => {
        event.preventDefault();
        if (visibleInput.value) {
            resetValue();
            visibleInput.focus();
            setTab('chats');
        } else {
            close({ focusTrigger: true });
        }
    });

    tabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            setTab(tab.getAttribute('data-search-tab'), { userInitiated: true });
        });
    });

    tabsScroller?.addEventListener('wheel', (event) => {
        const hasOverflowX = tabsScroller.scrollWidth > tabsScroller.clientWidth + 1;
        if (!hasOverflowX) return;

        const deltaMode = Number(event.deltaMode) || 0;
        const unit = deltaMode === 1
            ? 16
            : (deltaMode === 2 ? tabsScroller.clientWidth : 1);
        const deltaX = Number(event.deltaX || 0) * unit;
        const deltaY = Number(event.deltaY || 0) * unit;
        const primaryDelta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
        if (!Number.isFinite(primaryDelta) || primaryDelta === 0) return;

        const before = tabsScroller.scrollLeft;
        tabsScroller.scrollLeft += primaryDelta;
        if (tabsScroller.scrollLeft !== before) {
            event.preventDefault();
        }
    }, { passive: false });

    function syncOverlayPerfGuards() {
        applyListPerfGuard(localResults);
        applyListPerfGuard(remoteResults);
        const activePanel = getPanel(activeTab);
        if (activePanel) {
            applyListPerfGuard(activePanel, { total: activePanel.children.length });
        }
    }

    if (typeof MutationObserver !== 'undefined') {
        resultsObserver = new MutationObserver(() => {
            if (!isOpen) return;
            syncOverlayPerfGuards();
        });
        if (localResults) resultsObserver.observe(localResults, { childList: true });
        if (remoteResults) resultsObserver.observe(remoteResults, { childList: true });
    }

    document.addEventListener('pointerdown', (event) => {
        if (!isOpen) return;
        const target = event.target;
        if (!(target instanceof Element)) return;
        if (target.closest('#newChatModal')) return;
        if (target.closest('#searchInputWrapper')) return;
        // \u041A\u043B\u0438\u043A \u0432\u043D\u0435 overlay \u0438 \u043F\u043E\u043B\u044F — \u0437\u0430\u043A\u0440\u044B\u0432\u0430\u0435\u043C (\u043D\u043E \u041D\u0415 \u0441\u0431\u0440\u0430\u0441\u044B\u0432\u0430\u0435\u043C \u0437\u043D\u0430\u0447\u0435\u043D\u0438\u0435, \u0435\u0441\u043B\u0438
        // \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044C, \u043D\u0430\u043F\u0440\u0438\u043C\u0435\u0440, \u0442\u0430\u043F\u043D\u0443\u043B \u043F\u043E \u043A\u043E\u043D\u0442\u0430\u043A\u0442\u0443 \u0432 \u0440\u0435\u0437\u0443\u043B\u044C\u0442\u0430\u0442\u0430\u0445? \u0417\u0434\u0435\u0441\u044C —
        // \u0432\u043D\u0435 overlay, \u0437\u043D\u0430\u0447\u0438\u0442, \u0432 \u0447\u0430\u0442-\u0437\u043E\u043D\u0443 \u0438\u043B\u0438 \u0441\u0430\u0439\u0434\u0431\u0430\u0440 — \u0441\u0442\u0430\u043D\u0434\u0430\u0440\u0442\u043D\u043E\u0435 \u0437\u0430\u043A\u0440\u044B\u0442\u0438\u0435).
        close();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape' || !isOpen) return;
        // \u041D\u0435 \u043F\u0435\u0440\u0435\u0445\u0432\u0430\u0442\u044B\u0432\u0430\u0435\u043C Escape, \u0435\u0441\u043B\u0438 \u043E\u0442\u043A\u0440\u044B\u0442 \u0434\u0438\u0430\u043B\u043E\u0433/\u043B\u0430\u0439\u0442\u0431\u043E\u043A\u0441 — \u043F\u0443\u0441\u0442\u044C \u0435\u0433\u043E \u043E\u0431\u0440\u0430\u0431\u0430\u0442\u044B\u0432\u0430\u044E\u0442 \u0441\u043D\u0430\u0447\u0430\u043B\u0430 \u043E\u043D\u0438.
        if (document.querySelector('dialog[open]')) return;
        if (document.getElementById('lightbox')?.classList.contains('active')) return;
        event.preventDefault();
        close({ focusTrigger: true });
    });

    window.addEventListener('online', syncSearchNetworkState);
    window.addEventListener('offline', syncSearchNetworkState);
    window.addEventListener('sun-ui-language-changed', syncSearchNetworkState);
    syncSearchNetworkState();

    // \u041F\u043E\u0434\u0434\u0435\u0440\u0436\u043A\u0430 \u043F\u0440\u0435\u0436\u043D\u0435\u0433\u043E API: window.openCommandPalette(prefill).
    window.closeCommandPalette = function () { close(); };
    window.openCommandPalette = function (prefill = '') {
        open();
        if (typeof prefill === 'string' && prefill !== visibleInput.value) {
            visibleInput.value = prefill;
            syncQuery();
        }
        try { visibleInput.focus({ preventScroll: true }); } catch (_) {}
    };

    return {
        open,
        close,
        setTab,
        syncOverlayPerfGuards,
    };
}

