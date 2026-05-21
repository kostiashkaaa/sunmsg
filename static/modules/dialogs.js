// dialogs.js - toast notifications, dialog requests, send dialog request

import { applyFallbackAvatarTint, escapeHtml, getErrorMessage } from './utils.js';
import { getCsrfToken } from './csrf.js';
import { STANDARD_SINGLE_CHECK_UI_HTML } from './check-glyph.js';
import { withAppRoot } from './app-url.js';

// normalized: removed mojibake comment

export function showToast(_message, _type, _options = {}) {
    // Toast UI is intentionally disabled; keep the public hook for existing callers.
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
        const displayName = req.sender_display_name || req.sender_username || '\u0417\u0430\u043f\u0440\u043e\u0441';
        const username = req.sender_username ? `@${escapeHtml(req.sender_username)}` : '';
        return `
            <div class="contact-avatar contact-avatar--request">${escapeHtml(initials)}</div>
            <div class="req-info">
                <div class="req-name-row">
                    <span class="req-kind-badge">\u0417\u0430\u043f\u0440\u043e\u0441</span>
                    <span class="req-name">${escapeHtml(displayName)}</span>
                </div>
                <div class="req-username">\u0425\u043e\u0447\u0435\u0442 \u043d\u0430\u0447\u0430\u0442\u044c \u0434\u0438\u0430\u043b\u043e\u0433${username ? ` · ${username}` : ''}</div>
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
        const displayName = req.sender_display_name || req.sender_username || '\u0417\u0430\u043f\u0440\u043e\u0441';
        const username = req.sender_username ? `@${escapeHtml(req.sender_username)}` : '';
        return `
            <div class="contact-avatar contact-avatar--request">${escapeHtml(initials)}</div>
            <div class="req-info">
                <div class="req-name-row">
                    <span class="req-kind-badge">\u0417\u0430\u043f\u0440\u043e\u0441</span>
                    <span class="req-name">${escapeHtml(displayName)}</span>
                </div>
                <div class="req-username">${groupLabel}${username ? ` · ${username}` : ''}</div>
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
                        item.setAttribute('data-request-kind', req.request_kind === 'group_invite' ? 'group_invite' : 'dialog');
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

export function sendDialogRequest(userId, displayName, options = {}) {
    const {
        confirmBeforeSend = true,
        updateButton = true,
    } = options || {};
    if (
        confirmBeforeSend
        && !confirm(`\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0437\u0430\u043F\u0440\u043E\u0441 \u043F\u043E\u043B\u044C\u0437\u043E\u0432\u0430\u0442\u0435\u043B\u044E ${displayName}?`)
    ) {
        return Promise.resolve({ success: false, cancelled: true });
    }
    return fetch(withAppRoot('/send_request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
        body: JSON.stringify({ contact_user_id: userId }),
    }).then(r => r.json()).then(function(data) {
        if (data.success) {
            if (updateButton) {
                const button = document.querySelector(`.send-request-btn[data-user-id="${userId}"]`);
                if (button) {
                    button.disabled = true;
                    button.innerHTML = `${STANDARD_SINGLE_CHECK_UI_HTML} \u041E\u0442\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u043E`;
                }
            }
        } else {
            console.warn('[DialogRequests] send failed', getErrorMessage(data.error));
        }
        return data;
    }).catch((err) => {
        console.warn('[DialogRequests] send request failed', err);
        return { success: false, error: err?.message || '\u041E\u0448\u0438\u0431\u043A\u0430 \u043F\u0440\u0438 \u043E\u0442\u043F\u0440\u0430\u0432\u043A\u0435 \u0437\u0430\u043F\u0440\u043E\u0441\u0430.' };
    });
}
