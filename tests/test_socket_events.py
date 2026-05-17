import base64
import json
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app import create_app
from app.extensions import socketio
from app.sockets import events as socket_events
from app.sockets.events import calls as call_events
from app.services import presence
from app.services.blocking import BLOCK_ERROR_CODE
from app.services.crypto import generate_chat_id
from flask import session
from flask_wtf.csrf import generate_csrf
from wtforms.validators import ValidationError
from app.db_backend import DatabaseError
from tests._pg_test_db import connect_test_db

_E2EE_CIPHERTEXT = base64.b64encode(b'c' * 32).decode('ascii')
_E2EE_IV = base64.b64encode(b'i' * 12).decode('ascii')
_E2EE_KEY = base64.b64encode(b'k' * 256).decode('ascii')
_E2EE_SIGNATURE = base64.b64encode(b's' * 256).decode('ascii')
E2EE_DIRECT_MESSAGE = json.dumps({
    'encrypted_message': _E2EE_CIPHERTEXT,
    'encrypted_key_receiver': _E2EE_KEY,
    'encrypted_key_sender': _E2EE_KEY,
    'iv': _E2EE_IV,
    'signature': _E2EE_SIGNATURE,
})


class _ConnectionHandle:
    def __init__(self, db_path: Path):
        self._conn = connect_test_db(db_path)

    def __enter__(self):
        return self._conn

    def __exit__(self, exc_type, exc, tb):
        self._conn.close()
        return False

    def close(self):
        return self._conn.close()

    def __getattr__(self, name):
        return getattr(self._conn, name)


def _connect(db_path: Path) -> _ConnectionHandle:
    return _ConnectionHandle(db_path)


def _extract_csrf_token(html: str) -> str:
    match = re.search(r'<meta name="csrf-token" content="([^"]+)"', html)
    assert match is not None
    return match.group(1)


def _prepare_http_client(app, user_id: int, public_key: str):
    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = user_id
        sess['public_key_pem'] = public_key

    response = client.get('/chat')
    assert response.status_code == 200
    csrf_token = _extract_csrf_token(response.get_data(as_text=True))
    return client, csrf_token


def _socket_client(app, flask_client, csrf_token: str):
    return socketio.test_client(
        app,
        flask_test_client=flask_client,
        auth={'csrf_token': csrf_token},
    )


def _event_payloads(client, name: str):
    payloads = []
    for event in client.get_received():
        if event['name'] != name:
            continue
        args = event.get('args') or []
        payloads.append(args[0] if args else None)
    return payloads


def _payloads_from_events(events, name: str):
    payloads = []
    for event in events:
        if event['name'] != name:
            continue
        args = event.get('args') or []
        payloads.append(args[0] if args else None)
    return payloads


def _wait_for_events(client, expected_names, timeout: float = 0.5):
    deadline = time.time() + timeout
    names_left = set(expected_names)
    collected = []
    while time.time() < deadline:
        events = client.get_received()
        if events:
            collected.extend(events)
            names_left -= {event['name'] for event in events}
            if not names_left:
                return collected
        time.sleep(0.01)
    return collected


def _wait_for_event_payloads(client, name: str, timeout: float = 0.5):
    return _payloads_from_events(_wait_for_events(client, {name}, timeout=timeout), name)


@pytest.fixture(autouse=True)
def _reset_presence_state():
    presence._connected.clear()
    presence._active.clear()
    socket_events._clear_socket_connect_rate_state()
    if socketio.server is not None:
        socketio.server.environ.clear()
        socketio.server.manager.rooms.clear()
        socketio.server.manager.eio_to_sid.clear()
        socketio.server.manager.callbacks.clear()
        socketio.server.manager.pending_disconnect.clear()
    yield
    presence._connected.clear()
    presence._active.clear()
    socket_events._clear_socket_connect_rate_state()
    if socketio.server is not None:
        socketio.server.environ.clear()
        socketio.server.manager.rooms.clear()
        socketio.server.manager.eio_to_sid.clear()
        socketio.server.manager.callbacks.clear()
        socketio.server.manager.pending_disconnect.clear()


def _seed_dialog(db_path: Path):
    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (2, 'pk-2', 'bob', 'Bob')
            '''
        )
        chat_id = generate_chat_id('pk-1', 'pk-2')
        conn.execute(
            '''
            INSERT INTO chats (chat_id, chat_name)
            VALUES (?, 'Seeded chat')
            ''',
            (chat_id,),
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, ?), (2, 1, ?)
            ''',
            (chat_id, chat_id),
        )
        conn.execute(
            '''
            INSERT INTO call_feature_allowlist (user_id, granted_by_user_id, note)
            VALUES (1, 1, 'socket-test'), (2, 1, 'socket-test')
            ON CONFLICT(user_id) DO NOTHING
            '''
        )
        conn.commit()
    return chat_id


def test_call_lifecycle_and_webrtc_signal_reach_peer_user_room(monkeypatch, tmp_path):
    db_path = tmp_path / 'socket-call-signalling.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    chat_id = _seed_dialog(db_path)

    alice_http, alice_csrf = _prepare_http_client(app, 1, 'pk-1')
    bob_http, bob_csrf = _prepare_http_client(app, 2, 'pk-2')
    alice_socket = _socket_client(app, alice_http, alice_csrf)
    bob_socket = _socket_client(app, bob_http, bob_csrf)

    try:
        assert alice_socket.is_connected()
        assert bob_socket.is_connected()
        alice_socket.get_received()
        bob_socket.get_received()

        alice_socket.emit(
            'call_initiate',
            {'chat_id': chat_id, 'call_type': 'audio', 'csrf_token': alice_csrf},
        )

        initiated = _wait_for_event_payloads(alice_socket, 'call_initiated')
        incoming = _wait_for_event_payloads(bob_socket, 'call_incoming')
        assert len(initiated) == 1
        assert len(incoming) == 1
        call_id = initiated[0]['call_id']
        assert incoming[0]['call_id'] == call_id

        bob_socket.emit('call_accept', {'call_id': call_id, 'csrf_token': bob_csrf})
        accepted = _wait_for_event_payloads(alice_socket, 'call_accepted')
        assert any(payload['call_id'] == call_id and payload['user_id'] == 2 for payload in accepted)

        offer_sdp = {'type': 'offer', 'sdp': 'v=0\r\n'}
        alice_socket.emit(
            'call_offer',
            {'call_id': call_id, 'sdp': offer_sdp, 'csrf_token': alice_csrf},
        )
        relayed_offers = _wait_for_event_payloads(bob_socket, 'call_offer')
        relayed_offer = next(
            payload for payload in relayed_offers
            if payload['call_id'] == call_id
            and payload['from_user_id'] == 1
            and payload['sdp'] == offer_sdp
        )
        assert relayed_offer['call_id'] == call_id
        assert 'csrf_token' not in relayed_offer
        assert '_csrf_token' not in relayed_offer

        bob_socket.emit('call_reject', {'call_id': call_id, 'csrf_token': bob_csrf})
        rejected_after_accept = _wait_for_event_payloads(alice_socket, 'call_rejected', timeout=0.1)
        assert rejected_after_accept == []
        with _connect(db_path) as conn:
            row = conn.execute(
                'SELECT status FROM call_sessions WHERE call_id = ?',
                (call_id,),
            ).fetchone()
        assert row['status'] == 'active'
    finally:
        if alice_socket.is_connected():
            alice_socket.disconnect()
        if bob_socket.is_connected():
            bob_socket.disconnect()


