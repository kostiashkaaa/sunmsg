from pathlib import Path

from flask import Flask

from app.routes import auth as auth_routes
from tests._pg_test_db import connect_test_db


class _ConnectionHandle:
    def __init__(self, db_path: Path):
        self._conn = connect_test_db(db_path)
        self._conn.execute('PRAGMA foreign_keys = ON;')

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


def _init_schema(db_path: Path) -> None:
    with _connect(db_path) as conn:
        conn.executescript(
            '''
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                public_key TEXT NOT NULL,
                username TEXT NOT NULL,
                avatar_url TEXT
            );
            CREATE TABLE messages (
                id INTEGER PRIMARY KEY,
                chat_id TEXT NOT NULL,
                sender_id INTEGER NOT NULL,
                receiver_id INTEGER,
                message TEXT NOT NULL
            );
            CREATE TABLE contacts (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL,
                contact_id INTEGER NOT NULL,
                chat_id TEXT NOT NULL
            );
            CREATE TABLE dialog_requests (
                id INTEGER PRIMARY KEY,
                sender_id INTEGER NOT NULL,
                receiver_id INTEGER NOT NULL,
                status TEXT DEFAULT 'pending'
            );
            CREATE TABLE chat_media (
                id INTEGER PRIMARY KEY,
                chat_id TEXT NOT NULL,
                uploader_id INTEGER NOT NULL,
                storage_name TEXT NOT NULL
            );
            CREATE TABLE block_list (
                id INTEGER PRIMARY KEY,
                blocker_id INTEGER NOT NULL,
                blocked_id INTEGER NOT NULL
            );
            CREATE TABLE pinned_chats (
                user_id INTEGER NOT NULL,
                chat_id TEXT NOT NULL,
                pin_order INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE chat_pins (
                chat_id TEXT PRIMARY KEY,
                message_id INTEGER NOT NULL,
                message_content TEXT,
                pinned_by INTEGER,
                sender_pub TEXT
            );
            CREATE TABLE socket_rate_limits (
                user_id INTEGER PRIMARY KEY,
                window_started_at INTEGER NOT NULL,
                event_count INTEGER NOT NULL DEFAULT 0
            );
            CREATE TABLE refresh_tokens (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL,
                token_hash TEXT NOT NULL,
                family_id TEXT NOT NULL,
                expires_at INTEGER NOT NULL,
                revoked_at INTEGER,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE dialog_keys (
                id INTEGER PRIMARY KEY,
                key_value TEXT NOT NULL,
                creator_id INTEGER NOT NULL
            );
            CREATE TABLE chats (
                id INTEGER PRIMARY KEY,
                chat_id TEXT NOT NULL,
                chat_name TEXT NOT NULL,
                chat_type TEXT NOT NULL DEFAULT 'direct'
            );
            CREATE TABLE chat_members (
                user_id INTEGER NOT NULL,
                chat_id TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'member'
            );
            '''
        )
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, avatar_url)
            VALUES (1, 'pk-1', 'alice', '/static/avatars/alice.png')
            '''
        )
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, avatar_url)
            VALUES (2, 'pk-2', 'bob', NULL)
            '''
        )
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, avatar_url)
            VALUES (3, 'pk-3', 'carol', NULL)
            '''
        )
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, receiver_id, message)
            VALUES (1, 'chat-main', 1, 2, 'hello')
            '''
        )
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, receiver_id, message)
            VALUES (2, 'chat-main', 2, 1, 'hi')
            '''
        )
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, receiver_id, message)
            VALUES (3, 'chat-keep', 2, 3, 'keep')
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (id, user_id, contact_id, chat_id)
            VALUES (1, 1, 2, 'chat-main')
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (id, user_id, contact_id, chat_id)
            VALUES (2, 2, 1, 'chat-main')
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (id, user_id, contact_id, chat_id)
            VALUES (3, 2, 3, 'chat-keep')
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (id, user_id, contact_id, chat_id)
            VALUES (4, 3, 2, 'chat-keep')
            '''
        )
        conn.execute(
            '''
            INSERT INTO dialog_requests (id, sender_id, receiver_id, status)
            VALUES (1, 1, 2, 'pending')
            '''
        )
        conn.execute(
            '''
            INSERT INTO dialog_requests (id, sender_id, receiver_id, status)
            VALUES (2, 2, 3, 'pending')
            '''
        )
        conn.execute(
            '''
            INSERT INTO chat_media (id, chat_id, uploader_id, storage_name)
            VALUES (1, 'chat-main', 1, 'alice-main.png')
            '''
        )
        conn.execute(
            '''
            INSERT INTO chat_media (id, chat_id, uploader_id, storage_name)
            VALUES (2, 'chat-main', 2, 'bob-main.png')
            '''
        )
        conn.execute(
            '''
            INSERT INTO chat_media (id, chat_id, uploader_id, storage_name)
            VALUES (3, 'chat-keep', 2, 'bob-keep.png')
            '''
        )
        conn.execute(
            '''
            INSERT INTO block_list (id, blocker_id, blocked_id)
            VALUES (1, 1, 2), (2, 3, 1), (3, 2, 3)
            '''
        )
        conn.execute(
            '''
            INSERT INTO pinned_chats (user_id, chat_id, pin_order)
            VALUES (1, 'chat-main', 0), (2, 'chat-main', 0), (2, 'chat-keep', 1)
            '''
        )
        conn.execute(
            '''
            INSERT INTO chat_pins (chat_id, message_id, message_content, pinned_by, sender_pub)
            VALUES ('chat-main', 1, 'hello', 1, 'pk-1'), ('chat-keep', 3, 'keep', 2, 'pk-2')
            '''
        )
        conn.execute(
            '''
            INSERT INTO socket_rate_limits (user_id, window_started_at, event_count)
            VALUES (1, 123, 4), (2, 456, 1)
            '''
        )
        conn.execute(
            '''
            INSERT INTO refresh_tokens (id, user_id, token_hash, family_id, expires_at, revoked_at, created_at)
            VALUES (1, 1, 'token-a', 'family-a', 9999999999, NULL, 1),
                   (2, 2, 'token-b', 'family-b', 9999999999, NULL, 1)
            '''
        )
        conn.execute(
            '''
            INSERT INTO dialog_keys (id, key_value, creator_id)
            VALUES (1, 'key-a', 1), (2, 'key-b', 2)
            '''
        )
        conn.execute(
            '''
            INSERT INTO chats (id, chat_id, chat_name)
            VALUES (1, 'chat-main', 'Main'), (2, 'chat-keep', 'Keep')
            '''
        )
        conn.commit()


