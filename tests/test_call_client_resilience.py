from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def test_call_manager_guards_unstable_realtime_states() -> None:
    manager = (ROOT / 'static' / 'modules' / 'call-manager.js').read_text(encoding='utf-8')
    ui = (ROOT / 'static' / 'modules' / 'call-ui.js').read_text(encoding='utf-8')

    assert 'const SIGNAL_ACK_TIMEOUT_MS = 12_000;' in manager
    assert 'const ACCEPT_SYNC_GRACE_MS = 5_000;' in manager
    assert "this._emit('call_initiate', { chat_id: this._chatId, call_type: this._callType }, { requireConnected: true })" in manager
    assert "this._emit('call_accept', { call_id: callId, request_id: this._pendingAcceptRequestId }, { requireConnected: true })" in manager
    assert 'navigator.onLine === false' in manager
    assert 'setIncomingCallBannerStatus(\'Подключение...\')' in manager
    assert 'setIncomingCallBannerStatus(\'Ждём соединение...\')' in manager

    assert 'data-call-incoming-status' in ui
    assert "setIncomingBusy(true, 'Подключение...')" in ui
    assert 'acceptInProgress' in ui
