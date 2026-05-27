import { getCsrfToken, setCsrfToken } from '../modules/csrf.js';
import { withAppRoot } from '../modules/app-url.js';
import { clearPrivateKeyPem, stagePrivateKeyForRedirect } from '../modules/private-key-session.js';
import { stageKeyForLogin } from '../modules/key-login-stage.js';
import { initMotionRuntime, initSunRipple } from '../modules/motion.js';

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
initSunRipple(document);
void clearPrivateKeyPem({
    notify: false,
    clearWrappedSession: true,
    clearWrappedPersistent: false,
    clearDeviceKey: false,
});

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
            ? '<span id="loginIntroTitleMain">Sign in</span><em class="auth-login-intro-em" id="loginIntroTitleAccent">without extra steps.</em>'
            : '<span id="loginIntroTitleMain">Войти</span><em class="auth-login-intro-em" id="loginIntroTitleAccent">без лишних шагов.</em>',
    );

    setText('registerStep1Title', isEn ? 'Choose @handle' : 'Выберите @ник');
    setText(
        'registerStep1Sub',
        isEn
            ? 'People will find you by this handle. You can add your display name later.'
            : 'По нему вас найдут. Имя для чатов можно добавить позже.',
    );
    setText('loginUsernameLabel', isEn ? '@ handle' : '@ ник');
    setText('loginMnemonicLabel', isEn ? '12 or 24 words separated by spaces' : '12 или 24 слова через пробел');
    setText('loginTotpCodeLabel', isEn ? 'Code from authenticator app' : 'Код из приложения-аутентификатора');
    setText(
        'loginTotpHelpText',
        isEn
            ? 'Open Google Authenticator or Microsoft Authenticator → enter the 6-digit code'
            : 'Откройте Google Authenticator или Microsoft Authenticator → введите 6-значный код',
    );
    setText(
        'reg_username_hint',
        isEn ? 'Allowed characters: a-z, 0-9, _' : 'Допустимые символы: a-z, 0-9, _',
    );
    setText(
        'registerUsernameNote',
        isEn ? 'Used for sign-in and contact search.' : 'Нужен для входа и поиска контактов.',
    );
    setAttr('reg_username', 'placeholder', isEn ? 'your_username' : 'ваш_username');

    setText('registerBtnText', isEn ? 'Continue' : 'Продолжить');
    setHtml('loginOtherBackBtn', isEn ? '&larr; Back' : '&larr; Назад');
    setHtml('registerStep2BackBtn', isEn ? '&larr; Back' : '&larr; Назад');
    setHtml('registerStep3BackBtn', isEn ? '&larr; Back' : '&larr; Назад');

    setText('registerStep2Title', isEn ? 'Recovery phrase, 12 words' : 'Фраза восстановления, 12 слов');
    setText(
        'registerStep2Sub',
        isEn
            ? 'These words restore encrypted chats. SUN cannot recover them for you.'
            : 'Эти слова возвращают доступ к зашифрованным чатам. SUN не сможет восстановить их за вас.',
    );
    setText('registerMnemonicRevealText', isEn ? 'Reveal' : 'Показать');
    setText('copyPrivateKeyBtnLabel', isEn ? 'Copy' : 'Скопировать');
    setText('registerStep2NextLabel', isEn ? 'Saved, check words' : 'Сохранил, проверить');

    setText('registerStep3Title', isEn ? 'Check recovery words' : 'Проверка фразы');
    setText(
        'registerStep3Sub',
        isEn
            ? 'Enter two words so we know recovery was saved.'
            : 'Введите два слова, чтобы подтвердить сохранение.',
    );
    setText('registerStep3ContinueLabel', isEn ? 'Continue' : 'Продолжить');
    setText('registerStep3ShowWordsBtn', isEn ? 'Show the words again' : 'Показать слова ещё раз');

    setText('registerStep4Title', isEn ? 'Done.' : 'Готово.');
    setText(
        'registerStep4Sub',
        isEn
            ? 'Account created. Message history is stored only on your devices.'
            : 'Аккаунт создан. История пишется только на ваших устройствах.',
    );
    setText('registerNextStepsTitle', isEn ? 'Next step' : 'Следующий шаг');
    setText(
        'registerNextStepsSub',
        isEn
            ? 'Start with one trusted person: show your QR or find them by @handle.'
            : 'Начните с одного близкого человека: покажите ему QR или найдите по @нику.',
    );
    setText('registerDoneQrLabel', isEn ? 'Show my QR' : 'Показать мой QR');
    setText('registerDoneFindLabel', isEn ? 'Find a person' : 'Найти человека');
    setText(
        'registerRequestHint',
        isEn
            ? 'If someone sends you a request, it will appear at the top in Requests.'
            : 'Если вам отправят запрос, он появится сверху в разделе «Запросы».',
    );
    setText('registerDoneLoginLabel', isEn ? 'Open messenger' : 'Открыть мессенджер');

    setText('authLegalEyebrow', isEn ? '— documents & support —' : '— документы и поддержка —');
    setHtml(
        'authLegalTitle',
        isEn
            ? 'If you want to <em id="authLegalTitleAccent">dig deeper.</em>'
            : 'Если хочется <em id="authLegalTitleAccent">разобраться глубже.</em>',
    );
    setText(
        'authLegalSub',
        isEn
            ? 'Legal documents, security details and feedback — all in one place, no fine-print scroll wall.'
            : 'Юридические документы, безопасность и обратная связь — собрали всё в одном месте, без бесконечного скролла мелким шрифтом.',
    );
    setText('authLegalLinkTrustTitle', isEn ? 'Trust center' : 'Центр доверия');
    setText('authLegalLinkPrivacyTitle', isEn ? 'Privacy policy' : 'Политика приватности');
    setText('authLegalLinkTermsTitle', isEn ? 'Terms of service' : 'Условия сервиса');
    setText('authLegalLinkFaqTitle', isEn ? 'Security FAQ' : 'FAQ по безопасности');
    setText('authLegalLinkAboutTitle', isEn ? 'About the project' : 'О проекте');
    setText('authLegalLinkGuideTitle', isEn ? 'Onboarding guide' : 'Гид по началу');
    setText('authLegalLinkTrustDesc', isEn ? 'How we store data and who sees what' : 'Как мы храним данные и кто видит что');
    setText('authLegalLinkPrivacyDesc', isEn ? 'What we collect and why' : 'Какие данные собираем и зачем');
    setText('authLegalLinkTermsDesc', isEn ? 'Rules for using SUN' : 'Правила использования SUN');
    setText('authLegalLinkFaqDesc', isEn ? 'Encryption, keys, recovery' : 'Шифрование, ключи, восстановление');
    setText('authLegalLinkAboutDesc', isEn ? 'Team, mission, open source' : 'Команда, миссия, открытый код');
    setText('authLegalLinkGuideDesc', isEn ? 'What to do after signing up' : 'Что делать после регистрации');
    setText('authFeedbackEyebrow', isEn ? 'feedback' : 'обратная связь');
    setText(
        'authFeedbackTitle',
        isEn
            ? 'Something unclear? Write to us — we read every message.'
            : 'Что-то непонятно? Напишите нам — мы читаем каждое сообщение.',
    );
    setText('authFeedbackAction', isEn ? 'Send feedback →' : 'Написать →');
    setText('authDocsTagline', isEn ? 'private chats without the noise' : 'личная связь без лишнего шума');
    setAttr('authLegalLinks', 'aria-label', isEn ? 'Legal and support links' : 'Юридические документы');
    setAttr('authPreferencesDock', 'aria-label', isEn ? 'Interface settings' : 'Настройки интерфейса');
    setAttr('authLanguageSwitch', 'aria-label', isEn ? 'Interface language' : 'Язык интерфейса');
    setAttr('themeToggleBtn', 'title', isEn ? 'Theme, switch theme' : 'Тема, переключить тему');
    setAttr('themeToggleBtn', 'aria-label', isEn ? 'Theme, switch theme' : 'Тема, переключить тему');
    setText('themeToggleLabel', isEn ? 'Theme' : 'Тема');

    setText(
        'authFooterEyebrow',
        isEn
            ? 'END-TO-END ENCRYPTION ・ ZERO KNOWLEDGE'
            : 'СКВОЗНОЕ ШИФРОВАНИЕ ・ НУЛЕВОЕ ЗНАНИЕ',
    );
    setText(
        'authFooterQuote',
        isEn
            ? "\"The server can't see your messages. Just you and the person you're talking to.\""
            : '«Сервер не видит сообщения. Только вы и тот, с кем вы говорите.»',
    );
    setText(
        'authHeroHintText',
        isEn
            ? 'point your camera at the QR on the right →'
            : 'наведите камеру на QR справа →',
    );

    const progressTextNode = document.getElementById('registerFlowProgressText');
    if (progressTextNode) {
        const step = Number(document.querySelector('.auth-register-progress')?.dataset.step || '1');
        const totalSteps = 3;
        const ru = { 1: 'Данные аккаунта', 2: '12 слов', 3: 'Проверка' };
        const en = { 1: 'Account details', 2: '12 words', 3: 'Check' };
        const safeStep = Math.min(totalSteps, Math.max(1, Number.isFinite(step) ? step : 1));
        progressTextNode.textContent = isEn
            ? `Step ${safeStep} of ${totalSteps} — ${en[safeStep]}`
            : `Шаг ${safeStep} из ${totalSteps} — ${ru[safeStep]}`;
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
