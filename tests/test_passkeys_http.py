import time
from pathlib import Path

from app import create_app
from app.routes import auth as auth_routes
from tests._pg_test_db import connect_test_db


class _ConnectionHandle:
    def __init__(self, db_path: Path):
        self._conn = connect_test_db(db_path)

    def __enter__(self):
        return self._conn

    def __exit__(self, exc_type, exc, tb):
        self._conn.close()
        return False


def _connect(db_path: Path) -> _ConnectionHandle:
    return _ConnectionHandle(db_path)


def _authed_client(app, user_id: int, public_key: str):
    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = user_id
        sess['public_key_pem'] = public_key
    return client


def _create_test_app(tmp_path: Path, db_name: str):
    db_path = tmp_path / db_name
    app = create_app(
        'testing',
        overrides={
            'DATABASE_PATH': str(db_path),
            'WEBAUTHN_RP_ID': 'localhost',
            'WEBAUTHN_ORIGIN': 'http://localhost',
        },
    )
    return app, db_path


def test_api_passkeys_requires_auth(tmp_path):
    app, _ = _create_test_app(tmp_path, 'passkeys-unauth.db')
    client = app.test_client()

    response = client.get('/api/passkeys')
    payload = response.get_json()

    assert response.status_code == 401
    assert payload['success'] is False


def test_api_passkeys_returns_authorized_user_rows(tmp_path):
    app, db_path = _create_test_app(tmp_path, 'passkeys-list.db')

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.execute(
            '''
            INSERT INTO user_passkeys (
                user_id,
                credential_id,
                credential_public_key,
                sign_count,
                transports,
                label,
                created_at,
                last_used_at
            )
            VALUES (1, 'cred-1', 'pub-key-1', 5, 'usb,nfc', 'Laptop key', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            '''
        )
        conn.commit()

    client = _authed_client(app, user_id=1, public_key='pk-1')
    response = client.get('/api/passkeys')
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert len(payload['passkeys']) == 1
    assert payload['passkeys'][0]['credential_id'] == 'cred-1'
    assert payload['passkeys'][0]['label'] == 'Laptop key'
    assert payload['passkeys'][0]['transports'] == ['usb', 'nfc']


def test_passkey_login_options_reports_damaged_records(tmp_path, monkeypatch):
    app, db_path = _create_test_app(tmp_path, 'passkeys-login-options.db')

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.execute(
            '''
            INSERT INTO user_passkeys (user_id, credential_id, credential_public_key, sign_count)
            VALUES (1, 'broken-credential', 'pub-key-1', 1)
            '''
        )
        conn.commit()

    class _Descriptor:
        def __init__(self, id):
            self.id = id

    monkeypatch.setattr(auth_routes, 'PublicKeyCredentialDescriptor', _Descriptor)
    monkeypatch.setattr(auth_routes, 'generate_authentication_options', lambda **kwargs: object())
    monkeypatch.setattr(auth_routes, 'options_to_json', lambda _obj: '{}')

    def _raise_bad_base64(_value):
        raise ValueError('bad credential encoding')

    monkeypatch.setattr(auth_routes, 'base64url_to_bytes', _raise_bad_base64)

    client = app.test_client()
    response = client.post(
        '/api/passkey/login/options',
        json={'username': 'alice'},
    )
    payload = response.get_json()

    assert response.status_code == 400
    assert payload['success'] is False
    assert 'Passkey' in str(payload['error'])


def test_passkey_login_verify_updates_sign_count_and_stages_totp(tmp_path, monkeypatch):
    app, db_path = _create_test_app(tmp_path, 'passkeys-login-verify.db')

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, totp_secret)
            VALUES (1, 'pk-1', 'alice', 'Alice', 'JBSWY3DPEHPK3PXP')
            '''
        )
        conn.execute(
            '''
            INSERT INTO user_passkeys (user_id, credential_id, credential_public_key, sign_count)
            VALUES (1, 'cred-1', 'pub-key-1', 3)
            '''
        )
        conn.commit()

    class _VerificationResult:
        new_sign_count = 9

    monkeypatch.setattr(auth_routes, 'base64url_to_bytes', lambda _value: b'bytes')
    monkeypatch.setattr(auth_routes, 'verify_authentication_response', lambda **kwargs: _VerificationResult())

    client = app.test_client()
    with client.session_transaction() as sess:
        sess['pending_passkey_login_user_id'] = 1
        sess['pending_passkey_login_challenge_b64'] = 'challenge-1'
        sess['pending_passkey_login_remember'] = True
        sess['pending_passkey_login_issued_at'] = int(time.time())

    response = client.post(
        '/api/passkey/login/verify',
        json={
            'credential': {
                'id': 'cred-1',
                'rawId': 'cred-1',
                'response': {},
                'type': 'public-key',
            }
        },
    )
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['requires_totp'] is True
    assert payload['csrf_token']

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT sign_count, last_used_at
            FROM user_passkeys
            WHERE user_id = 1 AND credential_id = 'cred-1'
            '''
        ).fetchone()
    assert int(row['sign_count']) == 9
    assert row['last_used_at'] is not None

    with client.session_transaction() as sess:
        assert sess.get('pending_totp_user_id') == 1
        assert sess.get('pending_totp_public_key') == 'pk-1'
        assert sess.get('pending_totp_remember') is True


