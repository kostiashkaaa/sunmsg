import { apiRequest, createReceiveSession } from './key-transfer/api.js';
import {
    SESSION_ID_RE,
    receiveState,
    scanState,
    hasRuntimePrivateKey,
} from './key-transfer/state.js';
import {
    showToast,
    openDialog,
    closeDialog,
    setText,
    setScanSuccessState,
    startScanDetectionLoop,
    clearReceivePolling,
    stopScanStream,
    attachDialogBackDropClose,
    renderReceiveQrCode,
} from './key-transfer/ui.js';
import {
    parseTransferCode,
    submitTransferForSession,
    claimAndApplyIfReady,
} from './key-transfer/crypto-flow.js';
import { assertWebCryptoSupport } from './auth/crypto-helpers.js';

function finishScanSuccess(successText, statusText) {
    setScanSuccessState(true, successText);
    setText(document.getElementById('keyTransferScanStatus'), statusText);
    const video = document.getElementById('keyTransferScanVideo');
    if (scanState.detectRaf) {
        window.cancelAnimationFrame(scanState.detectRaf);
        scanState.detectRaf = 0;
    }
    if (scanState.detectTimer) {
        window.clearInterval(scanState.detectTimer);
        scanState.detectTimer = 0;
    }
    if (video) {
        try { video.pause(); } catch (_) {}
    }
    scanState.successHideTimer = window.setTimeout(() => {
        stopScanStream(scanState);
        closeScanModal();
    }, 780);
}

async function sendProfileQrRequest(parsed, statusEl) {
    const username = String(parsed?.username || '').trim().toLowerCase();
    if (!username) {
        throw new Error('Некорректный QR профиля.');
    }
    setText(statusEl, `Отправляем запрос @${username}...`);
    const { response, payload } = await apiRequest('/send_request_by_username', {
        method: 'POST',
        body: JSON.stringify({ username }),
    });
    if (!response.ok || !payload.success) {
        throw new Error(String(payload.error || 'Не удалось отправить запрос пользователю.'));
    }
}

