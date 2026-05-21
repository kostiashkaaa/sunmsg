/**
 * call-webrtc.js
 * Pure P2P WebRTC using native RTCPeerConnection + DTLS-SRTP.
 *
 * Security model:
 *   - DTLS fingerprints are negotiated directly between peers via SDP.
 *   - The Flask/SocketIO server relays SDP offer/answer and ICE candidates
 *     but NEVER holds media keys — it physically cannot decrypt the stream.
 *   - TURN server (coturn) relays encrypted RTP packets when P2P is blocked
 *     by NAT; coturn also cannot decrypt (keys stay in DTLS handshake).
 *   - A short verification code is derived from both DTLS fingerprints after
 *     SDP exchange. Matching codes detect signalling-server MITM when compared.
 *
 * Flow (caller):
 *   createOffer() → local SDP → send via call_offer →
 *   receive call_answer → setRemoteAnswer() →
 *   ICE trickle on both sides → connected
 *
 * Flow (callee):
 *   receive call_offer → setRemoteOffer() → createAnswer() →
 *   local SDP → send via call_answer → ICE trickle → connected
 */

// Cap on buffered remote ICE candidates awaiting a remoteDescription. A
// well-behaved peer trickles a few dozen; an unbounded queue lets a malicious
// participant exhaust memory by flooding call_ice_candidate.
const MAX_PENDING_ICE_CANDIDATES = 100;
const SEND_QUALITY_ORDER = { poor: 0, fair: 1, good: 2 };
const SEND_QUALITY_DOWNGRADE_SAMPLES = 2;
const SEND_QUALITY_UPGRADE_SAMPLES = 4;
const SEND_QUALITY_PROFILES = Object.freeze({
    good: { maxBitrate: 900_000, scaleResolutionDownBy: 1, maxFramerate: 24 },
    fair: { maxBitrate: 450_000, scaleResolutionDownBy: 2, maxFramerate: 15 },
    poor: { maxBitrate: 180_000, scaleResolutionDownBy: 4, maxFramerate: 10 },
});

export class CallWebRTC {
    /**
     * @param {object} opts
     * @param {function(string, object): void} opts.onSignal  - emit signalling event via socket
     * @param {string}   opts.callId
     * @param {string[]} opts.iceServers  - [{urls, username?, credential?}]
     * @param {string} opts.iceTransportPolicy - 'all'|'relay'
     * @param {function(MediaStreamTrack, MediaStream|null): void} opts.onRemoteTrack
     * @param {function(string): void}           opts.onVerificationCode
     * @param {function(string): void}           opts.onConnectionState  - 'connected'|'disconnected'|'failed'
     * @param {function(object): void}           opts.onQualityStats
     */
    constructor({ onSignal, callId, iceServers, iceTransportPolicy = 'all', onRemoteTrack, onVerificationCode, onConnectionState, onQualityStats }) {
        this._onSignal = onSignal;
        this._callId = callId;
        this._iceServers = iceServers || [];
        this._iceTransportPolicy = _normalizeIceTransportPolicy(iceTransportPolicy);
        this._onRemoteTrack = onRemoteTrack || (() => {});
        this._onVerificationCode = onVerificationCode || (() => {});
        this._onConnectionState = onConnectionState || (() => {});
        this._onQualityStats = onQualityStats || (() => {});

        this._pc = null;
        this._localStream = null;
        this._audioSender = null;
        this._videoSender = null;
        this._videoTransformCleanup = null;
        this._makingOffer = false;
        this._ignoreOffer = false;
        this._polite = false;   // set by caller: caller=impolite(false), callee=polite(true)
        this._verificationCode = '';
        this._pendingIceCandidates = [];
        this._statsTimer = null;
        this._lastInboundStats = new Map();
        this._sendQualityLevel = '';
        this._pendingSendQualityLevel = '';
        this._pendingSendQualitySamples = 0;
        this._sendProfileUpdate = Promise.resolve();
    }

    // ── Setup ────────────────────────────────────────────────────────────────

