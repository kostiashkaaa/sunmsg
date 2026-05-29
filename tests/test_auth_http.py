import base64
import json
import time
from pathlib import Path

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
import pyotp

from app import create_app
from app.routes import auth as auth_routes
from app.services.crypto import generate_chat_id, generate_keys, normalize_public_key
from app.services.refresh_tokens import REFRESH_COOKIE_NAME, issue_refresh_token, rotate_refresh_token
from app.services.totp_backup_codes import store_backup_codes
from app.db_backend import DatabaseError
from tests._pg_test_db import connect_test_db


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


def _authed_client(app, user_id: int, public_key: str):
    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = user_id
        sess['public_key_pem'] = public_key
    return client


def _stage_pending_totp(client, *, user_id: int, public_key: str, remember: bool):
    with client.session_transaction() as sess:
        sess['pending_totp_user_id'] = user_id
        sess['pending_totp_public_key'] = public_key
        sess['pending_totp_remember'] = remember
        sess['pending_totp_issued_at'] = int(time.time())


def _capture_socket_emits(monkeypatch):
    emitted = []

    def _fake_emit(name, payload=None, *args, **kwargs):
        emitted.append(
            {
                'name': name,
                'payload': payload,
                'args': args,
                'kwargs': kwargs,
            }
        )

    monkeypatch.setattr(auth_routes.socketio, 'emit', _fake_emit)
    return emitted


def _valid_login_vault():
    return json.dumps(
        {
            'v': 1,
            'iv': base64.b64encode(b'0123456789ab').decode('ascii'),
            'data': base64.b64encode(b'0123456789abcdefencrypted').decode('ascii'),
        }
    )


def _signed_login_challenge(challenge: str, private_key_pem: str) -> str:
    private_key = serialization.load_pem_private_key(private_key_pem.encode('utf-8'), password=None)
    signature = private_key.sign(
        challenge.encode('utf-8'),
        padding.PKCS1v15(),
        hashes.SHA256(),
    )
    return base64.b64encode(signature).decode('ascii')


def _signed_key_rotation_payload(*, old_private_key_pem: str, old_public_key: str, new_public_key: str, ts: int) -> str:
    payload = json.dumps(
        {
            'op': 'key_rotation_v1',
            'old_public_key': normalize_public_key(old_public_key),
            'new_public_key': normalize_public_key(new_public_key),
            'ts': int(ts),
        },
        separators=(',', ':'),
        sort_keys=True,
    )
    return _signed_login_challenge(payload, old_private_key_pem)


def test_get_challenge_returns_user_vault_and_decoy_for_unknown_user(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-challenge.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    login_vault = _valid_login_vault()

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, login_vault)
            VALUES (1, 'pk-1', 'alice', 'Alice', ?)
            ''',
            (login_vault,),
        )
        conn.commit()

    client = app.test_client()

    response = client.post('/api/get_challenge', json={'username': 'alice'})
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert len(payload['challenge']) == 64
    assert json.loads(payload['login_vault']) == json.loads(login_vault)

    with client.session_transaction() as sess:
        assert sess['login_username'] == 'alice'
        assert sess['challenge'] == payload['challenge']

    response = client.post('/api/get_challenge', json={'username': 'missing-user'})
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert len(payload['challenge']) == 64
    assert payload['login_vault'] != login_vault
    decoy_vault = json.loads(payload['login_vault'])
    assert decoy_vault['v'] == 1
    assert base64.b64decode(decoy_vault['iv'])
    assert base64.b64decode(decoy_vault['data'])


def test_get_challenge_is_case_insensitive_for_username(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-challenge-case-insensitive.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    login_vault = _valid_login_vault()

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, login_vault)
            VALUES (1, 'pk-1', 'alice', 'Alice', ?)
            ''',
            (login_vault,),
        )
        conn.commit()

    client = app.test_client()
    response = client.post('/api/get_challenge', json={'username': 'Alice'})
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert json.loads(payload['login_vault']) == json.loads(login_vault)
    with client.session_transaction() as sess:
        assert sess['login_username'] == 'alice'


def test_get_challenge_accepts_username_with_at_prefix(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-challenge-at-prefix.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    login_vault = _valid_login_vault()

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, login_vault)
            VALUES (1, 'pk-1', 'alice', 'Alice', ?)
            ''',
            (login_vault,),
        )
        conn.commit()

    client = app.test_client()
    response = client.post('/api/get_challenge', json={'username': '@Alice'})
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert json.loads(payload['login_vault']) == json.loads(login_vault)
    with client.session_transaction() as sess:
        assert sess['login_username'] == 'alice'


def test_login_challenge_with_invalid_stored_public_key_returns_401(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-login-invalid-public-key.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, login_vault)
            VALUES (1, 'pk-1', 'alice', 'Alice', ?)
            ''',
            (_valid_login_vault(),),
        )
        conn.commit()

    client = app.test_client()
    challenge_response = client.post('/api/get_challenge', json={'username': 'alice'})
    assert challenge_response.status_code == 200
    assert challenge_response.get_json().get('success') is True

    response = client.post('/api/login_challenge', json={'signature': 'AA=='})
    payload = response.get_json()

    assert response.status_code == 401
    assert payload['success'] is False


def test_login_challenge_with_totp_stages_second_factor(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-login-challenge-totp.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    private_key_pem, public_key_pem = generate_keys()
    public_key = normalize_public_key(public_key_pem)
    totp_secret = pyotp.random_base32()

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, totp_secret)
            VALUES (1, ?, 'alice', 'Alice', ?)
            ''',
            (public_key, totp_secret),
        )
        conn.commit()

    client = app.test_client()
    challenge_response = client.post('/api/get_challenge', json={'username': 'alice'})
    challenge = challenge_response.get_json()['challenge']
    signature = _signed_login_challenge(challenge, private_key_pem)

    response = client.post(
        '/api/login_challenge',
        json={'signature': signature},
    )
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['requires_totp'] is True
    assert payload['csrf_token']

    with client.session_transaction() as sess:
        assert 'user_id' not in sess
        assert 'public_key_pem' not in sess
        assert sess['pending_totp_user_id'] == 1
        assert sess['pending_totp_public_key'] == public_key
        assert sess['pending_totp_remember'] is True


def test_login_challenge_rejects_expired_challenge_and_clears_session_state(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-login-challenge-expired.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    private_key_pem, public_key_pem = generate_keys()
    public_key = normalize_public_key(public_key_pem)

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, login_vault)
            VALUES (1, ?, 'alice', 'Alice', ?)
            ''',
            (public_key, _valid_login_vault()),
        )
        conn.commit()

    client = app.test_client()
    challenge_response = client.post('/api/get_challenge', json={'username': 'alice'})
    challenge = challenge_response.get_json()['challenge']
    signature = _signed_login_challenge(challenge, private_key_pem)

    with client.session_transaction() as sess:
        sess['challenge_issued_at'] = int(time.time()) - ((5 * 60) + 1)

    response = client.post('/api/login_challenge', json={'signature': signature})
    payload = response.get_json()

    assert response.status_code == 400
    assert payload['success'] is False
    assert 'expired' in str(payload.get('error', '')).lower()

    with client.session_transaction() as sess:
        assert 'challenge' not in sess
        assert 'login_username' not in sess
        assert 'challenge_issued_at' not in sess
        assert 'user_id' not in sess
        assert 'public_key_pem' not in sess


