from flask import Flask

from app.extensions import limiter
from app.routes import mobile as mobile_routes


class _FakeConn:
    def __init__(self):
        self.closed = False

    def close(self):
        self.closed = True


class _FakeCursor:
    def __init__(self, row=None):
        self.row = row

    def fetchone(self):
        return self.row


class _MobileSendConn:
    def __init__(self):
        self.closed = False
        self.committed = False
        self.rolled_back = False

    def execute(self, sql, params=None):
        normalized = ' '.join(sql.split())
        if 'FROM contacts c' in normalized:
            return _FakeCursor({'contact_id': 2, 'public_key': 'pk-2'})
        if 'SELECT display_name, username FROM users' in normalized:
            return _FakeCursor({'display_name': 'Alice', 'username': 'alice'})
        if 'FROM messages WHERE sender_id' in normalized:
            return _FakeCursor(None)
        if 'INSERT INTO messages' in normalized:
            return _FakeCursor({'id': 42, 'created_at': 123456.0, 'is_read': 0, 'is_delivered': 0})
        raise AssertionError(f'unexpected SQL: {normalized}')

    def commit(self):
        self.committed = True

    def rollback(self):
        self.rolled_back = True

    def close(self):
        self.closed = True


def _build_app(monkeypatch, *, conn=None, page_context=None, calls_enabled=False):
    app = Flask(__name__)
    app.secret_key = 'test-secret'
    app.config.update(
        TESTING=True,
        RATELIMIT_ENABLED=False,
        WTF_CSRF_ENABLED=False,
        SOCKETIO_CLIENT_TRANSPORTS='websocket,polling',
        SOCKETIO_CLIENT_UPGRADE=True,
    )
    limiter.init_app(app)

    fake_conn = conn or _FakeConn()
    observed = {}

    def _fake_fetch_chat_page_context(**kwargs):
        observed['fetch_kwargs'] = kwargs
        return page_context

    monkeypatch.setattr(mobile_routes, 'get_db_connection', lambda: fake_conn)
    monkeypatch.setattr(mobile_routes, 'fetch_chat_page_context', _fake_fetch_chat_page_context)
    monkeypatch.setattr(mobile_routes, 'fetch_contacts_for_user', object())
    monkeypatch.setattr(mobile_routes, 'language_from_user_row', object())
    monkeypatch.setattr(mobile_routes, 'can_user_use_calls', lambda _conn, *, user_id: calls_enabled)
    monkeypatch.setattr(mobile_routes, 'generate_csrf', lambda: 'csrf-test-token')

    app.register_blueprint(mobile_routes.mobile_bp)
    return app, fake_conn, observed


def test_mobile_bootstrap_requires_authenticated_session(monkeypatch):
    app, fake_conn, observed = _build_app(monkeypatch)

    response = app.test_client().get('/api/mobile/bootstrap')

    assert response.status_code == 401
    assert response.get_json() == {'success': False, 'error': 'Authorization required.'}
    assert fake_conn.closed is False
    assert observed == {}


