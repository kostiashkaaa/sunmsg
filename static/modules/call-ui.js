/**
 * call-ui.js
 * Telegram-style call UI: incoming banner + active call overlay.
 */

import { applyFallbackAvatarTint, escapeHtml } from './utils.js';

let screenWakeLock = null;
let callDurationTimer = 0;
let callDurationStartedAt = 0;
let callTopbarResizeHandler = null;
let callTopbarViewportHandler = null;
let callMobileTopbarResizeHandler = null;
let callInfoVisibilityTimer = 0;

const CALL_INFO_AUTO_HIDE_MS = 3200;
const CALL_CARD_MIN_WIDTH = 320;
const CALL_CARD_MIN_HEIGHT = 430;
const CALL_CARD_MAX_WIDTH = 820;
const CALL_CARD_MAX_HEIGHT = 760;

// ── Incoming call banner ─────────────────────────────────────────────────────

export function showIncomingCallBanner({ callId, callType, initiator, onAccept, onReject }) {
    removeIncomingCallBanner();

    const caller = initiator || {};
    const rawName = caller.display_name || caller.username || 'Собеседник';
    const name = escapeHtml(rawName);
    const initial = (rawName || '?')[0].toUpperCase();
    const typeLabel = callType === 'video' ? 'звонит по видео...' : 'звонит вам...';
    const canAnswerWithVideo = callType === 'video';
    let answerAudioMuted = false;
    let answerVideoEnabled = canAnswerWithVideo;
    const avatarHtml = caller.avatar_url
        ? `<img src="${escapeHtml(caller.avatar_url)}" class="call-ib__avatar-img" alt="">`
        : `<div class="call-ib__avatar-fallback">${escapeHtml(initial)}</div>`;

    const banner = document.createElement('div');
    banner.id = 'call-incoming-banner';
    banner.className = 'call-ib';
    banner.setAttribute('role', 'alertdialog');
    banner.setAttribute('aria-label', 'Входящий звонок');
    banner.innerHTML = `
        <button class="call-ib__chrome call-ib__chrome--left" type="button" data-call-fullscreen aria-label="Полноэкранный режим">
            <i class="bi bi-arrows-fullscreen" aria-hidden="true"></i>
        </button>
        <button class="call-ib__chrome call-ib__chrome--right" type="button" data-call-reject aria-label="Отклонить">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
        <div class="call-ib__body">
            <div class="call-ib__avatar">${avatarHtml}</div>
            <div class="call-ib__name">${name}</div>
            <div class="call-ib__type">${typeLabel}</div>
        </div>
        <div class="call-ib__actions">
            <button class="call-ib__btn" type="button" data-call-answer-audio aria-label="Микрофон включён" aria-pressed="false">
                <span class="call-ib__btn-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                        <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                        <path d="M19 10v2a7 7 0 01-14 0v-2"/>
                        <line x1="12" y1="19" x2="12" y2="23"/>
                        <line x1="8" y1="23" x2="16" y2="23"/>
                    </svg>
                </span>
                <span class="call-ib__btn-label">Звук</span>
            </button>
            <button class="call-ib__btn${canAnswerWithVideo ? '' : ' call-ib__btn--muted'}" type="button" data-call-answer-video aria-label="${canAnswerWithVideo ? 'Камера включена' : 'Камера недоступна'}" aria-pressed="${canAnswerWithVideo ? 'false' : 'true'}"${canAnswerWithVideo ? '' : ' disabled'}>
                <span class="call-ib__btn-icon">
                    ${callType === 'video'
                        ? `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M15 10.5L21 7v10l-6-3.5V10.5z" fill="currentColor" stroke="none"/>
                            <rect x="1" y="5" width="14" height="14" rx="2.5" fill="currentColor" stroke="none"/>
                        </svg>`
                        : `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M15 10.5L21 7v10l-6-3.5V10.5z" fill="currentColor" stroke="none"/>
                            <rect x="1" y="5" width="14" height="14" rx="2.5" fill="currentColor" stroke="none"/>
                            <line x1="22" y1="2" x2="2" y2="22" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
                        </svg>`
                    }
                </span>
                <span class="call-ib__btn-label">Камера</span>
            </button>
            <button class="call-ib__btn call-ib__btn--accept" type="button" data-call-accept aria-label="Принять">
                <span class="call-ib__btn-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                        <path d="M6.54 5c.06.89.21 1.76.45 2.59l-1.2 1.2c-.41-1.2-.67-2.47-.76-3.79h1.51m9.86 12.02c.85.24 1.72.39 2.6.45v1.49c-1.32-.09-2.59-.35-3.8-.75l1.2-1.19M7.5 3H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.49c0-.55-.45-1-1-1-1.24 0-2.45-.2-3.57-.57a.84.84 0 00-.31-.05c-.26 0-.51.1-.71.29l-2.2 2.2a15.149 15.149 0 01-6.59-6.59l2.2-2.2c.28-.28.36-.67.25-1.02A11.36 11.36 0 018.5 4c0-.55-.45-1-1-1z" fill="white"/>
                    </svg>
                </span>
                <span class="call-ib__btn-label">Принять</span>
            </button>
            <button class="call-ib__btn call-ib__btn--reject" type="button" data-call-reject aria-label="Отклонить">
                <span class="call-ib__btn-icon">
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                        <path d="M6.54 5c.06.89.21 1.76.45 2.59l-1.2 1.2c-.41-1.2-.67-2.47-.76-3.79h1.51m9.86 12.02c.85.24 1.72.39 2.6.45v1.49c-1.32-.09-2.59-.35-3.8-.75l1.2-1.19M7.5 3H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.49c0-.55-.45-1-1-1-1.24 0-2.45-.2-3.57-.57a.84.84 0 00-.31-.05c-.26 0-.51.1-.71.29l-2.2 2.2a15.149 15.149 0 01-6.59-6.59l2.2-2.2c.28-.28.36-.67.25-1.02A11.36 11.36 0 018.5 4c0-.55-.45-1-1-1z" fill="white"/>
                        <line x1="20" y1="4" x2="4" y2="20" stroke="white" stroke-width="2.2" stroke-linecap="round"/>
                    </svg>
                </span>
                <span class="call-ib__btn-label">Отклонить</span>
            </button>
        </div>
    `;

    banner.querySelectorAll('[data-call-reject]').forEach((button) => button.addEventListener('click', () => {
        removeIncomingCallBanner();
        onReject(callId);
    }));
    banner.querySelector('[data-call-accept]').addEventListener('click', () => {
        removeIncomingCallBanner();
        onAccept(callId, callType, {
            audioMuted: answerAudioMuted,
            videoEnabled: answerVideoEnabled,
        });
    });
    banner.querySelector('[data-call-fullscreen]')?.addEventListener('click', () => {
        _toggleElementFullscreen(banner);
    });
    banner.querySelector('[data-call-answer-audio]')?.addEventListener('click', (event) => {
        const button = event.currentTarget;
        answerAudioMuted = !answerAudioMuted;
        button.classList.toggle('call-ib__btn--active', answerAudioMuted);
        button.setAttribute('aria-pressed', String(answerAudioMuted));
        button.setAttribute('aria-label', answerAudioMuted ? 'Ответить с выключенным микрофоном' : 'Микрофон включён');
        const label = button.querySelector('.call-ib__btn-label');
        if (label) label.textContent = answerAudioMuted ? 'Без звука' : 'Звук';
    });
    banner.querySelector('[data-call-answer-video]')?.addEventListener('click', (event) => {
        if (!canAnswerWithVideo) return;
        const button = event.currentTarget;
        answerVideoEnabled = !answerVideoEnabled;
        button.classList.toggle('call-ib__btn--active', !answerVideoEnabled);
        button.setAttribute('aria-pressed', String(!answerVideoEnabled));
        button.setAttribute('aria-label', answerVideoEnabled ? 'Ответить с камерой' : 'Ответить без видео');
        const label = button.querySelector('.call-ib__btn-label');
        if (label) label.textContent = answerVideoEnabled ? 'Камера' : 'Без видео';
    });

    document.body.appendChild(banner);
    applyFallbackAvatarTint(banner.querySelector('.call-ib__avatar'), rawName);
    requestAnimationFrame(() => banner.classList.add('call-ib--visible'));
}

export function removeIncomingCallBanner() {
    const el = document.getElementById('call-incoming-banner');
    if (el) {
        _exitFullscreenForElement(el);
        el.remove();
    }
}

// ── Pre-call setup ───────────────────────────────────────────────────────────

