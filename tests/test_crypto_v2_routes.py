import base64
import sqlite3

import pytest
from flask import Flask

from app.routes import crypto_v2_routes


class _NoCloseConnection:
    def __init__(self, conn):
        self._conn = conn

    def __getattr__(self, name):
        return getattr(self._conn, name)

    def close(self):
        pass


@pytest.fixture()
def conn():
    db = sqlite3.connect(':memory:')
    db.row_factory = sqlite3.Row
    db.executescript(
        '''
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            public_key TEXT,
            username TEXT,
            display_name TEXT,
            x25519_public_key TEXT,
            ed25519_public_key TEXT,
            crypto_version INTEGER DEFAULT 2
        );
        CREATE TABLE chats (
            chat_id TEXT PRIMARY KEY,
            chat_type TEXT NOT NULL DEFAULT 'direct'
        );
        CREATE TABLE contacts (
            user_id INTEGER NOT NULL,
            contact_id INTEGER NOT NULL,
            chat_id TEXT NOT NULL
        );
        CREATE TABLE chat_members (
            user_id INTEGER NOT NULL,
            chat_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member'
        );
        CREATE TABLE user_signed_prekeys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            prekey_id INTEGER NOT NULL,
            public_key TEXT NOT NULL,
            signature TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE user_one_time_prekeys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            prekey_id INTEGER NOT NULL,
            public_key TEXT NOT NULL,
            claimed_at TIMESTAMP DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE dr_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            owner_user_id INTEGER NOT NULL,
            peer_user_id INTEGER NOT NULL,
            session_state TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(chat_id, owner_user_id)
        );
        CREATE TABLE mls_key_packages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            key_package_ref TEXT NOT NULL UNIQUE,
            key_package TEXT NOT NULL,
            claimed_at TIMESTAMP DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE mls_pending_messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            recipient_user_id INTEGER NOT NULL,
            message_type TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            delivered_at TIMESTAMP DEFAULT NULL
        );
        '''
    )
    yield db
    db.close()


def _client(monkeypatch, conn, user_id=1):
    app = Flask(__name__)
    app.config.update(
        SECRET_KEY='test-secret',
        TESTING=True,
        RATELIMIT_ENABLED=False,
    )
    crypto_v2_routes.limiter.init_app(app)
    app.register_blueprint(crypto_v2_routes.crypto_v2_bp)
    monkeypatch.setattr(crypto_v2_routes, 'get_db_connection', lambda: _NoCloseConnection(conn))

    client = app.test_client()
    with client.session_transaction() as flask_session:
        flask_session['user_id'] = user_id
    return client


