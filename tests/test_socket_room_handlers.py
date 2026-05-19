from app.sockets.room_handlers import (
    handle_join_event,
    handle_leave_event,
)


def _logger():
    return type(
        'Logger',
        (),
        {
            'info': lambda self, msg, *args: None,
            'warning': lambda self, msg, *args: None,
        },
    )()


def test_handle_join_event_joins_room_when_partner_visible_and_not_blocked():
    joined_rooms = []
    emitted = []

    handle_join_event(
        {'chat_id': 'chat-a'},
        session_store={'user_id': 1},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        is_valid_chat_id_func=lambda chat_id: True,
        socket_rate_ok_func=lambda user_id, event_name=None: True,
        get_db_connection_func=lambda: type('Conn', (), {'close': lambda self: None})(),
        chat_partner_state_func=lambda conn, user_id, chat_id: ({'contact_id': 2, 'public_key': 'pk-2'}, {'is_blocked': False}),
        join_room_func=lambda chat_id: joined_rooms.append(chat_id),
        emit_blocked_error_func=lambda message, state: None,
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        blocked_error_message='blocked',
        unauthorized_error_message='unauthorized',
        logger=_logger(),
    )

    assert joined_rooms == ['chat-a']
    assert emitted == []


def test_handle_join_event_blocked_emits_state_and_blocked_error():
    joined_rooms = []
    emitted = []
    blocked_errors = []

    handle_join_event(
        {'chat_id': 'chat-a'},
        session_store={'user_id': 1},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        is_valid_chat_id_func=lambda chat_id: True,
        socket_rate_ok_func=lambda user_id, event_name=None: True,
        get_db_connection_func=lambda: type('Conn', (), {'close': lambda self: None})(),
        chat_partner_state_func=lambda conn, user_id, chat_id: (
            {'contact_id': 2, 'public_key': 'pk-2'},
            {'is_blocked': True, 'blocked_by_me': True, 'blocked_me': False},
        ),
        join_room_func=lambda chat_id: joined_rooms.append(chat_id),
        emit_blocked_error_func=lambda message, state: blocked_errors.append((message, state)),
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        blocked_error_message='blocked-message',
        unauthorized_error_message='unauthorized',
        logger=_logger(),
    )

    assert joined_rooms == []
    assert any(event[0] == 'chat_block_state' and event[1]['chat_id'] == 'chat-a' for event in emitted)
    assert blocked_errors == [
        ('blocked-message', {'is_blocked': True, 'blocked_by_me': True, 'blocked_me': False})
    ]


def test_handle_join_event_unauthorized_emits_error():
    emitted = []

    handle_join_event(
        {'chat_id': 'chat-a'},
        session_store={'user_id': 1},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        is_valid_chat_id_func=lambda chat_id: True,
        socket_rate_ok_func=lambda user_id, event_name=None: True,
        get_db_connection_func=lambda: type('Conn', (), {'close': lambda self: None})(),
        chat_partner_state_func=lambda conn, user_id, chat_id: (None, None),
        join_room_func=lambda chat_id: None,
        emit_blocked_error_func=lambda message, state: None,
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        blocked_error_message='blocked',
        unauthorized_error_message='not-allowed',
        logger=_logger(),
    )

    assert emitted == [('error', {'message': 'not-allowed'}, {})]


def test_handle_join_event_invalid_chat_id_emits_error():
    emitted = []

    handle_join_event(
        {'chat_id': 'bad-chat'},
        session_store={'user_id': 1},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        is_valid_chat_id_func=lambda chat_id: False,
        socket_rate_ok_func=lambda user_id, event_name=None: True,
        get_db_connection_func=lambda: None,
        chat_partner_state_func=lambda conn, user_id, chat_id: (None, None),
        join_room_func=lambda chat_id: None,
        emit_blocked_error_func=lambda message, state: None,
        emit_func=lambda name, payload, **kwargs: emitted.append((name, payload, kwargs)),
        blocked_error_message='blocked',
        unauthorized_error_message='not-allowed',
        logger=_logger(),
    )

    assert emitted == [('error', {'message': 'Некорректный ID чата.'}, {})]


def test_handle_leave_event_leaves_room_when_chat_id_valid():
    left_rooms = []

    handle_leave_event(
        {'chat_id': 'chat-a'},
        session_store={'user_id': 1},
        require_payload_dict_func=lambda payload: payload,
        socket_csrf_ok_func=lambda payload: True,
        socket_rate_ok_func=lambda user_id, event_name=None: True,
        is_valid_chat_id_func=lambda chat_id: True,
        leave_room_func=lambda chat_id: left_rooms.append(chat_id),
    )

    assert left_rooms == ['chat-a']
