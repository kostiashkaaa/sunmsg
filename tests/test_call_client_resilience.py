from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_call_manager_guards_unstable_realtime_states() -> None:
    manager = (ROOT / 'static' / 'modules' / 'call-manager.js').read_text(encoding='utf-8')
    ui = (ROOT / 'static' / 'modules' / 'call-ui.js').read_text(encoding='utf-8')
    webrtc = (ROOT / 'static' / 'modules' / 'call-webrtc.js').read_text(encoding='utf-8')
    css = (ROOT / 'static' / 'calls.css').read_text(encoding='utf-8')
    handlers = (ROOT / 'app' / 'sockets' / 'call_handlers.py').read_text(encoding='utf-8')

    assert 'const SIGNAL_ACK_TIMEOUT_MS = 12_000;' in manager
    assert 'const ACCEPT_SYNC_GRACE_MS = 5_000;' in manager
    assert "this._emit('call_initiate', { chat_id: this._chatId, call_type: this._callType }, { requireConnected: true })" in manager
    assert "this._emit('call_accept', { call_id: callId, request_id: this._pendingAcceptRequestId }, { requireConnected: true })" in manager
    assert 'navigator.onLine === false' in manager
    assert 'setIncomingCallBannerStatus(\'Подключение...\')' in manager
    assert 'setIncomingCallBannerStatus(\'Ждём соединение...\')' in manager
    assert "setCallConnectionState('reconnecting')" in manager
    assert "setCallConnectionState('lost')" in manager
    assert "this._handleRecoverableDisconnect(state)" in manager
    assert 'this._partnerMediaState = {' in manager
    assert '_applyPartnerMediaState()' in manager
    assert '_partnerMediaStateFromActiveCall(activeCall)' in manager

    assert 'data-call-incoming-status' in ui
    assert "setIncomingBusy(true, 'Подключение...')" in ui
    assert 'acceptInProgress' in ui
    assert 'id="call-connectivity"' in ui
    assert 'export function setCallConnectionState' in ui
    assert 'initialLocalFacingMode' in ui
    assert '_localCameraX(facingMode)' in ui
    assert "String(facingMode || '').trim().toLowerCase() === 'user' ? -1 : 1" in ui

    assert '--call-local-camera-x' in css
    assert '--call-preview-camera-x' in css
    assert '.call-connectivity' in css
    assert '.call-overlay--connection-lost [data-call-status]' in css
    assert '@keyframes callConnectivityPulse' in css

    assert 'const SEND_QUALITY_DOWNGRADE_SAMPLES = 2;' in webrtc
    assert 'const SEND_QUALITY_UPGRADE_SAMPLES = 4;' in webrtc
    assert 'const requiredSamples = isDowngrade' in webrtc
    assert '_createMirroredVideoTrack(sourceTrack)' in webrtc
    assert 'canvas.captureStream(fps)' in webrtc
    assert 'ctx.scale(-1, 1)' in webrtc
    assert 'mirrorVideo: this._shouldMirrorOutgoingVideo()' in manager
    assert '_isMobileCallClient()' in manager
    assert "return mode === 'user';" in manager

    assert "'partner_media': _partner_media_state(conn, call_id, user_id)" in handlers
    assert "if status == 'active' else None" in handlers
    assert 'SELECT was_muted, had_video' in handlers


def test_call_ui_guards_async_overlay_lifecycle_completions() -> None:
    ui = (ROOT / 'static' / 'modules' / 'call-ui.js').read_text(encoding='utf-8')

    assert 'let preCallScreenLifecycleSeq = 0;' in ui
    assert 'let activeCallOverlayLifecycleSeq = 0;' in ui
    assert 'const isPreCallCurrent = () => _isPreCallScreenCurrent(overlay, preCallSeq);' in ui
    assert 'const isOverlayCurrent = () => _isActiveCallOverlayCurrent(overlay, overlaySeq);' in ui
    assert 'if (!isPreCallCurrent()) return;\n            if (prepared?.localStream)' in ui
    assert 'const result = await onToggleScreenShare?.();\n                if (!isOverlayCurrent()) return;' in ui
    assert 'const applied = await _setSpeakerMode(enabled, overlay, isOverlayCurrent);' in ui
    assert 'function _isRemoteTrackCurrent(media, track, seq, overlay)' in ui
    assert 'removeRemoteTrack(track.kind, track);' in ui
