// keyboard-shortcuts.js — Telegram-like global hotkeys
//
//   Ctrl/Cmd + F            — focus sidebar search input
//   Escape                  — close topmost overlay (modal / drawer / lightbox / picker)
//   Ctrl/Cmd + ArrowUp      — switch to previous chat in sidebar
//   Ctrl/Cmd + ArrowDown    — switch to next chat in sidebar
//
// Shortcuts are no-ops when focus is in an editable field, EXCEPT for
// Escape (always processed) and chat-switch combos (require Ctrl/Cmd —
// won't conflict with normal text input).

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
    // \u0424\u043E\u043A\u0443\u0441 \u043D\u0430 \u0432\u0438\u0434\u0438\u043C\u043E\u043C \u043F\u043E\u043B\u0435 \u0430\u0432\u0442\u043E\u043C\u0430\u0442\u0438\u0447\u0435\u0441\u043A\u0438 \u043E\u0442\u043A\u0440\u044B\u0432\u0430\u0435\u0442 search-overlay (\u0441\u043C. search-overlay.js).
    input.focus();
    if (typeof input.select === 'function') {
        try { input.select(); } catch (_) { /* noop */ }
    }
    return true;
}

function closeTopmostOverlay() {
    // Order: lightbox → context menus / pickers → drawer → modal.
    // \u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u043C true \u0435\u0441\u043B\u0438 \u0447\u0442\u043E-\u0442\u043E \u0437\u0430\u043A\u0440\u044B\u043B\u0438 — \u0442\u043E\u0433\u0434\u0430 \u043D\u0435 \u043F\u0440\u043E\u0431\u0440\u0430\u0441\u044B\u0432\u0430\u0435\u043C \u0434\u0430\u043B\u044C\u0448\u0435.
    const lightbox = document.getElementById('lightbox');
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
    // direction: -1 (prev) / +1 (next)
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

export function initKeyboardShortcuts() {
    if (typeof document === 'undefined') return;
    if (document.documentElement.dataset.keyboardShortcutsBound === '1') return;
    document.documentElement.dataset.keyboardShortcutsBound = '1';

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

        // \u0414\u0430\u043B\u044C\u0448\u0435 — \u0442\u043E\u043B\u044C\u043A\u043E \u043C\u043E\u0434\u0438\u0444\u0438\u0446\u0438\u0440\u043E\u0432\u0430\u043D\u043D\u044B\u0435 \u043A\u043E\u043C\u0431\u0438\u043D\u0430\u0446\u0438\u0438, \u0447\u0442\u043E\u0431\u044B \u043D\u0435 \u043C\u0435\u0448\u0430\u0442\u044C
        // \u043E\u0431\u044B\u0447\u043D\u043E\u043C\u0443 \u0432\u0432\u043E\u0434\u0443 \u0432 textarea \u043A\u043E\u043C\u043F\u043E\u0437\u0435\u0440\u0430.
        if (!mod || altKey || shiftKey) return;

        if (key === 'f' || key === 'F' || key === '\u0430' || key === '\u0410') {
            // Ctrl+F: \u0442\u043E\u043B\u044C\u043A\u043E \u0435\u0441\u043B\u0438 \u043D\u0435 \u0440\u0435\u0434\u0430\u043A\u0442\u0438\u0440\u0443\u0435\u043C \u043A\u043E\u0434 \u0432 \u043A\u0430\u043A\u043E\u043C-\u0442\u043E \u043F\u043E\u043B\u0435 \u043A\u043E\u0434\u0430
            if (isEditableTarget(target)) {
                // \u0432 textarea — \u043F\u0443\u0441\u0442\u044C \u0440\u0430\u0431\u043E\u0442\u0430\u0435\u0442 \u0432\u0441\u0442\u0440\u043E\u0435\u043D\u043D\u044B\u0439 \u043F\u043E\u0438\u0441\u043A \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430
                return;
            }
            if (focusSidebarSearch()) {
                event.preventDefault();
            }
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
    }, { capture: false });
}

// \u042D\u043A\u0441\u043F\u043E\u0440\u0442\u0438\u0440\u0443\u0435\u043C helper'\u044B \u0434\u043B\u044F \u0442\u0435\u0441\u0442\u043E\u0432
export const __test__ = {
    isEditableTarget,
    closeTopmostOverlay,
    switchChat,
    focusSidebarSearch,
};
