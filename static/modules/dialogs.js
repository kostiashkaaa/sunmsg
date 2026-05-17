// dialogs.js - toast notifications, dialog requests, send dialog request

import { applyFallbackAvatarTint, escapeHtml, getErrorMessage } from './utils.js';
import { getCsrfToken } from './csrf.js';
import { STANDARD_SINGLE_CHECK_UI_HTML } from './check-glyph.js';
import { withAppRoot } from './app-url.js';
import { waitForMotionEnd } from './motion.js';

// normalized: removed mojibake comment

export function showToast(message, type, options = {}) {
    if (window.showToast && window.showToast !== showToast) {
        window.showToast(message, type, options);
        return;
    }
    const normalizedType = type === 'error' ? 'danger' : (type || 'info');
    const variant = {
        success: { icon: 'check-circle-fill', title: 'Успешно' },
        danger: { icon: 'x-circle-fill', title: 'Ошибка' },
        warning: { icon: 'exclamation-triangle-fill', title: 'Внимание' },
        info: { icon: 'info-circle-fill', title: 'Информация' },
    }[normalizedType] || { icon: 'info-circle-fill', title: 'Информация' };

    const el = document.createElement('div');
    el.className = 'toast-msg ' + normalizedType;

    const iconWrap = document.createElement('span');
    iconWrap.className = 'toast-msg__icon';
    iconWrap.innerHTML = `<i class="bi bi-${variant.icon}" aria-hidden="true"></i>`;

    const content = document.createElement('div');
    content.className = 'toast-msg__content';

    const title = document.createElement('div');
    title.className = 'toast-msg__title';
    title.textContent = variant.title;

    const text = document.createElement('div');
    text.className = 'toast-msg__text';
    text.textContent = message;

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'toast-msg__close';
    closeBtn.setAttribute('aria-label', 'Закрыть уведомление');
    closeBtn.innerHTML = '<i class="bi bi-x-lg" aria-hidden="true"></i>';

    content.append(title, text);
    el.append(iconWrap, content, closeBtn);

    const hideToast = () => {
        if (el.classList.contains('is-hiding')) return;
        el.classList.add('is-hiding');
        waitForMotionEnd(el, 300).then(() => {
            el.remove();
        });
    };
    closeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        hideToast();
    });
    el.addEventListener('click', hideToast);

    const tc = document.getElementById('toastContainer');
    if (tc) {
        const scopeKeyRaw = String(options?.scopeKey || '').trim();
        const scopeKey = scopeKeyRaw.replace(/[^a-z0-9_-]/gi, '');
        if (scopeKey) {
            el.dataset.toastScope = scopeKey;
            tc.querySelectorAll(`.toast-msg[data-toast-scope="${scopeKey}"]`).forEach((toastEl) => {
                toastEl.remove();
            });
        }
        tc.prepend(el);
        const shownToasts = tc.querySelectorAll('.toast-msg');
        for (let i = 5; i < shownToasts.length; i += 1) {
            shownToasts[i].remove();
        }
    }
    setTimeout(hideToast, 4200);
}

// normalized: removed mojibake comment

/**
 * @param {object}   opts
 * @param {function} opts.onAccepted - called after a request is accepted (e.g. reload contacts)
 */