    /**
     * Attach local media stream and create RTCPeerConnection.
     * Must be called before createOffer() or setRemoteOffer().
     */
    init(localStream, { polite, mirrorVideo = false } = {}) {
        this._localStream = localStream;
        this._polite = polite;

        this._pc = new RTCPeerConnection({
            iceServers: this._iceServers,
            iceTransportPolicy: this._iceTransportPolicy,
            // Force DTLS-SRTP (default in all modern browsers, explicit here)
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require',
        });

        // Remote tracks → caller's callback
        this._pc.ontrack = ({ track, streams }) => {
            this._onRemoteTrack(track, streams?.[0] || null);
        };

        // ICE trickle
        this._pc.onicecandidate = ({ candidate }) => {
            this._onSignal('call_ice_candidate', {
                call_id: this._callId,
                candidate: candidate ? candidate.toJSON() : null,
            });
        };

        this._pc.onicecandidateerror = (event) => {
            console.warn('[CallWebRTC] ICE candidate error', {
                url: event.url,
                errorCode: event.errorCode,
                errorText: event.errorText,
            });
        };

        // Connection state
        this._pc.onconnectionstatechange = () => {
            this._onConnectionState(this._pc.connectionState);
        };

        // Perfect negotiation: re-offer on negotiation needed
        this._pc.onnegotiationneeded = async () => {
            try {
                this._makingOffer = true;
                await this._pc.setLocalDescription();
                await this._updateVerificationCode();
                this._onSignal('call_offer', {
                    call_id: this._callId,
                    sdp: this._pc.localDescription,
                });
            } catch (err) {
                console.error('[CallWebRTC] negotiationneeded error', err);
            } finally {
                this._makingOffer = false;
            }
        };

        // Add tracks after handlers are attached, so negotiation cannot race
        // peer connection setup.
        for (const track of localStream?.getTracks?.() || []) {
            if (track.kind === 'video') {
                const outgoing = this._prepareOutgoingVideoTrack(track, { mirror: mirrorVideo });
                this._videoSender = this._pc.addTrack(outgoing.track, outgoing.stream || localStream);
                this._videoTransformCleanup = outgoing.cleanup || null;
                continue;
            }
            const sender = this._pc.addTrack(track, localStream);
            if (track.kind === 'audio') this._audioSender = sender;
        }

        this._startStatsMonitor();
    }

    // ── Signalling handlers (called by CallManager) ──────────────────────────

    async handleOffer({ sdp }) {
        if (!this._pc) throw new Error('CallWebRTC not initialised');

        const offerCollision =
            sdp.type === 'offer' &&
            (this._makingOffer || this._pc.signalingState !== 'stable');

        this._ignoreOffer = !this._polite && offerCollision;
        if (this._ignoreOffer) return;

        await this._pc.setRemoteDescription(new RTCSessionDescription(sdp));
        await this._updateVerificationCode();
        await this._drainPendingIceCandidates();

        if (sdp.type === 'offer') {
            await this._pc.setLocalDescription();
            await this._updateVerificationCode();
            this._onSignal('call_answer', {
                call_id: this._callId,
                sdp: this._pc.localDescription,
            });
        }
    }

    async handleAnswer({ sdp }) {
        if (!this._pc) throw new Error('CallWebRTC not initialised');
        if (this._pc.signalingState === 'stable') return;  // already applied
        await this._pc.setRemoteDescription(new RTCSessionDescription(sdp));
        await this._updateVerificationCode();
        await this._drainPendingIceCandidates();
    }

    async handleIceCandidate({ candidate }) {
        if (!this._pc) return;
        if (!this._pc.remoteDescription) {
            if (this._pendingIceCandidates.length >= MAX_PENDING_ICE_CANDIDATES) {
                console.warn('[CallWebRTC] pending ICE queue full, dropping candidate');
                return;
            }
            this._pendingIceCandidates.push(candidate || null);
            return;
        }
        await this._addIceCandidate(candidate || null);
    }

