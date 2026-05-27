from pathlib import Path
import subprocess


def _run_call_manager_harness(harness_body: str) -> subprocess.CompletedProcess[str]:
    module_path = Path(__file__).resolve().parents[1] / 'static' / 'modules' / 'call-manager.js'
    node_harness = """
import { readFile } from 'node:fs/promises';

let source = await readFile(%r, 'utf8');
source = source.replace(
  /import\\s*\\{\\s*CallMedia\\s*\\}\\s*from\\s*['"]\\.\\/call-media\\.js['"];\\s*/,
  `class CallMedia {
    constructor() {
      this.releaseCount = 0;
      this._audioTrack = null;
      this._videoTrack = null;
      this._localStream = { id: 'local-stream' };
      globalThis.__createdMedia.push(this);
    }
    setTrackLifecycleHandlers() {}
    getAudioTrack() { return this._audioTrack; }
    getVideoTrack() { return this._videoTrack; }
    getLocalStream() { return this._localStream; }
    getVideoFacingMode() { return 'user'; }
    isScreenSharing() { return false; }
    getVideoSource() { return 'camera'; }
    isVideoEnabled() { return false; }
    isAudioMuted() { return false; }
    setAudioMuted() {}
    toggleAudio() { return false; }
    toggleVideo() { return true; }
    getAudioDeviceId() { return ''; }
    getVideoDeviceId() { return ''; }
    async listDevices() { return { audioInputs: [], videoInputs: [], audioOutputs: [] }; }
    async acquireAudio() {
      globalThis.__acquireAudioCalls = (globalThis.__acquireAudioCalls || 0) + 1;
      await globalThis.__mediaGate.promise;
      this._audioTrack = { kind: 'audio', stop() {} };
      return this._localStream;
    }
    async acquireVideo() {
      globalThis.__acquireVideoCalls = (globalThis.__acquireVideoCalls || 0) + 1;
      if (globalThis.__failAcquireVideo) {
        const err = new Error('camera failed');
        err.name = 'NotReadableError';
        throw err;
      }
      return this.acquireAudio();
    }
    async prepareVideoInput(deviceId) {
      if (Array.isArray(globalThis.__preparedDeviceIds)) globalThis.__preparedDeviceIds.push(deviceId);
      await globalThis.__videoGate.promise;
      return { track: globalThis.__preparedVideoTrack, deviceId, facingMode: 'user', source: 'camera' };
    }
    async prepareCameraSwitch() { return this.prepareVideoInput('switch'); }
    async prepareDisplayMedia() { return this.prepareVideoInput('screen'); }
    commitPreparedVideoTrack(track) {
      this._videoTrack = track;
      globalThis.__committedTracks.push(track);
    }
    disableVideo() {}
    discardTrack(track) {
      if (track) globalThis.__discardedTracks.push(track);
      track?.stop?.();
    }
    release() {
      this.releaseCount += 1;
      this._audioTrack = null;
      this._videoTrack = null;
      globalThis.__releasedMedia.push(this);
    }
  }`
);
source = source.replace(
  /import\\s*\\{\\s*CallWebRTC\\s*\\}\\s*from\\s*['"]\\.\\/call-webrtc\\.js['"];\\s*/,
  `class CallWebRTC {
    constructor() { globalThis.__webrtcCreated += 1; }
    init() {}
    async addVideoTrack() { globalThis.__webrtcAddVideoTrack += 1; }
    async replaceVideoTrack() {}
    async replaceAudioTrack() {}
    setAudioEnabled() {}
    setVideoEnabled() {}
    updateIceServers() {}
    restartIce() { globalThis.__restartIceCalls = (globalThis.__restartIceCalls || 0) + 1; }
    getConnectionState() { return globalThis.__mockConnectionState || ''; }
    getIceConnectionState() { return globalThis.__mockIceConnectionState || ''; }
    close() {}
  }`
);
source = source.replace(
  /import\\s*\\{[\\s\\S]*?\\}\\s*from\\s*['"]\\.\\/call-ui\\.js['"];\\s*/,
  `const removePreCallScreen = () => {};
const showIncomingCallBanner = () => {};
const removeIncomingCallBanner = () => {};
const setIncomingCallBannerStatus = () => {};
const showActiveCallOverlay = (options) => {
  globalThis.__overlayShown += 1;
  globalThis.__lastOverlayOptions = options;
};
const removeActiveCallOverlay = () => {};
const setCallStatusText = (text) => { globalThis.__callStatusTexts?.push?.(text); };
const setCallConnectionState = (state) => { globalThis.__callConnectionStates?.push?.(state); };
const setCallVerificationCode = () => {};
const attachRemoteTrack = () => {};
const removeRemoteTrack = () => {};
const setRemoteVideoEnabled = () => {};
const setLocalVideoEnabled = () => {};
const setRemoteAudioMuted = () => {};
const startCallDurationTimer = () => {};
const setCallQualityIndicator = () => {};
const minimizeActiveCallOverlay = () => {};
const restoreActiveCallOverlay = () => {};
const setCallScreenShareActive = () => {};`
);
source = source.replace(
  /import\\s*\\{[\\s\\S]*?\\}\\s*from\\s*['"]\\.\\/call-sounds\\.js['"];\\s*/,
  `const startRingtone = () => {};
const stopRingtone = () => {};
const playConnectedSound = () => {};
const playEndCallSound = () => {};
const playBusyTone = () => {};`
);
source = source.replace(
  /import\\s*\\{\\s*showToast\\s*\\}\\s*from\\s*['"]\\.\\/dialogs\\.js['"];\\s*/,
  'const showToast = () => {};'
);

const moduleUrl = 'data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64');
const moduleApi = await import(moduleUrl);
""" % str(module_path)
    return subprocess.run(
        ['node', '--input-type=module', '-e', f'{node_harness}\n{harness_body}'],
        capture_output=True,
        text=True,
        check=False,
    )