async function handleDetectedQrText(rawText, statusEl) {
    const parsed = parseTransferCode(rawText);
    scanState.handling = true;
    if (!parsed?.kind) {
        scanState.handling = false;
        return false;
    }

    if (parsed.kind === 'profile') {
        await sendProfileQrRequest(parsed, statusEl);
        finishScanSuccess('Профиль распознан', 'Запрос отправлен.');
        return true;
    }

    if (!parsed.sessionId) {
        scanState.handling = false;
        return false;
    }
    assertWebCryptoSupport((value) => String(value ?? ''));
    if (!hasRuntimePrivateKey()) {
        throw new Error('Сначала разблокируйте историю на этом устройстве для переноса ключа.');
    }
    setText(statusEl, 'Передаём ключ...');
    await submitTransferForSession(parsed);
    finishScanSuccess('QR-код отсканирован', 'Ключ отправлен. Выполняем вход...');
    return true;
}
function startJsQrFallbackLoop(video, statusEl) {
    if (typeof window.jsQR !== 'function') {
        setText(statusEl, 'Сканер QR недоступен: отсутствует jsQR.');
        return;
    }
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
        setText(statusEl, 'Не удалось инициализировать сканер камеры.');
        return;
    }
    const maxDecodeSide = 1280;
    let missCount = 0;
    const nativeDetector = typeof window.BarcodeDetector === 'function'
        ? new window.BarcodeDetector({ formats: ['qr_code'] })
        : null;

    setText(statusEl, 'Наведите камеру на QR-код переноса или профиля.');
    startScanDetectionLoop(scanState, async () => {
        if (!scanState.stream || scanState.handling) return;
        if (nativeDetector) {
            try {
                const barcodes = await nativeDetector.detect(video);
                if (Array.isArray(barcodes) && barcodes.length > 0) {
                    const rawValue = String(barcodes[0]?.rawValue || '').trim();
                    if (rawValue) {
                        missCount = 0;
                        await handleDetectedQrText(rawValue, statusEl);
                        return;
                    }
                }
            } catch (_) {}
        }
        const width = Number(video.videoWidth || 0);
        const height = Number(video.videoHeight || 0);
        if (!width || !height) return;

        const maxSide = Math.max(width, height);
        const baseScale = maxSide > maxDecodeSide ? (maxDecodeSide / maxSide) : 1;
        const useHighDetailFrame = missCount >= 10 && missCount % 4 === 0;
        const effectiveScale = useHighDetailFrame ? 1 : baseScale;
        const decodeWidth = Math.max(1, Math.round(width * effectiveScale));
        const decodeHeight = Math.max(1, Math.round(height * effectiveScale));
        canvas.width = decodeWidth;
        canvas.height = decodeHeight;

        try {
            const useDualInversion = missCount >= 8 && missCount % 3 === 0;
            let decoded = null;

            // Priority pass: decode central ROI in high detail (messenger-style scan zone).
            const roiScale = missCount >= 12 ? 0.72 : 0.62;
            const roiSize = Math.max(160, Math.round(Math.min(width, height) * roiScale));
            const roiX = Math.max(0, Math.floor((width - roiSize) / 2));
            const roiY = Math.max(0, Math.floor((height - roiSize) / 2));
            const roiTargetSize = Math.max(220, Math.min(1600, Math.round(roiSize * 2.05)));
            canvas.width = roiTargetSize;
            canvas.height = roiTargetSize;
            ctx.imageSmoothingEnabled = false;
            ctx.clearRect(0, 0, roiTargetSize, roiTargetSize);
            ctx.drawImage(video, roiX, roiY, roiSize, roiSize, 0, 0, roiTargetSize, roiTargetSize);
            const roiFrame = ctx.getImageData(0, 0, roiTargetSize, roiTargetSize);
            decoded = window.jsQR(roiFrame.data, roiTargetSize, roiTargetSize, {
                inversionAttempts: useDualInversion ? 'attemptBoth' : 'dontInvert',
            });

            if (!decoded || !decoded.data) {
                // Fallback pass: decode full frame (adaptive downscale).
                canvas.width = decodeWidth;
                canvas.height = decodeHeight;
                ctx.imageSmoothingEnabled = true;
                ctx.clearRect(0, 0, decodeWidth, decodeHeight);
                ctx.drawImage(video, 0, 0, decodeWidth, decodeHeight);
                const frame = ctx.getImageData(0, 0, decodeWidth, decodeHeight);
                decoded = window.jsQR(frame.data, decodeWidth, decodeHeight, {
                    inversionAttempts: useDualInversion ? 'attemptBoth' : 'dontInvert',
                });
            }

            if (!decoded || !decoded.data) {
                // If QR is still too small, run progressive center crops with extra upscale.
                const sourceCanvas = document.createElement('canvas');
                sourceCanvas.width = decodeWidth;
                sourceCanvas.height = decodeHeight;
                const frame = ctx.getImageData(0, 0, decodeWidth, decodeHeight);
                const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
                if (sourceCtx) {
                    sourceCtx.putImageData(frame, 0, 0);
                }
                const cropScales = [0.68, 0.54, 0.42];
                for (const cropScale of cropScales) {
                    if (!sourceCtx) break;
                    const cropWidth = Math.max(64, Math.round(decodeWidth * cropScale));
                    const cropHeight = Math.max(64, Math.round(decodeHeight * cropScale));
                    const cropX = Math.max(0, Math.floor((decodeWidth - cropWidth) / 2));
                    const cropY = Math.max(0, Math.floor((decodeHeight - cropHeight) / 2));
                    const upscale = 2.15;
                    const targetWidth = Math.max(64, Math.round(cropWidth * upscale));
                    const targetHeight = Math.max(64, Math.round(cropHeight * upscale));
                    canvas.width = targetWidth;
                    canvas.height = targetHeight;
                    ctx.imageSmoothingEnabled = false;
                    ctx.clearRect(0, 0, targetWidth, targetHeight);
                    ctx.drawImage(sourceCanvas, cropX, cropY, cropWidth, cropHeight, 0, 0, targetWidth, targetHeight);
                    const croppedFrame = ctx.getImageData(0, 0, targetWidth, targetHeight);
                    decoded = window.jsQR(croppedFrame.data, targetWidth, targetHeight, {
                        inversionAttempts: useDualInversion ? 'attemptBoth' : 'dontInvert',
                    });
                    if (decoded && decoded.data) break;
                }
            }
            if (!decoded || !decoded.data) {
                missCount += 1;
                return;
            }
            missCount = 0;
            await handleDetectedQrText(String(decoded.data || '').trim(), statusEl);
        } catch (err) {
            setText(statusEl, String(err?.message || 'Ошибка передачи ключа.'));
            showToast(String(err?.message || 'Ошибка передачи ключа.'), 'danger');
        } finally {
            scanState.handling = false;
        }
    });
}

