
from app.sockets.typing_handlers import (
    handle_stop_typing_event,
    handle_typing_event,
)
from tests._pg_test_db import connect_test_db


def _connect():
    return connect_test_db(':memory:')


def test_handle_typing_event_emits_partner_typing():
    emitted = []
    conn = _connect()
    conn.execute(
        '''
        INSERT INTO users (id, public_key, username, display_name)
        VALUES (1, 'pk-1', 'alice', 'Alice')
        ON CONFLICT(id) DO UPDATE SET
            public_key = EXCLUDED.public_key,
            username = EXCLUDED.username,
            display_name = EXCLUDED.display_name
        '''
    )
    conn.commit()

    handle_typing_event(
        {'chat_id': 'chat-a'},
        session_store={'user_id': 1},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        socket_signal_interval_ok_func=lambda uid, event_name: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        is_valid_chat_id_func=lambda chat_id: True,
        get_db_connection_func=lambda: conn,
        chat_partner_state_func=lambda conn, uid, chat_id: ({'contact_id': 2, 'public_key': 'pk-2'}, {'is_blocked': False}),
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
    )

    assert emitted == [
        (
            'partner_typing',
            {
                'chat_id': 'chat-a',
                'sender_user_id': 1,
                'sender_display_name': 'Alice',
                'sender_username': 'alice',
            },
            {'room': 'pk-2', 'include_self': False},
        )
    ]
    conn.close()


def test_handle_stop_typing_event_blocked_emits_chat_state_only():
    emitted = []

    handle_stop_typing_event(
        {'chat_id': 'chat-a'},
        session_store={'user_id': 1},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        socket_signal_interval_ok_func=lambda uid, event_name: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        is_valid_chat_id_func=lambda chat_id: True,
        get_db_connection_func=_connect,
        chat_partner_state_func=lambda conn, uid, chat_id: (
            {'contact_id': 2, 'public_key': 'pk-2'},
            {'is_blocked': True, 'blocked_by_me': True, 'blocked_me': False},
        ),
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
    )

    assert any(event[0] == 'chat_block_state' and event[1]['chat_id'] == 'chat-a' for event in emitted)
    assert not any(event[0] == 'partner_stop_typing' for event in emitted)


def test_handle_typing_event_forwards_extended_typing_kind():
    emitted = []
    conn = _connect()
    conn.execute(
        '''
        INSERT INTO users (id, public_key, username, display_name)
        VALUES (1, 'pk-1', 'alice', 'Alice')
        ON CONFLICT(id) DO UPDATE SET
            public_key = EXCLUDED.public_key,
            username = EXCLUDED.username,
            display_name = EXCLUDED.display_name
        '''
    )
    conn.commit()

    handle_typing_event(
        {'chat_id': 'chat-a', 'typing_kind': 'upload_voice'},
        session_store={'user_id': 1},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        socket_signal_interval_ok_func=lambda uid, event_name: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        is_valid_chat_id_func=lambda chat_id: True,
        get_db_connection_func=lambda: conn,
        chat_partner_state_func=lambda conn, uid, chat_id: ({'contact_id': 2, 'public_key': 'pk-2'}, {'is_blocked': False}),
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
    )

    assert emitted[0][1]['typing_kind'] == 'upload_voice'
    conn.close()


def test_handle_typing_event_respects_sender_typing_privacy():
    emitted = []
    conn = _connect()
    conn.execute(
        '''
        INSERT INTO users (id, public_key, username, display_name, typing_privacy)
        VALUES (1, 'pk-1', 'alice', 'Alice', 'nobody')
        ON CONFLICT(id) DO UPDATE SET
            public_key = EXCLUDED.public_key,
            username = EXCLUDED.username,
            display_name = EXCLUDED.display_name,
            typing_privacy = EXCLUDED.typing_privacy
        '''
    )
    conn.commit()

    handle_typing_event(
        {'chat_id': 'chat-a'},
        session_store={'user_id': 1},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        socket_signal_interval_ok_func=lambda uid, event_name: True,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        is_valid_chat_id_func=lambda chat_id: True,
        get_db_connection_func=lambda: conn,
        chat_partner_state_func=lambda conn, uid, chat_id: ({'contact_id': 2, 'public_key': 'pk-2'}, {'is_blocked': False}),
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
    )

    assert emitted == []
    conn.close()


def test_handle_typing_event_uses_kind_specific_interval_bucket():
    observed_event_names = []

    handle_typing_event(
        {'chat_id': 'chat-a', 'typing_kind': 'voice'},
        session_store={'user_id': 1},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        socket_signal_interval_ok_func=lambda uid, event_name: observed_event_names.append(event_name) or False,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        is_valid_chat_id_func=lambda chat_id: True,
        get_db_connection_func=_connect,
        chat_partner_state_func=lambda conn, uid, chat_id: ({'contact_id': 2, 'public_key': 'pk-2'}, {'is_blocked': False}),
        emit_func=lambda *args, **kwargs: None,
    )

    assert observed_event_names == ['typing:voice']


def test_handle_typing_event_skips_when_signal_interval_rejects():
    emitted = []

    handle_typing_event(
        {'chat_id': 'chat-a'},
        session_store={'user_id': 1},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        socket_signal_interval_ok_func=lambda uid, event_name: False,
        socket_rate_ok_func=lambda uid, event_name=None: True,
        is_valid_chat_id_func=lambda chat_id: True,
        get_db_connection_func=_connect,
        chat_partner_state_func=lambda conn, uid, chat_id: ({'contact_id': 2, 'public_key': 'pk-2'}, {'is_blocked': False}),
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
    )

    assert emitted == []
