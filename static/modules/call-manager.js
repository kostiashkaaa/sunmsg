/**
 * call-manager.js
 * P2P call coordinator.
 *
 * Security: DTLS-SRTP E2E — server only relays SDP/ICE, never sees media keys.
 *
 * Perfect negotiation pattern (RFC 8829):
 *   Caller  = impolite peer (polite=false) — initiates offer
 *   Callee  = polite   peer (polite=true)  — accepts offer, may defer
 *
 * State machine:
 *   idle → ringing_out → active → ended
 *        → ringing_in  → active → ended
 *                      → rejected / cancelled / missed
 */

import { CallMedia } from './call-media.js';
import { CallWebRTC } from './call-webrtc.js';
import {
    showIncomingCallBanner, removeIncomingCallBanner,
    showActiveCallOverlay, removeActiveCallOverlay,
    setCallStatusText, attachRemoteTrack, removeRemoteTrack,
} from './call-ui.js';
import {
    startRingtone, stopRingtone,
    playConnectedSound, playEndCallSound, playBusyTone,
} from './call-sounds.js';
import { showToast } from './dialogs.js';

const STATES = {
    IDLE:        'idle',
    RINGING_OUT: 'ringing_out',
    RINGING_IN:  'ringing_in',
    ACTIVE:      'active',
};

// How long to wait in 'disconnected' state before giving up
const DISCONNECT_TIMEOUT_MS = 15_000;

export class CallManager {
    /**
     * @param {object} opts
     * @param {object} opts.socket        - socket.io client
     * @param {function(): string} opts.getCsrfToken
     * @param {string} opts.iceConfigUrl  - Flask endpoint that returns {iceServers:[…]}
     */
    constructor({ socket, getCsrfToken, iceConfigUrl = '/call/ice-config' }) {
        this._socket       = socket;
        this._getCsrfToken = getCsrfToken;
        this._iceConfigUrl = iceConfigUrl;

        this._state    = STATES.IDLE;
        this._callId   = null;
        this._chatId   = null;
        this._callType = null;
        this._partner  = null;   // { user_id, display_name, avatar_url }
        this._isPolite = false;  // true = callee

        this._media      = new CallMedia();
        this._webrtc     = null;
        this._iceServers = null;  // cached for the session
        this._ringTimeout = null;
        this._disconnectTimeout = null;

        // Queue for WebRTC signals that arrive before _webrtc is initialised
        this._pendingSignals = [];

        this._bindSocketEvents();
    }

    // ── Socket event bindings ────────────────────────────────────────────────

    _bindSocketEvents() {
        this._socket.on('call_incoming',     d => this._onIncoming(d));
        this._socket.on('call_initiated',    d => this._onInitiated(d));
        this._socket.on('call_accepted',     d => this._onAccepted(d));
        this._socket.on('call_rejected',     d => this._onRejected(d));
        this._socket.on('call_cancelled',    d => this._onCancelled(d));
        this._socket.on('call_ended',        d => this._onEnded(d));
        this._socket.on('call_error',        d => this._onError(d));
        this._socket.on('call_media_state',  d => this._onPartnerMediaState(d));
        // WebRTC P2P signalling — relayed by server without inspection
        this._socket.on('call_offer',        d => this._onOffer(d));
        this._socket.on('call_answer',       d => this._onAnswer(d));
        this._socket.on('call_ice_candidate',d => this._onIceCandidate(d));
    }

    // ── Public API ───────────────────────────────────────────────────────────

    async startCall(chatId, callType = 'audio', partnerInfo = null) {
        if (this._state !== STATES.IDLE) {
            showToast('Уже есть активный звонок', 'warning');
            return;
        }
        this._chatId   = chatId;
        this._callType = callType;
        this._state    = STATES.RINGING_OUT;
        this._isPolite = false;  // caller is impolite
        this._partner  = partnerInfo;  // set from DOM before server confirms
        startRingtone();
        this._emit('call_initiate', { chat_id: chatId, call_type: callType });
    }

    endCall() {
        if (this._state === STATES.IDLE) return;
        if (this._state === STATES.RINGING_OUT) {
            this._emit('call_cancel', { call_id: this._callId });
        } else if (this._state === STATES.RINGING_IN) {
            this._emit('call_reject', { call_id: this._callId });
        } else {
            this._emit('call_end', { call_id: this._callId });
        }
        this._cleanup();
    }

    rejectCall(callId) {
        this._emit('call_reject', { call_id: callId });
        this._cleanup();
    }

    async acceptCall(callId, callType) {
        this._callId   = callId;
        this._callType = callType;
        this._state    = STATES.ACTIVE;
        this._isPolite = true;   // callee is polite
        stopRingtone();
        clearTimeout(this._ringTimeout);
        this._ringTimeout = null;
        removeIncomingCallBanner();
        this._emit('call_accept', { call_id: callId });
        await this._startMedia();
    }

