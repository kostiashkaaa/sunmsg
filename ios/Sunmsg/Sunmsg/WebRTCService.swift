import Foundation
@preconcurrency import WebRTC   // silences non-Sendable RTCPeerConnection warnings
import AVFoundation
import CryptoKit

/// Real WebRTC peer connection manager. Bridges our Socket.IO call signaling
/// (`call_offer` / `call_answer` / `call_ice_candidate`) to a Google WebRTC
/// RTCPeerConnection so audio (and optionally video) flows P2P.
///
/// Lifecycle:
///   1. SessionStore.initiateCall(...) emits `call_initiate`. When the server
///      responds with `call_accepted`, the *caller* creates an SDP offer and
///      emits `call_offer`.
///   2. SessionStore.acceptCall(...) emits `call_accept`. The *callee* then
///      waits for `call_offer`, applies it as a remote description, creates
///      an SDP answer, and emits `call_answer`.
///   3. ICE candidates are exchanged via `call_ice_candidate` as they're
///      gathered on each side.

@MainActor
final class WebRTCService: NSObject, ObservableObject {

    static let shared = WebRTCService()

    @Published var connectionState: RTCIceConnectionState = .new
    @Published var remoteAudioActive: Bool = false
    /// Published so SwiftUI re-renders the video views when tracks appear/clear.
    @Published private(set) var remoteVideoTrack: RTCVideoTrack?
    @Published private(set) var localVideoTrack: RTCVideoTrack?
    /// 6-digit call verification code ("DDD DDD"), derived identically to the
    /// web client from both peers' DTLS fingerprints. Empty until connected.
    @Published private(set) var verificationCode: String = ""

    private(set) var currentCallId: String?
    private(set) var isInitiator: Bool = false
    private(set) var callType: String = "audio"   // "audio" | "video"

    /// Pending remote ICE candidates that arrived before the remote description was set.
    private var pendingRemoteCandidates: [RTCIceCandidate] = []

    private let factory: RTCPeerConnectionFactory = {
        RTCInitializeSSL()
        let videoEncoder = RTCDefaultVideoEncoderFactory()
        let videoDecoder = RTCDefaultVideoDecoderFactory()
        return RTCPeerConnectionFactory(
            encoderFactory: videoEncoder,
            decoderFactory: videoDecoder
        )
    }()

    private var peerConnection: RTCPeerConnection?
    private var localAudioTrack: RTCAudioTrack?
    private var localVideoCapturer: RTCCameraVideoCapturer?
    @Published private(set) var isUsingFrontCamera = true
    private var audioSession: RTCAudioSession { RTCAudioSession.sharedInstance() }

    /// Shared media constraints (offer/answer)
    private let mediaConstraints = RTCMediaConstraints(
        mandatoryConstraints: [
            "OfferToReceiveAudio": kRTCMediaConstraintsValueTrue,
            "OfferToReceiveVideo": kRTCMediaConstraintsValueTrue,
        ],
        optionalConstraints: nil
    )

    // ── Public API ────────────────────────────────────────────────────────────

    /// Prepare a new RTCPeerConnection for the given call. Call before sending
    /// or applying any SDP. Idempotent for the same callId.
    func startCall(callId: String, callType: String, isInitiator: Bool) {
        if currentCallId == callId, peerConnection != nil { return }
        cleanup()
        currentCallId = callId
        self.isInitiator = isInitiator
        self.callType = callType

        configureAudioSession()

        let config = RTCConfiguration()
        config.iceServers = [
            RTCIceServer(urlStrings: [
                "stun:stun.l.google.com:19302",
                "stun:stun1.l.google.com:19302",
                "stun:stun.l.google.com:3478",
                "stun:stun.cloudflare.com:3478",
                "stun:stun.miwifi.com:3478",
                "stun:global.stun.twilio.com:3478"
            ]),
            RTCIceServer(
                urlStrings: [
                    "turn:openrelay.metered.ca:80?transport=udp",
                    "turn:openrelay.metered.ca:80?transport=tcp",
                    "turn:openrelay.metered.ca:443?transport=tcp",
                    "turns:openrelay.metered.ca:443?transport=tcp"
                ],
                username: "openrelayproject",
                credential: "openrelayproject"
            )
        ]
        config.iceTransportPolicy = .all
        config.tcpCandidatePolicy = .enabled
        config.sdpSemantics = .unifiedPlan
        config.continualGatheringPolicy = .gatherContinually
        config.bundlePolicy = .maxBundle
        config.rtcpMuxPolicy = .require

        let constraints = RTCMediaConstraints(
            mandatoryConstraints: nil,
            optionalConstraints: ["DtlsSrtpKeyAgreement": kRTCMediaConstraintsValueTrue]
        )

        peerConnection = factory.peerConnection(with: config, constraints: constraints, delegate: self)
        attachLocalTracks()

        // Upgrade to the server's TURN relay (more reliable than public
        // fallbacks) once credentials arrive. Best-effort — the call still works
        // on the default STUN/TURN set if this fails.
        applyServerICEConfig(callId: callId, baseConfig: config)
    }

