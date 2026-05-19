from app.services.group_permissions import load_group_permissions, role_uses_member_permissions
from app.sockets.error_messages import socket_error_payload


def _emit_error(emit_func, message: str) -> None:
    emit_func('error', socket_error_payload(message))


def _validate_pin_payload(
    data,
    *,
    context: dict | None = None,
) -> dict | None:
    pin_context = context or {}
    positive_int_func = pin_context.get('positive_int_func')
    is_valid_chat_id_func = pin_context.get('is_valid_chat_id_func')
    emit_func = pin_context.get('emit_func')
    require_message_id = bool(pin_context.get('require_message_id'))

    chat_id = (data.get('chat_id') or '').strip()
    message_id = positive_int_func(data.get('message_id'))
    if not chat_id or (require_message_id and message_id is None):
        return None
    if not is_valid_chat_id_func(chat_id):
        _emit_error(emit_func, 'Invalid chat ID.')
        return None
    return {'chat_id': chat_id, 'message_id': message_id}


def _resolve_partner_for_pin_operation(
    conn,
    *,
    context: dict | None = None,
):
    pin_context = context or {}
    uid = int(pin_context.get('uid') or 0)
    chat_id = str(pin_context.get('chat_id') or '')
    chat_partner_state_func = pin_context.get('chat_partner_state_func')
    emit_func = pin_context.get('emit_func')
    emit_blocked_error_func = pin_context.get('emit_blocked_error_func')
    blocked_error_message = str(pin_context.get('blocked_error_message') or '')

    partner, block_state = chat_partner_state_func(conn, uid, chat_id)
    if not partner:
        return None
    if block_state and block_state['is_blocked']:
        emit_func('chat_block_state', {'chat_id': chat_id, 'partner_user_id': partner['contact_id'], **block_state})
        emit_blocked_error_func(blocked_error_message, block_state)
        return None
    return partner


def _resolve_chat_type(
    conn,
    *,
    context: dict | None = None,
) -> str:
    pin_context = context or {}
    get_chat_type_func = pin_context.get('get_chat_type_func')
    chat_id = str(pin_context.get('chat_id') or '')
    partner = pin_context.get('partner')

    chat_type = ''
    if callable(get_chat_type_func):
        try:
            chat_type = str(get_chat_type_func(conn, chat_id) or '').strip().lower()
        except Exception:  # noqa: BLE001
            chat_type = ''
    if chat_type:
        return chat_type
    partner_chat_type = str(partner.get('chat_type') or '').strip().lower() if isinstance(partner, dict) else ''
    if partner_chat_type:
        return partner_chat_type
    if isinstance(partner, dict) and bool(partner.get('is_group')):
        return 'group'
    return ''


def _resolve_group_member_role(
    conn,
    *,
    context: dict | None = None,
):
    pin_context = context or {}
    get_group_member_role_func = pin_context.get('get_group_member_role_func')
    uid = int(pin_context.get('uid') or 0)
    chat_id = str(pin_context.get('chat_id') or '')

    role = None
    if callable(get_group_member_role_func):
        role = get_group_member_role_func(conn, uid, chat_id)
    if role is not None:
        return role
    try:
        role_row = conn.execute(
            '''
            SELECT role
            FROM chat_members
            WHERE user_id = ? AND chat_id = ?
            ''',
            (uid, chat_id),
        ).fetchone()
        return str(role_row['role'] or '').strip().lower() if role_row else ''
    except Exception:  # noqa: BLE001
        return None


def _check_group_pin_permission(
    conn,
    *,
    context: dict | None = None,
) -> tuple[bool, str | None]:
    pin_context = context or {}
    uid = int(pin_context.get('uid') or 0)
    chat_id = str(pin_context.get('chat_id') or '')
    role = pin_context.get('role')
    authorize_group_action_func = pin_context.get('authorize_group_action_func')
    denied_default_message = str(pin_context.get('denied_default_message') or '')
    admin_only_message = str(pin_context.get('admin_only_message') or '')

    group_permissions = load_group_permissions(conn, chat_id=chat_id)
    can_member_pin = bool(
        role_uses_member_permissions(role)
        and group_permissions.get('members_can_pin_messages'),
    )
    if can_member_pin:
        return True, None
    if callable(authorize_group_action_func):
        allowed, denied_message = authorize_group_action_func(conn, uid, chat_id, 'pin')
        if not allowed:
            return False, denied_message or denied_default_message
        return True, None
    if str(role or '').strip().lower() != 'admin':
        return False, admin_only_message
    return True, None


