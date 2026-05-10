export function initRegisterFlow({
    tr,
    showToast,
    setSubmitButtonState,
    assertWebCryptoSupport,
    withAppRoot,
    getCsrfToken,
    setCsrfToken,
    activeLanguage,
    setMnemonicToGrid,
}) {
    const registerFlowProgress = document.getElementById('registerFlowProgress');
    const registerFlowProgressText = document.getElementById('registerFlowProgressText');
    const regUsernameInput = document.getElementById('reg_username');
    const regUsernameHint = document.getElementById('reg_username_hint');
    const registerForm = document.getElementById('ajaxRegisterForm');
    const registerSubmitBtn = document.getElementById('registerSubmitBtn');
    const registerBtnText = document.getElementById('registerBtnText');

    const keyResultBox = document.getElementById('keyResultBox');
    const registerStep2Block = document.getElementById('registerStep2Block');
    const registerStep3Block = document.getElementById('registerStep3Block');
    const registerStep4Block = document.getElementById('registerStep4Block');

    const privateKeyContent = document.getElementById('privateKeyContent');
    const registerMnemonicConfirmPromptA = document.getElementById('registerMnemonicConfirmPromptA');
    const registerMnemonicConfirmPromptB = document.getElementById('registerMnemonicConfirmPromptB');
    const registerMnemonicConfirmA = document.getElementById('registerMnemonicConfirmA');
    const registerMnemonicConfirmB = document.getElementById('registerMnemonicConfirmB');
    const registerMnemonicConfirmError = document.getElementById('registerMnemonicConfirmError');
    const registerMnemonicConfirmBtn = document.getElementById('registerMnemonicConfirmBtn');

    const totpQrContainer = document.getElementById('totpQrContainer');
    const totpSecretDisplay = document.getElementById('totpSecretDisplay');
    const registerTotpVerifyCode = document.getElementById('registerTotpVerifyCode');
    const registerTotpVerifyBtn = document.getElementById('registerTotpVerifyBtn');
    const registerTotpSkipBtn = document.getElementById('registerTotpSkipBtn');
    const registerTotpStatus = document.getElementById('registerTotpStatus');

    const registerDoneSubtext = document.getElementById('registerDoneSubtext');
    const registerDoneLoginBtn = document.getElementById('registerDoneLoginBtn');

    const flowState = {
        step: 1,
        mnemonic: '',
        words: [],
        confirmIndexes: [0, 1],
        totpSetupRequested: false,
    };

    function updateProgress(step) {
        if (!registerFlowProgress) return;
        const ru = {
            1: 'Данные аккаунта',
            2: 'Сохранение 24 слов',
            3: 'Подключение TOTP',
            4: 'Готово',
        };
        const en = {
            1: 'Account details',
            2: 'Save 24 words',
            3: 'Set up TOTP',
            4: 'Done',
        };
        const language = activeLanguage() === 'en' ? 'en' : 'ru';
        const title = language === 'en' ? en[step] : ru[step];
        const progressText = language === 'en'
            ? `Step ${step} of 4 — ${title}`
            : `Шаг ${step} из 4 — ${title}`;

        registerFlowProgress.dataset.step = String(step);
        if (registerFlowProgressText) {
            registerFlowProgressText.textContent = progressText;
            return;
        }
        registerFlowProgress.textContent = progressText;
    }

    function setElementHidden(element, hidden) {
        if (!element) return;
        if (hidden) {
            element.setAttribute('hidden', 'hidden');
            return;
        }
        element.removeAttribute('hidden');
    }

    function setRegisterStep(step) {
        flowState.step = step;
        updateProgress(step);

        if (registerForm) {
            registerForm.style.display = step === 1 ? '' : 'none';
        }
        if (keyResultBox) {
            keyResultBox.classList.toggle('visible', step >= 2);
        }

        setElementHidden(registerStep2Block, step !== 2);
        setElementHidden(registerStep3Block, step !== 3);
        setElementHidden(registerStep4Block, step !== 4);

        if (step === 3) {
            void ensureTotpSetup();
        }
        if (step === 4) {
            registerDoneLoginBtn?.focus();
        }
    }

    function normalizedWord(value) {
        return String(value || '').trim().toLowerCase();
    }

    function pickTwoIndexes(maxExclusive) {
        const max = Math.max(2, Number(maxExclusive || 0));
        const first = Math.floor(Math.random() * max);
        let second = Math.floor(Math.random() * max);
        while (second === first) {
            second = Math.floor(Math.random() * max);
        }
        return first < second ? [first, second] : [second, first];
    }

    function resetMnemonicConfirmation(mnemonic) {
        flowState.mnemonic = String(mnemonic || '').trim();
        flowState.words = flowState.mnemonic.split(/\s+/).map(normalizedWord).filter(Boolean);
        flowState.confirmIndexes = pickTwoIndexes(flowState.words.length);

        const firstWordNumber = flowState.confirmIndexes[0] + 1;
        const secondWordNumber = flowState.confirmIndexes[1] + 1;
        if (registerMnemonicConfirmPromptA) {
            registerMnemonicConfirmPromptA.textContent = `${tr('Слово')} №${firstWordNumber}`;
        }
        if (registerMnemonicConfirmPromptB) {
            registerMnemonicConfirmPromptB.textContent = `${tr('Слово')} №${secondWordNumber}`;
        }
        if (registerMnemonicConfirmA) registerMnemonicConfirmA.value = '';
        if (registerMnemonicConfirmB) registerMnemonicConfirmB.value = '';
        setElementHidden(registerMnemonicConfirmError, true);
        if (registerMnemonicConfirmError) registerMnemonicConfirmError.textContent = '';
    }

    function setTotpStatus(message, mode = 'info') {
        if (!registerTotpStatus) return;
        registerTotpStatus.textContent = tr(String(message || ''));
        registerTotpStatus.style.color = mode === 'error'
            ? '#a3322c'
            : mode === 'success'
                ? '#1f7a36'
                : 'var(--sub-text)';
    }

    async function ensureTotpSetup() {
        if (flowState.totpSetupRequested) return;
        flowState.totpSetupRequested = true;
        setTotpStatus('Подготавливаем QR-код...');

        try {
            const response = await fetch(withAppRoot('/api/totp_manage'), {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({ action: 'enable' }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.success) {
                flowState.totpSetupRequested = false;
                setTotpStatus(data.error || 'Не удалось получить данные для TOTP.', 'error');
                return;
            }

            const secret = String(data.totp_secret || '').trim();
            const uri = String(data.totp_uri || '').trim();
            if (!secret || !uri) {
                flowState.totpSetupRequested = false;
                setTotpStatus('Сервер не вернул TOTP-секрет. Попробуйте снова.', 'error');
                return;
            }

            if (totpSecretDisplay) {
                totpSecretDisplay.textContent = secret;
            }
            await window.ensureQrCodeLibrary();
            if (totpQrContainer) {
                totpQrContainer.innerHTML = '';
                new window.QRCode(totpQrContainer, {
                    text: uri,
                    width: 150,
                    height: 150,
                    colorDark: '#1a1a2e',
                    colorLight: '#ffffff',
                    correctLevel: window.QRCode.CorrectLevel.M,
                });
            }
            setTotpStatus('Отсканируйте QR и введите 6-значный код.');
        } catch (_error) {
            flowState.totpSetupRequested = false;
            setTotpStatus('Ошибка сети при подготовке TOTP.', 'error');
        }
    }

    async function clearPendingTotpSetup() {
        try {
            await fetch(withAppRoot('/api/totp_manage'), {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({ action: 'disable' }),
            });
        } catch (_error) {
            // Best-effort cleanup only.
        }
    }

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

    registerMnemonicConfirmBtn?.addEventListener('click', () => {
        const firstIndex = flowState.confirmIndexes[0];
        const secondIndex = flowState.confirmIndexes[1];
        const expectedA = flowState.words[firstIndex] || '';
        const expectedB = flowState.words[secondIndex] || '';
        const actualA = normalizedWord(registerMnemonicConfirmA?.value || '');
        const actualB = normalizedWord(registerMnemonicConfirmB?.value || '');

        if (actualA !== expectedA || actualB !== expectedB) {
            if (registerMnemonicConfirmError) {
                registerMnemonicConfirmError.textContent = tr('Проверка не пройдена: слова не совпадают.');
            }
            setElementHidden(registerMnemonicConfirmError, false);
            showToast('Проверьте сохранённые 24 слова и повторите ввод.', 'error');
            return;
        }

        setElementHidden(registerMnemonicConfirmError, true);
        setRegisterStep(3);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    registerTotpVerifyCode?.addEventListener('input', function onTotpVerifyInput() {
        this.value = this.value.replace(/\D/g, '').slice(0, 6);
    });

    registerTotpVerifyBtn?.addEventListener('click', async () => {
        const code = String(registerTotpVerifyCode?.value || '').trim();
        if (!/^\d{6}$/.test(code)) {
            setTotpStatus('Введите корректный 6-значный код.', 'error');
            return;
        }

        if (registerTotpVerifyBtn) registerTotpVerifyBtn.disabled = true;
        setTotpStatus('Проверяем код...');
        try {
            const response = await fetch(withAppRoot('/api/totp_setup/verify'), {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({ totp_code: code }),
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok || !data.success) {
                setTotpStatus(data.error || 'Не удалось проверить код.', 'error');
                return;
            }

            setTotpStatus('TOTP успешно подключен.', 'success');
            if (registerDoneSubtext) {
                registerDoneSubtext.textContent = tr('Аккаунт создан, TOTP подключен. Можно перейти в мессенджер.');
            }
            setRegisterStep(4);
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (_error) {
            setTotpStatus('Ошибка сети при проверке кода.', 'error');
        } finally {
            if (registerTotpVerifyBtn) registerTotpVerifyBtn.disabled = false;
        }
    });

    registerTotpSkipBtn?.addEventListener('click', async () => {
        await clearPendingTotpSetup();
        if (registerDoneSubtext) {
            registerDoneSubtext.textContent = tr('Аккаунт создан. TOTP можно подключить позже в настройках.');
        }
        setRegisterStep(4);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    registerDoneLoginBtn?.addEventListener('click', () => {
        window.location.href = withAppRoot('/chat');
    });

    registerForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!registerSubmitBtn || !registerBtnText) return;

        registerSubmitBtn.disabled = true;
        registerBtnText.textContent = tr('Генерация ключей...');
        setSubmitButtonState(registerSubmitBtn, true);

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

            registerBtnText.textContent = tr('Проверка владения ключом...');
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
                credentials: 'include',
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
            const data = await registerRes.json().catch(() => ({}));
            if (!registerRes.ok || !data.success) {
                showToast(data.error || 'Ошибка регистрации', 'error');
                return;
            }
            if (typeof data.csrf_token === 'string' && data.csrf_token.trim()) {
                setCsrfToken(data.csrf_token.trim());
            }

            if (privateKeyContent) {
                privateKeyContent.value = mnemonic;
            }
            setMnemonicToGrid(mnemonic);

            const loginUsernameInput = document.getElementById('login_username');
            if (loginUsernameInput) {
                loginUsernameInput.value = username;
            }

            if (totpQrContainer) {
                totpQrContainer.innerHTML = '';
            }
            if (totpSecretDisplay) {
                totpSecretDisplay.textContent = '';
            }
            if (registerTotpVerifyCode) {
                registerTotpVerifyCode.value = '';
            }
            flowState.totpSetupRequested = false;
            resetMnemonicConfirmation(mnemonic);
            setTotpStatus('');
            setRegisterStep(2);

            showToast('Аккаунт создан. Сохраните 24 слова и продолжите настройку.', 'success');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            showToast(`${tr('Ошибка:')} ${tr(err?.message || '')}`.trim(), 'error');
        } finally {
            registerSubmitBtn.disabled = false;
            setSubmitButtonState(registerSubmitBtn, false);
            registerBtnText.textContent = tr('Создать и продолжить');
        }
    });

    setRegisterStep(1);
}