async function beginScanLoop() {
    const video = document.getElementById('keyTransferScanVideo');
    const statusEl = document.getElementById('keyTransferScanStatus');
    if (!video || !statusEl) return;

    stopScanStream(scanState);

    const mediaApi = navigator.mediaDevices;
    if (!mediaApi || typeof mediaApi.getUserMedia !== 'function') {
        setText(statusEl, 'Камера недоступна в этом браузере.');
        return;
    }

    setText(statusEl, 'Запрашиваем доступ к камере...');
    try {
        const stream = await mediaApi.getUserMedia({
            video: {
                facingMode: { ideal: 'environment' },
                width: { ideal: 1920 },
                height: { ideal: 1080 },
                frameRate: { ideal: 30, max: 60 },
            },
            audio: false,
        });
        scanState.stream = stream;
        const videoTrack = stream.getVideoTracks()[0] || null;
        if (videoTrack && typeof videoTrack.getCapabilities === 'function' && typeof videoTrack.applyConstraints === 'function') {
            const caps = videoTrack.getCapabilities() || {};
            const advanced = {};
            if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) {
                advanced.focusMode = 'continuous';
            }
            if (caps.zoom && typeof caps.zoom === 'object') {
                const minZoom = Number(caps.zoom.min);
                const maxZoom = Number(caps.zoom.max);
                if (Number.isFinite(minZoom) && Number.isFinite(maxZoom) && maxZoom >= minZoom) {
                    advanced.zoom = Math.max(minZoom, Math.min(maxZoom, 2));
                }
            }
            if (Object.keys(advanced).length > 0) {
                try {
                    await videoTrack.applyConstraints({ advanced: [advanced] });
                } catch (_) {}
            }
        }
        video.srcObject = stream;
        await video.play();
    } catch (err) {
        setText(statusEl, 'Не удалось открыть камеру. Разрешите доступ к камере в браузере.');
        showToast(String(err?.message || 'Не удалось открыть камеру.'), 'warning');
        return;
    }

    if (typeof window.jsQR !== 'function' && typeof window.ensureJsQrLibrary === 'function') {
        try {
            await window.ensureJsQrLibrary();
        } catch (_) {}
    }

    startJsQrFallbackLoop(video, statusEl);
}

function closeReceiveModal() {
    clearReceivePolling(receiveState);
    receiveState.sessionId = '';
    receiveState.receiverPrivateKey = null;
    receiveState.qrText = '';
    receiveState.onSuccess = null;
    const dialog = document.getElementById('keyTransferReceiveModal');
    closeDialog(dialog);
}