def test_mobile_bootstrap_returns_json_boot_payload(monkeypatch):
    page_context = {
        'current_username': 'alice',
        'current_display_name': 'Alice',
        'current_public_key': 'pk-1',
        'current_x25519_public_key': 'x25519-pk-1',
        'current_ed25519_public_key': 'ed25519-pk-1',
        'current_crypto_version': 3,
        'current_avatar_url': '/static/avatars/a.png',
        'ui_language': 'en',
        'mute_dialog_requests': True,
        'client_preferences': {'theme': 'dark'},
        'initial_contacts': [{'chatId': 'chat-1', 'display_name': 'Bob'}],
        'has_more_initial_contacts': True,
    }
    app, fake_conn, observed = _build_app(
        monkeypatch,
        page_context=page_context,
        calls_enabled=True,
    )
    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = 1
        sess['public_key_pem'] = 'pk-1'
        sess['session_auto_logout_seconds'] = 600
        sess['session_expires_at'] = 123456

    response = client.get('/api/mobile/bootstrap')
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['csrf_token'] == 'csrf-test-token'
    assert payload['user'] == {
        'id': 1,
        'username': 'alice',
        'display_name': 'Alice',
        'public_key': 'pk-1',
        'avatar_url': '/static/avatars/a.png',
        'ui_language': 'en',
        'mute_dialog_requests': True,
        'client_preferences': {'theme': 'dark'},
    }
    assert payload['session'] == {'auto_logout_seconds': 600, 'expires_at': 123456}
    assert payload['crypto'] == {
        'x25519_public_key': 'x25519-pk-1',
        'ed25519_public_key': 'ed25519-pk-1',
        'crypto_version': 3,
    }
    assert payload['socketio'] == {
        'transports': ['websocket', 'polling'],
        'upgrade': True,
        'path': '/socket.io',
    }
    assert payload['features'] == {
        'calls': True,
        'groups': True,
        'media': True,
        'push_apns': False,
    }
    assert payload['contacts'] == [{'chatId': 'chat-1', 'display_name': 'Bob'}]
    assert payload['has_more_contacts'] is True
    assert observed['fetch_kwargs']['conn'] is fake_conn
    assert observed['fetch_kwargs']['user_id'] == 1
    assert observed['fetch_kwargs']['initial_contacts_limit'] == 50
    assert fake_conn.closed is True
    with client.session_transaction() as sess:
        assert sess['ui_language'] == 'en'


def test_mobile_bootstrap_clears_stale_session(monkeypatch):
    app, fake_conn, _observed = _build_app(monkeypatch, page_context=None)
    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = 9
        sess['public_key_pem'] = 'missing-pk'

    response = client.get('/api/mobile/bootstrap')

    assert response.status_code == 401
    assert response.get_json() == {'success': False, 'error': 'User not found.'}
    assert fake_conn.closed is True
    with client.session_transaction() as sess:
        assert 'user_id' not in sess
        assert 'public_key_pem' not in sess


def test_mobile_send_uses_enveloped_emitter(monkeypatch):
    app = Flask(__name__)
    app.secret_key = 'test-secret'
    app.config.update(TESTING=True, RATELIMIT_ENABLED=False, WTF_CSRF_ENABLED=False)
    limiter.init_app(app)
    conn = _MobileSendConn()
    emitted = []

    def _fake_emit(event_name, payload, *args, chat_id=None, request_id=None, **kwargs):
        emitted.append({
            'event_name': event_name,
            'room': kwargs.get('room'),
            'chat_id': chat_id,
            'request_id': request_id,
            'payload': payload,
        })

    monkeypatch.setattr(mobile_routes, 'get_db_connection', lambda: conn)
    monkeypatch.setattr(mobile_routes, 'get_chat_type', lambda _conn, _chat_id: 'direct')
    monkeypatch.setattr(mobile_routes, 'is_valid_chat_id', lambda _chat_id: True)
    monkeypatch.setattr(mobile_routes, 'looks_like_ciphertext', lambda _message: True)
    monkeypatch.setattr(mobile_routes, '_socket_emit_with_envelope', _fake_emit)
    app.register_blueprint(mobile_routes.mobile_bp)
    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = 1
        sess['public_key_pem'] = 'pk-1'

    response = client.post('/api/mobile/send', json={
        'chat_id': 'chat-1',
        'message': 'encrypted-payload',
        'message_type': 'text',
        'request_id': 'ios-req-1',
    })

    assert response.status_code == 200
    assert conn.committed is True
    assert conn.closed is True
    assert [(item['event_name'], item['room']) for item in emitted] == [
        ('receive_message', 'pk-2'),
        ('message_sent', 'pk-1'),
    ]
    assert all(item['chat_id'] == 'chat-1' for item in emitted)
    assert all(item['request_id'] == 'ios-req-1' for item in emitted)
    assert all(item['payload']['id'] == 42 for item in emitted)