    // ── Signalling: lifecycle ────────────────────────────────────────────────

    _onIncoming({ call_id, chat_id, call_type, initiator }) {
        if (this._state !== STATES.IDLE) {
            // Already busy — auto-reject with notification
            this._socket.emit('call_reject', { call_id, csrf_token: this._getCsrfToken() });
            showToast('Входящий звонок отклонён (вы в другом звонке)', 'info');
            return;
        }
        this._callId   = call_id;
        this._chatId   = chat_id;
        this._callType = call_type;
        this._partner  = initiator;
        this._state    = STATES.RINGING_IN;
        startRingtone();

        // Auto-dismiss after 60s as missed call
        this._ringTimeout = setTimeout(() => {
            if (this._state === STATES.RINGING_IN) {
                // Notify server so it can mark as missed
                this._socket.emit('call_reject', { call_id: this._callId, csrf_token: this._getCsrfToken() });
                this._cleanup();
            }
        }, 60_000);

        showIncomingCallBanner({
            callId:    call_id,
            callType:  call_type,
            initiator,
            onAccept:  (id, type) => this.acceptCall(id, type),
            onReject:  (id)       => this.rejectCall(id),
        });
    }

    _onInitiated({ call_id }) {
        this._callId = call_id;
        // Show overlay immediately for caller with "Звонок..."
        const partnerName = this._partner?.display_name || this._partner?.username || 'Собеседник';
        showActiveCallOverlay({
            callId:    call_id,
            callType:  this._callType,
            partnerName,
            localStream: null,  // media not yet acquired — will be set on accept
            onToggleAudio: () => false,
            onToggleVideo: () => false,
            onSwitchCamera: () => {},
            onEnd: () => this.endCall(),
        });
        setCallStatusText('Звонок...');
    }

    async _onAccepted({ call_id, user_id }) {
        if (call_id !== this._callId) return;
        if (this._state !== STATES.RINGING_OUT) return;
        this._state = STATES.ACTIVE;
        stopRingtone();
        setCallStatusText('Соединение...');
        // Remove placeholder overlay and build real one with media
        removeActiveCallOverlay();
        await this._startMedia();
    }

    _onRejected({ call_id }) {
        if (call_id !== this._callId) return;
        playBusyTone();
        showToast('Звонок отклонён', 'info');
        this._cleanup();
    }

    _onCancelled({ call_id }) {
        if (call_id !== this._callId) return;
        stopRingtone();
        removeIncomingCallBanner();
        showToast('Звонок отменён', 'info');
        this._cleanup();
    }

    _onEnded({ call_id, duration_sec }) {
        if (call_id !== this._callId) return;
        playEndCallSound();
        const dur = _formatDuration(duration_sec);
        showToast(dur ? `Звонок завершён · ${dur}` : 'Звонок завершён', 'info');
        this._cleanup();
    }

    _onError({ error }) {
        const MESSAGES = {
            call_already_active:      'В этом чате уже есть звонок',
            user_busy:                'Вы уже в звонке',
            not_member:               'Нет доступа к чату',
            call_not_found_or_expired:'Звонок не найден или истёк',
            server_error:             'Ошибка сервера',
        };
        showToast(MESSAGES[error] || `Ошибка звонка: ${error}`, 'error');
        if (this._state !== STATES.IDLE) this._cleanup();
    }

    _onPartnerMediaState({ call_id, audio_muted, video_enabled }) {
        if (call_id !== this._callId) return;
        // Future: show partner mute indicator in UI
    }

    // ── Signalling: WebRTC P2P ───────────────────────────────────────────────

    async _onOffer({ call_id, sdp, from_user_id }) {
        if (call_id !== this._callId) return;
        if (!this._webrtc) {
            // Queue until _webrtc is ready
            this._pendingSignals.push({ type: 'offer', sdp, from_user_id });
            return;
        }
        await this._webrtc.handleOffer({ sdp });
    }

    async _onAnswer({ call_id, sdp, from_user_id }) {
        if (call_id !== this._callId) return;
        if (!this._webrtc) {
            this._pendingSignals.push({ type: 'answer', sdp, from_user_id });
            return;
        }
        await this._webrtc.handleAnswer({ sdp });
    }

    async _onIceCandidate({ call_id, candidate, from_user_id }) {
        if (call_id !== this._callId) return;
        if (!this._webrtc) {
            this._pendingSignals.push({ type: 'ice', candidate, from_user_id });
            return;
        }
        await this._webrtc.handleIceCandidate({ candidate });
    }

    // Drain any signals that arrived before _webrtc was ready
    async _drainPendingSignals() {
        const queue = this._pendingSignals.splice(0);
        for (const sig of queue) {
            if (!this._webrtc) break;
            if (sig.type === 'offer')  await this._webrtc.handleOffer({ sdp: sig.sdp });
            if (sig.type === 'answer') await this._webrtc.handleAnswer({ sdp: sig.sdp });
            if (sig.type === 'ice')    await this._webrtc.handleIceCandidate({ candidate: sig.candidate });
        }
    }

