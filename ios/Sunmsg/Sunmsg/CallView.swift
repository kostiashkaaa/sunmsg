import SwiftUI
import AVFoundation
import WebRTC

// MARK: - Incoming call overlay

struct IncomingCallView: View {
    let call: IncomingCallData
    @ObservedObject var session: SessionStore
    @State private var ringPhase: Double = 0
    private let ringTimer = Timer.publish(every: 0.05, on: .main, in: .common).autoconnect()

    var body: some View {
        ZStack {
            // Blurred dark background
            Color.black.opacity(0.55).ignoresSafeArea()
                .background(.ultraThinMaterial)

            VStack(spacing: 0) {
                Spacer()

                // Card
                VStack(spacing: 0) {
                    // Ripple + avatar
                    ZStack {
                        // Animated rings
                        ForEach(0..<3, id: \.self) { i in
                            Circle()
                                .stroke(Color.smAccent.opacity(0.25 - Double(i) * 0.07), lineWidth: 1.5)
                                .frame(width: 104 + CGFloat(i) * 22, height: 104 + CGFloat(i) * 22)
                                .scaleEffect(1 + sin(ringPhase + Double(i) * 0.8) * 0.08)
                                .opacity(0.5 + sin(ringPhase + Double(i) * 0.8) * 0.3)
                                .animation(.easeInOut(duration: 0.05), value: ringPhase)
                        }

                        SmAvatarView(name: call.callerName, size: 88)
                    }
                    .frame(height: 140)
                    .padding(.top, 32)

                    // Name + call type
                    Text(call.callerName)
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundStyle(Color.smText)
                        .tracking(-0.5)
                        .padding(.top, 14)

                    Text(call.callType == "video" ? "Видеозвонок" : "Голосовой звонок")
                        .font(.system(size: 14))
                        .foregroundStyle(Color.smMuted)
                        .padding(.top, 4)

                    // Buttons
                    HStack(spacing: 44) {
                        // Decline
                        VStack(spacing: 8) {
                            Button(action: { session.rejectCall(callId: call.callId) }) {
                                Image(systemName: "phone.down.fill")
                                    .font(.system(size: 26))
                                    .foregroundStyle(.white)
                                    .frame(width: 64, height: 64)
                                    .background(Color(hex: "#c14242"), in: Circle())
                                    .shadow(color: Color(hex: "#c14242").opacity(0.45), radius: 12, x: 0, y: 6)
                            }
                            .buttonStyle(.plain)
                            Text("Отклонить")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(Color.smMuted)
                        }

                        // Accept
                        VStack(spacing: 8) {
                            Button(action: { session.acceptCall(callId: call.callId) }) {
                                Image(systemName: call.callType == "video" ? "video.fill" : "phone.fill")
                                    .font(.system(size: 24))
                                    .foregroundStyle(Color(hex: "#15140e"))
                                    .frame(width: 64, height: 64)
                                    .background(Color.smAccent, in: Circle())
                                    .shadow(color: Color.smAccent.opacity(0.45), radius: 12, x: 0, y: 6)
                            }
                            .buttonStyle(.plain)
                            Text("Принять")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(Color.smMuted)
                        }
                    }
                    .padding(.vertical, 36)
                }
                .frame(maxWidth: .infinity)
                .background(Color.smSurface, in: RoundedRectangle(cornerRadius: 28))
                .overlay(RoundedRectangle(cornerRadius: 28).stroke(Color.smBorder, lineWidth: 0.5))
                .shadow(color: Color.black.opacity(0.18), radius: 40, x: 0, y: 10)
                .padding(.horizontal, 16)

                Spacer()
            }
        }
        .onReceive(ringTimer) { _ in
            ringPhase += 0.08
            // Pulse haptics roughly once per ring cycle while the banner is up.
            if Int(ringPhase / 0.08) % 25 == 0 {
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            }
        }
    }
}

// MARK: - Active call (in-call) screen

struct InCallView: View {
    var providedCall: ActiveCallState?
    @ObservedObject var session: SessionStore
    @State private var elapsed: Int = 0
    @State private var callTimer: Timer? = nil
    @StateObject private var webrtc = WebRTCService.shared

    private var call: ActiveCallState? { session.activeCall ?? providedCall }

    var body: some View {
        ZStack {
            if let call {
                callScreen(call)
            }
        }
        .onAppear {
            // Audio routing is owned by WebRTCService via RTCAudioSession; the
            // view must not reconfigure AVAudioSession directly (doing so fights
            // WebRTC's session management and can drop the call audio route).
            startTimer()
            UIDevice.current.isProximityMonitoringEnabled = !(call?.isSpeaker ?? true)
        }
        .onChange(of: call?.isSpeaker) { _, isSpeaker in
            UIDevice.current.isProximityMonitoringEnabled = !(isSpeaker ?? true)
        }
        .onDisappear {
            UIDevice.current.isProximityMonitoringEnabled = false
            callTimer?.invalidate()
            callTimer = nil
        }
    }

