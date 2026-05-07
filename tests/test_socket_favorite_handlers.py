from pathlib import Path

from app.sockets.favorite_handlers import (
    handle_favorite_message_event,
    handle_unfavorite_message_event,
)
from tests._pg_test_db import connect_test_db


def _connect(db_path: Path):
    return connect_test_db(db_path)


def _prepare_schema(conn):
    conn.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, public_key TEXT NOT NULL)')
    conn.execute(
        '''
        CREATE TABLE chats (
            chat_id TEXT PRIMARY KEY
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY,
            chat_id TEXT NOT NULL,
            sender_id INTEGER NOT NULL,
            message TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE favorite_messages (
            user_id INTEGER NOT NULL,
            chat_id TEXT NOT NULL,
            message_id INTEGER NOT NULL,
            message_content TEXT NOT NULL,
            sender_pub TEXT,
            favorited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, message_id)
        )
        '''
    )
    conn.commit()


def _positive_int(value):
    return int(value) if str(value).isdigit() else None


def test_handle_favorite_message_event_is_idempotent_and_emits(tmp_path):
    db_path = tmp_path / 'socket-favorite-handler-fav-ok.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO chats (chat_id) VALUES ('chat-a')")
        conn.execute("INSERT INTO users (id, public_key) VALUES (2, 'pk-2')")
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, message, created_at)
            VALUES (70, 'chat-a', 2, 'hello', '2026-01-01 00:00:00')
            '''
        )
        conn.commit()

    emitted = []

    for _ in range(2):
        handle_favorite_message_event(
            {'chat_id': 'chat-a', 'message_id': 70},
            session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
            require_payload_dict_func=lambda payload: payload,
            socket_csrf_ok_func=lambda payload: True,
            positive_int_func=_positive_int,
            is_valid_chat_id_func=lambda chat_id: True,
            socket_rate_ok_func=lambda uid, event_name=None: True,
            get_db_connection_func=lambda: _connect(db_path),
            chat_partner_state_func=lambda conn, uid, chat_id: ({'contact_id': 2, 'public_key': 'pk-2'}, {'is_blocked': False}),
            emit_blocked_error_func=lambda message, state: None,
            emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
            utc_now_z_func=lambda: '2026-01-01T10:00:00.000Z',
        )

    with _connect(db_path) as conn:
        rows = conn.execute(
            '''
            SELECT user_id, chat_id, message_id, message_content, sender_pub
            FROM favorite_messages
            WHERE user_id = 1
            '''
        ).fetchall()

    assert len(rows) == 1
    row = rows[0]
    assert int(row['user_id']) == 1
    assert row['chat_id'] == 'chat-a'
    assert int(row['message_id']) == 70
    assert row['message_content'] == 'hello'
    assert row['sender_pub'] == 'pk-2'
    assert any(event[0] == 'message_favorited' and event[2].get('room') == 'pk-1' for event in emitted)


def test_handle_unfavorite_message_event_is_idempotent_and_emits(tmp_path):
    db_path = tmp_path / 'socket-favorite-handler-unfav-ok.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO chats (chat_id) VALUES ('chat-a')")
        conn.execute(
            '''
            INSERT INTO favorite_messages (user_id, chat_id, message_id, message_content, sender_pub)
            VALUES (1, 'chat-a', 81, 'hello', 'pk-2')
            '''
        )
        conn.commit()

    emitted = []

    for _ in range(2):
        handle_unfavorite_message_event(
            {'chat_id': 'chat-a', 'message_id': 81},
            session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
            require_payload_dict_func=lambda payload: payload,
            socket_csrf_ok_func=lambda payload: True,
            positive_int_func=_positive_int,
            is_valid_chat_id_func=lambda chat_id: True,
            socket_rate_ok_func=lambda uid, event_name=None: True,
            get_db_connection_func=lambda: _connect(db_path),
            chat_partner_state_func=lambda conn, uid, chat_id: ({'contact_id': 2, 'public_key': 'pk-2'}, {'is_blocked': False}),
            emit_blocked_error_func=lambda message, state: None,
            emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        )

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT COUNT(*) AS cnt
            FROM favorite_messages
            WHERE user_id = 1 AND chat_id = 'chat-a'
            '''
        ).fetchone()

    assert int(row['cnt']) == 0
    assert any(
        event[0] == 'message_unfavorited'
        and event[1] == {'chat_id': 'chat-a', 'message_id': 81}
        and event[2].get('room') == 'pk-1'
        for event in emitted
    )