    // ── Media & WebRTC setup ─────────────────────────────────────────────────

    async _startMedia() {
        // 1. Get ICE server config from Flask (includes TURN credentials)
        if (!this._iceServers) {
            try {
                this._iceServers = await this._fetchIceServers();
            } catch (err) {
                console.warn('[CallManager] ICE config fetch failed, using STUN only', err);
                this._iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
            }
        }

        // 2. Acquire local media
        try {
            if (this._callType === 'video') {
                await this._media.acquireVideo();
            } else {
                await this._media.acquireAudio();
            }
        } catch {
            showToast('Нет доступа к микрофону/камере', 'error');
            this.endCall();
            return;
        }

        // 3. Show call overlay with local preview
        const partnerName = this._partner?.display_name || this._partner?.username || 'Собеседник';
        showActiveCallOverlay({
            callId:    this._callId,
            callType:  this._callType,
            partnerName,
            localStream: this._media.getLocalStream(),
            onToggleAudio: () => {
                const muted = this._media.toggleAudio();
                this._webrtc?.setAudioEnabled(!muted);
                this._emit('call_media_state', {
                    call_id:       this._callId,
                    audio_muted:   muted,
                    video_enabled: this._media.isVideoEnabled(),
                });
                return muted;
            },
            onToggleVideo: () => {
                const enabled = this._media.toggleVideo();
                this._webrtc?.setVideoEnabled(enabled);
                this._emit('call_media_state', {
                    call_id:       this._callId,
                    audio_muted:   this._media.isAudioMuted(),
                    video_enabled: enabled,
                });
                return enabled;
            },
            onSwitchCamera: async () => {
                const newTrack = await this._media.switchCamera();
                if (newTrack) this._webrtc?.replaceVideoTrack(newTrack);
            },
            onEnd: () => this.endCall(),
        });

        // 4. Create RTCPeerConnection and wire callbacks
        this._webrtc = new CallWebRTC({
            callId:  this._callId,
            iceServers: this._iceServers,
            onSignal: (event, payload) => this._emit(event, payload),
            onRemoteTrack: (track) => {
                attachRemoteTrack(track);
                setCallStatusText('Соединено');
            },
            onConnectionState: (state) => {
                if (state === 'connected') {
                    clearTimeout(this._disconnectTimeout);
                    this._disconnectTimeout = null;
                    setCallStatusText('Соединено');
                    playConnectedSound();
                } else if (state === 'disconnected') {
                    setCallStatusText('Переподключение...');
                    // End call if still disconnected after timeout
                    this._disconnectTimeout = setTimeout(() => {
                        if (this._state === STATES.ACTIVE) {
                            showToast('Соединение потеряно', 'error');
                            this.endCall();
                        }
                    }, DISCONNECT_TIMEOUT_MS);
                } else if (state === 'failed') {
                    clearTimeout(this._disconnectTimeout);
                    showToast('Соединение потеряно', 'error');
                    this.endCall();
                } else if (state === 'closed') {
                    // handled by endCall/cleanup
                }
            },
        });

        // polite = callee (acceptCall sets _isPolite=true), impolite = caller
        this._webrtc.init(this._media.getLocalStream(), { polite: this._isPolite });

        // 5. Drain signals queued before _webrtc was ready
        await this._drainPendingSignals();
    }

    // ── ICE server config ────────────────────────────────────────────────────

    async _fetchIceServers() {
        const resp = await fetch(this._iceConfigUrl, {
            headers: { 'X-CSRFToken': this._getCsrfToken() },
        });
        if (!resp.ok) throw new Error(`ICE config ${resp.status}`);
        const { ice_servers } = await resp.json();
        return ice_servers;
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    _emit(event, data) {
        this._socket.emit(event, { ...data, csrf_token: this._getCsrfToken() });
    }

    _cleanup() {
        if (this._ringTimeout)       { clearTimeout(this._ringTimeout);       this._ringTimeout = null; }
        if (this._disconnectTimeout) { clearTimeout(this._disconnectTimeout); this._disconnectTimeout = null; }
        stopRingtone();
        removeIncomingCallBanner();
        removeActiveCallOverlay();
        // Release remote tracks before closing peer connection
        removeRemoteTrack('audio');
        removeRemoteTrack('video');
        this._webrtc?.close();
        this._webrtc = null;
        this._media.release();
        this._pendingSignals = [];
        this._iceServers  = null;
        this._state    = STATES.IDLE;
        this._callId   = null;
        this._chatId   = null;
        this._callType = null;
        this._partner  = null;
        this._isPolite = false;
    }

    isIdle()    { return this._state === STATES.IDLE; }
    getState()  { return this._state; }
    getCallId() { return this._callId; }
}

function _formatDuration(sec) {
    if (!sec) return '';
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}
