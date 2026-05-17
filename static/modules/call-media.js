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
        this._videoDeviceId = '';
        this._videoFacingMode = 'user';
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
            video: this._videoConstraints(),
        });
        this._localStream = stream;
        this._audioTrack = stream.getAudioTracks()[0] || null;
        this._videoTrack = stream.getVideoTracks()[0] || null;
        this._rememberVideoTrack(this._videoTrack);
        this._audioMuted = false;
        this._videoEnabled = true;
        return stream;
    }

    getAudioTrack() { return this._audioTrack; }
    getVideoTrack() { return this._videoTrack; }
    getLocalStream() { return this._localStream; }
    isAudioMuted() { return this._audioMuted; }
    isVideoEnabled() { return this._videoEnabled; }
    getVideoFacingMode() { return this._videoFacingMode; }

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

    async enableVideo() {
        if (this._videoTrack) {
            this._videoEnabled = true;
            this._videoTrack.enabled = true;
            return this._videoTrack;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: this._videoConstraints(),
        });
        const newTrack = stream.getVideoTracks()[0] || null;
        stream.getTracks().filter(t => t !== newTrack).forEach(t => t.stop());
        if (!newTrack) return null;

        if (!this._localStream) {
            this._localStream = new MediaStream();
        }
        this._localStream.addTrack(newTrack);
        this._videoTrack = newTrack;
        this._rememberVideoTrack(newTrack);
        this._videoEnabled = true;
        return newTrack;
    }

    async switchCamera() {
        if (!this._videoTrack) return null;

        const currentSettings = this._videoTrack.getSettings?.() || {};
        const currentId = currentSettings.deviceId || this._videoDeviceId;
        const currentFacing = currentSettings.facingMode || this._videoFacingMode || 'user';
        const nextFacing = currentFacing === 'environment' ? 'user' : 'environment';

        let lastError = null;
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const cameras = devices.filter(d => d.kind === 'videoinput');
            if (cameras.length > 1) {
                const next = this._pickNextCamera(cameras, currentId, nextFacing);
                if (next?.deviceId) {
                    const track = await this._replaceVideoTrack({
                        video: this._videoConstraints({ deviceId: next.deviceId }),
                    });
                    this._rememberVideoTrack(track, this._inferFacingMode(next, nextFacing));
                    return track;
                }
            }
        } catch (err) {
            lastError = err;
        }

        for (const exact of (nextFacing === 'environment' ? ['environment', 'user'] : ['user', 'environment'])) {
            try {
                const track = await this._replaceVideoTrack({
                    video: this._videoConstraints({ facingMode: exact }),
                });
                this._rememberVideoTrack(track, exact);
                return track;
            } catch (err) {
                lastError = err;
            }
        }

        if (lastError) throw lastError;
        return null;
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
        this._videoDeviceId = '';
        this._videoFacingMode = 'user';
    }

    async _replaceVideoTrack(constraints) {
        const newStream = await navigator.mediaDevices.getUserMedia(constraints);
        const newTrack = newStream.getVideoTracks()[0] || null;
        newStream.getTracks().filter(t => t !== newTrack).forEach(t => t.stop());
        if (!newTrack) throw new Error('No replacement video track');

        const oldTrack = this._videoTrack;
        this._videoTrack = newTrack;
        if (this._localStream) {
            this._localStream.getVideoTracks().forEach(t => this._localStream.removeTrack(t));
            this._localStream.addTrack(newTrack);
        }
        oldTrack?.stop();
        newTrack.enabled = this._videoEnabled;
        return newTrack;
    }

    _pickNextCamera(cameras, currentId, nextFacing) {
        const otherCameras = cameras.filter(camera => !currentId || camera.deviceId !== currentId);
        const facingMatch = otherCameras.find(camera => this._inferFacingMode(camera, '') === nextFacing);
        return facingMatch || otherCameras[0] || cameras[0] || null;
    }

    _inferFacingMode(device, fallback = '') {
        const label = String(device?.label || '').toLowerCase();
        if (/back|rear|environment|\u0437\u0430\u0434\u043d|\u043e\u0441\u043d\u043e\u0432\u043d/.test(label)) return 'environment';
        if (/front|user|face|\u043f\u0435\u0440\u0435\u0434\u043d|\u0444\u0440\u043e\u043d\u0442/.test(label)) return 'user';
        return fallback || this._videoFacingMode || 'user';
    }

    _rememberVideoTrack(track, fallbackFacingMode = '') {
        if (!track) return;
        const settings = track.getSettings?.() || {};
        this._videoDeviceId = settings.deviceId || this._videoDeviceId || '';
        this._videoFacingMode = settings.facingMode || fallbackFacingMode || this._videoFacingMode || 'user';
    }

    _videoConstraints({ deviceId = '', facingMode = '' } = {}) {
        const constraints = {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            frameRate: { ideal: 30 },
        };
        if (deviceId) {
            constraints.deviceId = { exact: deviceId };
        } else if (facingMode) {
            constraints.facingMode = { exact: facingMode };
        } else {
            constraints.facingMode = { ideal: this._videoFacingMode || 'user' };
        }
        return constraints;
    }
}
