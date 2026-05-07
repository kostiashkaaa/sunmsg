import { waitForMotionEnd } from './motion.js';

function formatVoiceSeconds(totalSeconds) {
    const safe = Math.max(0, Number(totalSeconds) || 0);
    const mins = Math.floor(safe / 60);
    const secs = Math.floor(safe % 60);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function chooseVoiceRecorderMimeType(mimeCandidates) {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
        return '';
    }
    for (const candidate of mimeCandidates) {
        if (MediaRecorder.isTypeSupported(candidate)) {
            return candidate;
        }
    }
    return '';
}

function normalizeRecordedAudioMimeType(rawMimeType) {
    const lower = String(rawMimeType || '').trim().toLowerCase();
    if (!lower) return '';
    if (lower.startsWith('video/webm')) {
        return lower.replace(/^video\/webm/i, 'audio/webm');
    }
    return lower;
}

function resolveRecordedAudioExtension(rawMimeType) {
    const normalized = normalizeRecordedAudioMimeType(rawMimeType);
    const baseMime = normalized.split(';', 1)[0].trim();
    if (baseMime === 'audio/ogg' || baseMime === 'audio/opus') return 'ogg';
    if (baseMime === 'audio/wav' || baseMime === 'audio/x-wav') return 'wav';
    if (baseMime === 'audio/mpeg' || baseMime === 'audio/mp3' || baseMime === 'audio/x-mp3') return 'mp3';
    if (baseMime === 'audio/mp4' || baseMime === 'audio/x-m4a') return 'm4a';
    if (baseMime === 'audio/aac' || baseMime === 'audio/x-aac') return 'aac';
    if (baseMime === 'audio/webm') return 'webm';
    return 'webm';
}

function getMicAccessErrorMessage(error) {
    if (!window.isSecureContext) {
        return '\u0417\u0430\u043F\u0438\u0441\u044C \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430 \u0442\u043E\u043B\u044C\u043A\u043E \u043F\u043E HTTPS \u0438\u043B\u0438 localhost.';
    }
    const name = String(error?.name || '');
    if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        return '\u0414\u043E\u0441\u0442\u0443\u043F \u043A \u043C\u0438\u043A\u0440\u043E\u0444\u043E\u043D\u0443 \u0437\u0430\u043F\u0440\u0435\u0449\u0435\u043D. \u041D\u0430\u0436\u043C\u0438\u0442\u0435 \u043D\u0430 \u0437\u043D\u0430\u0447\u043E\u043A \u0437\u0430\u043C\u043A\u0430 \u0432 \u0430\u0434\u0440\u0435\u0441\u043D\u043E\u0439 \u0441\u0442\u0440\u043E\u043A\u0435 \u0438 \u0440\u0430\u0437\u0440\u0435\u0448\u0438\u0442\u0435 \u043C\u0438\u043A\u0440\u043E\u0444\u043E\u043D \u0434\u043B\u044F \u044D\u0442\u043E\u0433\u043E \u0441\u0430\u0439\u0442\u0430.';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        return '\u041C\u0438\u043A\u0440\u043E\u0444\u043E\u043D \u043D\u0435 \u043D\u0430\u0439\u0434\u0435\u043D.';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
        return '\u041C\u0438\u043A\u0440\u043E\u0444\u043E\u043D \u0437\u0430\u043D\u044F\u0442 \u0434\u0440\u0443\u0433\u0438\u043C \u043F\u0440\u0438\u043B\u043E\u0436\u0435\u043D\u0438\u0435\u043C.';
    }
    return '\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0434\u043E\u0441\u0442\u0443\u043F \u043A \u043C\u0438\u043A\u0440\u043E\u0444\u043E\u043D\u0443.';
}

function getMediaDevicesApi() {
    if (navigator.mediaDevices?.getUserMedia) {
        return navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    }
    const legacy = navigator.getUserMedia
        || navigator.webkitGetUserMedia
        || navigator.mozGetUserMedia
        || navigator.msGetUserMedia;
    if (!legacy) return null;
    return (constraints) => new Promise((resolve, reject) => {
        legacy.call(navigator, constraints, resolve, reject);
    });
}