def test_passkeys_register_options_requires_auth(tmp_path, monkeypatch):
    app, _ = _create_test_app(tmp_path, 'passkeys-register-options-unauth.db')
    monkeypatch.setattr(auth_routes, 'generate_registration_options', lambda **kwargs: object())

    client = app.test_client()
    response = client.post('/api/passkeys/register/options', json={})
    payload = response.get_json()

    assert response.status_code == 401
    assert payload['success'] is False


def test_passkeys_register_options_stages_pending_context(tmp_path, monkeypatch):
    app, db_path = _create_test_app(tmp_path, 'passkeys-register-options-ok.db')

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.execute(
            '''
            INSERT INTO user_passkeys (user_id, credential_id, credential_public_key, sign_count)
            VALUES (1, 'cred-old', 'pub-key-old', 1)
            '''
        )
        conn.commit()

    class _Descriptor:
        def __init__(self, id):
            self.id = id

    captured = {}

    def _fake_generate_registration_options(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(auth_routes, 'PublicKeyCredentialDescriptor', _Descriptor)
    monkeypatch.setattr(auth_routes, 'base64url_to_bytes', lambda value: f'decoded:{value}'.encode('utf-8'))
    monkeypatch.setattr(auth_routes, 'generate_registration_options', _fake_generate_registration_options)
    monkeypatch.setattr(auth_routes, 'options_to_json', lambda _obj: '{"publicKey":{"challenge":"abc"}}')

    client = _authed_client(app, user_id=1, public_key='pk-1')
    response = client.post('/api/passkeys/register/options', json={})
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['options']['publicKey']['challenge'] == 'abc'
    assert len(captured['exclude_credentials']) == 1
    assert captured['exclude_credentials'][0].id == b'decoded:cred-old'

    with client.session_transaction() as sess:
        assert sess.get('pending_passkey_register_user_id') == 1
        assert str(sess.get('pending_passkey_register_challenge_b64') or '').strip()
        assert int(sess.get('pending_passkey_register_issued_at') or 0) > 0


def test_passkeys_register_verify_requires_pending_context(tmp_path):
    app, db_path = _create_test_app(tmp_path, 'passkeys-register-verify-pending.db')

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.commit()

    client = _authed_client(app, user_id=1, public_key='pk-1')
    response = client.post('/api/passkeys/register/verify', json={'credential': {'id': 'cred-1'}})
    payload = response.get_json()

    assert response.status_code == 401
    assert payload['success'] is False


def test_passkeys_register_verify_persists_passkey(tmp_path, monkeypatch):
    app, db_path = _create_test_app(tmp_path, 'passkeys-register-verify-ok.db')

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.commit()

    class _VerificationResult:
        credential_id = b'cred-bytes'
        credential_public_key = b'pub-bytes'
        sign_count = 7

    def _fake_bytes_to_base64url(value):
        if value == b'cred-bytes':
            return 'cred-2'
        if value == b'pub-bytes':
            return 'pub-2'
        return 'challenge-2'

    monkeypatch.setattr(auth_routes, 'base64url_to_bytes', lambda _value: b'challenge')
    monkeypatch.setattr(auth_routes, 'bytes_to_base64url', _fake_bytes_to_base64url)
    monkeypatch.setattr(auth_routes, 'verify_registration_response', lambda **kwargs: _VerificationResult())

    client = _authed_client(app, user_id=1, public_key='pk-1')
    with client.session_transaction() as sess:
        sess['pending_passkey_register_user_id'] = 1
        sess['pending_passkey_register_challenge_b64'] = 'challenge-2'
        sess['pending_passkey_register_issued_at'] = int(time.time())

    response = client.post(
        '/api/passkeys/register/verify',
        json={
            'label': 'Laptop',
            'credential': {
                'id': 'cred-any',
                'response': {'transports': ['usb', 'nfc', 'usb']},
            },
        },
    )
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT credential_id, credential_public_key, sign_count, transports, label
            FROM user_passkeys
            WHERE user_id = 1 AND credential_id = 'cred-2'
            '''
        ).fetchone()

    assert row is not None
    assert row['credential_public_key'] == 'pub-2'
    assert int(row['sign_count']) == 7
    assert row['transports'] == 'usb,nfc'
    assert row['label'] == 'Laptop'

    with client.session_transaction() as sess:
        assert sess.get('pending_passkey_register_user_id') is None
        assert sess.get('pending_passkey_register_challenge_b64') is None
        assert sess.get('pending_passkey_register_issued_at') is None


def test_passkeys_delete_not_found_and_success(tmp_path):
    app, db_path = _create_test_app(tmp_path, 'passkeys-delete.db')

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.commit()

    client = _authed_client(app, user_id=1, public_key='pk-1')

    not_found_response = client.post('/api/passkeys/delete', json={'credential_id': 'missing'})
    not_found_payload = not_found_response.get_json()
    assert not_found_response.status_code == 404
    assert not_found_payload['success'] is False

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO user_passkeys (user_id, credential_id, credential_public_key, sign_count)
            VALUES (1, 'cred-del', 'pub-key-del', 1)
            '''
        )
        conn.commit()

    ok_response = client.post('/api/passkeys/delete', json={'credential_id': 'cred-del'})
    ok_payload = ok_response.get_json()
    assert ok_response.status_code == 200
    assert ok_payload['success'] is True

    with _connect(db_path) as conn:
        row = conn.execute(
            "SELECT 1 FROM user_passkeys WHERE user_id = 1 AND credential_id = 'cred-del'"
        ).fetchone()
    assert row is None


