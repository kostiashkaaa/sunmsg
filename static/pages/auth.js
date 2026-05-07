import { getCsrfToken, setCsrfToken } from '../modules/csrf.js';
import { withAppRoot } from '../modules/app-url.js';
import { stagePrivateKeyForRedirect } from '../modules/private-key-session.js';
import { stageKeyForLogin } from '../modules/key-login-stage.js';
import { initMotionRuntime, initTelegramRipple } from '../modules/motion.js';

import {
    hasWebCryptoSupport,
    webCryptoUnavailableMessage,
    assertWebCryptoSupport,
    supportsPasskeyAuth,
    parseRequestOptionsFromServer,
    credentialToJSON,
    deriveTransferKey,
    decryptPrivateKeyPem,
} from './auth/crypto-helpers.js';
import { initAuthUi } from './auth/ui.js';
import { createQrLoginFlow } from './auth/qr-login-flow.js';
import { initLoginFlow } from './auth/login-flow.js';
import { initRegisterFlow } from './auth/register-flow.js';
import { initPasskeyFlow } from './auth/passkey-flow.js';

initMotionRuntime();
initTelegramRipple(document);

const ui = initAuthUi({ withAppRoot, getCsrfToken });

if (!hasWebCryptoSupport()) {
    ui.showToast(webCryptoUnavailableMessage(ui.tr), 'error');
}

const requireWebCrypto = () => assertWebCryptoSupport(ui.tr);

const authSupportSubmitBtn = document.getElementById('authSupportSubmitBtn');
const authSupportStatus = document.getElementById('authSupportStatus');
const authSupportCategory = document.getElementById('authSupportCategory');
const authSupportContact = document.getElementById('authSupportContact');
const authSupportSubject = document.getElementById('authSupportSubject');
const authSupportBody = document.getElementById('authSupportBody');

const setAuthSupportStatus = (text, mode = 'info') => {
    if (!authSupportStatus) return;
    authSupportStatus.textContent = ui.tr(String(text || ''));
    authSupportStatus.style.color = mode === 'error'
        ? '#a3322c'
        : mode === 'success'
            ? '#1f7a36'
            : 'var(--sub-text)';
};

authSupportSubmitBtn?.addEventListener('click', async () => {
    const subject = String(authSupportSubject?.value || '').trim();
    const message = String(authSupportBody?.value || '').trim();
    if (!subject) {
        setAuthSupportStatus('Укажите тему обращения.', 'error');
        return;
    }
    if (!message) {
        setAuthSupportStatus('Добавьте описание проблемы.', 'error');
        return;
    }

    authSupportSubmitBtn.disabled = true;
    setAuthSupportStatus('Отправка...');
    try {
        const panel = document.querySelector('.tab-panel.active');
        const sourcePage = panel?.id === 'panel-register' ? 'auth_register' : 'auth_login';
        const usernameInput = panel?.id === 'panel-register'
            ? document.getElementById('reg_username')
            : document.getElementById('login_username');

        const response = await fetch(withAppRoot('/api/support/requests'), {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken(),
            },
            body: JSON.stringify({
                source_page: sourcePage,
                category: String(authSupportCategory?.value || 'other'),
                contact_handle: String(authSupportContact?.value || ''),
                username: String(usernameInput?.value || '').trim(),
                subject,
                message,
            }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.success) {
            setAuthSupportStatus(data.error || 'Не удалось отправить обращение.', 'error');
            return;
        }
        setAuthSupportStatus(`Заявка отправлена (#${data.request_id}).`, 'success');
        if (authSupportSubject) authSupportSubject.value = '';
        if (authSupportBody) authSupportBody.value = '';
    } catch (_error) {
        setAuthSupportStatus('Сетевая ошибка при отправке.', 'error');
    } finally {
        authSupportSubmitBtn.disabled = false;
    }
});

const loginFlow = initLoginFlow({
    tr: ui.tr,
    showToast: ui.showToast,
    setSubmitButtonState: ui.setSubmitButtonState,
    showAuthSuccessOverlay: ui.showAuthSuccessOverlay,
    getMnemonicFromGrid: ui.getMnemonicFromGrid,
    assertWebCryptoSupport: requireWebCrypto,
    withAppRoot,
    getCsrfToken,
    setCsrfToken,
    stageKeyForLogin,
    stagePrivateKeyForRedirect,
    createQrLoginFlow,
    deriveTransferKey,
    decryptPrivateKeyPem,
});

initRegisterFlow({
    tr: ui.tr,
    showToast: ui.showToast,
    setSubmitButtonState: ui.setSubmitButtonState,
    assertWebCryptoSupport: requireWebCrypto,
    withAppRoot,
    getCsrfToken,
    activeLanguage: ui.activeLanguage,
    setMnemonicToGrid: ui.setMnemonicToGrid,
    switchTab: ui.switchTab,
    prepareMnemonicLoginAfterRegister: loginFlow.prepareMnemonicLoginAfterRegister,
});

initPasskeyFlow({
    tr: ui.tr,
    showToast: ui.showToast,
    supportsPasskeyAuth,
    parseRequestOptionsFromServer,
    credentialToJSON,
    withAppRoot,
    getCsrfToken,
    setCsrfToken,
    loginFlow,
});
