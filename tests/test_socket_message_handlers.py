from datetime import datetime, timezone
from pathlib import Path

from app.sockets.message_handlers import (
    handle_delete_messages_event,
    handle_edit_message_event,
    handle_send_message_event,
)
from app.db_backend import DatabaseError
from tests._pg_test_db import connect_test_db
from app.sockets.validation import parse_db_utc_timestamp


def _connect(db_path: Path):
    return connect_test_db(db_path)


def _prepare_edit_schema(conn):
    conn.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, public_key TEXT)')
    conn.execute(
        '''
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            chat_id TEXT NOT NULL,
            message TEXT NOT NULL,
            message_type TEXT NOT NULL DEFAULT 'text',
            created_at TEXT NOT NULL,
            edit_count INTEGER DEFAULT 0,
            is_edited INTEGER DEFAULT 0
        )
        '''
    )
    conn.commit()


def _prepare_delete_schema(conn):
    conn.execute(
        '''
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            chat_id TEXT NOT NULL,
            deleted_by_sender INTEGER DEFAULT 0,
            deleted_by_receiver INTEGER DEFAULT 0
        )
        '''
    )
    conn.commit()


def _prepare_send_schema(conn):
    conn.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, public_key TEXT)')
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
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            message TEXT NOT NULL,
            message_type TEXT NOT NULL DEFAULT 'text',
            reply_to_id INTEGER,
            is_delivered INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        '''
    )
    conn.commit()


def _prepare_group_send_schema(conn):
    conn.execute(
        '''
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            public_key TEXT,
            username TEXT,
            display_name TEXT,
            avatar_url TEXT,
            avatar_visibility TEXT
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE chats (
            id INTEGER PRIMARY KEY,
            chat_id TEXT UNIQUE NOT NULL,
            chat_name TEXT NOT NULL DEFAULT 'Group Chat',
            chat_type TEXT NOT NULL DEFAULT 'group'
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE chat_members (
            user_id INTEGER NOT NULL,
            chat_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            PRIMARY KEY (user_id, chat_id)
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
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER,
            message TEXT NOT NULL,
            message_type TEXT NOT NULL DEFAULT 'text',
            reply_to_id INTEGER,
            is_delivered INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE message_receipts (
            message_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            is_delivered INTEGER NOT NULL DEFAULT 0,
            delivered_at TEXT,
            is_read INTEGER NOT NULL DEFAULT 0,
            read_at TEXT,
            voice_listened INTEGER NOT NULL DEFAULT 0,
            deleted_for_user INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT
        )
        '''
    )
    conn.commit()


def test_handle_edit_message_event_updates_message_and_emits(tmp_path):
    db_path = tmp_path / 'socket-message-handler-edit.db'
    with _connect(db_path) as conn:
        _prepare_edit_schema(conn)
        conn.execute("INSERT INTO users (id, public_key) VALUES (2, 'pk-2')")
        conn.execute(
            '''
            INSERT INTO messages (id, sender_id, receiver_id, chat_id, message, created_at, edit_count)
            VALUES (10, 1, 2, 'chat-a', 'old', ?, 0)
            ''',
            (datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),),
        )
        conn.commit()

    emitted = []

    handle_edit_message_event(
        {'msg_id': 10, 'new_content': 'new text', 'chat_id': 'chat-a', 'message_type': 'text'},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        positive_int_func=lambda value: int(value) if str(value).isdigit() else None,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        sanitize_message_type_func=lambda value: 'text',
        is_valid_chat_id_func=lambda chat_id: True,
        get_db_connection_func=lambda: _connect(db_path),
        chat_partner_state_func=lambda conn, uid, chat_id: ({'contact_id': 2, 'public_key': 'pk-2'}, {'is_blocked': False}),
        emit_blocked_error_func=lambda message, state: emitted.append(('blocked_error', message, state)),
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        parse_db_utc_timestamp_func=parse_db_utc_timestamp,
        utc_now_func=lambda: datetime.now(timezone.utc),
        message_edit_window_seconds=48 * 60 * 60,
        max_message_edits=5,
        logger=None,
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            'SELECT message, message_type, is_edited, edit_count FROM messages WHERE id = 10'
        ).fetchone()

    assert row['message'] == 'new text'
    assert row['message_type'] == 'text'
    assert int(row['is_edited']) == 1
    assert int(row['edit_count']) == 1
    assert any(event[0] == 'message_edited' and event[2].get('room') == 'pk-1' for event in emitted)
    assert any(event[0] == 'message_edited' and event[2].get('room') == 'pk-2' for event in emitted)


def test_handle_edit_message_event_rejects_foreign_message_edit(tmp_path):
    db_path = tmp_path / 'socket-message-handler-edit-foreign.db'
    with _connect(db_path) as conn:
        _prepare_edit_schema(conn)
        conn.execute("INSERT INTO users (id, public_key) VALUES (2, 'pk-2')")
        conn.execute(
            '''
            INSERT INTO messages (id, sender_id, receiver_id, chat_id, message, created_at, edit_count)
            VALUES (10, 2, 1, 'chat-a', 'original', ?, 0)
            ''',
            (datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),),
        )
        conn.commit()

    emitted = []

    handle_edit_message_event(
        {'msg_id': 10, 'new_content': 'tampered', 'chat_id': 'chat-a', 'message_type': 'text'},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        positive_int_func=lambda value: int(value) if str(value).isdigit() else None,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        sanitize_message_type_func=lambda value: 'text',
        is_valid_chat_id_func=lambda chat_id: True,
        get_db_connection_func=lambda: _connect(db_path),
        chat_partner_state_func=lambda conn, uid, chat_id: ({'contact_id': 2, 'public_key': 'pk-2'}, {'is_blocked': False}),
        emit_blocked_error_func=lambda message, state: emitted.append(('blocked_error', message, state)),
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        parse_db_utc_timestamp_func=parse_db_utc_timestamp,
        utc_now_func=lambda: datetime.now(timezone.utc),
        message_edit_window_seconds=48 * 60 * 60,
        max_message_edits=5,
        logger=None,
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            'SELECT message, message_type, is_edited, edit_count FROM messages WHERE id = 10'
        ).fetchone()

    assert row['message'] == 'original'
    assert row['message_type'] == 'text'
    assert int(row['is_edited']) == 0
    assert int(row['edit_count']) == 0
    assert any(
        event[0] == 'error' and event[1].get('message') == 'You can only edit your own messages.'
        for event in emitted
    )
    assert not any(event[0] == 'message_edited' for event in emitted)


def test_handle_delete_messages_event_for_me_marks_deleted(tmp_path):
    db_path = tmp_path / 'socket-message-handler-delete-for-me.db'
    with _connect(db_path) as conn:
        _prepare_delete_schema(conn)
        conn.execute(
            '''
            INSERT INTO messages (id, sender_id, receiver_id, chat_id)
            VALUES (11, 1, 2, 'chat-a')
            '''
        )
        conn.commit()

    emitted = []

    handle_delete_messages_event(
        {'msg_ids': [11], 'chat_id': 'chat-a', 'mode': 'for_me'},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        positive_int_func=lambda value: int(value) if str(value).isdigit() else None,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        is_valid_chat_id_func=lambda chat_id: True,
        get_db_connection_func=lambda: _connect(db_path),
        chat_partner_state_func=lambda conn, uid, chat_id: ({'contact_id': 2, 'public_key': 'pk-2'}, {'is_blocked': False}),
        emit_blocked_error_func=lambda message, state: emitted.append(('blocked_error', message, state)),
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        logger=type('Logger', (), {'error': lambda self, msg, *args: None})(),
        database_error_cls=DatabaseError,
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            'SELECT deleted_by_sender, deleted_by_receiver FROM messages WHERE id = 11'
        ).fetchone()

    assert int(row['deleted_by_sender']) == 1
    assert int(row['deleted_by_receiver']) == 0
    assert any(
        event[0] == 'messages_deleted'
        and event[1]['mode'] == 'for_me'
        and event[2].get('room') == 'pk-1'
        for event in emitted
    )


def test_handle_delete_messages_event_for_both_deletes_and_notifies(tmp_path):
    db_path = tmp_path / 'socket-message-handler-delete-for-both.db'
    with _connect(db_path) as conn:
        _prepare_delete_schema(conn)
        conn.execute(
            '''
            INSERT INTO messages (id, sender_id, receiver_id, chat_id)
            VALUES (12, 1, 2, 'chat-a')
            '''
        )
        conn.commit()

    emitted = []

    handle_delete_messages_event(
        {'msg_ids': [12], 'chat_id': 'chat-a', 'mode': 'for_both'},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        positive_int_func=lambda value: int(value) if str(value).isdigit() else None,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        is_valid_chat_id_func=lambda chat_id: True,
        get_db_connection_func=lambda: _connect(db_path),
        chat_partner_state_func=lambda conn, uid, chat_id: ({'contact_id': 2, 'public_key': 'pk-2'}, {'is_blocked': False}),
        emit_blocked_error_func=lambda message, state: emitted.append(('blocked_error', message, state)),
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        logger=type('Logger', (), {'error': lambda self, msg, *args: None})(),
        database_error_cls=DatabaseError,
    )

    with _connect(db_path) as conn:
        row = conn.execute('SELECT 1 FROM messages WHERE id = 12').fetchone()

    assert row is None
    assert any(event[0] == 'messages_deleted' and event[2].get('room') == 'chat-a' for event in emitted)
    assert any(event[0] == 'messages_deleted' and event[2].get('room') == 'pk-1' for event in emitted)
    assert any(event[0] == 'messages_deleted' and event[2].get('room') == 'pk-2' for event in emitted)


def test_handle_send_message_event_success_inserts_and_emits(tmp_path):
    db_path = tmp_path / 'socket-message-handler-send-ok.db'
    with _connect(db_path) as conn:
        _prepare_send_schema(conn)
        conn.execute("INSERT INTO users (id, public_key) VALUES (1, 'pk-1'), (2, 'pk-2')")
        conn.execute("INSERT INTO contacts (user_id, contact_id, chat_id) VALUES (1, 2, 'chat-a'), (2, 1, 'chat-a')")
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, receiver_id, message, message_type, is_delivered)
            VALUES (100, 'chat-a', 2, 1, '{"encrypted_message":"seed"}', 'text', 0)
            '''
        )
        conn.commit()

    emitted = []
    blocked_errors = []

    handle_send_message_event(
        {
            'chat_id': 'chat-a',
            'message': 'hello',
            'message_type': 'text',
            'reply_to_id': 100,
            'client_id': 'client-1',
        },
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        is_valid_chat_id_func=lambda chat_id: True,
        get_db_connection_func=lambda: _connect(db_path),
        count_connected_func=lambda pub: 1 if pub == 'pk-2' else 0,
        build_block_state_func=lambda conn, sender_id, receiver_id: {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
        normalize_block_state_func=lambda state: state,
        sanitize_message_type_func=lambda value: 'text',
        positive_int_func=lambda value: int(value) if str(value).isdigit() else None,
        ensure_chat_exists_func=lambda conn, chat_id: None,
        looks_like_ciphertext_func=lambda raw: isinstance(raw, str) and 'encrypted_message' in raw,
        emit_blocked_error_func=lambda message, state: blocked_errors.append((message, state)),
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        utc_now_text_func=lambda: '2025-01-01 00:00:00',
        logger=type('Logger', (), {'warning': lambda self, msg, *args: None, 'error': lambda self, msg, *args: None})(),
        database_error_cls=DatabaseError,
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT sender_id, receiver_id, message, message_type, reply_to_id, is_delivered
            FROM messages
            WHERE chat_id = 'chat-a' AND sender_id = 1
            ORDER BY id DESC
            LIMIT 1
            '''
        ).fetchone()

    assert blocked_errors == []
    assert row['sender_id'] == 1
    assert row['receiver_id'] == 2
    assert row['message'] == 'hello'
    assert row['message_type'] == 'text'
    assert int(row['reply_to_id']) == 100
    assert int(row['is_delivered']) == 1
    assert any(event[0] == 'receive_message' and event[2].get('room') == 'pk-2' for event in emitted)
    assert any(event[0] == 'receive_message' and event[2].get('room') == 'pk-1' for event in emitted)
    assert any(event[0] == 'message_sent' and event[2].get('room') == 'pk-1' for event in emitted)


def test_handle_send_message_event_blocked_emits_state_and_error(tmp_path):
    db_path = tmp_path / 'socket-message-handler-send-blocked.db'
    with _connect(db_path) as conn:
        _prepare_send_schema(conn)
        conn.execute("INSERT INTO users (id, public_key) VALUES (1, 'pk-1'), (2, 'pk-2')")
        conn.execute("INSERT INTO contacts (user_id, contact_id, chat_id) VALUES (1, 2, 'chat-a')")
        conn.commit()

    emitted = []
    blocked_errors = []

    handle_send_message_event(
        {'chat_id': 'chat-a', 'message': 'blocked'},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        is_valid_chat_id_func=lambda chat_id: True,
        get_db_connection_func=lambda: _connect(db_path),
        count_connected_func=lambda pub: 0,
        build_block_state_func=lambda conn, sender_id, receiver_id: {'is_blocked': True, 'blocked_by_me': True, 'blocked_me': False},
        normalize_block_state_func=lambda state: state,
        sanitize_message_type_func=lambda value: 'text',
        positive_int_func=lambda value: int(value) if str(value).isdigit() else None,
        ensure_chat_exists_func=lambda conn, chat_id: None,
        looks_like_ciphertext_func=lambda raw: True,
        emit_blocked_error_func=lambda message, state: blocked_errors.append((message, state)),
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        utc_now_text_func=lambda: '2025-01-01 00:00:00',
        logger=type('Logger', (), {'warning': lambda self, msg, *args: None, 'error': lambda self, msg, *args: None})(),
        database_error_cls=DatabaseError,
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT COUNT(*) AS cnt
            FROM messages
            WHERE chat_id = 'chat-a' AND sender_id = 1
            '''
        ).fetchone()

    assert row['cnt'] == 0
    assert any(event[0] == 'chat_block_state' and event[1]['chat_id'] == 'chat-a' for event in emitted)
    assert blocked_errors and blocked_errors[0][0] == 'Messaging is unavailable because the user is blocked.'


def test_handle_send_message_event_triggers_web_push_when_receiver_offline(tmp_path):
    db_path = tmp_path / 'socket-message-handler-send-web-push.db'
    with _connect(db_path) as conn:
        _prepare_send_schema(conn)
        conn.execute("INSERT INTO users (id, public_key) VALUES (1, 'pk-1'), (2, 'pk-2')")
        conn.execute("INSERT INTO contacts (user_id, contact_id, chat_id) VALUES (1, 2, 'chat-a'), (2, 1, 'chat-a')")
        conn.commit()

    push_calls = []

    handle_send_message_event(
        {'chat_id': 'chat-a', 'message': 'hello'},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        is_valid_chat_id_func=lambda chat_id: True,
        get_db_connection_func=lambda: _connect(db_path),
        count_connected_func=lambda pub: 0,
        build_block_state_func=lambda conn, sender_id, receiver_id: {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
        normalize_block_state_func=lambda state: state,
        sanitize_message_type_func=lambda value: 'text',
        positive_int_func=lambda value: int(value) if str(value).isdigit() else None,
        ensure_chat_exists_func=lambda conn, chat_id: None,
        looks_like_ciphertext_func=lambda raw: True,
        emit_blocked_error_func=lambda message, state: None,
        emit_func=lambda name, payload, **kwargs: None,
        utc_now_text_func=lambda: '2025-01-01 00:00:00',
        logger=type('Logger', (), {'warning': lambda self, msg, *args: None, 'error': lambda self, msg, *args: None})(),
        database_error_cls=DatabaseError,
        send_web_push_notification_func=lambda **kwargs: push_calls.append(kwargs),
    )

    assert push_calls == [
        {
            'receiver_user_id': 2,
            'sender_user_id': 1,
            'sender_display_name': '',
            'sender_username': '',
            'chat_id': 'chat-a',
        }
    ]


def test_handle_send_message_event_blocks_when_user_restricted(tmp_path):
    db_path = tmp_path / 'socket-message-handler-send-restricted.db'
    with _connect(db_path) as conn:
        _prepare_send_schema(conn)
        conn.execute("INSERT INTO users (id, public_key) VALUES (1, 'pk-1'), (2, 'pk-2')")
        conn.execute("INSERT INTO contacts (user_id, contact_id, chat_id) VALUES (1, 2, 'chat-a'), (2, 1, 'chat-a')")
        conn.commit()

    emitted = []

    handle_send_message_event(
        {'chat_id': 'chat-a', 'message': 'hello'},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        is_valid_chat_id_func=lambda chat_id: True,
        get_db_connection_func=lambda: _connect(db_path),
        count_connected_func=lambda pub: 0,
        build_block_state_func=lambda conn, sender_id, receiver_id: {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
        normalize_block_state_func=lambda state: state,
        sanitize_message_type_func=lambda value: 'text',
        positive_int_func=lambda value: int(value) if str(value).isdigit() else None,
        ensure_chat_exists_func=lambda conn, chat_id: None,
        looks_like_ciphertext_func=lambda raw: True,
        emit_blocked_error_func=lambda message, state: None,
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        utc_now_text_func=lambda: '2025-01-01 00:00:00',
        logger=type('Logger', (), {'warning': lambda self, msg, *args: None, 'error': lambda self, msg, *args: None})(),
        database_error_cls=DatabaseError,
        moderation_user_restriction_func=lambda conn, user_id: {'action_type': 'mute_temp', 'sanction_id': 10},
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT COUNT(*) AS cnt
            FROM messages
            WHERE chat_id = 'chat-a' AND sender_id = 1
            '''
        ).fetchone()
    assert row['cnt'] == 0
    assert any(
        event[0] == 'error'
        and event[1].get('code') == 'moderation_restriction'
        for event in emitted
    )


def test_handle_send_message_event_blocks_public_link_pre_moderation(tmp_path):
    db_path = tmp_path / 'socket-message-handler-send-link-premod.db'
    with _connect(db_path) as conn:
        _prepare_send_schema(conn)
        conn.execute("INSERT INTO users (id, public_key) VALUES (1, 'pk-1'), (2, 'pk-2')")
        conn.execute("INSERT INTO contacts (user_id, contact_id, chat_id) VALUES (1, 2, 'chat-a'), (2, 1, 'chat-a')")
        conn.commit()

    emitted = []

    handle_send_message_event(
        {'chat_id': 'chat-a', 'message': 'visit https://bad.example/phish'},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        is_valid_chat_id_func=lambda chat_id: True,
        get_db_connection_func=lambda: _connect(db_path),
        count_connected_func=lambda pub: 0,
        build_block_state_func=lambda conn, sender_id, receiver_id: {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
        normalize_block_state_func=lambda state: state,
        sanitize_message_type_func=lambda value: 'text',
        positive_int_func=lambda value: int(value) if str(value).isdigit() else None,
        ensure_chat_exists_func=lambda conn, chat_id: None,
        looks_like_ciphertext_func=lambda raw: True,
        emit_blocked_error_func=lambda message, state: None,
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        utc_now_text_func=lambda: '2025-01-01 00:00:00',
        logger=type('Logger', (), {'warning': lambda self, msg, *args: None, 'error': lambda self, msg, *args: None})(),
        database_error_cls=DatabaseError,
        moderation_user_restriction_func=lambda conn, user_id: None,
        moderation_public_link_check_func=lambda message: {'blocked': True, 'reason': 'blocked_public_link_domain', 'domain': 'bad.example'},
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT COUNT(*) AS cnt
            FROM messages
            WHERE chat_id = 'chat-a' AND sender_id = 1
            '''
        ).fetchone()
    assert row['cnt'] == 0
    assert any(
        event[0] == 'error'
        and event[1].get('code') == 'blocked_public_link'
        for event in emitted
    )


def test_handle_send_message_event_group_mute_restriction_blocks_delivery(tmp_path):
    db_path = tmp_path / 'socket-message-handler-send-group-muted.db'
    with _connect(db_path) as conn:
        _prepare_group_send_schema(conn)
        conn.execute("INSERT INTO users (id, public_key, username, display_name) VALUES (1, 'pk-1', 'owner', 'Owner'), (2, 'pk-2', 'member', 'Member')")
        conn.execute("INSERT INTO chats (chat_id, chat_type) VALUES ('group-a', 'group')")
        conn.execute("INSERT INTO chat_members (user_id, chat_id, role) VALUES (1, 'group-a', 'owner'), (2, 'group-a', 'member')")
        conn.commit()

    emitted = []

    handle_send_message_event(
        {'chat_id': 'group-a', 'message': 'hello group'},
        session_store={'user_id': 2, 'public_key_pem': 'pk-2'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        is_valid_chat_id_func=lambda chat_id: True,
        get_db_connection_func=lambda: _connect(db_path),
        count_connected_func=lambda pub: 0,
        build_block_state_func=lambda conn, sender_id, receiver_id: {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
        normalize_block_state_func=lambda state: state,
        sanitize_message_type_func=lambda value: 'text',
        positive_int_func=lambda value: int(value) if str(value).isdigit() else None,
        ensure_chat_exists_func=lambda conn, chat_id: None,
        looks_like_ciphertext_func=lambda raw: True,
        emit_blocked_error_func=lambda message, state: None,
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        utc_now_text_func=lambda: '2025-01-01 00:00:00',
        logger=type('Logger', (), {'warning': lambda self, msg, *args: None, 'error': lambda self, msg, *args: None})(),
        database_error_cls=DatabaseError,
        group_restriction_lookup_func=lambda conn, chat_id, user_id: {
            'action_type': 'mute_temp',
            'sanction_id': 77,
            'expires_at': '2026-01-01 00:00:00',
        },
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT COUNT(*) AS cnt
            FROM messages
            WHERE chat_id = 'group-a' AND sender_id = 2
            '''
        ).fetchone()

    assert int(row['cnt']) == 0
    assert any(
        event[0] == 'error' and event[1].get('code') == 'group_moderation_restriction'
        for event in emitted
    )


def test_handle_send_message_event_group_permissions_block_member_messages(tmp_path):
    db_path = tmp_path / 'socket-message-handler-send-group-perm-messages.db'
    with _connect(db_path) as conn:
        _prepare_group_send_schema(conn)
        conn.execute("ALTER TABLE chats ADD COLUMN group_perm_send_messages INTEGER NOT NULL DEFAULT 1")
        conn.execute("INSERT INTO users (id, public_key, username, display_name) VALUES (1, 'pk-1', 'owner', 'Owner'), (2, 'pk-2', 'member', 'Member')")
        conn.execute(
            '''
            INSERT INTO chats (chat_id, chat_name, chat_type, group_perm_send_messages)
            VALUES ('group-a', 'Perm Group', 'group', 0)
            '''
        )
        conn.execute("INSERT INTO chat_members (user_id, chat_id, role) VALUES (1, 'group-a', 'owner'), (2, 'group-a', 'member')")
        conn.commit()

    emitted = []

    handle_send_message_event(
        {'chat_id': 'group-a', 'message': 'hello group'},
        session_store={'user_id': 2, 'public_key_pem': 'pk-2'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        is_valid_chat_id_func=lambda chat_id: True,
        get_db_connection_func=lambda: _connect(db_path),
        count_connected_func=lambda pub: 0,
        build_block_state_func=lambda conn, sender_id, receiver_id: {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
        normalize_block_state_func=lambda state: state,
        sanitize_message_type_func=lambda value: 'text',
        positive_int_func=lambda value: int(value) if str(value).isdigit() else None,
        ensure_chat_exists_func=lambda conn, chat_id: None,
        looks_like_ciphertext_func=lambda raw: True,
        emit_blocked_error_func=lambda message, state: None,
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        utc_now_text_func=lambda: '2025-01-01 00:00:00',
        logger=type('Logger', (), {'warning': lambda self, msg, *args: None, 'error': lambda self, msg, *args: None})(),
        database_error_cls=DatabaseError,
        group_restriction_lookup_func=lambda conn, chat_id, user_id: None,
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT COUNT(*) AS cnt
            FROM messages
            WHERE chat_id = 'group-a' AND sender_id = 2
            '''
        ).fetchone()

    assert int(row['cnt']) == 0
    assert any(
        event[0] == 'error' and event[1].get('code') == 'group_permissions_messages_disabled'
        for event in emitted
    )


def test_handle_send_message_event_group_permissions_slow_mode_blocks_flood(tmp_path):
    db_path = tmp_path / 'socket-message-handler-send-group-slow-mode.db'
    with _connect(db_path) as conn:
        _prepare_group_send_schema(conn)
        conn.execute("ALTER TABLE chats ADD COLUMN group_slow_mode_seconds INTEGER NOT NULL DEFAULT 0")
        conn.execute("INSERT INTO users (id, public_key, username, display_name) VALUES (1, 'pk-1', 'owner', 'Owner'), (2, 'pk-2', 'member', 'Member')")
        conn.execute(
            '''
            INSERT INTO chats (chat_id, chat_name, chat_type, group_slow_mode_seconds)
            VALUES ('group-a', 'Slow Group', 'group', 60)
            '''
        )
        conn.execute("INSERT INTO chat_members (user_id, chat_id, role) VALUES (1, 'group-a', 'owner'), (2, 'group-a', 'member')")
        conn.execute(
            '''
            INSERT INTO messages (chat_id, sender_id, receiver_id, message, message_type, created_at)
            VALUES ('group-a', 2, NULL, 'first', 'text', '2025-01-01 00:00:00')
            '''
        )
        conn.commit()

    emitted = []

    handle_send_message_event(
        {'chat_id': 'group-a', 'message': 'second message'},
        session_store={'user_id': 2, 'public_key_pem': 'pk-2'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        is_valid_chat_id_func=lambda chat_id: True,
        get_db_connection_func=lambda: _connect(db_path),
        count_connected_func=lambda pub: 0,
        build_block_state_func=lambda conn, sender_id, receiver_id: {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
        normalize_block_state_func=lambda state: state,
        sanitize_message_type_func=lambda value: 'text',
        positive_int_func=lambda value: int(value) if str(value).isdigit() else None,
        ensure_chat_exists_func=lambda conn, chat_id: None,
        looks_like_ciphertext_func=lambda raw: True,
        emit_blocked_error_func=lambda message, state: None,
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        utc_now_text_func=lambda: '2025-01-01 00:00:10',
        logger=type('Logger', (), {'warning': lambda self, msg, *args: None, 'error': lambda self, msg, *args: None})(),
        database_error_cls=DatabaseError,
        group_restriction_lookup_func=lambda conn, chat_id, user_id: None,
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT COUNT(*) AS cnt
            FROM messages
            WHERE chat_id = 'group-a' AND sender_id = 2
            '''
        ).fetchone()

    assert int(row['cnt']) == 1
    assert any(
        event[0] == 'error'
        and event[1].get('code') == 'group_permissions_slow_mode'
        and int(event[1].get('retry_after_seconds') or 0) > 0
        for event in emitted
    )


def test_handle_send_message_event_group_mentions_emit_and_push(tmp_path):
    db_path = tmp_path / 'socket-message-handler-send-group-mentions.db'
    with _connect(db_path) as conn:
        _prepare_group_send_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES
                (1, 'pk-1', 'alice', 'Alice'),
                (2, 'pk-2', 'member', 'Member'),
                (3, 'pk-3', 'other', 'Other')
            '''
        )
        conn.execute("INSERT INTO chats (chat_id, chat_name, chat_type) VALUES ('group-a', 'Team Core', 'group')")
        conn.execute(
            '''
            INSERT INTO chat_members (user_id, chat_id, role)
            VALUES
                (1, 'group-a', 'owner'),
                (2, 'group-a', 'member'),
                (3, 'group-a', 'member')
            '''
        )
        conn.commit()

    emitted = []
    push_calls = []

    handle_send_message_event(
        {'chat_id': 'group-a', 'message': 'hello @member and @ghost'},
        session_store={'user_id': 1, 'public_key_pem': 'pk-1'},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        is_valid_chat_id_func=lambda chat_id: True,
        get_db_connection_func=lambda: _connect(db_path),
        count_connected_func=lambda pub: 0 if pub == 'pk-2' else 1,
        build_block_state_func=lambda conn, sender_id, receiver_id: {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
        normalize_block_state_func=lambda state: state,
        sanitize_message_type_func=lambda value: 'text',
        positive_int_func=lambda value: int(value) if str(value).isdigit() else None,
        ensure_chat_exists_func=lambda conn, chat_id: None,
        looks_like_ciphertext_func=lambda raw: True,
        emit_blocked_error_func=lambda message, state: None,
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        utc_now_text_func=lambda: '2025-01-01 00:00:00',
        logger=type('Logger', (), {'warning': lambda self, msg, *args: None, 'error': lambda self, msg, *args: None})(),
        database_error_cls=DatabaseError,
        send_web_push_notification_func=lambda **kwargs: push_calls.append(kwargs),
    )

    group_receive_event = next(
        (event for event in emitted if event[0] == 'receive_message' and event[2].get('room') == 'group-a'),
        None,
    )
    assert group_receive_event is not None
    payload = group_receive_event[1]
    assert payload['mentioned_user_ids'] == [2]
    assert payload['mentioned_usernames'] == ['member']
    assert payload['group_read_count'] == 0
    assert payload['group_readers'] == []
    assert push_calls == [
        {
            'receiver_user_id': 2,
            'sender_user_id': 1,
            'sender_display_name': 'Alice',
            'sender_username': 'alice',
            'chat_id': 'group-a',
            'message_type': 'text',
            'notification_type': 'mention',
            'chat_display_name': 'Team Core',
        }
    ]