    updateIceServers(iceServers, iceTransportPolicy = this._iceTransportPolicy) {
        const nextIceServers = Array.isArray(iceServers) ? iceServers.filter(Boolean) : [];
        if (nextIceServers.length === 0) return;
        this._iceServers = nextIceServers;
        this._iceTransportPolicy = _normalizeIceTransportPolicy(iceTransportPolicy);
        if (!this._pc || typeof this._pc.setConfiguration !== 'function') return;

        const currentConfig = typeof this._pc.getConfiguration === 'function'
            ? this._pc.getConfiguration()
            : {};
        try {
            this._pc.setConfiguration({
                ...currentConfig,
                iceServers: nextIceServers,
                iceTransportPolicy: this._iceTransportPolicy,
            });
        } catch (err) {
            console.warn('[CallWebRTC] ICE server update failed', err);
        }
    }

    // ICE restart uses normal perfect-negotiation signalling. If both sides
    // restart at once, the polite/impolite collision handling above resolves it.
    restartIce() {
        if (!this._pc) return;
        if (this._pc.signalingState !== 'stable') return;
        try {
            this._pc.restartIce();
        } catch (err) {
            console.warn('[CallWebRTC] restartIce failed', err);
        }
    }

    async _drainPendingIceCandidates() {
        const queue = this._pendingIceCandidates.splice(0);
        for (const candidate of queue) {
            await this._addIceCandidate(candidate);
        }
    }

    async _addIceCandidate(candidate) {
        try {
            await this._pc.addIceCandidate(
                candidate ? new RTCIceCandidate(candidate) : null,
            );
        } catch (err) {
            if (!this._ignoreOffer) console.warn('[CallWebRTC] addIceCandidate error', err);
        }
    }

    // ── Track control ────────────────────────────────────────────────────────

    setAudioEnabled(enabled) {
        this._localStream?.getAudioTracks().forEach(t => { t.enabled = enabled; });
    }

    setVideoEnabled(enabled) {
        this._localStream?.getVideoTracks().forEach(t => { t.enabled = enabled; });
        const senderTrack = this._videoSender?.track;
        if (senderTrack) senderTrack.enabled = enabled;
    }

