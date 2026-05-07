from pathlib import Path

from app.routes.blocking_handlers import (
    block_user_for_user,
    emit_block_state_events,
    fetch_blocked_users_for_user,
    unblock_user_for_user,
)
from tests._pg_test_db import connect_test_db


def _connect(db_path: Path):
    return connect_test_db(db_path)


def _prepare_schema(conn):
    conn.execute(
        '''
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT,
            display_name TEXT,
            public_key TEXT
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE block_list (
            blocker_id INTEGER NOT NULL,
            blocked_id INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE dialog_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            status TEXT
        )
        '''
    )
    conn.commit()


def test_fetch_blocked_users_for_user_returns_public_projection(tmp_path):
    db_path = tmp_path / 'blocking-handlers-list.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, username, display_name, public_key)
            VALUES
                (1, 'alice', 'Alice', 'pk-1'),
                (2, 'bob', 'Bob', 'pk-2'),
                (3, 'carol', 'Carol', 'pk-3')
            '''
        )
        conn.execute(
            '''
            INSERT INTO block_list (blocker_id, blocked_id, created_at)
            VALUES
                (1, 2, '2026-01-01 00:00:00'),
                (1, 3, '2026-01-02 00:00:00')
            '''
        )
        conn.commit()

        blocked = fetch_blocked_users_for_user(conn, user_id=1)

    assert blocked == [
        {
            'blocked_user_id': 3,
            'blocked_username': 'carol',
            'blocked_display_name': 'Carol',
            'blocked_public_key': 'pk-3',
        },
        {
            'blocked_user_id': 2,
            'blocked_username': 'bob',
            'blocked_display_name': 'Bob',
            'blocked_public_key': 'pk-2',
        },
    ]


def test_block_user_for_user_returns_target_missing_when_user_absent(tmp_path):
    db_path = tmp_path / 'blocking-handlers-missing.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO users (id, username, display_name, public_key) VALUES (1, 'alice', 'Alice', 'pk-1')")
        conn.commit()

        result = block_user_for_user(
            conn,
            user_id=1,
            blocked_user_id=2,
            normalize_block_state_func=lambda state: state,
            build_block_state_func=lambda conn, a, b: {'is_blocked': False},
            emit_block_state_events_func=lambda conn, a, b: None,
        )

    assert result == {'status': 'target_missing'}


def test_block_user_for_user_inserts_block_deletes_requests_and_emits(tmp_path):
    db_path = tmp_path / 'blocking-handlers-block-ok.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, username, display_name, public_key)
            VALUES (1, 'alice', 'Alice', 'pk-1'), (2, 'bob', 'Bob', 'pk-2')
            '''
        )
        conn.execute(
            '''
            INSERT INTO dialog_requests (sender_id, receiver_id, status)
            VALUES
                (1, 2, 'pending'),
                (2, 1, 'pending'),
                (1, 3, 'pending')
            '''
        )
        conn.commit()

        emitted = []
        result = block_user_for_user(
            conn,
            user_id=1,
            blocked_user_id=2,
            normalize_block_state_func=lambda state: {
                'is_blocked': bool(state.get('is_blocked')),
                'blocked_by_me': bool(state.get('blocked_by_me')),
                'blocked_me': bool(state.get('blocked_me')),
            },
            build_block_state_func=lambda conn, a, b: {'is_blocked': True, 'blocked_by_me': True, 'blocked_me': False},
            emit_block_state_events_func=lambda conn, a, b: emitted.append((a, b)),
        )

        block_row = conn.execute(
            'SELECT blocker_id, blocked_id FROM block_list WHERE blocker_id = 1 AND blocked_id = 2'
        ).fetchone()
        requests = conn.execute(
            'SELECT sender_id, receiver_id FROM dialog_requests ORDER BY sender_id, receiver_id'
        ).fetchall()

    assert result == {
        'status': 'ok',
        'block_state': {'is_blocked': True, 'blocked_by_me': True, 'blocked_me': False},
    }
    assert (block_row['blocker_id'], block_row['blocked_id']) == (1, 2)
    assert [(row['sender_id'], row['receiver_id']) for row in requests] == [(1, 3)]
    assert emitted == [(1, 2)]


