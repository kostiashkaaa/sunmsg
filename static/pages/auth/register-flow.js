export function initRegisterFlow({
    tr,
    showToast,
    setSubmitButtonState,
    assertWebCryptoSupport,
    withAppRoot,
    getCsrfToken,
    activeLanguage,
    setMnemonicToGrid,
    switchTab,
    prepareMnemonicLoginAfterRegister,
}) {
    const regUsernameInput = document.getElementById('reg_username');
    const regUsernameHint = document.getElementById('reg_username_hint');

    regUsernameInput?.addEventListener('input', function onUsernameInput() {
        const clean = this.value.toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (clean !== this.value) {
            const pos = this.selectionStart - (this.value.length - clean.length);
            this.value = clean;
            this.setSelectionRange(pos, pos);
        }
        if (regUsernameHint) {
            regUsernameHint.style.display = this.value.length > 0 ? 'block' : 'none';
        }
    });

    const registerForm = document.getElementById('ajaxRegisterForm');
    registerForm?.addEventListener('submit', async (event) => {
        event.preventDefault();

        const btn = document.getElementById('registerSubmitBtn');
        const btnText = document.getElementById('registerBtnText');
        if (!btn || !btnText) return;

        btn.disabled = true;
        btnText.textContent = tr('Генерация ключей...');
        setSubmitButtonState(btn, true);

        try {
            assertWebCryptoSupport();
            const mnemonic = await window.mnemonic.generateMnemonic();

            const keyPair = await window.crypto.subtle.generateKey(
                {
                    name: 'RSA-OAEP',
                    modulusLength: 2048,
                    publicExponent: new Uint8Array([1, 0, 1]),
                    hash: 'SHA-256',
                },
                true,
                ['encrypt', 'decrypt'],
            );
            const pubKeyArr = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
            const privKeyArr = await window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
            const pubKeyPem = window.e2e.arrayBufferToBase64(pubKeyArr);
            const privKeyPem = window.e2e.arrayBufferToBase64(privKeyArr);

            const loginVault = await window.mnemonic.createVault(mnemonic, privKeyPem);

            btnText.textContent = tr('Проверка владения ключом...');
            const challengeRes = await fetch(withAppRoot('/api/get_register_challenge'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({}),
            });
            const challengeData = await challengeRes.json();
            if (!challengeData.success || !challengeData.challenge) {
                throw new Error(tr(challengeData.error || 'Не удалось получить challenge для регистрации'));
            }
            const registerSignature = await window.e2e.signChallenge(privKeyPem, challengeData.challenge);

            const username = document.getElementById('reg_username')?.value.trim() || '';
            const displayName = document.getElementById('reg_display_name')?.value.trim() || '';

            const registerRes = await fetch(withAppRoot('/api/register_client'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({
                    username,
                    display_name: displayName,
                    public_key: pubKeyPem,
                    login_vault: loginVault,
                    register_challenge: challengeData.challenge,
                    register_signature: registerSignature,
                    language: activeLanguage(),
                }),
            });
            const data = await registerRes.json();

            if (!data.success) {
                showToast(data.error || 'Ошибка регистрации', 'error');
                return;
            }

            showToast('Аккаунт создан!', 'success');
            document.getElementById('keyResultBox')?.classList.add('visible');
            const privateKeyContent = document.getElementById('privateKeyContent');
            if (privateKeyContent) {
                privateKeyContent.value = mnemonic;
            }

            const totpSecretDisplayEl = document.getElementById('totpSecretDisplay');
            const qrContainer = document.getElementById('totpQrContainer');
            const hasTotpSetupPayload = typeof data.totp_secret === 'string'
                && data.totp_secret.trim()
                && typeof data.totp_uri === 'string'
                && data.totp_uri.trim();

            if (hasTotpSetupPayload) {
                if (totpSecretDisplayEl) {
                    totpSecretDisplayEl.textContent = data.totp_secret;
                }
                await window.ensureQrCodeLibrary();
                if (qrContainer) {
                    qrContainer.innerHTML = '';
                    new window.QRCode(qrContainer, {
                        text: data.totp_uri,
                        width: 150,
                        height: 150,
                        colorDark: '#1a1a2e',
                        colorLight: '#ffffff',
                        correctLevel: window.QRCode.CorrectLevel.M,
                    });
                }
            } else {
                if (qrContainer) {
                    qrContainer.innerHTML = '';
                }
                if (totpSecretDisplayEl) {
                    totpSecretDisplayEl.textContent = tr('Настройте TOTP позже в Settings -> Encryption.');
                }
            }

            const loginUsernameInput = document.getElementById('login_username');
            if (loginUsernameInput) {
                loginUsernameInput.value = username;
            }
            setMnemonicToGrid(mnemonic);
            switchTab('login');
            prepareMnemonicLoginAfterRegister();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            showToast(`${tr('Ошибка:')} ${tr(err?.message || '')}`.trim(), 'error');
        } finally {
            btn.disabled = false;
            setSubmitButtonState(btn, false);
            btnText.textContent = tr('Создать аккаунт');
        }
    });
}