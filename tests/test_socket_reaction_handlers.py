from pathlib import Path

from app.sockets.reaction_handlers import handle_toggle_reaction_event
from app.db_backend import DatabaseError
from tests._pg_test_db import connect_test_db


def _connect(db_path: Path):
    return connect_test_db(db_path)


def _prepare_schema(conn):
    conn.execute(
        '''
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY,
            chat_id TEXT NOT NULL,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            deleted_by_sender INTEGER NOT NULL DEFAULT 0,
            deleted_by_receiver INTEGER NOT NULL DEFAULT 0
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE message_reactions (
            message_id INTEGER NOT NULL,
            chat_id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            emoji TEXT NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        '''
    )
    conn.commit()


def _positive_int(value):
    return int(value) if str(value).isdigit() else None


def test_handle_toggle_reaction_event_adds_and_emits_for_both_users(tmp_path):
    db_path = tmp_path / 'socket-reaction-handler-add.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, receiver_id)
            VALUES (10, 'chat-a', 2, 1)
            '''
        )
        conn.commit()

    emitted = []
    blocked_errors = []

    handle_toggle_reaction_event(
        {'chat_id': 'chat-a', 'message_id': 10, 'emoji': '👍', 'request_id': 'req-1'},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        positive_int_func=_positive_int,
        sanitize_reaction_emoji_func=lambda value: str(value or '').strip() or None,
        normalize_request_id_func=lambda value: str(value or '').strip(),
        is_valid_chat_id_func=lambda chat_id: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        get_db_connection_func=lambda: _connect(db_path),
        chat_partner_state_func=lambda conn, uid, chat_id: ({'contact_id': 2, 'public_key': 'pk-2'}, {'is_blocked': False}),
        emit_blocked_error_func=lambda message, state, request_id=None: blocked_errors.append((message, state, request_id)),
        fetch_reactions_map_func=lambda conn, chat_id, message_ids, viewer_id: {
            10: [{'emoji': '👍', 'count': 1, 'reacted_by_me': bool(viewer_id == 1)}]
        },
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        utc_now_iso_func=lambda: '2026-01-01T10:20:30.000+00:00',
        logger=type('Logger', (), {'error': lambda self, msg, *args: None})(),
        database_error_cls=DatabaseError,
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT emoji, user_id
            FROM message_reactions
            WHERE message_id = 10
            '''
        ).fetchone()

    assert blocked_errors == []
    assert row['emoji'] == '👍'
    assert int(row['user_id']) == 1
    assert any(
        event[0] == 'message_reactions_updated'
        and event[1]['action'] == 'added'
        and event[1]['request_id'] == 'req-1'
        and event[2].get('room') == 'pk-1'
        for event in emitted
    )
    assert any(
        event[0] == 'message_reactions_updated'
        and event[1]['action'] == 'added'
        and event[2].get('room') == 'pk-2'
        for event in emitted
    )


def test_handle_toggle_reaction_event_removes_same_emoji(tmp_path):
    db_path = tmp_path / 'socket-reaction-handler-remove.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, receiver_id)
            VALUES (11, 'chat-a', 2, 1)
            '''
        )
        conn.execute(
            '''
            INSERT INTO message_reactions (message_id, chat_id, user_id, emoji)
            VALUES (11, 'chat-a', 1, '👍')
            '''
        )
        conn.commit()

    emitted = []

    handle_toggle_reaction_event(
        {'chat_id': 'chat-a', 'message_id': 11, 'emoji': '👍'},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        positive_int_func=_positive_int,
        sanitize_reaction_emoji_func=lambda value: str(value or '').strip() or None,
        normalize_request_id_func=lambda value: str(value or '').strip(),
        is_valid_chat_id_func=lambda chat_id: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        get_db_connection_func=lambda: _connect(db_path),
        chat_partner_state_func=lambda conn, uid, chat_id: ({'contact_id': 2, 'public_key': 'pk-2'}, {'is_blocked': False}),
        emit_blocked_error_func=lambda message, state, request_id=None: None,
        fetch_reactions_map_func=lambda conn, chat_id, message_ids, viewer_id: {11: []},
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        utc_now_iso_func=lambda: '2026-01-01T10:20:30.000+00:00',
        logger=type('Logger', (), {'error': lambda self, msg, *args: None})(),
        database_error_cls=DatabaseError,
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT COUNT(*) AS cnt
            FROM message_reactions
            WHERE message_id = 11 AND user_id = 1
            '''
        ).fetchone()

    assert int(row['cnt']) == 0
    assert any(event[0] == 'message_reactions_updated' and event[1]['action'] == 'removed' for event in emitted)


def test_handle_toggle_reaction_event_blocked_emits_state_and_error(tmp_path):
    db_path = tmp_path / 'socket-reaction-handler-blocked.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, receiver_id)
            VALUES (12, 'chat-a', 2, 1)
            '''
        )
        conn.commit()

    emitted = []
    blocked_errors = []

    handle_toggle_reaction_event(
        {'chat_id': 'chat-a', 'message_id': 12, 'emoji': '🔥', 'request_id': 'req-22'},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        positive_int_func=_positive_int,
        sanitize_reaction_emoji_func=lambda value: str(value or '').strip() or None,
        normalize_request_id_func=lambda value: str(value or '').strip(),
        is_valid_chat_id_func=lambda chat_id: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        get_db_connection_func=lambda: _connect(db_path),
        chat_partner_state_func=lambda conn, uid, chat_id: (
            {'contact_id': 2, 'public_key': 'pk-2'},
            {'is_blocked': True, 'blocked_by_me': False, 'blocked_me': True},
        ),
        emit_blocked_error_func=lambda message, state, request_id=None: blocked_errors.append((message, state, request_id)),
        fetch_reactions_map_func=lambda conn, chat_id, message_ids, viewer_id: {},
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        utc_now_iso_func=lambda: '2026-01-01T10:20:30.000+00:00',
        logger=type('Logger', (), {'error': lambda self, msg, *args: None})(),
        database_error_cls=DatabaseError,
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT COUNT(*) AS cnt
            FROM message_reactions
            WHERE message_id = 12
            '''
        ).fetchone()

    assert int(row['cnt']) == 0
    assert any(event[0] == 'chat_block_state' and event[1]['chat_id'] == 'chat-a' for event in emitted)
    assert blocked_errors == [
        (
            'Reactions are unavailable because the user is blocked.',
            {'is_blocked': True, 'blocked_by_me': False, 'blocked_me': True},
            'req-22',
        )
    ]


def test_handle_toggle_reaction_event_invalid_payload_includes_request_id():
    emitted = []

    handle_toggle_reaction_event(
        {'chat_id': 'chat-a', 'message_id': 'invalid', 'emoji': '', 'request_id': 'req-x'},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        positive_int_func=_positive_int,
        sanitize_reaction_emoji_func=lambda value: str(value or '').strip() or None,
        normalize_request_id_func=lambda value: str(value or '').strip(),
        is_valid_chat_id_func=lambda chat_id: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        get_db_connection_func=lambda: None,
        chat_partner_state_func=lambda conn, uid, chat_id: (None, None),
        emit_blocked_error_func=lambda message, state, request_id=None: None,
        fetch_reactions_map_func=lambda conn, chat_id, message_ids, viewer_id: {},
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        utc_now_iso_func=lambda: '2026-01-01T10:20:30.000+00:00',
        logger=type('Logger', (), {'error': lambda self, msg, *args: None})(),
        database_error_cls=DatabaseError,
    )

    assert emitted == [
        ('error', {'message': 'Invalid reaction payload.', 'request_id': 'req-x'}, {})
    ]
