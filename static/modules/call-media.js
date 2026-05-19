/**
 * call-media.js
 * Manages microphone/camera access, local track lifecycle, and device swaps.
 */

export class CallMedia {
    constructor() {
        this._localStream = null;
        this._audioTrack = null;
        this._videoTrack = null;
        this._audioMuted = false;
        this._videoEnabled = false;
        this._audioDeviceId = '';
        this._videoDeviceId = '';
        this._videoFacingMode = 'user';
        this._trackHandlers = {};
        this._boundTracks = new WeakSet();
    }

    setTrackLifecycleHandlers(handlers = {}) {
        this._trackHandlers = handlers || {};
    }

    async acquireAudio() {
        const stream = await this._getUserMediaWithStoredDeviceFallback({
            audio: this._audioConstraints(),
            video: false,
        }, { audio: true });
        this._releaseStream();
        this._localStream = stream;
        this._audioTrack = stream.getAudioTracks()[0] || null;
        this._videoTrack = null;
        this._rememberAudioTrack(this._audioTrack);
        this._bindTrackLifecycle(this._audioTrack);
        this._audioMuted = false;
        this._videoEnabled = false;
        return stream;
    }

    async acquireVideo() {
        const stream = await this._getUserMediaWithStoredDeviceFallback({
            audio: this._audioConstraints(),
            video: this._videoConstraints(),
        }, { audio: true, video: true });
        this._releaseStream();
        this._localStream = stream;
        this._audioTrack = stream.getAudioTracks()[0] || null;
        this._videoTrack = stream.getVideoTracks()[0] || null;
        this._rememberAudioTrack(this._audioTrack);
        this._rememberVideoTrack(this._videoTrack);
        this._bindTrackLifecycle(this._audioTrack);
        this._bindTrackLifecycle(this._videoTrack);
        this._audioMuted = false;
        this._videoEnabled = Boolean(this._videoTrack);
        return stream;
    }

    getAudioTrack() { return this._audioTrack; }
    getVideoTrack() { return this._videoTrack; }
    getLocalStream() { return this._localStream; }
    isAudioMuted() { return this._audioMuted; }
    isVideoEnabled() { return this._videoEnabled; }
    getVideoFacingMode() { return this._videoFacingMode; }
    getAudioDeviceId() { return this._audioDeviceId; }
    getVideoDeviceId() { return this._videoDeviceId; }

    toggleAudio() {
        if (!this._audioTrack) return this._audioMuted;
        this._audioMuted = !this._audioMuted;
        this._audioTrack.enabled = !this._audioMuted;
        return this._audioMuted;
    }

    toggleVideo() {
        if (!this._videoTrack) return this._videoEnabled;
        if (this._videoEnabled) {
            this.disableVideo();
            return false;
        }
        this._videoEnabled = true;
        this._videoTrack.enabled = true;
        return true;
    }

    async enableVideo() {
        if (this._videoTrack) {
            this._videoEnabled = true;
            this._videoTrack.enabled = true;
            return this._videoTrack;
        }
        const prepared = await this.prepareVideoInput('');
        return this.commitPreparedVideoTrack(prepared.track, prepared);
    }

    disableVideo() {
        const oldTrack = this._videoTrack;
        this._videoTrack = null;
        this._videoEnabled = false;
        if (oldTrack && this._localStream) {
            this._localStream.removeTrack(oldTrack);
        }
        oldTrack?.stop();
        return oldTrack || null;
    }

    async prepareAudioInput(deviceId) {
        const nextDeviceId = String(deviceId || '');
        const track = await this._newAudioTrack(
            this._audioConstraints({ deviceId: nextDeviceId, allowStoredDevice: false }),
        );
        return { track, deviceId: nextDeviceId };
    }

    commitPreparedAudioTrack(track, { deviceId = '' } = {}) {
        if (!track) throw new Error('No replacement audio track');
        const oldTrack = this._audioTrack;
        this._audioTrack = track;
        this._audioDeviceId = String(deviceId || '');
        this._ensureLocalStream();
        this._localStream.getAudioTracks().forEach(t => this._localStream.removeTrack(t));
        this._localStream.addTrack(track);
        this._rememberAudioTrack(track);
        this._bindTrackLifecycle(track);
        track.enabled = !this._audioMuted;
        if (oldTrack && oldTrack !== track) oldTrack.stop();
        return track;
    }

    discardTrack(track) {
        track?.stop();
    }

    async selectAudioInput(deviceId) {
        const prepared = await this.prepareAudioInput(deviceId);
        return this.commitPreparedAudioTrack(prepared.track, prepared);
    }

    async prepareVideoInput(deviceId) {
        const nextDeviceId = String(deviceId || '');
        const track = await this._newVideoTrack(
            this._videoConstraints({ deviceId: nextDeviceId, allowStoredDevice: false }),
        );
        return { track, deviceId: nextDeviceId, facingMode: '' };
    }