export function showPreCallScreen({
    callType = 'audio',
    partnerName,
    partnerAvatar,
    onPrepare,
    onToggleAudio,
    onToggleVideo,
    onSwitchCamera,
    onListDevices,
    onSelectMicrophone,
    onSelectCamera,
    onSelectSpeaker,
    onStart,
    onCancel,
}) {
    removePreCallScreen();

    const name = escapeHtml(partnerName || 'Собеседник');
    const initial = escapeHtml((partnerName || '?')[0].toUpperCase());
    const state = {
        callType: callType === 'video' ? 'video' : 'audio',
        audioMuted: false,
        videoEnabled: callType === 'video',
        speakerDeviceId: '',
        busy: false,
    };
    let activeLocalStream = null;
    const avatarHtml = partnerAvatar
        ? `<img src="${escapeHtml(partnerAvatar)}" class="call-preflight__avatar-img" alt="">`
        : `<span class="call-preflight__avatar-fallback">${initial}</span>`;

    const overlay = document.createElement('div');
    overlay.id = 'call-preflight';
    overlay.className = `call-preflight call-preflight--${state.callType}`;
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Подготовка звонка');
    overlay.innerHTML = `
        <section class="call-preflight__card">
            <div class="call-preflight__preview">
                <video class="call-preflight__video" id="call-preflight-video" autoplay playsinline muted></video>
                <div class="call-preflight__avatar">${avatarHtml}</div>
                <div class="call-preflight__shade" aria-hidden="true"></div>
                <div class="call-preflight__headline">
                    <div class="call-preflight__name">${name}</div>
                    <div class="call-preflight__status" data-precall-status>Подготовка...</div>
                </div>
            </div>

            <div class="call-preflight__panel">
                <div class="call-preflight__devices">
                    <label class="call-device-field">
                        <span>Микрофон</span>
                        <select id="precall-select-microphone"></select>
                    </label>
                    <label class="call-device-field">
                        <span>Камера</span>
                        <select id="precall-select-camera"></select>
                    </label>
                    <label class="call-device-field">
                        <span>Динамик</span>
                        <select id="precall-select-speaker"></select>
                    </label>
                </div>

                <div class="call-preflight__controls">
                    <button class="call-ctrl" id="precall-btn-audio" type="button" aria-label="Микрофон включён" aria-pressed="false">
                        <span class="call-ctrl__icon">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                                <path d="M19 10v2a7 7 0 01-14 0v-2"/>
                                <line x1="12" y1="19" x2="12" y2="23"/>
                                <line x1="8" y1="23" x2="16" y2="23"/>
                            </svg>
                        </span>
                        <span class="call-ctrl__label">Звук</span>
                    </button>
                    <button class="call-ctrl" id="precall-btn-video" type="button" aria-label="Камера" aria-pressed="false">
                        <span class="call-ctrl__icon">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                                <path d="M15 10.5L21 7v10l-6-3.5V10.5z" fill="currentColor" stroke="none"/>
                                <rect x="1" y="5" width="14" height="14" rx="2.5" fill="currentColor" stroke="none"/>
                            </svg>
                        </span>
                        <span class="call-ctrl__label">Камера</span>
                    </button>
                    <button class="call-ctrl call-ctrl--switch-camera" id="precall-btn-switch-camera" type="button" aria-label="Сменить камеру">
                        <span class="call-ctrl__icon">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M4 7h3l2-2h6l2 2h3v11H4z"/>
                                <path d="M9 13a3 3 0 105.8-1"/>
                                <path d="M15 10v3h3"/>
                            </svg>
                        </span>
                        <span class="call-ctrl__label">Сменить</span>
                    </button>
                </div>

                <div class="call-preflight__actions">
                    <button class="call-preflight__cancel" id="precall-cancel" type="button">Отмена</button>
                    <button class="call-preflight__start" id="precall-start" type="button">
                        <span>Начать</span>
                    </button>
                </div>
            </div>
        </section>
    `;

    const statusEl = overlay.querySelector('[data-precall-status]');
    const videoEl = overlay.querySelector('#call-preflight-video');
    const microphoneSelect = overlay.querySelector('#precall-select-microphone');
    const cameraSelect = overlay.querySelector('#precall-select-camera');
    const speakerSelect = overlay.querySelector('#precall-select-speaker');
    const audioBtn = overlay.querySelector('#precall-btn-audio');
    const videoBtn = overlay.querySelector('#precall-btn-video');
    const switchCameraBtn = overlay.querySelector('#precall-btn-switch-camera');
    const startBtn = overlay.querySelector('#precall-start');
    const cancelBtn = overlay.querySelector('#precall-cancel');

    const setStatus = (text) => {
        if (statusEl) statusEl.textContent = String(text || '');
    };
    const setBusy = (busy) => {
        state.busy = Boolean(busy);
        overlay.classList.toggle('call-preflight--busy', state.busy);
        [audioBtn, videoBtn, switchCameraBtn, startBtn, microphoneSelect, cameraSelect, speakerSelect]
            .filter(Boolean)
            .forEach((el) => { el.disabled = state.busy; });
        if (speakerSelect && !_supportsAudioOutputSelection()) {
            speakerSelect.disabled = true;
        }
    };
    const syncAudioButton = () => {
        audioBtn?.classList.toggle('call-ctrl--active', state.audioMuted);
        audioBtn?.setAttribute('aria-pressed', String(state.audioMuted));
        audioBtn?.setAttribute('aria-label', state.audioMuted ? 'Микрофон выключен' : 'Микрофон включён');
        const label = audioBtn?.querySelector('.call-ctrl__label');
        if (label) label.textContent = state.audioMuted ? 'Без звука' : 'Звук';
    };
    const syncVideoButton = () => {
        videoBtn?.classList.toggle('call-ctrl--active', !state.videoEnabled);
        videoBtn?.setAttribute('aria-pressed', String(!state.videoEnabled));
        videoBtn?.setAttribute('aria-label', state.videoEnabled ? 'Камера включена' : 'Камера выключена');
        const label = videoBtn?.querySelector('.call-ctrl__label');
        if (label) label.textContent = state.videoEnabled ? 'Камера' : 'Без камеры';
        switchCameraBtn?.classList.toggle('call-ctrl--hidden', !state.videoEnabled);
        overlay.classList.toggle('call-preflight--video-on', state.videoEnabled);
        overlay.classList.toggle('call-preflight--video-off', !state.videoEnabled);
    };
    const syncPreview = (stream = activeLocalStream) => {
        activeLocalStream = stream || activeLocalStream;
        const hasVideo = Boolean(state.videoEnabled && activeLocalStream?.getVideoTracks?.().length);
        overlay.classList.toggle('call-preflight--has-video', hasVideo);
        if (videoEl) {
            videoEl.srcObject = hasVideo ? activeLocalStream : null;
            if (hasVideo) _playMedia(videoEl);
        }
        syncVideoButton();
        syncAudioButton();
    };
    const refreshDevices = async () => {
        let devices = {};
        try {
            devices = typeof onListDevices === 'function' ? await onListDevices() : {};
        } catch (err) {
            console.warn('[CallUI] pre-call device list failed', err);
        }
        _syncDeviceSelect(microphoneSelect, devices.audioInputs || [], devices.selected?.audioInputId || '', 'Микрофон по умолчанию');
        _syncDeviceSelect(cameraSelect, devices.videoInputs || [], devices.selected?.videoInputId || '', 'Камера по умолчанию');
        _syncDeviceSelect(speakerSelect, devices.audioOutputs || [], state.speakerDeviceId, 'Системный вывод');
        if (speakerSelect && !_supportsAudioOutputSelection()) {
            speakerSelect.disabled = true;
        }
    };

    audioBtn?.addEventListener('click', async () => {
        setBusy(true);
        try {
            const muted = await onToggleAudio?.();
            state.audioMuted = Boolean(muted);
            setStatus(state.audioMuted ? 'Микрофон будет выключен' : 'Микрофон включён');
        } finally {
            setBusy(false);
            syncAudioButton();
        }
    });
    videoBtn?.addEventListener('click', async () => {
        setBusy(true);
        try {
            const result = await onToggleVideo?.(!state.videoEnabled);
            state.videoEnabled = typeof result === 'object' ? Boolean(result?.enabled) : Boolean(result);
            state.callType = state.callType === 'video' || state.videoEnabled ? 'video' : 'audio';
            if (result?.localStream) activeLocalStream = result.localStream;
            setStatus(state.videoEnabled ? 'Камера включена' : 'Камера будет выключена');
        } finally {
            setBusy(false);
            syncPreview(activeLocalStream);
            await refreshDevices();
        }
    });
    switchCameraBtn?.addEventListener('click', async () => {
        if (!state.videoEnabled) return;
        setBusy(true);
        try {
            const result = await onSwitchCamera?.();
            if (result?.localStream) activeLocalStream = result.localStream;
            setStatus('Камера переключена');
        } catch (err) {
            console.warn('[CallUI] pre-call camera switch failed', err);
            setStatus('Камера недоступна');
        } finally {
            setBusy(false);
            syncPreview(activeLocalStream);
            await refreshDevices();
        }
    });
    microphoneSelect?.addEventListener('change', async () => {
        setBusy(true);
        try {
            const result = await onSelectMicrophone?.(microphoneSelect.value);
            if (result?.localStream) activeLocalStream = result.localStream;
            setStatus('Микрофон выбран');
        } finally {
            setBusy(false);
            await refreshDevices();
        }
    });
    cameraSelect?.addEventListener('change', async () => {
        setBusy(true);
        try {
            const result = await onSelectCamera?.(cameraSelect.value);
            state.videoEnabled = Boolean(result?.enabled ?? true);
            state.callType = 'video';
            if (result?.localStream) activeLocalStream = result.localStream;
            setStatus('Камера выбрана');
        } finally {
            setBusy(false);
            syncPreview(activeLocalStream);
            await refreshDevices();
        }
    });
    speakerSelect?.addEventListener('change', async () => {
        state.speakerDeviceId = String(speakerSelect.value || '');
        await onSelectSpeaker?.(state.speakerDeviceId);
    });
    cancelBtn?.addEventListener('click', () => {
        removePreCallScreen();
        onCancel?.();
    });
    startBtn?.addEventListener('click', () => {
        removePreCallScreen();
        onStart?.({
            callType: state.callType,
            audioMuted: state.audioMuted,
            videoEnabled: state.videoEnabled,
            speakerDeviceId: state.speakerDeviceId,
        });
    });
    overlay.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        removePreCallScreen();
        onCancel?.();
    });

    document.body.appendChild(overlay);
    applyFallbackAvatarTint(overlay.querySelector('.call-preflight__avatar'), partnerName);
    syncAudioButton();
    syncVideoButton();
    requestAnimationFrame(() => {
        overlay.classList.add('call-preflight--visible');
        startBtn?.focus?.({ preventScroll: true });
    });

    (async () => {
        setBusy(true);
        try {
            const prepared = await onPrepare?.({
                callType: state.callType,
                audioMuted: state.audioMuted,
                videoEnabled: state.videoEnabled,
            });
            if (prepared?.localStream) activeLocalStream = prepared.localStream;
            if (Object.prototype.hasOwnProperty.call(prepared || {}, 'audioMuted')) {
                state.audioMuted = Boolean(prepared.audioMuted);
            }
            if (Object.prototype.hasOwnProperty.call(prepared || {}, 'videoEnabled')) {
                state.videoEnabled = Boolean(prepared.videoEnabled);
            }
            if (prepared?.callType) {
                state.callType = prepared.callType === 'video' ? 'video' : 'audio';
            }
            setStatus(state.videoEnabled ? 'Проверьте камеру и звук' : 'Проверьте микрофон');
        } catch (err) {
            console.warn('[CallUI] pre-call media preparation failed', err);
            setStatus('Нет доступа к устройствам');
        } finally {
            setBusy(false);
            syncPreview(activeLocalStream);
            await refreshDevices();
        }
    })();
}

