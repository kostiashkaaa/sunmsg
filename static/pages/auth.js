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

function syncRegisterFlowCopy(language = ui.activeLanguage()) {
    const isEn = String(language || '').toLowerCase() === 'en';
    const setText = (id, text) => {
        const node = document.getElementById(id);
        if (node) node.textContent = text;
    };
    const setHtml = (id, html) => {
        const node = document.getElementById(id);
        if (node) node.innerHTML = html;
    };
    const setAttr = (id, attrName, value) => {
        const node = document.getElementById(id);
        if (node && typeof value === 'string') {
            node.setAttribute(attrName, value);
        }
    };

    setHtml(
        'loginIntroTitle',
        isEn
            ? '<span id="loginIntroTitleMain">Sign in</span><em class="auth-login-intro-em" id="loginIntroTitleAccent">in three seconds.</em>'
            : '<span id="loginIntroTitleMain">Войти</span><em class="auth-login-intro-em" id="loginIntroTitleAccent">за три секунды.</em>',
    );

    setText('registerStep1Title', isEn ? 'Quick intro' : 'Знакомимся');
    setText(
        'registerStep1Sub',
        isEn
            ? 'Your name is shown to contacts. @handle is how people find you.'
            : 'Имя видят ваши собеседники. @ник — по нему вас находят.',
    );
    setText('loginUsernameLabel', isEn ? '@ handle' : '@ ник');
    setText('loginMnemonicLabel', isEn ? '24 words separated by spaces' : '24 слова через пробел');
    setText('loginTotpCodeLabel', isEn ? 'Code from authenticator app' : 'Код из приложения-аутентификатора');
    setText(
        'loginTotpHelpText',
        isEn
            ? 'Open Google Authenticator or Microsoft Authenticator → enter the 6-digit code'
            : 'Откройте Google Authenticator или Microsoft Authenticator → введите 6-значный код',
    );
    setText('rememberDeviceLabel', isEn ? 'Remember this device for 30 days' : 'Запомнить это устройство на 30 дней');
    setText(
        'reg_username_hint',
        isEn ? 'Allowed characters: a-z, 0-9, _' : 'Допустимые символы: a-z, 0-9, _',
    );
    setText(
        'registerUsernameNote',
        isEn ? 'Username is used for sign-in and must be unique.' : 'Username используется для входа и должен быть уникальным.',
    );
    setText(
        'registerDisplayNameNote',
        isEn ? 'Your contacts see this display name in chats.' : 'Отображаемое имя видят ваши контакты в чатах.',
    );
    setAttr('reg_username', 'placeholder', isEn ? 'your_username' : 'ваш_username');
    setAttr('reg_display_name', 'placeholder', isEn ? 'Your name' : 'Ваше имя');

    setText('registerBtnText', isEn ? 'Continue' : 'Продолжить');
    setHtml('loginOtherBackBtn', isEn ? '&larr; Back' : '&larr; Назад');
    setHtml('registerStep2BackBtn', isEn ? '&larr; Back' : '&larr; Назад');
    setHtml('registerStep3BackBtn', isEn ? '&larr; Back' : '&larr; Назад');

    setText('registerStep2Title', isEn ? 'Your house key' : 'Ваш ключ от дома');
    setText(
        'registerStep2Sub',
        isEn
            ? '24 words. Write them on paper — everything you need to sign in from any device.'
            : '24 слова. Запишите на бумаге — это всё, что нужно для входа с любого устройства.',
    );
    setText('registerMnemonicRevealText', isEn ? 'Reveal' : 'Показать');
    setText('copyPrivateKeyBtnLabel', isEn ? 'Copy' : 'Скопировать');
    setText('registerStep2NextLabel', isEn ? 'I wrote them down, next' : 'Я записал, дальше');

    setText('registerStep3Title', isEn ? 'Quick check' : 'Маленькая проверка');
    setText(
        'registerStep3Sub',
        isEn
            ? 'Just confirming you wrote the words down and did not skip this step.'
            : 'Хотим убедиться, что вы записали слова, а не пролистали.',
    );
    setText('registerStep3ContinueLabel', isEn ? 'Continue' : 'Продолжить');
    setText('registerStep3ShowWordsBtn', isEn ? 'Show the words again' : 'Показать слова ещё раз');

    setText('registerStep4Title', isEn ? 'Done.' : 'Готово.');
    setText(
        'registerStep4Sub',
        isEn
            ? 'Registration is complete. You can now open messenger.'
            : 'Регистрация завершена, можно переходить в мессенджер',
    );
    setText(
        'registerDoneSubtext',
        isEn
            ? 'Account created. You can now sign in to secure chat.'
            : 'Аккаунт создан. Вы можете войти в защищённый чат.',
    );
    setText('registerDoneLoginLabel', isEn ? 'Sign in' : 'Войти');

    setText('authLegalTitle', isEn ? 'Documents and support' : 'Документы и поддержка');
    setText(
        'authLegalSub',
        isEn
            ? 'Legal documents and a direct feedback page are collected below.'
            : 'Ниже собраны юридические документы и обратная связь.',
    );
    setText('authLegalLinkTrust', isEn ? 'Trust center' : 'Trust Center');
    setText('authLegalLinkPrivacy', isEn ? 'Privacy policy' : 'Политика конфиденциальности');
    setText('authLegalLinkTerms', isEn ? 'Terms of service' : 'Пользовательское соглашение');
    setText('authLegalLinkFaq', isEn ? 'Security FAQ' : 'FAQ по безопасности');
    setText('authLegalLinkAbout', isEn ? 'About project and privacy' : 'О проекте и приватности');
    setText('authLegalLinkGuide', isEn ? 'Onboarding guide' : 'Гид по запуску');
    setText('authLegalLinkFeedback', isEn ? 'Feedback' : 'Обратная связь');
    setAttr('authLegalLinks', 'aria-label', isEn ? 'Legal and support links' : 'Юридические документы');
    setAttr('authLanguageSwitch', 'aria-label', isEn ? 'Interface language' : 'Язык интерфейса');
    setAttr('themeToggleBtn', 'title', isEn ? 'Switch theme' : 'Переключить тему');

    setHtml(
        'authFooterEyebrow',
        isEn
            ? '<span class="auth-footer-dot"></span>End-to-end encryption ・ Zero knowledge'
            : '<span class="auth-footer-dot"></span>Сквозное шифрование ・ Нулевое знание',
    );
    setText(
        'authFooterQuote',
        isEn
            ? "\"The server can't see your messages. Just you and the person you're talking to.\""
            : '«Сервер не видит сообщения. Только вы и тот, с кем вы говорите.»',
    );

    const progressTextNode = document.getElementById('registerFlowProgressText');
    if (progressTextNode) {
        const step = Number(document.querySelector('.auth-register-progress')?.dataset.step || '1');
        const ru = { 1: 'Данные аккаунта', 2: 'Сохранение 24 слов', 3: 'Маленькая проверка', 4: 'Готово' };
        const en = { 1: 'Account details', 2: 'Save 24 words', 3: 'Quick check', 4: 'Done' };
        const safeStep = Math.min(4, Math.max(1, Number.isFinite(step) ? step : 1));
        progressTextNode.textContent = isEn
            ? `Step ${safeStep} of 4 — ${en[safeStep]}`
            : `Шаг ${safeStep} из 4 — ${ru[safeStep]}`;
    }
}

syncRegisterFlowCopy(ui.activeLanguage());
window.addEventListener('sun-ui-language-changed', () => {
    syncRegisterFlowCopy(ui.activeLanguage());
});

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
    showAuthSuccessOverlay: ui.showAuthSuccessOverlay,
    assertWebCryptoSupport: requireWebCrypto,
    withAppRoot,
    getCsrfToken,
    setCsrfToken,
    stagePrivateKeyForRedirect,
    activeLanguage: ui.activeLanguage,
    setMnemonicToGrid: ui.setMnemonicToGrid,
    switchTab: ui.switchTab,
    prepareMnemonicLoginAfterRegister: loginFlow.prepareMnemonicLoginAfterRegister,
});
