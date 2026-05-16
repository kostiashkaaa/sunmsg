// keyboard-shortcuts.js — messenger-like global hotkeys
//
//   Ctrl/Cmd + F            — focus sidebar search input
//   Ctrl/Cmd + Shift + F    — open in-chat message search
//   Escape                  — close topmost overlay (modal / drawer / lightbox / picker)
//   Ctrl/Cmd + ArrowUp      — switch to previous chat in sidebar
//   Ctrl/Cmd + ArrowDown    — switch to next chat in sidebar
//
//   Message actions (when a message is hovered / last interacted):
//   R                       — reply to message
//   E                       — edit own message
//   F                       — forward message
//   Delete / Backspace      — delete message

import { waitForMotionEnd } from './motion.js';

const EDITABLE_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

function isEditableTarget(target) {
    if (!target) return false;
    if (EDITABLE_TAGS.has(target.tagName)) return true;
    if (target.isContentEditable) return true;
    return false;
}

function focusSidebarSearch() {
    const input = document.getElementById('searchInput');
    if (!input) return false;
    input.focus();
    if (typeof input.select === 'function') {
        try { input.select(); } catch (_) { /* noop */ }
    }
    return true;
}

function openInChatSearch() {
    const searchBtn = document.getElementById('searchChatBtn');
    if (!searchBtn) return false;
    const headerSearchWrap = document.getElementById('headerSearchWrap');
    if (headerSearchWrap?.classList.contains('active')) {
        document.getElementById('headerSearchInput')?.focus();
        return true;
    }
    searchBtn.click();
    return true;
}

function closeTopmostOverlay() {
    const lightbox = document.getElementById('lightbox');
    const settingsOverlay = document.getElementById('settingsOverlay');
    if (settingsOverlay?.classList.contains('active')) {
        if (typeof window.closeSettingsOverlay === 'function') {
            window.closeSettingsOverlay();
        } else {
            settingsOverlay.classList.remove('active');
        }
        return true;
    }
    if (lightbox && lightbox.classList.contains('active')) {
        lightbox.classList.remove('active');
        return true;
    }
    const openPicker = document.querySelector(
        '.emoji-picker.active, .emoji-picker.is-open, '
        + '#messageContextMenu.is-open, .reaction-picker.active, '
        + '.profile-more-menu.is-open'
    );
    if (openPicker) {
        openPicker.classList.remove('active', 'is-open');
        return true;
    }
    const drawer = document.querySelector(
        '.partner-profile-drawer.is-open, #partnerProfileDrawer.is-open, '
        + '[data-profile-drawer].is-open'
    );
    if (drawer) {
        drawer.classList.remove('is-open');
        drawer.dispatchEvent(new CustomEvent('overlay:close', { bubbles: true }));
        return true;
    }
    const modalDialog = document.querySelector('dialog[open]');
    if (modalDialog && typeof modalDialog.close === 'function') {
        modalDialog.classList.add('is-closing');
        waitForMotionEnd(modalDialog, 160).then(() => {
            try { modalDialog.close(); } catch (_) { /* noop */ }
            modalDialog.classList.remove('is-closing');
        });
        return true;
    }
    const customModal = document.querySelector(
        '#captionModal.is-open, #keyRestoreModal.is-open'
    );
    if (customModal) {
        customModal.classList.remove('is-open');
        customModal.classList.add('is-closing');
        waitForMotionEnd(customModal, 160).then(() => {
            customModal.classList.remove('is-closing');
        });
        return true;
    }
    return false;
}

function switchChat(direction) {
    const list = document.getElementById('contactsList');
    if (!list) return false;
    const items = Array.from(
        list.querySelectorAll('.contact-item:not([style*="display: none"])')
    ).filter((el) => el.offsetParent !== null);
    if (items.length === 0) return false;

    const activeIndex = items.findIndex((el) => el.classList.contains('active'));
    let nextIndex;
    if (activeIndex === -1) {
        nextIndex = direction > 0 ? 0 : items.length - 1;
    } else {
        nextIndex = (activeIndex + direction + items.length) % items.length;
    }
    const next = items[nextIndex];
    if (!next) return false;
    next.click();
    next.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    return true;
}