export function removePreCallScreen() {
    const el = document.getElementById('call-preflight');
    if (!el) return;
    el.classList.remove('call-preflight--visible');
    window.setTimeout(() => el.remove(), 180);
}

// ── Active call overlay ──────────────────────────────────────────────────────

export function showActiveCallOverlay({
    callId, callType, partnerName, partnerAvatar, localStream,
    onToggleAudio, onToggleVideo, onSwitchCamera, onSelectMicrophone, onSelectCamera,
    onListDevices, onEnd, onToggleScreenShare,
    callRole = 'participant', mode = 'active',
    initialAudioMuted = false, initialVideoEnabled = null, initialSpeakerDeviceId = '',
}) {
    removeActiveCallOverlay({ immediate: true });

    const name = escapeHtml(partnerName || 'Собеседник');
    const initial = escapeHtml((partnerName || '?')[0].toUpperCase());
    const isVideo = callType === 'video';
    const isRinging = mode === 'ringing';
    const endActionLabel = isRinging ? '\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C' : '\u0417\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u044C';
    const isMobile = _isMobileCallUi();
    const supportsSpeakerToggle = isMobile && _supportsAudioOutputSelection();
    const supportsScreenShare = !isMobile
        && typeof navigator !== 'undefined'
        && typeof navigator.mediaDevices?.getDisplayMedia === 'function'
        && typeof onToggleScreenShare === 'function';
    const safeRole = callRole === 'caller' || callRole === 'callee' ? callRole : 'participant';
    let activeLocalStream = localStream || null;
    let localAudioMuted = Boolean(initialAudioMuted);
    let localVideoEnabled = initialVideoEnabled == null ? isVideo : Boolean(initialVideoEnabled);
    const avatarHtml = partnerAvatar
        ? `<img src="${escapeHtml(partnerAvatar)}" class="call-card__avatar-img" alt="">`
        : `<span class="call-card__avatar-fallback">${initial}</span>`;

    const overlay = document.createElement('div');
    overlay.id = 'call-active-overlay';
    overlay.className = `call-overlay call-overlay--${safeRole}${isRinging ? ' call-overlay--ringing' : ''}${isVideo ? ' call-overlay--video-active' : ' call-overlay--audio-only'}`;
    overlay.innerHTML = `
        <div class="call-topbar" id="call-topbar">
            <div class="call-topbar__state">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                    <path d="M19 10v2a7 7 0 01-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
                <span data-call-status>Соединение...</span>
                <span class="call-topbar__duration" data-call-duration hidden>00:00</span>
            </div>
            <div class="call-topbar__name">${name}</div>
            <button class="call-topbar__end" type="button" aria-label="${escapeHtml(endActionLabel)}">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M6.54 5c.06.89.21 1.76.45 2.59l-1.2 1.2c-.41-1.2-.67-2.47-.76-3.79h1.51m9.86 12.02c.85.24 1.72.39 2.6.45v1.49c-1.32-.09-2.59-.35-3.8-.75l1.2-1.19M7.5 3H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.49c0-.55-.45-1-1-1-1.24 0-2.45-.2-3.57-.57a.84.84 0 00-.31-.05c-.26 0-.51.1-.71.29l-2.2 2.2a15.149 15.149 0 01-6.59-6.59l2.2-2.2c.28-.28.36-.67.25-1.02A11.36 11.36 0 018.5 4c0-.55-.45-1-1-1z" fill="currentColor"/>
                    <line x1="20" y1="4" x2="4" y2="20" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
                </svg>
            </button>
        </div>

        <div class="call-mini" id="call-mini" role="button" tabindex="0" aria-label="Вернуться к звонку">
            <span class="call-mini__avatar">${avatarHtml}</span>
            <span class="call-mini__meta">
                <span class="call-mini__name">${name}</span>
                <span class="call-mini__sub">
                    <span data-call-status>Соединение...</span>
                    <span data-call-duration hidden>00:00</span>
                </span>
            </span>
            <button class="call-mini__mute" id="call-mini-mute" type="button" aria-label="Микрофон включён" aria-pressed="false">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                    <path d="M19 10v2a7 7 0 01-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
            </button>
            <button class="call-mini__end" id="call-mini-end" type="button" aria-label="${escapeHtml(endActionLabel)}">
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path d="M6.54 5c.06.89.21 1.76.45 2.59l-1.2 1.2c-.41-1.2-.67-2.47-.76-3.79h1.51m9.86 12.02c.85.24 1.72.39 2.6.45v1.49c-1.32-.09-2.59-.35-3.8-.75l1.2-1.19M7.5 3H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.49c0-.55-.45-1-1-1-1.24 0-2.45-.2-3.57-.57a.84.84 0 00-.31-.05c-.26 0-.51.1-.71.29l-2.2 2.2a15.149 15.149 0 01-6.59-6.59l2.2-2.2c.28-.28.36-.67.25-1.02A11.36 11.36 0 018.5 4c0-.55-.45-1-1-1z" fill="currentColor"/>
                    <line x1="20" y1="4" x2="4" y2="20" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>
                </svg>
            </button>
        </div>

        <section class="call-card call-card--${safeRole}" id="call-card" role="dialog" aria-label="Звонок">
            <div class="call-card__stage">
                <button class="call-card__minimize" id="call-minimize-btn" type="button" aria-label="Свернуть звонок">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                        <path d="M6 9l6 6 6-6"/>
                    </svg>
                </button>
                <video id="call-remote-video" class="call-overlay__remote-video" autoplay playsinline muted data-call-view-toggle title="Переключить вид"></video>
                <video id="call-local-video" class="call-overlay__local-video${isVideo ? '' : ' call-overlay__local-video--hidden'}" autoplay playsinline muted data-call-view-toggle title="Переключить вид"></video>
                <div class="call-card__audio-bg">
                    <span class="call-card__avatar">${avatarHtml}</span>
                    <span class="call-card__audio-name">${name}</span>
                    <span class="call-card__audio-status" data-call-status>Соединение...</span>
                    <span class="call-card__duration" data-call-duration hidden>00:00</span>
                </div>
                <span class="call-card__drag" aria-hidden="true">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">
                        <path d="M5 9h14M5 15h14"/>
                    </svg>
                </span>
                <button class="call-card__fullscreen" id="call-fullscreen-btn" type="button" aria-label="Полноэкранный режим">
                    <i class="bi bi-arrows-fullscreen" aria-hidden="true"></i>
                </button>
                <div class="call-overlay__verify" id="call-verification-code" hidden></div>
                <div class="call-quality" id="call-quality" data-quality-level="unknown" hidden>
                    <span class="call-quality__dot" aria-hidden="true"></span>
                    <span class="call-quality__text">Связь</span>
                </div>
            </div>
            <span class="call-card__resize call-card__resize--n" data-call-resize="n" aria-hidden="true"></span>
            <span class="call-card__resize call-card__resize--e" data-call-resize="e" aria-hidden="true"></span>
            <span class="call-card__resize call-card__resize--s" data-call-resize="s" aria-hidden="true"></span>
            <span class="call-card__resize call-card__resize--w" data-call-resize="w" aria-hidden="true"></span>
            <span class="call-card__resize call-card__resize--ne" data-call-resize="ne" aria-hidden="true"></span>
            <span class="call-card__resize call-card__resize--se" data-call-resize="se" aria-hidden="true"></span>
            <span class="call-card__resize call-card__resize--sw" data-call-resize="sw" aria-hidden="true"></span>
            <span class="call-card__resize call-card__resize--nw" data-call-resize="nw" aria-hidden="true"></span>
            <audio id="call-remote-audio" class="call-overlay__remote-audio" autoplay playsinline></audio>

            <div class="call-device-panel" id="call-device-panel" hidden>
                <label class="call-device-field">
                    <span>Микрофон</span>
                    <select id="call-select-microphone"></select>
                </label>
                <label class="call-device-field">
                    <span>Камера</span>
                    <select id="call-select-camera"></select>
                </label>
                <label class="call-device-field">
                    <span>Динамик</span>
                    <select id="call-select-speaker"></select>
                </label>
            </div>

            <div class="call-overlay__controls">
                <div class="call-overlay__ctrl-group">
                    <button class="call-ctrl" id="call-btn-video" aria-label="Камера">
                        <span class="call-ctrl__icon">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                                <path d="M15 10.5L21 7v10l-6-3.5V10.5z" fill="currentColor" stroke="none"/>
                                <rect x="1" y="5" width="14" height="14" rx="2.5" fill="currentColor" stroke="none"/>
                            </svg>
                        </span>
                        <span class="call-ctrl__label">Камера</span>
                    </button>
                    <button class="call-ctrl call-ctrl--switch-camera" id="call-btn-switch-camera" aria-label="Сменить камеру">
                        <span class="call-ctrl__icon">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M4 7h3l2-2h6l2 2h3v11H4z"/>
                                <path d="M9 13a3 3 0 105.8-1"/>
                                <path d="M15 10v3h3"/>
                            </svg>
                        </span>
                        <span class="call-ctrl__label">Сменить</span>
                    </button>
                    <button class="call-ctrl call-ctrl--screen" id="call-btn-screen" aria-label="Демонстрация экрана" aria-pressed="false">
                        <span class="call-ctrl__icon">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <rect x="3" y="4" width="18" height="12" rx="2"/>
                                <path d="M8 20h8"/>
                                <path d="M12 16v4"/>
                            </svg>
                        </span>
                        <span class="call-ctrl__label">Экран</span>
                    </button>
                    <button class="call-ctrl" id="call-btn-audio" aria-label="Микрофон">
                        <span class="call-ctrl__icon">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                                <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                                <path d="M19 10v2a7 7 0 01-14 0v-2"/>
                                <line x1="12" y1="19" x2="12" y2="23"/>
                                <line x1="8" y1="23" x2="16" y2="23"/>
                            </svg>
                        </span>
                        <span class="call-ctrl__label">Звук</span>
                    </button>
                    <button class="call-ctrl call-ctrl--devices" id="call-btn-devices" aria-label="Устройства" aria-expanded="false">
                        <span class="call-ctrl__icon">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                                <path d="M4 7h10"/>
                                <path d="M18 7h2"/>
                                <path d="M4 17h2"/>
                                <path d="M10 17h10"/>
                                <circle cx="16" cy="7" r="2"/>
                                <circle cx="8" cy="17" r="2"/>
                            </svg>
                        </span>
                        <span class="call-ctrl__label">Устройства</span>
                    </button>
                    <button class="call-ctrl" id="call-btn-speaker" aria-label="Динамик" aria-pressed="false">
                        <span class="call-ctrl__icon">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M4 9v6h4l5 4V5L8 9H4z"/>
                                <path d="M16 8.5a4 4 0 010 7"/>
                                <path d="M18.5 6a7.5 7.5 0 010 12"/>
                            </svg>
                        </span>
                        <span class="call-ctrl__label">Динамик</span>
                    </button>
                    <button class="call-ctrl call-ctrl--end" id="call-btn-end" aria-label="${escapeHtml(endActionLabel)}">
                        <span class="call-ctrl__icon">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                <path d="M6.54 5c.06.89.21 1.76.45 2.59l-1.2 1.2c-.41-1.2-.67-2.47-.76-3.79h1.51m9.86 12.02c.85.24 1.72.39 2.6.45v1.49c-1.32-.09-2.59-.35-3.8-.75l1.2-1.19M7.5 3H4c-.55 0-1 .45-1 1 0 9.39 7.61 17 17 17 .55 0 1-.45 1-1v-3.49c0-.55-.45-1-1-1-1.24 0-2.45-.2-3.57-.57a.84.84 0 00-.31-.05c-.26 0-.51.1-.71.29l-2.2 2.2a15.149 15.149 0 01-6.59-6.59l2.2-2.2c.28-.28.36-.67.25-1.02A11.36 11.36 0 018.5 4c0-.55-.45-1-1-1z" fill="white"/>
                                <line x1="20" y1="4" x2="4" y2="20" stroke="white" stroke-width="2.2" stroke-linecap="round"/>
                            </svg>
                        </span>
                        <span class="call-ctrl__label">${escapeHtml(endActionLabel)}</span>
                    </button>
                </div>
            </div>
        </section>
    `;

    document.body.appendChild(overlay);
    applyFallbackAvatarTint(overlay.querySelector('.call-card__avatar'), partnerName);
    applyFallbackAvatarTint(overlay.querySelector('.call-mini__avatar'), partnerName);
    requestAnimationFrame(() => {
        if (!overlay.isConnected) return;
        overlay.classList.add('call-overlay--visible');
        _setCallTopbarActive(!isRinging, overlay);
    });

    const syncAudioControlState = (muted) => {
        localAudioMuted = Boolean(muted);
        const btn = overlay.querySelector('#call-btn-audio');
        btn?.setAttribute('aria-pressed', String(localAudioMuted));
        btn?.setAttribute('aria-label', localAudioMuted ? 'Микрофон выключен' : 'Микрофон включён');
        btn?.classList.toggle('call-ctrl--active', localAudioMuted);
        const label = btn?.querySelector('.call-ctrl__label');
        if (label) label.textContent = localAudioMuted ? 'Без звука' : 'Звук';
        const miniBtn = overlay.querySelector('#call-mini-mute');
        miniBtn?.setAttribute('aria-pressed', String(localAudioMuted));
        miniBtn?.setAttribute('aria-label', localAudioMuted ? 'Микрофон выключен' : 'Микрофон включён');
        miniBtn?.classList.toggle('call-mini__mute--active', localAudioMuted);
    };
    const syncVideoControlState = (enabled) => {
        localVideoEnabled = Boolean(enabled);
        const btn = overlay.querySelector('#call-btn-video');
        btn?.setAttribute('aria-pressed', String(!localVideoEnabled));
        btn?.setAttribute('aria-label', localVideoEnabled ? 'Камера включена' : 'Камера выключена');
        btn?.classList.toggle('call-ctrl--active', !localVideoEnabled);
        const label = btn?.querySelector('.call-ctrl__label');
        if (label) label.textContent = localVideoEnabled ? 'Камера' : 'Без камеры';
        if (!localVideoEnabled) overlay.classList.remove('call-overlay--self-view-primary');
    };
    const syncScreenShareState = (enabled) => {
        const btn = overlay.querySelector('#call-btn-screen');
        btn?.setAttribute('aria-pressed', String(Boolean(enabled)));
        btn?.setAttribute('aria-label', enabled ? 'Остановить демонстрацию экрана' : 'Демонстрация экрана');
        btn?.classList.toggle('call-ctrl--active-positive', Boolean(enabled));
        const label = btn?.querySelector('.call-ctrl__label');
        if (label) label.textContent = enabled ? 'Стоп' : 'Экран';
        overlay.classList.toggle('call-overlay--screen-sharing', Boolean(enabled));
    };

    syncAudioControlState(localAudioMuted);
    syncVideoControlState(localVideoEnabled);
    _syncLocalVideo(overlay, activeLocalStream, localVideoEnabled && !isRinging);
    _bindCallInfoVisibility(overlay);
    if (!isMobile) {
        const card = overlay.querySelector('#call-card');
        _makeDraggable(card, overlay.querySelector('.call-card__drag'));
        _makeResizable(card);
        overlay.querySelector('#call-fullscreen-btn')?.addEventListener('click', (event) => {
            event.stopPropagation();
            _toggleCallOverlayFullscreen(overlay);
        });
    } else {
        overlay.querySelector('#call-fullscreen-btn')?.remove();
    }

    const screenBtn = overlay.querySelector('#call-btn-screen');
    if (!supportsScreenShare) {
        screenBtn?.remove();
    } else {
        screenBtn?.addEventListener('click', async () => {
            screenBtn.disabled = true;
            try {
                const result = await onToggleScreenShare?.();
                const enabled = typeof result === 'object' ? Boolean(result?.enabled) : Boolean(result);
                if (result?.localStream) activeLocalStream = result.localStream;
                syncScreenShareState(enabled);
                syncVideoControlState(Boolean(activeLocalStream?.getVideoTracks?.().some(track => track.enabled)));
                _syncLocalVideo(overlay, activeLocalStream, enabled || localVideoEnabled);
            } finally {
                screenBtn.disabled = false;
            }
        });
    }

    overlay.querySelector('#call-btn-audio').addEventListener('click', () => {
        const muted = onToggleAudio();
        syncAudioControlState(muted);
    });

    overlay.querySelector('#call-btn-video').addEventListener('click', async () => {
        const result = await onToggleVideo();
        const enabled = typeof result === 'object' ? Boolean(result?.enabled) : Boolean(result);
        const stream = typeof result === 'object' ? result?.localStream : activeLocalStream;
        activeLocalStream = stream || activeLocalStream;
        syncScreenShareState(false);
        syncVideoControlState(enabled);
        _syncLocalVideo(overlay, activeLocalStream, enabled);
    });

    overlay.querySelector('#call-btn-switch-camera').addEventListener('click', async () => {
        const btn = overlay.querySelector('#call-btn-switch-camera');
        btn.disabled = true;
        try {
            const result = await onSwitchCamera();
            if (result?.localStream) activeLocalStream = result.localStream;
            const enabled = Boolean(activeLocalStream?.getVideoTracks?.().some(track => track.enabled));
            syncScreenShareState(false);
            syncVideoControlState(enabled);
            _syncLocalVideo(overlay, activeLocalStream, enabled);
        } finally {
            btn.disabled = false;
        }
    });

    const devicesBtn = overlay.querySelector('#call-btn-devices');
    const devicePanel = overlay.querySelector('#call-device-panel');
    const microphoneSelect = overlay.querySelector('#call-select-microphone');
    const cameraSelect = overlay.querySelector('#call-select-camera');
    const speakerSelect = overlay.querySelector('#call-select-speaker');
    if (isMobile) {
        devicesBtn?.remove();
        devicePanel?.remove();
    }
    const refreshDevicePanel = async () => {
        if (!devicePanel) return;
        _setDevicePanelBusy(devicePanel, true);
        try {
            let devices = {};
            try {
                devices = typeof onListDevices === 'function' ? await onListDevices() : {};
            } catch (err) {
                console.warn('[CallUI] device list failed', err);
            }
            _syncDeviceSelect(microphoneSelect, devices.audioInputs || [], devices.selected?.audioInputId || '', 'Микрофон по умолчанию');
            _syncDeviceSelect(cameraSelect, devices.videoInputs || [], devices.selected?.videoInputId || '', 'Камера по умолчанию');
            const currentSinkId = overlay.querySelector('#call-remote-audio')?.sinkId || '';
            _syncDeviceSelect(speakerSelect, devices.audioOutputs || [], currentSinkId, 'Системный вывод');
            if (speakerSelect && !_supportsAudioOutputSelection()) {
                speakerSelect.disabled = true;
            }
        } finally {
            _setDevicePanelBusy(devicePanel, false);
        }
    };

    devicesBtn?.addEventListener('click', async () => {
        const willOpen = Boolean(devicePanel?.hidden);
        if (devicePanel) devicePanel.hidden = !willOpen;
        devicesBtn.setAttribute('aria-expanded', String(willOpen));
        if (willOpen) await refreshDevicePanel();
    });
    microphoneSelect?.addEventListener('change', async () => {
        microphoneSelect.disabled = true;
        try {
            await onSelectMicrophone?.(microphoneSelect.value);
            await refreshDevicePanel();
        } catch (err) {
            console.warn('[CallUI] microphone selection failed', err);
            microphoneSelect.disabled = false;
        }
    });
    cameraSelect?.addEventListener('change', async () => {
        cameraSelect.disabled = true;
        try {
            const result = await onSelectCamera?.(cameraSelect.value);
            if (result?.localStream) activeLocalStream = result.localStream;
            const enabled = Boolean(activeLocalStream?.getVideoTracks?.().some(track => track.enabled));
            syncScreenShareState(false);
            syncVideoControlState(enabled);
            _syncLocalVideo(overlay, activeLocalStream, enabled);
            await refreshDevicePanel();
        } catch (err) {
            console.warn('[CallUI] camera selection failed', err);
            cameraSelect.disabled = false;
        }
    });
    speakerSelect?.addEventListener('change', async () => {
        speakerSelect.disabled = true;
        try {
            await _selectAudioOutputById(overlay.querySelector('#call-remote-audio'), speakerSelect.value);
            await refreshDevicePanel();
        } catch (err) {
            console.warn('[CallUI] speaker selection failed', err);
            speakerSelect.disabled = false;
        }
    });
    if (initialSpeakerDeviceId && _supportsAudioOutputSelection()) {
        void _selectAudioOutputById(overlay.querySelector('#call-remote-audio'), initialSpeakerDeviceId);
    }

    const toggleViewSwap = (event) => {
        if (event?.target?.closest?.('button')) return;
        if (!overlay.classList.contains('call-overlay--has-remote-video')) return;
        if (!overlay.classList.contains('call-overlay--has-local-video')) return;
        overlay.classList.toggle('call-overlay--self-view-primary');
    };
    overlay.querySelector('.call-card__stage')?.addEventListener('click', toggleViewSwap);

    const speakerBtn = overlay.querySelector('#call-btn-speaker');
    if (isMobile && speakerBtn) {
        if (_isIos()) {
            // iOS Safari does not support setSinkId; audio routing is controlled
            // by the system based on connected audio devices. Hide the button.
            speakerBtn.remove();
        } else {
            speakerBtn.addEventListener('click', async () => {
                const enabled = speakerBtn.getAttribute('aria-pressed') !== 'true';
                speakerBtn.disabled = true;
                try {
                    const applied = await _setSpeakerMode(enabled, overlay);
                    _syncSpeakerButton(speakerBtn, applied ? enabled : !enabled);
                } finally {
                    speakerBtn.disabled = false;
                }
            });
        }
    } else if (!isMobile) {
        speakerBtn?.remove();
    }

    overlay.querySelector('#call-btn-end').addEventListener('click', () => onEnd(callId));
    overlay.querySelector('.call-topbar__end').addEventListener('click', () => onEnd(callId));
    overlay.querySelector('#call-mini-end')?.addEventListener('click', (event) => {
        event.stopPropagation();
        onEnd(callId);
    });
    overlay.querySelector('#call-mini-mute')?.addEventListener('click', (event) => {
        event.stopPropagation();
        const muted = onToggleAudio();
        syncAudioControlState(muted);
    });
    overlay.querySelector('#call-mini')?.addEventListener('click', (event) => {
        if (event.target.closest('button')) return;
        _restoreCallOverlay(overlay);
    });
    overlay.querySelector('#call-mini')?.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        _restoreCallOverlay(overlay);
    });
    overlay.querySelector('#call-minimize-btn')?.addEventListener('click', (event) => {
        event.stopPropagation();
        _minimizeCallOverlay(overlay);
    });
    overlay.querySelector('#call-topbar')?.addEventListener('click', (event) => {
        if (event.target.closest('.call-topbar__end')) return;
        _restoreCallOverlay(overlay);
    });
}

