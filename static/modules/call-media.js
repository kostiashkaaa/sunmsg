/**
 * call-media.js
 * Manages access to microphone and camera (getUserMedia).
 * Handles device switching and mute/unmute without re-negotiating WebRTC.
 */

export class CallMedia {
    constructor() {
        this._localStream = null;
        this._audioTrack = null;
        this._videoTrack = null;
        this._audioMuted = false;
        this._videoEnabled = false;
    }

    async acquireAudio() {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        this._localStream = stream;
        this._audioTrack = stream.getAudioTracks()[0] || null;
        this._audioMuted = false;
        return stream;
    }

    async acquireVideo() {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true,
            video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        });
        this._localStream = stream;
        this._audioTrack = stream.getAudioTracks()[0] || null;
        this._videoTrack = stream.getVideoTracks()[0] || null;
        this._audioMuted = false;
        this._videoEnabled = true;
        return stream;
    }

    getAudioTrack() { return this._audioTrack; }
    getVideoTrack() { return this._videoTrack; }
    getLocalStream() { return this._localStream; }
    isAudioMuted() { return this._audioMuted; }
    isVideoEnabled() { return this._videoEnabled; }

    toggleAudio() {
        if (!this._audioTrack) return this._audioMuted;
        this._audioMuted = !this._audioMuted;
        this._audioTrack.enabled = !this._audioMuted;
        return this._audioMuted;
    }

    toggleVideo() {
        if (!this._videoTrack) return this._videoEnabled;
        this._videoEnabled = !this._videoEnabled;
        this._videoTrack.enabled = this._videoEnabled;
        return this._videoEnabled;
    }

    async switchCamera() {
        if (!this._videoTrack) return;
        const devices = await navigator.mediaDevices.enumerateDevices();
        const cameras = devices.filter(d => d.kind === 'videoinput');
        if (cameras.length < 2) return;

        const currentId = this._videoTrack.getSettings().deviceId;
        const next = cameras.find(c => c.deviceId !== currentId) || cameras[0];

        const newStream = await navigator.mediaDevices.getUserMedia({
            video: { deviceId: { exact: next.deviceId } },
        });
        const newTrack = newStream.getVideoTracks()[0];

        this._videoTrack.stop();
        this._videoTrack = newTrack;
        if (this._localStream) {
            const old = this._localStream.getVideoTracks();
            old.forEach(t => this._localStream.removeTrack(t));
            this._localStream.addTrack(newTrack);
        }
        newTrack.enabled = this._videoEnabled;
    }

    release() {
        if (this._localStream) {
            this._localStream.getTracks().forEach(t => t.stop());
            this._localStream = null;
        }
        this._audioTrack = null;
        this._videoTrack = null;
        this._audioMuted = false;
        this._videoEnabled = false;
    }
}
