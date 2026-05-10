import { getCsrfToken, setCsrfToken } from '../modules/csrf.js';
import { withAppRoot } from '../modules/app-url.js';
import { stagePrivateKeyForRedirect } from '../modules/private-key-session.js';
import { stageKeyForLogin } from '../modules/key-login-stage.js';
import { initMotionRuntime, initTelegramRipple } from '../modules/motion.js';

import {
    hasWebCryptoSupport,
    webCryptoUnavailableMessage,
    assertWebCryptoSupport,
    deriveTransferKey,
    decryptPrivateKeyPem,
} from './auth/crypto-helpers.js';
import { initAuthUi } from './auth/ui.js';
import { createQrLoginFlow } from './auth/qr-login-flow.js';
import { initLoginFlow } from './auth/login-flow.js';
import { initRegisterFlow } from './auth/register-flow.js';

initMotionRuntime();
initTelegramRipple(document);

const ui = initAuthUi({ withAppRoot, getCsrfToken });

if (!hasWebCryptoSupport()) {
    ui.showToast(webCryptoUnavailableMessage(ui.tr), 'error');
}

const requireWebCrypto = () => assertWebCryptoSupport(ui.tr);

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
    setCsrfToken,
    activeLanguage: ui.activeLanguage,
    setMnemonicToGrid: ui.setMnemonicToGrid,
    switchTab: ui.switchTab,
    prepareMnemonicLoginAfterRegister: loginFlow.prepareMnemonicLoginAfterRegister,
});