export function minimizeActiveCallOverlay() {
    _minimizeCallOverlay(_currentOverlay());
}

export function restoreActiveCallOverlay() {
    _restoreCallOverlay(_currentOverlay());
}

export function setCallScreenShareActive(enabled) {
    const overlay = _currentOverlay();
    if (!overlay) return;
    const btn = overlay.querySelector('#call-btn-screen');
    btn?.setAttribute('aria-pressed', String(Boolean(enabled)));
    btn?.setAttribute('aria-label', enabled ? 'Остановить демонстрацию экрана' : 'Демонстрация экрана');
    btn?.classList.toggle('call-ctrl--active-positive', Boolean(enabled));
    const label = btn?.querySelector('.call-ctrl__label');
    if (label) label.textContent = enabled ? 'Стоп' : 'Экран';
    overlay.classList.toggle('call-overlay--screen-sharing', Boolean(enabled));
}

export function removeActiveCallOverlay({ immediate = false } = {}) {
    _setSpeakerMode(false);
    _setCallTopbarActive(false);
    _setCallMobileTopbarReserve(false);
    _clearCallInfoVisibilityTimer();
    _exitFullscreenForElement(_currentOverlay());
    stopCallDurationTimer();
    const overlays = document.querySelectorAll('#call-active-overlay');
    overlays.forEach((el) => {
        if (immediate) {
            el.remove();
            return;
        }
        el.classList.remove('call-overlay--visible');
        setTimeout(() => el.remove(), 250);
    });
}

