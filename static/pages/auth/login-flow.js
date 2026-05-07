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

    function setMethodGroupVisibility(group, visible) {
        if (!group) return;
        const seq = Number(group.dataset.motionSeq || '0') + 1;
        group.dataset.motionSeq = String(seq);
        group.classList.remove('auth-method-entering', 'auth-method-leaving');
        if (visible) {
            group.style.display = '';
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
            showToast('Добро пожаловать!', 'success');
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
            showToast('Введите код Authenticator для завершения входа.', 'info');
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
            showToast('Добро пожаловать!', 'success');
        }
        redirectToChat(overlayShown);
    }

    const methodQrBtn = document.getElementById('methodQrBtn');
    const methodKeyBtn = document.getElementById('methodKeyBtn');
    const loginUsernameInput = document.getElementById('login_username');
    methodQrBtn?.addEventListener('click', () => setLoginMethod('qr'));
    methodKeyBtn?.addEventListener('click', () => setLoginMethod('key'));
    loginUsernameInput?.addEventListener('input', () => {
        qrFlow.scheduleLoginQrAutoStart(520);
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
                throw new Error(tr('Нажмите «Показать QR» и подтвердите вход на другом устройстве.'));
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
                    throw new Error(tr('Не удалось расшифровать ключ. Проверьте 24 слова и username.'));
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