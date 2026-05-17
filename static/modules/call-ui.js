/**
 * call-ui.js
 * Telegram-style call UI: incoming banner + active call overlay.
 */

import { escapeHtml } from './utils.js';

let screenWakeLock = null;
let callDurationTimer = 0;
let callDurationStartedAt = 0;
let callTopbarResizeHandler = null;

// ── Incoming call banner ─────────────────────────────────────────────────────

export function showIncomingCallBanner({ callId, callType, initiator, onAccept, onReject }) {
    removeIncomingCallBanner();

    const caller = initiator || {};
    const rawName = caller.display_name || caller.username || 'Собеседник';
    const name = escapeHtml(rawName);
    const initial = (rawName || '?')[0].toUpperCase();
    const typeLabel = callType === 'video' ? 'звонит по видео...' : 'звонит вам...';
    const avatarHtml = caller.avatar_url
        ? `<img src="${escapeHtml(caller.avatar_url)}" class="call-ib__avatar-img" alt="">`
        : `<div class="call-ib__avatar-fallback">${escapeHtml(initial)}</div>`;

    const banner = document.createElement('div');
    banner.id = 'call-incoming-banner';
    banner.className = 'call-ib';
    banner.setAttribute('role', 'alertdialog');
    banner.setAttribute('aria-label', 'Входящий звонок');
    banner.innerHTML = `
        <span class="call-ib__chrome call-ib__chrome--left" aria-hidden="true">
            <i class="bi bi-arrows-fullscreen" aria-hidden="true"></i>
        </span>
        <button class="call-ib__chrome call-ib__chrome--right" type="button" data-call-reject aria-label="Отклонить">
            <i class="bi bi-x-lg" aria-hidden="true"></i>
        </button>
        <div class="call-ib__body">
            <div class="call-ib__name">${name}</div>
            <div class="call-ib__type">${typeLabel}</div>
            <div class="call-ib__avatar">${avatarHtml}</div>
        </div>
        <div class="call-ib__actions">
            <button class="call-ib__btn call-ib__btn--muted" type="button" disabled aria-label="Микрофон">
                <span class="call-ib__btn-icon">
                    <i class="bi bi-mic-fill" aria-hidden="true"></i>
                </span>
                <span class="call-ib__btn-label">Звук</span>
            </button>
            <button class="call-ib__btn call-ib__btn--muted" type="button" disabled aria-label="Камера">
                <span class="call-ib__btn-icon">
                    <i class="bi ${callType === 'video' ? 'bi-camera-video-fill' : 'bi-camera-video-off-fill'}" aria-hidden="true"></i>
                </span>
                <span class="call-ib__btn-label">Камера</span>
            </button>
            <button class="call-ib__btn call-ib__btn--accept" type="button" data-call-accept aria-label="Принять">
                <span class="call-ib__btn-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M4.5 2C4.5 2 2 2 2 4.5 2 13.6 10.4 22 19.5 22c2.5 0 2.5-2.5 2.5-2.5v-3s0-1.5-1.5-1.5c-.9 0-2.1-.4-3-.7-.6-.2-1.3-.1-1.8.4l-1.5 1.5C12.1 15 9 11.9 7.8 9.3l1.5-1.5c.5-.5.6-1.2.4-1.8C9.4 5.1 9 3.9 9 3c0-1.5-1.5-1.5-1.5-1.5H4.5z"/>
                    </svg>
                </span>
                <span class="call-ib__btn-label">Принять</span>
            </button>
            <button class="call-ib__btn call-ib__btn--reject" type="button" data-call-reject aria-label="Отклонить">
                <span class="call-ib__btn-icon">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M4.5 2C4.5 2 2 2 2 4.5 2 13.6 10.4 22 19.5 22c2.5 0 2.5-2.5 2.5-2.5v-3s0-1.5-1.5-1.5c-.9 0-2.1-.4-3-.7-.6-.2-1.3-.1-1.8.4l-1.5 1.5C12.1 15 9 11.9 7.8 9.3l1.5-1.5c.5-.5.6-1.2.4-1.8C9.4 5.1 9 3.9 9 3c0-1.5-1.5-1.5-1.5-1.5H4.5z"/>
                    <line x1="22" y1="2" x2="2" y2="22" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
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
        onAccept(callId, callType);
    });

    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('call-ib--visible'));
}

export function removeIncomingCallBanner() {
    const el = document.getElementById('call-incoming-banner');
    if (el) el.remove();
}

// ── Active call overlay ──────────────────────────────────────────────────────

export function showActiveCallOverlay({
    callId, callType, partnerName, partnerAvatar, localStream,
    onToggleAudio, onToggleVideo, onSwitchCamera, onEnd, callRole = 'participant',
}) {
    removeActiveCallOverlay({ immediate: true });

    const name = escapeHtml(partnerName || 'Собеседник');
    const initial = escapeHtml((partnerName || '?')[0].toUpperCase());
    const isVideo = callType === 'video';
    const isMobile = _isMobileCallUi();
    const safeRole = callRole === 'caller' || callRole === 'callee' ? callRole : 'participant';
    const avatarHtml = partnerAvatar
        ? `<img src="${escapeHtml(partnerAvatar)}" class="call-card__avatar-img" alt="">`
        : `<span class="call-card__avatar-fallback">${initial}</span>`;

    const overlay = document.createElement('div');
    overlay.id = 'call-active-overlay';
    overlay.className = `call-overlay call-overlay--${safeRole}${isVideo ? ' call-overlay--video-active' : ' call-overlay--audio-only'}`;
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
            </div>
            <div class="call-topbar__name">${name}</div>
            <button class="call-topbar__end" type="button" aria-label="Завершить звонок">
                <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M6.4 4.4l2.2 3.2-1.2 1.2c1 2.4 3.4 4.8 5.8 5.8l1.2-1.2 3.2 2.2-.7 2.7c-.2.8-1 1.3-1.8 1.1C9.9 18.2 5.8 14.1 4.6 8.9c-.2-.8.3-1.6 1.1-1.8l.7-2.7z"/>
                    <path d="M21 3L3 21"/>
                </svg>
            </button>
        </div>

        <section class="call-card call-card--${safeRole}" id="call-card" role="dialog" aria-label="Звонок">
            <div class="call-card__stage">
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
                <div class="call-overlay__verify" id="call-verification-code" hidden></div>
            </div>
            <audio id="call-remote-audio" class="call-overlay__remote-audio" autoplay playsinline></audio>

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
                    <button class="call-ctrl call-ctrl--end" id="call-btn-end" aria-label="Завершить">
                        <span class="call-ctrl__icon">
                            <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M4.5 2C4.5 2 2 2 2 4.5 2 13.6 10.4 22 19.5 22c2.5 0 2.5-2.5 2.5-2.5v-3s0-1.5-1.5-1.5c-.9 0-2.1-.4-3-.7-.6-.2-1.3-.1-1.8.4l-1.5 1.5C12.1 15 9 11.9 7.8 9.3l1.5-1.5c.5-.5.6-1.2.4-1.8C9.4 5.1 9 3.9 9 3c0-1.5-1.5-1.5-1.5-1.5H4.5z"/>
                                <line x1="22" y1="2" x2="2" y2="22" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
                            </svg>
                        </span>
                        <span class="call-ctrl__label">Завершить</span>
                    </button>
                </div>
            </div>
        </section>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
        if (!overlay.isConnected) return;
        overlay.classList.add('call-overlay--visible');
        _setCallTopbarActive(true, overlay);
    });

    _syncLocalVideo(overlay, localStream, isVideo);
    if (!isMobile) {
        _makeDraggable(overlay.querySelector('#call-card'), overlay.querySelector('.call-card__stage'));
    }

    overlay.querySelector('#call-btn-audio').addEventListener('click', () => {
        const muted = onToggleAudio();
        const btn = overlay.querySelector('#call-btn-audio');
        btn.classList.toggle('call-ctrl--active', muted);
        btn.querySelector('.call-ctrl__label').textContent = muted ? 'Без звука' : 'Звук';
    });

    overlay.querySelector('#call-btn-video').addEventListener('click', async () => {
        const result = await onToggleVideo();
        const enabled = typeof result === 'object' ? Boolean(result?.enabled) : Boolean(result);
        const stream = typeof result === 'object' ? result?.localStream : localStream;
        const btn = overlay.querySelector('#call-btn-video');
        btn.classList.toggle('call-ctrl--active', !enabled);
        btn.querySelector('.call-ctrl__label').textContent = enabled ? 'Камера' : 'Без камеры';
        overlay.classList.toggle('call-overlay--video-active', enabled);
        overlay.classList.toggle('call-overlay--audio-only', !enabled);
        if (!enabled) overlay.classList.remove('call-overlay--self-view-primary');
        _syncLocalVideo(overlay, stream, enabled);
    });

    const toggleViewSwap = (event) => {
        if (event?.target?.closest?.('button')) return;
        if (!overlay.classList.contains('call-overlay--has-remote-video')) return;
        if (!overlay.classList.contains('call-overlay--has-local-video')) return;
        overlay.classList.toggle('call-overlay--self-view-primary');
    };
    overlay.querySelectorAll('[data-call-view-toggle]').forEach((el) => {
        el.addEventListener('click', toggleViewSwap);
    });

    const speakerBtn = overlay.querySelector('#call-btn-speaker');
    if (isMobile && speakerBtn) {
        speakerBtn.addEventListener('click', async () => {
            const enabled = speakerBtn.getAttribute('aria-pressed') !== 'true';
            speakerBtn.disabled = true;
            speakerBtn.setAttribute('aria-pressed', String(enabled));
            speakerBtn.classList.toggle('call-ctrl--active-positive', enabled);
            speakerBtn.querySelector('.call-ctrl__label').textContent = enabled ? 'Громко' : 'Динамик';
            try {
                await _setSpeakerMode(enabled, overlay);
            } finally {
                speakerBtn.disabled = false;
            }
        });
    } else {
        speakerBtn?.remove();
    }

    overlay.querySelector('#call-btn-end').addEventListener('click', () => onEnd(callId));
    overlay.querySelector('.call-topbar__end').addEventListener('click', () => onEnd(callId));
}

export function removeActiveCallOverlay({ immediate = false } = {}) {
    _setSpeakerMode(false);
    _setCallTopbarActive(false);
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
    _currentOverlay()?.querySelectorAll('[data-call-status]').forEach((el) => {
        el.textContent = text;
    });
}

export function setCallVerificationCode(code) {
    const el = _currentOverlay()?.querySelector('#call-verification-code');
    if (!el) return;
    const value = String(code || '').trim();
    el.hidden = !value;
    el.textContent = value ? `Код безопасности: ${value}` : '';
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
        overlay?.classList.add('call-overlay--has-remote-video', 'call-overlay--video-active');
        overlay?.classList.remove('call-overlay--audio-only');
    }
    track.onunmute = () => _playMedia(media);
    _playMedia(media);
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
}

function _currentOverlay() {
    const overlays = document.querySelectorAll('#call-active-overlay');
    return overlays[overlays.length - 1] || null;
}

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
        return;
    }
    localVideo.classList.add('call-overlay__local-video--hidden');
    overlay?.classList.remove('call-overlay--self-view-primary');
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
        return;
    }

    const syncOffset = () => {
        const topbar = overlay?.querySelector?.('#call-topbar');
        const height = Math.ceil(topbar?.getBoundingClientRect?.().height || 42);
        chatArea.style.setProperty('--call-topbar-offset', `${height}px`);
        chatArea.classList.add('chat-area--call-active');
    };
    syncOffset();
    if (!callTopbarResizeHandler) {
        callTopbarResizeHandler = syncOffset;
        window.addEventListener('resize', callTopbarResizeHandler);
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

async function _setSpeakerMode(enabled, overlay = _currentOverlay()) {
    overlay?.classList.toggle('call-overlay--speaker-on', enabled);
    const remoteAudio = overlay?.querySelector('#call-remote-audio');
    if (remoteAudio) {
        remoteAudio.muted = false;
        remoteAudio.volume = 1;
        await _selectAudioOutput(remoteAudio, { speaker: enabled });
        _playMedia(remoteAudio);
    }

    if (!enabled) {
        await _releaseScreenWakeLock();
        return;
    }
    await _requestScreenWakeLock();
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

async function _releaseScreenWakeLock() {
    const lock = screenWakeLock;
    screenWakeLock = null;
    if (!lock) return;
    try {
        await lock.release();
    } catch (_) {}
}
