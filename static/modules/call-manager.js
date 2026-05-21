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
    removePreCallScreen,
    showIncomingCallBanner, removeIncomingCallBanner,
    showActiveCallOverlay, removeActiveCallOverlay,
    setCallStatusText, setCallVerificationCode,
    attachRemoteTrack, removeRemoteTrack, setRemoteVideoEnabled,
    setLocalVideoEnabled,
    setRemoteAudioMuted, startCallDurationTimer, setCallQualityIndicator,
    minimizeActiveCallOverlay, restoreActiveCallOverlay, setCallScreenShareActive,
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
    ACCEPTING:   'accepting',
    ACTIVE:      'active',
};

// How long to wait in 'disconnected' state before giving up
const DISCONNECT_TIMEOUT_MS = 15_000;
const RING_TIMEOUT_MS = 60_000;
const MAX_PENDING_SIGNALS = 128;
const CALL_SESSION_STORAGE_KEY = 'sun.call.session.v1';

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
        this._media.setTrackLifecycleHandlers({
            onEnded: (kind, track) => this._onLocalTrackEnded(kind, track),
            onMuted: (kind, track) => this._onLocalTrackMuted(kind, track),
            onUnmuted: (kind, track) => this._onLocalTrackUnmuted(kind, track),
        });
        this._webrtc     = null;
        this._iceServers = null;          // cached for the session
        this._iceTransportPolicy = 'all';
        this._iceServersExpiresAt = 0;    // epoch ms; 0 = not fetched
        this._ringTimeout = null;
        this._disconnectTimeout = null;
        this._iceRestarting = false;

        // Queue for WebRTC signals that arrive before _webrtc is initialised
        this._pendingSignals = [];
        this._pendingAcceptRequestId = '';
        this._pendingMediaOptions = null;
        this._selectedSpeakerDeviceId = '';
        this._screenSharing = false;
        this._cameraSwitchInProgress = false;

        this._bindSocketEvents();
        this._bindUnloadHandler();
        this._bindChatNavigationMinimize();
    }

    // Preserve enough local state for reload recovery. Server-side disconnect
    // grace owns actual call termination; ending here would turn reloads into
    // false call_end/reject transitions.
    _bindUnloadHandler() {
        this._onPageHide = () => {
            if (this._state === STATES.IDLE || !this._callId) return;
            this._rememberCallSession(this._state);
        };
        window.addEventListener('pagehide', this._onPageHide);
    }

    _bindChatNavigationMinimize() {
        document.addEventListener('sun:chat:opened', (event) => {
            if (this._state !== STATES.ACTIVE || !this._chatId) return;
            const nextChatId = String(event?.detail?.chatId || '').trim();
            if (nextChatId && String(nextChatId) === String(this._chatId)) {
                restoreActiveCallOverlay();
                return;
            }
            minimizeActiveCallOverlay();
        });
        document.addEventListener('sun:chat:closed', () => {
            if (this._state !== STATES.ACTIVE) return;
            minimizeActiveCallOverlay();
        });
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
        this._callType = callType === 'video' ? 'video' : 'audio';
        this._state    = STATES.RINGING_OUT;
        this._isPolite = false;  // caller is impolite
        this._partner  = this._resolvePartner(partnerInfo);  // set from DOM before server confirms
        this._pendingMediaOptions = {
            audioMuted: false,
            videoEnabled: this._callType === 'video',
            speakerDeviceId: this._selectedSpeakerDeviceId,
        };
        this._rememberCallSession('ringing_out');
        startRingtone('outgoing');
        this._ringTimeout = setTimeout(() => {
            if (this._state !== STATES.RINGING_OUT) return;
            if (this._callId) this._emit('call_cancel', { call_id: this._callId });
            showToast('Звонок не принят', 'info');
            this._cleanup();
        }, RING_TIMEOUT_MS);
        this._emit('call_initiate', { chat_id: this._chatId, call_type: this._callType });
    }

    endCall() {
        if (this._state === STATES.IDLE) return;
        if (this._state === STATES.RINGING_OUT) {
            this._emit('call_cancel', { call_id: this._callId });
        } else if (this._state === STATES.RINGING_IN || this._state === STATES.ACCEPTING) {
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

    async acceptCall(callId, callType, mediaOptions = {}) {
        if (this._state !== STATES.RINGING_IN || String(callId || '') !== String(this._callId || '')) return;
        this._callId   = callId;
        this._callType = callType;
        this._state    = STATES.ACCEPTING;
        this._isPolite = true;   // callee is polite
        this._pendingMediaOptions = this._normalizeMediaOptions(mediaOptions, callType);
        this._pendingAcceptRequestId = _makeRequestId('accept');
        stopRingtone();
        clearTimeout(this._ringTimeout);
        this._ringTimeout = null;
        removeIncomingCallBanner();
        this._rememberCallSession('accepting');
        this._emit('call_accept', { call_id: callId, request_id: this._pendingAcceptRequestId });
    }

    // ── Signalling: lifecycle ────────────────────────────────────────────────

    _onIncoming({ call_id, chat_id, call_type, initiator }) {
        if (String(call_id || '') && String(call_id || '') === String(this._callId || '')) {
            return;
        }
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
        this._pendingAcceptRequestId = '';
        this._rememberCallSession('ringing_in');
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
            onAccept:  (id, type, options) => this.acceptCall(id, type, options),
            onReject:  (id)       => this.rejectCall(id),
        });
    }

    _onInitiated({ call_id }) {
        if (String(call_id || '') && String(call_id || '') === String(this._callId || '') && this._state !== STATES.RINGING_OUT) {
            return;
        }
        if (this._state !== STATES.RINGING_OUT) {
            return;
        }
        this._callId = call_id;
        this._rememberCallSession('ringing_out');
        // Show overlay immediately for caller with "Звонок..."
        const partner = this._resolvePartner(this._partner);
        this._partner = partner;
        const partnerName = partner.display_name || partner.username || 'Собеседник';
        showActiveCallOverlay({
            callId:    call_id,
            callType:  this._callType,
            callRole: 'caller',
            mode: 'ringing',
            partnerName,
            partnerAvatar: partner.avatar_url || '',
            localStream: null,
            initialAudioMuted: Boolean(this._pendingMediaOptions?.audioMuted),
            initialVideoEnabled: Boolean(this._pendingMediaOptions?.videoEnabled),
            onToggleAudio: () => {
                const nextMuted = !Boolean(this._pendingMediaOptions?.audioMuted);
                this._pendingMediaOptions = {
                    ...(this._pendingMediaOptions || {}),
                    audioMuted: nextMuted,
                };
                return nextMuted;
            },
            onToggleVideo: () => {
                const nextEnabled = !Boolean(this._pendingMediaOptions?.videoEnabled);
                const nextCallType = nextEnabled ? 'video' : this._callType;
                this._pendingMediaOptions = {
                    ...(this._pendingMediaOptions || {}),
                    callType: nextCallType,
                    videoEnabled: nextEnabled,
                };
                if (nextEnabled) this._callType = 'video';
                return { enabled: nextEnabled, localStream: null };
            },
            onSwitchCamera: () => {},
            onListDevices: async () => ({}),
            onSelectMicrophone: async () => null,
            onSelectCamera: async () => null,
            onEnd: () => this.endCall(),
        });
        setCallStatusText('Звонок...');
    }

    async _onAccepted({ call_id, user_id, request_id }) {
        if (call_id !== this._callId) return;
        if (this._state === STATES.RINGING_IN) {
            this._cleanup();
            return;
        }
        if (this._state === STATES.ACCEPTING) {
            const pendingRequestId = String(this._pendingAcceptRequestId || '');
            const acceptedRequestId = String(request_id || '');
            if (pendingRequestId && acceptedRequestId && acceptedRequestId !== pendingRequestId) {
                this._cleanup();
                return;
            }
            this._pendingAcceptRequestId = '';
            this._state = STATES.ACTIVE;
            this._rememberCallSession('active');
            await this._startMedia(this._pendingMediaOptions);
            return;
        }
        if (this._state !== STATES.RINGING_OUT) return;
        this._state = STATES.ACTIVE;
        stopRingtone();
        clearTimeout(this._ringTimeout);
        this._ringTimeout = null;
        setCallStatusText('Соединение...');
        // Remove placeholder overlay and build real one with media
        removeActiveCallOverlay();
        this._rememberCallSession('active');
        await this._startMedia(this._pendingMediaOptions);
    }

    _onRejected({ call_id }) {
        if (call_id !== this._callId) return;
        if (this._state === STATES.RINGING_OUT) {
            playBusyTone();
            showToast('Звонок отклонён', 'info');
        }
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
            callee_busy:              '\u0421\u043e\u0431\u0435\u0441\u0435\u0434\u043d\u0438\u043a \u0443\u0436\u0435 \u0432 \u0437\u0432\u043e\u043d\u043a\u0435',
            unsupported_call_topology:'\u0417\u0432\u043e\u043d\u043a\u0438 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b \u0442\u043e\u043b\u044c\u043a\u043e \u043e\u0434\u0438\u043d \u043d\u0430 \u043e\u0434\u0438\u043d',
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
            this._rememberCallSession('active');
            await this._startMedia();
            return;
        }
        if (this._state === STATES.ACCEPTING && status === 'active' && callId === this._callId) {
            this._pendingAcceptRequestId = '';
            this._state = STATES.ACTIVE;
            this._rememberCallSession('active');
            await this._startMedia(this._pendingMediaOptions);
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
            return;
        }
        if (this._state === STATES.IDLE && status === 'ringing' && activeCall.role === 'initiator') {
            this._restoreOutgoingRinging(activeCall);
            return;
        }
        if (this._state === STATES.IDLE && status === 'active' && this._shouldRecoverActiveCall(activeCall)) {
            await this._recoverActiveCall(activeCall);
        }
    }

    // ── Signalling: WebRTC P2P ───────────────────────────────────────────────

    async _onOffer({ call_id, sdp, from_user_id }) {
        if (call_id !== this._callId) return;
        if (!this._webrtc) {
            // Queue until _webrtc is ready
            this._queuePendingSignal({ type: 'offer', sdp, from_user_id });
            return;
        }
        try {
            await this._webrtc.handleOffer({ sdp });
        } catch (err) {
            console.warn('[CallManager] offer handling failed', err);
        }
    }

    async _onAnswer({ call_id, sdp, from_user_id }) {
        if (call_id !== this._callId) return;
        if (!this._webrtc) {
            this._queuePendingSignal({ type: 'answer', sdp, from_user_id });
            return;
        }
        try {
            await this._webrtc.handleAnswer({ sdp });
        } catch (err) {
            console.warn('[CallManager] answer handling failed', err);
        }
    }

    async _onIceCandidate({ call_id, candidate, from_user_id }) {
        if (call_id !== this._callId) return;
        if (!this._webrtc) {
            this._queuePendingSignal({ type: 'ice', candidate, from_user_id });
            return;
        }
        try {
            await this._webrtc.handleIceCandidate({ candidate });
        } catch (err) {
            console.warn('[CallManager] ICE candidate handling failed', err);
        }
    }

    _queuePendingSignal(signal) {
        if (this._pendingSignals.length >= MAX_PENDING_SIGNALS) {
            if (signal?.type === 'ice') return;
            this._pendingSignals.shift();
        }
        this._pendingSignals.push(signal);
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

    _normalizeMediaOptions(options = {}, fallbackCallType = this._callType) {
        const normalizedCallType = options.callType === 'video' || fallbackCallType === 'video' ? 'video' : 'audio';
        const hasVideoFlag = Object.prototype.hasOwnProperty.call(options || {}, 'videoEnabled');
        return {
            callType: normalizedCallType,
            audioMuted: Boolean(options.audioMuted),
            videoEnabled: hasVideoFlag ? Boolean(options.videoEnabled) : normalizedCallType === 'video',
            speakerDeviceId: String(options.speakerDeviceId || this._selectedSpeakerDeviceId || ''),
        };
    }

    async _ensureLocalMediaForOptions(options = this._pendingMediaOptions || {}) {
        const normalized = this._normalizeMediaOptions(options, this._callType);
        const wantsVideo = normalized.callType === 'video' && normalized.videoEnabled;

        if (!this._media.getAudioTrack()) {
            if (wantsVideo) {
                await this._media.acquireVideo();
            } else {
                await this._media.acquireAudio();
            }
        } else if (wantsVideo && !this._media.getVideoTrack()) {
            const prepared = await this._media.prepareVideoInput('');
            this._media.commitPreparedVideoTrack(prepared.track, prepared);
        }

        if (!wantsVideo && this._media.getVideoTrack()) {
            this._media.disableVideo();
        }

        this._media.setAudioMuted(normalized.audioMuted);
        normalized.videoEnabled = this._media.isVideoEnabled();
        normalized.audioMuted = this._media.isAudioMuted();
        this._pendingMediaOptions = normalized;
        return normalized;
    }

    async _startMedia(mediaOptions = this._pendingMediaOptions || {}) {
        // 1. Get ICE server config from Flask (includes TURN credentials).
        // Re-fetch if credentials are within 5 minutes of expiry to avoid stale TURN creds on reconnect.
        const needsRefresh = !this._iceServers || Date.now() > this._iceServersExpiresAt - 5 * 60 * 1000;
        if (needsRefresh) {
            try {
                const result = await this._fetchIceServers();
                this._iceServers = result.iceServers;
                this._iceTransportPolicy = result.iceTransportPolicy;
                // Server TTL is TURN_CREDENTIAL_TTL_SECONDS. Use that if returned, else 55 min.
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

        // 2. Acquire or reuse local media
        let normalizedMediaOptions = this._normalizeMediaOptions(mediaOptions, this._callType);
        try {
            normalizedMediaOptions = await this._ensureLocalMediaForOptions(normalizedMediaOptions);
            this._callType = normalizedMediaOptions.callType;
            this._selectedSpeakerDeviceId = normalizedMediaOptions.speakerDeviceId;
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
            initialAudioMuted: normalizedMediaOptions.audioMuted,
            initialVideoEnabled: normalizedMediaOptions.videoEnabled,
            initialSpeakerDeviceId: normalizedMediaOptions.speakerDeviceId,
            onToggleAudio: () => {
                const muted = this._media.toggleAudio();
                this._webrtc?.setAudioEnabled(!muted);
                this._notifyMediaState();
                return muted;
            },
            onToggleVideo: async () => {
                const enabled = await this._toggleVideo();
                this._notifyMediaState();
                return { enabled, localStream: this._media.getLocalStream() };
            },
            onSwitchCamera: async () => {
                let prepared = null;
                const oldTrack = this._media.getVideoTrack();
                this._cameraSwitchInProgress = true;
                try {
                    prepared = await this._media.prepareCameraSwitch();
                    if (prepared?.track) {
                        await this._webrtc?.replaceVideoTrack(prepared.track);
                        this._media.commitPreparedVideoTrack(prepared.track, prepared);
                        this._screenSharing = false;
                        setCallScreenShareActive(false);
                        this._notifyMediaState();
                    }
                } catch (err) {
                    if (oldTrack && oldTrack.readyState !== 'ended') {
                        try { await this._webrtc?.replaceVideoTrack(oldTrack); } catch (_) { /* keep current sender best-effort */ }
                    } else {
                        try { await this._webrtc?.replaceVideoTrack(null); } catch (_) { /* keep current sender best-effort */ }
                    }
                    this._media.discardTrack(prepared?.track);
                    prepared = null;
                    console.warn('[CallManager] camera switch failed', err);
                    setCallStatusText('Камера недоступна');
                    this._notifyMediaState();
                } finally {
                    this._cameraSwitchInProgress = false;
                }
                return {
                    switched: Boolean(prepared?.track),
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
                let prepared = null;
                const oldTrack = this._media.getAudioTrack();
                try {
                    prepared = await this._media.prepareAudioInput(deviceId);
                    await this._webrtc?.replaceAudioTrack(prepared.track);
                    this._media.commitPreparedAudioTrack(prepared.track, prepared);
                    this._webrtc?.setAudioEnabled(!this._media.isAudioMuted());
                } catch (err) {
                    if (oldTrack) {
                        try { await this._webrtc?.replaceAudioTrack(oldTrack); } catch (_) { /* keep current sender best-effort */ }
                    } else {
                        try { await this._webrtc?.replaceAudioTrack(null); } catch (_) { /* keep current sender best-effort */ }
                    }
                    this._media.discardTrack(prepared?.track);
                    const message = _mediaAccessMessage(err, 'audio');
                    setCallStatusText(message);
                    showToast(message, 'error');
                }
                return { localStream: this._media.getLocalStream() };
            },
            onSelectCamera: async (deviceId) => {
                let prepared = null;
                const oldTrack = this._media.getVideoTrack();
                try {
                    prepared = await this._media.prepareVideoInput(deviceId);
                    this._callType = 'video';
                    await this._webrtc?.addVideoTrack(prepared.track, this._media.getLocalStream());
                    this._media.commitPreparedVideoTrack(prepared.track, prepared);
                    this._screenSharing = false;
                    setCallScreenShareActive(false);
                    this._notifyMediaState();
                } catch (err) {
                    if (oldTrack) {
                        try { await this._webrtc?.replaceVideoTrack(oldTrack); } catch (_) { /* keep current sender best-effort */ }
                    } else {
                        try { await this._webrtc?.replaceVideoTrack(null); } catch (_) { /* keep current sender best-effort */ }
                    }
                    this._media.discardTrack(prepared?.track);
                    const message = _mediaAccessMessage(err, 'video');
                    setCallStatusText(message);
                    showToast(message, 'error');
                }
                return { localStream: this._media.getLocalStream() };
            },
            onToggleScreenShare: async () => {
                const result = await this._toggleScreenShare();
                this._notifyMediaState();
                return result;
            },
            onEnd: () => this.endCall(),
        });

        try {
            // 4. Create RTCPeerConnection and wire callbacks
            this._webrtc = new CallWebRTC({
                callId:  this._callId,
                iceServers: this._iceServers,
                iceTransportPolicy: this._iceTransportPolicy,
                onSignal: (event, payload) => this._emit(event, payload),
                onRemoteTrack: (track, stream) => {
                    attachRemoteTrack(track, stream);
                    setCallStatusText('Соединено');
                    startCallDurationTimer();
                },
                onVerificationCode: (code) => setCallVerificationCode(code),
                onQualityStats: (stats) => setCallQualityIndicator(stats),
                onConnectionState: (state) => this._onConnectionState(state),
            });

            // polite = callee (acceptCall sets _isPolite=true), impolite = caller
            this._webrtc.init(this._media.getLocalStream(), { polite: this._isPolite });
            this._notifyMediaState();

            // 5. Drain signals queued before _webrtc was ready
            await this._drainPendingSignals();
        } catch (err) {
            console.error('[CallManager] WebRTC setup failed', err);
            showToast('Не удалось установить звонок', 'error');
            this.endCall();
        }
    }

    async _toggleVideo() {
        if (this._media.getVideoTrack()) {
            if (this._media.isVideoEnabled()) {
                try {
                    await this._webrtc?.replaceVideoTrack(null);
                    this._media.disableVideo();
                    this._screenSharing = false;
                    setCallScreenShareActive(false);
                    return false;
                } catch (err) {
                    console.warn('[CallManager] video disable failed', err);
                    return true;
                }
            }
            this._media.toggleVideo();
            this._webrtc?.setVideoEnabled(true);
            this._screenSharing = false;
            setCallScreenShareActive(false);
            return true;
        }

        let prepared = null;
        try {
            prepared = await this._media.prepareVideoInput('');
            if (!prepared?.track) return false;
            this._callType = 'video';
            await this._webrtc?.addVideoTrack(prepared.track, this._media.getLocalStream());
            this._media.commitPreparedVideoTrack(prepared.track, prepared);
            this._screenSharing = false;
            setCallScreenShareActive(false);
            return true;
        } catch (err) {
            try { await this._webrtc?.replaceVideoTrack(null); } catch (_) { /* keep current sender best-effort */ }
            this._media.discardTrack(prepared?.track);
            console.warn('[CallManager] video enable failed', err);
            setCallStatusText('Камера недоступна');
            return false;
        }
    }

    // ── ICE server config ────────────────────────────────────────────────────

    async _toggleScreenShare() {
        if (this._media.isScreenSharing()) {
            try {
                await this._webrtc?.replaceVideoTrack(null);
                this._media.disableVideo();
            } finally {
                this._screenSharing = false;
                setCallScreenShareActive(false);
            }
            return { enabled: false, localStream: this._media.getLocalStream() };
        }

        let prepared = null;
        const oldTrack = this._media.getVideoTrack();
        try {
            prepared = await this._media.prepareDisplayMedia();
            this._callType = 'video';
            await this._webrtc?.addVideoTrack(prepared.track, this._media.getLocalStream());
            this._media.commitPreparedVideoTrack(prepared.track, prepared);
            this._screenSharing = true;
            setCallScreenShareActive(true);
            return { enabled: true, localStream: this._media.getLocalStream() };
        } catch (err) {
            if (oldTrack) {
                try { await this._webrtc?.replaceVideoTrack(oldTrack); } catch (_) { /* keep current sender best-effort */ }
            } else {
                try { await this._webrtc?.replaceVideoTrack(null); } catch (_) { /* keep current sender best-effort */ }
            }
            this._media.discardTrack(prepared?.track);
            this._screenSharing = false;
            setCallScreenShareActive(false);
            console.warn('[CallManager] screen share failed', err);
            setCallStatusText('Демонстрация экрана недоступна');
            return { enabled: false, localStream: this._media.getLocalStream() };
        }
    }

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

    _restoreOutgoingRinging(activeCall) {
        const callId = String(activeCall?.call_id || '');
        if (!callId) return;
        this._callId = callId;
        this._chatId = activeCall.chat_id;
        this._callType = activeCall.call_type === 'video' ? 'video' : 'audio';
        this._partner = this._resolvePartner(activeCall.partner);
        this._state = STATES.RINGING_OUT;
        this._isPolite = false;
        this._pendingAcceptRequestId = '';
        this._pendingMediaOptions = {
            audioMuted: false,
            videoEnabled: this._callType === 'video',
            speakerDeviceId: this._selectedSpeakerDeviceId,
        };
        startRingtone('outgoing');
        this._ringTimeout = setTimeout(() => {
            if (this._state !== STATES.RINGING_OUT) return;
            this._emit('call_cancel', { call_id: this._callId });
            showToast('Звонок не принят', 'info');
            this._cleanup();
        }, RING_TIMEOUT_MS);
        this._rememberCallSession('ringing_out');
        this._onInitiated({ call_id: callId });
    }

    async _recoverActiveCall(activeCall) {
        const callId = String(activeCall?.call_id || '');
        if (!callId) return;
        this._callId = callId;
        this._chatId = activeCall.chat_id;
        this._callType = activeCall.call_type === 'video' ? 'video' : 'audio';
        this._partner = this._resolvePartner(activeCall.partner);
        this._state = STATES.ACTIVE;
        this._isPolite = activeCall.role === 'callee';
        this._pendingAcceptRequestId = '';
        this._pendingMediaOptions = this._normalizeMediaOptions({
            callType: this._callType,
            videoEnabled: this._callType === 'video',
            speakerDeviceId: this._selectedSpeakerDeviceId,
        }, this._callType);
        stopRingtone();
        removeIncomingCallBanner();
        this._rememberCallSession('active');
        await this._startMedia(this._pendingMediaOptions);
    }

    _shouldRecoverActiveCall(activeCall) {
        const remembered = this._readRememberedCallSession();
        if (!remembered) return false;
        if (String(remembered.call_id || '') !== String(activeCall?.call_id || '')) return false;
        return ['active', 'accepting', 'ringing_out'].includes(String(remembered.phase || ''));
    }

    _rememberCallSession(phase = this._state) {
        if (!this._callId) return;
        try {
            globalThis.sessionStorage?.setItem(CALL_SESSION_STORAGE_KEY, JSON.stringify({
                call_id: this._callId,
                chat_id: this._chatId,
                call_type: this._callType,
                role: this._isPolite ? 'callee' : 'initiator',
                phase,
            }));
        } catch (_) { /* sessionStorage can be unavailable in private contexts */ }
    }

    _readRememberedCallSession() {
        try {
            const raw = globalThis.sessionStorage?.getItem(CALL_SESSION_STORAGE_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    _clearRememberedCallSession(callId = this._callId) {
        try {
            if (!callId) {
                globalThis.sessionStorage?.removeItem(CALL_SESSION_STORAGE_KEY);
                return;
            }
            const remembered = this._readRememberedCallSession();
            if (!remembered || String(remembered.call_id || '') === String(callId || '')) {
                globalThis.sessionStorage?.removeItem(CALL_SESSION_STORAGE_KEY);
            }
        } catch (_) { /* ignore storage cleanup failures */ }
    }

    _onConnectionState(state) {
        if (state === 'connected') {
            clearTimeout(this._disconnectTimeout);
            this._disconnectTimeout = null;
            setCallStatusText('Соединено');
            startCallDurationTimer();
            playConnectedSound();
            return;
        }
        if (state === 'disconnected' || state === 'failed') {
            this._handleRecoverableDisconnect();
        }
    }

    _handleRecoverableDisconnect() {
        if (this._state !== STATES.ACTIVE) return;
        setCallStatusText('Переподключение...');
        void this._restartIceWithFreshConfig();
        clearTimeout(this._disconnectTimeout);
        this._disconnectTimeout = setTimeout(() => {
            if (this._state === STATES.ACTIVE) {
                showToast('Соединение потеряно', 'error');
                this.endCall();
            }
        }, DISCONNECT_TIMEOUT_MS);
    }

    _notifyMediaState() {
        if (!this._callId) return;
        this._emit('call_media_state', {
            call_id:       this._callId,
            audio_muted:   this._media.isAudioMuted(),
            video_enabled: this._media.isVideoEnabled(),
        });
    }

    _onLocalTrackEnded(kind, track = null) {
        if (this._state !== STATES.ACTIVE) return;
        if (kind === 'audio') {
            this._webrtc?.replaceAudioTrack(null)?.catch?.((err) => {
                console.warn('[CallManager] audio sender detach failed after track ended', err);
            });
            setCallStatusText('Микрофон отключён');
        } else if (kind === 'video') {
            if (this._cameraSwitchInProgress) {
                return;
            }
            this._webrtc?.replaceVideoTrack(null)?.catch?.((err) => {
                console.warn('[CallManager] video sender detach failed after track ended', err);
            });
            const wasScreenSharing = this._screenSharing;
            this._screenSharing = false;
            setCallScreenShareActive(false);
            setLocalVideoEnabled(this._media.getLocalStream(), false);
            setCallStatusText(wasScreenSharing ? 'Демонстрация экрана остановлена' : 'Камера отключена');
        }
        this._notifyMediaState();
    }

    _onLocalTrackMuted(kind, track = null) {
        if (kind === 'video' && !this._cameraSwitchInProgress && (!track || track === this._media.getVideoTrack())) {
            setLocalVideoEnabled(this._media.getLocalStream(), false);
        }
    }

    _onLocalTrackUnmuted(kind, track = null) {
        if (kind === 'video' && (!track || track === this._media.getVideoTrack())) {
            setLocalVideoEnabled(this._media.getLocalStream(), this._media.isVideoEnabled());
        }
    }

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
        const callId = this._callId;
        if (this._ringTimeout)       { clearTimeout(this._ringTimeout);       this._ringTimeout = null; }
        if (this._disconnectTimeout) { clearTimeout(this._disconnectTimeout); this._disconnectTimeout = null; }
        this._clearRememberedCallSession(callId);
        stopRingtone();
        removePreCallScreen();
        removeIncomingCallBanner();
        removeActiveCallOverlay();
        // Release remote tracks before closing peer connection
        removeRemoteTrack('audio');
        removeRemoteTrack('video');
        this._webrtc?.close();
        this._webrtc = null;
        this._media.release();
        this._pendingSignals = [];
        this._pendingAcceptRequestId = '';
        this._pendingMediaOptions = null;
        this._selectedSpeakerDeviceId = '';
        this._screenSharing = false;
        this._cameraSwitchInProgress = false;
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

function _makeRequestId(prefix = 'call') {
    const random = Math.random().toString(36).slice(2, 10);
    return `${prefix}-${Date.now().toString(36)}-${random}`;
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
