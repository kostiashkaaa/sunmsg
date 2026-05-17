/**
 * call-ui.js
 * DOM for incoming call banner and active call overlay.
 * Renders into #call-incoming-banner and #call-active-overlay.
 */

import { escapeHtml } from './utils.js';

// ── Incoming call banner ─────────────────────────────────────────────────────

export function showIncomingCallBanner({ callId, callType, initiator, onAccept, onReject }) {
    removeIncomingCallBanner();

    const banner = document.createElement('div');
    banner.id = 'call-incoming-banner';
    banner.className = 'call-incoming-banner';
    banner.setAttribute('role', 'alertdialog');
    banner.setAttribute('aria-label', 'Входящий звонок');

    const avatarHtml = initiator.avatar_url
        ? `<img src="${escapeHtml(initiator.avatar_url)}" class="call-avatar" alt="">`
        : `<div class="call-avatar call-avatar--fallback">${escapeHtml((initiator.display_name || '?')[0].toUpperCase())}</div>`;

    const typeLabel = callType === 'video' ? 'Видеозвонок' : 'Голосовой звонок';

    banner.innerHTML = `
        <div class="call-incoming-banner__body">
            ${avatarHtml}
            <div class="call-incoming-banner__info">
                <div class="call-incoming-banner__name">${escapeHtml(initiator.display_name || initiator.username)}</div>
                <div class="call-incoming-banner__type">${typeLabel}</div>
            </div>
        </div>
        <div class="call-incoming-banner__actions">
            <button class="call-btn call-btn--reject" aria-label="Отклонить">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 011.72 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.42 19.42 0 013.07 8.63 19.79 19.79 0 01-.1 0a2 2 0 012-2.18h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L5.68 7.68a16 16 0 002.62 3.41"/>
                    <line x1="23" y1="1" x2="1" y2="23"/>
                </svg>
            </button>
            <button class="call-btn call-btn--accept" aria-label="Принять">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 013.07 8.63 19.79 19.79 0 01.09 2 2 2 0 012.09 0h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L6.09 7.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
                </svg>
            </button>
        </div>
    `;

    banner.querySelector('.call-btn--reject').addEventListener('click', () => {
        removeIncomingCallBanner();
        onReject(callId);
    });
    banner.querySelector('.call-btn--accept').addEventListener('click', () => {
        removeIncomingCallBanner();
        onAccept(callId, callType);
    });

    document.body.appendChild(banner);
    requestAnimationFrame(() => banner.classList.add('call-incoming-banner--visible'));
}

export function removeIncomingCallBanner() {
    const existing = document.getElementById('call-incoming-banner');
    if (existing) existing.remove();
}

// ── Active call overlay ──────────────────────────────────────────────────────

export function showActiveCallOverlay({
    callId,
    callType,
    partnerName,
    localStream,
    onToggleAudio,
    onToggleVideo,
    onSwitchCamera,
    onEnd,
}) {
    removeActiveCallOverlay();

    const overlay = document.createElement('div');
    overlay.id = 'call-active-overlay';
    overlay.className = 'call-active-overlay';

    overlay.innerHTML = `
        <div class="call-overlay__header">
            <div class="call-overlay__partner">${escapeHtml(partnerName)}</div>
            <div class="call-overlay__status" id="call-status-text">Соединение...</div>
        </div>
        <div class="call-overlay__video-area">
            <video id="call-remote-video" class="call-video call-video--remote" autoplay playsinline></video>
            <video id="call-local-video" class="call-video call-video--local" autoplay playsinline muted></video>
        </div>
        <div class="call-overlay__controls">
            <button class="call-ctrl-btn" id="call-btn-audio" aria-label="Микрофон" title="Выключить микрофон">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z"/>
                    <path d="M19 10v2a7 7 0 01-14 0v-2"/>
                    <line x1="12" y1="19" x2="12" y2="23"/>
                    <line x1="8" y1="23" x2="16" y2="23"/>
                </svg>
            </button>
            ${callType === 'video' ? `
            <button class="call-ctrl-btn" id="call-btn-video" aria-label="Камера" title="Выключить камеру">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="23 7 16 12 23 17 23 7"/>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
                </svg>
            </button>
            <button class="call-ctrl-btn" id="call-btn-switch-cam" aria-label="Переключить камеру" title="Переключить камеру">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="1 4 1 10 7 10"/>
                    <polyline points="23 20 23 14 17 14"/>
                    <path d="M20.49 9A9 9 0 005.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 013.51 15"/>
                </svg>
            </button>
            ` : ''}
            <button class="call-ctrl-btn call-ctrl-btn--end" id="call-btn-end" aria-label="Завершить" title="Завершить звонок">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path d="M10.68 13.31a16 16 0 003.41 2.6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7 2 2 0 011.72 2v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.42 19.42 0 013.07 8.63 19.79 19.79 0 01-.1 0a2 2 0 012-2.18h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L5.68 7.68a16 16 0 002.62 3.41"/>
                    <line x1="23" y1="1" x2="1" y2="23"/>
                </svg>
            </button>
        </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('call-active-overlay--visible'));

    // Bind local video
    if (localStream) {
        const localVideo = overlay.querySelector('#call-local-video');
        localVideo.srcObject = localStream;
    }

    overlay.querySelector('#call-btn-audio').addEventListener('click', () => {
        const muted = onToggleAudio();
        const btn = overlay.querySelector('#call-btn-audio');
        btn.classList.toggle('call-ctrl-btn--muted', muted);
        btn.title = muted ? 'Включить микрофон' : 'Выключить микрофон';
    });

    if (callType === 'video') {
        overlay.querySelector('#call-btn-video').addEventListener('click', () => {
            const enabled = onToggleVideo();
            const btn = overlay.querySelector('#call-btn-video');
            btn.classList.toggle('call-ctrl-btn--muted', !enabled);
            btn.title = enabled ? 'Выключить камеру' : 'Включить камеру';
        });
        overlay.querySelector('#call-btn-switch-cam')?.addEventListener('click', onSwitchCamera);
    }

    overlay.querySelector('#call-btn-end').addEventListener('click', () => onEnd(callId));
}

export function removeActiveCallOverlay() {
    const existing = document.getElementById('call-active-overlay');
    if (existing) {
        existing.classList.remove('call-active-overlay--visible');
        setTimeout(() => existing.remove(), 300);
    }
}

export function setCallStatusText(text) {
    const el = document.getElementById('call-status-text');
    if (el) el.textContent = text;
}

export function attachRemoteTrack(track) {
    const video = document.getElementById('call-remote-video');
    if (!video) return;
    if (!video.srcObject) video.srcObject = new MediaStream();
    video.srcObject.addTrack(track);
    if (video.paused) video.play().catch(() => {});
}

export function removeRemoteTrack(kind) {
    const video = document.getElementById('call-remote-video');
    if (!video || !video.srcObject) return;
    video.srcObject.getTracks().filter(t => t.kind === kind).forEach(t => {
        video.srcObject.removeTrack(t);
        t.stop();
    });
}
