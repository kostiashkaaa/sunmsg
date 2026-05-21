from pathlib import Path

from app.routes.dialog_request_workflows import (
    accept_dialog_request_workflow,
    decline_dialog_request_workflow,
    send_dialog_request_workflow,
)
from tests._pg_test_db import connect_test_db


def _connect(db_path: Path):
    return connect_test_db(db_path)


def _prepare_schema(conn):
    conn.execute(
        '''
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            public_key TEXT NOT NULL,
            username TEXT NOT NULL,
            display_name TEXT NOT NULL,
            avatar_url TEXT,
            avatar_visibility TEXT DEFAULT 'all',
            auto_decline_requests INTEGER NOT NULL DEFAULT 0
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE dialog_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE block_list (
            blocker_id INTEGER NOT NULL,
            blocked_id INTEGER NOT NULL
        )
        '''
    )
    conn.execute('CREATE TABLE chats (chat_id TEXT PRIMARY KEY, chat_name TEXT)')
    conn.execute(
        '''
        CREATE TABLE contacts (
            user_id INTEGER NOT NULL,
            contact_id INTEGER NOT NULL,
            chat_id TEXT NOT NULL
        )
        '''
    )
    conn.commit()


def test_send_dialog_request_workflow_success_persists_and_returns_event(tmp_path):
    db_path = tmp_path / 'dialog-request-workflow-send-ok.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, avatar_url, avatar_visibility, auto_decline_requests)
            VALUES
                (1, 'pk-1', 'alice', 'Alice', '/static/a.png', 'contacts', 0),
                (2, 'pk-2', 'bob', 'Bob', '/static/b.png', 'all', 0)
            '''
        )
        conn.commit()

        result = send_dialog_request_workflow(
            conn,
            sender_user_id=1,
            receiver_user_id=2,
            normalize_block_state_func=lambda state: state,
            build_block_state_func=lambda conn, a, b: {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
        )
        row = conn.execute(
            'SELECT sender_id, receiver_id, status FROM dialog_requests WHERE sender_id = 1 AND receiver_id = 2'
        ).fetchone()

    assert result['status'] == 'ok'
    assert row['status'] == 'pending'
    assert result['event'] == {
        'room': 'pk-2',
        'payload': {
            'sender_public_key': 'pk-1',
            'sender_display_name': 'Alice',
            'sender_username': 'alice',
            'sender_avatar': None,
        },
    }


def test_send_dialog_request_workflow_returns_blocked_state(tmp_path):
    db_path = tmp_path / 'dialog-request-workflow-send-blocked.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice'), (2, 'pk-2', 'bob', 'Bob')
            '''
        )
        conn.commit()

        result = send_dialog_request_workflow(
            conn,
            sender_user_id=1,
            receiver_user_id=2,
            normalize_block_state_func=lambda state: state,
            build_block_state_func=lambda conn, a, b: {'is_blocked': True, 'blocked_by_me': True, 'blocked_me': False},
        )
        row = conn.execute(
            'SELECT COUNT(*) AS cnt FROM dialog_requests WHERE sender_id = 1 AND receiver_id = 2'
        ).fetchone()

    assert result == {
        'status': 'blocked',
        'block_state': {'is_blocked': True, 'blocked_by_me': True, 'blocked_me': False},
    }
    assert int(row['cnt']) == 0


