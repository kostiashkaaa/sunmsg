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
    const contactsList          = document.getElementById('contactsList');

    function isGroupInviteRequest(req) {
        return String(req?.request_kind || '').trim().toLowerCase() === 'group_invite';
    }

    function getDialogRequestPerson(req) {
        const outgoing = req.request_direction === 'outgoing';
        return {
            displayName: outgoing ? req.receiver_display_name : req.sender_display_name,
            username: outgoing ? req.receiver_username : req.sender_username,
            publicKey: outgoing ? req.receiver_public_key : req.sender_public_key,
            userId: outgoing ? req.receiver_user_id : null,
            outgoing,
        };
    }

    function buildDialogRequestActions(person, { contactListItem = false } = {}) {
        const actionClass = contactListItem
            ? 'req-actions request-contact-actions'
            : 'req-actions';
        const statusActionClass = contactListItem
            ? 'req-actions req-actions--status request-contact-actions'
            : 'req-actions req-actions--status';
        return person.outgoing
            ? `<div class="${statusActionClass}">
                <span class="req-status">\u041e\u0436\u0438\u0434\u0430\u0435\u0442 \u043e\u0442\u0432\u0435\u0442\u0430</span>
                <button class="req-btn cancel" data-request-action="cancel" data-key="${escapeHtml(person.publicKey)}" data-user-id="${escapeHtml(String(person.userId || ''))}"><span class="req-btn-label">\u041e\u0442\u043c\u0435\u043d\u0438\u0442\u044c</span></button>
            </div>`
            : `<div class="${actionClass}">
                <button class="req-btn accept" data-key="${escapeHtml(person.publicKey)}"><span class="req-btn-label">\u041f\u0440\u0438\u043d\u044f\u0442\u044c</span></button>
                <button class="req-btn decline" data-key="${escapeHtml(person.publicKey)}"><span class="req-btn-label">\u041e\u0442\u043a\u043b\u043e\u043d\u0438\u0442\u044c</span></button>
            </div>`;
    }

    function buildDialogRequestItem(req) {
        const person = getDialogRequestPerson(req);
        const initials = (person.displayName || person.username || '?')
            .trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
        const displayName = person.displayName || person.username || '\u0417\u0430\u043f\u0440\u043e\u0441';
        const username = person.username ? `@${escapeHtml(person.username)}` : '';
        const subtitle = person.outgoing
            ? '\u0417\u0430\u043f\u0440\u043e\u0441 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d'
            : '\u0425\u043e\u0447\u0435\u0442 \u043d\u0430\u0447\u0430\u0442\u044c \u0434\u0438\u0430\u043b\u043e\u0433';
        return `
            <div class="contact-avatar contact-avatar--request">${escapeHtml(initials)}</div>
            <div class="req-info">
                <div class="req-name-row">
                    <span class="req-kind-badge">\u0417\u0430\u043f\u0440\u043e\u0441</span>
                    <span class="req-name">${escapeHtml(displayName)}</span>
                </div>
                <div class="req-username">${subtitle}${username ? ` · ${username}` : ''}</div>
            </div>
            ${buildDialogRequestActions(person)}`;
    }

    function buildContactListRequestItem(req) {
        const person = getDialogRequestPerson(req);
        const initials = (person.displayName || person.username || '?')
            .trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
        const displayName = person.displayName || person.username || '\u0417\u0430\u043f\u0440\u043e\u0441';
        const username = person.username ? `@${escapeHtml(person.username)}` : '';
        const subtitle = person.outgoing
            ? '\u0417\u0430\u043f\u0440\u043e\u0441 \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d'
            : '\u0425\u043e\u0447\u0435\u0442 \u043d\u0430\u0447\u0430\u0442\u044c \u0434\u0438\u0430\u043b\u043e\u0433';
        return `
            <div class="contact-avatar contact-avatar--request">${escapeHtml(initials)}</div>
            <div class="contact-info">
                <div class="contact-name-row">
                    <div class="contact-name-main">
                        <span class="req-kind-badge">\u0417\u0430\u043f\u0440\u043e\u0441</span>
                        <span class="contact-name">${escapeHtml(displayName)}</span>
                    </div>
                </div>
                <div class="contact-last-msg-row">
                    <span class="contact-last-msg">${subtitle}${username ? ` &middot; ${username}` : ''}</span>
                </div>
                <div class="contact-request-actions-row">
                    ${buildDialogRequestActions(person, { contactListItem: true })}
                </div>
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

    function clearContactListRequestItems() {
        contactsList?.querySelectorAll('.contact-item--dialog-request').forEach((item) => item.remove());
    }

    function renderContactListRequest(req, fragment) {
        const person = getDialogRequestPerson(req);
        const item = document.createElement('div');
        const displayName = person.displayName || person.username || '\u0417\u0430\u043f\u0440\u043e\u0441';
        item.className = 'contact-item contact-item--dialog-request ripple-target';
        item.setAttribute('data-request-kind', 'dialog');
        item.setAttribute('data-request-direction', person.outgoing ? 'outgoing' : 'incoming');
        item.setAttribute('data-contact-id', person.userId ? String(person.userId) : '');
        item.setAttribute('data-display-name', displayName);
        item.setAttribute('data-username', person.username || '');
        item.setAttribute('data-contact-username', person.username || '');
        item.setAttribute('data-public-key', person.publicKey || '');
        item.setAttribute('data-is-group', '0');
        item.setAttribute('data-members-count', '0');
        item.setAttribute('data-muted', '0');
        item.setAttribute('data-saved-messages', '0');
        item.setAttribute('data-message-count', '0');
        item.setAttribute('data-pinned', '0');
        item.setAttribute('data-last-message-time', new Date().toISOString());
        item.setAttribute('data-last-message-ts', String(Date.now()));
        item.setAttribute('draggable', 'false');
        if (person.publicKey) item.setAttribute('data-request-peer-key', person.publicKey);
        item.innerHTML = buildContactListRequestItem(req);
        applyFallbackAvatarTint(
            item.querySelector('.contact-avatar'),
            person.displayName || person.username || '?',
        );
        fragment.appendChild(item);
    }

    function loadDialogRequests() {
        fetch(withAppRoot('/get_dialog_requests'))
            .then(r => r.json())
            .then(function(response) {
                if (!dialogRequestsList || !dialogRequestsSection) return;
                dialogRequestsList.innerHTML = '';
                clearContactListRequestItems();
                const requests = (response.success && response.dialog_requests) ? response.dialog_requests : [];
                const directRequests = contactsList
                    ? requests.filter((req) => !isGroupInviteRequest(req))
                    : [];
                const sectionRequests = contactsList
                    ? requests.filter(isGroupInviteRequest)
                    : requests;

                if (contactsList && directRequests.length > 0) {
                    const fragment = document.createDocumentFragment();
                    directRequests.forEach((req) => renderContactListRequest(req, fragment));
                    contactsList.prepend(fragment);
                }

                if (sectionRequests.length > 0) {
                    dialogRequestsSection.classList.add('has-requests');
                    const countEl = document.getElementById('requestsCount');
                    if (countEl) countEl.textContent = '(' + sectionRequests.length + ')';

                    sectionRequests.forEach(function(req) {
                        const item = document.createElement('div');
                        const person = getDialogRequestPerson(req);
                        item.className = 'request-item';
                        item.setAttribute('data-request-kind', isGroupInviteRequest(req) ? 'group_invite' : 'dialog');
                        item.setAttribute('data-request-direction', person.outgoing ? 'outgoing' : 'incoming');
                        if (person.publicKey) item.setAttribute('data-request-peer-key', person.publicKey);
                        item.innerHTML = isGroupInviteRequest(req)
                            ? buildGroupInviteRequestItem(req)
                            : buildDialogRequestItem(req);
                        applyFallbackAvatarTint(
                            item.querySelector('.contact-avatar'),
                            person.displayName || person.username || req.sender_display_name || req.sender_username || '?',
                        );
                        dialogRequestsList.appendChild(item);
                    });
                } else {
                    dialogRequestsSection.classList.remove('has-requests');
                    const countEl = document.getElementById('requestsCount');
                    if (countEl) countEl.textContent = '';
                }
                onListUpdated?.();
            })
            .catch((err) => console.warn('[DialogRequests] load failed', err));
    }

    let visibilityRefreshTimer = 0;
    function refreshDialogRequestsWhenVisible() {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
        if (visibilityRefreshTimer) return;
        visibilityRefreshTimer = window.setTimeout(() => {
            visibilityRefreshTimer = 0;
            loadDialogRequests();
        }, 250);
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

    function handleCancelDialogRequest({ receiverPublicKey, receiverUserId }) {
        cancelDialogRequest({ receiverPublicKey, receiverUserId })
            .then(function(response) {
                if (!response?.success) {
                    console.warn('[DialogRequests] cancel failed', getErrorMessage(response?.error));
                }
            })
            .finally(loadDialogRequests);
    }

    function handleRequestActionClick(e) {
        const contactRequestItem = e.target.closest('.contact-item--dialog-request');
        if (contactRequestItem) {
            e.preventDefault();
            e.stopPropagation();
        }
        const btn = e.target.closest('.req-btn');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();
        const requestKind = String(btn.getAttribute('data-request-kind') || '').trim().toLowerCase();
        const requestIdRaw = String(btn.getAttribute('data-request-id') || '').trim();
        const key = btn.getAttribute('data-key');
        const action = btn.getAttribute('data-request-action')
            || (btn.classList.contains('accept') ? 'accept' : 'decline');
        if (action === 'cancel') {
            btn.disabled = true;
            handleCancelDialogRequest({
                receiverPublicKey: key,
                receiverUserId: btn.getAttribute('data-user-id'),
            });
            return;
        }
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
    }

    dialogRequestsList?.addEventListener('click', handleRequestActionClick);
    contactsList?.addEventListener('click', handleRequestActionClick, true);

    if (typeof window !== 'undefined') {
        window.addEventListener('focus', refreshDialogRequestsWhenVisible);
        document.addEventListener('visibilitychange', refreshDialogRequestsWhenVisible);
    }

    const api = { loadDialogRequests };
    if (typeof window !== 'undefined') {
        window.SUN_DIALOG_REQUESTS = api;
    }
    return api;
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
            if (typeof window !== 'undefined') {
                window.SUN_DIALOG_REQUESTS?.loadDialogRequests?.();
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

export function cancelDialogRequest({ receiverUserId = null, receiverPublicKey = '' } = {}) {
    const payload = {};
    const parsedUserId = Number.parseInt(String(receiverUserId || '').trim(), 10);
    const normalizedPublicKey = String(receiverPublicKey || '').trim();
    if (Number.isFinite(parsedUserId) && parsedUserId > 0) {
        payload.receiver_user_id = parsedUserId;
    }
    if (normalizedPublicKey) {
        payload.receiver_public_key = normalizedPublicKey;
    }
    if (!payload.receiver_user_id && !payload.receiver_public_key) {
        return Promise.resolve({ success: false, error: '\u041d\u0435 \u0443\u043a\u0430\u0437\u0430\u043d \u0430\u0434\u0440\u0435\u0441\u0430\u0442 \u0437\u0430\u043f\u0440\u043e\u0441\u0430.' });
    }

    return fetch(withAppRoot('/cancel_request'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRFToken': getCsrfToken() },
        body: JSON.stringify(payload),
    }).then(r => r.json()).then(function(data) {
        if (data.success && typeof window !== 'undefined') {
            window.SUN_DIALOG_REQUESTS?.loadDialogRequests?.();
        } else if (!data.success) {
            console.warn('[DialogRequests] cancel failed', getErrorMessage(data.error));
        }
        return data;
    }).catch((err) => {
        console.warn('[DialogRequests] cancel request failed', err);
        return { success: false, error: err?.message || '\u041e\u0448\u0438\u0431\u043a\u0430 \u043f\u0440\u0438 \u043e\u0442\u043c\u0435\u043d\u0435 \u0437\u0430\u043f\u0440\u043e\u0441\u0430.' };
    });
}
