import { applySunQrBrand, clearSunQrBrand } from '../qr-brand.js';

const DESIGN_QR_LIFETIME_MS = 14_000;

function ensureLoginQrSkeleton(container) {
    if (!container) return null;
    let skeleton = container.querySelector('.auth-qr-login-skeleton');
    if (!skeleton) {
        skeleton = document.createElement('div');
        skeleton.className = 'auth-qr-login-skeleton';
        skeleton.setAttribute('aria-hidden', 'true');
        container.appendChild(skeleton);
    }
    return skeleton;
}

export function createQrLoginFlow({
    tr,
    showToast,
    assertWebCryptoSupport,
    withAppRoot,
    getCsrfToken,
    deriveTransferKey,
    decryptPrivateKeyPem,
    onCompleteLogin,
    isQrModeEnabled,
}) {
    const loginQrState = {
        sessionId: '',
        receiverPrivateKey: null,
        pollTimer: 0,
        refreshTimer: 0,
        autoStartTimer: 0,
        busy: false,
        qrText: '',
        expiresInMs: DESIGN_QR_LIFETIME_MS,
        flowSeq: 0,
        activeLayer: 0,
    };

    function setLoginQrStatus(text) {
        const statusEl = document.getElementById('loginQrStatus');
        if (!statusEl) return;
        const value = String(text || '').trim();
        const hiddenStatuses = new Set([
            'Готовим QR…',
            'Сканируйте QR',
            'Подтверждение…',
            'Вход…',
        ]);
        if (!value || hiddenStatuses.has(value)) {
            statusEl.textContent = '';
            statusEl.hidden = true;
            return;
        }
        statusEl.hidden = false;
        statusEl.textContent = value;
    }

    function clearLoginQrTimers() {
        if (loginQrState.pollTimer) {
            window.clearTimeout(loginQrState.pollTimer);
            loginQrState.pollTimer = 0;
        }
        if (loginQrState.refreshTimer) {
            window.clearTimeout(loginQrState.refreshTimer);
            loginQrState.refreshTimer = 0;
        }
        if (loginQrState.autoStartTimer) {
            window.clearTimeout(loginQrState.autoStartTimer);
            loginQrState.autoStartTimer = 0;
        }
    }

    function setLoginQrRing(state, durationMs = 75_000) {
        const ring = document.getElementById('loginQrRing');
        if (!ring) return;
        const progress = ring.querySelector('.auth-qr-login-ring-progress');
        if (state === 'reset') {
            ring.classList.remove('is-running', 'is-warning', 'is-active');
            if (progress) {
                progress.style.animation = 'none';
                progress.getBoundingClientRect();
                progress.style.animation = '';
            }
            return;
        }
        if (state === 'start') {
            ring.classList.remove('is-warning');
            ring.style.setProperty('--ring-duration', `${Math.max(1, durationMs) / 1000}s`);
            if (progress) {
                progress.style.animation = 'none';
                progress.getBoundingClientRect();
                progress.style.animation = '';
            }
            ring.classList.add('is-active', 'is-running');
            window.setTimeout(() => {
                if (ring.classList.contains('is-running')) {
                    ring.classList.add('is-warning');
                }
            }, Math.max(0, durationMs - 12_000));
            return;
        }
        if (state === 'success') {
            ring.classList.remove('is-running', 'is-warning');
            if (progress) {
                progress.style.animation = 'none';
                progress.style.strokeDashoffset = '0';
            }
        }
    }

    function setLoginQrPulse(active) {
        const container = document.getElementById('loginQrCodeContainer');
        if (!container) return;
        container.classList.toggle('is-pulsing', !!active);
    }

    function isEnglishUi() {
        const raw = document.body?.dataset?.uiLanguage || document.documentElement.lang || '';
        return String(raw).toLowerCase() === 'en';
    }

    function qrRefreshButtonLabel() {
        return isEnglishUi() ? '↻ Refresh QR' : '↻ Обновить QR';
    }

    function defaultQrHelperText() {
        const intro = document.getElementById('loginIntroSub');
        const text = String(intro?.textContent || '').trim();
        return text || tr('Сканируйте QR');
    }

    function setLoginQrExpiredVisual(expired) {
        const container = document.getElementById('loginQrCodeContainer');
        if (!container) return;
        container.classList.toggle('is-expired', !!expired);
    }

    function hideLoginQrRefreshButton() {
        const button = document.getElementById('loginQrRefreshBtn');
        if (button) {
            button.hidden = true;
        }
    }

    function showLoginQrRefreshButton(onRefresh) {
        const container = document.getElementById('loginQrCodeContainer');
        if (!container) return;
        let button = document.getElementById('loginQrRefreshBtn');
        if (!button) {
            button = document.createElement('button');
            button.id = 'loginQrRefreshBtn';
            button.type = 'button';
            button.className = 'auth-btn auth-btn-accent auth-qr-login-refresh-btn';
            button.hidden = true;
            container.appendChild(button);
        }
        button.textContent = qrRefreshButtonLabel();
        button.hidden = false;
        button.onclick = () => {
            button.hidden = true;
            setLoginQrStatus('Готовим QR…');
            setLoginQrExpiredVisual(false);
            if (typeof onRefresh === 'function') {
                onRefresh();
            }
        };
    }

    function enterExpiredQrState() {
        clearLoginQrTimers();
        setLoginQrPulse(false);
        setLoginQrStatus(tr('QR-сессия завершена. Обновите QR.'));
        setLoginQrExpiredVisual(true);
        wipeLoginQrSecrets();
        showLoginQrRefreshButton(() => {
            startLoginQrFlow().catch((err) => {
                setLoginQrStatus(String(err?.message || 'Не удалось обновить QR.'));
                showToast(String(err?.message || 'Не удалось обновить QR.'), 'error');
            });
        });
    }

    function resetLoginQrUi() {
        const container = document.getElementById('loginQrCodeContainer');
        if (container) {
            container.classList.remove('sun-qr-login-brand-mode');
            container.classList.remove('is-expired');
            const ring = container.querySelector('.auth-qr-login-ring');
            container.innerHTML = '';
            delete container.dataset.qrLayersReady;
            if (ring) container.appendChild(ring);
            clearSunQrBrand(container);
        }
        loginQrState.activeLayer = 0;
        setLoginQrRing('reset');
        setLoginQrPulse(false);
        hideLoginQrRefreshButton();
    }

    function wipeLoginQrSecrets() {
        loginQrState.sessionId = '';
        loginQrState.receiverPrivateKey = null;
        loginQrState.qrText = '';
        loginQrState.busy = false;
    }

    async function renderLoginQrCode(qrText) {
        const container = document.getElementById('loginQrCodeContainer');
        if (!container) return;
        container.classList.add('sun-qr-login-brand-mode');
        if (!container.dataset.qrLayersReady) {
            const ring = container.querySelector('.auth-qr-login-ring');
            container.innerHTML = '';
            if (ring) container.appendChild(ring);
            const first = document.createElement('div');
            first.className = 'auth-qr-login-layer is-active';
            first.dataset.layer = '0';
            const second = document.createElement('div');
            second.className = 'auth-qr-login-layer';
            second.dataset.layer = '1';
            container.append(first, second);
            container.dataset.qrLayersReady = '1';
            loginQrState.activeLayer = 0;
        }
        setLoginQrExpiredVisual(false);
        hideLoginQrRefreshButton();
        const skeleton = ensureLoginQrSkeleton(container);
        if (typeof window.ensureQrCodeLibrary === 'function') {
            await window.ensureQrCodeLibrary();
        }
        if (typeof window.QRCode !== 'function') {
            throw new Error('QR библиотека не загружена.');
        }
        const inactiveLayer = container.querySelector(`.auth-qr-login-layer[data-layer="${loginQrState.activeLayer ? 0 : 1}"]`);
        const activeLayer = container.querySelector(`.auth-qr-login-layer[data-layer="${loginQrState.activeLayer}"]`);
        if (!inactiveLayer || !activeLayer) return;

        inactiveLayer.innerHTML = '';
        const qrSize = 288;
        const quietZonePx = 16;
        new window.QRCode(inactiveLayer, {
            text: qrText,
            width: qrSize,
            height: qrSize,
            colorDark: '#000000',
            colorLight: '#ffffff',
            correctLevel: window.QRCode.CorrectLevel.M,
        });
        const qrImage = inactiveLayer.querySelector('img');
        if (qrImage instanceof HTMLImageElement) {
            const finalizeImageLayer = () => {
                const layeredCanvas = inactiveLayer.querySelector('canvas');
                if (layeredCanvas instanceof HTMLCanvasElement) {
                    layeredCanvas.remove();
                }
                qrImage.style.backgroundColor = '#ffffff';
                qrImage.style.padding = `${quietZonePx}px`;
                qrImage.style.boxSizing = 'content-box';
            };
            if (qrImage.complete && Number(qrImage.naturalWidth || 0) > 0) {
                finalizeImageLayer();
            } else {
                qrImage.addEventListener('load', finalizeImageLayer, { once: true });
            }
        }

        inactiveLayer.classList.add('is-active');
        activeLayer.classList.remove('is-active');
        loginQrState.activeLayer = loginQrState.activeLayer ? 0 : 1;
        if (skeleton) {
            skeleton.classList.add('is-hidden');
        }
    }

    async function createAndRenderLoginQr() {
        const keyPair = await crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            ['deriveBits'],
        );
        const receiverPublicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);
        const response = await fetch(withAppRoot('/api/key_transfer/login/sessions'), {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRFToken': getCsrfToken(),
            },
            body: JSON.stringify({ receiver_public_jwk: receiverPublicJwk }),
        });
        const payload = await response.json();
        if (!response.ok || !payload.success || !payload.session_id || !payload.qr_text) {
            throw new Error(tr(payload.error || 'Не удалось подготовить QR вход.'));
        }

        loginQrState.sessionId = String(payload.session_id);
        loginQrState.receiverPrivateKey = keyPair.privateKey;
        loginQrState.qrText = String(payload.qr_text);
        const expiresInSeconds = Number(payload.expires_in_seconds);
        const serverExpiresMs = Number.isFinite(expiresInSeconds) && expiresInSeconds > 0
            ? Math.round(expiresInSeconds * 1000)
            : 0;
        if (Number.isFinite(expiresInSeconds) && expiresInSeconds > 0) {
            loginQrState.expiresInMs = Math.max(
                8_000,
                Math.min(DESIGN_QR_LIFETIME_MS, serverExpiresMs),
            );
        } else {
            loginQrState.expiresInMs = DESIGN_QR_LIFETIME_MS;
        }
        await renderLoginQrCode(loginQrState.qrText);
        setLoginQrStatus(defaultQrHelperText());
    }

    async function pollLoginQrClaim() {
        if (!loginQrState.sessionId || !loginQrState.receiverPrivateKey || loginQrState.busy) return;
        const seq = loginQrState.flowSeq;
        const sessionIdAtStart = loginQrState.sessionId;
        loginQrState.busy = true;
        try {
            const response = await fetch(
                withAppRoot(`/api/key_transfer/login/sessions/${encodeURIComponent(sessionIdAtStart)}/claim`),
                {
                    method: 'POST',
                    credentials: 'include',
                    headers: {
                        'X-CSRFToken': getCsrfToken(),
                    },
                },
            );
            if (seq !== loginQrState.flowSeq || sessionIdAtStart !== loginQrState.sessionId) {
                return;
            }
            const payload = await response.json().catch(() => ({}));
            if (response.status === 404) {
                if (seq !== loginQrState.flowSeq) return;
                enterExpiredQrState();
                return;
            }
            if (response.status === 410) {
                throw new Error(tr(payload.error || 'QR-сессия завершена. Обновите QR.'));
            }
            if (!response.ok) {
                throw new Error(tr(payload.error || 'Ошибка проверки QR-сессии.'));
            }
            if (!payload.success || payload.state !== 'submitted') {
                return;
            }

            setLoginQrPulse(true);
            setLoginQrStatus('Подтверждение…');

            const senderPublicKey = await crypto.subtle.importKey(
                'jwk',
                payload.sender_public_jwk,
                { name: 'ECDH', namedCurve: 'P-256' },
                true,
                [],
            );
            const aesKey = await deriveTransferKey({
                privateKey: loginQrState.receiverPrivateKey,
                publicKey: senderPublicKey,
                sessionId: sessionIdAtStart,
            });
            const privateKeyPem = await decryptPrivateKeyPem({
                cipherText: String(payload.cipher_text || ''),
                iv: String(payload.iv || ''),
                aesKey,
            });
            if (!String(privateKeyPem || '').trim()) {
                throw new Error('Получен некорректный ключ.');
            }
            const claimUsername = String(payload.username || '').trim().toLowerCase();
            if (!claimUsername) {
                throw new Error('Не удалось определить аккаунт для QR-входа.');
            }

            clearLoginQrTimers();
            setLoginQrStatus('Вход…');
            const profile = {
                username: claimUsername,
                displayName: String(payload.display_name || '').trim(),
                avatarUrl: String(payload.avatar_url || '').trim(),
            };

            const rememberDevice = !!document.getElementById('rememberDeviceCheckbox')?.checked;
            try {
                await onCompleteLogin({
                    username: claimUsername,
                    privateKeyPem,
                    rememberDevice,
                    profile,
                });
            } catch (err) {
                setLoginQrPulse(false);
                throw err;
            } finally {
                wipeLoginQrSecrets();
            }
        } finally {
            loginQrState.busy = false;
        }
    }

    async function startLoginQrFlow() {
        assertWebCryptoSupport();
        const seq = loginQrState.flowSeq + 1;
        loginQrState.flowSeq = seq;
        clearLoginQrTimers();
        setLoginQrExpiredVisual(false);
        hideLoginQrRefreshButton();
        setLoginQrStatus('Готовим QR…');

        await createAndRenderLoginQr();
        const refreshMs = Math.max(8_000, Number(loginQrState.expiresInMs) || DESIGN_QR_LIFETIME_MS);
        setLoginQrRing('start', refreshMs);
        const fastPollMs = 600;
        const slowPollMs = 1800;
        const fastWindowMs = 6_000;
        const startedAt = performance.now();

        const scheduleNext = () => {
            if (seq !== loginQrState.flowSeq) return;
            const elapsed = performance.now() - startedAt;
            const delay = elapsed < fastWindowMs ? fastPollMs : slowPollMs;
            loginQrState.pollTimer = window.setTimeout(async () => {
                if (seq !== loginQrState.flowSeq) return;
                try {
                    await pollLoginQrClaim();
                } catch (err) {
                    clearLoginQrTimers();
                    setLoginQrStatus(String(err?.message || 'QR вход прерван.'));
                    showToast(String(err?.message || 'QR вход прерван.'), 'error');
                    return;
                }
                if (seq === loginQrState.flowSeq && loginQrState.sessionId) {
                    scheduleNext();
                }
            }, delay);
        };
        scheduleNext();

        loginQrState.refreshTimer = window.setTimeout(() => {
            if (seq !== loginQrState.flowSeq) return;
            enterExpiredQrState();
        }, refreshMs);
    }

    function scheduleLoginQrAutoStart(delayMs = 420) {
        if (!isQrModeEnabled()) return;
        if (loginQrState.sessionId) return;
        if (loginQrState.autoStartTimer) {
            window.clearTimeout(loginQrState.autoStartTimer);
        }
        loginQrState.autoStartTimer = window.setTimeout(() => {
            startLoginQrFlow().catch((err) => {
                setLoginQrStatus(String(err?.message || 'Не удалось запустить QR вход.'));
                showToast(String(err?.message || 'Не удалось запустить QR вход.'), 'error');
            });
        }, Math.max(0, Number(delayMs) || 0));
    }

    function initialize() {
        if (typeof window.ensureQrCodeLibrary === 'function') {
            window.ensureQrCodeLibrary().catch(() => {});
        }
        try {
            const container = document.getElementById('loginQrCodeContainer');
            if (container) {
                ensureLoginQrSkeleton(container);
            }
        } catch (_) {
            // best-effort
        }

        window.addEventListener('beforeunload', clearLoginQrTimers);
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                clearLoginQrTimers();
                wipeLoginQrSecrets();
                return;
            }
            if (isQrModeEnabled() && !loginQrState.sessionId) {
                scheduleLoginQrAutoStart(80);
            }
        });
    }

    return {
        initialize,
        clearLoginQrTimers,
        resetLoginQrUi,
        wipeLoginQrSecrets,
        scheduleLoginQrAutoStart,
        setLoginQrRing,
        setLoginQrPulse,
        startLoginQrFlow,
    };
}
