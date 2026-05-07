from app.services.chat_members import get_chat_type


def _handle_typing_signal_event(
    data,
    *,
    session_store,
    require_payload_dict_func,
    socket_csrf_ok_func,
    socket_signal_interval_ok_func,
    socket_rate_ok_func,
    is_valid_chat_id_func,
    get_db_connection_func,
    chat_partner_state_func,
    emit_func,
    rate_event_name: str,
    partner_event_name: str,
):
    data = require_payload_dict_func(data)
    if data is None:
        return
    if not socket_csrf_ok_func(data):
        return

    chat_id = (data.get('chat_id') or '').strip()
    uid = session_store.get('user_id')
    if not chat_id or not uid:
        return
    if not socket_signal_interval_ok_func(uid, rate_event_name):
        return
    if not socket_rate_ok_func(uid, rate_event_name):
        return
    if not is_valid_chat_id_func(chat_id):
        return

    conn = get_db_connection_func()
    partner, block_state = chat_partner_state_func(conn, uid, chat_id)
    is_group_chat = get_chat_type(conn, chat_id) == 'group'
    sender_row = conn.execute(
        '''
        SELECT id, display_name, username
        FROM users
        WHERE id = ?
        ''',
        (uid,),
    ).fetchone()
    conn.close()
    if not partner:
        return
    if block_state and block_state['is_blocked']:
        emit_func('chat_block_state', {'chat_id': chat_id, 'partner_user_id': partner['contact_id'], **block_state})
        return

    sender_display_name = str(session_store.get('display_name') or '').strip()
    sender_username = str(session_store.get('username') or '').strip()
    if sender_row:
        if not sender_display_name:
            sender_display_name = str(sender_row['display_name'] or sender_row['username'] or '').strip()
        if not sender_username:
            sender_username = str(sender_row['username'] or '').strip()

    payload = {
        'chat_id': chat_id,
        'sender_user_id': int(uid),
        'sender_display_name': sender_display_name,
        'sender_username': sender_username,
    }
    typing_kind = str(data.get('typing_kind') or '').strip().lower()
    if typing_kind in {'text', 'voice'}:
        payload['typing_kind'] = typing_kind
    if is_group_chat:
        emit_func(partner_event_name, payload, room=chat_id, include_self=False)
    elif partner and partner['public_key']:
        emit_func(partner_event_name, payload, room=partner['public_key'], include_self=False)


def handle_typing_event(
    data,
    *,
    session_store,
    require_payload_dict_func,
    socket_csrf_ok_func,
    socket_signal_interval_ok_func,
    socket_rate_ok_func,
    is_valid_chat_id_func,
    get_db_connection_func,
    chat_partner_state_func,
    emit_func,
):
    _handle_typing_signal_event(
        data,
        session_store=session_store,
        require_payload_dict_func=require_payload_dict_func,
        socket_csrf_ok_func=socket_csrf_ok_func,
        socket_signal_interval_ok_func=socket_signal_interval_ok_func,
        socket_rate_ok_func=socket_rate_ok_func,
        is_valid_chat_id_func=is_valid_chat_id_func,
        get_db_connection_func=get_db_connection_func,
        chat_partner_state_func=chat_partner_state_func,
        emit_func=emit_func,
        rate_event_name='typing',
        partner_event_name='partner_typing',
    )


def handle_stop_typing_event(
    data,
    *,
    session_store,
    require_payload_dict_func,
    socket_csrf_ok_func,
    socket_signal_interval_ok_func,
    socket_rate_ok_func,
    is_valid_chat_id_func,
    get_db_connection_func,
    chat_partner_state_func,
    emit_func,
):
    _handle_typing_signal_event(
        data,
        session_store=session_store,
        require_payload_dict_func=require_payload_dict_func,
        socket_csrf_ok_func=socket_csrf_ok_func,
        socket_signal_interval_ok_func=socket_signal_interval_ok_func,
        socket_rate_ok_func=socket_rate_ok_func,
        is_valid_chat_id_func=is_valid_chat_id_func,
        get_db_connection_func=get_db_connection_func,
        chat_partner_state_func=chat_partner_state_func,
        emit_func=emit_func,
        rate_event_name='stop_typing',
        partner_event_name='partner_stop_typing',
    )
