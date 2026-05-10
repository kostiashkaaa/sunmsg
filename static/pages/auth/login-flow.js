export function initLoginFlow({
    tr,
    showToast,
    setSubmitButtonState,
    showAuthSuccessOverlay,
    getMnemonicFromGrid,
    assertWebCryptoSupport,
    withAppRoot,
    getCsrfToken,
    setCsrfToken,
    stageKeyForLogin,
    stagePrivateKeyForRedirect,
    createQrLoginFlow,
    deriveTransferKey,
    decryptPrivateKeyPem,
}) {
    let currentLoginMethod = 'qr';
    let totpStepUnlocked = false;
    let pendingLoginPrivateKeyPem = '';
    let pendingLoginRememberDevice = false;
    let pendingLoginProfile = null;

    const loginSubmitBtn = document.getElementById('loginSubmitBtn');
    const loginOtherMethodsDetails = document.getElementById('loginOtherMethodsDetails');
    const loginOtherMenu = document.getElementById('loginOtherMenu');
    const loginOtherForm = document.getElementById('loginOtherForm');
    const loginPanel = document.getElementById('panel-login');
    const isEnglishUi = () => String(document.body?.dataset?.uiLanguage || document.documentElement.lang || '').toLowerCase() === 'en';
    const pickCopy = (ruText, enText) => (isEnglishUi() ? enText : ruText);

    function setOtherMethodsView(view) {
        const nextView = view === 'form' ? 'form' : 'menu';
        if (loginOtherMethodsDetails) {
            loginOtherMethodsDetails.dataset.view = nextView;
        }
        if (loginOtherMenu) {
            loginOtherMenu.hidden = nextView !== 'menu';
        }
        if (loginOtherForm) {
            loginOtherForm.hidden = nextView !== 'form';
        }
        if (loginPanel) {
            const open = !!loginOtherMethodsDetails?.open;
            loginPanel.classList.toggle('is-other-open', open);
        }
    }

    function setMethodGroupVisibility(group, visible) {
        if (!group) return;
        const seq = Number(group.dataset.motionSeq || '0') + 1;
        group.dataset.motionSeq = String(seq);
        group.classList.remove('auth-method-entering', 'auth-method-leaving');
        if (visible) {
            group.style.display = 'block';
            requestAnimationFrame(() => {
                if (group.dataset.motionSeq !== String(seq)) return;
                group.classList.add('auth-method-entering');
                setTimeout(() => {
                    if (group.dataset.motionSeq === String(seq)) {
                        group.classList.remove('auth-method-entering');
                    }
                }, 300);
            });
            return;
        }
        if (group.style.display === 'none') return;
        group.classList.add('auth-method-leaving');
        setTimeout(() => {
            if (group.dataset.motionSeq !== String(seq)) return;
            group.classList.remove('auth-method-leaving');
            group.style.display = 'none';
        }, 200);
    }

    const qrFlow = createQrLoginFlow({
        tr,
        showToast,
        assertWebCryptoSupport,
        withAppRoot,
        getCsrfToken,
        deriveTransferKey,
        decryptPrivateKeyPem,
        onCompleteLogin: completeLoginWithPrivateKey,
        isQrModeEnabled: () => currentLoginMethod === 'qr' && !totpStepUnlocked,
    });

    function redirectToChat(overlayShown) {
        setTimeout(
            () => {
                window.location.href = withAppRoot('/chat');
            },
            overlayShown ? 1400 : 600,
        );
    }

    async function completeTotpStep({ fallbackUsername = '' } = {}) {
        if (pendingLoginPrivateKeyPem) {
            const keyStageResult = await stageKeyForLogin({
                privateKeyPem: pendingLoginPrivateKeyPem,
                rememberDevice: pendingLoginRememberDevice,
                stagePrivateKeyForRedirect,
                tr,
            });
            if (!keyStageResult.staged && keyStageResult.warningMessage) {
                showToast(keyStageResult.warningMessage, 'info');
            }
        }

        const profileForOverlay = pendingLoginProfile;
        pendingLoginPrivateKeyPem = '';
        pendingLoginRememberDevice = false;
        pendingLoginProfile = null;
        totpStepUnlocked = false;
        qrFlow.setLoginQrRing('success');
        qrFlow.wipeLoginQrSecrets();

        const overlayShown = showAuthSuccessOverlay({
            username: profileForOverlay?.username || fallbackUsername,
            displayName: profileForOverlay?.displayName,
            avatarUrl: profileForOverlay?.avatarUrl,
        });
        if (!overlayShown) {
            showToast(pickCopy('Добро пожаловать!', 'Welcome!'), 'success');
        }
        redirectToChat(overlayShown);
    }

    function setLoginMethod(method) {
        let nextMethod = method;
        if (nextMethod === 'totp' && !totpStepUnlocked) {
            nextMethod = 'qr';
        }
        currentLoginMethod = nextMethod;

        const qrBtn = document.getElementById('methodQrBtn');
        const keyBtn = document.getElementById('methodKeyBtn');
        const qrGrp = document.getElementById('loginQrGroup');
        const keyGrp = document.getElementById('loginKeyGroup');
        const totpGrp = document.getElementById('loginTotpGroup');

        if (qrBtn) {
            qrBtn.disabled = !!totpStepUnlocked;
            qrBtn.setAttribute('aria-disabled', totpStepUnlocked ? 'true' : 'false');
        }
        if (loginSubmitBtn) {
            loginSubmitBtn.style.display = nextMethod === 'qr' ? 'none' : '';
        }
        if (loginOtherMethodsDetails) {
            if (nextMethod === 'qr') {
                loginOtherMethodsDetails.open = false;
                setOtherMethodsView('menu');
            } else {
                loginOtherMethodsDetails.open = true;
                setOtherMethodsView('form');
            }
        }

        if (nextMethod !== 'qr') {
            qrFlow.clearLoginQrTimers();
            qrFlow.resetLoginQrUi();
            qrFlow.wipeLoginQrSecrets();
        } else {
            qrFlow.scheduleLoginQrAutoStart(120);
        }

        qrBtn?.classList.toggle('active', nextMethod === 'qr');
        keyBtn?.classList.toggle('active', nextMethod === 'key');

        setMethodGroupVisibility(qrGrp, nextMethod === 'qr');
        setMethodGroupVisibility(keyGrp, nextMethod === 'key');
        setMethodGroupVisibility(totpGrp, nextMethod === 'totp');

        if (nextMethod === 'totp') {
            document.getElementById('login_totp_code')?.focus();
        }
    }

    async function completeLoginWithPrivateKey({ username, privateKeyPem, rememberDevice, profile }) {
        const chalRes = await fetch(withAppRoot('/api/get_challenge'), {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken(),
            },
            body: JSON.stringify({ username }),
        });
        const chalData = await chalRes.json();
        if (!chalData.success || !chalData.challenge) {
            throw new Error(tr(chalData.error || 'Ошибка challenge.'));
        }

        const signatureB64 = await window.e2e.signChallenge(privateKeyPem, chalData.challenge);
        const loginRes = await fetch(withAppRoot('/api/login_challenge'), {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken(),
            },
            body: JSON.stringify({ signature: signatureB64, remember_device: rememberDevice }),
        });
        const loginData = await loginRes.json();

        if (loginData.success && loginData.requires_totp) {
            if (loginData.csrf_token) {
                setCsrfToken(loginData.csrf_token);
            }
            pendingLoginPrivateKeyPem = privateKeyPem;
            pendingLoginRememberDevice = rememberDevice;
            pendingLoginProfile = profile || { username };
            totpStepUnlocked = true;
            qrFlow.setLoginQrPulse(false);
            setLoginMethod('totp');
            showToast(pickCopy('Введите код Authenticator для завершения входа.', 'Enter the authenticator code to complete sign-in.'), 'info');
            return;
        }

        if (!loginData.success) {
            throw new Error(tr(loginData.error || 'Ошибка входа.'));
        }

        const keyStageResult = await stageKeyForLogin({
            privateKeyPem,
            rememberDevice,
            stagePrivateKeyForRedirect,
            tr,
        });
        if (!keyStageResult.staged && keyStageResult.warningMessage) {
            showToast(keyStageResult.warningMessage, 'info');
        }

        pendingLoginPrivateKeyPem = '';
        pendingLoginRememberDevice = false;
        pendingLoginProfile = null;
        qrFlow.setLoginQrPulse(false);
        qrFlow.setLoginQrRing('success');
        qrFlow.wipeLoginQrSecrets();

        const overlayShown = showAuthSuccessOverlay({
            username,
            displayName: profile?.displayName,
            avatarUrl: profile?.avatarUrl,
        });
        if (!overlayShown) {
            showToast(pickCopy('Добро пожаловать!', 'Welcome!'), 'success');
        }
        redirectToChat(overlayShown);
    }

    const methodQrBtn = document.getElementById('methodQrBtn');
    const methodKeyBtn = document.getElementById('methodKeyBtn');
    const methodTotpCardBtn = document.getElementById('methodTotpCardBtn');
    const loginOtherBackBtn = document.getElementById('loginOtherBackBtn');
    const loginGoRegisterBtn = document.getElementById('loginGoRegisterBtn');
    const loginUsernameInput = document.getElementById('login_username');
    methodQrBtn?.addEventListener('click', () => setLoginMethod('qr'));
    methodKeyBtn?.addEventListener('click', () => {
        setOtherMethodsView('form');
        setLoginMethod('key');
    });
    methodTotpCardBtn?.addEventListener('click', () => {
        showToast(pickCopy('Этот способ доступен после ввода 24 слов.', 'This method is available after entering your 24 words.'), 'info');
    });
    loginOtherBackBtn?.addEventListener('click', () => {
        setLoginMethod('qr');
    });
    loginGoRegisterBtn?.addEventListener('click', () => {
        if (typeof window.switchTab === 'function') {
            window.switchTab('register');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });
    loginUsernameInput?.addEventListener('input', () => {
        qrFlow.scheduleLoginQrAutoStart(520);
    });
    loginOtherMethodsDetails?.addEventListener('toggle', () => {
        if (loginPanel) {
            loginPanel.classList.toggle('is-other-open', loginOtherMethodsDetails.open);
        }
        if (loginOtherMethodsDetails.open) {
            setOtherMethodsView(currentLoginMethod === 'qr' ? 'menu' : 'form');
            return;
        }
        setOtherMethodsView('menu');
    });

    const loginForm = document.getElementById('ajaxLoginForm');
    loginForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const btn = document.getElementById('loginSubmitBtn');
        const btnText = document.getElementById('loginBtnText');
        const username = document.getElementById('login_username')?.value.trim() || '';
        const rememberDevice = !!document.getElementById('rememberDeviceCheckbox')?.checked;

        if (!btn || !btnText) return;
        btn.disabled = true;
        setSubmitButtonState(btn, true);

        try {
            if (currentLoginMethod === 'totp') {
                btnText.textContent = tr('Проверка кода...');
                const code = document.getElementById('login_totp_code')?.value.trim() || '';
                const response = await fetch(withAppRoot('/api/login_totp'), {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRFToken': getCsrfToken(),
                    },
                    body: JSON.stringify({ totp_code: code }),
                });
                const data = await response.json();
                if (!data.success) {
                    throw new Error(tr(data.error || 'Неверный код'));
                }
                await completeTotpStep({ fallbackUsername: username });
                return;
            }

            if (currentLoginMethod === 'qr') {
                throw new Error(pickCopy('Подтвердите вход, отсканировав QR на другом устройстве.', 'Confirm sign-in by scanning the QR on your other device.'));
            }

            assertWebCryptoSupport();
            btnText.textContent = tr('Получение ключа...');
            const mnemonicInput = getMnemonicFromGrid();
            if (mnemonicInput.split(' ').length < 12) {
                throw new Error(tr('Введите все 24 слова (или минимум 12 для старых аккаунтов)'));
            }

            const challengeRes = await fetch(withAppRoot('/api/get_challenge'), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({ username }),
            });
            const challengeData = await challengeRes.json();
            if (!challengeData.success) throw new Error(tr(challengeData.error || 'Ошибка challenge'));
            if (!challengeData.login_vault) {
                throw new Error(tr('У этого аккаунта нет зашифрованного хранилища. Возможно, он был создан в старой версии.'));
            }

            btnText.textContent = tr('Расшифровка...');
            let privateKeyPem = '';
            try {
                privateKeyPem = await window.mnemonic.decryptVault(mnemonicInput, challengeData.login_vault);
            } catch (decryptErr) {
                const decryptMessage = String(decryptErr?.message || '');
                if (decryptMessage.includes('Неверная фраза')) {
                    throw new Error(tr('Не удалось расшифровать ключ. Проверьте 24 слова и имя пользователя.'));
                }
                throw decryptErr;
            }

            await completeLoginWithPrivateKey({ username, privateKeyPem, rememberDevice });
        } catch (err) {
            showToast(tr(err?.message || ''), 'error');
        } finally {
            btn.disabled = false;
            setSubmitButtonState(btn, false);
            btnText.textContent = tr('Войти');
        }
    });

    window.setLoginMethod = setLoginMethod;
    qrFlow.initialize();
    setOtherMethodsView('menu');
    setLoginMethod('qr');

    return {
        setLoginMethod,
        clearPendingLoginSecrets() {
            pendingLoginPrivateKeyPem = '';
            pendingLoginRememberDevice = false;
            pendingLoginProfile = null;
        },
        unlockTotpStep() {
            totpStepUnlocked = true;
            setLoginMethod('totp');
        },
        lockTotpStep() {
            totpStepUnlocked = false;
        },
        prepareMnemonicLoginAfterRegister() {
            totpStepUnlocked = false;
            setLoginMethod('key');
        },
        setPendingLoginProfile(profile) {
            pendingLoginProfile = profile || null;
        },
    };
}
