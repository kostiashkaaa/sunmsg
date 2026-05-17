/**
 * call-manager.js
 * P2P call coordinator.
 *
 * Security: DTLS-SRTP transport encryption. The server relays SDP/ICE only.
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
    setCallStatusText, setCallVerificationCode,
    attachRemoteTrack, removeRemoteTrack, setRemoteVideoEnabled,
    setRemoteAudioMuted, startCallDurationTimer, setCallQualityIndicator,
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
const RING_TIMEOUT_MS = 60_000;

function _normalizeIceTransportPolicy(value) {
    return String(value || '').trim().toLowerCase() === 'relay' ? 'relay' : 'all';
}

export class CallManager {
    /**
     * @param {object} opts
     * @param {object} opts.socket        - socket.io client
     * @param {function(): string} opts.getCsrfToken
     * @param {string} opts.iceConfigUrl  - Flask endpoint that returns {iceServers:[…]}
     */
    constructor({ socket, getCsrfToken, iceConfigUrl = '/call/ice-config', resolvePartnerInfo = null }) {
        this._socket       = socket;
        this._getCsrfToken = getCsrfToken;
        this._iceConfigUrl = iceConfigUrl;
        this._resolvePartnerInfo = typeof resolvePartnerInfo === 'function' ? resolvePartnerInfo : null;

        this._state    = STATES.IDLE;
        this._callId   = null;
        this._chatId   = null;
        this._callType = null;
        this._partner  = null;   // { user_id, display_name, avatar_url }
        this._isPolite = false;  // true = callee

        this._media      = new CallMedia();
        this._webrtc     = null;
        this._iceServers = null;          // cached for the session
        this._iceTransportPolicy = 'all';
        this._iceServersExpiresAt = 0;    // epoch ms; 0 = not fetched
        this._ringTimeout = null;
        this._disconnectTimeout = null;
        this._iceRestarting = false;

        // Queue for WebRTC signals that arrive before _webrtc is initialised
        this._pendingSignals = [];

        this._bindSocketEvents();
        this._bindUnloadHandler();
    }

    // Tell the server the call is over when the tab is closing. 'pagehide'
    // fires reliably on mobile (unlike 'beforeunload'); the emit is best-effort
    // but the server-side disconnect cleanup is the real safety net.
    _bindUnloadHandler() {
        this._onPageHide = () => {
            if (this._state === STATES.IDLE || !this._callId) return;
            const event = this._state === STATES.RINGING_OUT ? 'call_cancel'
                : this._state === STATES.RINGING_IN ? 'call_reject'
                : 'call_end';
            try {
                this._socket.emit(event, {
                    call_id: this._callId,
                    csrf_token: this._getCsrfToken(),
                });
            } catch (_) { /* tab is closing — best effort */ }
        };
        window.addEventListener('pagehide', this._onPageHide);
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
        this._socket.on('call_sync',         d => this._onCallSync(d));
        this._socket.on('call_media_state',  d => this._onPartnerMediaState(d));
        this._socket.on('connect',           () => this._syncCallState());
        // WebRTC P2P signalling — relayed by server without inspection
        this._socket.on('call_offer',        d => this._onOffer(d));
        this._socket.on('call_answer',       d => this._onAnswer(d));
        this._socket.on('call_ice_candidate',d => this._onIceCandidate(d));
        if (this._socket.connected) {
            const defer = globalThis.queueMicrotask || ((fn) => Promise.resolve().then(fn));
            defer(() => this._syncCallState());
        }
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
        this._partner  = this._resolvePartner(partnerInfo);  // set from DOM before server confirms
        startRingtone('outgoing');
        this._ringTimeout = setTimeout(() => {
            if (this._state !== STATES.RINGING_OUT) return;
            if (this._callId) this._emit('call_cancel', { call_id: this._callId });
            showToast('Звонок не принят', 'info');
            this._cleanup();
        }, RING_TIMEOUT_MS);
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
        this._partner  = this._resolvePartner(initiator);
        this._state    = STATES.RINGING_IN;
        startRingtone('incoming');

        // Auto-dismiss locally after the caller-side timeout expires.
        this._ringTimeout = setTimeout(() => {
            if (this._state === STATES.RINGING_IN) {
                this._cleanup();
            }
        }, RING_TIMEOUT_MS);

        showIncomingCallBanner({
            callId:    call_id,
            callType:  call_type,
            initiator: this._partner,
            onAccept:  (id, type) => this.acceptCall(id, type),
            onReject:  (id)       => this.rejectCall(id),
        });
    }

    _onInitiated({ call_id }) {
        if (this._state !== STATES.RINGING_OUT) {
            this._emit('call_cancel', { call_id });
            return;
        }
        this._callId = call_id;
        // Show overlay immediately for caller with "Звонок..."
        const partner = this._resolvePartner(this._partner);
        this._partner = partner;
        const partnerName = partner.display_name || partner.username || 'Собеседник';
        showActiveCallOverlay({
            callId:    call_id,
            callType:  this._callType,
            callRole: 'caller',
            partnerName,
            partnerAvatar: partner.avatar_url || '',
            localStream: null,  // media not yet acquired — will be set on accept
            onToggleAudio: () => false,
            onToggleVideo: () => false,
            onSwitchCamera: () => {},
            onListDevices: async () => ({}),
            onSelectMicrophone: async () => null,
            onSelectCamera: async () => null,
            onEnd: () => this.endCall(),
        });
        setCallStatusText('Звонок...');
    }

    async _onAccepted({ call_id, user_id }) {
        if (call_id !== this._callId) return;
        if (this._state !== STATES.RINGING_OUT) return;
        this._state = STATES.ACTIVE;
        stopRingtone();
        clearTimeout(this._ringTimeout);
        this._ringTimeout = null;
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
            calls_feature_disabled:    'Звонки доступны только тестовой группе',
            server_error:             'Ошибка сервера',
        };
        showToast(MESSAGES[error] || `Ошибка звонка: ${error}`, 'error');
        if (this._state !== STATES.IDLE) this._cleanup();
    }

    _onPartnerMediaState({ call_id, audio_muted, video_enabled }) {
        if (call_id !== this._callId) return;
        setRemoteVideoEnabled(Boolean(video_enabled));
        setRemoteAudioMuted(Boolean(audio_muted));
    }

    async _onCallSync({ active_call }) {
        const activeCall = active_call || null;
        if (!activeCall) {
            if (this._state !== STATES.IDLE) {
                showToast('Состояние звонка обновлено', 'info');
                this._cleanup();
            }
            return;
        }

        const callId = String(activeCall.call_id || '');
        const status = String(activeCall.status || '');
        if (this._state !== STATES.IDLE && callId !== this._callId) {
            showToast('Состояние звонка обновлено', 'info');
            this._cleanup();
            return;
        }
        if (this._state === STATES.RINGING_OUT && status === 'active' && callId === this._callId) {
            this._state = STATES.ACTIVE;
            stopRingtone();
            clearTimeout(this._ringTimeout);
            this._ringTimeout = null;
            removeActiveCallOverlay();
            await this._startMedia();
            return;
        }
        if (this._state === STATES.RINGING_IN && status === 'active' && callId === this._callId) {
            this._cleanup();
            return;
        }
        if (this._state === STATES.IDLE && status === 'ringing' && activeCall.role === 'callee') {
            this._onIncoming({
                call_id: callId,
                chat_id: activeCall.chat_id,
                call_type: activeCall.call_type,
                initiator: activeCall.partner,
            });
        }
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
        // 1. Get ICE server config from Flask (includes TURN credentials).
        // Re-fetch if credentials are within 5 minutes of expiry to avoid stale TURN creds on reconnect.
        const needsRefresh = !this._iceServers || Date.now() > this._iceServersExpiresAt - 5 * 60 * 1000;
        if (needsRefresh) {
            try {
                const result = await this._fetchIceServers();
                this._iceServers = result.iceServers;
                this._iceTransportPolicy = result.iceTransportPolicy;
                // Server TTL is TURN_CREDENTIAL_TTL_SECONDS (default 3600 s). Use that if returned, else 55 min.
                const ttlMs = (result.ttlSeconds || 3300) * 1000;
                this._iceServersExpiresAt = Date.now() + ttlMs;
            } catch (err) {
                console.warn('[CallManager] ICE config fetch failed, using STUN only', err);
                if (!this._iceServers) {
                    this._iceServers = [{ urls: 'stun:stun.l.google.com:19302' }];
                    this._iceServersExpiresAt = Date.now() + 55 * 60 * 1000;
                }
            }
        }

        // 2. Acquire local media
        try {
            if (this._callType === 'video') {
                await this._media.acquireVideo();
            } else {
                await this._media.acquireAudio();
            }
        } catch (err) {
            console.warn('[CallManager] local media access failed', err);
            const message = _mediaAccessMessage(err, this._callType);
            setCallStatusText(message);
            showToast(message, 'error');
            this.endCall();
            return;
        }

        // 3. Show call overlay with local preview
        const partner = this._resolvePartner(this._partner);
        this._partner = partner;
        const partnerName = partner.display_name || partner.username || 'Собеседник';
        showActiveCallOverlay({
            callId:    this._callId,
            callType:  this._callType,
            callRole: this._isPolite ? 'callee' : 'caller',
            partnerName,
            partnerAvatar: partner.avatar_url || '',
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
            onToggleVideo: async () => {
                const enabled = await this._toggleVideo();
                this._emit('call_media_state', {
                    call_id:       this._callId,
                    audio_muted:   this._media.isAudioMuted(),
                    video_enabled: enabled,
                });
                return { enabled, localStream: this._media.getLocalStream() };
            },
            onSwitchCamera: async () => {
                let newTrack = null;
                try {
                    newTrack = await this._media.switchCamera();
                } catch (err) {
                    console.warn('[CallManager] camera switch failed', err);
                    setCallStatusText('Камера недоступна');
                }
                if (newTrack) await this._webrtc?.replaceVideoTrack(newTrack);
                return {
                    switched: Boolean(newTrack),
                    localStream: this._media.getLocalStream(),
                    facingMode: this._media.getVideoFacingMode(),
                };
            },
            onListDevices: async () => {
                const devices = await this._media.listDevices();
                return {
                    ...devices,
                    selected: {
                        audioInputId: this._media.getAudioDeviceId(),
                        videoInputId: this._media.getVideoDeviceId(),
                    },
                };
            },
            onSelectMicrophone: async (deviceId) => {
                try {
                    const newTrack = await this._media.selectAudioInput(deviceId);
                    await this._webrtc?.replaceAudioTrack(newTrack);
                    this._webrtc?.setAudioEnabled(!this._media.isAudioMuted());
                } catch (err) {
                    const message = _mediaAccessMessage(err, 'audio');
                    setCallStatusText(message);
                    showToast(message, 'error');
                }
                return { localStream: this._media.getLocalStream() };
            },
            onSelectCamera: async (deviceId) => {
                try {
                    const newTrack = await this._media.selectVideoInput(deviceId);
                    this._callType = 'video';
                    await this._webrtc?.addVideoTrack(newTrack, this._media.getLocalStream());
                    this._emit('call_media_state', {
                        call_id:       this._callId,
                        audio_muted:   this._media.isAudioMuted(),
                        video_enabled: this._media.isVideoEnabled(),
                    });
                } catch (err) {
                    const message = _mediaAccessMessage(err, 'video');
                    setCallStatusText(message);
                    showToast(message, 'error');
                }
                return { localStream: this._media.getLocalStream() };
            },
            onEnd: () => this.endCall(),
        });

        // 4. Create RTCPeerConnection and wire callbacks
        this._webrtc = new CallWebRTC({
            callId:  this._callId,
            iceServers: this._iceServers,
            iceTransportPolicy: this._iceTransportPolicy,
            onSignal: (event, payload) => this._emit(event, payload),
            onRemoteTrack: (track) => {
                attachRemoteTrack(track);
                setCallStatusText('Соединено');
                startCallDurationTimer();
            },
            onVerificationCode: (code) => setCallVerificationCode(code),
            onQualityStats: (stats) => setCallQualityIndicator(stats),
            onConnectionState: (state) => {
                if (state === 'connected') {
                    clearTimeout(this._disconnectTimeout);
                    this._disconnectTimeout = null;
                    setCallStatusText('Соединено');
                    startCallDurationTimer();
                    playConnectedSound();
                } else if (state === 'disconnected') {
                    setCallStatusText('Переподключение...');
                    // Try to recover the connection in place via ICE restart
                    // (handles Wi-Fi ↔ cellular switches) before giving up.
                    void this._restartIceWithFreshConfig();
                    // End the call only if it has not recovered by the timeout.
                    clearTimeout(this._disconnectTimeout);
                    this._disconnectTimeout = setTimeout(() => {
                        if (this._state === STATES.ACTIVE) {
                            showToast('Соединение потеряно', 'error');
                            this.endCall();
                        }
                    }, DISCONNECT_TIMEOUT_MS);
                } else if (state === 'failed') {
                    clearTimeout(this._disconnectTimeout);
                    this._disconnectTimeout = null;
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

    async _toggleVideo() {
        if (this._media.getVideoTrack()) {
            const enabled = this._media.toggleVideo();
            this._webrtc?.setVideoEnabled(enabled);
            return enabled;
        }

        try {
            const newTrack = await this._media.enableVideo();
            if (!newTrack) return false;
            this._callType = 'video';
            await this._webrtc?.addVideoTrack(newTrack, this._media.getLocalStream());
            return true;
        } catch (err) {
            console.warn('[CallManager] video enable failed', err);
            setCallStatusText('Камера недоступна');
            return false;
        }
    }

    // ── ICE server config ────────────────────────────────────────────────────

    async _fetchIceServers() {
        const url = new URL(this._iceConfigUrl, window.location.origin);
        if (this._callId) url.searchParams.set('call_id', this._callId);
        const resp = await fetch(url.toString(), {
            headers: { 'X-CSRFToken': this._getCsrfToken() },
        });
        if (!resp.ok) throw new Error(`ICE config ${resp.status}`);
        const {
            ice_servers,
            turn_configured,
            turn_credential_ttl_seconds,
            ice_transport_policy,
        } = await resp.json();
        if (!turn_configured) {
            console.warn('[CallManager] TURN is not configured; calls outside the same network may fail');
        }
        return {
            iceServers: ice_servers,
            iceTransportPolicy: _normalizeIceTransportPolicy(ice_transport_policy),
            ttlSeconds: turn_credential_ttl_seconds || 3300,
        };
    }

    // ── Helpers ──────────────────────────────────────────────────────────────

    async _restartIceWithFreshConfig() {
        if (this._iceRestarting) return;
        this._iceRestarting = true;
        try {
            try {
                const result = await this._fetchIceServers();
                this._iceServers = result.iceServers;
                this._iceTransportPolicy = result.iceTransportPolicy;
                const ttlMs = (result.ttlSeconds || 3300) * 1000;
                this._iceServersExpiresAt = Date.now() + ttlMs;
                this._webrtc?.updateIceServers(this._iceServers, this._iceTransportPolicy);
            } catch (err) {
                console.warn('[CallManager] ICE config refresh failed before restart', err);
            }
            this._webrtc?.restartIce();
        } finally {
            this._iceRestarting = false;
        }
    }

    _syncCallState() {
        this._emit('call_sync', { call_id: this._callId || null });
    }

    _emit(event, data) {
        this._socket.emit(event, { ...data, csrf_token: this._getCsrfToken() });
    }

    _resolvePartner(partnerInfo = null) {
        const seed = partnerInfo || {};
        const fallback = this._resolvePartnerInfo?.(seed) || {};
        return {
            ...fallback,
            ...seed,
            display_name: seed.display_name || fallback.display_name || '',
            username: seed.username || fallback.username || '',
            avatar_url: seed.avatar_url || fallback.avatar_url || '',
            user_id: seed.user_id || fallback.user_id || null,
        };
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
        this._iceRestarting = false;
        this._iceServers  = null;
        this._iceTransportPolicy = 'all';
        this._iceServersExpiresAt = 0;
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

function _mediaAccessMessage(error, callType) {
    const name = String(error?.name || '');
    const isVideo = callType === 'video';
    if (name === 'NotAllowedError' || name === 'SecurityError') {
        return isVideo
            ? 'Разрешите доступ к микрофону и камере в браузере'
            : 'Разрешите доступ к микрофону в браузере';
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        return isVideo
            ? 'Микрофон или камера не найдены. Подключите устройство и повторите звонок'
            : 'Микрофон не найден. Подключите устройство и повторите звонок';
    }
    if (name === 'NotReadableError' || name === 'TrackStartError') {
        return 'Медиаустройство занято другим приложением';
    }
    return isVideo
        ? 'Не удалось открыть микрофон или камеру'
        : 'Не удалось открыть микрофон';
}