def test_stale_ringing_call_is_missed_before_new_call(monkeypatch, tmp_path):
    db_path = tmp_path / 'socket-call-stale.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    chat_id = _seed_dialog(db_path)
    old_started_at = (datetime.now(timezone.utc) - timedelta(seconds=120)).strftime('%Y-%m-%d %H:%M:%S')

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO call_sessions (call_id, chat_id, initiator_id, call_type, status, started_at)
            VALUES ('stale-call', ?, 1, 'audio', 'ringing', ?)
            ''',
            (chat_id, old_started_at),
        )
        conn.execute(
            '''
            INSERT INTO call_participants (call_id, user_id, joined_at)
            VALUES ('stale-call', 1, ?)
            ''',
            (old_started_at,),
        )
        conn.commit()

    alice_http, alice_csrf = _prepare_http_client(app, 1, 'pk-1')
    alice_socket = _socket_client(app, alice_http, alice_csrf)

    try:
        assert alice_socket.is_connected()
        alice_socket.get_received()
        alice_socket.emit(
            'call_initiate',
            {'chat_id': chat_id, 'call_type': 'audio', 'csrf_token': alice_csrf},
        )

        initiated = _wait_for_event_payloads(alice_socket, 'call_initiated')
        assert len(initiated) == 1
        new_call_id = initiated[0]['call_id']
        assert new_call_id != 'stale-call'

        with _connect(db_path) as conn:
            stale = conn.execute(
                'SELECT status FROM call_sessions WHERE call_id = ?',
                ('stale-call',),
            ).fetchone()
            fresh = conn.execute(
                'SELECT status FROM call_sessions WHERE call_id = ?',
                (new_call_id,),
            ).fetchone()
            call_message = conn.execute(
                '''
                SELECT message, message_type FROM messages
                WHERE chat_id = ? AND message_type = 'call'
                ORDER BY id DESC
                LIMIT 1
                ''',
                (chat_id,),
            ).fetchone()
        assert stale['status'] == 'missed'
        assert fresh['status'] == 'ringing'
        assert call_message['message_type'] == 'call'
        call_payload = json.loads(call_message['message'])
        assert call_payload['__suncall'] is True
        assert call_payload['call_id'] == 'stale-call'
        assert call_payload['status'] == 'missed'
    finally:
        if alice_socket.is_connected():
            alice_socket.disconnect()


def test_incoming_call_sends_push_when_receiver_has_no_active_tab(monkeypatch, tmp_path):
    db_path = tmp_path / 'socket-call-push.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    chat_id = _seed_dialog(db_path)
    push_calls = []

    monkeypatch.setattr(call_events, 'count_active', lambda _public_key: 0)
    monkeypatch.setattr(call_events, 'send_call_incoming_push', lambda **kwargs: push_calls.append(kwargs))

    alice_http, alice_csrf = _prepare_http_client(app, 1, 'pk-1')
    alice_socket = _socket_client(app, alice_http, alice_csrf)

    try:
        alice_socket.get_received()
        alice_socket.emit(
            'call_initiate',
            {'chat_id': chat_id, 'call_type': 'video', 'csrf_token': alice_csrf},
        )
        call_id = _wait_for_event_payloads(alice_socket, 'call_initiated')[0]['call_id']

        assert push_calls == [{
            'receiver_user_id': 2,
            'initiator_user_id': 1,
            'initiator_display_name': 'Alice',
            'initiator_username': 'alice',
            'chat_id': chat_id,
            'call_id': call_id,
            'call_type': 'video',
        }]
    finally:
        if alice_socket.is_connected():
            alice_socket.disconnect()


def test_ended_call_creates_chat_call_message(monkeypatch, tmp_path):
    db_path = tmp_path / 'socket-call-log.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    chat_id = _seed_dialog(db_path)

    alice_http, alice_csrf = _prepare_http_client(app, 1, 'pk-1')
    bob_http, bob_csrf = _prepare_http_client(app, 2, 'pk-2')
    alice_socket = _socket_client(app, alice_http, alice_csrf)
    bob_socket = _socket_client(app, bob_http, bob_csrf)

    try:
        assert alice_socket.is_connected()
        assert bob_socket.is_connected()
        alice_socket.get_received()
        bob_socket.get_received()

        alice_socket.emit(
            'call_initiate',
            {'chat_id': chat_id, 'call_type': 'audio', 'csrf_token': alice_csrf},
        )
        call_id = _wait_for_event_payloads(alice_socket, 'call_initiated')[0]['call_id']
        _wait_for_event_payloads(bob_socket, 'call_incoming')

        bob_socket.emit('call_accept', {'call_id': call_id, 'csrf_token': bob_csrf})
        assert _wait_for_event_payloads(alice_socket, 'call_accepted')
        alice_socket.get_received()
        bob_socket.get_received()

        bob_socket.emit('call_sync', {'csrf_token': bob_csrf})
        sync_payload = _wait_for_event_payloads(bob_socket, 'call_sync')[0]
        assert sync_payload['active_call']['call_id'] == call_id
        assert sync_payload['active_call']['status'] == 'active'
        assert sync_payload['active_call']['role'] == 'callee'

        bob_socket.emit('call_end', {'call_id': call_id, 'csrf_token': bob_csrf})
        alice_messages = _wait_for_event_payloads(alice_socket, 'receive_message')
        bob_messages = _wait_for_event_payloads(bob_socket, 'receive_message')
        alice_call_message = next(payload for payload in alice_messages if payload.get('message_type') == 'call')
        bob_call_message = next(payload for payload in bob_messages if payload.get('message_type') == 'call')

        assert alice_call_message['id'] == bob_call_message['id']
        assert alice_call_message['chat_id'] == chat_id
        assert alice_call_message['sender_user_id'] == 1
        payload = json.loads(alice_call_message['message'])
        assert payload['__suncall'] is True
        assert payload['call_id'] == call_id
        assert payload['status'] == 'ended'
        assert payload['duration_sec'] >= 0

        with _connect(db_path) as conn:
            row = conn.execute(
                'SELECT message_type, sender_id, receiver_id FROM messages WHERE id = ?',
                (alice_call_message['id'],),
            ).fetchone()
        assert row['message_type'] == 'call'
        assert int(row['sender_id']) == 1
        assert int(row['receiver_id']) == 2

        alice_socket.get_received()
        alice_socket.emit('call_sync', {'csrf_token': alice_csrf})
        assert _wait_for_event_payloads(alice_socket, 'call_sync')[0]['active_call'] is None
    finally:
        if alice_socket.is_connected():
            alice_socket.disconnect()
        if bob_socket.is_connected():
            bob_socket.disconnect()


def test_non_participant_cannot_control_active_call(monkeypatch, tmp_path):
    db_path = tmp_path / 'socket-call-authz.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    chat_id = _seed_dialog(db_path)
    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (3, 'pk-3', 'mallory', 'Mallory')
            '''
        )
        conn.commit()

    alice_http, alice_csrf = _prepare_http_client(app, 1, 'pk-1')
    bob_http, bob_csrf = _prepare_http_client(app, 2, 'pk-2')
    mallory_http, mallory_csrf = _prepare_http_client(app, 3, 'pk-3')
    alice_socket = _socket_client(app, alice_http, alice_csrf)
    bob_socket = _socket_client(app, bob_http, bob_csrf)
    mallory_socket = _socket_client(app, mallory_http, mallory_csrf)

    try:
        assert alice_socket.is_connected()
        assert bob_socket.is_connected()
        assert mallory_socket.is_connected()
        alice_socket.get_received()
        bob_socket.get_received()
        mallory_socket.get_received()

        alice_socket.emit(
            'call_initiate',
            {'chat_id': chat_id, 'call_type': 'audio', 'csrf_token': alice_csrf},
        )
        call_id = _wait_for_event_payloads(alice_socket, 'call_initiated')[0]['call_id']
        _wait_for_event_payloads(bob_socket, 'call_incoming')
        bob_socket.emit('call_accept', {'call_id': call_id, 'csrf_token': bob_csrf})
        assert _wait_for_event_payloads(alice_socket, 'call_accepted')

        mallory_socket.emit('call_end', {'call_id': call_id, 'csrf_token': mallory_csrf})
        mallory_socket.emit(
            'call_media_state',
            {'call_id': call_id, 'audio_muted': True, 'video_enabled': False, 'csrf_token': mallory_csrf},
        )
        mallory_socket.emit(
            'call_offer',
            {'call_id': call_id, 'sdp': {'type': 'offer', 'sdp': 'v=0\r\n'}, 'csrf_token': mallory_csrf},
        )

        assert _wait_for_event_payloads(alice_socket, 'call_ended', timeout=0.1) == []
        assert _wait_for_event_payloads(bob_socket, 'call_media_state', timeout=0.1) == []
        assert _wait_for_event_payloads(bob_socket, 'call_offer', timeout=0.1) == []
        with _connect(db_path) as conn:
            row = conn.execute(
                'SELECT status FROM call_sessions WHERE call_id = ?',
                (call_id,),
            ).fetchone()
        assert row['status'] == 'active'
    finally:
        if alice_socket.is_connected():
            alice_socket.disconnect()
        if bob_socket.is_connected():
            bob_socket.disconnect()
        if mallory_socket.is_connected():
            mallory_socket.disconnect()