def test_call_start_media_stops_after_cleanup_during_media_acquire():
    harness_body = """
globalThis.window = {
  addEventListener() {},
  location: { origin: 'https://example.test' },
};
globalThis.document = {
  addEventListener() {},
};
globalThis.navigator = { onLine: true };
globalThis.sessionStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};
globalThis.__createdMedia = [];
globalThis.__releasedMedia = [];
globalThis.__overlayShown = 0;
globalThis.__webrtcCreated = 0;
globalThis.__webrtcAddVideoTrack = 0;
globalThis.__committedTracks = [];
globalThis.__discardedTracks = [];

let resolveMedia;
globalThis.__mediaGate = new Promise((resolve) => {
  resolveMedia = resolve;
});
globalThis.__mediaGate.promise = globalThis.__mediaGate;

const socket = {
  connected: true,
  on() {},
  emit() {},
};
const manager = new moduleApi.CallManager({
  socket,
  getCsrfToken: () => 'csrf',
});

manager._state = 'active';
manager._callId = 'call-1';
manager._chatId = 'chat-1';
manager._callType = 'audio';
manager._iceServers = [{ urls: 'stun:example.test' }];
manager._iceServersExpiresAt = Date.now() + 10 * 60_000;
manager._pendingMediaOptions = { callType: 'audio', audioMuted: false, videoEnabled: false };

const startPromise = manager._startMedia(manager._pendingMediaOptions);
await Promise.resolve();
manager._cleanup();
resolveMedia();
await startPromise;

if (globalThis.__overlayShown !== 0) {
  throw new Error(`Stale media startup showed call overlay ${globalThis.__overlayShown} time(s)`);
}
if (globalThis.__webrtcCreated !== 0) {
  throw new Error(`Stale media startup created WebRTC ${globalThis.__webrtcCreated} time(s)`);
}
if (manager.getState() !== 'idle') {
  throw new Error(`Expected manager to remain idle, got ${manager.getState()}`);
}
const staleMedia = globalThis.__createdMedia[0];
if (!staleMedia || staleMedia.releaseCount < 1) {
  throw new Error('Expected stale media instance to be released');
}
"""
    result = _run_call_manager_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_call_overlay_media_action_ignores_stale_camera_result_after_cleanup():
    harness_body = """
globalThis.window = {
  addEventListener() {},
  location: { origin: 'https://example.test' },
};
globalThis.document = {
  addEventListener() {},
};
globalThis.navigator = { onLine: true };
globalThis.sessionStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};
globalThis.__createdMedia = [];
globalThis.__releasedMedia = [];
globalThis.__overlayShown = 0;
globalThis.__webrtcCreated = 0;
globalThis.__webrtcAddVideoTrack = 0;
globalThis.__committedTracks = [];
globalThis.__discardedTracks = [];
globalThis.__mediaGate = Promise.resolve();
globalThis.__mediaGate.promise = globalThis.__mediaGate;

let resolveVideo;
globalThis.__videoGate = new Promise((resolve) => {
  resolveVideo = resolve;
});
globalThis.__videoGate.promise = globalThis.__videoGate;
let stoppedPreparedTrack = false;
globalThis.__preparedVideoTrack = {
  kind: 'video',
  stop() { stoppedPreparedTrack = true; },
};

const socket = {
  connected: true,
  on() {},
  emit() {},
};
const manager = new moduleApi.CallManager({
  socket,
  getCsrfToken: () => 'csrf',
});

manager._state = 'active';
manager._callId = 'call-2';
manager._chatId = 'chat-2';
manager._callType = 'audio';
manager._iceServers = [{ urls: 'stun:example.test' }];
manager._iceServersExpiresAt = Date.now() + 10 * 60_000;
manager._pendingMediaOptions = { callType: 'audio', audioMuted: false, videoEnabled: false };

await manager._startMedia(manager._pendingMediaOptions);
if (!globalThis.__lastOverlayOptions?.onSelectCamera) {
  throw new Error('Expected active call overlay camera selector');
}

const selectPromise = globalThis.__lastOverlayOptions.onSelectCamera('camera-2');
await Promise.resolve();
await Promise.resolve();
manager._cleanup();
resolveVideo();
const result = await selectPromise;

if (globalThis.__webrtcAddVideoTrack !== 0) {
  throw new Error(`Stale camera selection touched WebRTC ${globalThis.__webrtcAddVideoTrack} time(s)`);
}
if (globalThis.__committedTracks.length !== 0) {
  throw new Error(`Stale camera selection committed ${globalThis.__committedTracks.length} track(s)`);
}
if (!globalThis.__discardedTracks.includes(globalThis.__preparedVideoTrack) || !stoppedPreparedTrack) {
  throw new Error('Expected stale prepared camera track to be discarded');
}
if (result.localStream !== null || result.facingMode !== '') {
  throw new Error('Expected stale camera selection to return an inert result');
}
if (manager.getState() !== 'idle') {
  throw new Error(`Expected manager to remain idle, got ${manager.getState()}`);
}
"""
    result = _run_call_manager_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_video_call_start_falls_back_to_audio_when_camera_fails():
    harness_body = """
globalThis.window = {
  addEventListener() {},
  location: { origin: 'https://example.test' },
};
globalThis.document = {
  addEventListener() {},
};
globalThis.navigator = { onLine: true };
globalThis.sessionStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};
globalThis.__createdMedia = [];
globalThis.__releasedMedia = [];
globalThis.__overlayShown = 0;
globalThis.__webrtcCreated = 0;
globalThis.__webrtcAddVideoTrack = 0;
globalThis.__committedTracks = [];
globalThis.__discardedTracks = [];
globalThis.__acquireAudioCalls = 0;
globalThis.__acquireVideoCalls = 0;
globalThis.__failAcquireVideo = true;
globalThis.__mediaGate = Promise.resolve();
globalThis.__mediaGate.promise = globalThis.__mediaGate;
globalThis.__videoGate = Promise.resolve();
globalThis.__videoGate.promise = globalThis.__videoGate;

const socket = {
  connected: true,
  on() {},
  emit() {},
};
const manager = new moduleApi.CallManager({
  socket,
  getCsrfToken: () => 'csrf',
});

manager._state = 'active';
manager._callId = 'call-video-fallback';
manager._chatId = 'chat-video-fallback';
manager._callType = 'video';
const normalized = await manager._ensureLocalMediaForOptions({
  callType: 'video',
  audioMuted: false,
  videoEnabled: true,
}, manager._media);

if (globalThis.__acquireVideoCalls !== 1) {
  throw new Error(`Expected one video acquire attempt, got ${globalThis.__acquireVideoCalls}`);
}
if (globalThis.__acquireAudioCalls !== 1) {
  throw new Error(`Expected audio fallback, got ${globalThis.__acquireAudioCalls}`);
}
if (normalized.videoEnabled !== false) {
  throw new Error('Expected video to be disabled after camera fallback');
}
if (!manager._media.getAudioTrack()) {
  throw new Error('Expected audio track to remain active');
}
if (manager.getState() !== 'active') {
  throw new Error(`Expected call to remain active, got ${manager.getState()}`);
}
"""
    result = _run_call_manager_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_active_call_camera_operations_are_serialized():
    harness_body = """
globalThis.window = {
  addEventListener() {},
  location: { origin: 'https://example.test' },
};
globalThis.document = {
  addEventListener() {},
};
globalThis.navigator = { onLine: true };
globalThis.sessionStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};
globalThis.__createdMedia = [];
globalThis.__releasedMedia = [];
globalThis.__overlayShown = 0;
globalThis.__webrtcCreated = 0;
globalThis.__webrtcAddVideoTrack = 0;
globalThis.__committedTracks = [];
globalThis.__discardedTracks = [];
globalThis.__preparedDeviceIds = [];
globalThis.__mediaGate = Promise.resolve();
globalThis.__mediaGate.promise = globalThis.__mediaGate;

let resolveVideo;
globalThis.__videoGate = new Promise((resolve) => {
  resolveVideo = resolve;
});
globalThis.__videoGate.promise = globalThis.__videoGate;
globalThis.__preparedVideoTrack = {
  kind: 'video',
  readyState: 'live',
  stop() {},
};

const socket = {
  connected: true,
  on() {},
  emit() {},
};
const manager = new moduleApi.CallManager({
  socket,
  getCsrfToken: () => 'csrf',
});

manager._state = 'active';
manager._callId = 'call-serialized-camera';
manager._chatId = 'chat-serialized-camera';
manager._callType = 'audio';
manager._iceServers = [{ urls: 'stun:example.test' }];
manager._iceServersExpiresAt = Date.now() + 10 * 60_000;
manager._pendingMediaOptions = { callType: 'audio', audioMuted: false, videoEnabled: false };

await manager._startMedia(manager._pendingMediaOptions);
const selectCamera = globalThis.__lastOverlayOptions?.onSelectCamera;
if (!selectCamera) throw new Error('Expected active call overlay camera selector');

const first = selectCamera('camera-1');
await Promise.resolve();
const second = selectCamera('camera-2');
await Promise.resolve();

if (globalThis.__preparedDeviceIds.join(',') !== 'camera-1') {
  throw new Error(`Expected second camera operation to wait, got ${globalThis.__preparedDeviceIds.join(',')}`);
}

resolveVideo();
await first;
await second;

if (globalThis.__preparedDeviceIds.join(',') !== 'camera-1,camera-2') {
  throw new Error(`Expected serialized camera operations, got ${globalThis.__preparedDeviceIds.join(',')}`);
}
if (globalThis.__committedTracks.length !== 2) {
  throw new Error(`Expected both serialized camera selections to commit, got ${globalThis.__committedTracks.length}`);
}
"""
    result = _run_call_manager_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_recoverable_disconnect_retries_ice_and_clears_retry_timers_on_connect():
    harness_body = """
globalThis.window = {
  addEventListener() {},
  location: { origin: 'https://example.test' },
};
globalThis.document = {
  addEventListener() {},
};
globalThis.navigator = { onLine: true };
globalThis.sessionStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};
globalThis.__createdMedia = [];
globalThis.__releasedMedia = [];
globalThis.__overlayShown = 0;
globalThis.__webrtcCreated = 0;
globalThis.__webrtcAddVideoTrack = 0;
globalThis.__committedTracks = [];
globalThis.__discardedTracks = [];
globalThis.__restartIceCalls = 0;
globalThis.fetch = async () => { throw new Error('offline'); };
globalThis.__mediaGate = Promise.resolve();
globalThis.__mediaGate.promise = globalThis.__mediaGate;
globalThis.__videoGate = Promise.resolve();
globalThis.__videoGate.promise = globalThis.__videoGate;

const socket = {
  connected: true,
  on() {},
  emit() {},
};
const manager = new moduleApi.CallManager({
  socket,
  getCsrfToken: () => 'csrf',
});

manager._state = 'active';
manager._callId = 'call-ice-retry';
manager._chatId = 'chat-ice-retry';
manager._callType = 'audio';
manager._webrtc = {
  updateIceServers() {},
  restartIce() { globalThis.__restartIceCalls += 1; },
};

manager._handleRecoverableDisconnect('disconnected');
await new Promise((resolve) => setTimeout(resolve, 0));
await Promise.resolve();
await Promise.resolve();

if (globalThis.__restartIceCalls < 1) {
  throw new Error('Expected immediate ICE restart retry');
}
if (manager._iceRestartRetryTimeouts.length < 1) {
  throw new Error('Expected pending ICE retry timers after disconnect');
}

manager._onConnectionState('connected');

if (manager._iceRestartRetryTimeouts.length !== 0) {
  throw new Error('Expected ICE retry timers to be cleared on reconnect');
}
"""
    result = _run_call_manager_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_active_call_socket_reconnect_restarts_ice_after_sync_confirms_call():
    harness_body = """
globalThis.window = {
  addEventListener() {},
  location: { origin: 'https://example.test' },
};
globalThis.document = {
  addEventListener() {},
};
globalThis.navigator = { onLine: true };
globalThis.sessionStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};
globalThis.__createdMedia = [];
globalThis.__releasedMedia = [];
globalThis.__overlayShown = 0;
globalThis.__webrtcCreated = 0;
globalThis.__webrtcAddVideoTrack = 0;
globalThis.__committedTracks = [];
globalThis.__discardedTracks = [];
globalThis.__restartIceCalls = 0;
globalThis.fetch = async () => { throw new Error('offline'); };
globalThis.__mediaGate = Promise.resolve();
globalThis.__mediaGate.promise = globalThis.__mediaGate;
globalThis.__videoGate = Promise.resolve();
globalThis.__videoGate.promise = globalThis.__videoGate;

const socket = {
  connected: true,
  on() {},
  emit() {},
};
const manager = new moduleApi.CallManager({
  socket,
  getCsrfToken: () => 'csrf',
});

manager._state = 'active';
manager._callId = 'call-network-switch';
manager._chatId = 'chat-network-switch';
manager._callType = 'audio';
manager._webrtc = {
  updateIceServers() {},
  restartIce() { globalThis.__restartIceCalls += 1; },
};

manager._onSocketDisconnected();
if (!manager._socketReconnectNeedsIceRestart) {
  throw new Error('Expected socket reconnect ICE restart flag after active disconnect');
}
if (globalThis.__restartIceCalls !== 0) {
  throw new Error('Expected no ICE restart until server sync confirms the active call');
}

await manager._onCallSync({
  active_call: {
    call_id: 'call-network-switch',
    chat_id: 'chat-network-switch',
    status: 'active',
    call_type: 'audio',
    role: 'initiator',
  },
});
await new Promise((resolve) => setTimeout(resolve, 0));
await Promise.resolve();
await Promise.resolve();

if (manager._socketReconnectNeedsIceRestart) {
  throw new Error('Expected socket reconnect ICE restart flag to clear after sync');
}
if (globalThis.__restartIceCalls < 1) {
  throw new Error('Expected ICE restart after active call sync confirmed reconnect');
}
manager._onConnectionState('connected');
"""
    result = _run_call_manager_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout


def test_active_call_socket_reconnect_clears_reconnecting_when_peer_already_connected():
    harness_body = """
globalThis.window = {
  addEventListener() {},
  location: { origin: 'https://example.test' },
};
globalThis.document = {
  addEventListener() {},
};
globalThis.navigator = { onLine: true };
globalThis.sessionStorage = {
  getItem() { return null; },
  setItem() {},
  removeItem() {},
};
globalThis.__createdMedia = [];
globalThis.__releasedMedia = [];
globalThis.__overlayShown = 0;
globalThis.__webrtcCreated = 0;
globalThis.__webrtcAddVideoTrack = 0;
globalThis.__committedTracks = [];
globalThis.__discardedTracks = [];
globalThis.__restartIceCalls = 0;
globalThis.__callConnectionStates = [];
globalThis.__callStatusTexts = [];
globalThis.fetch = async () => { throw new Error('offline'); };
globalThis.__mediaGate = Promise.resolve();
globalThis.__mediaGate.promise = globalThis.__mediaGate;
globalThis.__videoGate = Promise.resolve();
globalThis.__videoGate.promise = globalThis.__videoGate;

const socket = {
  connected: true,
  on() {},
  emit() {},
};
const manager = new moduleApi.CallManager({
  socket,
  getCsrfToken: () => 'csrf',
});

manager._state = 'active';
manager._callId = 'call-network-switch';
manager._chatId = 'chat-network-switch';
manager._callType = 'audio';
manager._webrtc = {
  updateIceServers() {},
  restartIce() { globalThis.__restartIceCalls += 1; },
  getConnectionState() { return 'connected'; },
  getIceConnectionState() { return 'completed'; },
};

manager._onSocketDisconnected();
if (!manager._socketReconnectNeedsIceRestart) {
  throw new Error('Expected socket reconnect ICE restart flag after active disconnect');
}

await manager._onCallSync({
  active_call: {
    call_id: 'call-network-switch',
    chat_id: 'chat-network-switch',
    status: 'active',
    call_type: 'audio',
    role: 'initiator',
  },
});

if (manager._socketReconnectNeedsIceRestart) {
  throw new Error('Expected socket reconnect ICE restart flag to clear after sync');
}
if (globalThis.__restartIceCalls !== 0) {
  throw new Error('Expected no ICE restart when peer connection is already recovered');
}
if (globalThis.__callConnectionStates.at(-1) !== 'connected') {
  throw new Error('Expected reconnecting banner to clear after recovered sync');
}
if (globalThis.__callStatusTexts.at(-1) !== 'Соединено') {
  throw new Error('Expected connected status text after recovered sync');
}
"""
    result = _run_call_manager_harness(harness_body)
    assert result.returncode == 0, result.stderr or result.stdout
