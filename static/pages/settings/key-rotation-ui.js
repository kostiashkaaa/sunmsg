// key-rotation-ui.js — wires the "Перевыпустить ключ" button in the settings
// panel to the rotation flow exposed via window.keyRotation.
//
// Loaded as a non-module global script: keeps lifecycle simple and shares
// window.deviceKey / window.keyRotation set up by the chat shell.

import { showConfirmDialog } from '/static/modules/confirm-dialog.js';

const ROTATE_BUTTON_ID = 'rotateKeyBtn';

function getCurrentPublicKeyPem() {
    const textarea = document.getElementById('publicKeyTextarea');
    if (!textarea) return '';
    return String(textarea.value || '').trim();
}

function stripPemHeaders(pem) {
    return window.keyRotation?.stripPemHeaders
        ? window.keyRotation.stripPemHeaders(pem)
        : String(pem || '')
            .replace(/-----BEGIN [^-]+-----/g, '')
            .replace(/-----END [^-]+-----/g, '')
            .replace(/\s+/g, '');
}

function getRecoveryPhraseFromSettingsGrid() {
    const words = Array.from(document.querySelectorAll('.mnemonic-word-input'))
        .map((input) => String(input.value || '').trim().toLowerCase())
        .filter(Boolean);
    return (words.length === 12 || words.length === 24) ? words.join(' ') : '';
}

function requireRecoveryPhrase() {
    const phrase = getRecoveryPhraseFromSettingsGrid();
    if (phrase) return phrase;
    const card = document.getElementById('mnemonicUnlockCard');
    card?.classList.add('mnemonic-card-reunlock');
    document.querySelector('.mnemonic-word-input')?.focus();
    throw new Error('Введите текущие 12 или 24 слова восстановления в блоке «Восстановление истории», затем повторите ротацию.');
}

async function unwrapOldPrivateKey() {
    if (!window.deviceKey || typeof window.deviceKey.unwrapPrivateKey !== 'function') {
        throw new Error('Хранилище ключа недоступно.');
    }
    // Don't consume the session-wrapped copy: the rotation may fail mid-flight
    // and we want the user able to retry without re-entering recovery words.
    const pem = await window.deviceKey.unwrapPrivateKey({ consumeSession: false });
    if (!pem) {
        throw new Error('Войдите заново — приватный ключ не разблокирован.');
    }
    return pem;
}

async function persistNewPrivateKey({ newPrivateKeyPem }) {
    if (!window.deviceKey || typeof window.deviceKey.wrapPrivateKey !== 'function') {
        throw new Error('Хранилище ключа недоступно.');
    }
    // Persistent if the user already had a persistent wrap; otherwise stay
    // session-only. We pick persistent if either source had it.
    const wasPersistent = Boolean(window.deviceKey.hasPersistentWrappedKey?.());
    const ok = await window.deviceKey.wrapPrivateKey(newPrivateKeyPem, {
        persistent: wasPersistent,
    });
    if (!ok) {
        throw new Error('Не удалось сохранить новый ключ на устройстве.');
    }
}

function findApi() {
    // The settings orchestrator caches the API on window.settingsApi (or
    // window.__settingsApi). Fall back to ad-hoc fetch if neither is present.
    return window.settingsApi || window.__settingsApi || null;
}

function buildAdHocApi() {
    return {
        getLoginVault: async () => {
            const response = await fetch('/api/get_login_vault', {
                credentials: 'same-origin',
                headers: { 'X-Requested-With': 'XMLHttpRequest' },
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Сейф не найден.');
            }
            return data;
        },
        rotateKeys: async ({ newPublicKey, signature, ts, newLoginVault }) => {
            const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
            const response = await fetch('/api/keys/rotate', {
                method: 'POST',
                credentials: 'same-origin',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': csrfToken,
                    'X-Requested-With': 'XMLHttpRequest',
                },
                body: JSON.stringify({
                    new_public_key: newPublicKey,
                    signature,
                    ts,
                    new_login_vault: newLoginVault,
                }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.success) {
                throw new Error(data.error || 'Не удалось перевыпустить ключ.');
            }
            return data;
        },
    };
}

function buildNewLoginVaultFactory({ api, oldPrivateKeyPem }) {
    return async ({ newPrivateKeyPem }) => {
        if (!window.mnemonic || typeof window.mnemonic.decryptVault !== 'function' || typeof window.mnemonic.createVault !== 'function') {
            throw new Error('Модуль recovery words не загружен.');
        }
        if (!api || typeof api.getLoginVault !== 'function') {
            throw new Error('API сейфа недоступен.');
        }
        const phrase = requireRecoveryPhrase();
        const vaultData = await api.getLoginVault();
        if (!vaultData.login_vault) {
            throw new Error('Сейф не найден.');
        }
        const currentVaultPrivateKey = await window.mnemonic.decryptVault(phrase, vaultData.login_vault);
        if (stripPemHeaders(currentVaultPrivateKey) !== stripPemHeaders(oldPrivateKeyPem)) {
            throw new Error('Слова восстановления не соответствуют текущему ключу.');
        }
        return window.mnemonic.createVault(phrase, stripPemHeaders(newPrivateKeyPem));
    };
}

async function handleRotateClick(event) {
    const button = event.currentTarget;
    if (button.disabled) return;

    const confirmed = await showConfirmDialog({
        title: 'Перевыпустить ключ?',
        message: 'Все ваши устройства выйдут из системы. Войдите заново после ротации; для разблокировки сейфа понадобятся текущие слова восстановления.',
        confirmText: 'Перевыпустить',
        cancelText: 'Отмена',
        variant: 'danger',
    }).catch(() => false);
    if (!confirmed) return;

    button.disabled = true;
    const originalLabel = button.textContent;
    button.textContent = 'Подготовка...';

    try {
        if (!window.keyRotation || typeof window.keyRotation.rotateUserKey !== 'function') {
            throw new Error('Модуль ротации не загружен.');
        }
        const api = findApi() || buildAdHocApi();
        const oldPublicKeyPem = getCurrentPublicKeyPem();
        if (!oldPublicKeyPem) throw new Error('Текущий публичный ключ не найден на странице.');
        const oldPrivateKeyPem = await unwrapOldPrivateKey();

        button.textContent = 'Ротация ключа...';
        await window.keyRotation.rotateUserKey({
            oldPrivateKeyPem,
            oldPublicKeyPem,
            buildNewLoginVault: buildNewLoginVaultFactory({ api, oldPrivateKeyPem }),
            persistNewPrivateKey,
            api,
        });

        button.textContent = 'Готово, выходим...';
        // Force a clean reload to the login page so all in-memory state
        // (sockets, contacts, decrypted messages) is dropped.
        window.setTimeout(() => {
            window.location.href = '/?reset_client=1';
        }, 600);
    } catch (err) {
        button.disabled = false;
        button.textContent = originalLabel;
        const message = err && err.message ? err.message : String(err);
        // Reuse the project's existing toast if available; otherwise alert.
        if (window.showToast) {
            window.showToast(message, { tone: 'danger' });
        } else {
            window.alert(message);
        }
    }
}

function attach() {
    const button = document.getElementById(ROTATE_BUTTON_ID);
    if (!button || button.dataset.rotateBound === '1') return;
    button.dataset.rotateBound = '1';
    button.addEventListener('click', handleRotateClick);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach, { once: true });
} else {
    attach();
}

// The settings panel can be injected lazily; retry on mutation.
const observer = new MutationObserver(attach);
observer.observe(document.documentElement, { childList: true, subtree: true });