def test_late_initiator_cancel_after_accept_ends_active_call(monkeypatch, tmp_path):
    db_path = tmp_path / 'socket-call-late-cancel.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    chat_id = _seed_dialog(db_path)

    alice_http, alice_csrf = _prepare_http_client(app, 1, 'pk-1')
    bob_http, bob_csrf = _prepare_http_client(app, 2, 'pk-2')
    alice_socket = _socket_client(app, alice_http, alice_csrf)
    bob_socket = _socket_client(app, bob_http, bob_csrf)

    try:
        alice_socket.get_received()
        bob_socket.get_received()

        alice_socket.emit(
            'call_initiate',
            {'chat_id': chat_id, 'call_type': 'audio', 'csrf_token': alice_csrf},
        )
        call_id = _wait_for_event_payloads(alice_socket, 'call_initiated')[0]['call_id']
        _wait_for_event_payloads(bob_socket, 'call_incoming')
        bob_socket.emit('call_accept', {'call_id': call_id, 'csrf_token': bob_csrf})
        assert _wait_for_event_payloads(alice_socket, 'call_accepted')
        alice_socket.get_received()
        bob_socket.get_received()

        alice_socket.emit('call_cancel', {'call_id': call_id, 'csrf_token': alice_csrf})

        ended = _wait_for_event_payloads(bob_socket, 'call_ended')
        assert any(payload['call_id'] == call_id and payload['ended_by'] == 1 for payload in ended)
        with _connect(db_path) as conn:
            row = conn.execute(
                'SELECT status, duration_sec FROM call_sessions WHERE call_id = ?',
                (call_id,),
            ).fetchone()
        assert row['status'] == 'ended'
        assert row['duration_sec'] is not None
    finally:
        if alice_socket.is_connected():
            alice_socket.disconnect()
        if bob_socket.is_connected():
            bob_socket.disconnect()


