from pathlib import Path

from app import create_app
from app.services.reactions import ALLOWED_REACTION_EMOJIS, fetch_reactions_map
from app.services.user import get_safe_avatar_url
from tests._pg_test_db import connect_test_db


def _connect(db_path: Path):
    return connect_test_db(db_path)


def test_key_transfer_claim_routes_require_post(tmp_path, monkeypatch):
    db_path = tmp_path / 'key-transfer-claim-methods.db'
    monkeypatch.delenv('DATABASE_PATH', raising=False)
    app = create_app('testing', overrides={'DATABASE_PATH': str(db_path)})
    client = app.test_client()

    session_id = 'AbCdEf1234567890'

    direct_claim_url = f'/api/key_transfer/sessions/{session_id}/claim'
    login_claim_url = f'/api/key_transfer/login/sessions/{session_id}/claim'

    assert client.get(direct_claim_url).status_code == 405
    assert client.get(login_claim_url).status_code == 405

    # POST is accepted by router and reaches handler logic.
    assert client.post(direct_claim_url).status_code == 401
    assert client.post(login_claim_url).status_code == 404


def test_ios_qr_transfer_accepts_web_vault_private_key_format():
    support = Path('ios/Sunmsg/Sunmsg/QRTransferSupport.swift').read_text(encoding='utf-8')

    assert 'contains("PRIVATE KEY")' not in support
    assert 'validatedPrivateKeyPem' in support
    assert 'SunCrypto.importPrivateKey(trimmed)' in support


def test_get_safe_avatar_url_shows_own_avatar_even_when_is_contact_false():
    user_payload = {
        'id': 42,
        'avatar_url': '/static/avatars/me.png',
        'avatar_visibility': 'contacts',
        'is_contact': False,
    }

    assert get_safe_avatar_url(user_payload, viewer_id=42) == '/static/avatars/me.png'


def test_reactions_respect_avatar_visibility_for_non_contacts(tmp_path):
    db_path = tmp_path / 'reactions-avatar-visibility.db'
    with _connect(db_path) as conn:
        conn.execute(
            '''
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                public_key TEXT,
                display_name TEXT,
                username TEXT,
                avatar_url TEXT,
                avatar_visibility TEXT
            )
            '''
        )
        conn.execute(
            '''
            CREATE TABLE contacts (
                user_id INTEGER NOT NULL,
                contact_id INTEGER NOT NULL,
                chat_id TEXT
            )
            '''
        )
        conn.execute(
            '''
            CREATE TABLE message_reactions (
                message_id INTEGER NOT NULL,
                chat_id TEXT NOT NULL,
                emoji TEXT NOT NULL,
                user_id INTEGER NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            '''
        )
        conn.execute(
            '''
            INSERT INTO users (id, public_key, display_name, username, avatar_url, avatar_visibility)
            VALUES
                (1, 'pk-1', 'Viewer', 'viewer', '/avatars/viewer.png', 'all'),
                (2, 'pk-2', 'Reactor', 'reactor', '/avatars/reactor.png', 'contacts')
            '''
        )
        conn.execute(
            '''
            INSERT INTO message_reactions (message_id, chat_id, emoji, user_id)
            VALUES (10, 'chat-1', ?, 2)
            ''',
            (ALLOWED_REACTION_EMOJIS[0],),
        )
        conn.commit()

        hidden_map = fetch_reactions_map(conn, 'chat-1', [10], viewer_user_id=1)
        hidden_reactors = hidden_map[10][0]['reactors']
        assert hidden_reactors[0]['user_id'] == 2
        assert hidden_reactors[0]['avatar_url'] is None

        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, 'chat-1')
            '''
        )
        conn.commit()

        visible_map = fetch_reactions_map(conn, 'chat-1', [10], viewer_user_id=1)
        visible_reactors = visible_map[10][0]['reactors']
        assert visible_reactors[0]['avatar_url'] == '/avatars/reactor.png'
