from app.services.chat_members import get_chat_type, list_chat_member_public_keys

ALLOWED_TYPING_KINDS = {
    'text',
    'voice',
    'upload_file',
    'upload_voice',
    'send_file',
    'send_voice',
}


def _validate_typing_signal_payload(
    data,
    *,
    context: dict | None = None,
) -> dict | None:
    typing_context = context or {}
    session_store = typing_context.get('session_store') or {}
    socket_signal_interval_ok_func = typing_context.get('socket_signal_interval_ok_func')
    socket_rate_ok_func = typing_context.get('socket_rate_ok_func')
    is_valid_chat_id_func = typing_context.get('is_valid_chat_id_func')
    rate_event_name = str(typing_context.get('rate_event_name') or '')

    chat_id = (data.get('chat_id') or '').strip()
    uid = session_store.get('user_id')
    if not chat_id or not uid:
        return None

    typing_kind = str(data.get('typing_kind') or '').strip().lower()
    normalized_typing_kind = typing_kind if typing_kind in ALLOWED_TYPING_KINDS else ''
    signal_interval_event_name = rate_event_name
    if rate_event_name == 'typing':
        signal_kind = normalized_typing_kind or 'text'
        signal_interval_event_name = f'typing:{signal_kind}'

    if not socket_signal_interval_ok_func(uid, signal_interval_event_name):
        return None
    if not socket_rate_ok_func(uid, rate_event_name):
        return None
    if not is_valid_chat_id_func(chat_id):
        return None

    return {
        'chat_id': chat_id,
        'uid': int(uid),
        'normalized_typing_kind': normalized_typing_kind,
    }


def _resolve_typing_targets(
    conn,
    *,
    context: dict | None = None,
):
    typing_context = context or {}
    uid = int(typing_context.get('uid') or 0)
    chat_id = str(typing_context.get('chat_id') or '')
    chat_partner_state_func = typing_context.get('chat_partner_state_func')

    partner, block_state = chat_partner_state_func(conn, uid, chat_id)
    if not partner:
        return None
    is_group_chat = get_chat_type(conn, chat_id) == 'group'
    group_member_public_keys = []
    if is_group_chat:
        group_member_public_keys = list_chat_member_public_keys(
            conn,
            chat_id,
            exclude_user_id=uid,
        )
    sender_row = conn.execute(
        '''
        SELECT id, display_name, username
        FROM users
        WHERE id = ?
        ''',
        (uid,),
    ).fetchone()
    return {
        'partner': partner,
        'block_state': block_state,
        'is_group_chat': is_group_chat,
        'group_member_public_keys': group_member_public_keys,
        'sender_row': sender_row,
    }


def _resolve_sender_identity(
    *,
    context: dict | None = None,
) -> tuple[str, str]:
    typing_context = context or {}
    session_store = typing_context.get('session_store') or {}
    sender_row = typing_context.get('sender_row')

    sender_display_name = str(session_store.get('display_name') or '').strip()
    sender_username = str(session_store.get('username') or '').strip()
    if sender_row:
        if not sender_display_name:
            sender_display_name = str(sender_row['display_name'] or sender_row['username'] or '').strip()
        if not sender_username:
            sender_username = str(sender_row['username'] or '').strip()
    return sender_display_name, sender_username


def _emit_typing_signal(
    *,
    context: dict | None = None,
) -> None:
    typing_context = context or {}
    emit_func = typing_context.get('emit_func')
    partner_event_name = str(typing_context.get('partner_event_name') or '')
    payload = typing_context.get('payload') or {}
    is_group_chat = bool(typing_context.get('is_group_chat'))
    group_member_public_keys = typing_context.get('group_member_public_keys') or []
    partner = typing_context.get('partner')

    if is_group_chat:
        for member in group_member_public_keys:
            member_public_key = str(member['public_key'] or '').strip()
            if not member_public_key:
                continue
            emit_func(partner_event_name, payload, room=member_public_key)
        return
    if partner and partner['public_key']:
        emit_func(partner_event_name, payload, room=partner['public_key'], include_self=False)


def _handle_typing_signal_event(  # noqa: PLR0913 - dependency-injected socket handler contract
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

    payload_input = _validate_typing_signal_payload(
        data,
        context={
            'session_store': session_store,
            'socket_signal_interval_ok_func': socket_signal_interval_ok_func,
            'socket_rate_ok_func': socket_rate_ok_func,
            'is_valid_chat_id_func': is_valid_chat_id_func,
            'rate_event_name': rate_event_name,
        },
    )
    if not payload_input:
        return
    chat_id = payload_input['chat_id']
    uid = payload_input['uid']
    normalized_typing_kind = payload_input['normalized_typing_kind']

    conn = get_db_connection_func()
    try:
        resolved = _resolve_typing_targets(
            conn,
            context={
                'uid': uid,
                'chat_id': chat_id,
                'chat_partner_state_func': chat_partner_state_func,
            },
        )
    finally:
        conn.close()
    if not resolved:
        return
    partner = resolved['partner']
    block_state = resolved['block_state']
    is_group_chat = bool(resolved['is_group_chat'])
    group_member_public_keys = resolved['group_member_public_keys']
    sender_row = resolved['sender_row']

    if block_state and block_state['is_blocked']:
        emit_func('chat_block_state', {'chat_id': chat_id, 'partner_user_id': partner['contact_id'], **block_state})
        return

    sender_display_name, sender_username = _resolve_sender_identity(
        context={
            'session_store': session_store,
            'sender_row': sender_row,
        },
    )

    payload = {
        'chat_id': chat_id,
        'sender_user_id': int(uid),
        'sender_display_name': sender_display_name,
        'sender_username': sender_username,
    }
    if normalized_typing_kind:
        payload['typing_kind'] = normalized_typing_kind
    _emit_typing_signal(
        context={
            'emit_func': emit_func,
            'partner_event_name': partner_event_name,
            'payload': payload,
            'is_group_chat': is_group_chat,
            'group_member_public_keys': group_member_public_keys,
            'partner': partner,
        },
    )


def handle_typing_event(  # noqa: PLR0913 - dependency-injected socket handler contract
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


def handle_stop_typing_event(  # noqa: PLR0913 - dependency-injected socket handler contract
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