    async replaceVideoTrack(newTrack, { mirror = false } = {}) {
        const sender = this._videoSender || this._pc?.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
            const previousCleanup = this._videoTransformCleanup;
            const outgoing = newTrack
                ? this._prepareOutgoingVideoTrack(newTrack, { mirror })
                : { track: null, stream: null };
            try {
                await sender.replaceTrack(outgoing.track || null);
            } catch (err) {
                outgoing.cleanup?.();
                throw err;
            }
            previousCleanup?.();
            this._videoTransformCleanup = outgoing.cleanup || null;
            this._videoSender = sender;
            if (outgoing.track) this._queueAdaptiveSendProfile(this._sendQualityLevel || 'good');
        }
    }

    async replaceAudioTrack(newTrack) {
        const sender = this._audioSender || this._pc?.getSenders().find(s => s.track?.kind === 'audio');
        if (sender) {
            await sender.replaceTrack(newTrack || null);
            this._audioSender = sender;
        }
    }

    async addVideoTrack(newTrack, stream = this._localStream, { mirror = false } = {}) {
        if (!this._pc || !newTrack) return;
        const sender = this._videoSender || this._pc.getSenders().find(s => s.track?.kind === 'video');
        const previousCleanup = this._videoTransformCleanup;
        const outgoing = this._prepareOutgoingVideoTrack(newTrack, { mirror });
        if (sender) {
            try {
                await sender.replaceTrack(outgoing.track);
            } catch (err) {
                outgoing.cleanup?.();
                throw err;
            }
            previousCleanup?.();
            this._videoTransformCleanup = outgoing.cleanup || null;
            this._videoSender = sender;
            this._queueAdaptiveSendProfile(this._sendQualityLevel || 'good');
            return;
        }
        const targetStream = outgoing.stream || stream || this._localStream || new MediaStream([outgoing.track]);
        this._videoSender = this._pc.addTrack(outgoing.track, targetStream);
        this._videoTransformCleanup = outgoing.cleanup || null;
        this._queueAdaptiveSendProfile(this._sendQualityLevel || 'good');
    }

    _prepareOutgoingVideoTrack(sourceTrack, { mirror = false } = {}) {
        if (!sourceTrack || !mirror) {
            return { track: sourceTrack || null, stream: null };
        }
        const transformed = _createMirroredVideoTrack(sourceTrack);
        if (!transformed?.track) {
            return { track: sourceTrack, stream: null };
        }
        return transformed;
    }

    _cleanupVideoTransform() {
        if (!this._videoTransformCleanup) return;
        try {
            this._videoTransformCleanup();
        } catch (err) {
            console.warn('[CallWebRTC] video transform cleanup failed', err);
        }
        this._videoTransformCleanup = null;
    }

    async _updateVerificationCode() {
        const localFingerprint = _extractDtlsFingerprint(this._pc?.localDescription?.sdp);
        const remoteFingerprint = _extractDtlsFingerprint(this._pc?.remoteDescription?.sdp);
        if (!localFingerprint || !remoteFingerprint) return;

        const code = await deriveCallVerificationCode(localFingerprint, remoteFingerprint);
        if (!code || code === this._verificationCode) return;
        this._verificationCode = code;
        this._onVerificationCode(code);
    }

    _startStatsMonitor() {
        if (this._statsTimer || !this._pc?.getStats) return;
        this._statsTimer = setInterval(async () => {
            const pc = this._pc;
            if (!pc || pc.connectionState === 'closed') return;
            if (!['connected', 'connecting'].includes(pc.connectionState)) return;
            try {
                this._readQualityStats(await pc.getStats());
            } catch (err) {
                console.warn('[CallWebRTC] getStats failed', err);
            }
        }, 3000);
    }

    _readQualityStats(stats) {
        let deltaLost = 0;
        let deltaReceived = 0;
        let jitterMs = 0;
        let rttMs = 0;
        let hasInbound = false;
        let remoteLossPercent = 0;

        stats.forEach((report) => {
            if (report.type === 'inbound-rtp' && !report.isRemote) {
                hasInbound = true;
                const key = String(report.id || report.ssrc || '');
                const lost = Number(report.packetsLost || 0);
                const received = Number(report.packetsReceived || 0);
                const previous = this._lastInboundStats.get(key);
                if (previous) {
                    deltaLost += Math.max(0, lost - previous.lost);
                    deltaReceived += Math.max(0, received - previous.received);
                } else {
                    deltaLost += Math.max(0, lost);
                    deltaReceived += Math.max(0, received);
                }
                this._lastInboundStats.set(key, { lost, received });
                jitterMs = Math.max(jitterMs, Number(report.jitter || 0) * 1000);
            } else if (report.type === 'remote-inbound-rtp') {
                if (report.roundTripTime != null) {
                    rttMs = Math.max(rttMs, Number(report.roundTripTime || 0) * 1000);
                }
                remoteLossPercent = Math.max(remoteLossPercent, _remoteLossPercent(report));
            } else if (
                report.type === 'candidate-pair'
                && (report.nominated || report.selected)
                && report.currentRoundTripTime != null
            ) {
                rttMs = Math.max(rttMs, Number(report.currentRoundTripTime || 0) * 1000);
            }
        });

        const totalPackets = deltaLost + deltaReceived;
        if (!hasInbound && !rttMs && !jitterMs) return;
        const packetLossPercent = totalPackets > 0 ? (deltaLost / totalPackets) * 100 : 0;
        const level = packetLossPercent >= 5 || rttMs >= 400 || jitterMs >= 80
            ? 'poor'
            : packetLossPercent >= 2 || rttMs >= 250 || jitterMs >= 40
                ? 'fair'
                : 'good';
        const sendLevel = _worseQualityLevel(level, _qualityLevel(remoteLossPercent, rttMs, 0));
        this._queueAdaptiveSendProfile(sendLevel);
        this._onQualityStats({ level, sendLevel, packetLossPercent, remoteLossPercent, rttMs, jitterMs });
    }

    _queueAdaptiveSendProfile(level) {
        if (!(level in SEND_QUALITY_PROFILES)) return;
        if (level === this._sendQualityLevel) {
            this._pendingSendQualityLevel = '';
            this._pendingSendQualitySamples = 0;
            return;
        }

        const hasCurrentLevel = Boolean(this._sendQualityLevel);
        const currentOrder = SEND_QUALITY_ORDER[this._sendQualityLevel] ?? SEND_QUALITY_ORDER.good;
        const nextOrder = SEND_QUALITY_ORDER[level];
        const isDowngrade = hasCurrentLevel && nextOrder < currentOrder;
        if (hasCurrentLevel) {
            if (this._pendingSendQualityLevel !== level) {
                this._pendingSendQualityLevel = level;
                this._pendingSendQualitySamples = 1;
                return;
            }
            this._pendingSendQualitySamples += 1;
            const requiredSamples = isDowngrade
                ? SEND_QUALITY_DOWNGRADE_SAMPLES
                : SEND_QUALITY_UPGRADE_SAMPLES;
            if (this._pendingSendQualitySamples < requiredSamples) return;
        }

        this._pendingSendQualityLevel = '';
        this._pendingSendQualitySamples = 0;
        this._sendProfileUpdate = this._sendProfileUpdate
            .catch(() => {})
            .then(() => this._applyAdaptiveSendProfile(level));
    }

    async _applyAdaptiveSendProfile(level) {
        const profile = SEND_QUALITY_PROFILES[level];
        const sender = this._pc?.getSenders().find(s => s.track?.kind === 'video');
        if (!profile || !sender?.track || typeof sender.setParameters !== 'function') {
            this._sendQualityLevel = level;
            return;
        }

        const params = sender.getParameters?.() || {};
        const encodings = Array.isArray(params.encodings) && params.encodings.length > 0
            ? params.encodings
            : [{}];
        const firstEncoding = encodings[0] || {};
        if (
            firstEncoding.maxBitrate === profile.maxBitrate
            && firstEncoding.scaleResolutionDownBy === profile.scaleResolutionDownBy
            && firstEncoding.maxFramerate === profile.maxFramerate
        ) {
            this._sendQualityLevel = level;
            return;
        }

        params.encodings = [
            {
                ...firstEncoding,
                maxBitrate: profile.maxBitrate,
                scaleResolutionDownBy: profile.scaleResolutionDownBy,
                maxFramerate: profile.maxFramerate,
            },
            ...encodings.slice(1),
        ];

        try {
            await sender.setParameters(params);
            this._sendQualityLevel = level;
        } catch (err) {
            console.warn('[CallWebRTC] adaptive send profile failed', err);
        }
    }

    // ── Cleanup ──────────────────────────────────────────────────────────────

    close() {
        if (this._statsTimer) {
            clearInterval(this._statsTimer);
            this._statsTimer = null;
        }
        this._pc?.close();
        this._cleanupVideoTransform();
        this._pc = null;
        this._localStream = null;
        this._audioSender = null;
        this._videoSender = null;
        this._videoTransformCleanup = null;
        this._pendingIceCandidates = [];
        this._lastInboundStats.clear();
        this._sendQualityLevel = '';
        this._pendingSendQualityLevel = '';
        this._pendingSendQualitySamples = 0;
        this._sendProfileUpdate = Promise.resolve();
    }
}

