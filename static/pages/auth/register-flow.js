export function initRegisterFlow({
    tr,
    showToast,
    setSubmitButtonState,
    showAuthSuccessOverlay,
    assertWebCryptoSupport,
    withAppRoot,
    getCsrfToken,
    setCsrfToken,
    stagePrivateKeyForRedirect,
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

    const registerStep1BackBtn = document.getElementById('registerStep1BackBtn');
    const registerStep2BackBtn = document.getElementById('registerStep2BackBtn');
    const registerStep3BackBtn = document.getElementById('registerStep3BackBtn');

    const privateKeyContent = document.getElementById('privateKeyContent');
    const registerWordsGrid = document.getElementById('registerWordsGrid');
    const registerWordsWrap = document.getElementById('registerWordsWrap');
    const registerMnemonicRevealBtn = document.getElementById('registerMnemonicRevealBtn');
    const registerStep2NextBtn = document.getElementById('registerStep2NextBtn');

    const registerMnemonicConfirmPromptA = document.getElementById('registerMnemonicConfirmPromptA');
    const registerMnemonicConfirmPromptB = document.getElementById('registerMnemonicConfirmPromptB');
    const registerMnemonicConfirmA = document.getElementById('registerMnemonicConfirmA');
    const registerMnemonicConfirmB = document.getElementById('registerMnemonicConfirmB');
    const registerMnemonicConfirmError = document.getElementById('registerMnemonicConfirmError');
    const registerMnemonicConfirmBtn = document.getElementById('registerMnemonicConfirmBtn');
    const registerStep3ShowWordsBtn = document.getElementById('registerStep3ShowWordsBtn');

    const registerDoneLoginBtn = document.getElementById('registerDoneLoginBtn');
    const registerDoneLoginLabel = document.getElementById('registerDoneLoginLabel');
    const registerStep4Title = document.getElementById('registerStep4Title');
    const registerStep4Sub = document.getElementById('registerStep4Sub');
    const registerDoneName = document.getElementById('registerDoneName');
    const registerDoneUsername = document.getElementById('registerDoneUsername');
    const registerDoneAvatar = document.getElementById('registerDoneAvatar');

    const flowState = {
        step: 1,
        mnemonic: '',
        words: [],
        confirmIndexes: [0, 1],
        wordsRevealed: false,
        profile: {
            username: '',
            displayName: '',
            avatarUrl: '',
        },
        privateKeyPem: '',
    };

    function normalizeWord(value) {
        return String(value || '').trim().toLowerCase();
    }

    function isEnglish() {
        return activeLanguage() === 'en';
    }

    function redirectToChat(overlayShown) {
        setTimeout(
            () => {
                window.location.href = withAppRoot('/chat');
            },
            overlayShown ? 1400 : 600,
        );
    }

    async function stageRegistrationPrivateKey() {
        const pem = String(flowState.privateKeyPem || '').trim();
        if (!pem || typeof stagePrivateKeyForRedirect !== 'function') {
            return false;
        }
        try {
            const staged = await stagePrivateKeyForRedirect(pem, {
                rememberDevice: true,
                notify: true,
            });
            return Boolean(staged);
        } catch (_) {
            return false;
        }
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

    function renderDoneStepCopy() {
        const en = isEnglish();
        if (registerStep4Title) {
            registerStep4Title.textContent = en ? 'Done.' : 'Готово.';
        }
        if (registerStep4Sub) {
            registerStep4Sub.textContent = en
                ? 'Account created. Message history is stored only on your devices.'
                : 'Аккаунт создан. История пишется только на ваших устройствах.';
        }
        if (registerDoneLoginLabel) {
            registerDoneLoginLabel.textContent = en ? 'Open messenger' : 'Открыть мессенджер';
        }
    }

    function renderDoneProfileCard() {
        const username = String(flowState.profile.username || '').trim();
        const displayName = String(flowState.profile.displayName || '').trim();
        const fallbackName = isEnglish() ? 'New user' : 'Новый пользователь';
        const fallbackUsername = isEnglish() ? '@new_user' : '@новый_пользователь';
        const baseForInitial = (displayName || username || 'S').trim();
        const avatarInitial = baseForInitial ? baseForInitial.charAt(0).toUpperCase() : 'S';

        if (registerDoneName) {
            registerDoneName.textContent = displayName || username || fallbackName;
        }
        if (registerDoneUsername) {
            registerDoneUsername.textContent = username ? `@${username}` : fallbackUsername;
        }
        if (registerDoneAvatar) {
            registerDoneAvatar.textContent = avatarInitial;
        }
    }

    function setElementHidden(element, hidden) {
        if (!element) return;
        if (hidden) {
            element.setAttribute('hidden', 'hidden');
            return;
        }
        element.removeAttribute('hidden');
    }

    function updateProgress(step) {
        const ru = {
            1: 'Данные аккаунта',
            2: 'Сохранение 24 слов',
            3: 'Маленькая проверка',
            4: 'Готово',
        };
        const en = {
            1: 'Account details',
            2: 'Save 24 words',
            3: 'Quick check',
            4: 'Done',
        };
        const language = activeLanguage() === 'en' ? 'en' : 'ru';
        const title = language === 'en' ? en[step] : ru[step];
        const progressText = language === 'en'
            ? `Step ${step} of 4 — ${title}`
            : `Шаг ${step} из 4 — ${title}`;

        document.querySelectorAll('.auth-register-progress').forEach((node) => {
            node.dataset.step = String(step);
        });

        if (registerFlowProgressText) {
            registerFlowProgressText.textContent = progressText;
        } else if (registerFlowProgress) {
            registerFlowProgress.textContent = progressText;
        }
    }

    function renderWordsGrid(words) {
        if (!registerWordsGrid) return;
        const list = words.slice(0, 24);
        registerWordsGrid.innerHTML = list
            .map((word, index) => `<div class="auth-register-word"><span class="auth-register-word-num">${index + 1}</span>${word}</div>`)
            .join('');
    }

    function syncWordsVisibility() {
        const blurred = !flowState.wordsRevealed;
        registerWordsGrid?.classList.toggle('auth-register-words-grid--blurred', blurred);
        registerWordsWrap?.classList.toggle('is-revealed', !blurred);
        if (registerMnemonicRevealBtn) {
            registerMnemonicRevealBtn.style.display = blurred ? '' : 'none';
        }
        if (registerStep2NextBtn) {
            registerStep2NextBtn.disabled = blurred;
        }
        const copyBtn = document.getElementById('copyPrivateKeyBtn');
        if (copyBtn) {
            copyBtn.disabled = blurred;
        }
    }

    function setConfirmError(message) {
        if (!registerMnemonicConfirmError) return;
        const text = tr(String(message || ''));
        registerMnemonicConfirmError.textContent = text;
        setElementHidden(registerMnemonicConfirmError, !text);
    }

    function resetMnemonicPhase(mnemonic) {
        flowState.mnemonic = String(mnemonic || '').trim();
        flowState.words = flowState.mnemonic.split(/\s+/).map(normalizeWord).filter(Boolean);
        flowState.confirmIndexes = pickTwoIndexes(flowState.words.length);
        flowState.wordsRevealed = false;

        if (privateKeyContent) {
            privateKeyContent.value = flowState.mnemonic;
        }
        renderWordsGrid(flowState.words);
        syncWordsVisibility();

        const wordLabel = isEnglish() ? 'Word' : 'Слово';
        if (registerMnemonicConfirmPromptA) {
            registerMnemonicConfirmPromptA.textContent = `${wordLabel} № ${flowState.confirmIndexes[0] + 1}`;
        }
        if (registerMnemonicConfirmPromptB) {
            registerMnemonicConfirmPromptB.textContent = `${wordLabel} № ${flowState.confirmIndexes[1] + 1}`;
        }
        if (registerMnemonicConfirmA) registerMnemonicConfirmA.value = '';
        if (registerMnemonicConfirmB) registerMnemonicConfirmB.value = '';
        setConfirmError('');
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

        document.body.classList.toggle('auth-register-flow-active', step >= 2);

        if (step === 2) {
            registerMnemonicRevealBtn?.focus();
        }
        if (step === 3) {
            registerMnemonicConfirmA?.focus();
        }
        if (step === 4) {
            renderDoneStepCopy();
            renderDoneProfileCard();
            registerDoneLoginBtn?.focus();
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

    registerStep1BackBtn?.addEventListener('click', () => {
        if (typeof window.switchTab === 'function') {
            window.switchTab('login');
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    });

    registerStep2BackBtn?.addEventListener('click', () => {
        setRegisterStep(1);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    registerStep3BackBtn?.addEventListener('click', () => {
        setRegisterStep(2);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    registerStep3ShowWordsBtn?.addEventListener('click', () => {
        setRegisterStep(2);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    registerMnemonicRevealBtn?.addEventListener('click', () => {
        flowState.wordsRevealed = true;
        syncWordsVisibility();
    });

    registerStep2NextBtn?.addEventListener('click', () => {
        if (!flowState.wordsRevealed) {
            showToast(
                isEnglish()
                    ? 'Reveal and save all 24 words first.'
                    : 'Сначала откройте и сохраните 24 слова.',
                'error',
            );
            return;
        }
        setRegisterStep(3);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    registerMnemonicConfirmBtn?.addEventListener('click', () => {
        const firstIndex = flowState.confirmIndexes[0];
        const secondIndex = flowState.confirmIndexes[1];
        const expectedA = flowState.words[firstIndex] || '';
        const expectedB = flowState.words[secondIndex] || '';
        const actualA = normalizeWord(registerMnemonicConfirmA?.value || '');
        const actualB = normalizeWord(registerMnemonicConfirmB?.value || '');

        if (actualA !== expectedA || actualB !== expectedB) {
            setConfirmError(
                isEnglish()
                    ? 'Check failed: the words do not match.'
                    : 'Проверка не пройдена: слова не совпадают.',
            );
            showToast(
                isEnglish()
                    ? 'Check your saved 24 words and try again.'
                    : 'Проверьте сохранённые 24 слова и повторите ввод.',
                'error',
            );
            return;
        }

        setConfirmError('');
        setRegisterStep(4);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    registerDoneLoginBtn?.addEventListener('click', async () => {
        registerDoneLoginBtn.disabled = true;
        try {
            const staged = await stageRegistrationPrivateKey();
            if (!staged) {
                showToast(
                    isEnglish()
                        ? 'Signed in, but key activation on this device did not complete. Open chat and restore access with your 24 words.'
                        : 'Вход выполнен, но ключ на этом устройстве не активирован. Откройте чат и восстановите доступ по 24 словам.',
                    'info',
                );
            }

            const overlayShown = typeof showAuthSuccessOverlay === 'function'
                ? showAuthSuccessOverlay({
                    username: flowState.profile.username,
                    displayName: flowState.profile.displayName,
                    avatarUrl: flowState.profile.avatarUrl,
                })
                : false;

            if (!overlayShown) {
                showToast(isEnglish() ? 'Welcome!' : 'Добро пожаловать!', 'success');
            }
            redirectToChat(overlayShown);
        } finally {
            registerDoneLoginBtn.disabled = false;
        }
    });

    registerForm?.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!registerSubmitBtn || !registerBtnText) return;

        registerSubmitBtn.disabled = true;
        registerBtnText.textContent = tr('Генерация ключей...');
        setSubmitButtonState(registerSubmitBtn, true);

        try {
            const username = document.getElementById('reg_username')?.value.trim() || '';
            const displayName = document.getElementById('reg_display_name')?.value.trim() || '';
            const hasCachedRegistration = Boolean(
                flowState.mnemonic
                && flowState.privateKeyPem
                && flowState.profile.username
                && flowState.profile.username === username,
            );

            if (hasCachedRegistration) {
                resetMnemonicPhase(flowState.mnemonic);
                setRegisterStep(2);
                showToast(
                    isEnglish()
                        ? 'Continuing with your existing 24-word recovery phrase.'
                        : 'Продолжаем с уже созданной 24-словной фразой восстановления.',
                    'info',
                );
                window.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }

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

            flowState.profile = {
                username,
                displayName,
                avatarUrl: '',
            };
            flowState.privateKeyPem = privKeyPem;

            setMnemonicToGrid(mnemonic);
            const loginUsernameInput = document.getElementById('login_username');
            if (loginUsernameInput) {
                loginUsernameInput.value = username;
            }

            resetMnemonicPhase(mnemonic);
            setRegisterStep(2);

            showToast(
                isEnglish()
                    ? 'Account created. Save all 24 words and continue.'
                    : 'Аккаунт создан. Сохраните 24 слова и продолжите.',
                'success',
            );
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } catch (err) {
            showToast(`${tr('Ошибка:')} ${tr(err?.message || '')}`.trim(), 'error');
        } finally {
            registerSubmitBtn.disabled = false;
            setSubmitButtonState(registerSubmitBtn, false);
            registerBtnText.textContent = tr('Продолжить');
        }
    });

    setRegisterStep(1);
}