export function startCallDurationTimer(startedAt = Date.now()) {
    const overlay = _currentOverlay();
    if (!overlay) return;
    if (!callDurationStartedAt) {
        callDurationStartedAt = Number(startedAt) || Date.now();
    }
    _updateCallDuration();
    if (callDurationTimer) return;
    callDurationTimer = window.setInterval(_updateCallDuration, 1000);
}

export function stopCallDurationTimer() {
    if (callDurationTimer) {
        window.clearInterval(callDurationTimer);
        callDurationTimer = 0;
    }
    callDurationStartedAt = 0;
}

export function setCallStatusText(text) {
    const nextText = String(text ?? '');
    let changed = false;
    _currentOverlay()?.querySelectorAll('[data-call-status]').forEach((el) => {
        if (el.textContent !== nextText) changed = true;
        el.textContent = nextText;
    });
    if (changed) _showCallInfoTemporarily();
}

export function setCallVerificationCode(code) {
    const el = _currentOverlay()?.querySelector('#call-verification-code');
    if (!el) return;
    const value = String(code || '').trim();
    el.hidden = !value;
    if (!value) {
        delete el.dataset.callVerificationCode;
        el.innerHTML = '';
        return;
    }
    const changed = el.hidden || el.dataset.callVerificationCode !== value;
    el.dataset.callVerificationCode = value;
    const hint = 'Сравните этот код с собеседником вслух или в переписке.\n' +
        'Если коды совпадают — соединение защищено и сервер не перехватывает звонок.';
    el.innerHTML =
        `<span class="call-verify__label">Код безопасности:</span>` +
        `<span class="call-verify__code">${escapeHtml(value)}</span>` +
        `<button class="call-verify__hint" type="button" tabindex="0"` +
        ` aria-label="Что это?" title="${escapeHtml(hint)}">` +
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"` +
        ` stroke-width="2.2" stroke-linecap="round" aria-hidden="true">` +
        `<circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/>` +
        `</svg></button>`;
    if (changed) _showCallInfoTemporarily();
}