    /// Fetch server ICE servers and merge them into the live peer connection.
    private func applyServerICEConfig(callId: String, baseConfig: RTCConfiguration) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            guard let ice = try? await APIClient.shared.getICEConfig(callId: callId) else { return }
            // The connection may have been torn down while we awaited.
            guard let pc = self.peerConnection, self.currentCallId == callId else { return }
            guard !ice.iceServers.isEmpty else { return }

            var servers: [RTCIceServer] = baseConfig.iceServers
            for entry in ice.iceServers {
                let urls: [String]
                if let s = entry["urls"] as? String { urls = [s] }
                else if let arr = entry["urls"] as? [String] { urls = arr }
                else { continue }
                if let user = entry["username"] as? String, let cred = entry["credential"] as? String {
                    servers.append(RTCIceServer(urlStrings: urls, username: user, credential: cred))
                } else {
                    servers.append(RTCIceServer(urlStrings: urls))
                }
            }
            baseConfig.iceServers = servers
            if ice.iceTransportPolicy == "relay" {
                baseConfig.iceTransportPolicy = .relay
            }
            pc.setConfiguration(baseConfig)
        }
    }

    /// Caller side — generate offer and emit `call_offer`.
    func createAndSendOffer() {
        guard let pc = peerConnection, let callId = currentCallId else { return }
        // Capture constraints as a local so the Sendable closure doesn't
        // reference the @MainActor-isolated property directly.
        let constraints = mediaConstraints
        pc.offer(for: constraints) { sdp, _ in
            guard let sdp else { return }
            pc.setLocalDescription(sdp) { _ in
                Task { @MainActor in
                    SocketClient.shared.emit("call_offer", [
                        "call_id": callId,
                        "sdp": ["type": "offer", "sdp": sdp.sdp],
                        "csrf_token": APIClient.shared.csrfToken,
                    ])
                }
            }
        }
    }

    /// Callee side — apply incoming offer, generate answer, emit `call_answer`.
    func handleRemoteOffer(_ sdpText: String) {
        guard let pc = peerConnection, let callId = currentCallId else { return }
        let remote = RTCSessionDescription(type: .offer, sdp: sdpText)
        let constraints = mediaConstraints   // capture before entering Sendable closure
        pc.setRemoteDescription(remote) { [weak self] err in
            if err != nil { return }
            // drainPendingCandidates is @MainActor — hop there explicitly.
            Task { @MainActor [weak self] in self?.drainPendingCandidates() }
            pc.answer(for: constraints) { sdp, _ in
                guard let sdp else { return }
                pc.setLocalDescription(sdp) { _ in
                    Task { @MainActor in
                        SocketClient.shared.emit("call_answer", [
                            "call_id": callId,
                            "sdp": ["type": "answer", "sdp": sdp.sdp],
                            "csrf_token": APIClient.shared.csrfToken,
                        ])
                    }
                }
            }
        }
    }

    /// Caller side — apply remote answer to our previously sent offer.
    func handleRemoteAnswer(_ sdpText: String) {
        guard let pc = peerConnection else { return }
        let remote = RTCSessionDescription(type: .answer, sdp: sdpText)
        pc.setRemoteDescription(remote) { [weak self] _ in
            Task { @MainActor [weak self] in self?.drainPendingCandidates() }
        }
    }

    func handleRemoteCandidate(_ candidate: [String: Any]) {
        guard let cand = candidate["candidate"] as? String else { return }
        let sdpMid = candidate["sdpMid"] as? String
        let sdpMLineIndex = (candidate["sdpMLineIndex"] as? Int32) ?? Int32(candidate["sdpMLineIndex"] as? Int ?? 0)
        let ice = RTCIceCandidate(sdp: cand, sdpMLineIndex: sdpMLineIndex, sdpMid: sdpMid)
        guard let pc = peerConnection else { return }
        if pc.remoteDescription == nil {
            pendingRemoteCandidates.append(ice)
        } else {
            pc.add(ice) { _ in }
        }
    }

    func setMuted(_ muted: Bool) {
        localAudioTrack?.isEnabled = !muted
    }

    func setCameraOff(_ off: Bool) {
        localVideoTrack?.isEnabled = !off
        if off {
            localVideoCapturer?.stopCapture()
        } else if let capturer = localVideoCapturer {
            startVideoCapture(capturer: capturer, position: isUsingFrontCamera ? .front : .back)
        }
    }

    /// Turn on the local camera, even on a call that started as audio-only.
    /// The first time, this creates a video track and renegotiates (sends a
    /// fresh SDP offer) so the peer starts receiving video. Re-enabling an
    /// existing track just restarts capture — no renegotiation needed.
    func enableLocalVideo() {
        guard let pc = peerConnection else { return }
        if let track = localVideoTrack {
            track.isEnabled = true
            if let capturer = localVideoCapturer {
                startVideoCapture(capturer: capturer, position: isUsingFrontCamera ? .front : .back)
            }
            return
        }
        let videoSource = factory.videoSource()
        let videoTrack = factory.videoTrack(with: videoSource, trackId: "video0")
        pc.add(videoTrack, streamIds: ["sun-stream"])
        localVideoTrack = videoTrack
        let capturer = RTCCameraVideoCapturer(delegate: videoSource)
        localVideoCapturer = capturer
        startVideoCapture(capturer: capturer, position: isUsingFrontCamera ? .front : .back)
        // Renegotiate so the added video m-line is offered to the peer.
        createAndSendOffer()
    }

    func switchCamera() {
        guard let capturer = localVideoCapturer else { return }
        isUsingFrontCamera.toggle()
        startVideoCapture(capturer: capturer, position: isUsingFrontCamera ? .front : .back)
    }

    func setSpeakerOn(_ on: Bool) {
        audioSession.lockForConfiguration()
        do { try audioSession.overrideOutputAudioPort(on ? .speaker : .none) } catch { }
        audioSession.unlockForConfiguration()
    }

    func endCall() {
        cleanup()
    }

    // ── Internals ─────────────────────────────────────────────────────────────

    private func attachLocalTracks() {
        guard let pc = peerConnection else { return }

        // Local audio
        let audioConstraints = RTCMediaConstraints(mandatoryConstraints: nil, optionalConstraints: nil)
        let audioSource = factory.audioSource(with: audioConstraints)
        let audioTrack = factory.audioTrack(with: audioSource, trackId: "audio0")
        pc.add(audioTrack, streamIds: ["sun-stream"])
        localAudioTrack = audioTrack

        // Local video (only for video calls)
        if callType == "video" {
            let videoSource = factory.videoSource()
            let videoTrack = factory.videoTrack(with: videoSource, trackId: "video0")
            pc.add(videoTrack, streamIds: ["sun-stream"])
            localVideoTrack = videoTrack

            let capturer = RTCCameraVideoCapturer(delegate: videoSource)
            localVideoCapturer = capturer
            startVideoCapture(capturer: capturer, position: isUsingFrontCamera ? .front : .back)
        }
    }

    private func startVideoCapture(capturer: RTCCameraVideoCapturer, position: AVCaptureDevice.Position) {
        guard let device = RTCCameraVideoCapturer.captureDevices().first(where: { $0.position == position })
                ?? RTCCameraVideoCapturer.captureDevices().first else { return }
        let formats = RTCCameraVideoCapturer.supportedFormats(for: device)
        
        let targetWidth: Int32 = 640
        let targetHeight: Int32 = 480
        let format = formats.min { f1, f2 in
            let d1 = CMVideoFormatDescriptionGetDimensions(f1.formatDescription)
            let d2 = CMVideoFormatDescriptionGetDimensions(f2.formatDescription)
            let diff1 = abs(d1.width - targetWidth) + abs(d1.height - targetHeight)
            let diff2 = abs(d2.width - targetWidth) + abs(d2.height - targetHeight)
            return diff1 < diff2
        } ?? formats.first
        
        guard let fmt = format else { return }
        let fps = (fmt.videoSupportedFrameRateRanges.first?.maxFrameRate ?? 30).clamped(0, 30)
        capturer.startCapture(with: device, format: fmt, fps: Int(fps)) { _ in }
    }

    private func configureAudioSession() {
        let session = audioSession
        session.lockForConfiguration()
        do {
            try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.allowBluetoothHFP, .allowBluetoothA2DP, .defaultToSpeaker])
            try session.setMode(.voiceChat)
            try session.setActive(true)
        } catch { }
        session.unlockForConfiguration()
    }

    private func drainPendingCandidates() {
        guard let pc = peerConnection else { return }
        for c in pendingRemoteCandidates { pc.add(c) { _ in } }
        pendingRemoteCandidates.removeAll()
    }

    // ── Call verification code (matches web's deriveCallVerificationCode) ──────

    /// Recompute the 6-digit verification code once both SDPs (and thus both
    /// DTLS fingerprints) are available. Identical algorithm to the web client
    /// so the two devices show the same number.
    func refreshVerificationCode() {
        guard let pc = peerConnection else { return }
        let local  = Self.dtlsFingerprint(from: pc.localDescription?.sdp)
        let remote = Self.dtlsFingerprint(from: pc.remoteDescription?.sdp)
        let parts = [local, remote]
            .map { $0.uppercased().filter(\.isHexDigit) }
            .filter { !$0.isEmpty }
            .sorted()
        guard !parts.isEmpty else { return }
        let normalized = parts.joined(separator: "|")
        let digest = Array(SHA256.hash(data: Data("sun-call-v1|\(normalized)".utf8)))
        let numeric = ((Int(digest[0]) << 16) | (Int(digest[1]) << 8) | Int(digest[2])) % 1_000_000
        let s = String(format: "%06d", numeric)
        let code = "\(s.prefix(3)) \(s.suffix(3))"
        if code != verificationCode { verificationCode = code }
    }

    /// Extract the hex DTLS fingerprint (colons stripped) from an SDP blob.
    private static func dtlsFingerprint(from sdp: String?) -> String {
        guard let sdp else { return "" }
        for rawLine in sdp.split(separator: "\n") {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            guard line.hasPrefix("a=fingerprint:") else { continue }
            // a=fingerprint:sha-256 AA:BB:CC:...
            let body = line.dropFirst("a=fingerprint:".count)
            let comps = body.split(separator: " ", maxSplits: 1)
            if comps.count == 2 {
                return comps[1].replacingOccurrences(of: ":", with: "").uppercased()
            }
        }
        return ""
    }

    private func cleanup() {
        localVideoCapturer?.stopCapture()
        localVideoCapturer = nil
        localAudioTrack = nil
        localVideoTrack = nil
        remoteVideoTrack = nil
        peerConnection?.close()
        peerConnection = nil
        pendingRemoteCandidates.removeAll()
        currentCallId = nil
        isInitiator = false
        remoteAudioActive = false
        verificationCode = ""
        connectionState = .closed

        audioSession.lockForConfiguration()
        do { try audioSession.setActive(false) } catch { }
        audioSession.unlockForConfiguration()
    }
}

