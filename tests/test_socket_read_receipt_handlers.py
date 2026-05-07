from pathlib import Path

from app.sockets.read_receipt_handlers import (
    handle_messages_seen_event,
    handle_voice_message_listened_event,
)
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
            is_read INTEGER NOT NULL DEFAULT 0,
            is_delivered INTEGER NOT NULL DEFAULT 0,
            voice_listened_by_receiver INTEGER NOT NULL DEFAULT 0
        )
        '''
    )
    conn.commit()


def test_handle_messages_seen_event_marks_read_and_notifies(tmp_path):
    db_path = tmp_path / 'socket-read-receipt-seen-ok.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, receiver_id, is_read, is_delivered)
            VALUES (1, 'chat-a', 2, 1, 0, 0)
            '''
        )
        conn.commit()

    emitted = []

    handle_messages_seen_event(
        {'chat_id': 'chat-a'},
        session_store={'user_id': 1},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        is_valid_chat_id_func=lambda chat_id: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        get_db_connection_func=lambda: _connect(db_path),
        chat_partner_state_func=lambda conn, uid, chat_id: ({'contact_id': 2, 'public_key': 'pk-2'}, {'is_blocked': False}),
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            'SELECT is_read, is_delivered FROM messages WHERE id = 1'
        ).fetchone()

    assert int(row['is_read']) == 1
    assert int(row['is_delivered']) == 1
    assert any(event[0] == 'messages_read' and event[2].get('room') == 'pk-2' for event in emitted)


def test_handle_messages_seen_event_blocked_emits_state_and_skips_update(tmp_path):
    db_path = tmp_path / 'socket-read-receipt-seen-blocked.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, receiver_id, is_read, is_delivered)
            VALUES (2, 'chat-a', 2, 1, 0, 0)
            '''
        )
        conn.commit()

    emitted = []

    handle_messages_seen_event(
        {'chat_id': 'chat-a'},
        session_store={'user_id': 1},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        is_valid_chat_id_func=lambda chat_id: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        get_db_connection_func=lambda: _connect(db_path),
        chat_partner_state_func=lambda conn, uid, chat_id: (
            {'contact_id': 2, 'public_key': 'pk-2'},
            {'is_blocked': True, 'blocked_by_me': True, 'blocked_me': False},
        ),
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            'SELECT is_read, is_delivered FROM messages WHERE id = 2'
        ).fetchone()

    assert int(row['is_read']) == 0
    assert int(row['is_delivered']) == 0
    assert any(event[0] == 'chat_block_state' and event[1]['chat_id'] == 'chat-a' for event in emitted)
    assert not any(event[0] == 'messages_read' for event in emitted)


def test_handle_voice_message_listened_event_updates_and_notifies(tmp_path):
    db_path = tmp_path / 'socket-read-receipt-voice-ok.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, receiver_id, voice_listened_by_receiver)
            VALUES (5, 'chat-a', 2, 1, 0)
            '''
        )
        conn.commit()

    emitted = []

    handle_voice_message_listened_event(
        {'chat_id': 'chat-a', 'msg_id': 5},
        session_store={'user_id': 1},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        positive_int_func=lambda value: int(value) if str(value).isdigit() else None,
        is_valid_chat_id_func=lambda chat_id: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        get_db_connection_func=lambda: _connect(db_path),
        chat_partner_state_func=lambda conn, uid, chat_id: ({'contact_id': 2, 'public_key': 'pk-2'}, {'is_blocked': False}),
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            'SELECT voice_listened_by_receiver FROM messages WHERE id = 5'
        ).fetchone()

    assert int(row['voice_listened_by_receiver']) == 1
    assert any(
        event[0] == 'voice_message_listened'
        and event[1]['msg_id'] == 5
        and event[2].get('room') == 'pk-2'
        for event in emitted
    )


def test_handle_voice_message_listened_event_blocked_emits_state(tmp_path):
    db_path = tmp_path / 'socket-read-receipt-voice-blocked.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, receiver_id, voice_listened_by_receiver)
            VALUES (6, 'chat-a', 2, 1, 0)
            '''
        )
        conn.commit()

    emitted = []

    handle_voice_message_listened_event(
        {'chat_id': 'chat-a', 'message_id': 6},
        session_store={'user_id': 1},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        positive_int_func=lambda value: int(value) if str(value).isdigit() else None,
        is_valid_chat_id_func=lambda chat_id: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        get_db_connection_func=lambda: _connect(db_path),
        chat_partner_state_func=lambda conn, uid, chat_id: (
            {'contact_id': 2, 'public_key': 'pk-2'},
            {'is_blocked': True, 'blocked_by_me': False, 'blocked_me': True},
        ),
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
    )

    with _connect(db_path) as conn:
        row = conn.execute(
            'SELECT voice_listened_by_receiver FROM messages WHERE id = 6'
        ).fetchone()

    assert int(row['voice_listened_by_receiver']) == 0
    assert any(event[0] == 'chat_block_state' and event[1]['chat_id'] == 'chat-a' for event in emitted)
    assert not any(event[0] == 'voice_message_listened' for event in emitted)
