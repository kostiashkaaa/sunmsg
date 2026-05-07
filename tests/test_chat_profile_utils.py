from pathlib import Path

from app.routes.chat_profile_utils import fetch_conversation_stats, shared_chat_id
from tests._pg_test_db import connect_test_db


def _connect(db_path: Path):
    return connect_test_db(db_path)


def _prepare_schema(conn):
    conn.execute(
        '''
        CREATE TABLE contacts (
            user_id INTEGER NOT NULL,
            contact_id INTEGER NOT NULL,
            chat_id TEXT NOT NULL
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY,
            chat_id TEXT NOT NULL,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            message_type TEXT NOT NULL DEFAULT 'text'
        )
        '''
    )
    conn.commit()


def test_shared_chat_id_returns_existing_or_none(tmp_path):
    db_path = tmp_path / 'chat-profile-shared.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, 'chat-a')
            '''
        )
        conn.commit()

        assert shared_chat_id(conn, 1, 2) == 'chat-a'
        assert shared_chat_id(conn, 1, 3) is None


def test_fetch_conversation_stats_prefers_chat_id_when_contact_exists(tmp_path):
    db_path = tmp_path / 'chat-profile-stats-chat-id.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, 'chat-a')
            '''
        )
        conn.execute(
            '''
            INSERT INTO messages (chat_id, sender_id, receiver_id, message_type)
            VALUES
                ('chat-a', 1, 2, 'photo'),
                ('chat-a', 1, 2, 'video'),
                ('chat-a', 2, 1, 'audio'),
                ('chat-a', 2, 1, 'voice'),
                ('chat-a', 1, 2, 'file'),
                ('chat-a', 2, 1, 'link'),
                ('chat-b', 1, 2, 'photo')
            '''
        )
        conn.commit()

        row = fetch_conversation_stats(conn, 1, 2)

    assert dict(row) == {
        'photos': 1,
        'videos': 1,
        'audio': 1,
        'voices': 1,
        'files': 1,
        'links': 1,
    }


def test_fetch_conversation_stats_falls_back_to_pair_query(tmp_path):
    db_path = tmp_path / 'chat-profile-stats-pair.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO messages (chat_id, sender_id, receiver_id, message_type)
            VALUES
                ('chat-x', 1, 2, 'photo'),
                ('chat-y', 2, 1, 'video'),
                ('chat-z', 1, 3, 'audio')
            '''
        )
        conn.commit()

        row = fetch_conversation_stats(conn, 1, 2)

    assert row['photos'] == 1
    assert row['videos'] == 1
    assert row['audio'] == 0
    assert row['voices'] == 0
    assert row['files'] == 0
    assert row['links'] == 0
