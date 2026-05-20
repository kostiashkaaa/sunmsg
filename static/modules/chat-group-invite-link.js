export function createGroupInviteLinkController({
    withAppRoot,
    getCsrfToken,
    documentRef = document,
    confirmDialog = null,
} = {}) {
    function requestRevokeConfirm() {
        const options = {
            title: '\u041E\u0442\u043E\u0437\u0432\u0430\u0442\u044C \u0441\u0441\u044B\u043B\u043A\u0443?',
            message: '\u0422\u0435\u043A\u0443\u0449\u0430\u044F \u0441\u0441\u044B\u043B\u043A\u0430-\u043F\u0440\u0438\u0433\u043B\u0430\u0448\u0435\u043D\u0438\u0435 \u043F\u0435\u0440\u0435\u0441\u0442\u0430\u043D\u0435\u0442 \u0440\u0430\u0431\u043E\u0442\u0430\u0442\u044C \u0441\u0440\u0430\u0437\u0443.',
            confirmText: '\u041E\u0442\u043E\u0437\u0432\u0430\u0442\u044C',
            variant: 'danger',
            icon: 'warning',
        };
        if (typeof confirmDialog === 'function') return confirmDialog(options);
        const fallbackConfirm = globalThis?.window?.confirm || globalThis?.confirm;
        if (typeof fallbackConfirm !== 'function') return Promise.resolve(false);
        return Promise.resolve(Boolean(fallbackConfirm(options.message)));
    }

    async function _request(path, options = {}) {
        const headers = { 'X-CSRFToken': getCsrfToken?.() || '', ...options.headers };
        let body = options.body;
        if (options.json !== undefined) {
            headers['Content-Type'] = 'application/json';
            body = JSON.stringify(options.json);
        }
        const resp = await fetch(withAppRoot(path), {
            method: options.method || 'GET',
            credentials: 'include',
            headers,
            body,
        });
        const payload = await resp.json().catch(() => ({}));
        if (!resp.ok || payload?.success === false) throw new Error(payload?.error || `HTTP ${resp.status}`);
        return payload;
    }

    async function loadLink(chatId) {
        return _request(`/api/chats/group/invite-link?chat_id=${encodeURIComponent(chatId)}`);
    }

    async function createLink(chatId, { maxUses = null, expiresInHours = null } = {}) {
        return _request('/api/chats/group/invite-link', {
            method: 'POST',
            json: { chat_id: chatId, max_uses: maxUses, expires_in_hours: expiresInHours },
        });
    }

    async function revokeLink(chatId) {
        return _request('/api/chats/group/invite-link/revoke', {
            method: 'POST',
            json: { chat_id: chatId },
        });
    }

    function buildLinkUrl(token) {
        return `${window.location.origin}${withAppRoot('/join/' + encodeURIComponent(token))}`;
    }

    function renderInviteLinkSection(containerEl, chatId, { canManage = false } = {}) {
        if (!containerEl) return;
        containerEl.innerHTML = `
            <div class="group-invite-link-section">
                <div class="group-invite-link-header">
                    <span class="group-invite-link-title">Ссылка-приглашение</span>
                    ${canManage ? `<button class="group-invite-link-create btn-sm-action" type="button">Создать</button>` : ''}
                </div>
                <div class="group-invite-link-display" hidden>
                    <input type="text" class="group-invite-link-input" readonly>
                    <button class="group-invite-link-copy btn-sm-action" type="button" title="Скопировать">
                        <i class="bi bi-clipboard"></i>
                    </button>
                    ${canManage ? `<button class="group-invite-link-revoke btn-sm-action btn-sm-danger" type="button" title="Отозвать">
                        <i class="bi bi-x-circle"></i>
                    </button>` : ''}
                </div>
                <div class="group-invite-link-status"></div>
            </div>`;

        const displayEl = containerEl.querySelector('.group-invite-link-display');
        const inputEl = containerEl.querySelector('.group-invite-link-input');
        const statusEl = containerEl.querySelector('.group-invite-link-status');
        const createBtn = containerEl.querySelector('.group-invite-link-create');
        const copyBtn = containerEl.querySelector('.group-invite-link-copy');
        const revokeBtn = containerEl.querySelector('.group-invite-link-revoke');

        function showLink(token) {
            inputEl.value = buildLinkUrl(token);
            displayEl.hidden = false;
            statusEl.textContent = '';
        }

        function showStatus(msg) {
            statusEl.textContent = msg;
        }

        loadLink(chatId).then((payload) => {
            if (payload?.link?.token) {
                showLink(payload.link.token);
            } else {
                showStatus(canManage ? 'Ссылка не создана.' : '');
            }
        }).catch(() => showStatus(''));

        createBtn?.addEventListener('click', async () => {
            createBtn.disabled = true;
            try {
                const payload = await createLink(chatId);
                showLink(payload.link.token);
            } catch (err) {
                showStatus(`Ошибка: ${err.message}`);
            } finally {
                createBtn.disabled = false;
            }
        });

        copyBtn?.addEventListener('click', () => {
            const val = inputEl.value;
            if (!val) return;
            navigator.clipboard?.writeText(val).catch(() => {
                inputEl.select();
                documentRef.execCommand('copy');
            });
            copyBtn.innerHTML = '<i class="bi bi-check"></i>';
            setTimeout(() => { copyBtn.innerHTML = '<i class="bi bi-clipboard"></i>'; }, 2000);
        });

        revokeBtn?.addEventListener('click', async () => {
            const confirmed = await requestRevokeConfirm();
            if (!confirmed) return;
            revokeBtn.disabled = true;
            revokeBtn.setAttribute('aria-busy', 'true');
            try {
                await revokeLink(chatId);
                displayEl.hidden = true;
                inputEl.value = '';
                showStatus('Ссылка отозвана.');
            } catch (err) {
                showStatus(`Ошибка: ${err.message}`);
            } finally {
                revokeBtn.disabled = false;
                revokeBtn.setAttribute('aria-busy', 'false');
            }
        });
    }

    return {
        loadLink,
        createLink,
        revokeLink,
        buildLinkUrl,
        renderInviteLinkSection,
    };
}
