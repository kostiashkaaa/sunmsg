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

export class CallWebRTC {
    /**
     * @param {object} opts
     * @param {function(string, object): void} opts.onSignal  - emit signalling event via socket
     * @param {string}   opts.callId
     * @param {string[]} opts.iceServers  - [{urls, username?, credential?}]
     * @param {function(MediaStreamTrack): void} opts.onRemoteTrack
     * @param {function(string): void}           opts.onVerificationCode
     * @param {function(string): void}           opts.onConnectionState  - 'connected'|'disconnected'|'failed'
     */
    constructor({ onSignal, callId, iceServers, onRemoteTrack, onVerificationCode, onConnectionState }) {
        this._onSignal = onSignal;
        this._callId = callId;
        this._iceServers = iceServers || [];
        this._onRemoteTrack = onRemoteTrack || (() => {});
        this._onVerificationCode = onVerificationCode || (() => {});
        this._onConnectionState = onConnectionState || (() => {});

        this._pc = null;
        this._localStream = null;
        this._makingOffer = false;
        this._ignoreOffer = false;
        this._polite = false;   // set by caller: caller=impolite(false), callee=polite(true)
        this._verificationCode = '';
        this._pendingIceCandidates = [];
    }

    // ── Setup ────────────────────────────────────────────────────────────────

    /**
     * Attach local media stream and create RTCPeerConnection.
     * Must be called before createOffer() or setRemoteOffer().
     */
    init(localStream, { polite }) {
        this._localStream = localStream;
        this._polite = polite;

        this._pc = new RTCPeerConnection({
            iceServers: this._iceServers,
            // Force DTLS-SRTP (default in all modern browsers, explicit here)
            bundlePolicy: 'max-bundle',
            rtcpMuxPolicy: 'require',
        });

        // Add local tracks
        for (const track of localStream.getTracks()) {
            this._pc.addTrack(track, localStream);
        }

        // Remote tracks → caller's callback
        this._pc.ontrack = ({ track, streams }) => {
            this._onRemoteTrack(track);
        };

        // ICE trickle
        this._pc.onicecandidate = ({ candidate }) => {
            if (candidate) {
                this._onSignal('call_ice_candidate', {
                    call_id: this._callId,
                    candidate: candidate.toJSON(),
                });
            }
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
            this._pendingIceCandidates.push(candidate || null);
            return;
        }
        await this._addIceCandidate(candidate || null);
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
    }

    replaceVideoTrack(newTrack) {
        const sender = this._pc?.getSenders().find(s => s.track?.kind === 'video');
        if (sender) sender.replaceTrack(newTrack);
    }

    addVideoTrack(newTrack, stream = this._localStream) {
        if (!this._pc || !newTrack) return;
        const sender = this._pc.getSenders().find(s => s.track?.kind === 'video');
        if (sender) {
            sender.replaceTrack(newTrack);
            return;
        }
        const targetStream = stream || this._localStream || new MediaStream([newTrack]);
        this._pc.addTrack(newTrack, targetStream);
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

    // ── Cleanup ──────────────────────────────────────────────────────────────

    close() {
        this._pc?.close();
        this._pc = null;
        this._localStream = null;
        this._pendingIceCandidates = [];
    }
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