    private var showingRemoteVideo: Bool {
        webrtc.remoteVideoTrack != nil
    }

    private func callScreen(_ call: ActiveCallState) -> some View {
        ZStack {
            // Amber radial gradient background (matches prototype exactly)
            RadialGradient(
                colors: [
                    Color(hex: "#e6c481"),
                    Color(hex: "#c4943c"),
                    Color(hex: "#8a6225"),
                ],
                center: UnitPoint(x: 0.5, y: 0.35),
                startRadius: 0,
                endRadius: 420
            )
            .ignoresSafeArea()

            // Remote video fills the screen once it arrives (any call where the
            // peer has the camera on, including audio calls upgraded mid-call).
            if let remote = webrtc.remoteVideoTrack {
                RTCVideoView(track: remote)
                    .ignoresSafeArea()
                    .transition(.opacity)
                LinearGradient(
                    colors: [Color.black.opacity(0.35), Color.clear, Color.black.opacity(0.5)],
                    startPoint: .top, endPoint: .bottom
                )
                .ignoresSafeArea()
            }

            // Local camera preview (picture-in-picture).
            if let local = webrtc.localVideoTrack, !call.isCameraOff {
                VStack {
                    HStack {
                        Spacer()
                        RTCVideoView(track: local, mirror: webrtc.isUsingFrontCamera)
                            .frame(width: 106, height: 152)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                            .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color.white.opacity(0.25), lineWidth: 1))
                            .shadow(color: Color.black.opacity(0.30), radius: 10, x: 0, y: 4)
                            .padding(.top, 104)
                            .padding(.trailing, 16)
                    }
                    Spacer()
                }
            }

            VStack(spacing: 0) {
                // Top status bar
                HStack {
                    // Encrypted badge
                    HStack(spacing: 5) {
                        Circle()
                            .fill(Color(hex: "#5db87e"))
                            .frame(width: 6, height: 6)
                            .shadow(color: Color(hex: "#5db87e").opacity(0.7), radius: 4)
                        Text("ЗАШИФРОВАНО")
                            .font(.system(size: 10.5, weight: .semibold))
                            .foregroundStyle(Color(hex: "#fbf8f1"))
                            .tracking(0.5)

                        if !webrtc.verificationCode.isEmpty {
                            HStack(spacing: 3) {
                                ForEach(Array(webrtc.verificationCode.filter(\.isNumber).enumerated()), id: \.offset) { _, ch in
                                    Text(String(ch))
                                        .font(.system(size: 10.5, weight: .bold, design: .monospaced))
                                        .foregroundStyle(Color(hex: "#15140e"))
                                        .padding(.horizontal, 4)
                                        .padding(.vertical, 2)
                                        .background(Color.smAccent, in: RoundedRectangle(cornerRadius: 4))
                                }
                            }
                            .padding(.leading, 4)
                        }
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(Color.black.opacity(0.20), in: Capsule())

                    Spacer()

                    // Call timer
                    Text(elapsedText)
                        .font(.system(size: 14, weight: .semibold, design: .monospaced))
                        .foregroundStyle(Color(hex: "#fbf8f1"))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(Color.black.opacity(0.20), in: Capsule())
                }
                .padding(.horizontal, 24)
                .padding(.top, 60)

                Spacer()

                // Identity (hidden once the peer's video covers the screen)
                if !showingRemoteVideo {
                VStack(spacing: 0) {
                    // Avatar circle — 132×132 as per prototype
                    ZStack {
                        Circle()
                            .fill(
                                LinearGradient(
                                    colors: [Color(hex: "#f5d98e"), Color(hex: "#c07c38")],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .frame(width: 132, height: 132)
                            .shadow(color: Color.black.opacity(0.30), radius: 24, x: 0, y: 12)
                            .overlay(Circle().stroke(Color(hex: "#fbf8f1").opacity(0.10), lineWidth: 6))

                        Text(initials(call.partnerName))
                            .font(.system(size: 46, weight: .bold))
                            .foregroundStyle(Color(hex: "#15140e"))
                            .tracking(-1)
                    }
                    .padding(.bottom, 22)

                    Text(call.partnerName)
                        .font(.system(size: 26, weight: .semibold))
                        .foregroundStyle(Color(hex: "#fbf8f1"))
                        .tracking(-0.6)

                    HStack(spacing: 6) {
                        Image(systemName: call.callType == "video" ? "video.fill" : "phone.fill")
                            .font(.system(size: 13))
                            .foregroundStyle(Color(hex: "#fbf8f1").opacity(0.85))
                        Text(call.callType == "video" ? "Видеозвонок · WiFi" : "Голосовой звонок · WiFi")
                            .font(.system(size: 13.5))
                            .foregroundStyle(Color(hex: "#fbf8f1").opacity(0.85))
                    }
                    .padding(.top, 4)

                    // Connecting hint
                    if webrtc.connectionState != .connected && webrtc.connectionState != .completed {
                        Text("Соединение…")
                            .font(.system(size: 14).italic())
                            .foregroundStyle(Color(hex: "#fbf8f1").opacity(0.70))
                            .padding(.top, 14)
                    } else if call.remoteAudioMuted {
                        HStack(spacing: 5) {
                            Image(systemName: "mic.slash.fill").font(.system(size: 11))
                            Text("Собеседник отключил микрофон").font(.system(size: 12.5))
                        }
                        .foregroundStyle(Color(hex: "#fbf8f1").opacity(0.80))
                        .padding(.top, 12)
                    }
                }
                .padding(.bottom, 80)
                }

                Spacer()

                // Control grid — 4 buttons (matches prototype 4-column grid)
                HStack(spacing: 0) {
                    CallControlBtn(
                        icon: call.isMuted ? "mic.slash.fill" : "mic.fill",
                        label: "Микрофон",
                        active: !call.isMuted,
                        action: { session.toggleMute() }
                    )
                    CallControlBtn(
                        icon: "speaker.wave.2.fill",
                        label: "Динамик",
                        active: call.isSpeaker,
                        action: { session.toggleSpeaker() }
                    )
                    CallControlBtn(
                        icon: call.isCameraOff ? "video.slash.fill" : "video.fill",
                        label: "Камера",
                        active: !call.isCameraOff,
                        action: { session.toggleCamera() }
                    )
                    CallControlBtn(
                        icon: "arrow.triangle.2.circlepath.camera.fill",
                        label: "Перевернуть",
                        active: webrtc.isUsingFrontCamera,
                        action: { webrtc.switchCamera() }
                    )
                    .disabled(webrtc.localVideoTrack == nil || call.isCameraOff)
                    .opacity(webrtc.localVideoTrack != nil && !call.isCameraOff ? 1 : 0.45)
                }
                .padding(.horizontal, 28)
                .padding(.bottom, 18)

                // End call button
                Button(action: { session.endCall() }) {
                    Image(systemName: "phone.down.fill")
                        .font(.system(size: 26))
                        .foregroundStyle(.white)
                        .frame(width: 66, height: 66)
                        .background(Color(hex: "#c14242"), in: Circle())
                        .shadow(color: Color(hex: "#c14242").opacity(0.45), radius: 18, x: 0, y: 8)
                }
                .buttonStyle(.plain)
                .padding(.bottom, 48)
            }
        }
    }

    private var elapsedText: String {
        let m = elapsed / 60
        let s = elapsed % 60
        return String(format: "%02d:%02d", m, s)
    }

    private func initials(_ name: String) -> String {
        name.components(separatedBy: " ").prefix(2)
            .compactMap { $0.first.map(String.init) }
            .joined().uppercased()
    }

    private func startTimer() {
        callTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { _ in
            // The timer fires on the main run loop — assumeIsolated lets us read
            // the @MainActor WebRTCService state without a concurrency warning.
            MainActor.assumeIsolated {
                let s = WebRTCService.shared.connectionState
                if s == .connected || s == .completed { elapsed += 1 }
            }
        }
    }

}

// MARK: - WebRTC video view wrappers

struct RTCVideoView: UIViewRepresentable {
    let track: RTCVideoTrack?
    var mirror: Bool = false

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> RTCMTLVideoView {
        let v = RTCMTLVideoView()
        v.videoContentMode = .scaleAspectFill
        return v
    }

