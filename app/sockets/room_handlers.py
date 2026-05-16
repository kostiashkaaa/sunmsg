def handle_join_event(  # noqa: PLR0913 - dependency-injected socket handler contract
    data,
    *,
    session_store,
    require_payload_dict_func,
    socket_csrf_ok_func,
    is_valid_chat_id_func,
    socket_rate_ok_func,
    get_db_connection_func,
    chat_partner_state_func,
    join_room_func,
    emit_blocked_error_func,
    emit_func,
    blocked_error_message: str,
    unauthorized_error_message: str,
    logger,
):
    data = require_payload_dict_func(data)
    if data is None:
        return
    if not socket_csrf_ok_func(data):
        return
    chat_id = data.get('chat_id')
    if not chat_id:
        return
    if not is_valid_chat_id_func(chat_id):
        emit_func('error', {'message': 'Invalid chat ID.'})
        return

    user_id = session_store.get('user_id')
    if not user_id:
        emit_func('error', {'message': unauthorized_error_message})
        return
    if not socket_rate_ok_func(user_id, 'join'):
        emit_func('error', {'message': 'Too many messages. Please wait a little.'})
        return
    conn = get_db_connection_func()
    try:
        partner, block_state = chat_partner_state_func(conn, user_id, chat_id)
    finally:
        conn.close()

    if partner and block_state and not block_state['is_blocked']:
        join_room_func(chat_id)
        logger.info('User %s joined secured room: %s', user_id, chat_id)
    elif partner and block_state and block_state['is_blocked']:
        emit_func(
            'chat_block_state',
            {
                'chat_id': chat_id,
                'partner_user_id': partner['contact_id'],
                **block_state,
            },
        )
        emit_blocked_error_func(blocked_error_message, block_state)
    else:
        logger.warning('User %s attempted to join UNAUTHORIZED room: %s', user_id, chat_id)
        emit_func('error', {'message': unauthorized_error_message})


def handle_leave_event(  # noqa: PLR0913 - dependency-injected socket handler contract
    data,
    *,
    session_store,
    require_payload_dict_func,
    socket_csrf_ok_func,
    socket_rate_ok_func,
    is_valid_chat_id_func,
    leave_room_func,
):
    data = require_payload_dict_func(data)
    if data is None:
        return
    if not socket_csrf_ok_func(data):
        return
    chat_id = data.get('chat_id')
    user_id = session_store.get('user_id')
    if user_id:
        socket_rate_ok_func(user_id, 'leave')
    if chat_id and is_valid_chat_id_func(chat_id):
        leave_room_func(chat_id)