def test_passkey_login_options_stages_pending_context(tmp_path, monkeypatch):
    app, db_path = _create_test_app(tmp_path, 'passkeys-login-options-ok.db')

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.execute(
            '''
            INSERT INTO user_passkeys (user_id, credential_id, credential_public_key, sign_count)
            VALUES (1, 'cred-login', 'pub-key-login', 1)
            '''
        )
        conn.commit()

    class _Descriptor:
        def __init__(self, id):
            self.id = id

    captured = {}

    def _fake_generate_authentication_options(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(auth_routes, 'PublicKeyCredentialDescriptor', _Descriptor)
    monkeypatch.setattr(auth_routes, 'base64url_to_bytes', lambda value: f'decoded:{value}'.encode('utf-8'))
    monkeypatch.setattr(auth_routes, 'generate_authentication_options', _fake_generate_authentication_options)
    monkeypatch.setattr(auth_routes, 'options_to_json', lambda _obj: '{"publicKey":{"rpId":"localhost"}}')

    client = app.test_client()
    response = client.post(
        '/api/passkey/login/options',
        json={'username': 'alice', 'remember_device': True},
    )
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['options']['publicKey']['rpId'] == 'localhost'
    assert len(captured['allow_credentials']) == 1
    assert captured['allow_credentials'][0].id == b'decoded:cred-login'

    with client.session_transaction() as sess:
        assert sess.get('pending_passkey_login_user_id') == 1
        assert str(sess.get('pending_passkey_login_challenge_b64') or '').strip()
        assert sess.get('pending_passkey_login_remember') is True
        assert int(sess.get('pending_passkey_login_issued_at') or 0) > 0


def test_passkey_login_options_without_username_uses_discoverable_credentials(tmp_path, monkeypatch):
    app, db_path = _create_test_app(tmp_path, 'passkeys-login-options-discoverable.db')

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice')
            '''
        )
        conn.execute(
            '''
            INSERT INTO user_passkeys (user_id, credential_id, credential_public_key, sign_count)
            VALUES (1, 'cred-discoverable', 'pub-key-discoverable', 1)
            '''
        )
        conn.commit()

    captured = {}

    def _fake_generate_authentication_options(**kwargs):
        captured.update(kwargs)
        return object()

    monkeypatch.setattr(auth_routes, 'generate_authentication_options', _fake_generate_authentication_options)
    monkeypatch.setattr(auth_routes, 'options_to_json', lambda _obj: '{"publicKey":{"rpId":"localhost"}}')

    client = app.test_client()
    response = client.post('/api/passkey/login/options', json={'remember_device': True})
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert payload['options']['publicKey']['rpId'] == 'localhost'
    assert captured['allow_credentials'] is None

    with client.session_transaction() as sess:
        assert sess.get('pending_passkey_login_user_id') == 0
        assert str(sess.get('pending_passkey_login_challenge_b64') or '').strip()
        assert sess.get('pending_passkey_login_remember') is True
        assert int(sess.get('pending_passkey_login_issued_at') or 0) > 0


def test_passkey_login_verify_without_totp_establishes_session(tmp_path, monkeypatch):
    app, db_path = _create_test_app(tmp_path, 'passkeys-login-verify-no-totp.db')

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, language)
            VALUES (1, 'pk-1', 'alice', 'Alice', 'en')
            '''
        )
        conn.execute(
            '''
            INSERT INTO user_passkeys (user_id, credential_id, credential_public_key, sign_count)
            VALUES (1, 'cred-session', 'pub-key-session', 2)
            '''
        )
        conn.commit()

    class _VerificationResult:
        new_sign_count = 4

    monkeypatch.setattr(auth_routes, 'base64url_to_bytes', lambda _value: b'bytes')
    monkeypatch.setattr(auth_routes, 'verify_authentication_response', lambda **kwargs: _VerificationResult())

    client = app.test_client()
    with client.session_transaction() as sess:
        sess['pending_passkey_login_user_id'] = 1
        sess['pending_passkey_login_challenge_b64'] = 'challenge-session'
        sess['pending_passkey_login_remember'] = False
        sess['pending_passkey_login_issued_at'] = int(time.time())

    response = client.post(
        '/api/passkey/login/verify',
        json={
            'credential': {
                'id': 'cred-session',
                'rawId': 'cred-session',
                'response': {},
            }
        },
    )
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert payload.get('requires_totp') is None

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT sign_count, last_used_at
            FROM user_passkeys
            WHERE user_id = 1 AND credential_id = 'cred-session'
            '''
        ).fetchone()
    assert int(row['sign_count']) == 4
    assert row['last_used_at'] is not None

    with client.session_transaction() as sess:
        assert sess.get('user_id') == 1
        assert sess.get('public_key_pem') == 'pk-1'
        assert sess.get('ui_language') == 'en'
        assert sess.get('pending_passkey_login_user_id') is None
        assert sess.get('pending_passkey_login_challenge_b64') is None
        assert sess.get('pending_passkey_login_issued_at') is None


def test_passkey_login_verify_without_pending_user_id_uses_credential_lookup(tmp_path, monkeypatch):
    app, db_path = _create_test_app(tmp_path, 'passkeys-login-verify-lookup.db')

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, language)
            VALUES (1, 'pk-1', 'alice', 'Alice', 'ru')
            '''
        )
        conn.execute(
            '''
            INSERT INTO user_passkeys (user_id, credential_id, credential_public_key, sign_count)
            VALUES (1, 'cred-lookup', 'pub-key-lookup', 2)
            '''
        )
        conn.commit()

    class _VerificationResult:
        new_sign_count = 7

    monkeypatch.setattr(auth_routes, 'base64url_to_bytes', lambda _value: b'bytes')
    monkeypatch.setattr(auth_routes, 'verify_authentication_response', lambda **kwargs: _VerificationResult())

    client = app.test_client()
    with client.session_transaction() as sess:
        sess['pending_passkey_login_user_id'] = 0
        sess['pending_passkey_login_challenge_b64'] = 'challenge-lookup'
        sess['pending_passkey_login_remember'] = False
        sess['pending_passkey_login_issued_at'] = int(time.time())

    response = client.post(
        '/api/passkey/login/verify',
        json={
            'credential': {
                'id': 'cred-lookup',
                'rawId': 'cred-lookup',
                'response': {},
            }
        },
    )
    payload = response.get_json()

    assert response.status_code == 200
    assert payload['success'] is True
    assert payload.get('requires_totp') is None

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT sign_count, last_used_at
            FROM user_passkeys
            WHERE user_id = 1 AND credential_id = 'cred-lookup'
            '''
        ).fetchone()
    assert int(row['sign_count']) == 7
    assert row['last_used_at'] is not None

    with client.session_transaction() as sess:
        assert sess.get('user_id') == 1
        assert sess.get('public_key_pem') == 'pk-1'
        assert sess.get('pending_passkey_login_user_id') is None