def test_register_client_rejects_invalid_or_expired_challenge_and_bad_vault(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-register-negative.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    client = app.test_client()

    response = client.post(
        '/api/register_client',
        json={
            'username': 'alice',
            'display_name': 'Alice',
            'public_key': 'fake-key',
            'register_challenge': 'missing-challenge',
            'register_signature': 'bad-signature',
        },
    )
    assert response.status_code == 400
    assert response.get_json() == {
        'success': False,
        'error': 'Регистрационный challenge недействителен. Повторите попытку.',
    }

    response = client.post('/api/get_register_challenge')
    challenge = response.get_json()['challenge']
    with client.session_transaction() as sess:
        sess['register_challenge_issued_at'] = int(time.time()) - (auth_routes._REGISTER_CHALLENGE_TTL_SECONDS + 1)

    response = client.post(
        '/api/register_client',
        json={
            'username': 'alice',
            'display_name': 'Alice',
            'public_key': 'fake-key',
            'register_challenge': challenge,
            'register_signature': 'bad-signature',
        },
    )
    assert response.status_code == 400
    assert response.get_json() == {
        'success': False,
        'error': 'Регистрационный challenge устарел. Повторите попытку.',
    }

    response = client.post('/api/get_register_challenge')
    challenge = response.get_json()['challenge']
    response = client.post(
        '/api/register_client',
        json={
            'username': 'alice',
            'display_name': 'Alice',
            'public_key': 'fake-key',
            'login_vault': '{"bad":true}',
            'register_challenge': challenge,
            'register_signature': 'bad-signature',
        },
    )
    assert response.status_code == 400
    assert response.get_json() == {
        'success': False,
        'error': 'Некорректный формат login_vault.',
    }



def test_register_client_rejects_too_long_username_and_display_name(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-register-length-limits.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    client = app.test_client()
    private_key_pem, public_key_pem = generate_keys()
    public_key = normalize_public_key(public_key_pem)

    challenge_response = client.post('/api/get_register_challenge')
    challenge = challenge_response.get_json()['challenge']
    signature = _signed_login_challenge(challenge, private_key_pem)

    response = client.post(
        '/api/register_client',
        json={
            'username': 'a' * 51,
            'display_name': 'Alice',
            'public_key': public_key,
            'register_challenge': challenge,
            'register_signature': signature,
        },
    )
    assert response.status_code == 400
    assert response.get_json() == {
        'success': False,
        'error': 'Никнейм не должен превышать 50 символов.',
    }

    challenge_response = client.post('/api/get_register_challenge')
    challenge = challenge_response.get_json()['challenge']
    signature = _signed_login_challenge(challenge, private_key_pem)

    response = client.post(
        '/api/register_client',
        json={
            'username': 'alice',
            'display_name': 'A' * 51,
            'public_key': public_key,
            'register_challenge': challenge,
            'register_signature': signature,
        },
    )
    assert response.status_code == 400
    assert response.get_json() == {
        'success': False,
        'error': 'Отображаемое имя не должно превышать 50 символов.',
    }


def test_register_username_status_normalizes_and_reports_availability(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-register-username-status.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    client = app.test_client()

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.commit()

    taken_response = client.post('/api/register_username_status', json={'username': '@Alice'})
    assert taken_response.status_code == 200
    assert taken_response.get_json() == {
        'success': True,
        'username': 'alice',
        'available': False,
        'error': 'Имя пользователя уже занято.',
    }

    available_response = client.post('/api/register_username_status', json={'username': 'bob_2'})
    assert available_response.status_code == 200
    assert available_response.get_json() == {
        'success': True,
        'username': 'bob_2',
        'available': True,
        'error': '',
    }

    invalid_response = client.post('/api/register_username_status', json={'username': 'bad-name'})
    assert invalid_response.status_code == 400
    assert invalid_response.get_json() == {
        'success': False,
        'error': 'Никнейм может содержать только a–z, 0–9, _',
    }


def test_register_client_success_keeps_totp_optional_and_allows_direct_login(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-register-optional-totp.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    client = app.test_client()
    private_key_pem, public_key_pem = generate_keys()
    public_key = normalize_public_key(public_key_pem)
    login_vault = _valid_login_vault()

    register_challenge_response = client.post('/api/get_register_challenge')
    register_challenge_payload = register_challenge_response.get_json()
    register_challenge = register_challenge_payload['challenge']
    register_signature = _signed_login_challenge(register_challenge, private_key_pem)

    register_response = client.post(
        '/api/register_client',
        json={
            'username': 'alice',
            'public_key': public_key,
            'login_vault': login_vault,
            'register_challenge': register_challenge,
            'register_signature': register_signature,
            'language': 'ru',
        },
    )
    register_payload = register_response.get_json()

    assert register_response.status_code == 200
    assert register_payload['success'] is True
    assert register_payload['session_auto_logout_seconds'] == 30 * 24 * 60 * 60
    assert register_payload['session_expires_at'] > int(time.time())

    with _connect(db_path) as conn:
        user = conn.execute(
            'SELECT id, username, display_name, public_key, totp_secret, totp_enabled_at FROM users WHERE username = ?',
            ('alice',),
        ).fetchone()
        user_id = int(user['id']) if user else 0
        saved_messages_chat_id = generate_chat_id(public_key, public_key)
        saved_chat = conn.execute(
            'SELECT chat_id, chat_name FROM chats WHERE chat_id = ?',
            (saved_messages_chat_id,),
        ).fetchone()
        self_contact = conn.execute(
            'SELECT user_id, contact_id, chat_id FROM contacts WHERE user_id = ? AND contact_id = ?',
            (user_id, user_id),
        ).fetchone()
    assert user
    assert user['public_key'] == public_key
    assert user['display_name'] == 'alice'
    assert user['totp_secret'] is None
    assert user['totp_enabled_at'] is None
    assert saved_chat
    assert saved_chat['chat_id'] == saved_messages_chat_id
    assert saved_chat['chat_name'] == 'Saved Messages'
    assert self_contact
    assert self_contact['chat_id'] == saved_messages_chat_id

    challenge_response = client.post('/api/get_challenge', json={'username': 'alice'})
    challenge = challenge_response.get_json()['challenge']
    signature = _signed_login_challenge(challenge, private_key_pem)

    login_response = client.post('/api/login_challenge', json={'signature': signature})
    login_payload = login_response.get_json()

    assert login_response.status_code == 200
    assert login_payload['success'] is True
    assert login_payload.get('requires_totp') is not True
    assert login_payload['session_auto_logout_seconds'] == 30 * 24 * 60 * 60
    assert login_payload['session_expires_at'] > int(time.time())

    with client.session_transaction() as sess:
        assert sess['user_id'] == int(user['id'])
        assert sess['public_key_pem'] == public_key
        assert 'pending_totp_user_id' not in sess
        assert 'pending_totp_public_key' not in sess


def test_register_login_refresh_logout_full_session_cycle(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-full-session-cycle.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    client = app.test_client()

    private_key_pem, public_key_pem = generate_keys()
    public_key = normalize_public_key(public_key_pem)
    login_vault = _valid_login_vault()

    register_challenge_res = client.post('/api/get_register_challenge')
    register_challenge = register_challenge_res.get_json()['challenge']
    register_signature = _signed_login_challenge(register_challenge, private_key_pem)

    register_res = client.post(
        '/api/register_client',
        json={
            'username': 'alice',
            'display_name': 'Alice',
            'public_key': public_key,
            'login_vault': login_vault,
            'register_challenge': register_challenge,
            'register_signature': register_signature,
            'language': 'ru',
        },
    )
    assert register_res.status_code == 200
    register_payload = register_res.get_json()
    assert register_payload['success'] is True
    assert register_payload['session_auto_logout_seconds'] == 30 * 24 * 60 * 60
    assert register_payload['session_expires_at'] > int(time.time())

    challenge_res = client.post('/api/get_challenge', json={'username': 'alice'})
    challenge_payload = challenge_res.get_json()
    assert challenge_res.status_code == 200
    assert challenge_payload['success'] is True
    challenge = challenge_payload['challenge']

    login_signature = _signed_login_challenge(challenge, private_key_pem)
    login_res = client.post(
        '/api/login_challenge',
        json={'signature': login_signature},
    )
    assert login_res.status_code == 200
    login_payload = login_res.get_json()
    assert login_payload['success'] is True
    assert login_payload['session_auto_logout_seconds'] == 30 * 24 * 60 * 60
    assert login_payload['session_expires_at'] > int(time.time())
    assert any(REFRESH_COOKIE_NAME in cookie for cookie in login_res.headers.getlist('Set-Cookie'))

    with client.session_transaction() as sess:
        assert sess['user_id']
        assert sess['public_key_pem'] == public_key
        assert sess.permanent is True

    refresh_res = client.post('/api/refresh')
    refresh_payload = refresh_res.get_json()
    assert refresh_res.status_code == 200
    assert refresh_payload['success'] is True
    assert refresh_payload['csrf_token']
    assert refresh_payload['session_auto_logout_seconds'] == 30 * 24 * 60 * 60
    assert refresh_payload['session_expires_at'] > int(time.time())
    assert any(REFRESH_COOKIE_NAME in cookie for cookie in refresh_res.headers.getlist('Set-Cookie'))

    with client.session_transaction() as sess:
        assert sess['user_id']
        assert sess['public_key_pem'] == public_key
        assert sess.permanent is True

    logout_res = client.post('/api/logout')
    assert logout_res.status_code == 200
    assert logout_res.get_json() == {'success': True}
    assert any(f'{REFRESH_COOKIE_NAME}=;' in cookie for cookie in logout_res.headers.getlist('Set-Cookie'))

    with client.session_transaction() as sess:
        assert 'user_id' not in sess
        assert 'public_key_pem' not in sess

    after_logout_refresh = client.post('/api/refresh')
    assert after_logout_refresh.status_code == 401


def test_login_totp_and_get_login_vault_cover_success_and_invalid_storage(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-totp-vault.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    totp_secret = pyotp.random_base32()
    valid_vault = _valid_login_vault()

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, totp_secret, login_vault)
            VALUES (1, 'pk-1', 'alice', 'Alice', ?, ?)
            ''',
            (totp_secret, valid_vault),
        )
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, login_vault)
            VALUES (2, 'pk-2', 'bob', 'Bob', '{"broken":true}')
            '''
        )
        conn.commit()

    client = app.test_client()
    standalone_response = client.post(
        '/api/login_totp',
        json={'username': 'alice', 'totp_code': pyotp.TOTP(totp_secret).now()},
    )
    assert standalone_response.status_code == 401
    assert standalone_response.get_json() == {'success': False, 'error': 'Сначала подтвердите вход словами восстановления.'}

    _stage_pending_totp(client, user_id=1, public_key='pk-1', remember=True)

    response = client.post(
        '/api/login_totp',
        json={'totp_code': pyotp.TOTP(totp_secret).now()},
    )
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert 'access_token' not in payload
    assert REFRESH_COOKIE_NAME in response.headers.getlist('Set-Cookie')[0]

    with client.session_transaction() as sess:
        assert sess['user_id'] == 1
        assert sess['public_key_pem'] == 'pk-1'
        assert 'pending_totp_user_id' not in sess
        assert 'pending_totp_public_key' not in sess
        assert sess.permanent is True

    response = client.get('/api/get_login_vault')
    assert response.status_code == 200
    assert response.get_json() == {'success': True, 'login_vault': json.dumps(json.loads(valid_vault), separators=(',', ':'))}

    broken_client = _authed_client(app, 2, 'pk-2')
    response = broken_client.get('/api/get_login_vault')
    assert response.status_code == 500
    assert response.get_json() == {'success': False, 'error': 'Повреждённые данные сейфа.'}


def test_login_totp_backup_code_revokes_existing_refresh_tokens(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-totp-backup-revoke.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    totp_secret = pyotp.random_base32()
    backup_code = 'ABCD1234EF'

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, totp_secret, login_vault)
            VALUES (1, 'pk-1', 'alice', 'Alice', ?, ?)
            ''',
            (totp_secret, _valid_login_vault()),
        )
        with app.app_context():
            store_backup_codes(conn, 1, [backup_code])
        conn.commit()

    with app.test_request_context('/api/refresh', headers={'User-Agent': 'old-device'}):
        old_raw, _ = issue_refresh_token(1, family_id='family-old')

    client = app.test_client()
    _stage_pending_totp(client, user_id=1, public_key='pk-1', remember=True)
    response = client.post('/api/login_totp', json={'backup_code': backup_code})

    assert response.status_code == 200
    assert response.get_json()['success'] is True
    with app.test_request_context('/api/refresh', headers={'User-Agent': 'old-device'}):
        assert rotate_refresh_token(old_raw) is None


def test_login_totp_without_remember_uses_cookie_session_policy(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-totp-no-remember.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    totp_secret = pyotp.random_base32()

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, totp_secret)
            VALUES (1, 'pk-1', 'alice', 'Alice', ?)
            ''',
            (totp_secret,),
        )
        conn.commit()

    client = app.test_client()
    _stage_pending_totp(client, user_id=1, public_key='pk-1', remember=False)
    response = client.post(
        '/api/login_totp',
        json={'totp_code': pyotp.TOTP(totp_secret).now()},
    )
    assert response.status_code == 200
    assert response.get_json()['success'] is True
    assert any(REFRESH_COOKIE_NAME in cookie for cookie in response.headers.getlist('Set-Cookie'))

    response = client.get('/api/get_login_vault')
    assert response.status_code == 200

    with client.session_transaction() as sess:
        assert sess.permanent is True
        assert sess['ui_language'] == 'ru'


def test_key_rotation_requires_new_login_vault(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-key-rotation-requires-vault.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    old_private_key, old_public_key = generate_keys()
    _new_private_key, new_public_key = generate_keys()
    old_public_normalized = normalize_public_key(old_public_key)
    new_public_normalized = normalize_public_key(new_public_key)

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, login_vault)
            VALUES (1, ?, 'alice', 'Alice', ?)
            ''',
            (old_public_normalized, _valid_login_vault()),
        )
        conn.commit()

    ts = int(time.time())
    signature = _signed_key_rotation_payload(
        old_private_key_pem=old_private_key,
        old_public_key=old_public_normalized,
        new_public_key=new_public_normalized,
        ts=ts,
    )
    client = _authed_client(app, 1, old_public_normalized)
    response = client.post(
        '/api/keys/rotate',
        json={
            'new_public_key': new_public_normalized,
            'signature': signature,
            'ts': ts,
            'new_login_vault': None,
        },
    )

    assert response.status_code == 400
    assert response.get_json()['success'] is False
    with _connect(db_path) as conn:
        row = conn.execute('SELECT public_key FROM users WHERE id = 1').fetchone()
    assert row['public_key'] == old_public_normalized


def test_key_rotation_updates_public_key_vault_and_clears_session(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-key-rotation-success.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    old_private_key, old_public_key = generate_keys()
    _new_private_key, new_public_key = generate_keys()
    old_public_normalized = normalize_public_key(old_public_key)
    new_public_normalized = normalize_public_key(new_public_key)
    old_vault = _valid_login_vault()
    new_vault = json.dumps(
        {
            'v': 1,
            'iv': base64.b64encode(b'abcdef012345').decode('ascii'),
            'data': base64.b64encode(b'new-encrypted-vault').decode('ascii'),
        }
    )

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, login_vault)
            VALUES (1, ?, 'alice', 'Alice', ?)
            ''',
            (old_public_normalized, old_vault),
        )
        conn.commit()

    with app.test_request_context('/api/refresh', headers={'User-Agent': 'old-device'}):
        old_raw, _ = issue_refresh_token(1, family_id='family-old')

    ts = int(time.time())
    signature = _signed_key_rotation_payload(
        old_private_key_pem=old_private_key,
        old_public_key=old_public_normalized,
        new_public_key=new_public_normalized,
        ts=ts,
    )
    client = _authed_client(app, 1, old_public_normalized)
    response = client.post(
        '/api/keys/rotate',
        json={
            'new_public_key': new_public_normalized,
            'signature': signature,
            'ts': ts,
            'new_login_vault': new_vault,
        },
    )

    assert response.status_code == 200
    assert response.get_json()['success'] is True
    with _connect(db_path) as conn:
        row = conn.execute('SELECT public_key, login_vault FROM users WHERE id = 1').fetchone()
    assert row['public_key'] == new_public_normalized
    assert json.loads(row['login_vault']) == json.loads(new_vault)
    with client.session_transaction() as sess:
        assert 'user_id' not in sess
        assert 'public_key_pem' not in sess
    with app.test_request_context('/api/refresh', headers={'User-Agent': 'old-device'}):
        assert rotate_refresh_token(old_raw) is None


def test_expired_cookie_session_is_cleared_by_auto_logout(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-session-auto-logout-expired.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, login_vault)
            VALUES (1, 'pk-1', 'alice', 'Alice', ?)
            ''',
            (_valid_login_vault(),),
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')
    with client.session_transaction() as sess:
        sess['session_auto_logout_seconds'] = 7 * 24 * 60 * 60
        sess['session_expires_at'] = int(time.time()) - 1

    response = client.get('/api/get_login_vault')

    assert response.status_code == 401
    assert response.get_json() == {'success': False, 'error': 'Сессия истекла.'}
    with client.session_transaction() as sess:
        assert 'user_id' not in sess
        assert 'public_key_pem' not in sess


def test_totp_manage_enable_stages_pending_setup_and_status(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-totp-setup-status.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, totp_secret, totp_enabled_at)
            VALUES (1, 'pk-1', 'alice', 'Alice', NULL, NULL)
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')

    enable_response = client.post('/api/totp_manage', json={'action': 'enable'})
    assert enable_response.status_code == 200
    enable_payload = enable_response.get_json()
    assert enable_payload['success'] is True
    assert enable_payload['enabled'] is False
    assert enable_payload['setup_pending'] is True
    assert isinstance(enable_payload['totp_secret'], str) and enable_payload['totp_secret']
    assert isinstance(enable_payload['totp_uri'], str) and enable_payload['totp_uri']

    staged_secret = enable_payload['totp_secret']

    with client.session_transaction() as sess:
        assert sess['pending_totp_setup_user_id'] == 1
        assert sess['pending_totp_setup_secret'] == staged_secret
        assert isinstance(sess['pending_totp_setup_issued_at'], int)

    with _connect(db_path) as conn:
        user = conn.execute('SELECT totp_secret, totp_enabled_at FROM users WHERE id = 1').fetchone()
    assert user['totp_secret'] is None
    assert user['totp_enabled_at'] is None

    status_response = client.get('/api/totp_status')
    assert status_response.status_code == 200
    status_payload = status_response.get_json()
    assert status_payload['success'] is True
    assert status_payload['enabled'] is False
    assert status_payload['setup_pending'] is True
    assert status_payload['totp_secret'] == staged_secret
    assert isinstance(status_payload['totp_uri'], str) and status_payload['totp_uri']


def test_totp_setup_verify_persists_secret_and_clears_pending(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-totp-setup-verify.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, totp_secret, totp_enabled_at)
            VALUES (1, 'pk-1', 'alice', 'Alice', NULL, NULL)
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')
    enable_response = client.post('/api/totp_manage', json={'action': 'enable'})
    staged_secret = enable_response.get_json()['totp_secret']

    verify_response = client.post(
        '/api/totp_setup/verify',
        json={'totp_code': pyotp.TOTP(staged_secret).now()},
    )
    assert verify_response.status_code == 200
    verify_payload = verify_response.get_json()
    assert verify_payload['success'] is True
    assert verify_payload['enabled'] is True
    assert verify_payload['setup_pending'] is False
    assert isinstance(verify_payload['totp_enabled_at'], str) and verify_payload['totp_enabled_at']

    with _connect(db_path) as conn:
        user = conn.execute('SELECT totp_secret, totp_enabled_at FROM users WHERE id = 1').fetchone()
    assert user['totp_secret'] != staged_secret
    assert str(user['totp_secret']).startswith('fernet:')
    assert user['totp_enabled_at']

    with client.session_transaction() as sess:
        assert 'pending_totp_setup_user_id' not in sess
        assert 'pending_totp_setup_secret' not in sess
        assert 'pending_totp_setup_issued_at' not in sess

    status_response = client.get('/api/totp_status')
    status_payload = status_response.get_json()
    assert status_response.status_code == 200
    assert status_payload['success'] is True
    assert status_payload['enabled'] is True
    assert status_payload['setup_pending'] is False
    assert status_payload['totp_secret'] == ''
    assert status_payload['totp_uri'] == ''


def test_auth_index_detects_language_by_country(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-index-language.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    cis_client = app.test_client()
    global_client = app.test_client()

    cis_response = cis_client.get('/', headers={'CF-IPCountry': 'KZ'})
    global_response = global_client.get('/', headers={'CF-IPCountry': 'US', 'Accept-Language': 'en-US,en;q=0.9'})

    assert cis_response.status_code == 200
    assert b'<html lang="ru">' in cis_response.data
    assert global_response.status_code == 200
    assert b'<html lang="en">' in global_response.data


def test_auth_index_reset_client_clears_browser_state(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-index-reset-client.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    plain_response = app.test_client().get('/')
    response = app.test_client().get('/?reset_client=1')

    assert 'Clear-Site-Data' not in plain_response.headers
    assert response.status_code == 200
    assert response.headers['Clear-Site-Data'] == '"cache", "cookies", "storage", "executionContexts"'


def test_reset_client_page_unregisters_service_workers(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-reset-client-page.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    response = app.test_client().get('/reset-client')

    assert response.status_code == 200
    assert response.headers['Clear-Site-Data'] == '"cache", "cookies", "storage", "executionContexts"'
    assert b'navigator.serviceWorker.getRegistrations' in response.data
    assert b'caches.keys' in response.data
    assert b'window.location.replace' in response.data


def test_api_save_settings_updates_language(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-save-settings-language.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, language)
            VALUES (1, 'pk-1', 'alice', 'Alice', 'ru')
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')
    response = client.post('/api/save_settings', json={'language': 'en'})

    assert response.status_code == 200
    assert response.get_json() == {'success': True}

    response = client.get('/api/get_settings')
    assert response.status_code == 200
    assert response.get_json()['language'] == 'en'

    with _connect(db_path) as conn:
        row = conn.execute('SELECT language FROM users WHERE id = 1').fetchone()

    assert row['language'] == 'en'

    with client.session_transaction() as sess:
        assert sess['ui_language'] == 'en'


def test_api_save_settings_persists_client_preferences(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-save-settings-client-preferences.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, language)
            VALUES (1, 'pk-1', 'alice', 'Alice', 'ru')
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')
    response = client.post(
        '/api/save_settings',
        json={
            'client_preferences': {
                'darkMode': True,
                'messageScale': 1.5,
                'performanceMode': 'lite',
                'motionLevel': 'balanced',
                'sendShortcut': 'ctrl_enter',
                'timeFormat': '12h',
                'interfaceSurfaceMode': 'solid',
                'sidebarWeatherEnabled': True,
                'sidebarWeatherSource': 'city',
                'sidebarWeatherCity': 'Москва',
                'sidebarWeatherRotateSeconds': 30,
                'sidebarWeatherMetrics': ['temperature', 'humidity', 'aqi', 'aqi', 'invalid'],
                'interfaceThemeStore': {
                    'version': 2,
                    'themes': {
                        'light': {'accent': '#c58a22'},
                        'dark': {'accent': '#d6a449'},
                    },
                },
                'chatAppearanceStore': {
                    'themes': {
                        'light': {'mode': 'color', 'color': '#ffffff'},
                        'dark': {'mode': 'color', 'color': '#111111'},
                    },
                },
                'unknown': 'drop-me',
            },
        },
    )

    assert response.status_code == 200
    assert response.get_json() == {'success': True}

    with _connect(db_path) as conn:
        row = conn.execute('SELECT client_preferences FROM users WHERE id = 1').fetchone()

    stored_preferences = json.loads(row['client_preferences'])
    assert stored_preferences['darkMode'] is True
    assert stored_preferences['messageScale'] == 1.3
    assert stored_preferences['performanceMode'] == 'lite'
    assert stored_preferences['motionLevel'] == 'balanced'
    assert stored_preferences['sendShortcut'] == 'ctrl_enter'
    assert stored_preferences['timeFormat'] == '12h'
    assert stored_preferences['interfaceSurfaceMode'] == 'solid'
    assert stored_preferences['sidebarWeatherEnabled'] is True
    assert stored_preferences['sidebarWeatherSource'] == 'city'
    assert stored_preferences['sidebarWeatherCity'] == 'Москва'
    assert stored_preferences['sidebarWeatherRotateSeconds'] == 30
    assert stored_preferences['sidebarWeatherMetrics'] == ['temperature', 'humidity', 'aqi']
    assert 'interfaceThemeStore' in stored_preferences
    assert 'chatAppearanceStore' in stored_preferences
    assert 'unknown' not in stored_preferences

    get_response = client.get('/api/get_settings')
    assert get_response.status_code == 200
    assert get_response.get_json()['client_preferences'] == stored_preferences


def test_api_save_settings_rejects_non_object_client_preferences(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-save-settings-client-preferences-invalid.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')
    response = client.post('/api/save_settings', json={'client_preferences': 'invalid'})

    assert response.status_code == 400
    assert response.get_json() == {
        'success': False,
        'error': 'Поле "client_preferences" должно быть объектом.',
    }


def test_api_save_settings_skips_profile_broadcast_when_profile_fields_unchanged(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-save-settings-no-profile-broadcast.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    emitted = _capture_socket_emits(monkeypatch)

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (
                id, public_key, username, display_name, language, hide_online_status
            )
            VALUES
                (1, 'pk-1', 'alice', 'Alice', 'ru', 0),
                (2, 'pk-2', 'bob', 'Bob', 'ru', 0)
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, 'chat-1'), (2, 1, 'chat-1')
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')
    response = client.post('/api/save_settings', json={'language': 'en'})

    assert response.status_code == 200
    assert response.get_json() == {'success': True}
    assert emitted == []

    with client.session_transaction() as sess:
        assert sess['ui_language'] == 'en'


def test_api_save_settings_emits_profile_and_hidden_status_updates(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-save-settings-hide.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    emitted = _capture_socket_emits(monkeypatch)

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (
                id, public_key, username, display_name, hide_online_status, is_online, last_seen
            )
            VALUES
                (1, 'pk-1', 'alice', 'Alice', 0, 1, '2025-01-01 10:00:00'),
                (2, 'pk-2', 'bob', 'Bob', 0, 0, NULL),
                (3, 'pk-3', 'carol', 'Carol', 0, 0, NULL)
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES
                (1, 2, 'chat-1'), (2, 1, 'chat-1'),
                (1, 3, 'chat-2'), (3, 1, 'chat-2')
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')

    response = client.post(
        '/api/save_settings',
        json={
            'username': 'alice_new',
            'display_name': 'Alice New',
            'hide_online_status': True,
            'avatar_visibility': 'contacts',
        },
    )

    assert response.status_code == 200
    assert response.get_json() == {'success': True}

    with _connect(db_path) as conn:
        user_row = conn.execute(
            '''
            SELECT username, display_name, hide_online_status, avatar_visibility
            FROM users
            WHERE id = 1
            '''
        ).fetchone()

    assert user_row['username'] == 'alice_new'
    assert user_row['display_name'] == 'Alice New'
    assert bool(user_row['hide_online_status']) is True
    assert user_row['avatar_visibility'] == 'contacts'
    assert [event['name'] for event in emitted] == [
        'profile_updated',
        'profile_updated',
        'own_profile_updated',
        'user_status',
        'user_status',
    ]
    assert emitted[0]['kwargs']['room'] == 'pk-2'
    assert emitted[1]['kwargs']['room'] == 'pk-3'
    assert emitted[2]['kwargs']['room'] == 'pk-1'
    assert emitted[3]['payload'] == {'public_key': 'pk-1', 'online': False, 'last_seen': None}
    assert emitted[4]['payload'] == {'public_key': 'pk-1', 'online': False, 'last_seen': None}


def test_api_save_settings_emits_profile_updates_when_only_bio_changes(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-save-settings-bio-only.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    emitted = _capture_socket_emits(monkeypatch)

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (
                id, public_key, username, display_name, bio, hide_online_status, is_online, last_seen
            )
            VALUES
                (1, 'pk-1', 'alice', 'Alice', 'old bio', 0, 1, '2025-01-01 10:00:00'),
                (2, 'pk-2', 'bob', 'Bob', '', 0, 0, NULL)
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, 'chat-1'), (2, 1, 'chat-1')
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')
    response = client.post('/api/save_settings', json={'bio': 'new bio'})

    assert response.status_code == 200
    assert response.get_json() == {'success': True}
    assert [event['name'] for event in emitted] == [
        'profile_updated',
        'own_profile_updated',
    ]
    assert emitted[0]['kwargs']['room'] == 'pk-2'
    assert emitted[1]['kwargs']['room'] == 'pk-1'
    assert emitted[0]['payload']['bio'] == 'new bio'
    assert emitted[1]['payload']['bio'] == 'new bio'


def test_api_save_settings_emits_real_status_when_unhiding(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-save-settings-unhide.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    emitted = _capture_socket_emits(monkeypatch)
    monkeypatch.setattr(auth_routes, 'is_effectively_online', lambda pub, persisted=False: True)

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (
                id, public_key, username, display_name, hide_online_status, is_online, last_seen
            )
            VALUES
                (1, 'pk-1', 'alice', 'Alice', 1, 0, '2025-01-01 10:00:00'),
                (2, 'pk-2', 'bob', 'Bob', 0, 0, NULL)
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, 'chat-1'), (2, 1, 'chat-1')
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')

    response = client.post('/api/save_settings', json={'hide_online_status': False})
    assert response.status_code == 200
    assert response.get_json() == {'success': True}

    user_status_events = [event for event in emitted if event['name'] == 'user_status']
    assert user_status_events == [
        {
            'name': 'user_status',
            'payload': {'public_key': 'pk-1', 'online': True, 'last_seen': None},
            'args': (),
            'kwargs': {'room': 'pk-2'},
        }
    ]


def test_api_save_settings_hides_internal_sql_errors(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-save-settings-db-error.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    client = _authed_client(app, 1, 'pk-1')

    class _BrokenConnection:
        def execute(self, *_args, **_kwargs):
            raise DatabaseError('sensitive_db_error_payload')

        def close(self):
            return None

    monkeypatch.setattr(auth_routes, 'get_db_connection', lambda: _BrokenConnection())

    response = client.post('/api/save_settings', json={'display_name': 'Alice'})
    payload = response.get_json()

    assert response.status_code == 500
    assert payload['success'] is False
    assert payload['error'] == 'Не удалось сохранить настройки. Попробуйте позже.'
    assert 'sensitive_db_error_payload' not in payload['error']


def test_api_save_settings_rejects_empty_username_and_display_name(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-save-settings-empty-fields.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')

    username_response = client.post('/api/save_settings', json={'username': ''})
    display_name_response = client.post('/api/save_settings', json={'display_name': '   '})

    assert username_response.status_code == 400
    assert username_response.get_json() == {'success': False, 'error': 'Никнейм не может быть пустым.'}
    assert display_name_response.status_code == 400
    assert display_name_response.get_json() == {'success': False, 'error': 'Отображаемое имя не может быть пустым.'}

    with _connect(db_path) as conn:
        row = conn.execute('SELECT username, display_name FROM users WHERE id = 1').fetchone()

    assert row['username'] == 'alice'
    assert row['display_name'] == 'Alice'


def test_api_save_settings_rejects_invalid_avatar_visibility(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-save-settings-invalid-visibility.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, avatar_visibility)
            VALUES (1, 'pk-1', 'alice', 'Alice', 'all')
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')
    response = client.post('/api/save_settings', json={'avatar_visibility': 'hack'})

    assert response.status_code == 400
    assert response.get_json() == {'success': False, 'error': 'Недопустимое значение видимости аватара.'}

    with _connect(db_path) as conn:
        row = conn.execute('SELECT avatar_visibility FROM users WHERE id = 1').fetchone()

    assert row['avatar_visibility'] == 'all'


def test_api_save_settings_updates_group_invite_privacy(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-save-settings-group-invite-privacy.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, group_invite_privacy)
            VALUES (1, 'pk-1', 'alice', 'Alice', 'all')
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')
    response = client.post('/api/save_settings', json={'group_invite_privacy': 'contacts'})

    assert response.status_code == 200
    assert response.get_json() == {'success': True}

    with _connect(db_path) as conn:
        row = conn.execute('SELECT group_invite_privacy FROM users WHERE id = 1').fetchone()

    assert row['group_invite_privacy'] == 'contacts'

    response = client.get('/api/get_settings')
    assert response.status_code == 200
    assert response.get_json()['group_invite_privacy'] == 'contacts'


def test_api_save_settings_updates_extended_privacy_controls(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-save-settings-extended-privacy.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')
    response = client.post(
        '/api/save_settings',
        json={
            'read_receipts_privacy': 'contacts',
            'typing_privacy': 'nobody',
            'voice_listened_privacy': 'contacts',
            'call_privacy': 'nobody',
            'public_key_search_privacy': 'contacts',
        },
    )

    assert response.status_code == 200
    assert response.get_json() == {'success': True}

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT read_receipts_privacy, typing_privacy, voice_listened_privacy,
                   call_privacy, public_key_search_privacy
            FROM users
            WHERE id = 1
            '''
        ).fetchone()

    assert row['read_receipts_privacy'] == 'contacts'
    assert row['typing_privacy'] == 'nobody'
    assert row['voice_listened_privacy'] == 'contacts'
    assert row['call_privacy'] == 'nobody'
    assert row['public_key_search_privacy'] == 'contacts'

    response = client.get('/api/get_settings')
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['read_receipts_privacy'] == 'contacts'
    assert payload['typing_privacy'] == 'nobody'
    assert payload['voice_listened_privacy'] == 'contacts'
    assert payload['call_privacy'] == 'nobody'
    assert payload['public_key_search_privacy'] == 'contacts'


def test_api_save_settings_rejects_invalid_group_invite_privacy(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-save-settings-invalid-group-invite-privacy.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, group_invite_privacy)
            VALUES (1, 'pk-1', 'alice', 'Alice', 'all')
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')
    response = client.post('/api/save_settings', json={'group_invite_privacy': 'unknown'})

    assert response.status_code == 400
    assert response.get_json() == {
        'success': False,
        'error': 'Недопустимое значение приватности приглашений в группы.',
    }

    with _connect(db_path) as conn:
        row = conn.execute('SELECT group_invite_privacy FROM users WHERE id = 1').fetchone()

    assert row['group_invite_privacy'] == 'all'


def test_api_save_settings_requires_complete_session(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-save-settings-session-guard.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.commit()

    client = app.test_client()
    with client.session_transaction() as sess:
        sess['public_key_pem'] = 'pk-1'

    response = client.post('/api/save_settings', json={'display_name': 'Alice 2'})

    assert response.status_code == 401
    assert response.get_json() == {'success': False, 'error': 'Не авторизован.'}


def test_api_save_settings_rejects_reset_keys_flag(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-save-settings-reset-keys.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.commit()

    client = _authed_client(app, 1, 'pk-1')
    response = client.post('/api/save_settings', json={'reset_keys': True})

    assert response.status_code == 400
    assert response.get_json() == {
        'success': False,
        'error': 'Сброс ключей на сервере отключён. Используйте восстановление/генерацию ключей на клиенте.'
    }


def test_session_devices_list_and_revoke_endpoints(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-session-devices.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.commit()

    with app.test_request_context('/api/refresh', headers={'User-Agent': 'device-a', 'X-Forwarded-For': '10.0.0.1'}):
        current_raw, _ = issue_refresh_token(1, family_id='family-a')
    with app.test_request_context('/api/refresh', headers={'User-Agent': 'device-b', 'X-Forwarded-For': '10.0.0.2'}):
        other_raw, _ = issue_refresh_token(1, family_id='family-b')

    client = _authed_client(app, 1, 'pk-1')
    client.set_cookie(REFRESH_COOKIE_NAME, current_raw)

    response = client.get('/api/session_devices', headers={'User-Agent': 'browser-main'})
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert len(payload['devices']) == 2
    devices_by_family = {device['family_id']: device for device in payload['devices']}
    assert set(devices_by_family) == {'family-a', 'family-b'}
    assert devices_by_family['family-a']['is_current'] is True
    assert devices_by_family['family-b']['is_current'] is False
    assert devices_by_family['family-a']['persistent'] is True
    assert devices_by_family['family-b']['persistent'] is True
    assert payload['session_auto_logout_seconds'] == 30 * 24 * 60 * 60
    assert [option['seconds'] for option in payload['session_auto_logout_options']] == [
        7 * 24 * 60 * 60,
        30 * 24 * 60 * 60,
        90 * 24 * 60 * 60,
        180 * 24 * 60 * 60,
    ]

    policy_response = client.post(
        '/api/session_devices/auto_logout',
        json={'session_auto_logout_seconds': 7 * 24 * 60 * 60},
    )
    policy_payload = policy_response.get_json()
    assert policy_response.status_code == 200
    assert policy_payload['success'] is True
    assert policy_payload['session_auto_logout_seconds'] == 7 * 24 * 60 * 60
    assert policy_payload['updated_sessions'] == 2
    assert any('Max-Age=604800' in cookie for cookie in policy_response.headers.getlist('Set-Cookie'))

    with _connect(db_path) as conn:
        policy_row = conn.execute(
            'SELECT session_auto_logout_seconds FROM users WHERE id = ?',
            (1,),
        ).fetchone()
        active_rows = conn.execute(
            '''
            SELECT expires_at
            FROM refresh_tokens
            WHERE family_id IN ('family-a', 'family-b') AND revoked_at IS NULL
            '''
        ).fetchall()

    assert policy_row['session_auto_logout_seconds'] == 7 * 24 * 60 * 60
    assert len(active_rows) == 2
    assert all(int(row['expires_at']) <= int(time.time()) + 7 * 24 * 60 * 60 for row in active_rows)

    invalid_policy_response = client.post(
        '/api/session_devices/auto_logout',
        json={'session_auto_logout_seconds': 2 * 24 * 60 * 60},
    )
    assert invalid_policy_response.status_code == 400
    assert invalid_policy_response.get_json()['success'] is False

    response = client.post('/api/session_devices/revoke_others')
    assert response.status_code == 200
    assert response.get_json() == {'success': True, 'revoked': 1}

    with _connect(db_path) as conn:
        revoked_other = conn.execute(
            'SELECT revoked_at FROM refresh_tokens WHERE family_id = ?',
            ('family-b',),
        ).fetchone()
        current_row = conn.execute(
            'SELECT revoked_at FROM refresh_tokens WHERE family_id = ?',
            ('family-a',),
        ).fetchone()

    assert revoked_other['revoked_at'] is not None
    assert current_row['revoked_at'] is None

    response = client.post('/api/session_devices/revoke', json={'family_id': 'family-a'})
    assert response.status_code == 200
    assert response.get_json() == {'success': True, 'revoked': 1, 'signed_out_current': True}
    assert any(f'{REFRESH_COOKIE_NAME}=;' in cookie for cookie in response.headers.getlist('Set-Cookie'))

    with _connect(db_path) as conn:
        current_row = conn.execute(
            'SELECT revoked_at FROM refresh_tokens WHERE family_id = ?',
            ('family-a',),
        ).fetchone()

    assert current_row['revoked_at'] is not None

    fallback_client = _authed_client(app, 1, 'pk-1')
    response = fallback_client.get(
        '/api/session_devices',
        headers={'User-Agent': 'ephemeral-device', 'X-Forwarded-For': '203.0.113.10'},
    )
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['devices'][0]['persistent'] is False
    assert payload['devices'][0]['is_current'] is True
    assert payload['devices'][0]['family_id'] == ''
    assert payload['devices'][0]['user_agent'] == 'ephemeral-device'
    assert payload['devices'][0]['ip'] == '203.0.113.10'


def test_session_devices_includes_current_ephemeral_when_only_other_persistent_exist(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-session-devices-ephemeral-current.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.commit()

    with app.test_request_context('/api/refresh', headers={'User-Agent': 'remembered-device', 'X-Forwarded-For': '10.0.0.77'}):
        issue_refresh_token(1, family_id='family-old')

    client = _authed_client(app, 1, 'pk-1')
    response = client.get(
        '/api/session_devices',
        headers={'User-Agent': 'ephemeral-device', 'X-Forwarded-For': '203.0.113.10'},
    )
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    devices = payload['devices']
    assert any(d['family_id'] == 'family-old' and d['persistent'] is True for d in devices)
    current_devices = [d for d in devices if d['is_current'] is True]
    assert len(current_devices) == 1
    assert current_devices[0]['family_id'] == ''
    assert current_devices[0]['persistent'] is False
    assert current_devices[0]['user_agent'] == 'ephemeral-device'
    assert current_devices[0]['ip'] == '203.0.113.10'


def test_api_refresh_rejects_missing_invalid_and_orphaned_tokens(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-refresh-negative.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES
                (1, 'pk-1', 'alice', 'Alice'),
                (2, 'pk-2', 'bob', 'Bob')
            '''
        )
        conn.commit()

    client = app.test_client()

    response = client.post('/api/refresh')
    assert response.status_code == 401
    assert response.get_json() == {'success': False, 'error': 'Нет refresh-токена.'}

    client.set_cookie(REFRESH_COOKIE_NAME, 'totally-invalid-token')
    response = client.post('/api/refresh')
    assert response.status_code == 401
    assert response.get_json() == {'success': False, 'error': 'Refresh-токен недействителен.'}
    assert any(f'{REFRESH_COOKIE_NAME}=;' in cookie for cookie in response.headers.getlist('Set-Cookie'))

    with app.test_request_context('/api/refresh', headers={'User-Agent': 'orphan-device'}):
        orphan_raw, _ = issue_refresh_token(2)

    with _connect(db_path) as conn:
        conn.execute('DELETE FROM users WHERE id = 2')
        conn.commit()

    orphan_client = app.test_client()
    orphan_client.set_cookie(REFRESH_COOKIE_NAME, orphan_raw)
    response = orphan_client.post('/api/refresh')
    assert response.status_code == 401
    assert response.get_json() == {'success': False, 'error': 'Refresh-токен недействителен.'}
    assert any(f'{REFRESH_COOKIE_NAME}=;' in cookie for cookie in response.headers.getlist('Set-Cookie'))


def test_api_refresh_reestablishes_session_without_access_token(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-refresh-success.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.commit()

    with app.test_request_context('/api/refresh', headers={'User-Agent': 'seed-device', 'X-Forwarded-For': '10.0.0.8'}):
        raw_token, _ = issue_refresh_token(1, family_id='family-refresh')

    client = app.test_client()
    client.set_cookie(REFRESH_COOKIE_NAME, raw_token)
    response = client.post('/api/refresh')
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert isinstance(payload.get('csrf_token'), str)
    assert payload['csrf_token']
    assert 'access_token' not in payload
    assert any(REFRESH_COOKIE_NAME in cookie for cookie in response.headers.getlist('Set-Cookie'))

    with client.session_transaction() as sess:
        assert sess['user_id'] == 1
        assert sess['public_key_pem'] == 'pk-1'
        assert sess.permanent is True


def test_api_refresh_allows_native_restore_without_csrf_header(monkeypatch, tmp_path):
    db_path = tmp_path / 'auth-refresh-native-csrf.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)

    app = create_app('testing', overrides={
        'DATABASE_PATH': str(db_path),
        'WTF_CSRF_ENABLED': True,
    })

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.commit()

    with app.test_request_context('/api/refresh', headers={'User-Agent': 'ios-native'}):
        raw_token, _ = issue_refresh_token(1, family_id='family-native')

    client = app.test_client()
    client.set_cookie(REFRESH_COOKIE_NAME, raw_token)
    response = client.post('/api/refresh')
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['csrf_token']
