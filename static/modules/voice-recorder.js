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
    voiceRecordWaveLive,
    voiceLockIndicator,
    voiceRecordTranscriptLive,
    maxSeconds = 600,
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
    isUploadInProgress,
    getUploadProgress,
    canCancelUpload,
    cancelActiveUpload,
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
    let suppressMicStartUntil = 0;
    let isVoiceTypingActive = false;
    const MIC_GHOST_CLICK_GUARD_MS = 400;

    // Speech recognition / transcription state
    let speechRecognizer = null;
    let speechFinalTranscript = '';
    let speechInterimTranscript = '';

    function getSpeechRecognitionCtor() {
        return window.SpeechRecognition || window.webkitSpeechRecognition || null;
    }

    function updateTranscriptDisplay() {
        if (!voiceRecordTranscriptLive) return;
        const text = (speechFinalTranscript + (speechInterimTranscript ? ' ' + speechInterimTranscript : '')).trim();
        voiceRecordTranscriptLive.textContent = text;
        voiceRecordTranscriptLive.setAttribute('aria-hidden', text ? 'false' : 'true');
    }

    function startTranscription() {
        const SpeechRecognitionCtor = getSpeechRecognitionCtor();
        if (!SpeechRecognitionCtor) return;
        try {
            speechFinalTranscript = '';
            speechInterimTranscript = '';
            updateTranscriptDisplay();
            speechRecognizer = new SpeechRecognitionCtor();
            speechRecognizer.continuous = true;
            speechRecognizer.interimResults = true;
            speechRecognizer.maxAlternatives = 1;
            speechRecognizer.lang = document.documentElement.lang || navigator.language || 'ru-RU';
            speechRecognizer.onresult = (event) => {
                let interim = '';
                for (let i = event.resultIndex; i < event.results.length; i += 1) {
                    const text = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        speechFinalTranscript = (speechFinalTranscript + ' ' + text).trim();
                    } else {
                        interim += text;
                    }
                }
                speechInterimTranscript = interim;
                updateTranscriptDisplay();
            };
            speechRecognizer.onerror = () => {
                speechRecognizer = null;
            };
            speechRecognizer.onend = () => {
                // Restart if still recording (browser may stop after silence)
                if (isActive() && speechRecognizer) {
                    try { speechRecognizer.start(); } catch (_) {}
                }
            };
            speechRecognizer.start();
        } catch (_) {
            speechRecognizer = null;
        }
    }

    function stopTranscription() {
        if (speechRecognizer) {
            speechRecognizer.onend = null;
            try { speechRecognizer.stop(); } catch (_) {}
            speechRecognizer = null;
        }
        speechInterimTranscript = '';
        updateTranscriptDisplay();
    }

    function flushAndStopTranscription() {
        return new Promise((resolve) => {
            if (!speechRecognizer) { resolve(); return; }
            const rec = speechRecognizer;
            const timeout = setTimeout(() => {
                rec.onresult = null;
                rec.onend = null;
                try { rec.stop(); } catch (_) {}
                speechRecognizer = null;
                speechInterimTranscript = '';
                resolve();
            }, 1200);
            rec.onend = () => {
                clearTimeout(timeout);
                speechRecognizer = null;
                speechInterimTranscript = '';
                resolve();
            };
            // Последний onresult перед onend сохранит interim как final
            rec.onresult = (event) => {
                for (let i = event.resultIndex; i < event.results.length; i += 1) {
                    const text = event.results[i][0].transcript;
                    if (event.results[i].isFinal) {
                        speechFinalTranscript = (speechFinalTranscript + ' ' + text).trim();
                    } else {
                        speechFinalTranscript = (speechFinalTranscript + ' ' + text).trim();
                    }
                }
                speechInterimTranscript = '';
            };
            try { rec.stop(); } catch (_) { clearTimeout(timeout); speechRecognizer = null; resolve(); }
        });
    }

    function getFinalTranscript() {
        return (speechFinalTranscript + (speechInterimTranscript ? ` ${speechInterimTranscript}` : '')).trim();
    }

    // Hold-to-record / lock-to-record state
    let isHoldRecording = false;
    let isLockedRecording = false;
    let holdPointerId = null;
    let holdStartClientY = 0;
    let holdStartClientX = 0;
    let holdLockReady = false;
    const HOLD_LOCK_DELTA_Y = 60;
    const HOLD_CANCEL_DELTA_X = -60;

    // Live waveform state
    const WAVE_BARS = 36;
    let waveAnalyserCtx = null;
    let waveAnalyserNode = null;
    let waveAnalyserSource = null;
    let waveAnimFrameId = null;
    let waveBarElements = null;
    const waveSmoothValues = new Float32Array(WAVE_BARS);

    function buildWaveBars() {
        if (!voiceRecordWaveLive) return;
        voiceRecordWaveLive.innerHTML = '';
        waveBarElements = [];
        for (let i = 0; i < WAVE_BARS; i += 1) {
            const bar = document.createElement('span');
            bar.className = 'voice-record-wave-bar';
            bar.style.height = '3px';
            voiceRecordWaveLive.appendChild(bar);
            waveBarElements.push(bar);
        }
    }

    function stopWaveAnimation() {
        if (waveAnimFrameId != null) {
            cancelAnimationFrame(waveAnimFrameId);
            waveAnimFrameId = null;
        }
        if (waveAnalyserSource) {
            try { waveAnalyserSource.disconnect(); } catch (_) {}
            waveAnalyserSource = null;
        }
        if (waveAnalyserCtx) {
            try { waveAnalyserCtx.close(); } catch (_) {}
            waveAnalyserCtx = null;
        }
        waveAnalyserNode = null;
        waveSmoothValues.fill(0);
        if (waveBarElements) {
            waveBarElements.forEach((bar) => { bar.style.height = '3px'; });
        }
    }

    function startWaveAnimation(stream) {
        stopWaveAnimation();
        if (!voiceRecordWaveLive || !waveBarElements || !waveBarElements.length) return;
        const AudioCtxCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtxCtor) return;
        try {
            waveAnalyserCtx = new AudioCtxCtor();
            waveAnalyserNode = waveAnalyserCtx.createAnalyser();
            waveAnalyserNode.fftSize = 128;
            waveAnalyserNode.smoothingTimeConstant = 0.5;
            waveAnalyserSource = waveAnalyserCtx.createMediaStreamSource(stream);
            waveAnalyserSource.connect(waveAnalyserNode);
            const dataArray = new Uint8Array(waveAnalyserNode.frequencyBinCount);
            const binsPerBar = Math.max(1, Math.floor(dataArray.length / WAVE_BARS));
            const maxBarHeight = 24;
            const minBarHeight = 3;

            const tick = () => {
                if (!isActive()) {
                    stopWaveAnimation();
                    return;
                }
                waveAnalyserNode.getByteFrequencyData(dataArray);
                for (let i = 0; i < WAVE_BARS; i += 1) {
                    let sum = 0;
                    const start = i * binsPerBar;
                    for (let j = 0; j < binsPerBar; j += 1) {
                        sum += (dataArray[start + j] || 0);
                    }
                    const raw = (sum / binsPerBar) / 255;
                    // Fast attack, slow decay for natural feel
                    waveSmoothValues[i] = raw > waveSmoothValues[i]
                        ? waveSmoothValues[i] * 0.5 + raw * 0.5
                        : waveSmoothValues[i] * 0.8 + raw * 0.2;
                    const height = Math.max(
                        minBarHeight,
                        Math.round(waveSmoothValues[i] * maxBarHeight),
                    );
                    waveBarElements[i].style.height = `${height}px`;
                }
                waveAnimFrameId = requestAnimationFrame(tick);
            };
            tick();
        } catch (_) {
            stopWaveAnimation();
        }
    }

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

    function clampUploadProgress(value) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric)) return 0;
        return Math.max(0, Math.min(100, Math.round(numeric)));
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
        const showUploadAction = hasChatTarget
            && !recording
            && Boolean(isUploadInProgress?.());
        const showSendAction = !showUploadAction
            && hasChatTarget
            && !recording
            && (hasComposerText || hasPendingAction || isEditingMessage());
        const canUseVoice = hasChatTarget
            && !isChatBlocked()
            && !isSendingMessage()
            && isSupported();
        const canSendText = showSendAction && !isSendingMessage();
        const canCancelActiveUpload = showUploadAction && Boolean(canCancelUpload?.());
        const canUseUnifiedAction = recording
            ? false
            : (showUploadAction ? canCancelActiveUpload : (showSendAction ? canSendText : canUseVoice));

        if (!showSendAction) {
            clearTimeout(handledTextSubmitTimer);
            handledTextSubmitPointer = false;
        }

        if (composerRow) {
            composerRow.classList.toggle('is-voice-recording', recording);
            composerRow.classList.toggle('show-send-action', showSendAction);
            composerRow.classList.toggle('show-upload-action', showUploadAction);
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
            setActionIconClass(icon, showUploadAction
                ? 'bi bi-x-lg'
                : (showSendAction ? 'bi bi-send-fill' : 'bi bi-mic-fill'));
        }
        const uploadProgress = showUploadAction ? clampUploadProgress(getUploadProgress?.()) : 0;
        voiceRecordBtn.style.setProperty('--composer-upload-progress', String(uploadProgress));
        voiceRecordBtn.setAttribute('data-upload-progress', String(uploadProgress));
        voiceRecordBtn.classList.toggle('is-uploading-state', showUploadAction && !recording);
        voiceRecordBtn.classList.toggle('is-send-state', showSendAction && !recording);
        voiceRecordBtn.classList.toggle('is-mic-state', !showSendAction && !showUploadAction && !recording);
        voiceRecordBtn.classList.toggle('is-recording-state', recording);
        const actionLabel = showUploadAction
            ? '\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u0437\u0430\u0433\u0440\u0443\u0437\u043A\u0443'
            : (showSendAction ? '\u041E\u0442\u043F\u0440\u0430\u0432\u0438\u0442\u044C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435' : '\u0417\u0430\u043F\u0438\u0441\u0430\u0442\u044C \u0433\u043E\u043B\u043E\u0441\u043E\u0432\u043E\u0435');
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
        suppressMicStartUntil = Date.now() + MIC_GHOST_CLICK_GUARD_MS;
        keepComposerFocused();
        submitTextMessageFromUnifiedButton();
        handledTextSubmitTimer = setTimeout(() => {
            handledTextSubmitPointer = false;
        }, 450);
    };

    function syncLockIndicator() {
        if (!voiceLockIndicator) return;
        voiceLockIndicator.classList.toggle('is-hold', isHoldRecording);
        voiceLockIndicator.classList.toggle('is-ready', holdLockReady);
        voiceLockIndicator.classList.toggle('is-locked', isLockedRecording);
    }

    function resetHoldState() {
        isHoldRecording = false;
        holdLockReady = false;
        holdPointerId = null;
        syncLockIndicator();
    }

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

        voiceRecordBtn.addEventListener('click', (event) => {
            if (!voiceRecordBtn.classList.contains('is-uploading-state')) return;
            if (!canCancelUpload?.()) return;
            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            cancelActiveUpload?.();
        }, true);

        // Hold-to-record: only on coarse pointer (touch) in mic state
        voiceRecordBtn.addEventListener('pointerdown', (event) => {
            if (!isCoarsePointer()) return;
            if (!voiceRecordBtn.classList.contains('is-mic-state')) return;
            if (isActive() && isLockedRecording) return;
            if (event.button !== 0 && event.pointerType !== 'touch') return;
            holdPointerId = event.pointerId;
            holdStartClientY = event.clientY;
            holdStartClientX = event.clientX;
            holdLockReady = false;
            try { voiceRecordBtn.setPointerCapture(event.pointerId); } catch (_) {}
            // Start recording; suppress the subsequent click from triggering again
            suppressMicStartUntil = 0;
            if (!isActive()) {
                start().catch(() => {});
            }
            isHoldRecording = true;
            syncLockIndicator();
        }, { passive: true });

        voiceRecordBtn.addEventListener('pointermove', (event) => {
            if (!isHoldRecording || event.pointerId !== holdPointerId) return;
            const deltaY = holdStartClientY - event.clientY;
            const deltaX = event.clientX - holdStartClientX;
            // Cancel immediately on leftward swipe
            if (deltaX < HOLD_CANCEL_DELTA_X && isActive() && !isLockedRecording) {
                resetHoldState();
                stop({ reason: 'cancel' }).catch(() => {});
                return;
            }
            const newReady = deltaY >= HOLD_LOCK_DELTA_Y;
            if (newReady !== holdLockReady) {
                holdLockReady = newReady;
                syncLockIndicator();
            }
        }, { passive: true });

        const finishHold = (event) => {
            if (!isHoldRecording) return;
            if (event.pointerId !== holdPointerId) return;
            const wasReady = holdLockReady;
            resetHoldState();
            // Suppress the ghost click that follows pointerup on touch devices
            suppressMicStartUntil = Date.now() + MIC_GHOST_CLICK_GUARD_MS;
            if (wasReady) {
                // Lock the recording — user slid up
                isLockedRecording = true;
                try { navigator.vibrate?.(40); } catch (_) {}
                syncLockIndicator();
                updateButtonState();
            } else if (isActive()) {
                // Quick release without lock → send
                stop({ reason: 'send' }).catch(() => {});
            }
        };

        voiceRecordBtn.addEventListener('pointerup', finishHold, { passive: true });
        voiceRecordBtn.addEventListener('pointercancel', (event) => {
            if (!isHoldRecording || event.pointerId !== holdPointerId) return;
            resetHoldState();
            if (isActive() && !isLockedRecording) {
                stop({ reason: 'cancel' }).catch(() => {});
            }
        }, { passive: true });
        voiceRecordBtn.addEventListener('lostpointercapture', finishHold, { passive: true });
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
            stopWaveAnimation();
            await flushAndStopTranscription();
            stopStream();
            const transcript = getFinalTranscript();
            isLockedRecording = false;
            resetHoldState();
            syncVoiceTypingState(false);
            updateButtonState();

            const elapsedMs = Math.max(0, Date.now() - recordStartedAt);
            // \u041E\u0442\u0441\u0435\u043A\u0430\u0435\u043C \u0442\u043E\u043B\u044C\u043A\u043E \u0441\u043E\u0432\u0441\u0435\u043C \u00AB\u0441\u043B\u0443\u0447\u0430\u0439\u043D\u044B\u0435\u00BB \u0442\u0430\u043F\u044B (<300 \u043C\u0441) \u2014 \u043D\u0435 \u0440\u0430\u0437\u043C\u0435\u0440,
            // \u043F\u043E\u0442\u043E\u043C\u0443 \u0447\u0442\u043E opus \u043D\u0430 \u043F\u0435\u0440\u0432\u044B\u0445 \u0441\u0435\u043A\u0443\u043D\u0434\u0430\u0445 \u043C\u043E\u0436\u0435\u0442 \u0432\u044B\u0434\u0430\u0432\u0430\u0442\u044C <1 KB.
            const tooShort = elapsedMs < 300 || blob.size < 200;
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
            await sendFileMessage(file, '', {
                audioDurationSeconds: recordedSeconds,
                typingKindHint: 'voice',
                ...(transcript ? { transcript } : {}),
            });
            return file;
        } finally {
            isStopping = false;
            recorder = null;
            recordChunks = [];
            stopTimer();
            stopStream();
            stopWaveAnimation();
            stopTranscription();
            isLockedRecording = false;
            resetHoldState();
            syncVoiceTypingState(false);
            updateButtonState();
        }
    }

    async function start() {
        if (Date.now() < suppressMicStartUntil) {
            return;
        }
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
        onComposerStopTyping?.();
        syncVoiceTypingState(true);

        let stream;
        try {
            stream = await requestMicrophoneStream();
        } catch (err) {
            syncVoiceTypingState(false);
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
            buildWaveBars();
            startWaveAnimation(stream);
            startTranscription();
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
        stopWaveAnimation();
        stopTranscription();
        isLockedRecording = false;
        resetHoldState();
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
