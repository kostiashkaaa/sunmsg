export function initPasskeysSection({
    api,
    tr,
    showAlert,
    escapeHtml,
    uiLocale,
}) {
    const passkeyAddBtn = document.getElementById('passkeyAddBtn');
    const passkeyListEl = document.getElementById('passkeyList');
    const passkeyUnsupportedNoteEl = document.getElementById('passkeyUnsupportedNote');

    if (!passkeyAddBtn || !passkeyListEl) {
        return {
            loadPasskeys: async () => {},
        };
    }

    function supportsPasskeys() {
        return Boolean(window.PublicKeyCredential && navigator.credentials && typeof navigator.credentials.create === 'function');
    }

    function base64urlToBytes(base64url) {
        const text = String(base64url || '').replace(/-/g, '+').replace(/_/g, '/');
        const pad = '='.repeat((4 - (text.length % 4)) % 4);
        const raw = window.atob(text + pad);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i += 1) {
            bytes[i] = raw.charCodeAt(i);
        }
        return bytes;
    }

    function bytesToBase64url(bytesLike) {
        const bytes = bytesLike instanceof Uint8Array ? bytesLike : new Uint8Array(bytesLike);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i += 1) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
    }

    function parseCreationOptionsFromServer(options) {
        if (window.PublicKeyCredential?.parseCreationOptionsFromJSON) {
            return window.PublicKeyCredential.parseCreationOptionsFromJSON(options);
        }
        const publicKey = JSON.parse(JSON.stringify(options || {}));
        publicKey.challenge = base64urlToBytes(publicKey.challenge);
        if (publicKey.user && publicKey.user.id) {
            publicKey.user.id = base64urlToBytes(publicKey.user.id);
        }
        if (Array.isArray(publicKey.excludeCredentials)) {
            publicKey.excludeCredentials = publicKey.excludeCredentials.map((descriptor) => ({
                ...descriptor,
                id: base64urlToBytes(descriptor.id),
            }));
        }
        return publicKey;
    }

    function credentialToJSON(credential) {
        if (!credential) return credential;
        if (typeof credential.toJSON === 'function') {
            return credential.toJSON();
        }
        if (credential instanceof ArrayBuffer) {
            return bytesToBase64url(new Uint8Array(credential));
        }
        if (ArrayBuffer.isView(credential)) {
            return bytesToBase64url(new Uint8Array(credential.buffer, credential.byteOffset, credential.byteLength));
        }
        if (Array.isArray(credential)) {
            return credential.map((item) => credentialToJSON(item));
        }
        if (typeof credential === 'object') {
            const out = {};
            Object.keys(credential).forEach((key) => {
                out[key] = credentialToJSON(credential[key]);
            });
            return out;
        }
        return credential;
    }

    function formatUiTimestamp(rawValue) {
        const text = String(rawValue || '').trim();
        if (!text) return tr('неизвестно');
        const date = new Date(text);
        if (Number.isNaN(date.getTime())) return tr('неизвестно');
        return date.toLocaleString(uiLocale(), {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    function renderPasskeyList(passkeys) {
        const items = Array.isArray(passkeys) ? passkeys : [];
        if (!items.length) {
            passkeyListEl.innerHTML = `<div class="passkey-empty">${escapeHtml(tr('Passkey пока не привязан.'))}</div>`;
            return;
        }
        passkeyListEl.innerHTML = items.map((item) => {
            const id = String(item.credential_id || '').trim();
            const label = String(item.label || '').trim() || tr('Passkey');
            const createdAt = formatUiTimestamp(item.created_at);
            const lastUsedAt = formatUiTimestamp(item.last_used_at);
            return `
                <div class="passkey-item">
                    <div class="passkey-item-main">
                        <div class="passkey-item-title">${escapeHtml(label)}</div>
                        <div class="passkey-item-meta">${escapeHtml(tr('Создан:'))} ${escapeHtml(createdAt)}</div>
                        <div class="passkey-item-meta">${escapeHtml(tr('Последний вход:'))} ${escapeHtml(lastUsedAt)}</div>
                    </div>
                    <button type="button" class="btn-settings secondary passkey-remove-btn" data-credential-id="${escapeHtml(id)}">${escapeHtml(tr('Удалить'))}</button>
                </div>
            `;
        }).join('');
    }

    async function loadPasskeys() {
        passkeyListEl.innerHTML = `<div class="passkey-empty">${escapeHtml(tr('Загрузка passkey...'))}</div>`;
        try {
            const payload = await api.listPasskeys();
            renderPasskeyList(payload.passkeys);
        } catch (err) {
            passkeyListEl.innerHTML = `<div class="passkey-empty">${escapeHtml(tr('Не удалось загрузить passkey.'))}</div>`;
            showAlert(String(err?.message || 'Ошибка Passkey.'), 'danger');
        }
    }

    async function addPasskey() {
        if (!supportsPasskeys()) {
            showAlert('Этот браузер не поддерживает Passkey/WebAuthn.', 'warning');
            return;
        }

        passkeyAddBtn.disabled = true;
        const originalText = passkeyAddBtn.textContent;
        passkeyAddBtn.textContent = tr('Подготовка...');

        try {
            const optionsPayload = await api.getPasskeyRegisterOptions();
            if (!optionsPayload.options) {
                throw new Error('Не удалось начать регистрацию passkey.');
            }

            const publicKey = parseCreationOptionsFromServer(optionsPayload.options);
            passkeyAddBtn.textContent = tr('Ожидание подтверждения...');
            const createdCredential = await navigator.credentials.create({ publicKey });
            if (!createdCredential) {
                throw new Error('Создание passkey отменено.');
            }

            await api.verifyPasskeyRegister(
                credentialToJSON(createdCredential),
                String(navigator.platform || navigator.userAgent || '').slice(0, 80),
            );

            showAlert('Passkey успешно добавлен.', 'success');
            await loadPasskeys();
        } catch (err) {
            const errorMessage = String(err?.message || '');
            if (errorMessage && !/cancel|abort|notallowed/i.test(errorMessage)) {
                showAlert(errorMessage, 'danger');
            }
        } finally {
            passkeyAddBtn.disabled = false;
            passkeyAddBtn.textContent = originalText || tr('Добавить Passkey');
        }
    }

    async function removePasskey(credentialId) {
        const id = String(credentialId || '').trim();
        if (!id) return;
        if (!window.confirm(tr('Удалить этот passkey?'))) return;

        try {
            await api.deletePasskey(id);
            showAlert('Passkey удалён.', 'success');
            await loadPasskeys();
        } catch (err) {
            showAlert(String(err?.message || 'Ошибка удаления Passkey.'), 'danger');
        }
    }

    if (!supportsPasskeys()) {
        passkeyAddBtn.disabled = true;
        if (passkeyUnsupportedNoteEl) {
            passkeyUnsupportedNoteEl.style.display = '';
        }
    } else if (passkeyUnsupportedNoteEl) {
        passkeyUnsupportedNoteEl.style.display = 'none';
    }

    passkeyAddBtn.addEventListener('click', addPasskey);
    passkeyListEl.addEventListener('click', (event) => {
        const button = event.target.closest('.passkey-remove-btn');
        if (!button) return;
        removePasskey(button.getAttribute('data-credential-id'));
    });

    loadPasskeys();

    return {
        loadPasskeys,
    };
}

