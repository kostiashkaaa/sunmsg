// confirm-dialog.js — \u0443\u043D\u0438\u0432\u0435\u0440\u0441\u0430\u043B\u044C\u043D\u044B\u0439 \u043C\u043E\u0434\u0430\u043B \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u044F \u0432 \u0441\u0442\u0438\u043B\u0435 \u043F\u0440\u043E\u0435\u043A\u0442\u0430.
// \u0412\u043E\u0437\u0432\u0440\u0430\u0449\u0430\u0435\u0442 Promise<boolean>: true \u043F\u0440\u0438 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043D\u0438\u0438, false \u043F\u0440\u0438 \u043E\u0442\u043C\u0435\u043D\u0435.

import { openAnimatedDialog, closeAnimatedDialog } from './chat-shell-ui.js';
import { STANDARD_SINGLE_CHECK_UI_HTML } from './check-glyph.js';

let pendingResolve = null;
let initialized = false;

const ICON_MAP = {
    danger: 'bi-exclamation-triangle',
    warning: 'bi-exclamation-circle',
    block: 'bi-slash-circle',
    unblock: '__sun-check__',
    info: 'bi-info-circle',
    trash: 'bi-trash3',
};

function ensureWired() {
    if (initialized) return;
    const dialog = document.getElementById('confirmActionModal');
    if (!dialog) return;
    initialized = true;

    const cancelBtn = dialog.querySelector('[data-confirm-cancel]');
    const okBtn = dialog.querySelector('[data-confirm-ok]');

    const finish = (result) => {
        const resolve = pendingResolve;
        pendingResolve = null;
        closeAnimatedDialog(dialog);
        if (typeof resolve === 'function') resolve(Boolean(result));
    };

    cancelBtn?.addEventListener('click', () => finish(false));
    okBtn?.addEventListener('click', () => finish(true));
    dialog.addEventListener('cancel', (event) => {
        event.preventDefault();
        finish(false);
    });
    dialog.addEventListener('click', (event) => {
        if (event.target === dialog) finish(false);
    });
}

export function showConfirmDialog({
    title = '\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435',
    message = '',
    confirmText = 'OK',
    cancelText = '\u041E\u0442\u043C\u0435\u043D\u0430',
    variant = 'danger', // 'danger' | 'warning' | 'block' | 'unblock' | 'info'
    icon = null,
} = {}) {
    return new Promise((resolve) => {
        const dialog = document.getElementById('confirmActionModal');
        if (!dialog) {
            // \u0437\u0430\u043F\u0430\u0441\u043D\u043E\u0439 \u043F\u0443\u0442\u044C, \u0435\u0441\u043B\u0438 \u043C\u043E\u0434\u0430\u043B \u043D\u0435 \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0451\u043D
            resolve(window.confirm(message || title));
            return;
        }
        ensureWired();

        if (pendingResolve) {
            pendingResolve(false);
            pendingResolve = null;
        }

        const titleEl = dialog.querySelector('[data-confirm-title]');
        const messageEl = dialog.querySelector('[data-confirm-message]');
        const okBtn = dialog.querySelector('[data-confirm-ok]');
        const cancelBtn = dialog.querySelector('[data-confirm-cancel]');
        const iconEl = dialog.querySelector('[data-confirm-icon]');

        if (titleEl) titleEl.textContent = title;
        if (messageEl) {
            messageEl.textContent = message;
            messageEl.style.display = message ? '' : 'none';
        }
        if (okBtn) okBtn.textContent = confirmText;
        if (cancelBtn) cancelBtn.textContent = cancelText;

        // \u0432\u0430\u0440\u0438\u0430\u043D\u0442 \u043A\u043D\u043E\u043F\u043A\u0438
        if (okBtn) {
            okBtn.classList.remove('dialog-danger-btn', 'dialog-primary-btn');
            okBtn.classList.add(variant === 'danger' || variant === 'warning'
                ? 'dialog-danger-btn'
                : 'dialog-primary-btn');
        }

        if (iconEl) {
            const iconClass = ICON_MAP[icon || variant] || ICON_MAP.info;
            if (iconClass === '__sun-check__') {
                iconEl.className = 'confirm-dialog-icon-glyph';
                iconEl.innerHTML = STANDARD_SINGLE_CHECK_UI_HTML;
            } else {
                iconEl.className = `bi ${iconClass}`;
                iconEl.textContent = '';
            }
            iconEl.setAttribute('data-confirm-icon', '');
        }

        dialog.dataset.variant = variant;

        pendingResolve = resolve;
        openAnimatedDialog(dialog);
        // \u0444\u043E\u043A\u0443\u0441 \u043D\u0430 \u043A\u043D\u043E\u043F\u043A\u0443 \u043E\u0442\u043C\u0435\u043D\u044B — \u0431\u0435\u0437\u043E\u043F\u0430\u0441\u043D\u044B\u0439 \u0434\u0435\u0444\u043E\u043B\u0442
        requestAnimationFrame(() => {
            cancelBtn?.focus();
        });
    });
}