def _authorize_pin_operation(
    conn,
    *,
    context: dict | None = None,
) -> bool:
    pin_context = context or {}
    partner = pin_context.get('partner')
    uid = int(pin_context.get('uid') or 0)
    chat_id = str(pin_context.get('chat_id') or '')
    get_chat_type_func = pin_context.get('get_chat_type_func')
    get_group_member_role_func = pin_context.get('get_group_member_role_func')
    authorize_group_action_func = pin_context.get('authorize_group_action_func')
    denied_default_message = str(pin_context.get('denied_default_message') or '')
    admin_only_message = str(pin_context.get('admin_only_message') or '')
    emit_func = pin_context.get('emit_func')

    chat_type = _resolve_chat_type(
        conn,
        context={
            'get_chat_type_func': get_chat_type_func,
            'chat_id': chat_id,
            'partner': partner,
        },
    )
    if chat_type != 'group':
        return True

    role = _resolve_group_member_role(
        conn,
        context={
            'get_group_member_role_func': get_group_member_role_func,
            'uid': uid,
            'chat_id': chat_id,
        },
    )
    allowed, denied_message = _check_group_pin_permission(
        conn,
        context={
            'uid': uid,
            'chat_id': chat_id,
            'role': role,
            'authorize_group_action_func': authorize_group_action_func,
            'denied_default_message': denied_default_message,
            'admin_only_message': admin_only_message,
        },
    )
    if allowed:
        return True
    _emit_error(emit_func, denied_message or admin_only_message)
    return False


def _load_message_for_pin(
    conn,
    *,
    context: dict | None = None,
):
    pin_context = context or {}
    chat_id = str(pin_context.get('chat_id') or '')
    message_id = int(pin_context.get('message_id') or 0)
    return conn.execute(
        '''
        SELECT m.message, m.created_at, u.public_key AS sender_pub
        FROM messages m
        JOIN users u ON m.sender_id = u.id
        WHERE m.id = ? AND m.chat_id = ?
        ''',
        (message_id, chat_id),
    ).fetchone()


def _upsert_pin_record(
    conn,
    *,
    context: dict | None = None,
) -> None:
    pin_context = context or {}
    chat_id = str(pin_context.get('chat_id') or '')
    message_id = int(pin_context.get('message_id') or 0)
    message_content = str(pin_context.get('message_content') or '')
    uid = int(pin_context.get('uid') or 0)
    sender_pub = pin_context.get('sender_pub')
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
        (chat_id, message_id, message_content, uid, sender_pub),
    )


def _delete_pin_records(
    conn,
    *,
    context: dict | None = None,
) -> None:
    pin_context = context or {}
    chat_id = str(pin_context.get('chat_id') or '')
    message_id = pin_context.get('message_id')
    if message_id is None:
        conn.execute('DELETE FROM chat_pins WHERE chat_id = ?', (chat_id,))
        return
    conn.execute('DELETE FROM chat_pins WHERE chat_id = ? AND message_id = ?', (chat_id, int(message_id)))


def _emit_pin_related_event(
    *,
    context: dict | None = None,
) -> None:
    pin_context = context or {}
    emit_func = pin_context.get('emit_func')
    event_name = str(pin_context.get('event_name') or '')
    payload = pin_context.get('payload') or {}
    chat_id = str(pin_context.get('chat_id') or '')
    sender_pub = pin_context.get('sender_pub')
    partner = pin_context.get('partner')

    emit_func(event_name, payload, room=chat_id)
    if sender_pub:
        emit_func(event_name, payload, room=sender_pub)
    partner_pub = partner.get('public_key') if partner else ''
    if partner_pub and partner_pub != sender_pub:
        emit_func(event_name, payload, room=partner_pub)