function _remoteLossPercent(report) {
    if (report.fractionLost != null) {
        const fractionLost = Number(report.fractionLost);
        if (Number.isFinite(fractionLost)) {
            return Math.max(0, fractionLost <= 1 ? fractionLost * 100 : fractionLost);
        }
    }

    const lost = Number(report.packetsLost || 0);
    const received = Number(report.packetsReceived || 0);
    const total = lost + received;
    return total > 0 ? Math.max(0, lost / total * 100) : 0;
}

function _qualityLevel(packetLossPercent, rttMs, jitterMs) {
    if (packetLossPercent >= 5 || rttMs >= 400 || jitterMs >= 80) return 'poor';
    if (packetLossPercent >= 2 || rttMs >= 250 || jitterMs >= 40) return 'fair';
    return 'good';
}

function _worseQualityLevel(left, right) {
    return SEND_QUALITY_ORDER[left] <= SEND_QUALITY_ORDER[right] ? left : right;
}

function _normalizeIceTransportPolicy(value) {
    return String(value || '').trim().toLowerCase() === 'relay' ? 'relay' : 'all';
}

function _createMirroredVideoTrack(sourceTrack) {
    if (
        !sourceTrack
        || typeof document === 'undefined'
        || typeof MediaStream === 'undefined'
        || typeof requestAnimationFrame !== 'function'
    ) {
        return null;
    }

    const canvas = document.createElement('canvas');
    if (typeof canvas.captureStream !== 'function') return null;

    const video = document.createElement('video');
    const inputStream = new MediaStream([sourceTrack]);
    const settings = sourceTrack.getSettings?.() || {};
    const fps = Math.max(1, Math.min(24, Math.round(Number(settings.frameRate || 24)) || 24));
    const initialWidth = Math.max(1, Math.round(Number(settings.width || 640)) || 640);
    const initialHeight = Math.max(1, Math.round(Number(settings.height || 360)) || 360);
    canvas.width = initialWidth;
    canvas.height = initialHeight;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return null;

    video.muted = true;
    video.playsInline = true;
    video.srcObject = inputStream;

    let stopped = false;
    let rafId = 0;
    let outputTrack = null;

    const syncCanvasSize = () => {
        const width = Math.max(1, Math.round(Number(video.videoWidth || settings.width || canvas.width)));
        const height = Math.max(1, Math.round(Number(video.videoHeight || settings.height || canvas.height)));
        if (canvas.width !== width) canvas.width = width;
        if (canvas.height !== height) canvas.height = height;
    };

    const draw = () => {
        if (stopped || sourceTrack.readyState === 'ended') return;
        syncCanvasSize();
        ctx.save();
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        try {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        } catch (_) {
            // Video metadata may not be ready on the first frames.
        }
        ctx.restore();
        rafId = requestAnimationFrame(draw);
    };

    const outputStream = canvas.captureStream(fps);
    outputTrack = outputStream.getVideoTracks()[0] || null;
    if (!outputTrack) return null;
    try { outputTrack.contentHint = sourceTrack.contentHint || 'motion'; } catch (_) { /* optional browser hint */ }

    const cleanup = () => {
        if (stopped) return;
        stopped = true;
        if (rafId) cancelAnimationFrame(rafId);
        sourceTrack.removeEventListener('ended', cleanup);
        outputTrack.removeEventListener('ended', cleanup);
        video.pause?.();
        video.srcObject = null;
        if (outputTrack?.readyState !== 'ended') outputTrack.stop();
    };

    sourceTrack.addEventListener('ended', cleanup, { once: true });
    outputTrack.addEventListener('ended', cleanup, { once: true });
    const playPromise = video.play?.();
    if (playPromise?.catch) {
        playPromise.catch((err) => console.warn('[CallWebRTC] mirrored video source playback failed', err));
    }
    rafId = requestAnimationFrame(draw);

    return {
        track: outputTrack,
        stream: outputStream,
        cleanup,
    };
}

function _extractDtlsFingerprint(sdp) {
    const text = String(sdp || '');
    const match = text.match(/^a=fingerprint:[^\s]+\s+([0-9A-Fa-f:]+)$/m);
    return match ? match[1].replace(/:/g, '').toUpperCase() : '';
}

export async function deriveCallVerificationCode(localFingerprint, remoteFingerprint) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return '';

    const normalized = [localFingerprint, remoteFingerprint]
        .map(value => String(value || '').replace(/[^0-9A-Fa-f]/g, '').toUpperCase())
        .filter(Boolean)
        .sort()
        .join('|');
    if (!normalized) return '';

    const encoded = new TextEncoder().encode(`sun-call-v1|${normalized}`);
    const digest = new Uint8Array(await subtle.digest('SHA-256', encoded));
    const numeric = (
        ((digest[0] << 16) | (digest[1] << 8) | digest[2]) % 1_000_000
    ).toString().padStart(6, '0');
    return `${numeric.slice(0, 3)} ${numeric.slice(3)}`;
}