export function setCallQualityIndicator(stats = {}) {
    const el = _currentOverlay()?.querySelector('#call-quality');
    if (!el) return;
    const level = ['good', 'fair', 'poor'].includes(stats.level) ? stats.level : 'unknown';
    const packetLoss = Number(stats.packetLossPercent || 0);
    const rtt = Math.max(0, Math.round(Number(stats.rttMs || 0)));
    const jitter = Math.max(0, Math.round(Number(stats.jitterMs || 0)));
    const label = level === 'poor' ? 'Слабая связь' : level === 'fair' ? 'Нестабильно' : 'Хорошая связь';
    const details = [
        `потери ${packetLoss.toFixed(packetLoss % 1 === 0 ? 0 : 1)}%`,
        rtt ? `задержка ${rtt} мс` : '',
        jitter ? `джиттер ${jitter} мс` : '',
    ].filter(Boolean).join(' · ');
    const textEl = el.querySelector('.call-quality__text');
    const changed = Boolean(el.hidden)
        || el.dataset.qualityLevel !== level
        || textEl?.textContent !== label;
    el.hidden = false;
    el.dataset.qualityLevel = level;
    if (textEl) textEl.textContent = label;
    el.title = details || label;
    el.setAttribute('aria-label', details ? `${label}: ${details}` : label);
    if (changed) _showCallInfoTemporarily();
}

export function setRemoteAudioMuted(muted) {
    const overlay = _currentOverlay();
    if (!overlay) return;
    overlay.classList.toggle('call-overlay--remote-muted', Boolean(muted));
    let badge = overlay.querySelector('#call-remote-muted-badge');
    if (muted) {
        const wasHidden = !badge || badge.hidden;
        if (!badge) {
            badge = document.createElement('div');
            badge.id = 'call-remote-muted-badge';
            badge.className = 'call-remote-muted';
            badge.setAttribute('role', 'status');
            badge.innerHTML =
                `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"` +
                ` stroke-width="2" stroke-linecap="round" aria-hidden="true">` +
                `<path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>` +
                `<path d="M19 10v2a7 7 0 01-14 0v-2"/>` +
                `<line x1="12" y1="19" x2="12" y2="23"/>` +
                `<line x1="3" y1="3" x2="21" y2="21"/></svg>` +
                `<span>Микрофон выключен</span>`;
            const stage = overlay.querySelector('.call-card__stage');
            (stage || overlay).appendChild(badge);
        }
        badge.hidden = false;
        if (wasHidden) _showCallInfoTemporarily();
    } else if (badge) {
        badge.hidden = true;
    }
}

export function attachRemoteTrack(track) {
    const overlay = _currentOverlay();
    const media = track.kind === 'audio'
        ? overlay?.querySelector('#call-remote-audio')
        : overlay?.querySelector('#call-remote-video');
    if (!media) return;

    const stream = media.srcObject instanceof MediaStream ? media.srcObject : new MediaStream();
    if (!stream.getTracks().some(t => t.id === track.id)) {
        stream.addTrack(track);
    }
    media.srcObject = stream;

    if (track.kind === 'audio') {
        media.muted = false;
        media.volume = 1;
        if (overlay?.classList.contains('call-overlay--speaker-on')) {
            void _setSpeakerMode(true, overlay);
        }
    } else if (track.kind === 'video') {
        overlay?.classList.add('call-overlay--has-remote-video');
        _syncVideoLayout(overlay);
    }
    track.addEventListener('unmute', () => {
        if (track.kind === 'video') setRemoteVideoEnabled(true);
        _playMedia(media);
    });
    track.addEventListener('mute', () => {
        if (track.kind === 'video') setRemoteVideoEnabled(false);
    });
    track.addEventListener('ended', () => removeRemoteTrack(track.kind), { once: true });
    _playMedia(media);
}

export function setLocalVideoEnabled(stream, enabled) {
    _syncLocalVideo(_currentOverlay(), stream, enabled);
}

export function setRemoteVideoEnabled(enabled) {
    const overlay = _currentOverlay();
    const remoteVideo = overlay?.querySelector('#call-remote-video');
    const hasTrack = Boolean(remoteVideo?.srcObject?.getVideoTracks?.().length);
    overlay?.classList.toggle('call-overlay--has-remote-video', Boolean(enabled && hasTrack));
    if (!enabled) overlay?.classList.remove('call-overlay--self-view-primary');
    _syncVideoLayout(overlay);
}

export function removeRemoteTrack(kind) {
    const overlay = _currentOverlay();
    const media = kind === 'audio'
        ? overlay?.querySelector('#call-remote-audio')
        : overlay?.querySelector('#call-remote-video');
    if (!media || !media.srcObject) return;
    media.srcObject.getTracks().filter(t => t.kind === kind).forEach(t => {
        media.srcObject.removeTrack(t);
        t.stop();
    });
    if (kind === 'video') {
        overlay?.classList.remove('call-overlay--has-remote-video', 'call-overlay--self-view-primary');
        _syncVideoLayout(overlay);
    }
}

function _currentOverlay() {
    const overlays = document.querySelectorAll('#call-active-overlay');
    return overlays[overlays.length - 1] || null;
}

function _minimizeCallOverlay(overlay) {
    if (!overlay) return;
    if (_isMobileCallUi()) {
        overlay.classList.add('call-overlay--minimized');
        overlay.classList.remove('call-overlay--desktop-minimized');
        _setCallMobileTopbarReserve(true, overlay);
        return;
    }
    overlay.classList.add('call-overlay--desktop-minimized');
    overlay.classList.remove('call-overlay--minimized');
    _setCallMobileTopbarReserve(false, overlay);
    _setCallTopbarActive(false, overlay);
}

function _restoreCallOverlay(overlay) {
    if (!overlay) return;
    overlay.classList.remove('call-overlay--minimized', 'call-overlay--desktop-minimized');
    _setCallMobileTopbarReserve(false, overlay);
    _setCallTopbarActive(!_isMobileCallUi() && !overlay.classList.contains('call-overlay--ringing'), overlay);
}

function _clearCallInfoVisibilityTimer() {
    if (!callInfoVisibilityTimer) return;
    window.clearTimeout(callInfoVisibilityTimer);
    callInfoVisibilityTimer = 0;
}

function _showCallInfoTemporarily(overlay = _currentOverlay()) {
    if (!overlay) return;
    overlay.classList.remove('call-overlay--info-hidden');
    _clearCallInfoVisibilityTimer();
    callInfoVisibilityTimer = window.setTimeout(() => {
        if (overlay.isConnected) {
            overlay.classList.add('call-overlay--info-hidden');
        }
        callInfoVisibilityTimer = 0;
    }, CALL_INFO_AUTO_HIDE_MS);
}

function _bindCallInfoVisibility(overlay) {
    if (!overlay) return;
    const reveal = () => _showCallInfoTemporarily(overlay);
    overlay.addEventListener('pointerdown', reveal, { passive: true });
    overlay.addEventListener('pointermove', reveal, { passive: true });
    overlay.addEventListener('focusin', reveal);
    _showCallInfoTemporarily(overlay);
}

function _toggleElementFullscreen(element) {
    if (!element) return;
    if (_currentFullscreenElement()) {
        _exitFullscreenForElement(_currentFullscreenElement());
        return;
    }
    const request = element.requestFullscreen || element.webkitRequestFullscreen;
    const requestPromise = request?.call(element);
    requestPromise?.catch?.(() => {});
}

function _currentFullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement || null;
}

function _exitFullscreenForElement(element) {
    if (!element || _currentFullscreenElement() !== element) return;
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    const exitPromise = exit?.call(document);
    exitPromise?.catch?.(() => {});
}