    func updateUIView(_ uiView: RTCMTLVideoView, context: Context) {
        uiView.transform = mirror ? CGAffineTransform(scaleX: -1, y: 1) : .identity
        // Only re-attach when the track actually changes — repeatedly calling
        // add() on every SwiftUI update stacks duplicate renderers.
        let coord = context.coordinator
        if coord.attachedTrack === track { return }
        coord.attachedTrack?.remove(uiView)
        track?.add(uiView)
        coord.attachedTrack = track
    }

    static func dismantleUIView(_ uiView: RTCMTLVideoView, coordinator: Coordinator) {
        coordinator.attachedTrack?.remove(uiView)
        coordinator.attachedTrack = nil
    }

    final class Coordinator {
        weak var attachedTrack: RTCVideoTrack?
    }
}

// MARK: - Call control button

struct CallControlBtn: View {
    let icon: String
    let label: String
    let active: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 8) {
                Image(systemName: icon)
                    .font(.system(size: 22))
                    .foregroundStyle(active ? Color(hex: "#15140e") : Color(hex: "#fbf8f1"))
                    .frame(width: 56, height: 56)
                    .background(
                        active ? Color(hex: "#fbf8f1") : Color.black.opacity(0.28),
                        in: Circle()
                    )
                    .overlay(
                        Circle()
                            .stroke(Color(hex: "#fbf8f1").opacity(0.20), lineWidth: 0.5)
                    )
                    .shadow(
                        color: active ? Color.black.opacity(0.12) : .clear,
                        radius: 4, x: 0, y: 2
                    )
                Text(label)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(Color(hex: "#fbf8f1").opacity(0.85))
                    .tracking(-0.05)
                    .lineLimit(1)
            }
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
    }
}