function dispatchMessageShortcut(action, msgId) {
    if (!msgId) return false;
    document.dispatchEvent(new CustomEvent('sun:message-shortcut', {
        bubbles: false,
        detail: { action, msgId },
    }));
    return true;
}

function resolveHoveredMessageId() {
    // Try element under pointer first (stored by mouseover listener)
    const msgEl = document.querySelector('.message:hover')
        || document.querySelector('.message[data-kb-focus]');
    if (!msgEl) return null;
    const rawId = msgEl.getAttribute('data-msg-id');
    const id = Number(rawId);
    return Number.isFinite(id) && id > 0 ? id : null;
}

export function initKeyboardShortcuts() {
    if (typeof document === 'undefined') return;
    if (document.documentElement.dataset.keyboardShortcutsBound === '1') return;
    document.documentElement.dataset.keyboardShortcutsBound = '1';

    // Track last hovered message for keyboard shortcuts
    const chatMessages = document.getElementById('chatMessages');
    if (chatMessages) {
        chatMessages.addEventListener('mouseover', (e) => {
            const msgEl = e.target.closest('.message');
            chatMessages.querySelectorAll('.message[data-kb-focus]').forEach(m => {
                m.removeAttribute('data-kb-focus');
            });
            if (msgEl) msgEl.setAttribute('data-kb-focus', '1');
        }, { passive: true });
    }

    document.addEventListener('keydown', (event) => {
        const { key, ctrlKey, metaKey, altKey, shiftKey, target } = event;
        const mod = ctrlKey || metaKey;

        if (key === 'Escape') {
            if (closeTopmostOverlay()) {
                event.preventDefault();
                event.stopPropagation();
            }
            return;
        }

        // Ctrl/Cmd+Shift+F — in-chat search
        if (mod && shiftKey && (key === 'f' || key === 'F' || key === 'а' || key === 'А')) {
            event.preventDefault();
            openInChatSearch();
            return;
        }

        // Ctrl/Cmd shortcuts (no shift)
        if (mod && !altKey && !shiftKey) {
            if (key === 'f' || key === 'F' || key === 'а' || key === 'А') {
                if (isEditableTarget(target)) return;
                if (focusSidebarSearch()) event.preventDefault();
                return;
            }
            if (key === 'ArrowUp') {
                if (switchChat(-1)) event.preventDefault();
                return;
            }
            if (key === 'ArrowDown') {
                if (switchChat(+1)) event.preventDefault();
                return;
            }
            return;
        }

        // Bare key shortcuts — only outside editable fields
        if (mod || altKey || isEditableTarget(target)) return;

        // Any overlay open? Don't steal keys
        const hasOpenOverlay = Boolean(
            document.querySelector(
                '#messageContextMenu.is-open, .emoji-picker.is-open, '
                + '.reaction-picker.active, dialog[open], .partner-profile-drawer.is-open'
            )
        );
        if (hasOpenOverlay) return;

        // Must have an active chat
        const chatArea = document.getElementById('chatArea');
        if (!chatArea || chatArea.hidden || chatArea.classList.contains('hidden')) return;

        if (key === 'r' || key === 'R' || key === 'к' || key === 'К') {
            const msgId = resolveHoveredMessageId();
            if (msgId && dispatchMessageShortcut('reply', msgId)) event.preventDefault();
            return;
        }
        if (key === 'e' || key === 'E' || key === 'у' || key === 'У') {
            const msgId = resolveHoveredMessageId();
            if (msgId && dispatchMessageShortcut('edit', msgId)) event.preventDefault();
            return;
        }
        if (key === 'f' || key === 'F' || key === 'а' || key === 'А') {
            const msgId = resolveHoveredMessageId();
            if (msgId && dispatchMessageShortcut('forward', msgId)) event.preventDefault();
            return;
        }
        if (key === 'Delete' || key === 'Backspace') {
            const msgId = resolveHoveredMessageId();
            if (msgId && dispatchMessageShortcut('delete', msgId)) event.preventDefault();
            return;
        }
    }, { capture: false });
}

// Export helpers for tests
export const __test__ = {
    isEditableTarget,
    closeTopmostOverlay,
    switchChat,
    focusSidebarSearch,
    openInChatSearch,
    resolveHoveredMessageId,
};