def test_delete_account_also_removes_media_files(monkeypatch, tmp_path):
    db_path = tmp_path / 'test.db'
    _init_schema(db_path)

    chat_media_dir = tmp_path / 'storage' / 'chat_media'
    avatar_dir = tmp_path / 'static' / 'avatars'
    chat_media_dir.mkdir(parents=True, exist_ok=True)
    avatar_dir.mkdir(parents=True, exist_ok=True)

    (chat_media_dir / 'alice-main.png').write_bytes(b'alice')
    (chat_media_dir / 'bob-main.png').write_bytes(b'bob')
    (chat_media_dir / 'bob-keep.png').write_bytes(b'keep')
    (avatar_dir / 'alice.png').write_bytes(b'avatar')

    def _test_connection():
        return _connect(db_path)

    monkeypatch.setattr(auth_routes, 'get_db_connection', _test_connection)
    monkeypatch.setattr(auth_routes, 'CHAT_MEDIA_FOLDER', str(chat_media_dir))
    monkeypatch.setattr(auth_routes, 'AVATAR_FOLDER', str(avatar_dir))

    app = Flask(__name__)
    app.config['TESTING'] = True
    app.secret_key = 'test-secret'
    app.register_blueprint(auth_routes.auth_bp)
    client = app.test_client()

    with client.session_transaction() as sess:
        sess['user_id'] = 1

    response = client.post('/api/delete_account')
    assert response.status_code == 200
    assert response.get_json() == {'success': True}

    with _connect(db_path) as conn:
        assert conn.execute('SELECT 1 FROM users WHERE id = 1').fetchone() is None
        assert conn.execute(
            'SELECT 1 FROM messages WHERE sender_id = 1 OR receiver_id = 1'
        ).fetchone() is None
        assert conn.execute(
            'SELECT 1 FROM contacts WHERE user_id = 1 OR contact_id = 1'
        ).fetchone() is None
        assert conn.execute(
            'SELECT 1 FROM dialog_requests WHERE sender_id = 1 OR receiver_id = 1'
        ).fetchone() is None
        assert conn.execute(
            'SELECT 1 FROM block_list WHERE blocker_id = 1 OR blocked_id = 1'
        ).fetchone() is None
        assert conn.execute(
            "SELECT 1 FROM pinned_chats WHERE user_id = 1 OR chat_id = 'chat-main'"
        ).fetchone() is None
        assert conn.execute(
            "SELECT 1 FROM chat_pins WHERE chat_id = 'chat-main'"
        ).fetchone() is None
        assert conn.execute(
            'SELECT 1 FROM socket_rate_limits WHERE user_id = 1'
        ).fetchone() is None
        assert conn.execute(
            'SELECT 1 FROM refresh_tokens WHERE user_id = 1'
        ).fetchone() is None
        assert conn.execute(
            'SELECT 1 FROM dialog_keys WHERE creator_id = 1'
        ).fetchone() is None
        assert conn.execute(
            "SELECT 1 FROM chats WHERE chat_id = 'chat-main'"
        ).fetchone() is None

        # Media from affected chats must be cleaned up, including files uploaded by other side.
        assert conn.execute(
            "SELECT 1 FROM chat_media WHERE chat_id = 'chat-main'"
        ).fetchone() is None
        # Unrelated chats and files stay intact.
        assert conn.execute(
            "SELECT storage_name FROM chat_media WHERE chat_id = 'chat-keep'"
        ).fetchone()['storage_name'] == 'bob-keep.png'
        assert conn.execute(
            "SELECT 1 FROM block_list WHERE blocker_id = 2 AND blocked_id = 3"
        ).fetchone() is not None
        assert conn.execute(
            "SELECT 1 FROM pinned_chats WHERE user_id = 2 AND chat_id = 'chat-keep'"
        ).fetchone() is not None
        assert conn.execute(
            "SELECT 1 FROM chat_pins WHERE chat_id = 'chat-keep'"
        ).fetchone() is not None
        assert conn.execute(
            'SELECT 1 FROM socket_rate_limits WHERE user_id = 2'
        ).fetchone() is not None
        assert conn.execute(
            'SELECT 1 FROM refresh_tokens WHERE user_id = 2'
        ).fetchone() is not None
        assert conn.execute(
            'SELECT 1 FROM dialog_keys WHERE creator_id = 2'
        ).fetchone() is not None
        assert conn.execute(
            "SELECT 1 FROM chats WHERE chat_id = 'chat-keep'"
        ).fetchone() is not None

        assert not (avatar_dir / 'alice.png').exists()
        assert not (chat_media_dir / 'alice-main.png').exists()
        assert not (chat_media_dir / 'bob-main.png').exists()
        assert (chat_media_dir / 'bob-keep.png').exists()