export function initVoiceRecorder({
    composerRow,
    messageInput,
    sendMessageBtn,
    emojiBtn,
    voiceRecordBtn,
    voiceRecordTimer,
    voiceRecordComposer,
    voiceRecordCancelBtn,
    voiceRecordSendBtn,
    maxSeconds = 180,
    mimeCandidates = [],
    getCurrentChatId,
    isChatBlocked,
    getBlockedNoticeText,
    getCurrentBlockState,
    isSendingMessage,
    isEditingMessage,
    getComposerText,
    hasPendingSendAction,
    showToast,
    onComposerStopTyping,
    onVoiceRecordingStateChange,
    sendFileMessage,
} = {}) {
    let recorder = null;
    let recordChunks = [];
    let recordStream = null;
    let recordTimerHandle = null;
    let recordStartedAt = 0;
    let isStopping = false;
    let lastRecordingUiState = false;
    let composerTransitionHandle = null;
    let composerTransitionSeq = 0;
    let lastActionIconClass = '';
    let actionIconMotionSeq = 0;
    let handledTextSubmitPointer = false;
    let handledTextSubmitTimer = null;
    let isVoiceTypingActive = false;

    function isSupported() {
        return typeof MediaRecorder !== 'undefined'
            && Boolean(getMediaDevicesApi());
    }

    function isActive() {
        return Boolean(recorder && recorder.state === 'recording');
    }

    function stopTimer() {
        if (recordTimerHandle) {
            clearInterval(recordTimerHandle);
            recordTimerHandle = null;
        }
    }

    function syncVoiceTypingState(active) {
        const next = Boolean(active);
        if (next === isVoiceTypingActive) return;
        isVoiceTypingActive = next;
        onVoiceRecordingStateChange?.(next);
    }

    function clearComposerTransition() {
        composerTransitionSeq += 1;
        composerTransitionHandle = null;
    }

    function isCoarsePointer() {
        return Boolean(window.matchMedia?.('(pointer: coarse)')?.matches);
    }

    function prefersReducedMotion() {
        if (document.documentElement.classList.contains('perf-lite')) return true;
        const motionLevel = String(document.documentElement.getAttribute('data-motion-level') || 'full').toLowerCase();
        if (motionLevel !== 'lite') return false;
        try {
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch (_) {
            return false;
        }
    }

    function stripActionIconMotionClasses(className) {
        return String(className || '')
            .split(/\s+/)
            .filter((name) => (
                name
                && name !== 'composer-action-icon'
                && name !== 'composer-action-icon--entering'
                && name !== 'composer-action-icon--leaving'
            ))
            .join(' ');
    }

    function setActionIconClass(icon, nextClassName) {
        if (!icon) return;

        const previousClassName = stripActionIconMotionClasses(icon.className);
        if (!lastActionIconClass) {
            lastActionIconClass = nextClassName;
            icon.className = nextClassName;
            return;
        }
        if (previousClassName === nextClassName) {
            icon.className = nextClassName;
            return;
        }

        const seq = ++actionIconMotionSeq;
        voiceRecordBtn?.querySelectorAll('.composer-action-icon--leaving').forEach((node) => node.remove());

        if (!prefersReducedMotion() && voiceRecordBtn) {
            const leavingIcon = icon.cloneNode(false);
            leavingIcon.setAttribute('aria-hidden', 'true');
            leavingIcon.className = `${previousClassName} composer-action-icon composer-action-icon--leaving`;
            voiceRecordBtn.appendChild(leavingIcon);
            waitForMotionEnd(leavingIcon, 430).then(() => {
                leavingIcon.remove();
            });

            icon.className = `${nextClassName} composer-action-icon composer-action-icon--entering`;
            waitForMotionEnd(icon, 430).then(() => {
                if (seq !== actionIconMotionSeq) return;
                icon.className = nextClassName;
            });
        } else {
            icon.className = nextClassName;
        }

        lastActionIconClass = nextClassName;
    }

    function submitTextMessageFromUnifiedButton() {
        const messageForm = document.getElementById('messageForm');
        if (!messageForm) return false;
        if (typeof messageForm.requestSubmit === 'function') {
            messageForm.requestSubmit();
        } else {
            messageForm.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
        }
        return true;
    }

    function keepComposerFocused() {
        if (!messageInput || messageInput.disabled) return;
        try {
            messageInput.focus({ preventScroll: true });
        } catch (_) {
            messageInput.focus();
        }
    }

    function updateTimerDisplay() {
        if (!voiceRecordTimer) return;
        if (!isActive()) {
            voiceRecordTimer.textContent = '00:00';
            return;
        }
        const elapsed = Math.floor((Date.now() - recordStartedAt) / 1000);
        voiceRecordTimer.textContent = formatVoiceSeconds(elapsed);
    }

    function stopStream() {
        if (!recordStream) return;
        try {
            recordStream.getTracks().forEach((track) => {
                try {
                    track.stop();
                } catch (_) {}
            });
        } catch (_) {}
        recordStream = null;
    }

    function runComposerTransition(recording) {
        if (!composerRow) return;
        const transitionSeq = ++composerTransitionSeq;
        composerRow.classList.remove('is-voice-entering', 'is-voice-exiting');
        clearComposerTransition();
        composerTransitionSeq = transitionSeq;
        composerRow.classList.add(recording ? 'is-voice-entering' : 'is-voice-exiting');
        composerTransitionHandle = waitForMotionEnd(composerRow, 360).then(() => {
            if (transitionSeq !== composerTransitionSeq) return;
            composerRow.classList.remove('is-voice-entering', 'is-voice-exiting');
            composerTransitionHandle = null;
        });
    }

    function updateButtonState() {
        if (!voiceRecordBtn) return;
        const recording = isActive();
        if (recording !== lastRecordingUiState) {
            runComposerTransition(recording);
            lastRecordingUiState = recording;
        }

        const hasChatTarget = Boolean(getCurrentChatId?.()) && !isChatBlocked();
        const hasComposerText = Boolean(String(getComposerText?.() || '').trim());
        const hasPendingAction = Boolean(hasPendingSendAction?.());
        const showSendAction = hasChatTarget && !recording && (hasComposerText || hasPendingAction || isEditingMessage());
        const canUseVoice = hasChatTarget
            && !isChatBlocked()
            && !isSendingMessage()
            && isSupported();
        const canSendText = showSendAction && !isSendingMessage();
        const canUseUnifiedAction = recording
            ? false
            : (showSendAction ? canSendText : canUseVoice);

        if (!showSendAction) {
            clearTimeout(handledTextSubmitTimer);
            handledTextSubmitPointer = false;
        }

        if (composerRow) {
            composerRow.classList.toggle('is-voice-recording', recording);
            composerRow.classList.toggle('show-send-action', showSendAction);
        }
        if (voiceRecordComposer) {
            voiceRecordComposer.setAttribute('aria-hidden', recording ? 'false' : 'true');
        }
        if (messageInput) {
            messageInput.readOnly = recording;
            messageInput.setAttribute('aria-readonly', recording ? 'true' : 'false');
        }
        voiceRecordBtn.disabled = !canUseUnifiedAction;
        const icon = voiceRecordBtn.querySelector('i');
        if (icon) {
            setActionIconClass(icon, showSendAction ? 'bi bi-send-fill' : 'bi bi-mic-fill');
        }
        voiceRecordBtn.classList.toggle('is-send-state', showSendAction && !recording);
        voiceRecordBtn.classList.toggle('is-mic-state', !showSendAction && !recording);
        voiceRecordBtn.classList.toggle('is-recording-state', recording);
        const actionLabel = showSendAction ? '\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435' : '\u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0435';
        voiceRecordBtn.setAttribute('aria-hidden', recording ? 'true' : 'false');
        voiceRecordBtn.setAttribute('aria-label', actionLabel);
        voiceRecordBtn.title = actionLabel;
        if (sendMessageBtn) {
            sendMessageBtn.disabled = true;
            sendMessageBtn.setAttribute('aria-hidden', 'true');
            sendMessageBtn.tabIndex = -1;
        }
        if (emojiBtn) {
            emojiBtn.disabled = recording || !hasChatTarget;
        }
        if (voiceRecordCancelBtn) {
            const cancelVisible = recording && !isStopping;
            voiceRecordCancelBtn.disabled = !cancelVisible;
            voiceRecordCancelBtn.setAttribute('aria-hidden', cancelVisible ? 'false' : 'true');
            voiceRecordCancelBtn.tabIndex = cancelVisible ? 0 : -1;
        }
        if (voiceRecordSendBtn) {
            const sendVisible = recording && !isStopping;
            voiceRecordSendBtn.disabled = !sendVisible;
            voiceRecordSendBtn.setAttribute('aria-hidden', sendVisible ? 'false' : 'true');
            voiceRecordSendBtn.tabIndex = sendVisible ? 0 : -1;
        }
        if (!recording && voiceRecordTimer) {
            voiceRecordTimer.textContent = '00:00';
        }
    }

    function startTimer() {
        stopTimer();
        updateTimerDisplay();
        recordTimerHandle = setInterval(() => {
            if (!isActive()) {
                stopTimer();
                updateButtonState();
                return;
            }
            updateTimerDisplay();
            const elapsed = Math.floor((Date.now() - recordStartedAt) / 1000);
            if (elapsed >= maxSeconds) {
                stop({ reason: 'max-duration' }).catch(() => {});
            }
        }, 250);
    }

    const handleTextSubmitPress = (event) => {
        if (handledTextSubmitPointer) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        if (!isCoarsePointer()) return;
        if (!voiceRecordBtn.classList.contains('is-send-state')) return;
        if (voiceRecordBtn.disabled || isSendingMessage()) return;

        event.preventDefault();
        event.stopPropagation();
        clearTimeout(handledTextSubmitTimer);
        handledTextSubmitPointer = true;
        keepComposerFocused();
        submitTextMessageFromUnifiedButton();
        handledTextSubmitTimer = setTimeout(() => {
            handledTextSubmitPointer = false;
        }, 450);
    };

    if (voiceRecordBtn) {
        voiceRecordBtn.addEventListener('pointerdown', handleTextSubmitPress, true);
        voiceRecordBtn.addEventListener('touchstart', handleTextSubmitPress, { capture: true, passive: false });

        voiceRecordBtn.addEventListener('click', (event) => {
            if (!handledTextSubmitPointer) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            clearTimeout(handledTextSubmitTimer);
            handledTextSubmitPointer = false;
        }, true);
    }

    async function requestMicrophoneStream() {
        const getUserMedia = getMediaDevicesApi();
        if (!getUserMedia) {
            throw new Error('API MediaDevices недоступен.');
        }

        const attempts = [
            {
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                },
            },
            { audio: true },
            {
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            },
        ];
        let lastError = null;
        for (const constraints of attempts) {
            try {
                return await getUserMedia(constraints);
            } catch (err) {
                lastError = err;
            }
        }
        throw lastError || new Error('Microphone request failed');
    }

    async function stop({ reason = '' } = {}) {
        const activeRecorder = recorder;
        if (!activeRecorder) return null;
        if (isStopping) return null;
        isStopping = true;
        updateButtonState();

        try {
            const blob = await new Promise((resolve) => {
                const finish = () => {
                    const mime = activeRecorder.mimeType || 'audio/webm';
                    const recordedBlob = new Blob(recordChunks, { type: mime });
                    resolve(recordedBlob);
                };
                activeRecorder.addEventListener('stop', finish, { once: true });
                try {
                    if (activeRecorder.state !== 'inactive') {
                        activeRecorder.stop();
                    } else {
                        finish();
                    }
                } catch (_) {
                    finish();
                }
            });

            recorder = null;
            stopTimer();
            stopStream();
            syncVoiceTypingState(false);
            updateButtonState();

            const tooShort = blob.size < 1200;
            const canceled = reason === 'cancel';
            const shouldSend = reason === 'send' || reason === 'max-duration';
            if (canceled || !shouldSend || tooShort) {
                if (!canceled && tooShort) {
                    showToast('\u0413\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0435 \u0441\u043B\u0438\u0448\u043A\u043E\u043C \u043A\u043E\u0440\u043E\u0442\u043A\u043E\u0435.', 'warning');
                }
                recordChunks = [];
                return null;
            }

            const ts = new Date().toISOString().replace(/[:.]/g, '-');
            const recordedSeconds = Math.max(
                1,
                Math.floor((Date.now() - recordStartedAt) / 1000) || 1,
            );
            const normalizedMime = normalizeRecordedAudioMimeType(blob.type || activeRecorder.mimeType);
            const extension = resolveRecordedAudioExtension(normalizedMime);
            const file = new File([blob], `voice-${ts}.${extension}`, {
                type: normalizedMime || 'audio/webm',
            });
            recordChunks = [];
            await sendFileMessage(file, '', { audioDurationSeconds: recordedSeconds });
            return file;
        } finally {
            isStopping = false;
            recorder = null;
            recordChunks = [];
            stopTimer();
            stopStream();
            syncVoiceTypingState(false);
            updateButtonState();
        }
    }

    async function start() {
        if (!isSupported()) {
            showToast('\u0411\u0440\u0430\u0443\u0437\u0435\u0440 \u043D\u0435 \u043F\u043E\u0434\u0434\u0435\u0440\u0436\u0438\u0432\u0430\u0435\u0442 \u0437\u0430\u043F\u0438\u0441\u044C \u0433\u043E\u043B\u043E\u0441\u0430.', 'warning');
            return;
        }
        if (isActive()) return;
        if (!getCurrentChatId?.()) {
            showToast('\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435 \u0447\u0430\u0442.', 'warning');
            return;
        }
        if (isChatBlocked()) {
            showToast(getBlockedNoticeText(getCurrentBlockState?.()), 'warning');
            return;
        }
        if (isSendingMessage() || isStopping) return;

        let stream;
        try {
            stream = await requestMicrophoneStream();
        } catch (err) {
            showToast(getMicAccessErrorMessage(err), 'danger');
            return;
        }

        const options = {};
        const mime = chooseVoiceRecorderMimeType(mimeCandidates);
        if (mime) {
            options.mimeType = mime;
        }

        try {
            recordStream = stream;
            recordChunks = [];
            recorder = new MediaRecorder(stream, options);
            recorder.addEventListener('dataavailable', (event) => {
                if (event?.data && event.data.size > 0) {
                    recordChunks.push(event.data);
                }
            });
            recorder.start(250);
            recordStartedAt = Date.now();
            if (document.activeElement === messageInput) {
                messageInput.blur();
            }
            onComposerStopTyping?.();
            syncVoiceTypingState(true);
            startTimer();
            updateButtonState();
        } catch (_) {
            stopStream();
            syncVoiceTypingState(false);
            showToast('\u0417\u0430\u043F\u0438\u0441\u044C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0433\u043E \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430 \u0432 \u044D\u0442\u043E\u043C \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0435.', 'danger');
            updateButtonState();
        }
    }

    function cleanup() {
        if (isActive()) {
            try {
                recorder.stop();
            } catch (_) {}
        }
        recorder = null;
        recordChunks = [];
        stopTimer();
        stopStream();
        syncVoiceTypingState(false);
        clearComposerTransition();
    }

    return {
        isSupported,
        isActive,
        start,
        stop,
        updateButtonState,
        cleanup,
    };
}
