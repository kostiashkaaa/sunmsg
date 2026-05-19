from pathlib import Path

from app.sockets.pin_handlers import (
    handle_pin_message_event,
    handle_unpin_message_event,
)
from tests._pg_test_db import connect_test_db


def _connect(db_path: Path):
    return connect_test_db(db_path)


def _prepare_schema(conn):
    conn.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, public_key TEXT NOT NULL)')
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
        CREATE TABLE chat_pins (
            chat_id TEXT NOT NULL,
            message_id INTEGER NOT NULL,
            message_content TEXT NOT NULL,
            pinned_by INTEGER NOT NULL,
            sender_pub TEXT,
            pinned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(chat_id, message_id)
        )
        '''
    )
    conn.commit()


def _positive_int(value):
    return int(value) if str(value).isdigit() else None


def test_handle_pin_message_event_inserts_pin_and_emits(tmp_path):
    db_path = tmp_path / 'socket-pin-handler-pin-ok.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO users (id, public_key) VALUES (2, 'pk-2')")
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, message, created_at)
            VALUES (20, 'chat-a', 2, 'hello', '2026-01-01 00:00:00')
            '''
        )
        conn.commit()

    emitted = []
    blocked_errors = []
    ensure_calls = []

    handle_pin_message_event(
        {'chat_id': 'chat-a', 'message_id': 20},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        ensure_chat_pins_multiple_support_func=lambda: ensure_calls.append('ok'),
        positive_int_func=_positive_int,
        is_valid_chat_id_func=lambda chat_id: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        get_db_connection_func=lambda: _connect(db_path),
        chat_partner_state_func=lambda conn, uid, chat_id: ({'contact_id': 2, 'public_key': 'pk-2'}, {'is_blocked': False}),
        emit_blocked_error_func=lambda message, state: blocked_errors.append((message, state)),
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        utc_now_z_func=lambda: '2026-01-01T10:00:00.000Z',
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT message_id, message_content, pinned_by, sender_pub
            FROM chat_pins
            WHERE chat_id = 'chat-a'
            '''
        ).fetchone()

    assert ensure_calls == ['ok']
    assert blocked_errors == []
    assert int(row['message_id']) == 20
    assert row['message_content'] == 'hello'
    assert int(row['pinned_by']) == 1
    assert row['sender_pub'] == 'pk-2'
    assert any(event[0] == 'message_pinned' and event[2].get('room') == 'chat-a' for event in emitted)
    assert any(event[0] == 'message_pinned' and event[2].get('room') == 'pk-1' for event in emitted)
    assert any(event[0] == 'message_pinned' and event[2].get('room') == 'pk-2' for event in emitted)


def test_handle_pin_message_event_blocked_emits_state_and_error(tmp_path):
    db_path = tmp_path / 'socket-pin-handler-pin-blocked.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO users (id, public_key) VALUES (2, 'pk-2')")
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, message, created_at)
            VALUES (21, 'chat-a', 2, 'hello', '2026-01-01 00:00:00')
            '''
        )
        conn.commit()

    emitted = []
    blocked_errors = []

    handle_pin_message_event(
        {'chat_id': 'chat-a', 'message_id': 21},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        ensure_chat_pins_multiple_support_func=lambda: None,
        positive_int_func=_positive_int,
        is_valid_chat_id_func=lambda chat_id: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        get_db_connection_func=lambda: _connect(db_path),
        chat_partner_state_func=lambda conn, uid, chat_id: (
            {'contact_id': 2, 'public_key': 'pk-2'},
            {'is_blocked': True, 'blocked_by_me': True, 'blocked_me': False},
        ),
        emit_blocked_error_func=lambda message, state: blocked_errors.append((message, state)),
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        utc_now_z_func=lambda: '2026-01-01T10:00:00.000Z',
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT COUNT(*) AS cnt
            FROM chat_pins
            WHERE chat_id = 'chat-a'
            '''
        ).fetchone()

    assert int(row['cnt']) == 0
    assert any(event[0] == 'chat_block_state' and event[1]['chat_id'] == 'chat-a' for event in emitted)
    assert blocked_errors == [
        (
            'Pinning is unavailable because the user is blocked.',
            {'is_blocked': True, 'blocked_by_me': True, 'blocked_me': False},
        )
    ]


def test_handle_unpin_message_event_deletes_specific_message(tmp_path):
    db_path = tmp_path / 'socket-pin-handler-unpin-one.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO chat_pins (chat_id, message_id, message_content, pinned_by, sender_pub) VALUES ('chat-a', 31, 'm31', 1, 'pk-2')")
        conn.execute("INSERT INTO chat_pins (chat_id, message_id, message_content, pinned_by, sender_pub) VALUES ('chat-a', 32, 'm32', 1, 'pk-2')")
        conn.commit()

    emitted = []

    handle_unpin_message_event(
        {'chat_id': 'chat-a', 'message_id': 31},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        ensure_chat_pins_multiple_support_func=lambda: None,
        positive_int_func=_positive_int,
        is_valid_chat_id_func=lambda chat_id: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        get_db_connection_func=lambda: _connect(db_path),
        chat_partner_state_func=lambda conn, uid, chat_id: ({'contact_id': 2, 'public_key': 'pk-2'}, {'is_blocked': False}),
        emit_blocked_error_func=lambda message, state: None,
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
    )

    with _connect(db_path) as conn:
        row31 = conn.execute(
            '''
            SELECT COUNT(*) AS cnt
            FROM chat_pins
            WHERE chat_id = 'chat-a' AND message_id = 31
            '''
        ).fetchone()
        row32 = conn.execute(
            '''
            SELECT COUNT(*) AS cnt
            FROM chat_pins
            WHERE chat_id = 'chat-a' AND message_id = 32
            '''
        ).fetchone()

    assert int(row31['cnt']) == 0
    assert int(row32['cnt']) == 1
    assert any(
        event[0] == 'message_unpinned'
        and event[1]['message_id'] == 31
        and event[2].get('room') == 'chat-a'
        for event in emitted
    )


def test_handle_unpin_message_event_without_message_id_deletes_all_chat_pins(tmp_path):
    db_path = tmp_path / 'socket-pin-handler-unpin-all.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO chat_pins (chat_id, message_id, message_content, pinned_by, sender_pub) VALUES ('chat-a', 41, 'm41', 1, 'pk-2')")
        conn.execute("INSERT INTO chat_pins (chat_id, message_id, message_content, pinned_by, sender_pub) VALUES ('chat-a', 42, 'm42', 1, 'pk-2')")
        conn.execute("INSERT INTO chat_pins (chat_id, message_id, message_content, pinned_by, sender_pub) VALUES ('chat-b', 43, 'm43', 1, 'pk-2')")
        conn.commit()

    emitted = []

    handle_unpin_message_event(
        {'chat_id': 'chat-a'},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        ensure_chat_pins_multiple_support_func=lambda: None,
        positive_int_func=_positive_int,
        is_valid_chat_id_func=lambda chat_id: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        get_db_connection_func=lambda: _connect(db_path),
        chat_partner_state_func=lambda conn, uid, chat_id: ({'contact_id': 2, 'public_key': 'pk-2'}, {'is_blocked': False}),
        emit_blocked_error_func=lambda message, state: None,
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
    )

    with _connect(db_path) as conn:
        row_chat_a = conn.execute(
            '''
            SELECT COUNT(*) AS cnt
            FROM chat_pins
            WHERE chat_id = 'chat-a'
            '''
        ).fetchone()
        row_chat_b = conn.execute(
            '''
            SELECT COUNT(*) AS cnt
            FROM chat_pins
            WHERE chat_id = 'chat-b'
            '''
        ).fetchone()

    assert int(row_chat_a['cnt']) == 0
    assert int(row_chat_b['cnt']) == 1
    assert any(
        event[0] == 'message_unpinned'
        and event[1] == {'chat_id': 'chat-a'}
        and event[2].get('room') == 'chat-a'
        for event in emitted
    )


def test_handle_pin_message_event_group_member_without_admin_role_is_rejected(tmp_path):
    db_path = tmp_path / 'socket-pin-handler-group-non-admin.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO users (id, public_key) VALUES (2, 'pk-2')")
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, message, created_at)
            VALUES (51, 'chat-group', 2, 'hello', '2026-01-01 00:00:00')
            '''
        )
        conn.commit()

    emitted = []

    handle_pin_message_event(
        {'chat_id': 'chat-group', 'message_id': 51},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        ensure_chat_pins_multiple_support_func=lambda: None,
        positive_int_func=_positive_int,
        is_valid_chat_id_func=lambda chat_id: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        get_db_connection_func=lambda: _connect(db_path),
        chat_partner_state_func=lambda conn, uid, chat_id: ({'contact_id': None, 'public_key': None, 'is_group': True}, {'is_blocked': False}),
        emit_blocked_error_func=lambda message, state: None,
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        utc_now_z_func=lambda: '2026-01-01T10:00:00.000Z',
        get_chat_type_func=lambda conn, chat_id: 'group',
        get_group_member_role_func=lambda conn, uid, chat_id: 'member',
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT COUNT(*) AS cnt
            FROM chat_pins
            WHERE chat_id = 'chat-group'
            '''
        ).fetchone()

    assert int(row['cnt']) == 0
    assert emitted == [('error', {'message': 'Только администраторы группы могут закреплять сообщения.'}, {})]


def test_handle_unpin_message_event_group_member_without_admin_role_is_rejected(tmp_path):
    db_path = tmp_path / 'socket-unpin-handler-group-non-admin.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            "INSERT INTO chat_pins (chat_id, message_id, message_content, pinned_by, sender_pub) VALUES ('chat-group', 61, 'm61', 1, 'pk-2')"
        )
        conn.commit()

    emitted = []

    handle_unpin_message_event(
        {'chat_id': 'chat-group', 'message_id': 61},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        ensure_chat_pins_multiple_support_func=lambda: None,
        positive_int_func=_positive_int,
        is_valid_chat_id_func=lambda chat_id: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        get_db_connection_func=lambda: _connect(db_path),
        chat_partner_state_func=lambda conn, uid, chat_id: ({'contact_id': None, 'public_key': None, 'is_group': True}, {'is_blocked': False}),
        emit_blocked_error_func=lambda message, state: None,
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        get_chat_type_func=lambda conn, chat_id: 'group',
        get_group_member_role_func=lambda conn, uid, chat_id: 'member',
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT COUNT(*) AS cnt
            FROM chat_pins
            WHERE chat_id = 'chat-group' AND message_id = 61
            '''
        ).fetchone()

    assert int(row['cnt']) == 1
    assert emitted == [('error', {'message': 'Только администраторы группы могут откреплять сообщения.'}, {})]
