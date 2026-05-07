from pathlib import Path

from app.routes.contacts_data_utils import (
    ensure_pinned_chats_table,
    resolve_viewer_context,
    shared_chat_id,
)
from tests._pg_test_db import connect_test_db


def _connect(db_path: Path):
    return connect_test_db(db_path)


def test_shared_chat_id_returns_shared_or_none(tmp_path):
    db_path = tmp_path / 'contacts-data-shared.db'
    with _connect(db_path) as conn:
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
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES
                (1, 2, 'chat-a'),
                (2, 1, 'chat-a'),
                (1, 3, 'chat-b')
            '''
        )
        conn.commit()

        assert shared_chat_id(conn, 1, 2) == 'chat-a'
        assert shared_chat_id(conn, 1, 3) is None


def test_resolve_viewer_context_handles_missing_invalid_and_existing_user(tmp_path):
    db_path = tmp_path / 'contacts-data-viewer.db'
    with _connect(db_path) as conn:
        conn.execute(
            '''
            CREATE TABLE users (
                id INTEGER PRIMARY KEY,
                username TEXT
            )
            '''
        )
        conn.execute("INSERT INTO users (id, username) VALUES (1, 'alice')")
        conn.commit()

        assert resolve_viewer_context(conn, {}) == (None, None)
        assert resolve_viewer_context(conn, {'user_id': 'bad'}) == (None, None)
        assert resolve_viewer_context(conn, {'user_id': 2}) == (None, None)

        viewer_id, viewer = resolve_viewer_context(conn, {'user_id': 1})
        assert viewer_id == 1
        assert viewer['username'] == 'alice'


def test_ensure_pinned_chats_table_creates_table_and_index(tmp_path):
    db_path = tmp_path / 'contacts-data-pins.db'
    with _connect(db_path) as conn:
        conn.execute('CREATE TABLE users (id INTEGER PRIMARY KEY)')
        conn.execute('CREATE TABLE chats (chat_id TEXT PRIMARY KEY)')
        conn.commit()

        ensure_pinned_chats_table(conn)
        conn.commit()

        table_row = conn.execute(
            "SELECT table_name AS name FROM information_schema.tables "
                "WHERE table_schema = current_schema() "
                "AND table_name = 'pinned_chats'"
        ).fetchone()
        index_row = conn.execute(
            "SELECT indexname AS name FROM pg_indexes "
                "WHERE schemaname = current_schema() "
                "AND indexname = 'idx_pinned_chats_user_id'"
        ).fetchone()

    assert table_row['name'] == 'pinned_chats'
    assert index_row['name'] == 'idx_pinned_chats_user_id'