function _toggleCallOverlayFullscreen(overlay) {
    if (!overlay) return;
    const fullscreenElement = _currentFullscreenElement();
    const isFullscreen = overlay.classList.contains('call-overlay--fullscreen');
    if (isFullscreen) {
        overlay.classList.remove('call-overlay--fullscreen');
        _exitFullscreenForElement(overlay);
        return;
    }
    overlay.classList.add('call-overlay--fullscreen');
    if (fullscreenElement && fullscreenElement !== overlay) {
        _exitFullscreenForElement(fullscreenElement);
    }
    const request = overlay.requestFullscreen || overlay.webkitRequestFullscreen;
    const requestPromise = request?.call(overlay);
    requestPromise?.catch?.(() => {});
}

document.addEventListener('fullscreenchange', () => {
    const overlay = _currentOverlay();
    if (!overlay) return;
    overlay.classList.toggle('call-overlay--fullscreen', _currentFullscreenElement() === overlay);
});
document.addEventListener('webkitfullscreenchange', () => {
    const overlay = _currentOverlay();
    if (!overlay) return;
    overlay.classList.toggle('call-overlay--fullscreen', _currentFullscreenElement() === overlay);
});

function _updateCallDuration() {
    const overlay = _currentOverlay();
    if (!overlay || !callDurationStartedAt) return;
    const elapsedSeconds = Math.max(0, Math.floor((Date.now() - callDurationStartedAt) / 1000));
    overlay.querySelectorAll('[data-call-duration]').forEach((el) => {
        el.hidden = false;
        el.textContent = _formatDuration(elapsedSeconds);
    });
}

function _formatDuration(seconds) {
    const total = Math.max(0, Math.floor(Number(seconds) || 0));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hours > 0) {
        return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function _playMedia(media) {
    const playPromise = media.play();
    if (playPromise?.catch) {
        playPromise.catch((err) => {
            console.warn('[CallUI] remote media playback blocked', err);
        });
    }
}

function _syncLocalVideo(overlay, stream, enabled) {
    const localVideo = overlay?.querySelector('#call-local-video');
    if (!localVideo) return;
    const hasVideo = Boolean(enabled && stream?.getVideoTracks?.().length);
    overlay?.classList.toggle('call-overlay--has-local-video', hasVideo);
    if (hasVideo) {
        localVideo.srcObject = stream;
        localVideo.classList.remove('call-overlay__local-video--hidden');
        _syncVideoLayout(overlay);
        return;
    }
    localVideo.classList.add('call-overlay__local-video--hidden');
    localVideo.srcObject = null;
    overlay?.classList.remove('call-overlay--self-view-primary');
    _syncVideoLayout(overlay);
}

function _syncVideoLayout(overlay) {
    if (!overlay) return;
    const hasAnyVideo = overlay.classList.contains('call-overlay--has-local-video')
        || overlay.classList.contains('call-overlay--has-remote-video');
    overlay.classList.toggle('call-overlay--video-active', hasAnyVideo);
    overlay.classList.toggle('call-overlay--audio-only', !hasAnyVideo);
}

function _setDevicePanelBusy(panel, busy) {
    panel?.classList.toggle('call-device-panel--busy', Boolean(busy));
    if (!busy) return;
    panel?.querySelectorAll('select').forEach(select => {
        select.disabled = true;
    });
}

function _syncDeviceSelect(select, devices, selectedId, fallbackLabel) {
    if (!select) return;
    const previous = String(selectedId || select.value || '');
    const options = [new Option(fallbackLabel, '')];
    for (const device of devices) {
        const value = String(device.deviceId || '');
        if (!value || value === 'default') continue;
        options.push(new Option(String(device.label || fallbackLabel), value));
    }
    select.replaceChildren(...options);
    const hasPrevious = options.some(option => option.value === previous);
    select.value = hasPrevious ? previous : '';
    select.disabled = options.length <= 1;
}

async function _selectAudioOutputById(audioElement, sinkId) {
    if (!audioElement || typeof audioElement.setSinkId !== 'function') {
        return false;
    }
    try {
        await audioElement.setSinkId(String(sinkId || ''));
        audioElement.muted = false;
        audioElement.volume = 1;
        _playMedia(audioElement);
        return true;
    } catch (err) {
        console.warn('[CallUI] audio output selection failed', err);
        return false;
    }
}

function _setCallTopbarActive(active, overlay = _currentOverlay()) {
    const chatArea = document.getElementById('chatArea');
    if (!chatArea) return;

    if (!active || _isMobileCallUi()) {
        chatArea.classList.remove('chat-area--call-active');
        chatArea.style.removeProperty('--call-topbar-offset');
        if (callTopbarResizeHandler) {
            window.removeEventListener('resize', callTopbarResizeHandler);
            callTopbarResizeHandler = null;
        }
        if (callTopbarViewportHandler) {
            window.visualViewport?.removeEventListener?.('resize', callTopbarViewportHandler);
            window.visualViewport?.removeEventListener?.('scroll', callTopbarViewportHandler);
            callTopbarViewportHandler = null;
        }
        return;
    }

    const syncOffset = () => {
        const topbar = overlay?.querySelector?.('#call-topbar');
        const rect = chatArea.getBoundingClientRect();
        const height = Math.ceil(topbar?.getBoundingClientRect?.().height || 34);
        chatArea.style.setProperty('--call-topbar-offset', `${height}px`);
        topbar?.style?.setProperty('--call-topbar-left', `${Math.max(0, Math.round(rect.left))}px`);
        topbar?.style?.setProperty('--call-topbar-width', `${Math.round(rect.width)}px`);
        chatArea.classList.add('chat-area--call-active');
    };
    syncOffset();
    if (!callTopbarResizeHandler) {
        callTopbarResizeHandler = syncOffset;
        window.addEventListener('resize', callTopbarResizeHandler);
    }
    if (!callTopbarViewportHandler) {
        callTopbarViewportHandler = syncOffset;
        window.visualViewport?.addEventListener?.('resize', callTopbarViewportHandler);
        window.visualViewport?.addEventListener?.('scroll', callTopbarViewportHandler);
    }
}

function _setCallMobileTopbarReserve(active, overlay = _currentOverlay()) {
    const root = document.documentElement;
    if (!root) return;

    const clearReserve = () => {
        root.classList.remove('call-minimized-active');
        root.style.removeProperty('--call-mobile-topbar-offset');
        if (callMobileTopbarResizeHandler) {
            window.removeEventListener('resize', callMobileTopbarResizeHandler);
            window.visualViewport?.removeEventListener?.('resize', callMobileTopbarResizeHandler);
            callMobileTopbarResizeHandler = null;
        }
    };

    if (!active || !_isMobileCallUi()) {
        clearReserve();
        return;
    }

    const syncOffset = () => {
        if (!overlay?.isConnected || !overlay.classList.contains('call-overlay--minimized') || !_isMobileCallUi()) {
            clearReserve();
            return;
        }
        const topbar = overlay.querySelector('#call-topbar');
        const height = Math.ceil(topbar?.getBoundingClientRect?.().height || 52);
        root.style.setProperty('--call-mobile-topbar-offset', `${height}px`);
        root.classList.add('call-minimized-active');
    };

    syncOffset();
    requestAnimationFrame(syncOffset);

    if (!callMobileTopbarResizeHandler) {
        callMobileTopbarResizeHandler = syncOffset;
        window.addEventListener('resize', callMobileTopbarResizeHandler);
        window.visualViewport?.addEventListener?.('resize', callMobileTopbarResizeHandler);
    }
}

function _makeDraggable(card, handle) {
    if (!card || !handle) return;

    let dragState = null;
    const margin = 8;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    const moveCard = (clientX, clientY) => {
        if (!dragState) return;
        const viewport = window.visualViewport;
        const viewportLeft = viewport?.offsetLeft || 0;
        const viewportTop = viewport?.offsetTop || 0;
        const viewportWidth = viewport?.width || window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = viewport?.height || window.innerHeight || document.documentElement.clientHeight || 0;
        const minLeft = viewportLeft + margin;
        const minTop = viewportTop + margin;
        const maxLeft = Math.max(minLeft, viewportLeft + viewportWidth - dragState.width - margin);
        const maxTop = Math.max(minTop, viewportTop + viewportHeight - dragState.height - margin);
        const nextLeft = clamp(clientX - dragState.offsetX, minLeft, maxLeft);
        const nextTop = clamp(clientY - dragState.offsetY, minTop, maxTop);
        card.style.left = `${Math.round(nextLeft)}px`;
        card.style.top = `${Math.round(nextTop)}px`;
        card.style.transform = 'none';
    };

    handle.addEventListener('pointerdown', (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        const rect = card.getBoundingClientRect();
        dragState = {
            pointerId: event.pointerId,
            offsetX: event.clientX - rect.left,
            offsetY: event.clientY - rect.top,
            width: rect.width,
            height: rect.height,
        };
        card.classList.add('call-card--dragging');
        handle.setPointerCapture?.(event.pointerId);
        moveCard(event.clientX, event.clientY);
        event.preventDefault();
    });

    handle.addEventListener('pointermove', (event) => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        moveCard(event.clientX, event.clientY);
    });

    const stopDrag = (event) => {
        if (!dragState || event.pointerId !== dragState.pointerId) return;
        handle.releasePointerCapture?.(event.pointerId);
        dragState = null;
        card.classList.remove('call-card--dragging');
    };

    handle.addEventListener('pointerup', stopDrag);
    handle.addEventListener('pointercancel', stopDrag);
}

