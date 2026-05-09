export function initPasskeyFlow({
    tr,
    showToast,
    supportsPasskeyAuth,
    parseRequestOptionsFromServer,
    credentialToJSON,
    withAppRoot,
    getCsrfToken,
    setCsrfToken,
    loginFlow,
}) {
    const passkeyLoginBtn = document.getElementById('passkeyLoginBtn');
    if (passkeyLoginBtn && !supportsPasskeyAuth()) {
        passkeyLoginBtn.disabled = true;
        passkeyLoginBtn.setAttribute('aria-disabled', 'true');
        passkeyLoginBtn.title = tr('\u042d\u0442\u043e\u0442 \u0431\u0440\u0430\u0443\u0437\u0435\u0440 \u043d\u0435 \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442 Passkey/WebAuthn');
    }

    passkeyLoginBtn?.addEventListener('click', async (event) => {
        event.preventDefault();
        const button = event.currentTarget;
        const rememberDevice = !!document.getElementById('rememberDeviceCheckbox')?.checked;
        const username = String(document.getElementById('login_username')?.value || '').trim();

        if (!supportsPasskeyAuth()) {
            showToast('\u041f\u0430\u0441\u0441\u043a\u0435\u0439 \u043d\u0435 \u043f\u043e\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442\u0441\u044f \u044d\u0442\u0438\u043c \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u043e\u043c.', 'error');
            return;
        }

        button.disabled = true;
        const originalHtml = button.innerHTML;
        button.innerHTML = `<i class="bi bi-hourglass-split"></i>&nbsp; ${tr('\u041f\u043e\u0434\u0433\u043e\u0442\u043e\u0432\u043a\u0430 Passkey...')}`;

        try {
            const optionsRes = await fetch(withAppRoot('/api/passkey/login/options'), {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({
                    username,
                    remember_device: rememberDevice,
                }),
            });
            const optionsData = await optionsRes.json();
            if (!optionsRes.ok || !optionsData.success || !optionsData.options) {
                throw new Error(tr(optionsData.error || '\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u043d\u0430\u0447\u0430\u0442\u044c Passkey-\u0432\u0445\u043e\u0434.'));
            }

            button.innerHTML = `<i class="bi bi-fingerprint"></i>&nbsp; ${tr('\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u0435 \u0432\u0445\u043e\u0434')}`;
            const publicKey = parseRequestOptionsFromServer(optionsData.options);
            const assertion = await navigator.credentials.get({ publicKey });
            if (!assertion) {
                throw new Error(tr('\u0412\u0445\u043e\u0434 \u0447\u0435\u0440\u0435\u0437 Passkey \u043e\u0442\u043c\u0435\u043d\u0435\u043d.'));
            }

            const verifyRes = await fetch(withAppRoot('/api/passkey/login/verify'), {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRFToken': getCsrfToken(),
                },
                body: JSON.stringify({
                    credential: credentialToJSON(assertion),
                }),
            });
            const verifyData = await verifyRes.json();
            if (!verifyRes.ok || !verifyData.success) {
                throw new Error(tr(verifyData.error || 'Passkey \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0430 \u043d\u0435 \u043f\u0440\u043e\u0439\u0434\u0435\u043d\u0430.'));
            }

            loginFlow.clearPendingLoginSecrets();

            if (verifyData.requires_totp) {
                if (verifyData.csrf_token) {
                    setCsrfToken(verifyData.csrf_token);
                }
                loginFlow.unlockTotpStep();
                showToast('\u0412\u0432\u0435\u0434\u0438\u0442\u0435 \u043a\u043e\u0434 Authenticator \u0434\u043b\u044f \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u0438\u044f \u0432\u0445\u043e\u0434\u0430.', 'info');
                return;
            }

            showToast('\u0414\u043e\u0431\u0440\u043e \u043f\u043e\u0436\u0430\u043b\u043e\u0432\u0430\u0442\u044c!', 'success');
            setTimeout(() => {
                window.location.href = withAppRoot('/chat');
            }, 600);
        } catch (err) {
            const message = String(err?.message || '');
            const lowered = message.toLowerCase();
            const errorName = String(err?.name || '').toLowerCase();
            if (errorName === 'notallowederror' || errorName === 'aborterror' || /notallowed|abort/i.test(lowered)) {
                showToast(
                    '\u0412\u0445\u043e\u0434 \u0447\u0435\u0440\u0435\u0437 Passkey \u043e\u0442\u043c\u0435\u043d\u0435\u043d \u0438\u043b\u0438 \u043a\u043b\u044e\u0447 \u043d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d \u0434\u043b\u044f \u044d\u0442\u043e\u0433\u043e \u0434\u043e\u043c\u0435\u043d\u0430. \u041e\u0442\u043a\u0440\u043e\u0439\u0442\u0435 \u0442\u043e\u0442 \u0436\u0435 \u0430\u0434\u0440\u0435\u0441, \u0433\u0434\u0435 \u043f\u0440\u0438\u0432\u044f\u0437\u044b\u0432\u0430\u043b\u0438 \u043a\u043b\u044e\u0447 (\u043d\u0430\u043f\u0440\u0438\u043c\u0435\u0440 http://sun.localhost:5000).',
                    'info',
                );
            } else if (message) {
                showToast(tr(message), 'error');
            } else {
                showToast('Passkey \u0432\u0445\u043e\u0434 \u043d\u0435 \u0432\u044b\u043f\u043e\u043b\u043d\u0435\u043d.', 'error');
            }
        } finally {
            button.disabled = false;
            button.innerHTML = originalHtml;
        }
    });
}
