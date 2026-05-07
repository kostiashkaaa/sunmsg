def handle_pin_message_event(
    data,
    *,
    session_store,
    require_payload_dict_func,
    socket_csrf_ok_func,
    ensure_chat_pins_multiple_support_func,
    positive_int_func,
    is_valid_chat_id_func,
    socket_rate_ok_func,
    get_db_connection_func,
    chat_partner_state_func,
    emit_blocked_error_func,
    emit_func,
    utc_now_z_func,
    get_chat_type_func=None,
    get_group_member_role_func=None,
    authorize_group_action_func=None,
):
    data = require_payload_dict_func(data)
    if data is None:
        return
    if not socket_csrf_ok_func(data):
        return

    ensure_chat_pins_multiple_support_func()

    chat_id = (data.get('chat_id') or '').strip()
    message_id = positive_int_func(data.get('message_id'))
    if not chat_id or message_id is None:
        return
    if not is_valid_chat_id_func(chat_id):
        emit_func('error', {'message': 'Invalid chat ID.'})
        return

    uid = session_store['user_id']
    sender_pub = session_store.get('public_key_pem')
    if not socket_rate_ok_func(uid, 'pin_message'):
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
        emit_blocked_error_func('Pinning is unavailable because the user is blocked.', block_state)
        return

    chat_type = ''
    if callable(get_chat_type_func):
        try:
            chat_type = str(get_chat_type_func(conn, chat_id) or '').strip().lower()
        except Exception:  # noqa: BLE001
            chat_type = ''
    if not chat_type:
        chat_type = str(partner.get('chat_type') or '').strip().lower() if isinstance(partner, dict) else ''
        if not chat_type and isinstance(partner, dict) and bool(partner.get('is_group')):
            chat_type = 'group'

    if chat_type == 'group':
        if callable(authorize_group_action_func):
            allowed, denied_message = authorize_group_action_func(conn, uid, chat_id, 'pin')
            if not allowed:
                conn.close()
                emit_func('error', {'message': denied_message or 'Insufficient role for pinning.'})
                return
        else:
            role = None
            if callable(get_group_member_role_func):
                role = get_group_member_role_func(conn, uid, chat_id)
            if role is None:
                try:
                    role_row = conn.execute(
                        '''
                        SELECT role
                        FROM chat_members
                        WHERE user_id = ? AND chat_id = ?
                        ''',
                        (uid, chat_id),
                    ).fetchone()
                    role = str(role_row['role'] or '').strip().lower() if role_row else ''
                except Exception:  # noqa: BLE001
                    role = None
            if str(role or '').strip().lower() != 'admin':
                conn.close()
                emit_func('error', {'message': 'Only group admins can pin messages.'})
                return

    msg = conn.execute(
        'SELECT m.message, m.created_at, u.public_key as sender_pub FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ? AND m.chat_id = ?',
        (message_id, chat_id),
    ).fetchone()
    if not msg:
        conn.close()
        return

    conn.execute(
        '''
        INSERT INTO chat_pins (chat_id, message_id, message_content, pinned_by, sender_pub)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(chat_id, message_id) DO UPDATE SET
            message_content = excluded.message_content,
            pinned_by = excluded.pinned_by,
            sender_pub = excluded.sender_pub,
            pinned_at = CURRENT_TIMESTAMP
        ''',
        (chat_id, message_id, msg['message'], uid, msg['sender_pub']),
    )
    conn.commit()
    conn.close()

    payload = {
        'chat_id': chat_id,
        'message_id': message_id,
        'message_content': msg['message'],
        'sender_pub': msg['sender_pub'],
        'pinned_at': utc_now_z_func(),
        'created_at': msg['created_at'],
    }
    emit_func('message_pinned', payload, room=chat_id)
    if sender_pub:
        emit_func('message_pinned', payload, room=sender_pub)
    partner_pub = partner.get('public_key') if partner else ''
    if partner_pub and partner_pub != sender_pub:
        emit_func('message_pinned', payload, room=partner_pub)


def handle_unpin_message_event(
    data,
    *,
    session_store,
    require_payload_dict_func,
    socket_csrf_ok_func,
    ensure_chat_pins_multiple_support_func,
    positive_int_func,
    is_valid_chat_id_func,
    socket_rate_ok_func,
    get_db_connection_func,
    chat_partner_state_func,
    emit_blocked_error_func,
    emit_func,
    get_chat_type_func=None,
    get_group_member_role_func=None,
    authorize_group_action_func=None,
):
    data = require_payload_dict_func(data)
    if data is None:
        return
    if not socket_csrf_ok_func(data):
        return

    ensure_chat_pins_multiple_support_func()

    chat_id = (data.get('chat_id') or '').strip()
    message_id = positive_int_func(data.get('message_id'))
    if not chat_id:
        return
    if not is_valid_chat_id_func(chat_id):
        emit_func('error', {'message': 'Invalid chat ID.'})
        return

    uid = session_store['user_id']
    sender_pub = session_store.get('public_key_pem')
    if not socket_rate_ok_func(uid, 'unpin_message'):
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
        emit_blocked_error_func('Unpinning is unavailable because the user is blocked.', block_state)
        return

    chat_type = ''
    if callable(get_chat_type_func):
        try:
            chat_type = str(get_chat_type_func(conn, chat_id) or '').strip().lower()
        except Exception:  # noqa: BLE001
            chat_type = ''
    if not chat_type:
        chat_type = str(partner.get('chat_type') or '').strip().lower() if isinstance(partner, dict) else ''
        if not chat_type and isinstance(partner, dict) and bool(partner.get('is_group')):
            chat_type = 'group'

    if chat_type == 'group':
        if callable(authorize_group_action_func):
            allowed, denied_message = authorize_group_action_func(conn, uid, chat_id, 'pin')
            if not allowed:
                conn.close()
                emit_func('error', {'message': denied_message or 'Insufficient role for unpinning.'})
                return
        else:
            role = None
            if callable(get_group_member_role_func):
                role = get_group_member_role_func(conn, uid, chat_id)
            if role is None:
                try:
                    role_row = conn.execute(
                        '''
                        SELECT role
                        FROM chat_members
                        WHERE user_id = ? AND chat_id = ?
                        ''',
                        (uid, chat_id),
                    ).fetchone()
                    role = str(role_row['role'] or '').strip().lower() if role_row else ''
                except Exception:  # noqa: BLE001
                    role = None
            if str(role or '').strip().lower() != 'admin':
                conn.close()
                emit_func('error', {'message': 'Only group admins can unpin messages.'})
                return

    if message_id is None:
        conn.execute('DELETE FROM chat_pins WHERE chat_id = ?', (chat_id,))
    else:
        conn.execute('DELETE FROM chat_pins WHERE chat_id = ? AND message_id = ?', (chat_id, message_id))
    conn.commit()
    conn.close()

    payload = {'chat_id': chat_id}
    if message_id is not None:
        payload['message_id'] = message_id
    emit_func('message_unpinned', payload, room=chat_id)
    if sender_pub:
        emit_func('message_unpinned', payload, room=sender_pub)
    partner_pub = partner.get('public_key') if partner else ''
    if partner_pub and partner_pub != sender_pub:
        emit_func('message_unpinned', payload, room=partner_pub)