def test_send_dialog_request_workflow_enforces_repeat_cooldown(tmp_path):
    db_path = tmp_path / 'dialog-request-workflow-send-cooldown.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, auto_decline_requests)
            VALUES
                (1, 'pk-1', 'alice', 'Alice', 0),
                (2, 'pk-2', 'bob', 'Bob', 0)
            '''
        )
        conn.commit()

        first = send_dialog_request_workflow(
            conn,
            sender_user_id=1,
            receiver_user_id=2,
            normalize_block_state_func=lambda state: state,
            build_block_state_func=lambda conn, a, b: {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
        )
        second = send_dialog_request_workflow(
            conn,
            sender_user_id=1,
            receiver_user_id=2,
            normalize_block_state_func=lambda state: state,
            build_block_state_func=lambda conn, a, b: {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
        )
        row = conn.execute(
            'SELECT COUNT(*) AS cnt FROM dialog_requests WHERE sender_id = 1 AND receiver_id = 2'
        ).fetchone()

    assert first['status'] == 'ok'
    assert second['status'] == 'cooldown'
    assert int(second['retry_after']) > 0
    assert int(row['cnt']) == 1


def test_send_dialog_request_workflow_replays_event_for_existing_pending_after_cooldown(tmp_path):
    db_path = tmp_path / 'dialog-request-workflow-send-replay.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, avatar_url, avatar_visibility, auto_decline_requests)
            VALUES
                (1, 'pk-1', 'alice', 'Alice', '/static/a.png', 'all', 0),
                (2, 'pk-2', 'bob', 'Bob', NULL, 'all', 0)
            '''
        )
        conn.execute(
            '''
            INSERT INTO dialog_requests (sender_id, receiver_id, status, timestamp)
            VALUES (1, 2, 'pending', '2000-01-01 00:00:00')
            '''
        )
        conn.commit()

        result = send_dialog_request_workflow(
            conn,
            sender_user_id=1,
            receiver_user_id=2,
            normalize_block_state_func=lambda state: state,
            build_block_state_func=lambda conn, a, b: {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
        )

    assert result == {
        'status': 'ok',
        'event': {
            'room': 'pk-2',
            'payload': {
                'sender_public_key': 'pk-1',
                'sender_display_name': 'Alice',
                'sender_username': 'alice',
                'sender_avatar': '/static/a.png',
            },
        },
    }


def test_accept_dialog_request_workflow_creates_chat_contacts_and_accepts_request(tmp_path):
    db_path = tmp_path / 'dialog-request-workflow-accept-ok.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice'), (2, 'pk-2', 'bob', 'Bob')
            '''
        )
        conn.execute(
            '''
            INSERT INTO dialog_requests (sender_id, receiver_id, status)
            VALUES (1, 2, 'pending')
            '''
        )
        conn.commit()

        result = accept_dialog_request_workflow(
            conn,
            receiver_user_id=2,
            sender_public_key='pk-1',
            normalize_block_state_func=lambda state: state,
            build_block_state_func=lambda conn, a, b: {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
            generate_chat_id_func=lambda a, b: 'chat-12',
            default_chat_name='chat',
        )
        request_row = conn.execute(
            'SELECT status FROM dialog_requests WHERE sender_id = 1 AND receiver_id = 2'
        ).fetchone()
        chat_row = conn.execute('SELECT chat_id, chat_name FROM chats WHERE chat_id = ?', ('chat-12',)).fetchone()
        contacts = conn.execute(
            'SELECT user_id, contact_id, chat_id FROM contacts ORDER BY user_id ASC, contact_id ASC'
        ).fetchall()

    assert result['status'] == 'ok'
    assert result['chat_id'] == 'chat-12'
    assert request_row['status'] == 'accepted'
    assert (chat_row['chat_id'], chat_row['chat_name']) == ('chat-12', 'chat')
    assert [(row['user_id'], row['contact_id'], row['chat_id']) for row in contacts] == [
        (1, 2, 'chat-12'),
        (2, 1, 'chat-12'),
    ]


def test_decline_dialog_request_workflow_marks_request_declined(tmp_path):
    db_path = tmp_path / 'dialog-request-workflow-decline-ok.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES (1, 'pk-1', 'alice', 'Alice'), (2, 'pk-2', 'bob', 'Bob')
            '''
        )
        conn.execute(
            '''
            INSERT INTO dialog_requests (sender_id, receiver_id, status)
            VALUES (1, 2, 'pending')
            '''
        )
        conn.commit()

        result = decline_dialog_request_workflow(
            conn,
            receiver_user_id=2,
            sender_public_key='pk-1',
        )
        request_row = conn.execute(
            'SELECT status FROM dialog_requests WHERE sender_id = 1 AND receiver_id = 2'
        ).fetchone()

    assert result == {
        'status': 'ok',
        'updated': True,
        'sender_public_key': 'pk-1',
        'sender_display_name': 'Bob',
    }
    assert request_row['status'] == 'declined'