def test_delete_account_keeps_group_chat_and_other_members_media(monkeypatch, tmp_path):
    db_path = tmp_path / 'test-group-delete.db'
    _init_schema(db_path)

    chat_media_dir = tmp_path / 'storage' / 'chat_media'
    avatar_dir = tmp_path / 'static' / 'avatars'
    chat_media_dir.mkdir(parents=True, exist_ok=True)
    avatar_dir.mkdir(parents=True, exist_ok=True)

    with _connect(db_path) as conn:
        conn.execute(
            '''
            INSERT INTO chats (id, chat_id, chat_name, chat_type)
            VALUES (3, 'group-main', 'Group Main', 'group')
            '''
        )
        conn.execute(
            '''
            INSERT INTO chat_members (user_id, chat_id, role)
            VALUES (1, 'group-main', 'member'),
                   (2, 'group-main', 'owner'),
                   (3, 'group-main', 'member')
            '''
        )
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, receiver_id, message)
            VALUES (4, 'group-main', 1, NULL, 'remove me'),
                   (5, 'group-main', 2, NULL, 'keep me')
            '''
        )
        conn.execute(
            '''
            INSERT INTO chat_media (id, chat_id, uploader_id, storage_name)
            VALUES (4, 'group-main', 1, 'alice-group.png'),
                   (5, 'group-main', 2, 'bob-group.png')
            '''
        )
        conn.execute(
            '''
            INSERT INTO pinned_chats (user_id, chat_id, pin_order)
            VALUES (2, 'group-main', 2)
            '''
        )
        conn.execute(
            '''
            INSERT INTO chat_pins (chat_id, message_id, message_content, pinned_by, sender_pub)
            VALUES ('group-main', 5, 'keep me', 2, 'pk-2')
            '''
        )
        conn.commit()

    for filename, content in {
        'alice-main.png': b'alice-direct',
        'bob-main.png': b'bob-direct',
        'alice-group.png': b'alice-group',
        'bob-group.png': b'bob-group',
        'bob-keep.png': b'bob-keep',
    }.items():
        (chat_media_dir / filename).write_bytes(content)

    def _test_connection():
        return _connect(db_path)

    monkeypatch.setattr(auth_routes, 'get_db_connection', _test_connection)
    monkeypatch.setattr(auth_routes, 'CHAT_MEDIA_FOLDER', str(chat_media_dir))
    monkeypatch.setattr(auth_routes, 'AVATAR_FOLDER', str(avatar_dir))

    app = Flask(__name__)
    app.config['TESTING'] = True
    app.secret_key = 'test-secret'
    app.register_blueprint(auth_routes.auth_bp)
    client = app.test_client()

    with client.session_transaction() as sess:
        sess['user_id'] = 1

    response = client.post('/api/delete_account')
    assert response.status_code == 200

    with _connect(db_path) as conn:
        assert conn.execute("SELECT 1 FROM chats WHERE chat_id = 'group-main'").fetchone() is not None
        assert conn.execute(
            "SELECT message FROM messages WHERE chat_id = 'group-main' ORDER BY id"
        ).fetchall()[0]['message'] == 'keep me'
        assert conn.execute(
            "SELECT storage_name FROM chat_media WHERE chat_id = 'group-main'"
        ).fetchone()['storage_name'] == 'bob-group.png'
        assert conn.execute(
            "SELECT 1 FROM pinned_chats WHERE user_id = 2 AND chat_id = 'group-main'"
        ).fetchone() is not None
        assert conn.execute(
            "SELECT 1 FROM chat_pins WHERE chat_id = 'group-main'"
        ).fetchone() is not None

    assert not (chat_media_dir / 'alice-group.png').exists()
    assert (chat_media_dir / 'bob-group.png').exists()
    assert not (chat_media_dir / 'alice-main.png').exists()
    assert not (chat_media_dir / 'bob-main.png').exists()
    assert (chat_media_dir / 'bob-keep.png').exists()
