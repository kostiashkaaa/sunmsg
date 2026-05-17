/**
 * call-ui.js
 * Telegram-style call UI: incoming banner + active call overlay.
 */

import { escapeHtml } from './utils.js';

// ── Incoming call banner ─────────────────────────────────────────────────────

export function showIncomingCallBanner({ callId, callType, initiator, onAccept, onReject }) {
    removeIncomingCallBanner();

    const name = escapeHtml(initiator.display_name || initiator.username || '');
    const initial = (initiator.display_name || initiator.username || '?')[0].toUpperCase();
    const typeLabel = callType === 'video' ? 'Входящий видеозвонок' : 'Входящий голосовой звонок';
    const avatarHtml = initiator.avatar_url
        ? `<img src="${escapeHtml(initiator.avatar_url)}" class="call-ib__avatar-img" alt="">`
        : `<div class="call-ib__avatar-fallback">${escapeHtml(initial)}</div>`;

    const banner = document.createElement('div');
    banner.id = 'call-incoming-banner';
    banner.className = 'call-ib';
    banner.setAttribute('role', 'alertdialog');
    banner.setAttribute('aria-label', 'Входящий звонок');
    banner.innerHTML = `
        <div class="call-ib__left">
            <div class="call-ib__avatar">${avatarHtml}</div>
            <div class="call-ib__info">
                <div class="call-ib__name">${name}</div>
                <div class="call-ib__type">${typeLabel}</div>
            </div>
        </div>
        <div class="call-ib__actions">
            <button class="call-ib__btn call-ib__btn--reject" aria-label="Отклонить">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M4.5 2C4.5 2 2 2 2 4.5 2 13.6 10.4 22 19.5 22c2.5 0 2.5-2.5 2.5-2.5v-3s0-1.5-1.5-1.5c-.9 0-2.1-.4-3-.7-.6-.2-1.3-.1-1.8.4l-1.5 1.5C12.1 15 9 11.9 7.8 9.3l1.5-1.5c.5-.5.6-1.2.4-1.8C9.4 5.1 9 3.9 9 3c0-1.5-1.5-1.5-1.5-1.5H4.5z"/>
                    <line x1="22" y1="2" x2="2" y2="22" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/>
                </svg>
            </button>
            <button class="call-ib__btn call-ib__btn--accept" aria-label="Принять">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M4.5 2C4.5 2 2 2 2 4.5 2 13.6 10.4 22 19.5 22c2.5 0 2.5-2.5 2.5-2.5v-3s0-1.5-1.5-1.5c-.9 0-2.1-.4-3-.7-.6-.2-1.3-.1-1.8.4l-1.5 1.5C12.1 15 9 11.9 7.8 9.3l1.5-1.5c.5-.5.6-1.2.4-1.8C9.4 5.1 9 3.9 9 3c0-1.5-1.5-1.5-1.5-1.5H4.5z"/>
                </svg>
            </button>
        </div>
    `;

    banner.querySelector('.call-ib__btn--reject').addEventListener('click', () => {
        removeIncomingCallBanner();
        onReject(callId);
    });
    banner.querySelector('.call-ib__btn--accept').addEventListener('click', () => {
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
    callId, callType, partnerName, localStream,
    onToggleAudio, onToggleVideo, onSwitchCamera, onEnd,
}) {
    removeActiveCallOverlay({ immediate: true });

    const name = escapeHtml(partnerName || 'Собеседник');
    const isVideo = callType === 'video';

    const overlay = document.createElement('div');
    overlay.id = 'call-active-overlay';
    overlay.className = 'call-overlay';
    overlay.innerHTML = `
        <div class="call-overlay__bg"></div>
        <video id="call-remote-video" class="call-overlay__remote-video" autoplay playsinline muted></video>
        <audio id="call-remote-audio" class="call-overlay__remote-audio" autoplay playsinline></audio>

        <div class="call-overlay__top">
            <div class="call-overlay__partner">${name}</div>
            <div class="call-overlay__status" id="call-status-text">Соединение...</div>
            <div class="call-overlay__verify" id="call-verification-code" hidden></div>
        </div>

        <video id="call-local-video" class="call-overlay__local-video${isVideo ? '' : ' call-overlay__local-video--hidden'}" autoplay playsinline muted></video>

        <div class="call-overlay__controls">
            <div class="call-overlay__ctrl-group">
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
                ${isVideo ? `
                <button class="call-ctrl" id="call-btn-video" aria-label="Камера">
                    <span class="call-ctrl__icon">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                            <path d="M15 10.5L21 7v10l-6-3.5V10.5z" fill="currentColor" stroke="none"/>
                            <rect x="1" y="5" width="14" height="14" rx="2.5" fill="currentColor" stroke="none"/>
                        </svg>
                    </span>
                    <span class="call-ctrl__label">Камера</span>
                </button>` : ''}
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
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('call-overlay--visible'));

    if (localStream && isVideo) {
        overlay.querySelector('#call-local-video').srcObject = localStream;
    }

    overlay.querySelector('#call-btn-audio').addEventListener('click', () => {
        const muted = onToggleAudio();
        const btn = overlay.querySelector('#call-btn-audio');
        btn.classList.toggle('call-ctrl--active', muted);
        btn.querySelector('.call-ctrl__label').textContent = muted ? 'Без звука' : 'Звук';
    });

    if (isVideo) {
        overlay.querySelector('#call-btn-video').addEventListener('click', () => {
            const enabled = onToggleVideo();
            const btn = overlay.querySelector('#call-btn-video');
            btn.classList.toggle('call-ctrl--active', !enabled);
            btn.querySelector('.call-ctrl__label').textContent = enabled ? 'Камера' : 'Без камеры';
        });
    }

    overlay.querySelector('#call-btn-end').addEventListener('click', () => onEnd(callId));
}

export function removeActiveCallOverlay({ immediate = false } = {}) {
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

export function setCallStatusText(text) {
    const el = _currentOverlay()?.querySelector('#call-status-text');
    if (el) el.textContent = text;
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

function _playMedia(media) {
    const playPromise = media.play();
    if (playPromise?.catch) {
        playPromise.catch((err) => {
            console.warn('[CallUI] remote media playback blocked', err);
        });
    }
}