async function openReceiveModal(options = {}) {
    const dialog = document.getElementById('keyTransferReceiveModal');
    const statusEl = document.getElementById('keyTransferReceiveStatus');
    const copyBtn = document.getElementById('keyTransferReceiveCopyBtn');
    if (!dialog || !statusEl) return false;
    assertWebCryptoSupport((value) => String(value ?? ''));

    receiveState.onSuccess = typeof options.onSuccess === 'function' ? options.onSuccess : null;
    openDialog(dialog);
    setText(statusEl, 'Подготовка QR...');
    if (copyBtn) copyBtn.disabled = true;

    try {
        const created = await createReceiveSession();
        if (!created.sessionId || !created.qrText || !SESSION_ID_RE.test(created.sessionId)) {
            throw new Error('Сервер вернул некорректные данные сессии.');
        }
        receiveState.sessionId = created.sessionId;
        receiveState.receiverPrivateKey = created.privateKey;
        receiveState.qrText = created.qrText;
        await renderReceiveQrCode(created.qrText);
        if (copyBtn) copyBtn.disabled = false;
        setText(statusEl, `Ожидание подтверждения на втором устройстве (${Math.max(0, created.expiresIn)} сек).`);

        clearReceivePolling(receiveState);
        receiveState.pollTimer = window.setInterval(async () => {
            try {
                await claimAndApplyIfReady(receiveState, { closeReceiveModal });
            } catch (err) {
                clearReceivePolling(receiveState);
                setText(statusEl, String(err?.message || 'Ошибка переноса ключа.'));
                showToast(String(err?.message || 'Ошибка переноса ключа.'), 'danger');
            }
        }, 1500);
        return true;
    } catch (err) {
        setText(statusEl, String(err?.message || 'Не удалось подготовить перенос ключа.'));
        showToast(String(err?.message || 'Не удалось подготовить перенос ключа.'), 'danger');
        return false;
    }
}

function closeScanModal() {
    stopScanStream(scanState);
    scanState.handling = false;
    setScanSuccessState(false);
    const dialog = document.getElementById('keyTransferScanModal');
    closeDialog(dialog);
}

async function openScanModal() {
    const dialog = document.getElementById('keyTransferScanModal');
    const statusEl = document.getElementById('keyTransferScanStatus');
    if (!dialog) return false;
    stopScanStream(scanState);
    scanState.handling = false;
    setScanSuccessState(false);
    if (statusEl) {
        setText(statusEl, 'Запрашиваем доступ к камере...');
    }
    openDialog(dialog);
    beginScanLoop().catch((err) => {
        if (statusEl) {
            setText(statusEl, String(err?.message || 'Не удалось запустить сканирование.'));
        }
        showToast(String(err?.message || 'Не удалось запустить сканирование.'), 'danger');
    });
    return true;
}

function bindDom() {
    const receiveDialog = document.getElementById('keyTransferReceiveModal');
    const scanDialog = document.getElementById('keyTransferScanModal');
    const closeButtons = document.querySelectorAll('[data-key-transfer-close]');
    const receiveCopyBtn = document.getElementById('keyTransferReceiveCopyBtn');

    attachDialogBackDropClose(receiveDialog, closeReceiveModal);
    attachDialogBackDropClose(scanDialog, closeScanModal);

    closeButtons.forEach((button) => {
        button.addEventListener('click', () => {
            const target = button.getAttribute('data-key-transfer-close');
            if (target === 'receive') {
                closeReceiveModal();
            } else {
                closeScanModal();
            }
        });
    });

    receiveCopyBtn?.addEventListener('click', async () => {
        if (!receiveState.qrText) return;
        try {
            await navigator.clipboard.writeText(receiveState.qrText);
            showToast('Код переноса скопирован.', 'success');
        } catch (_) {
            showToast(receiveState.qrText, 'info');
        }
    });
}

document.addEventListener('DOMContentLoaded', () => {
    bindDom();

    window.sunKeyTransfer = {
        openReceiveModal,
        closeReceiveModal,
        openScanModal,
        closeScanModal,
    };
});

