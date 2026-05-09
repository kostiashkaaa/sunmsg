from pathlib import Path

from app.services.favorites_chat import ensure_saved_messages_chat, saved_messages_chat_id
from tests._pg_test_db import connect_test_db


def _connect(db_path: Path):
    return connect_test_db(db_path)


def test_ensure_saved_messages_chat_does_not_update_contacts_when_already_synced(tmp_path):
    db_path = tmp_path / 'favorites-chat-no-redundant-update.db'
    with _connect(db_path) as conn:
        conn.execute('CREATE TABLE chats (chat_id TEXT PRIMARY KEY, chat_name TEXT)')
        conn.execute('CREATE TABLE contacts (user_id INTEGER NOT NULL, contact_id INTEGER NOT NULL, chat_id TEXT)')
        conn.commit()

        public_key = 'pk-favorites-1'
        expected_chat_id = saved_messages_chat_id(public_key)
        ensure_saved_messages_chat(conn, user_id=101, public_key=public_key)
        conn.commit()
        first_row = conn.execute(
            '''
            SELECT chat_id, CAST(xmin AS TEXT) AS version
            FROM contacts
            WHERE user_id = ? AND contact_id = ?
            ''',
            (101, 101),
        ).fetchone()
        ensure_saved_messages_chat(conn, user_id=101, public_key=public_key)
        conn.commit()

        second_row = conn.execute(
            '''
            SELECT chat_id, CAST(xmin AS TEXT) AS version
            FROM contacts
            WHERE user_id = ? AND contact_id = ?
            ''',
            (101, 101),
        ).fetchone()

    assert first_row
    assert second_row
    assert second_row['chat_id'] == expected_chat_id
    assert second_row['version'] == first_row['version']


def test_ensure_saved_messages_chat_updates_contacts_when_chat_id_is_stale(tmp_path):
    db_path = tmp_path / 'favorites-chat-stale-update.db'
    with _connect(db_path) as conn:
        conn.execute('CREATE TABLE chats (chat_id TEXT PRIMARY KEY, chat_name TEXT)')
        conn.execute('CREATE TABLE contacts (user_id INTEGER NOT NULL, contact_id INTEGER NOT NULL, chat_id TEXT)')
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (202, 202, 'legacy-chat-id')
            '''
        )
        conn.commit()

        public_key = 'pk-favorites-2'
        expected_chat_id = saved_messages_chat_id(public_key)
        before_row = conn.execute(
            '''
            SELECT chat_id, CAST(xmin AS TEXT) AS version
            FROM contacts
            WHERE user_id = ? AND contact_id = ?
            ''',
            (202, 202),
        ).fetchone()
        ensure_saved_messages_chat(conn, user_id=202, public_key=public_key)
        conn.commit()

        after_row = conn.execute(
            '''
            SELECT chat_id, CAST(xmin AS TEXT) AS version
            FROM contacts
            WHERE user_id = ? AND contact_id = ?
            ''',
            (202, 202),
        ).fetchone()

    assert before_row
    assert after_row
    assert after_row['chat_id'] == expected_chat_id
    assert after_row['version'] != before_row['version']
