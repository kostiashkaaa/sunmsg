from pathlib import Path

from app.routes.pinned_chat_handlers import (
    normalize_reordered_pinned_chat_ids,
    pin_chat_for_user,
    reorder_pinned_chats_for_user,
    unpin_chat_for_user,
)
from tests._pg_test_db import connect_test_db


def _connect(db_path: Path):
    return connect_test_db(db_path)


def _prepare_schema(conn):
    conn.execute('CREATE TABLE users (id INTEGER PRIMARY KEY)')
    conn.execute('CREATE TABLE chats (chat_id TEXT PRIMARY KEY)')
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
        CREATE TABLE chat_members (
            user_id INTEGER NOT NULL,
            chat_id TEXT NOT NULL
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE pinned_chats (
            user_id INTEGER NOT NULL,
            chat_id TEXT NOT NULL,
            pin_order INTEGER NOT NULL DEFAULT 0,
            pinned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, chat_id)
        )
        '''
    )
    conn.commit()


def _ensure_pinned_chats_table(conn):
    conn.execute(
        '''
        CREATE TABLE IF NOT EXISTS pinned_chats (
            user_id INTEGER NOT NULL,
            chat_id TEXT NOT NULL,
            pin_order INTEGER NOT NULL DEFAULT 0,
            pinned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, chat_id)
        )
        '''
    )


def test_pin_chat_for_user_returns_not_found_when_chat_not_in_contacts(tmp_path):
    db_path = tmp_path / 'pin-handler-not-found.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO users (id) VALUES (1)")
        conn.execute("INSERT INTO chats (chat_id) VALUES ('chat-a')")
        conn.commit()

        result = pin_chat_for_user(
            conn,
            user_id=1,
            chat_id='chat-a',
            ensure_pinned_chats_table_func=_ensure_pinned_chats_table,
            ensure_chat_exists_func=lambda conn, chat_id: None,
        )

    assert result == {'status': 'chat_not_found'}


def test_pin_chat_for_user_returns_existing_order_when_already_pinned(tmp_path):
    db_path = tmp_path / 'pin-handler-existing.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO users (id) VALUES (1), (2)")
        conn.execute("INSERT INTO chats (chat_id) VALUES ('chat-a')")
        conn.execute("INSERT INTO contacts (user_id, contact_id, chat_id) VALUES (1, 2, 'chat-a')")
        conn.execute("INSERT INTO pinned_chats (user_id, chat_id, pin_order) VALUES (1, 'chat-a', 7)")
        conn.commit()

        result = pin_chat_for_user(
            conn,
            user_id=1,
            chat_id='chat-a',
            ensure_pinned_chats_table_func=_ensure_pinned_chats_table,
            ensure_chat_exists_func=lambda conn, chat_id: None,
        )

    assert result == {'status': 'ok', 'pin_order': 7}


def test_pin_chat_for_user_inserts_with_next_order(tmp_path):
    db_path = tmp_path / 'pin-handler-insert.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO users (id) VALUES (1), (2), (3)")
        conn.execute("INSERT INTO chats (chat_id) VALUES ('chat-a'), ('chat-b')")
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, 'chat-a'), (1, 3, 'chat-b')
            '''
        )
        conn.execute("INSERT INTO pinned_chats (user_id, chat_id, pin_order) VALUES (1, 'chat-a', 3)")
        conn.commit()

        ensured = []
        result = pin_chat_for_user(
            conn,
            user_id=1,
            chat_id='chat-b',
            ensure_pinned_chats_table_func=_ensure_pinned_chats_table,
            ensure_chat_exists_func=lambda conn, chat_id: ensured.append(chat_id),
        )

        pinned = conn.execute(
            "SELECT pin_order FROM pinned_chats WHERE user_id = 1 AND chat_id = 'chat-b'"
        ).fetchone()

    assert ensured == ['chat-b']
    assert result == {'status': 'ok', 'pin_order': 4}
    assert int(pinned['pin_order']) == 4


def test_pin_chat_for_user_allows_group_member_without_contact(tmp_path):
    db_path = tmp_path / 'pin-handler-group-member.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO users (id) VALUES (1)")
        conn.execute("INSERT INTO chats (chat_id) VALUES ('group-a')")
        conn.execute("INSERT INTO chat_members (user_id, chat_id) VALUES (1, 'group-a')")
        conn.commit()

        ensured = []
        result = pin_chat_for_user(
            conn,
            user_id=1,
            chat_id='group-a',
            ensure_pinned_chats_table_func=_ensure_pinned_chats_table,
            ensure_chat_exists_func=lambda conn, chat_id: ensured.append(chat_id),
        )
        pinned = conn.execute(
            "SELECT pin_order FROM pinned_chats WHERE user_id = 1 AND chat_id = 'group-a'"
        ).fetchone()

    assert ensured == ['group-a']
    assert result == {'status': 'ok', 'pin_order': 0}
    assert int(pinned['pin_order']) == 0


def test_unpin_chat_for_user_deletes_target_pin(tmp_path):
    db_path = tmp_path / 'pin-handler-unpin.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO pinned_chats (user_id, chat_id, pin_order) VALUES (1, 'chat-a', 0)")
        conn.execute("INSERT INTO pinned_chats (user_id, chat_id, pin_order) VALUES (1, 'chat-b', 1)")
        conn.commit()

        unpin_chat_for_user(
            conn,
            user_id=1,
            chat_id='chat-a',
            ensure_pinned_chats_table_func=_ensure_pinned_chats_table,
        )

        remaining = conn.execute(
            "SELECT chat_id FROM pinned_chats WHERE user_id = 1 ORDER BY pin_order ASC"
        ).fetchall()

    assert [row['chat_id'] for row in remaining] == ['chat-b']


def test_normalize_reordered_pinned_chat_ids_filters_invalid_and_appends_rest():
    normalized = normalize_reordered_pinned_chat_ids(
        ['chat-1', 'chat-2', 'chat-3'],
        ['chat-2', 'missing', 'chat-2', '  ', 'chat-1'],
    )

    assert normalized == ['chat-2', 'chat-1', 'chat-3']


def test_reorder_pinned_chats_for_user_updates_orders(tmp_path):
    db_path = tmp_path / 'pin-handler-reorder.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO pinned_chats (user_id, chat_id, pin_order) VALUES (1, 'chat-a', 0)")
        conn.execute("INSERT INTO pinned_chats (user_id, chat_id, pin_order) VALUES (1, 'chat-b', 1)")
        conn.execute("INSERT INTO pinned_chats (user_id, chat_id, pin_order) VALUES (1, 'chat-c', 2)")
        conn.commit()

        normalized = reorder_pinned_chats_for_user(
            conn,
            user_id=1,
            ordered_ids=['chat-c', 'chat-a', 'chat-c', 'missing'],
            ensure_pinned_chats_table_func=_ensure_pinned_chats_table,
        )
        rows = conn.execute(
            "SELECT chat_id, pin_order FROM pinned_chats WHERE user_id = 1 ORDER BY pin_order ASC"
        ).fetchall()

    assert normalized == ['chat-c', 'chat-a', 'chat-b']
    assert [(row['chat_id'], row['pin_order']) for row in rows] == [
        ('chat-c', 0),
        ('chat-a', 1),
        ('chat-b', 2),
    ]
