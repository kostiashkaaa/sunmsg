export function initMnemonicSection({
    api,
    tr,
    showAlert,
    isEmbedMode,
    reloadSettingsSurface,
    stagePrivateKeyForRedirect,
    hasRuntimePrivateKey,
}) {
    const mnemonicGrid = document.getElementById('mnemonicInputGrid');
    const mnemonicUnlockCard = document.getElementById('mnemonicUnlockCard');
    const e2eStatusCard = document.getElementById('e2eStatusCard');
    const iconSvg = (name) => `<svg class="sun-icon" aria-hidden="true"><use href="#sun-i-${name}"></use></svg>`;

    const syncMnemonicUnlockUi = () => {
        if (!mnemonicUnlockCard || !e2eStatusCard) return;
        const unlocked = hasRuntimePrivateKey({ isEmbedMode });
        // Keep the 24-word recovery card available AT ALL TIMES —
        // messenger-style, access can be restored at any moment.
        // When the key is already active the card simply collapses.
        mnemonicUnlockCard.style.display = '';
        mnemonicUnlockCard.classList.toggle('mnemonic-card-unlocked', unlocked);
        e2eStatusCard.style.display = unlocked ? 'none' : 'block';
    };

    if (!mnemonicGrid) {
        return {
            syncMnemonicUnlockUi,
        };
    }

    syncMnemonicUnlockUi();
    window.addEventListener('focus', syncMnemonicUnlockUi);
    window.addEventListener('message', (event) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type === 'sun-settings-private-key-status') {
            syncMnemonicUnlockUi();
        }
    });

    for (let i = 1; i <= 24; i += 1) {
        const wrap = document.createElement('div');
        wrap.className = 'mnemonic-word-wrap';
        wrap.innerHTML = `
            <span class="mnemonic-num">${i}</span>
            <input type="text" class="mnemonic-word-input" data-index="${i}" autocomplete="off">
        `;
        mnemonicGrid.appendChild(wrap);
    }

    // "Restore again" — expands the 24-word input form,
    // even when access is already active (re-restore on this device).
    document.getElementById('mnemonicReunlockBtn')?.addEventListener('click', () => {
        mnemonicUnlockCard?.classList.add('mnemonic-card-reunlock');
        document.querySelector('.mnemonic-word-input')?.focus();
    });

    mnemonicGrid.addEventListener('paste', (event) => {
        event.preventDefault();
        const text = (event.clipboardData || window.clipboardData).getData('text');
        const words = text.trim().split(/\s+/).filter(Boolean);
        if (!words.length) return;

        const inputs = Array.from(mnemonicGrid.querySelectorAll('input'));
        // Start filling from the field the user actually pasted into
        // (not always the first one). With no focus — from the first.
        const target = event.target.closest('.mnemonic-word-input');
        const startIdx = target ? inputs.indexOf(target) : 0;

        words.forEach((word, offset) => {
            const input = inputs[startIdx + offset];
            if (input) input.value = word.toLowerCase();
        });

        // Move the cursor to the next empty field so the user can
        // continue typing/pasting down the grid.
        const next = inputs[startIdx + words.length] || inputs[inputs.length - 1];
        next?.focus();
    });

    document.getElementById('activateDecryptionBtn')?.addEventListener('click', async function () {
        const wordsArr = [];
        document.querySelectorAll('.mnemonic-word-input').forEach((input) => {
            const value = input.value.trim();
            if (value) wordsArr.push(value);
        });
        if (wordsArr.length < 12) {
            showAlert('Введите 12 или 24 слова восстановления', 'warning');
            return;
        }

        const mnemonicPhrase = wordsArr.join(' ');
        this.disabled = true;
        this.innerHTML = `${iconSvg('hourglass')} ${tr('Расшифровка...')}`;

        try {
            const data = await api.getChallenge(document.getElementById('username').value);
            if (!data.login_vault) {
                throw new Error('Сейф не найден. Попробуйте сбросить ключи.');
            }

            const privateKeyPem = await window.mnemonic.decryptVault(mnemonicPhrase, data.login_vault);
            const staged = await stagePrivateKeyForRedirect(privateKeyPem, {
                persistent: false,
                notify: true,
            });
            if (!staged) {
                throw new Error(tr('Не удалось безопасно активировать приватный ключ на этом устройстве.'));
            }

            showAlert('Ключ успешно восстановлен! История доступна.', 'success');

            syncMnemonicUnlockUi();
            if (mnemonicUnlockCard) {
                mnemonicUnlockCard.style.opacity = '0.5';
                mnemonicUnlockCard.style.pointerEvents = 'none';
            }
            if (e2eStatusCard) {
                e2eStatusCard.style.display = 'none';
            }

            setTimeout(() => {
                reloadSettingsSurface();
            }, 600);
        } catch (err) {
            showAlert(String(err?.message || 'Ошибка восстановления ключа'), 'danger');
        } finally {
            this.disabled = false;
            this.innerHTML = `${iconSvg('key')} ${tr('Активировать доступ')}`;
        }
    });

    return {
        syncMnemonicUnlockUi,
    };
}
