def handle_favorite_message_event(
    data,
    *,
    session_store,
    require_payload_dict_func,
    socket_csrf_ok_func,
    positive_int_func,
    is_valid_chat_id_func,
    socket_rate_ok_func,
    get_db_connection_func,
    chat_partner_state_func,
    emit_blocked_error_func,
    emit_func,
    utc_now_z_func,
):
    data = require_payload_dict_func(data)
    if data is None:
        return
    if not socket_csrf_ok_func(data):
        return

    chat_id = (data.get('chat_id') or '').strip()
    message_id = positive_int_func(data.get('message_id'))
    if not chat_id or message_id is None:
        return
    if not is_valid_chat_id_func(chat_id):
        emit_func('error', {'message': 'Invalid chat ID.'})
        return

    uid = session_store['user_id']
    sender_pub = session_store.get('public_key_pem')
    if not socket_rate_ok_func(uid, 'favorite_message'):
        emit_func('error', {'message': 'Too many messages. Please wait a little.'})
        return

    conn = get_db_connection_func()
    partner, block_state = chat_partner_state_func(conn, uid, chat_id)
    if not partner:
        conn.close()
        return
    if block_state and block_state['is_blocked']:
        conn.close()
        emit_func('chat_block_state', {'chat_id': chat_id, 'partner_user_id': partner['contact_id'], **block_state})
        emit_blocked_error_func('Favorites are unavailable because the user is blocked.', block_state)
        return

    msg = conn.execute(
        '''
        SELECT m.message, m.created_at, u.public_key AS sender_pub
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ? AND m.chat_id = ?
        ''',
        (message_id, chat_id),
    ).fetchone()
    if not msg:
        conn.close()
        return

    conn.execute(
        '''
        INSERT INTO favorite_messages (user_id, chat_id, message_id, message_content, sender_pub)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, message_id) DO UPDATE SET
            chat_id = excluded.chat_id,
            message_content = excluded.message_content,
            sender_pub = excluded.sender_pub,
            favorited_at = CURRENT_TIMESTAMP
        ''',
        (uid, chat_id, message_id, msg['message'], msg['sender_pub']),
    )
    conn.commit()
    conn.close()

    payload = {
        'chat_id': chat_id,
        'message_id': message_id,
        'message_content': msg['message'],
        'sender_pub': msg['sender_pub'],
        'favorited_at': utc_now_z_func(),
        'created_at': msg['created_at'],
    }
    if sender_pub:
        emit_func('message_favorited', payload, room=sender_pub)


def handle_unfavorite_message_event(
    data,
    *,
    session_store,
    require_payload_dict_func,
    socket_csrf_ok_func,
    positive_int_func,
    is_valid_chat_id_func,
    socket_rate_ok_func,
    get_db_connection_func,
    chat_partner_state_func,
    emit_blocked_error_func,
    emit_func,
):
    data = require_payload_dict_func(data)
    if data is None:
        return
    if not socket_csrf_ok_func(data):
        return

    chat_id = (data.get('chat_id') or '').strip()
    message_id = positive_int_func(data.get('message_id'))
    if not chat_id or message_id is None:
        return
    if not is_valid_chat_id_func(chat_id):
        emit_func('error', {'message': 'Invalid chat ID.'})
        return

    uid = session_store['user_id']
    sender_pub = session_store.get('public_key_pem')
    if not socket_rate_ok_func(uid, 'unfavorite_message'):
        emit_func('error', {'message': 'Too many messages. Please wait a little.'})
        return

    conn = get_db_connection_func()
    partner, block_state = chat_partner_state_func(conn, uid, chat_id)
    if not partner:
        conn.close()
        return
    if block_state and block_state['is_blocked']:
        conn.close()
        emit_func('chat_block_state', {'chat_id': chat_id, 'partner_user_id': partner['contact_id'], **block_state})
        emit_blocked_error_func('Favorites are unavailable because the user is blocked.', block_state)
        return

    conn.execute(
        '''
        DELETE FROM favorite_messages
        WHERE user_id = ? AND chat_id = ? AND message_id = ?
        ''',
        (uid, chat_id, message_id),
    )
    conn.commit()
    conn.close()

    if sender_pub:
        emit_func('message_unfavorited', {'chat_id': chat_id, 'message_id': message_id}, room=sender_pub)