// MARK: - RTCPeerConnectionDelegate

extension WebRTCService: RTCPeerConnectionDelegate {

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection,
                                    didChange stateChanged: RTCSignalingState) {}

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection,
                                    didAdd stream: RTCMediaStream) {}

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection,
                                    didRemove stream: RTCMediaStream) {}

    nonisolated func peerConnectionShouldNegotiate(_ peerConnection: RTCPeerConnection) {}

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection,
                                    didChange newState: RTCIceConnectionState) {
        Task { @MainActor in
            self.connectionState = newState
            if newState == .connected || newState == .completed {
                self.refreshVerificationCode()
            }
        }
    }

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection,
                                    didChange newState: RTCIceGatheringState) {}

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection,
                                    didGenerate candidate: RTCIceCandidate) {
        Task { @MainActor in
            guard let callId = self.currentCallId else { return }
            SocketClient.shared.emit("call_ice_candidate", [
                "call_id": callId,
                "candidate": [
                    "candidate": candidate.sdp,
                    "sdpMid": candidate.sdpMid ?? "",
                    "sdpMLineIndex": Int(candidate.sdpMLineIndex),
                ],
                "csrf_token": APIClient.shared.csrfToken,
            ])
        }
    }

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection,
                                    didRemove candidates: [RTCIceCandidate]) {}

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection,
                                    didOpen dataChannel: RTCDataChannel) {}

    nonisolated func peerConnection(_ peerConnection: RTCPeerConnection,
                                    didAdd rtpReceiver: RTCRtpReceiver,
                                    streams mediaStreams: [RTCMediaStream]) {
        if let videoTrack = rtpReceiver.track as? RTCVideoTrack {
            Task { @MainActor in self.remoteVideoTrack = videoTrack }
        }
        if rtpReceiver.track is RTCAudioTrack {
            Task { @MainActor in self.remoteAudioActive = true }
        }
    }
}

// MARK: - Helpers

private extension Comparable {
    func clamped(_ lo: Self, _ hi: Self) -> Self { min(max(self, lo), hi) }
}