def test_unblock_user_for_user_deletes_block_and_emits(tmp_path):
    db_path = tmp_path / 'blocking-handlers-unblock-ok.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, username, display_name, public_key)
            VALUES (1, 'alice', 'Alice', 'pk-1'), (2, 'bob', 'Bob', 'pk-2')
            '''
        )
        conn.execute('INSERT INTO block_list (blocker_id, blocked_id) VALUES (1, 2)')
        conn.commit()

        emitted = []
        result = unblock_user_for_user(
            conn,
            user_id=1,
            blocked_user_id=2,
            normalize_block_state_func=lambda state: state,
            build_block_state_func=lambda conn, a, b: {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
            emit_block_state_events_func=lambda conn, a, b: emitted.append((a, b)),
        )

        row = conn.execute(
            'SELECT COUNT(*) AS cnt FROM block_list WHERE blocker_id = 1 AND blocked_id = 2'
        ).fetchone()

    assert result == {
        'status': 'ok',
        'block_state': {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
    }
    assert int(row['cnt']) == 0
    assert emitted == [(1, 2)]


def test_emit_block_state_events_emits_bidirectional_state_and_room_leave(tmp_path):
    db_path = tmp_path / 'blocking-handlers-emit-events.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, username, display_name, public_key)
            VALUES (1, 'alice', 'Alice', 'pk-1'), (2, 'bob', 'Bob', 'pk-2')
            '''
        )
        conn.commit()

        emitted = []
        emit_block_state_events(
            conn,
            a_user_id=1,
            b_user_id=2,
            shared_chat_id_func=lambda conn, a, b: 'chat-1',
            normalize_block_state_func=lambda state: state,
            build_block_state_func=lambda conn, a, b: {
                'is_blocked': True,
                'blocked_by_me': True,
                'blocked_me': a == 2 and b == 1,
            },
            emit_func=lambda name, payload, **kwargs: emitted.append(
                {'name': name, 'payload': payload, 'kwargs': kwargs}
            ),
        )

    assert emitted == [
        {
            'name': 'chat_block_state',
            'payload': {
                'chat_id': 'chat-1',
                'partner_user_id': 2,
                'is_blocked': True,
                'blocked_by_me': True,
                'blocked_me': False,
            },
            'kwargs': {'room': 'pk-1'},
        },
        {
            'name': 'chat_block_state',
            'payload': {
                'chat_id': 'chat-1',
                'partner_user_id': 1,
                'is_blocked': True,
                'blocked_by_me': True,
                'blocked_me': True,
            },
            'kwargs': {'room': 'pk-2'},
        },
        {
            'name': 'force_leave_chat',
            'payload': {'chat_id': 'chat-1'},
            'kwargs': {'room': 'pk-1'},
        },
        {
            'name': 'force_leave_chat',
            'payload': {'chat_id': 'chat-1'},
            'kwargs': {'room': 'pk-2'},
        },
        {
            'name': 'partner_stop_typing',
            'payload': {'chat_id': 'chat-1'},
            'kwargs': {'room': 'pk-1'},
        },
        {
            'name': 'partner_stop_typing',
            'payload': {'chat_id': 'chat-1'},
            'kwargs': {'room': 'pk-2'},
        },
        {
            'name': 'you_are_blocked',
            'payload': {
                'blocker_public_key': 'pk-1',
                'chat_id': 'chat-1',
            },
            'kwargs': {'room': 'pk-2'},
        },
    ]


def test_emit_block_state_events_returns_when_any_user_missing(tmp_path):
    db_path = tmp_path / 'blocking-handlers-emit-missing.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            "INSERT INTO users (id, username, display_name, public_key) VALUES (1, 'alice', 'Alice', 'pk-1')"
        )
        conn.commit()

        emitted = []
        emit_block_state_events(
            conn,
            a_user_id=1,
            b_user_id=2,
            shared_chat_id_func=lambda conn, a, b: None,
            normalize_block_state_func=lambda state: state,
            build_block_state_func=lambda conn, a, b: {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
            emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        )

    assert emitted == []