def test_socket_realtime_flow_covers_delivery_status_send_and_block(monkeypatch, tmp_path):
    db_path = tmp_path / 'socket-realtime-flow.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    chat_id = _seed_dialog(db_path)

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO messages (chat_id, sender_id, receiver_id, message, is_delivered)
            VALUES (?, 1, 2, 'queued', 0)
            ''',
            (chat_id,),
        )
        conn.commit()

    alice_http, alice_csrf = _prepare_http_client(app, 1, 'pk-1')
    bob_http, bob_csrf = _prepare_http_client(app, 2, 'pk-2')
    alice_socket = _socket_client(app, alice_http, alice_csrf)
    bob_socket = None

    try:
        assert alice_socket.is_connected()

        bob_socket = _socket_client(app, bob_http, bob_csrf)
        assert bob_socket.is_connected()

        connect_events = _wait_for_events(alice_socket, {'messages_delivered'})
        delivered_payloads = _payloads_from_events(connect_events, 'messages_delivered')
        assert len(delivered_payloads) == 1
        assert delivered_payloads[0]['chat_id'] == chat_id
        assert len(delivered_payloads[0]['message_ids']) == 1

        bob_socket.emit('activity_update', {'active': True, 'csrf_token': bob_csrf})
        alice_status_payloads = _wait_for_event_payloads(alice_socket, 'user_status')
        assert any(payload['public_key'] == 'pk-2' and payload['online'] is True for payload in alice_status_payloads)

        alice_socket.emit('join', {'chat_id': chat_id, 'csrf_token': alice_csrf})
        bob_socket.emit('join', {'chat_id': chat_id, 'csrf_token': bob_csrf})
        assert _event_payloads(alice_socket, 'error') == []
        assert _event_payloads(bob_socket, 'error') == []

        alice_socket.emit('typing', {'chat_id': chat_id, 'csrf_token': alice_csrf})
        bob_typing_payloads = _wait_for_event_payloads(bob_socket, 'partner_typing')
        assert any(payload['chat_id'] == chat_id for payload in bob_typing_payloads)

        message_text = E2EE_DIRECT_MESSAGE
        alice_socket.emit(
            'send_message',
            {
                'chat_id': chat_id,
                'message': message_text,
                'client_id': 'client-1',
                'csrf_token': alice_csrf,
            },
        )

        alice_send_events = _wait_for_events(alice_socket, {'receive_message', 'message_sent'})
        bob_send_events = _wait_for_events(bob_socket, {'receive_message'})
        alice_received_messages = _payloads_from_events(alice_send_events, 'receive_message')
        bob_received_messages = _payloads_from_events(bob_send_events, 'receive_message')
        alice_sent_messages = _payloads_from_events(alice_send_events, 'message_sent')

        assert len(alice_received_messages) == 1
        assert len(bob_received_messages) == 1
        assert len(alice_sent_messages) == 1
        assert alice_received_messages[0]['message'] == message_text
        assert bob_received_messages[0]['message'] == message_text
        assert bob_received_messages[0]['is_delivered'] is True
        assert alice_sent_messages[0]['client_id'] == 'client-1'

        with _connect(db_path) as conn:
            message_row = conn.execute(
                '''
                SELECT id, sender_id, receiver_id, message, is_delivered, is_read
                FROM messages
                WHERE chat_id = ? AND message = ?
                ''',
                (chat_id, message_text),
            ).fetchone()

        assert message_row is not None
        assert message_row['sender_id'] == 1
        assert message_row['receiver_id'] == 2
        assert bool(message_row['is_delivered']) is True
        assert bool(message_row['is_read']) is False

        bob_socket.emit('messages_seen', {'chat_id': chat_id, 'csrf_token': bob_csrf})
        alice_read_payloads = _wait_for_event_payloads(alice_socket, 'messages_read')
        assert any(payload['chat_id'] == chat_id for payload in alice_read_payloads)

        with _connect(db_path) as conn:
            updated_row = conn.execute(
                'SELECT is_delivered, is_read FROM messages WHERE id = ?',
                (message_row['id'],),
            ).fetchone()

        assert bool(updated_row['is_delivered']) is True
        assert bool(updated_row['is_read']) is True

        alice_socket.get_received()
        bob_socket.get_received()

        edited_text = 'hello encrypted world (edited)'
        alice_socket.emit(
            'edit_message',
            {
                'msg_id': message_row['id'],
                'new_content': edited_text,
                'chat_id': chat_id,
                'message_type': 'text',
                'csrf_token': alice_csrf,
            },
        )

        alice_edit_payloads = _wait_for_event_payloads(alice_socket, 'message_edited')
        bob_edit_payloads = _wait_for_event_payloads(bob_socket, 'message_edited')
        assert any(
            payload['msg_id'] == message_row['id']
            and payload['new_content'] == edited_text
            and payload['chat_id'] == chat_id
            and payload['message_type'] == 'text'
            for payload in alice_edit_payloads
        )
        assert any(
            payload['msg_id'] == message_row['id']
            and payload['new_content'] == edited_text
            and payload['chat_id'] == chat_id
            and payload['message_type'] == 'text'
            for payload in bob_edit_payloads
        )

        with _connect(db_path) as conn:
            edited_row = conn.execute(
                '''
                SELECT message, is_edited, edit_count, message_type
                FROM messages
                WHERE id = ?
                ''',
                (message_row['id'],),
            ).fetchone()

        assert edited_row['message'] == edited_text
        assert bool(edited_row['is_edited']) is True
        assert edited_row['edit_count'] == 1
        assert edited_row['message_type'] == 'text'

        alice_socket.get_received()
        bob_socket.get_received()

        bob_socket.emit(
            'toggle_reaction',
            {
                'chat_id': chat_id,
                'message_id': message_row['id'],
                'emoji': '👍',
                'request_id': 'reaction-1',
                'csrf_token': bob_csrf,
            },
        )

        alice_reaction_payloads = _wait_for_event_payloads(alice_socket, 'message_reactions_updated')
        bob_reaction_payloads = _wait_for_event_payloads(bob_socket, 'message_reactions_updated')
        assert any(
            payload['message_id'] == message_row['id']
            and payload['chat_id'] == chat_id
            and payload['emoji'] == '👍'
            and payload['action'] == 'added'
            and payload['request_id'] == 'reaction-1'
            and payload['actor_public_key'] == 'pk-2'
            and payload['reactions'][0]['emoji'] == '👍'
            and payload['reactions'][0]['count'] == 1
            and payload['reactions'][0]['reacted_by_me'] is False
            for payload in alice_reaction_payloads
        )
        assert any(
            payload['message_id'] == message_row['id']
            and payload['chat_id'] == chat_id
            and payload['emoji'] == '👍'
            and payload['action'] == 'added'
            and payload['request_id'] == 'reaction-1'
            and payload['actor_public_key'] == 'pk-2'
            and payload['reactions'][0]['emoji'] == '👍'
            and payload['reactions'][0]['count'] == 1
            and payload['reactions'][0]['reacted_by_me'] is True
            for payload in bob_reaction_payloads
        )

        with _connect(db_path) as conn:
            reaction_row = conn.execute(
                '''
                SELECT emoji, user_id, chat_id
                FROM message_reactions
                WHERE message_id = ? AND user_id = ?
                ''',
                (message_row['id'], 2),
            ).fetchone()

        assert reaction_row['emoji'] == '👍'
        assert reaction_row['user_id'] == 2
        assert reaction_row['chat_id'] == chat_id

        alice_socket.get_received()
        bob_socket.get_received()

        alice_socket.emit(
            'pin_message',
            {
                'chat_id': chat_id,
                'message_id': message_row['id'],
                'csrf_token': alice_csrf,
            },
        )

        alice_pin_payloads = _wait_for_event_payloads(alice_socket, 'message_pinned')
        bob_pin_payloads = _wait_for_event_payloads(bob_socket, 'message_pinned')
        assert any(
            payload['message_id'] == message_row['id']
            and payload['chat_id'] == chat_id
            and payload['message_content'] == edited_text
            and payload['sender_pub'] == 'pk-1'
            for payload in alice_pin_payloads
        )
        assert any(
            payload['message_id'] == message_row['id']
            and payload['chat_id'] == chat_id
            and payload['message_content'] == edited_text
            and payload['sender_pub'] == 'pk-1'
            for payload in bob_pin_payloads
        )

        with _connect(db_path) as conn:
            pin_row = conn.execute(
                '''
                SELECT message_id, message_content, pinned_by, sender_pub
                FROM chat_pins
                WHERE chat_id = ?
                ''',
                (chat_id,),
            ).fetchone()

        assert pin_row['message_id'] == message_row['id']
        assert pin_row['message_content'] == edited_text
        assert pin_row['pinned_by'] == 1
        assert pin_row['sender_pub'] == 'pk-1'

        alice_socket.get_received()
        bob_socket.get_received()

        alice_socket.emit('unpin_message', {'chat_id': chat_id, 'csrf_token': alice_csrf})

        alice_unpin_payloads = _wait_for_event_payloads(alice_socket, 'message_unpinned')
        bob_unpin_payloads = _wait_for_event_payloads(bob_socket, 'message_unpinned')
        assert any(payload['chat_id'] == chat_id for payload in alice_unpin_payloads)
        assert any(payload['chat_id'] == chat_id for payload in bob_unpin_payloads)

        with _connect(db_path) as conn:
            pin_row = conn.execute(
                'SELECT 1 FROM chat_pins WHERE chat_id = ?',
                (chat_id,),
            ).fetchone()

        assert pin_row is None

        alice_socket.get_received()
        bob_socket.get_received()

        alice_socket.emit(
            'favorite_message',
            {
                'chat_id': chat_id,
                'message_id': message_row['id'],
                'csrf_token': alice_csrf,
            },
        )

        alice_fav_payloads = _wait_for_event_payloads(alice_socket, 'message_favorited')
        bob_fav_payloads = _wait_for_event_payloads(bob_socket, 'message_favorited')
        assert any(
            payload['message_id'] == message_row['id']
            and payload['chat_id'] == chat_id
            and payload['message_content'] == edited_text
            for payload in alice_fav_payloads
        )
        assert bob_fav_payloads == []

        with _connect(db_path) as conn:
            fav_row = conn.execute(
                '''
                SELECT user_id, message_id, chat_id
                FROM favorite_messages
                WHERE user_id = 1 AND message_id = ?
                ''',
                (message_row['id'],),
            ).fetchone()

        assert fav_row['user_id'] == 1
        assert fav_row['message_id'] == message_row['id']
        assert fav_row['chat_id'] == chat_id

        alice_socket.get_received()
        bob_socket.get_received()

        alice_socket.emit(
            'unfavorite_message',
            {
                'chat_id': chat_id,
                'message_id': message_row['id'],
                'csrf_token': alice_csrf,
            },
        )
        alice_unfav_payloads = _wait_for_event_payloads(alice_socket, 'message_unfavorited')
        bob_unfav_payloads = _wait_for_event_payloads(bob_socket, 'message_unfavorited')
        assert any(
            payload['chat_id'] == chat_id and payload['message_id'] == message_row['id']
            for payload in alice_unfav_payloads
        )
        assert bob_unfav_payloads == []

        with _connect(db_path) as conn:
            fav_row = conn.execute(
                'SELECT 1 FROM favorite_messages WHERE user_id = 1 AND message_id = ?',
                (message_row['id'],),
            ).fetchone()

        assert fav_row is None

        alice_socket.get_received()
        bob_socket.get_received()

        alice_socket.emit(
            'send_message',
            {
                'chat_id': chat_id,
                'message': E2EE_DIRECT_MESSAGE,
                'client_id': 'client-2',
                'csrf_token': alice_csrf,
            },
        )
        _wait_for_events(alice_socket, {'receive_message', 'message_sent'})
        _wait_for_events(bob_socket, {'receive_message'})

        with _connect(db_path) as conn:
            delete_for_me_row = conn.execute(
                '''
                SELECT id
                FROM messages
                WHERE chat_id = ? AND message = ?
                ''',
                (chat_id, 'delete for me only'),
            ).fetchone()

        alice_socket.get_received()
        bob_socket.get_received()

        alice_socket.emit(
            'delete_messages',
            {
                'chat_id': chat_id,
                'msg_ids': [delete_for_me_row['id']],
                'mode': 'for_me',
                'csrf_token': alice_csrf,
            },
        )

        alice_delete_for_me_payloads = _wait_for_event_payloads(alice_socket, 'messages_deleted')
        assert any(
            payload['chat_id'] == chat_id
            and payload['mode'] == 'for_me'
            and payload['msg_ids'] == [delete_for_me_row['id']]
            for payload in alice_delete_for_me_payloads
        )
        time.sleep(0.05)
        assert _event_payloads(bob_socket, 'messages_deleted') == []

        with _connect(db_path) as conn:
            delete_for_me_flags = conn.execute(
                '''
                SELECT deleted_by_sender, deleted_by_receiver
                FROM messages
                WHERE id = ?
                ''',
                (delete_for_me_row['id'],),
            ).fetchone()

        assert bool(delete_for_me_flags['deleted_by_sender']) is True
        assert bool(delete_for_me_flags['deleted_by_receiver']) is False

        alice_socket.get_received()
        bob_socket.get_received()

        alice_socket.emit(
            'send_message',
            {
                'chat_id': chat_id,
                'message': E2EE_DIRECT_MESSAGE,
                'client_id': 'client-3',
                'csrf_token': alice_csrf,
            },
        )
        _wait_for_events(alice_socket, {'receive_message', 'message_sent'})
        _wait_for_events(bob_socket, {'receive_message'})

        with _connect(db_path) as conn:
            delete_for_both_row = conn.execute(
                '''
                SELECT id
                FROM messages
                WHERE chat_id = ? AND message = ?
                ''',
                (chat_id, 'delete for both'),
            ).fetchone()

        alice_socket.get_received()
        bob_socket.get_received()

        alice_socket.emit(
            'delete_messages',
            {
                'chat_id': chat_id,
                'msg_ids': [delete_for_both_row['id']],
                'mode': 'for_both',
                'csrf_token': alice_csrf,
            },
        )

        alice_delete_for_both_payloads = _wait_for_event_payloads(alice_socket, 'messages_deleted')
        bob_delete_for_both_payloads = _wait_for_event_payloads(bob_socket, 'messages_deleted')
        assert any(
            payload['chat_id'] == chat_id
            and payload['mode'] == 'for_both'
            and payload['msg_ids'] == [delete_for_both_row['id']]
            for payload in alice_delete_for_both_payloads
        )
        assert any(
            payload['chat_id'] == chat_id
            and payload['mode'] == 'for_both'
            and payload['msg_ids'] == [delete_for_both_row['id']]
            for payload in bob_delete_for_both_payloads
        )

        with _connect(db_path) as conn:
            deleted_for_both_row = conn.execute(
                'SELECT 1 FROM messages WHERE id = ?',
                (delete_for_both_row['id'],),
            ).fetchone()
            conn.execute(
                'INSERT INTO block_list (blocker_id, blocked_id) VALUES (?, ?)',
                (2, 1),
            )
            conn.commit()

        assert deleted_for_both_row is None

        alice_socket.emit(
            'send_message',
            {
                'chat_id': chat_id,
                'message': 'should not send',
                'csrf_token': alice_csrf,
            },
        )

        blocked_events = _wait_for_events(alice_socket, {'chat_block_state', 'error'})
        block_payloads = _payloads_from_events(blocked_events, 'chat_block_state')
        error_payloads = _payloads_from_events(blocked_events, 'error')

        assert len(block_payloads) == 1
        assert block_payloads[0]['chat_id'] == chat_id
        assert block_payloads[0]['blocked_me'] is True
        assert len(error_payloads) == 1
        assert error_payloads[0]['code'] == BLOCK_ERROR_CODE
        assert error_payloads[0]['blocked_me'] is True

        with _connect(db_path) as conn:
            row = conn.execute(
                'SELECT COUNT(*) AS cnt FROM messages WHERE chat_id = ?',
                (chat_id,),
            ).fetchone()

        assert row['cnt'] == 3
    finally:
        if alice_socket.is_connected():
            alice_socket.disconnect()
        if bob_socket is not None and bob_socket.is_connected():
            bob_socket.disconnect()


def test_socket_connect_csrf_guard_rejects_invalid_token(monkeypatch, tmp_path):
    db_path = tmp_path / 'socket-csrf-guard.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    _seed_dialog(db_path)

    with app.test_request_context('/socket.io'):
        session['user_id'] = 1
        session['public_key_pem'] = 'pk-1'
        valid_token = generate_csrf()

        assert socket_events._socket_connect_csrf_ok({'csrf_token': valid_token}) is True
        assert socket_events._socket_connect_csrf_ok({'csrf_token': 'invalid-token'}) is False


def test_socket_connect_enforces_max_tabs_per_user(monkeypatch, tmp_path):
    db_path = tmp_path / 'socket-connect-tab-cap.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(db_path),
            'SOCKET_MAX_CONNECTIONS_PER_USER': 1,
            'SOCKET_CONNECT_IP_LIMIT': 100,
        },
    )
    _seed_dialog(db_path)

    alice_http, alice_csrf = _prepare_http_client(app, 1, 'pk-1')
    first = _socket_client(app, alice_http, alice_csrf)
    second = _socket_client(app, alice_http, alice_csrf)
    try:
        assert first.is_connected() is True
        assert second.is_connected() is False
        assert presence.count_connected('pk-1') == 1
    finally:
        if first.is_connected():
            first.disconnect()
        if second.is_connected():
            second.disconnect()


def test_socket_connect_enforces_ip_rate_limit(monkeypatch, tmp_path):
    db_path = tmp_path / 'socket-connect-ip-limit.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(db_path),
            'SOCKET_CONNECT_IP_LIMIT': 1,
            'SOCKET_CONNECT_IP_WINDOW_SECONDS': 60,
            'SOCKET_MAX_CONNECTIONS_PER_USER': 5,
        },
    )
    _seed_dialog(db_path)

    alice_http, alice_csrf = _prepare_http_client(app, 1, 'pk-1')
    bob_http, bob_csrf = _prepare_http_client(app, 2, 'pk-2')
    alice_socket = _socket_client(app, alice_http, alice_csrf)
    bob_socket = _socket_client(app, bob_http, bob_csrf)
    try:
        assert alice_socket.is_connected() is True
        assert bob_socket.is_connected() is False
    finally:
        if alice_socket.is_connected():
            alice_socket.disconnect()
        if bob_socket.is_connected():
            bob_socket.disconnect()


def test_socket_helpers_cover_payload_parsing_csrf_and_rate_limit(monkeypatch, tmp_path):
    db_path = tmp_path / 'socket-helpers.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    emitted = []

    monkeypatch.setattr(
        socket_events,
        'emit',
        lambda name, payload=None, *args, **kwargs: emitted.append(
            {'name': name, 'payload': payload, 'args': args, 'kwargs': kwargs}
        ),
    )

    with app.test_request_context('/socket.io'):
        session['user_id'] = 1
        session['public_key_pem'] = 'pk-1'

        socket_events._clear_invalid_session_user()
        assert dict(session) == {}

        assert socket_events._positive_int('12') == 12
        assert socket_events._positive_int('0') is None
        assert socket_events._positive_int('bad') is None
        assert socket_events._normalize_request_id(' req-1 ') == 'req-1'
        assert socket_events._normalize_request_id('x' * 73) == ''
        assert socket_events._sanitize_message_type(' video ') == 'video'
        assert socket_events._sanitize_message_type('weird') == 'text'
        assert socket_events._parse_db_utc_timestamp(None) is None
        assert socket_events._parse_db_utc_timestamp('bad-date') is None
        assert socket_events._parse_db_utc_timestamp('2025-01-01 10:00:00').tzinfo == timezone.utc
        assert socket_events._parse_db_utc_timestamp('2025-01-01T10:00:00').tzinfo == timezone.utc
        assert socket_events._parse_db_utc_timestamp('2025-01-01T10:00:00Z').tzinfo is not None
        naive_dt = datetime(2025, 1, 1, 10, 0, 0)
        aware_dt = datetime(2025, 1, 1, 10, 0, 0, tzinfo=timezone.utc)
        assert socket_events._parse_db_utc_timestamp(naive_dt).tzinfo == timezone.utc
        assert socket_events._parse_db_utc_timestamp(aware_dt) == aware_dt

        assert socket_events._require_payload_dict({'ok': True}) == {'ok': True}
        assert socket_events._require_payload_dict('bad-payload') is None
        assert emitted.pop()['payload'] == {'message': 'Invalid socket payload.'}

        assert socket_events._socket_csrf_ok({}) is False
        assert emitted.pop()['payload'] == {'message': 'CSRF token is required.'}

        monkeypatch.setattr(socket_events, 'validate_csrf', lambda token: (_ for _ in ()).throw(ValidationError('bad')))
        session['user_id'] = 1
        assert socket_events._socket_csrf_ok({'csrf_token': 'bad'}) is False
        assert emitted.pop()['payload'] == {'message': 'Invalid CSRF token.'}

        monkeypatch.setattr(socket_events, 'validate_csrf', lambda token: (_ for _ in ()).throw(RuntimeError('boom')))
        assert socket_events._socket_csrf_ok({'csrf_token': 'boom'}) is False
        assert emitted.pop()['payload'] == {'message': 'CSRF validation failed.'}

        monkeypatch.setattr(socket_events, 'validate_csrf', lambda token: None)
        assert socket_events._socket_csrf_ok({'csrf_token': 'ok'}) is True

        socket_events._emit_blocked_error(
            'blocked-message',
            {'blocked_by_me': True, 'blocked_me': False},
            request_id='req-42',
        )
        blocked_payload = emitted.pop()['payload']
        assert blocked_payload == {
            'code': BLOCK_ERROR_CODE,
            'message': 'blocked-message',
            'blocked_by_me': True,
            'blocked_me': False,
            'request_id': 'req-42',
        }

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice'), (2, 'pk-2', 'bob', 'Bob'), (99, 'pk-99', 'zoe', 'Zoe')
            '''
        )
        conn.execute(
            '''
            INSERT INTO chats (chat_id, chat_name)
            VALUES ('chat-a', 'Chat A'), ('chat-b', 'Chat B')
            '''
        )
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, receiver_id, message, is_delivered)
            VALUES
                (1, 'chat-a', 1, 2, 'm1', 0),
                (2, 'chat-a', 1, 2, 'm2', 0),
                (3, 'chat-b', 1, 2, 'm3', 1)
            '''
        )
        conn.commit()

    with _connect(db_path) as conn:
        delivered_rows = socket_events._collect_and_mark_delivered(conn, 2, chat_id='chat-a')
        conn.commit()
    assert [row['id'] for row in delivered_rows] == [1, 2]

    emitted.clear()
    socket_events._emit_delivered_events(delivered_rows)
    assert len(emitted) == 1
    assert emitted[0]['name'] == 'messages_delivered'
    assert emitted[0]['payload']['chat_id'] == 'chat-a'
    assert emitted[0]['payload']['message_ids'] == [1, 2]
    assert emitted[0]['payload']['envelope']['event_type'] == 'messages_delivered'
    assert emitted[0]['args'] == ()
    assert emitted[0]['kwargs'] == {'room': 'pk-1'}

    assert socket_events._socket_rate_ok(99) is True
    with _connect(db_path) as conn:
        row = conn.execute(
            "SELECT event_count FROM socket_rate_limits WHERE user_id = 99 AND event_name = 'default'"
        ).fetchone()
    assert row['event_count'] == 1
    assert socket_events._socket_rate_ok(99, 'typing') is True
    with _connect(db_path) as conn:
        typing_row = conn.execute(
            "SELECT event_count FROM socket_rate_limits WHERE user_id = 99 AND event_name = 'typing'"
        ).fetchone()
    assert typing_row['event_count'] == 1

    monkeypatch.setattr(socket_events, '_MSG_LIMIT', 1)
    assert socket_events._socket_rate_ok(99) is False

    socket_events._typing_event_last_emit.clear()
    monkeypatch.setattr(socket_events, '_TYPING_EVENT_MIN_INTERVALS', {'typing': 60.0})
    assert socket_events._socket_signal_interval_ok(99, 'typing') is True
    assert socket_events._socket_signal_interval_ok(99, 'typing') is False
    assert socket_events._socket_signal_interval_ok(100, 'typing') is True
    assert socket_events._socket_signal_interval_ok(99, 'unknown_event') is True

    monkeypatch.setattr(
        socket_events,
        'get_db_connection',
        lambda: (_ for _ in ()).throw(DatabaseError('db-fail')),
    )
    assert socket_events._socket_rate_ok(100) is False


def test_socket_negative_paths_cover_invalid_payloads_and_reply_preview(monkeypatch, tmp_path):
    db_path = tmp_path / 'socket-negative-flow.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    chat_id = _seed_dialog(db_path)

    with _connect(db_path) as conn:
        old_created_at = (datetime.now(timezone.utc) - timedelta(days=3)).strftime('%Y-%m-%d %H:%M:%S')
        conn.execute(
            '''
            INSERT INTO messages (
                id, chat_id, sender_id, receiver_id, message, created_at, edit_count
            )
            VALUES
                (10, ?, 1, 2, 'old-edit', ?, 0),
                (11, ?, 1, 2, 'limit-edit', CURRENT_TIMESTAMP, 5),
                (12, ?, 2, 1, 'plain reply source', CURRENT_TIMESTAMP, 0)
            '''
            ,
            (chat_id, old_created_at, chat_id, chat_id),
        )
        conn.commit()

    alice_http, alice_csrf = _prepare_http_client(app, 1, 'pk-1')
    bob_http, bob_csrf = _prepare_http_client(app, 2, 'pk-2')
    alice_socket = _socket_client(app, alice_http, alice_csrf)
    bob_socket = _socket_client(app, bob_http, bob_csrf)

    try:
        assert alice_socket.is_connected()
        assert bob_socket.is_connected()

        alice_socket.emit('join', {'chat_id': 'bad-chat', 'csrf_token': alice_csrf})
        join_errors = _wait_for_event_payloads(alice_socket, 'error')
        assert any(payload['message'] == 'Invalid chat ID.' for payload in join_errors)

        alice_socket.emit('stop_typing', {'chat_id': chat_id, 'csrf_token': alice_csrf})
        bob_stop_typing = _wait_for_event_payloads(bob_socket, 'partner_stop_typing')
        assert any(payload['chat_id'] == chat_id for payload in bob_stop_typing)

        alice_socket.emit('send_message', 'bad-payload')
        payload_errors = _wait_for_event_payloads(alice_socket, 'error')
        assert any(payload['message'] == 'Invalid socket payload.' for payload in payload_errors)

        alice_socket.emit('send_message', {'chat_id': chat_id, 'message': '', 'csrf_token': alice_csrf})
        invalid_payload_errors = _wait_for_event_payloads(alice_socket, 'error')
        assert any(payload['message'] == 'Invalid payload.' for payload in invalid_payload_errors)

        alice_socket.emit(
            'send_message',
            {'chat_id': 'bad-chat', 'message': 'hello', 'csrf_token': alice_csrf},
        )
        invalid_chat_errors = _wait_for_event_payloads(alice_socket, 'error')
        assert any(payload['message'] == 'Invalid chat ID.' for payload in invalid_chat_errors)

        monkeypatch.setattr(socket_events, '_socket_rate_ok', lambda uid, event_name=None: False)
        alice_socket.emit(
            'send_message',
            {'chat_id': chat_id, 'message': 'rate limited', 'csrf_token': alice_csrf},
        )
        rate_limit_errors = _wait_for_event_payloads(alice_socket, 'error')
        assert any(payload['message'] == 'Too many messages. Please wait a little.' for payload in rate_limit_errors)

        bob_socket.emit(
            'toggle_reaction',
            {
                'chat_id': chat_id,
                'message_id': 12,
                'emoji': '\U0001F44D',
                'request_id': 'rate-limit-reaction',
                'csrf_token': bob_csrf,
            },
        )
        reaction_rate_limit_errors = _wait_for_event_payloads(bob_socket, 'error')
        assert any(payload['message'] == 'Too many messages. Please wait a little.' for payload in reaction_rate_limit_errors)

        bob_socket.emit(
            'messages_seen',
            {
                'chat_id': chat_id,
                'csrf_token': bob_csrf,
            },
        )
        seen_rate_limit_errors = _wait_for_event_payloads(bob_socket, 'error')
        assert any(payload['message'] == 'Too many messages. Please wait a little.' for payload in seen_rate_limit_errors)

        monkeypatch.setattr(socket_events, '_socket_rate_ok', lambda uid, event_name=None: True)
        monkeypatch.setattr(socket_events, '_socket_signal_interval_ok', lambda uid, event_name: False)
        bob_socket.get_received()
        alice_socket.emit(
            'typing',
            {
                'chat_id': chat_id,
                'csrf_token': alice_csrf,
            },
        )
        time.sleep(0.05)
        assert _event_payloads(bob_socket, 'partner_typing') == []

        monkeypatch.setattr(socket_events, '_socket_signal_interval_ok', lambda uid, event_name: True)
        alice_socket.emit(
            'send_message',
            {
                'chat_id': chat_id,
                'message': E2EE_DIRECT_MESSAGE,
                'reply_to_id': 12,
                'message_type': 'unknown-type',
                'client_id': 'client-negative',
                'csrf_token': alice_csrf,
            },
        )
        alice_send_events = _wait_for_events(alice_socket, {'receive_message', 'message_sent'})
        reply_payload = _payloads_from_events(alice_send_events, 'message_sent')[0]
        assert reply_payload['reply_to_id'] is None
        assert reply_payload['reply_message'] is None
        assert reply_payload['reply_sender_pub'] == 'pk-2'

        alice_socket.emit(
            'edit_message',
            {
                'msg_id': 10,
                'new_content': 'edited too late',
                'chat_id': chat_id,
                'csrf_token': alice_csrf,
            },
        )
        expired_errors = _wait_for_event_payloads(alice_socket, 'error')
        assert any(payload['message'] == 'Editing window expired for this message.' for payload in expired_errors)

        alice_socket.emit(
            'edit_message',
            {
                'msg_id': 11,
                'new_content': 'edited too many times',
                'chat_id': chat_id,
                'csrf_token': alice_csrf,
            },
        )
        edit_limit_errors = _wait_for_event_payloads(alice_socket, 'error')
        assert any(payload['message'] == 'Edit limit reached for this message.' for payload in edit_limit_errors)

        bob_socket.emit(
            'toggle_reaction',
            {
                'chat_id': chat_id,
                'message_id': 9999,
                'emoji': '\U0001F44D',
                'request_id': 'missing-msg',
                'csrf_token': bob_csrf,
            },
        )
        missing_message_errors = _wait_for_event_payloads(bob_socket, 'error')
        assert any(
            payload['message'] == 'Message not found.' and payload['request_id'] == 'missing-msg'
            for payload in missing_message_errors
        )

        bob_socket.emit(
            'toggle_reaction',
            {
                'chat_id': chat_id,
                'message_id': 12,
                'emoji': '\U0001F525',
                'request_id': 'add-reaction',
                'csrf_token': bob_csrf,
            },
        )
        add_events = _wait_for_event_payloads(bob_socket, 'message_reactions_updated')
        assert any(payload['action'] == 'added' and payload['emoji'] == '\U0001F525' for payload in add_events)

        bob_socket.emit(
            'toggle_reaction',
            {
                'chat_id': chat_id,
                'message_id': 12,
                'emoji': '\U0001F44D',
                'request_id': 'update-reaction',
                'csrf_token': bob_csrf,
            },
        )
        update_events = _wait_for_event_payloads(bob_socket, 'message_reactions_updated')
        assert any(payload['action'] == 'updated' and payload['emoji'] == '\U0001F44D' for payload in update_events)

        bob_socket.emit(
            'toggle_reaction',
            {
                'chat_id': chat_id,
                'message_id': 12,
                'emoji': '\U0001F44D',
                'request_id': 'remove-reaction',
                'csrf_token': bob_csrf,
            },
        )
        remove_events = _wait_for_event_payloads(bob_socket, 'message_reactions_updated')
        assert any(payload['action'] == 'removed' and payload['emoji'] == '\U0001F44D' for payload in remove_events)

        alice_socket.emit(
            'delete_messages',
            {
                'chat_id': chat_id,
                'msg_ids': list(range(1, 103)),
                'csrf_token': alice_csrf,
            },
        )
        delete_limit_errors = _wait_for_event_payloads(alice_socket, 'error')
        assert any(payload['message'] == 'Too many messages selected. Maximum is 100.' for payload in delete_limit_errors)
    finally:
        if alice_socket.is_connected():
            alice_socket.disconnect()
        if bob_socket.is_connected():
            bob_socket.disconnect()


def test_online_status_follows_active_visible_tab_presence(monkeypatch, tmp_path):
    db_path = tmp_path / 'socket-online-status.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    _seed_dialog(db_path)

    alice_http, alice_csrf = _prepare_http_client(app, 1, 'pk-1')
    bob_http, bob_csrf = _prepare_http_client(app, 2, 'pk-2')
    alice_socket = _socket_client(app, alice_http, alice_csrf)
    bob_socket = _socket_client(app, bob_http, bob_csrf)

    try:
        assert alice_socket.is_connected()
        assert bob_socket.is_connected()

        bob_socket.emit('activity_update', {'active': True, 'csrf_token': bob_csrf})
        online_events = _wait_for_event_payloads(alice_socket, 'user_status')
        assert any(payload['public_key'] == 'pk-2' and payload['online'] is True for payload in online_events)

        response = alice_http.get('/get_online_status?user_id=2')
        assert response.status_code == 200
        assert response.get_json()['online'] is True

        bob_socket.emit('activity_update', {'active': False, 'csrf_token': bob_csrf})
        offline_events = _wait_for_event_payloads(alice_socket, 'user_status')
        assert any(payload['public_key'] == 'pk-2' and payload['online'] is False for payload in offline_events)

        response = alice_http.get('/get_online_status?user_id=2')
        assert response.status_code == 200
        payload = response.get_json()
        assert payload['online'] is False
        assert payload['last_seen']
    finally:
        if alice_socket.is_connected():
            alice_socket.disconnect()
        if bob_socket.is_connected():
            bob_socket.disconnect()


def test_disconnect_clears_presence_when_active_tab_closes(monkeypatch, tmp_path):
    db_path = tmp_path / 'socket-disconnect-presence.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    _seed_dialog(db_path)

    alice_http, alice_csrf = _prepare_http_client(app, 1, 'pk-1')
    bob_http, bob_csrf = _prepare_http_client(app, 2, 'pk-2')
    alice_socket = _socket_client(app, alice_http, alice_csrf)
    bob_socket = _socket_client(app, bob_http, bob_csrf)

    try:
        assert alice_socket.is_connected()
        assert bob_socket.is_connected()

        bob_socket.emit('activity_update', {'active': True, 'csrf_token': bob_csrf})
        online_events = _wait_for_event_payloads(alice_socket, 'user_status')
        assert any(payload['public_key'] == 'pk-2' and payload['online'] is True for payload in online_events)

        bob_socket.disconnect()
        offline_events = _wait_for_event_payloads(alice_socket, 'user_status')
        assert any(payload['public_key'] == 'pk-2' and payload['online'] is False for payload in offline_events)

        response = alice_http.get('/get_online_status?user_id=2')
        assert response.status_code == 200
        payload = response.get_json()
        assert payload['online'] is False
        assert payload['last_seen']
    finally:
        if alice_socket.is_connected():
            alice_socket.disconnect()
        if bob_socket.is_connected():
            bob_socket.disconnect()