function _makeResizable(card) {
    if (!card) return;
    const handles = Array.from(card.querySelectorAll('[data-call-resize]'));
    if (!handles.length) return;

    let resizeState = null;
    const margin = 8;
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

    const readBounds = () => {
        const viewport = window.visualViewport;
        const viewportLeft = viewport?.offsetLeft || 0;
        const viewportTop = viewport?.offsetTop || 0;
        const viewportWidth = viewport?.width || window.innerWidth || document.documentElement.clientWidth || 0;
        const viewportHeight = viewport?.height || window.innerHeight || document.documentElement.clientHeight || 0;
        const availableWidth = Math.max(1, viewportWidth - margin * 2);
        const availableHeight = Math.max(1, viewportHeight - margin * 2);
        const maxWidth = Math.max(1, Math.min(CALL_CARD_MAX_WIDTH, availableWidth));
        const maxHeight = Math.max(1, Math.min(CALL_CARD_MAX_HEIGHT, availableHeight));
        return {
            minLeft: viewportLeft + margin,
            minTop: viewportTop + margin,
            maxRight: viewportLeft + viewportWidth - margin,
            maxBottom: viewportTop + viewportHeight - margin,
            minWidth: Math.min(CALL_CARD_MIN_WIDTH, maxWidth),
            minHeight: Math.min(CALL_CARD_MIN_HEIGHT, maxHeight),
            maxWidth,
            maxHeight,
        };
    };

    const applyRect = ({ left, top, width, height }) => {
        card.classList.add('call-card--resized');
        card.style.left = `${Math.round(left)}px`;
        card.style.top = `${Math.round(top)}px`;
        card.style.width = `${Math.round(width)}px`;
        card.style.height = `${Math.round(height)}px`;
        card.style.transform = 'none';
    };

    const resizeCard = (event) => {
        if (!resizeState) return;
        const dx = event.clientX - resizeState.startX;
        const dy = event.clientY - resizeState.startY;
        const bounds = readBounds();
        const edge = resizeState.edge;
        const startRight = resizeState.left + resizeState.width;
        const startBottom = resizeState.top + resizeState.height;

        let nextLeft = resizeState.left;
        let nextTop = resizeState.top;
        let nextWidth = resizeState.width;
        let nextHeight = resizeState.height;

        if (edge.includes('e')) {
            const maxWidth = Math.min(bounds.maxWidth, bounds.maxRight - resizeState.left);
            nextWidth = clamp(resizeState.width + dx, bounds.minWidth, maxWidth);
        }
        if (edge.includes('s')) {
            const maxHeight = Math.min(bounds.maxHeight, bounds.maxBottom - resizeState.top);
            nextHeight = clamp(resizeState.height + dy, bounds.minHeight, maxHeight);
        }
        if (edge.includes('w')) {
            const minLeft = Math.max(bounds.minLeft, startRight - bounds.maxWidth);
            const maxLeft = startRight - bounds.minWidth;
            nextLeft = clamp(resizeState.left + dx, minLeft, maxLeft);
            nextWidth = startRight - nextLeft;
        }
        if (edge.includes('n')) {
            const minTop = Math.max(bounds.minTop, startBottom - bounds.maxHeight);
            const maxTop = startBottom - bounds.minHeight;
            nextTop = clamp(resizeState.top + dy, minTop, maxTop);
            nextHeight = startBottom - nextTop;
        }

        applyRect({ left: nextLeft, top: nextTop, width: nextWidth, height: nextHeight });
        event.preventDefault();
    };

    const stopResize = (event) => {
        if (!resizeState || event.pointerId !== resizeState.pointerId) return;
        event.currentTarget?.releasePointerCapture?.(event.pointerId);
        resizeState = null;
        card.classList.remove('call-card--resizing');
    };

    handles.forEach((handle) => {
        handle.addEventListener('pointerdown', (event) => {
            if (event.button !== undefined && event.button !== 0) return;
            if (card.closest('.call-overlay--fullscreen')) return;
            const edge = String(handle.getAttribute('data-call-resize') || '');
            if (!edge) return;
            const rect = card.getBoundingClientRect();
            resizeState = {
                pointerId: event.pointerId,
                edge,
                startX: event.clientX,
                startY: event.clientY,
                left: rect.left,
                top: rect.top,
                width: rect.width,
                height: rect.height,
            };
            card.classList.add('call-card--resizing');
            handle.setPointerCapture?.(event.pointerId);
            event.preventDefault();
            event.stopPropagation();
        });
        handle.addEventListener('pointermove', resizeCard);
        handle.addEventListener('pointerup', stopResize);
        handle.addEventListener('pointercancel', stopResize);
    });
}

async function _setSpeakerMode(enabled, overlay = _currentOverlay()) {
    const remoteAudio = overlay?.querySelector('#call-remote-audio');
    if (!enabled) {
        overlay?.classList.remove('call-overlay--speaker-on');
        await _releaseScreenWakeLock();
    }

    if (remoteAudio) {
        remoteAudio.muted = false;
        remoteAudio.volume = 1;

        if (_supportsAudioOutputSelection()) {
            await _selectAudioOutput(remoteAudio, { speaker: enabled });
        }

        overlay?.classList.toggle('call-overlay--speaker-on', enabled);
        _playMedia(remoteAudio);
    }

    if (enabled) await _requestScreenWakeLock();
    return true;
}

function _syncSpeakerButton(button, enabled) {
    if (!button) return;
    button.setAttribute('aria-pressed', String(enabled));
    button.setAttribute('aria-label', enabled ? 'Громкий динамик включён' : 'Громкий динамик выключен');
    button.classList.toggle('call-ctrl--active-positive', enabled);
    button.querySelector('.call-ctrl__label').textContent = enabled ? 'Громко' : 'Динамик';
}

function _supportsAudioOutputSelection() {
    return Boolean(
        typeof HTMLMediaElement !== 'undefined'
        && typeof HTMLMediaElement.prototype.setSinkId === 'function'
    );
}

async function _selectAudioOutput(audioElement, { speaker }) {
    if (!audioElement || typeof audioElement.setSinkId !== 'function') {
        return false;
    }

    const candidates = speaker
        ? await _speakerSinkCandidates()
        : await _earpieceSinkCandidates();
    let lastError = null;
    for (const sinkId of candidates) {
        if (!sinkId && typeof audioElement.sinkId === 'string' && audioElement.sinkId === '') {
            return true;
        }
        if (sinkId && audioElement.sinkId === sinkId) {
            return true;
        }
        try {
            await audioElement.setSinkId(sinkId);
            return true;
        } catch (err) {
            lastError = err;
        }
    }
    if (lastError) {
        console.warn('[CallUI] audio output selection unavailable', lastError);
    }
    return false;
}

async function _speakerSinkCandidates() {
    const devices = await _listAudioOutputDevices();
    const matches = devices
        .filter(device => /speaker|loud|\u0433\u0440\u043E\u043C\u043A/i.test(device.label || ''))
        .map(device => device.deviceId)
        .filter(Boolean);
    return _uniqueSinkIds([...matches, 'default']);
}

async function _earpieceSinkCandidates() {
    const devices = await _listAudioOutputDevices();
    const matches = devices
        .filter(device => /communication|receiver|earpiece|phone|\u0442\u0435\u043B\u0435\u0444\u043E\u043D|\u0433\u0430\u0440\u043D\u0438\u0442\u0443\u0440/i.test(device.label || ''))
        .map(device => device.deviceId)
        .filter(Boolean);
    return _uniqueSinkIds(['communications', ...matches, 'default', '']);
}

async function _listAudioOutputDevices() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        return devices.filter(device => device.kind === 'audiooutput');
    } catch (_) {
        return [];
    }
}

function _uniqueSinkIds(values) {
    const result = [];
    for (const value of values) {
        const sinkId = String(value || '').trim();
        if (result.includes(sinkId)) continue;
        result.push(sinkId);
    }
    return result;
}

async function _requestScreenWakeLock() {
    if (screenWakeLock) return;
    if (!navigator.wakeLock?.request) return;
    try {
        screenWakeLock = await navigator.wakeLock.request('screen');
        screenWakeLock.addEventListener?.('release', () => {
            screenWakeLock = null;
        });
    } catch (err) {
        console.warn('[CallUI] screen wake lock unavailable', err);
    }
}

function _isMobileCallUi() {
    return Boolean(
        window.matchMedia?.('(pointer: coarse)').matches
        || window.matchMedia?.('(max-width: 768px)').matches
    );
}

function _isIos() {
    return /iP(hone|ad|od)/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

async function _releaseScreenWakeLock() {
    const lock = screenWakeLock;
    screenWakeLock = null;
    if (!lock) return;
    try {
        await lock.release();
    } catch (_) {}
}