    commitPreparedVideoTrack(track, { deviceId = '', facingMode = '' } = {}) {
        if (!track) throw new Error('No replacement video track');
        const oldTrack = this._videoTrack;
        this._videoTrack = track;
        this._videoDeviceId = String(deviceId || '');
        this._videoEnabled = true;
        this._ensureLocalStream();
        this._localStream.getVideoTracks().forEach(t => this._localStream.removeTrack(t));
        this._localStream.addTrack(track);
        this._rememberVideoTrack(track, facingMode);
        this._bindTrackLifecycle(track);
        track.enabled = true;
        if (oldTrack && oldTrack !== track) oldTrack.stop();
        return track;
    }

    async selectVideoInput(deviceId) {
        const prepared = await this.prepareVideoInput(deviceId);
        return this.commitPreparedVideoTrack(prepared.track, prepared);
    }

    async listDevices() {
        if (!navigator.mediaDevices?.enumerateDevices) {
            return { audioInputs: [], videoInputs: [], audioOutputs: [] };
        }
        const devices = await navigator.mediaDevices.enumerateDevices();
        const labelIndex = { audioinput: 0, videoinput: 0, audiooutput: 0 };
        const toOption = (device) => {
            labelIndex[device.kind] = (labelIndex[device.kind] || 0) + 1;
            return {
                deviceId: device.deviceId || '',
                label: device.label || this._fallbackDeviceLabel(device.kind, labelIndex[device.kind]),
                kind: device.kind,
            };
        };
        return {
            audioInputs: devices.filter(device => device.kind === 'audioinput').map(toOption),
            videoInputs: devices.filter(device => device.kind === 'videoinput').map(toOption),
            audioOutputs: devices.filter(device => device.kind === 'audiooutput').map(toOption),
        };
    }

    async refreshAvailableDevices() {
        if (!navigator.mediaDevices?.enumerateDevices) return;
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioIds = new Set(devices.filter(d => d.kind === 'audioinput').map(d => d.deviceId).filter(Boolean));
        const videoIds = new Set(devices.filter(d => d.kind === 'videoinput').map(d => d.deviceId).filter(Boolean));
        if (this._audioDeviceId && !audioIds.has(this._audioDeviceId)) {
            this._audioDeviceId = '';
        }
        if (this._videoDeviceId && !videoIds.has(this._videoDeviceId)) {
            this._videoDeviceId = '';
        }
    }