def _b64u(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode('ascii').rstrip('=')


def test_publish_identity_keys_does_not_overwrite_existing_keys(monkeypatch, conn):
    first_x25519 = _b64u(bytes([1]) * 32)
    first_ed25519 = _b64u(bytes([2]) * 32)
    second_x25519 = _b64u(bytes([3]) * 32)
    second_ed25519 = _b64u(bytes([4]) * 32)
    conn.execute(
        "INSERT INTO users (id, public_key, username, display_name) VALUES (1, 'pk-1', 'alice', 'Alice')"
    )
    conn.commit()
    monkeypatch.setattr(crypto_v2_routes, 'verify_ed25519_signature', lambda *_args, **_kwargs: True)

    client = _client(monkeypatch, conn)
    first_response = client.post('/api/crypto/keys', json={
        'x25519_public_key': first_x25519,
        'ed25519_public_key': first_ed25519,
        'challenge': first_x25519,
        'signature': 'sig',
    })
    same_response = client.post('/api/crypto/keys', json={
        'x25519_public_key': first_x25519,
        'ed25519_public_key': first_ed25519,
        'challenge': first_x25519,
        'signature': 'sig',
    })
    overwrite_response = client.post('/api/crypto/keys', json={
        'x25519_public_key': second_x25519,
        'ed25519_public_key': second_ed25519,
        'challenge': second_x25519,
        'signature': 'sig',
    })

    assert first_response.status_code == 200
    assert same_response.status_code == 200
    assert same_response.get_json()['already_registered'] is True
    assert overwrite_response.status_code == 409
    assert overwrite_response.get_json() == {'error': 'identity_keys_already_registered'}
    row = conn.execute(
        'SELECT x25519_public_key, ed25519_public_key, crypto_version FROM users WHERE id = 1'
    ).fetchone()
    assert row['x25519_public_key'] == first_x25519
    assert row['ed25519_public_key'] == first_ed25519
    assert row['crypto_version'] == 3


def test_prekey_bundle_get_does_not_claim_one_time_prekey(monkeypatch, conn):
    conn.execute(
        '''
        INSERT INTO users (id, public_key, username, display_name, x25519_public_key, ed25519_public_key, crypto_version)
        VALUES (1, 'pk-1', 'alice', 'Alice', 'x1', 'e1', 3),
               (2, 'pk-2', 'bob', 'Bob', 'x2', 'e2', 3)
        '''
    )
    conn.execute(
        'INSERT INTO user_signed_prekeys (user_id, prekey_id, public_key, signature) VALUES (2, 7, ?, ?)',
        ('spk-public', 'spk-signature'),
    )
    conn.execute(
        'INSERT INTO user_one_time_prekeys (user_id, prekey_id, public_key) VALUES (2, 9, ?)',
        ('otpk-public',),
    )
    conn.commit()

    client = _client(monkeypatch, conn)
    get_response = client.get('/api/crypto/prekey-bundle/2')

    assert get_response.status_code == 200
    get_payload = get_response.get_json()
    assert get_payload['one_time_prekey_available'] is True
    assert 'one_time_prekey' not in get_payload
    assert conn.execute('SELECT claimed_at FROM user_one_time_prekeys').fetchone()['claimed_at'] is None

    claim_response = client.post('/api/crypto/prekey-bundle/2/claim')

    assert claim_response.status_code == 200
    claim_payload = claim_response.get_json()
    assert claim_payload['one_time_prekey'] == {'id': 9, 'public_key': 'otpk-public'}
    assert conn.execute('SELECT claimed_at FROM user_one_time_prekeys').fetchone()['claimed_at'] is not None


def test_dr_session_uses_session_state_key_and_requires_chat_access(monkeypatch, conn):
    conn.execute(
        '''
        INSERT INTO users (id, public_key, username, display_name)
        VALUES (1, 'pk-1', 'alice', 'Alice'),
               (2, 'pk-2', 'bob', 'Bob'),
               (3, 'pk-3', 'carol', 'Carol')
        '''
    )
    conn.execute("INSERT INTO chats (chat_id, chat_type) VALUES ('direct-1', 'direct')")
    conn.execute("INSERT INTO contacts (user_id, contact_id, chat_id) VALUES (1, 2, 'direct-1'), (2, 1, 'direct-1')")
    conn.execute(
        '''
        INSERT INTO dr_sessions (chat_id, owner_user_id, peer_user_id, session_state)
        VALUES ('direct-1', 1, 2, 'serialized-state')
        '''
    )
    conn.commit()

    client = _client(monkeypatch, conn)
    response = client.get('/api/crypto/dr-session/direct-1')

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['session_state'] == 'serialized-state'
    assert payload['session'] == 'serialized-state'

    forbidden_client = _client(monkeypatch, conn, user_id=3)
    forbidden_response = forbidden_client.get('/api/crypto/dr-session/direct-1')

    assert forbidden_response.status_code == 403


def test_mls_key_package_get_does_not_claim_package(monkeypatch, conn):
    conn.execute(
        '''
        INSERT INTO users (id, public_key, username, display_name)
        VALUES (1, 'pk-1', 'alice', 'Alice'),
               (2, 'pk-2', 'bob', 'Bob')
        '''
    )
    conn.execute(
        '''
        INSERT INTO mls_key_packages (user_id, key_package_ref, key_package)
        VALUES (2, 'kp-ref', '{"leaf":"payload"}')
        '''
    )
    conn.commit()

    client = _client(monkeypatch, conn)
    get_response = client.get('/api/crypto/mls/key-packages/2')

    assert get_response.status_code == 200
    get_payload = get_response.get_json()
    assert get_payload == {'available': True, 'key_package_ref': 'kp-ref'}
    assert conn.execute('SELECT claimed_at FROM mls_key_packages').fetchone()['claimed_at'] is None

    claim_response = client.post('/api/crypto/mls/key-packages/2/claim')

    assert claim_response.status_code == 200
    claim_payload = claim_response.get_json()
    assert claim_payload['key_package'] == {'leaf': 'payload'}
    assert conn.execute('SELECT claimed_at FROM mls_key_packages').fetchone()['claimed_at'] is not None


def test_mls_commit_rejects_recipient_outside_group(monkeypatch, conn):
    conn.execute(
        '''
        INSERT INTO users (id, public_key, username, display_name)
        VALUES (1, 'pk-1', 'alice', 'Alice'),
               (2, 'pk-2', 'bob', 'Bob'),
               (3, 'pk-3', 'carol', 'Carol')
        '''
    )
    conn.execute("INSERT INTO chats (chat_id, chat_type) VALUES ('group-1', 'group')")
    conn.execute("INSERT INTO chat_members (user_id, chat_id, role) VALUES (1, 'group-1', 'owner'), (2, 'group-1', 'member')")
    conn.commit()

    client = _client(monkeypatch, conn)
    response = client.post(
        '/api/crypto/mls/group/group-1/commit',
        json={'commit': {'epoch': 1}, 'recipient_ids': [3]},
    )

    assert response.status_code == 403
    assert conn.execute('SELECT COUNT(*) AS count FROM mls_pending_messages').fetchone()['count'] == 0


def test_mls_pending_get_does_not_mark_delivered(monkeypatch, conn):
    conn.execute(
        '''
        INSERT INTO users (id, public_key, username, display_name)
        VALUES (1, 'pk-1', 'alice', 'Alice'),
               (2, 'pk-2', 'bob', 'Bob')
        '''
    )
    conn.execute("INSERT INTO chats (chat_id, chat_type) VALUES ('group-1', 'group')")
    conn.execute("INSERT INTO chat_members (user_id, chat_id, role) VALUES (1, 'group-1', 'owner'), (2, 'group-1', 'member')")
    conn.execute(
        '''
        INSERT INTO mls_pending_messages (chat_id, recipient_user_id, message_type, payload)
        VALUES ('group-1', 1, 'welcome', '{"cipher":"payload"}')
        '''
    )
    conn.commit()

    client = _client(monkeypatch, conn)
    get_response = client.get('/api/crypto/mls/pending/group-1')

    assert get_response.status_code == 200
    assert get_response.get_json()['messages'] == [{'payload': {'cipher': 'payload'}, 'type': 'welcome'}]
    assert conn.execute('SELECT delivered_at FROM mls_pending_messages').fetchone()['delivered_at'] is None

    claim_response = client.post('/api/crypto/mls/pending/group-1/claim')

    assert claim_response.status_code == 200
    assert claim_response.get_json()['messages'] == [{'payload': {'cipher': 'payload'}, 'type': 'welcome'}]
    assert conn.execute('SELECT delivered_at FROM mls_pending_messages').fetchone()['delivered_at'] is not None
