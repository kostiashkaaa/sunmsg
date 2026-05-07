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

    const syncMnemonicUnlockUi = () => {
        if (!mnemonicUnlockCard || !e2eStatusCard) return;
        const unlocked = hasRuntimePrivateKey({ isEmbedMode });
        mnemonicUnlockCard.style.display = unlocked ? 'none' : '';
        e2eStatusCard.style.display = unlocked ? 'none' : '';
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

    mnemonicGrid.addEventListener('paste', (event) => {
        event.preventDefault();
        const text = (event.clipboardData || window.clipboardData).getData('text');
        const words = text.trim().split(/\s+/);
        const inputs = mnemonicGrid.querySelectorAll('input');
        words.forEach((word, idx) => {
            if (inputs[idx]) inputs[idx].value = word.toLowerCase();
        });
    });

    document.getElementById('activateDecryptionBtn')?.addEventListener('click', async function () {
        const wordsArr = [];
        document.querySelectorAll('.mnemonic-word-input').forEach((input) => {
            const value = input.value.trim();
            if (value) wordsArr.push(value);
        });
        if (wordsArr.length < 12) {
            showAlert('Введите минимум 12 слов (для старых аккаунтов) или все 24', 'warning');
            return;
        }

        const mnemonicPhrase = wordsArr.join(' ');
        this.disabled = true;
        this.innerHTML = `<i class="bi bi-hourglass-split"></i> ${tr('Расшифровка...')}`;

        try {
            const data = await api.getChallenge(document.getElementById('username').value);
            if (!data.login_vault) {
                throw new Error('Сейф не найден. Попробуйте сбросить ключи.');
            }

            const privateKeyPem = await window.mnemonic.decryptVault(mnemonicPhrase, data.login_vault);
            const staged = await stagePrivateKeyForRedirect(privateKeyPem, {
                rememberDevice: true,
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
            this.innerHTML = `<i class="bi bi-key-fill"></i> ${tr('Активировать доступ')}`;
        }
    });

    return {
        syncMnemonicUnlockUi,
    };
}