    async prepareCameraSwitch() {
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
                    const track = await this._newVideoTrack(
                        this._videoConstraints({ deviceId: next.deviceId }),
                    );
                    return {
                        track,
                        deviceId: next.deviceId,
                        facingMode: this._inferFacingMode(next, nextFacing),
                    };
                }
            }
        } catch (err) {
            lastError = err;
        }

        for (const exact of (nextFacing === 'environment' ? ['environment', 'user'] : ['user', 'environment'])) {
            try {
                const track = await this._newVideoTrack(
                    this._videoConstraints({ facingMode: exact }),
                );
                return { track, deviceId: '', facingMode: exact };
            } catch (err) {
                lastError = err;
            }
        }

        if (lastError) throw lastError;
        return null;
    }

    async switchCamera() {
        const prepared = await this.prepareCameraSwitch();
        if (!prepared) return null;
        return this.commitPreparedVideoTrack(prepared.track, prepared);
    }

    release() {
        this._releaseStream();
        this._audioTrack = null;
        this._videoTrack = null;
        this._audioMuted = false;
        this._videoEnabled = false;
        this._audioDeviceId = '';
        this._videoDeviceId = '';
        this._videoFacingMode = 'user';
    }

    async _newAudioTrack(audioConstraints) {
        const newStream = await this._getUserMediaWithStoredDeviceFallback({
            audio: audioConstraints,
            video: false,
        }, { audio: true });
        const newTrack = newStream.getAudioTracks()[0] || null;
        newStream.getTracks().filter(t => t !== newTrack).forEach(t => t.stop());
        if (!newTrack) throw new Error('No replacement audio track');
        try { newTrack.contentHint = 'speech'; } catch (_) { /* optional browser hint */ }
        return newTrack;
    }

    async _newVideoTrack(videoConstraints) {
        const newStream = await this._getUserMediaWithStoredDeviceFallback({
            audio: false,
            video: videoConstraints,
        }, { video: true });
        const newTrack = newStream.getVideoTracks()[0] || null;
        newStream.getTracks().filter(t => t !== newTrack).forEach(t => t.stop());
        if (!newTrack) throw new Error('No replacement video track');
        try { newTrack.contentHint = 'motion'; } catch (_) { /* optional browser hint */ }
        return newTrack;
    }

    _handleLocalTrackEnded(track) {
        if (track.kind === 'audio' && track === this._audioTrack) {
            this._audioTrack = null;
            this._audioMuted = true;
            this._localStream?.removeTrack(track);
        } else if (track.kind === 'video' && track === this._videoTrack) {
            this._videoTrack = null;
            this._videoEnabled = false;
            this._localStream?.removeTrack(track);
        }
        this._trackHandlers.onEnded?.(track.kind, track);
    }

    _bindTrackLifecycle(track) {
        if (!track || this._boundTracks.has(track)) return;
        this._boundTracks.add(track);
        track.addEventListener('ended', () => this._handleLocalTrackEnded(track), { once: true });
        track.addEventListener('mute', () => this._trackHandlers.onMuted?.(track.kind, track));
        track.addEventListener('unmute', () => this._trackHandlers.onUnmuted?.(track.kind, track));
    }

    _ensureLocalStream() {
        if (!this._localStream) {
            this._localStream = new MediaStream();
        }
    }

    _releaseStream() {
        if (!this._localStream) return;
        this._localStream.getTracks().forEach(t => t.stop());
        this._localStream = null;
    }

    async _getUserMediaWithStoredDeviceFallback(constraints, { audio = false, video = false } = {}) {
        try {
            return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err) {
            if (!this._canRetryWithoutStoredDevice(err, constraints, { audio, video })) {
                throw err;
            }
            const retryConstraints = { ...constraints };
            if (audio && this._audioDeviceId && constraints.audio && typeof constraints.audio === 'object') {
                this._audioDeviceId = '';
                retryConstraints.audio = this._audioConstraints({ allowStoredDevice: false });
            }
            if (video && this._videoDeviceId && constraints.video && typeof constraints.video === 'object') {
                this._videoDeviceId = '';
                retryConstraints.video = this._videoConstraints({ allowStoredDevice: false });
            }
            return navigator.mediaDevices.getUserMedia(retryConstraints);
        }
    }

    _canRetryWithoutStoredDevice(error, constraints, { audio = false, video = false } = {}) {
        const name = String(error?.name || '');
        if (!['OverconstrainedError', 'ConstraintNotSatisfiedError', 'NotFoundError', 'DevicesNotFoundError'].includes(name)) {
            return false;
        }
        const audioUsesStoredDevice = Boolean(
            audio && this._audioDeviceId && constraints.audio?.deviceId?.exact === this._audioDeviceId,
        );
        const videoUsesStoredDevice = Boolean(
            video && this._videoDeviceId && constraints.video?.deviceId?.exact === this._videoDeviceId,
        );
        return audioUsesStoredDevice || videoUsesStoredDevice;
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

    _rememberAudioTrack(track) {
        if (!track) return;
        const settings = track.getSettings?.() || {};
        this._audioDeviceId = settings.deviceId || this._audioDeviceId || '';
    }

    _rememberVideoTrack(track, fallbackFacingMode = '') {
        if (!track) return;
        const settings = track.getSettings?.() || {};
        this._videoDeviceId = settings.deviceId || this._videoDeviceId || '';
        this._videoFacingMode = settings.facingMode || fallbackFacingMode || this._videoFacingMode || 'user';
    }

    _audioConstraints({ deviceId = '', allowStoredDevice = true } = {}) {
        const constraints = {
            echoCancellation: { ideal: true },
            noiseSuppression: { ideal: true },
            autoGainControl: { ideal: true },
            channelCount: { ideal: 1 },
        };
        if (deviceId) {
            constraints.deviceId = { exact: deviceId };
        } else if (allowStoredDevice && this._audioDeviceId) {
            constraints.deviceId = { exact: this._audioDeviceId };
        }
        return constraints;
    }

    _videoConstraints({ deviceId = '', facingMode = '', allowStoredDevice = true } = {}) {
        const constraints = {
            width: { ideal: 640 },
            height: { ideal: 360 },
            frameRate: { ideal: 15, max: 24 },
        };
        if (deviceId) {
            constraints.deviceId = { exact: deviceId };
        } else if (facingMode) {
            constraints.facingMode = { exact: facingMode };
        } else if (allowStoredDevice && this._videoDeviceId) {
            constraints.deviceId = { exact: this._videoDeviceId };
        } else {
            constraints.facingMode = { ideal: this._videoFacingMode || 'user' };
        }
        return constraints;
    }

    _fallbackDeviceLabel(kind, index) {
        if (kind === 'audioinput') return `\u041c\u0438\u043a\u0440\u043e\u0444\u043e\u043d ${index}`;
        if (kind === 'videoinput') return `\u041a\u0430\u043c\u0435\u0440\u0430 ${index}`;
        if (kind === 'audiooutput') return `\u0414\u0438\u043d\u0430\u043c\u0438\u043a ${index}`;
        return `\u0423\u0441\u0442\u0440\u043e\u0439\u0441\u0442\u0432\u043e ${index}`;
    }
}
