import sqlite3
from pathlib import Path

from app.services.blocking import get_chat_partner
from app.services.chat_shared_content_service import load_shared_content_candidates


def _connect(db_path: Path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    return conn


def _prepare_schema(conn):
    conn.execute(
        '''
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            public_key TEXT,
            display_name TEXT,
            username TEXT,
            avatar_url TEXT,
            avatar_visibility TEXT DEFAULT 'all'
        )
        '''
    )
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
        CREATE TABLE chats (
            chat_id TEXT PRIMARY KEY,
            chat_type TEXT
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE chat_members (
            user_id INTEGER NOT NULL,
            chat_id TEXT NOT NULL,
            role TEXT
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY,
            chat_id TEXT NOT NULL,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER,
            message TEXT,
            message_type TEXT NOT NULL DEFAULT 'text',
            created_at TEXT,
            deleted_by_sender INTEGER NOT NULL DEFAULT 0,
            deleted_by_receiver INTEGER NOT NULL DEFAULT 0
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE message_receipts (
            message_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            deleted_for_user INTEGER NOT NULL DEFAULT 0
        )
        '''
    )
    conn.executemany(
        '''
        INSERT INTO users (id, public_key, display_name, username, avatar_url, avatar_visibility)
        VALUES (?, ?, ?, ?, ?, 'all')
        ''',
        [
            (1, 'pk-1', 'User One', 'one', None),
            (2, 'pk-2', 'User Two', 'two', None),
        ],
    )
    conn.commit()


def test_direct_shared_content_candidates_filter_types_and_soft_delete(tmp_path):
    db_path = tmp_path / 'shared-content-direct.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO chats (chat_id, chat_type) VALUES ('chat-a', 'direct')")
        conn.execute("INSERT INTO contacts (user_id, contact_id, chat_id) VALUES (1, 2, 'chat-a')")
        conn.executemany(
            '''
            INSERT INTO messages (
                id, chat_id, sender_id, receiver_id, message, message_type, created_at,
                deleted_by_sender, deleted_by_receiver
            )
            VALUES (?, 'chat-a', ?, ?, ?, ?, ?, ?, ?)
            ''',
            [
                (1, 1, 2, 'link-1', 'link', '2026-05-01T10:00:00Z', 0, 0),
                (2, 1, 2, 'text-2', 'text', '2026-05-01T10:01:00Z', 0, 0),
                (3, 2, 1, 'file-3', 'file', '2026-05-01T10:02:00Z', 0, 0),
                (4, 1, 2, 'photo-4', 'photo', '2026-05-01T10:03:00Z', 0, 0),
                (5, 2, 1, 'link-5-hidden', 'link', '2026-05-01T10:04:00Z', 0, 1),
                (6, 1, 2, 'video-6', 'video', '2026-05-01T10:05:00Z', 0, 0),
            ],
        )
        conn.commit()

        result = load_shared_content_candidates(
            conn,
            user_id=1,
            chat_id='chat-a',
            content_type='all',
            limit=10,
            before_id=None,
            get_chat_partner_func=get_chat_partner,
        )

        assert result['status'] == 'ok'
        messages = result['payload']['messages']
        assert [row['id'] for row in messages] == [6, 4, 3, 1]
        assert all(row['message_type'] != 'text' for row in messages)

        links = load_shared_content_candidates(
            conn,
            user_id=1,
            chat_id='chat-a',
            content_type='links',
            limit=10,
            before_id=None,
            get_chat_partner_func=get_chat_partner,
        )['payload']['messages']
        assert [row['id'] for row in links] == [1]

        first_page = load_shared_content_candidates(
            conn,
            user_id=1,
            chat_id='chat-a',
            content_type='all',
            limit=2,
            before_id=None,
            get_chat_partner_func=get_chat_partner,
        )['payload']
        assert [row['id'] for row in first_page['messages']] == [6, 4]
        assert first_page['has_more_before'] is True
        assert first_page['next_before_id'] == 4

        second_page = load_shared_content_candidates(
            conn,
            user_id=1,
            chat_id='chat-a',
            content_type='all',
            limit=2,
            before_id=first_page['next_before_id'],
            get_chat_partner_func=get_chat_partner,
        )['payload']
        assert [row['id'] for row in second_page['messages']] == [3, 1]


def test_group_shared_content_candidates_respect_deleted_receipts(tmp_path):
    db_path = tmp_path / 'shared-content-group.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO chats (chat_id, chat_type) VALUES ('group-a', 'group')")
        conn.execute("INSERT INTO chat_members (user_id, chat_id, role) VALUES (1, 'group-a', 'member')")
        conn.executemany(
            '''
            INSERT INTO messages (id, chat_id, sender_id, receiver_id, message, message_type, created_at)
            VALUES (?, 'group-a', ?, NULL, ?, ?, ?)
            ''',
            [
                (10, 1, 'file-10', 'file', '2026-05-01T10:00:00Z'),
                (11, 2, 'link-11-hidden', 'link', '2026-05-01T10:01:00Z'),
                (12, 2, 'text-12', 'text', '2026-05-01T10:02:00Z'),
            ],
        )
        conn.executemany(
            '''
            INSERT INTO message_receipts (message_id, user_id, deleted_for_user)
            VALUES (?, 1, ?)
            ''',
            [
                (10, 0),
                (11, 1),
                (12, 0),
            ],
        )
        conn.commit()

        result = load_shared_content_candidates(
            conn,
            user_id=1,
            chat_id='group-a',
            content_type='all',
            limit=10,
            before_id=None,
            get_chat_partner_func=get_chat_partner,
        )

        assert result['status'] == 'ok'
        assert [row['id'] for row in result['payload']['messages']] == [10]