export function initDialogRequests({ onAccepted, onListUpdated } = {}) {
    const dialogRequestsList    = document.getElementById('dialogRequestsList');
    const dialogRequestsSection = document.getElementById('dialogRequestsSection');

    function buildDialogRequestItem(req) {
        const initials = (req.sender_display_name || req.sender_username || '?')
            .trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
        return `
            <div class="contact-avatar" style="width:36px;height:36px;font-size:13px;">${escapeHtml(initials)}</div>
            <div class="req-info">
                <div class="req-name">${escapeHtml(req.sender_display_name)}</div>
                <div class="req-username">@${escapeHtml(req.sender_username)}</div>
            </div>
            <div class="req-actions">
                <button class="req-btn accept" data-key="${escapeHtml(req.sender_public_key)}"><span class="req-btn-label">\u041f\u0440\u0438\u043d\u044f\u0442\u044c</span></button>
                <button class="req-btn decline" data-key="${escapeHtml(req.sender_public_key)}"><span class="req-btn-label">\u041e\u0442\u043a\u043b\u043e\u043d\u0438\u0442\u044c</span></button>
            </div>`;
    }

    function buildGroupInviteRequestItem(req) {
        const initials = (req.sender_display_name || req.sender_username || '?')
            .trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
        const requestId = Number.parseInt(String(req.request_id || '').trim(), 10);
        const groupLabel = String(req.chat_name || '').trim()
            ? `\u041f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435 \u0432 \u0433\u0440\u0443\u043f\u043f\u0443: ${escapeHtml(String(req.chat_name || '').trim())}`
            : '\u041f\u0440\u0438\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435 \u0432 \u0433\u0440\u0443\u043f\u043f\u0443';
        return `
            <div class="contact-avatar" style="width:36px;height:36px;font-size:13px;">${escapeHtml(initials)}</div>
            <div class="req-info">
                <div class="req-name">${escapeHtml(req.sender_display_name)}</div>
                <div class="req-username">@${escapeHtml(req.sender_username)}</div>
                <div class="req-username">${groupLabel}</div>
            </div>
            <div class="req-actions">
                <button class="req-btn accept" data-request-kind="group_invite" data-request-id="${Number.isFinite(requestId) && requestId > 0 ? requestId : ''}"><span class="req-btn-label">\u041f\u0440\u0438\u043d\u044f\u0442\u044c</span></button>
                <button class="req-btn decline" data-request-kind="group_invite" data-request-id="${Number.isFinite(requestId) && requestId > 0 ? requestId : ''}"><span class="req-btn-label">\u041e\u0442\u043a\u043b\u043e\u043d\u0438\u0442\u044c</span></button>
            </div>`;
    }

    function loadDialogRequests() {
        fetch(withAppRoot('/get_dialog_requests'))
            .then(r => r.json())
            .then(function(response) {
                if (!dialogRequestsList || !dialogRequestsSection) return;
                dialogRequestsList.innerHTML = '';
                const requests = (response.success && response.dialog_requests) ? response.dialog_requests : [];

                if (requests.length > 0) {
                    dialogRequestsSection.classList.add('has-requests');
                    const countEl = document.getElementById('requestsCount');
                    if (countEl) countEl.textContent = '(' + requests.length + ')';

                    requests.forEach(function(req) {
                        const item = document.createElement('div');
                        item.className = 'request-item';
                        item.innerHTML = req.request_kind === 'group_invite'
                            ? buildGroupInviteRequestItem(req)
                            : buildDialogRequestItem(req);
                        applyFallbackAvatarTint(
                            item.querySelector('.contact-avatar'),
                            req.sender_display_name || req.sender_username || '?',
                        );
                        dialogRequestsList.appendChild(item);
                    });
                } else {
                    dialogRequestsSection.classList.remove('has-requests');
                }
                onListUpdated?.();
            })
            .catch((err) => console.warn('[DialogRequests] load failed', err));
    }

    function handleDialogRequest({ senderPublicKey, action, requestKind, requestId }) {
        const url = action === 'accept' ? withAppRoot('/accept_request') : withAppRoot('/decline_request');
        const payload = requestKind === 'group_invite'
            ? { request_kind: 'group_invite', request_id: Number(requestId || 0) }
            : { sender_public_key: senderPublicKey };
        fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
            body: JSON.stringify(payload),
        }).then(r => r.json()).then(function(response) {
            if (response.success) {
                loadDialogRequests();
                if (action === 'accept') onAccepted?.(response);
            } else {
                console.warn('[DialogRequests] action failed', getErrorMessage(response.error));
            }
        }).catch((err) => console.warn('[DialogRequests] action request failed', err));
    }

    if (dialogRequestsList) {
        dialogRequestsList.addEventListener('click', function(e) {
            const btn = e.target.closest('.req-btn');
            if (!btn) return;
            const requestKind = String(btn.getAttribute('data-request-kind') || '').trim().toLowerCase();
            const requestIdRaw = String(btn.getAttribute('data-request-id') || '').trim();
            const key = btn.getAttribute('data-key');
            const action = btn.classList.contains('accept') ? 'accept' : 'decline';
            if (requestKind === 'group_invite' && (!requestIdRaw || !Number.isFinite(Number(requestIdRaw)))) {
                console.warn('[DialogRequests] invalid group invite request id');
                return;
            }
            btn.disabled = true;
            handleDialogRequest({
                senderPublicKey: key,
                action,
                requestKind,
                requestId: requestIdRaw,
            });
        });
    }

    return { loadDialogRequests };
}

// normalized: removed mojibake comment

export function sendDialogRequest(userId, displayName) {
    if (confirm(`\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0437\u0430\u043F\u0440\u043E\u0441 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044E ${displayName}?`)) {
        fetch(withAppRoot('/send_request'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
            body: JSON.stringify({ contact_user_id: userId }),
        }).then(r => r.json()).then(function(data) {
            if (data.success) {
                const button = document.querySelector(`.send-request-btn[data-user-id="${userId}"]`);
                if (button) {
                    button.disabled = true;
                    button.innerHTML = `${STANDARD_SINGLE_CHECK_UI_HTML} \u041E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E`;
                }
            } else {
                console.warn('[DialogRequests] send failed', getErrorMessage(data.error));
            }
        }).catch((err) => console.warn('[DialogRequests] send request failed', err));
    }
}
