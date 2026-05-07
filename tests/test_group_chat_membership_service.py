from __future__ import annotations

import sqlite3

from app.services.group_chat_membership_service import remove_group_member_with_cleanup


def _connect_in_memory() -> sqlite3.Connection:
    conn = sqlite3.connect(':memory:')
    conn.row_factory = sqlite3.Row
    conn.execute(
        '''
        CREATE TABLE chat_members (
            user_id INTEGER,
            chat_id TEXT,
            role TEXT
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE contacts (
            user_id INTEGER,
            chat_id TEXT
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY,
            chat_id TEXT
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE message_receipts (
            message_id INTEGER,
            user_id INTEGER,
            deleted_for_user INTEGER,
            updated_at TEXT
        )
        '''
    )
    return conn


def test_remove_group_member_with_cleanup_removes_rows_and_hides_receipts():
    conn = _connect_in_memory()
    try:
        conn.execute("INSERT INTO chat_members (user_id, chat_id, role) VALUES (2, 'g1', 'member')")
        conn.execute("INSERT INTO contacts (user_id, chat_id) VALUES (2, 'g1')")
        conn.execute("INSERT INTO messages (id, chat_id) VALUES (11, 'g1')")
        conn.execute(
            "INSERT INTO message_receipts (message_id, user_id, deleted_for_user, updated_at) VALUES (11, 2, 0, NULL)"
        )
        conn.commit()

        remove_group_member_with_cleanup(conn, chat_id='g1', user_id=2)
        conn.commit()

        member_row = conn.execute(
            "SELECT 1 FROM chat_members WHERE user_id = 2 AND chat_id = 'g1'"
        ).fetchone()
        contact_row = conn.execute(
            "SELECT 1 FROM contacts WHERE user_id = 2 AND chat_id = 'g1'"
        ).fetchone()
        receipt_row = conn.execute(
            "SELECT deleted_for_user FROM message_receipts WHERE message_id = 11 AND user_id = 2"
        ).fetchone()
    finally:
        conn.close()

    assert member_row is None
    assert contact_row is None
    assert int(receipt_row['deleted_for_user']) == 1


def test_remove_group_member_with_cleanup_supports_hiding_toggle():
    conn = _connect_in_memory()
    try:
        conn.execute("INSERT INTO chat_members (user_id, chat_id, role) VALUES (2, 'g1', 'member')")
        conn.execute("INSERT INTO contacts (user_id, chat_id) VALUES (2, 'g1')")
        conn.execute("INSERT INTO messages (id, chat_id) VALUES (11, 'g1')")
        conn.execute(
            "INSERT INTO message_receipts (message_id, user_id, deleted_for_user, updated_at) VALUES (11, 2, 0, NULL)"
        )
        conn.commit()

        remove_group_member_with_cleanup(conn, chat_id='g1', user_id=2, hide_messages=False)
        conn.commit()

        receipt_row = conn.execute(
            "SELECT deleted_for_user FROM message_receipts WHERE message_id = 11 AND user_id = 2"
        ).fetchone()
    finally:
        conn.close()

    assert int(receipt_row['deleted_for_user']) == 0