def handle_pin_message_event(  # noqa: PLR0913 - dependency-injected socket handler contract
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
    if 'user_id' not in session_store:
        return
    data = require_payload_dict_func(data)
    if data is None:
        return
    if not socket_csrf_ok_func(data):
        return
    ensure_chat_pins_multiple_support_func()

    payload = _validate_pin_payload(
        data,
        context={
            'positive_int_func': positive_int_func,
            'is_valid_chat_id_func': is_valid_chat_id_func,
            'emit_func': emit_func,
            'require_message_id': True,
        },
    )
    if not payload:
        return
    chat_id = payload['chat_id']
    message_id = payload['message_id']

    uid = session_store['user_id']
    sender_pub = session_store.get('public_key_pem')
    if not socket_rate_ok_func(uid, 'pin_message'):
        _emit_error(emit_func, 'Too many messages. Please wait a little.')
        return

    conn = get_db_connection_func()
    event_payload = None
    partner = None
    try:
        partner = _resolve_partner_for_pin_operation(
            conn,
            context={
                'uid': uid,
                'chat_id': chat_id,
                'chat_partner_state_func': chat_partner_state_func,
                'emit_func': emit_func,
                'emit_blocked_error_func': emit_blocked_error_func,
                'blocked_error_message': 'Pinning is unavailable because the user is blocked.',
            },
        )
        if not partner:
            return
        if not _authorize_pin_operation(
            conn,
            context={
                'partner': partner,
                'uid': uid,
                'chat_id': chat_id,
                'get_chat_type_func': get_chat_type_func,
                'get_group_member_role_func': get_group_member_role_func,
                'authorize_group_action_func': authorize_group_action_func,
                'denied_default_message': 'Insufficient role for pinning.',
                'admin_only_message': 'Only group admins can pin messages.',
                'emit_func': emit_func,
            },
        ):
            return

        msg = _load_message_for_pin(conn, context={'chat_id': chat_id, 'message_id': message_id})
        if not msg:
            return
        _upsert_pin_record(
            conn,
            context={
                'chat_id': chat_id,
                'message_id': message_id,
                'message_content': msg['message'],
                'uid': uid,
                'sender_pub': msg['sender_pub'],
            },
        )
        conn.commit()
        event_payload = {
            'chat_id': chat_id,
            'message_id': message_id,
            'message_content': msg['message'],
            'sender_pub': msg['sender_pub'],
            'pinned_at': utc_now_z_func(),
            'created_at': msg['created_at'],
        }
    finally:
        conn.close()

    if not event_payload:
        return
    _emit_pin_related_event(
        context={
            'emit_func': emit_func,
            'event_name': 'message_pinned',
            'payload': event_payload,
            'chat_id': chat_id,
            'sender_pub': sender_pub,
            'partner': partner,
        },
    )


def handle_unpin_message_event(  # noqa: PLR0913 - dependency-injected socket handler contract
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
    if 'user_id' not in session_store:
        return
    data = require_payload_dict_func(data)
    if data is None:
        return
    if not socket_csrf_ok_func(data):
        return
    ensure_chat_pins_multiple_support_func()

    payload = _validate_pin_payload(
        data,
        context={
            'positive_int_func': positive_int_func,
            'is_valid_chat_id_func': is_valid_chat_id_func,
            'emit_func': emit_func,
            'require_message_id': False,
        },
    )
    if not payload:
        return
    chat_id = payload['chat_id']
    message_id = payload['message_id']

    uid = session_store['user_id']
    sender_pub = session_store.get('public_key_pem')
    if not socket_rate_ok_func(uid, 'unpin_message'):
        _emit_error(emit_func, 'Too many messages. Please wait a little.')
        return

    conn = get_db_connection_func()
    partner = None
    should_emit = False
    try:
        partner = _resolve_partner_for_pin_operation(
            conn,
            context={
                'uid': uid,
                'chat_id': chat_id,
                'chat_partner_state_func': chat_partner_state_func,
                'emit_func': emit_func,
                'emit_blocked_error_func': emit_blocked_error_func,
                'blocked_error_message': 'Unpinning is unavailable because the user is blocked.',
            },
        )
        if not partner:
            return
        if not _authorize_pin_operation(
            conn,
            context={
                'partner': partner,
                'uid': uid,
                'chat_id': chat_id,
                'get_chat_type_func': get_chat_type_func,
                'get_group_member_role_func': get_group_member_role_func,
                'authorize_group_action_func': authorize_group_action_func,
                'denied_default_message': 'Insufficient role for unpinning.',
                'admin_only_message': 'Only group admins can unpin messages.',
                'emit_func': emit_func,
            },
        ):
            return

        _delete_pin_records(
            conn,
            context={
                'chat_id': chat_id,
                'message_id': message_id,
            },
        )
        conn.commit()
        should_emit = True
    finally:
        conn.close()

    if not should_emit:
        return
    event_payload = {'chat_id': chat_id}
    if message_id is not None:
        event_payload['message_id'] = message_id
    _emit_pin_related_event(
        context={
            'emit_func': emit_func,
            'event_name': 'message_unpinned',
            'payload': event_payload,
            'chat_id': chat_id,
            'sender_pub': sender_pub,
            'partner': partner,
        },
    )
