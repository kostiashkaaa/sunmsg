from app.services.chat_members import get_chat_type
from app.services.group_receipts import (
    build_group_read_updates,
    list_unread_group_receipt_message_ids,
)


def _is_missing_read_at_column_error(exc: Exception) -> bool:
    message = str(exc or '').strip().lower()
    return (
        'read_at' in message
        and (
            'no such column' in message
            or 'does not exist' in message
            or 'РЅРµ СЃСѓС‰РµСЃС‚РІСѓРµС‚' in message
        )
    )


def _emit_chat_block_state(emit_func, *, chat_id: str, partner: dict, block_state: dict) -> None:
    emit_func('chat_block_state', {'chat_id': chat_id, 'partner_user_id': partner['contact_id'], **block_state})


def _validate_messages_seen_payload(
    data,
    *,
    context: dict | None = None,
) -> str | None:
    read_context = context or {}
    is_valid_chat_id_func = read_context.get('is_valid_chat_id_func')
    emit_func = read_context.get('emit_func')

    chat_id = (data.get('chat_id') or '').strip()
    if not chat_id:
        return None
    if not is_valid_chat_id_func(chat_id):
        emit_func('error', {'message': 'Invalid chat ID.'})
        return None
    return chat_id


def _validate_voice_listened_payload(
    data,
    *,
    context: dict | None = None,
) -> dict | None:
    read_context = context or {}
    positive_int_func = read_context.get('positive_int_func')
    is_valid_chat_id_func = read_context.get('is_valid_chat_id_func')
    emit_func = read_context.get('emit_func')

    chat_id = (data.get('chat_id') or '').strip()
    message_id = positive_int_func(data.get('msg_id') or data.get('message_id'))
    if not chat_id or message_id is None:
        return None
    if not is_valid_chat_id_func(chat_id):
        emit_func('error', {'message': 'Invalid chat ID.'})
        return None
    return {'chat_id': chat_id, 'message_id': int(message_id)}


def _resolve_read_context(
    conn,
    *,
    context: dict | None = None,
):
    read_context = context or {}
    user_id = int(read_context.get('user_id') or 0)
    chat_id = str(read_context.get('chat_id') or '')
    chat_partner_state_func = read_context.get('chat_partner_state_func')
    emit_func = read_context.get('emit_func')

    partner, block_state = chat_partner_state_func(conn, user_id, chat_id)
    if not partner:
        return None
    is_group_chat = get_chat_type(conn, chat_id) == 'group'
    if block_state and block_state['is_blocked']:
        _emit_chat_block_state(emit_func, chat_id=chat_id, partner=partner, block_state=block_state)
        return None
    return {'partner': partner, 'is_group_chat': is_group_chat}


def _run_messages_seen_update_with_read_at(
    conn,
    *,
    context: dict | None = None,
):
    read_context = context or {}
    is_group_chat = bool(read_context.get('is_group_chat'))
    chat_id = str(read_context.get('chat_id') or '')
    user_id = int(read_context.get('user_id') or 0)

    read_at_row = conn.execute('SELECT CURRENT_TIMESTAMP AS read_at').fetchone()
    read_at_value = read_at_row['read_at'] if read_at_row else None
    if is_group_chat:
        return conn.execute(
            '''
            UPDATE message_receipts AS mr
            SET is_read = 1,
                is_delivered = 1,
                read_at = COALESCE(mr.read_at, ?),
                delivered_at = COALESCE(mr.delivered_at, ?),
                updated_at = CURRENT_TIMESTAMP
            FROM messages m
            WHERE mr.message_id = m.id
              AND m.chat_id = ?
              AND mr.user_id = ?
              AND mr.deleted_for_user = 0
              AND mr.is_read = 0
            ''',
            (read_at_value, read_at_value, chat_id, user_id),
        )
    return conn.execute(
        '''
        UPDATE messages
        SET is_read = 1,
            is_delivered = 1,
            read_at = COALESCE(read_at, ?)
        WHERE chat_id = ? AND receiver_id = ? AND is_read = 0
        ''',
        (read_at_value, chat_id, user_id),
    )


def _run_messages_seen_update_without_read_at(
    conn,
    *,
    context: dict | None = None,
):
    read_context = context or {}
    is_group_chat = bool(read_context.get('is_group_chat'))
    chat_id = str(read_context.get('chat_id') or '')
    user_id = int(read_context.get('user_id') or 0)

    if is_group_chat:
        return conn.execute(
            '''
            UPDATE message_receipts AS mr
            SET is_read = 1,
                is_delivered = 1,
                updated_at = CURRENT_TIMESTAMP
            FROM messages m
            WHERE mr.message_id = m.id
              AND m.chat_id = ?
              AND mr.user_id = ?
              AND mr.deleted_for_user = 0
              AND mr.is_read = 0
            ''',
            (chat_id, user_id),
        )
    return conn.execute(
        '''
        UPDATE messages
        SET is_read = 1,
            is_delivered = 1
        WHERE chat_id = ? AND receiver_id = ? AND is_read = 0
        ''',
        (chat_id, user_id),
    )


def _apply_messages_seen_updates(
    conn,
    *,
    context: dict | None = None,
):
    read_context = context or {}
    is_group_chat = bool(read_context.get('is_group_chat'))
    chat_id = str(read_context.get('chat_id') or '')
    user_id = int(read_context.get('user_id') or 0)

    affected_message_ids: list[int] = []
    if is_group_chat:
        affected_message_ids = list_unread_group_receipt_message_ids(
            conn,
            chat_id=chat_id,
            user_id=user_id,
        )
    try:
        cursor = _run_messages_seen_update_with_read_at(
            conn,
            context={
                'is_group_chat': is_group_chat,
                'chat_id': chat_id,
                'user_id': user_id,
            },
        )
    except Exception as exc:  # noqa: BLE001
        if not _is_missing_read_at_column_error(exc):
            raise
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001
            pass
        if is_group_chat and not affected_message_ids:
            affected_message_ids = list_unread_group_receipt_message_ids(
                conn,
                chat_id=chat_id,
                user_id=user_id,
            )
        cursor = _run_messages_seen_update_without_read_at(
            conn,
            context={
                'is_group_chat': is_group_chat,
                'chat_id': chat_id,
                'user_id': user_id,
            },
        )
    return cursor, affected_message_ids


def _emit_messages_seen_updates(
    *,
    context: dict | None = None,
) -> None:
    read_context = context or {}
    emit_func = read_context.get('emit_func')
    should_notify = bool(read_context.get('should_notify'))
    is_group_chat = bool(read_context.get('is_group_chat'))
    chat_id = str(read_context.get('chat_id') or '')
    user_id = int(read_context.get('user_id') or 0)
    group_read_updates = read_context.get('group_read_updates') or []
    partner = read_context.get('partner')

    if not should_notify:
        return
    if is_group_chat:
        if group_read_updates:
            emit_func(
                'group_messages_read',
                {
                    'chat_id': chat_id,
                    'reader_user_id': user_id,
                    'updates': group_read_updates,
                },
                room=chat_id,
            )
        emit_func('messages_read', {'chat_id': chat_id, 'is_group': True}, room=chat_id)
        return
    if partner and partner['public_key']:
        emit_func('messages_read', {'chat_id': chat_id, 'is_group': False}, room=partner['public_key'])


def _apply_voice_listened_update(
    conn,
    *,
    context: dict | None = None,
) -> int:
    read_context = context or {}
    is_group_chat = bool(read_context.get('is_group_chat'))
    message_id = int(read_context.get('message_id') or 0)
    user_id = int(read_context.get('user_id') or 0)
    chat_id = str(read_context.get('chat_id') or '')
    partner = read_context.get('partner')

    if is_group_chat:
        cursor = conn.execute(
            '''
            UPDATE message_receipts
            SET voice_listened = 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE message_id = ?
              AND user_id = ?
              AND voice_listened = 0
            ''',
            (message_id, user_id),
        )
    else:
        cursor = conn.execute(
            '''
            UPDATE messages
            SET voice_listened_by_receiver = 1
            WHERE id = ?
              AND chat_id = ?
              AND (receiver_id = ? OR receiver_id IS NULL)
              AND sender_id = ?
              AND voice_listened_by_receiver = 0
            ''',
            (message_id, chat_id, user_id, partner['contact_id']),
        )
    return int(cursor.rowcount or 0)


def _emit_voice_listened_update(
    *,
    context: dict | None = None,
) -> None:
    read_context = context or {}
    emit_func = read_context.get('emit_func')
    updated_rows = int(read_context.get('updated_rows') or 0)
    partner = read_context.get('partner')
    is_group_chat = bool(read_context.get('is_group_chat'))
    chat_id = str(read_context.get('chat_id') or '')
    message_id = int(read_context.get('message_id') or 0)

    if updated_rows <= 0:
        return
    payload = {
        'chat_id': chat_id,
        'msg_id': message_id,
    }
    if partner and partner['public_key']:
        emit_func('voice_message_listened', payload, room=partner['public_key'])
        return
    if is_group_chat:
        emit_func('voice_message_listened', payload, room=chat_id)


def handle_messages_seen_event(  # noqa: PLR0913 - dependency-injected socket handler contract
    data,
    *,
    session_store,
    require_payload_dict_func,
    socket_csrf_ok_func,
    is_valid_chat_id_func,
    socket_rate_ok_func,
    get_db_connection_func,
    chat_partner_state_func,
    emit_func,
):
    data = require_payload_dict_func(data)
    if data is None:
        return
    if not socket_csrf_ok_func(data):
        return

    chat_id = _validate_messages_seen_payload(
        data,
        context={
            'is_valid_chat_id_func': is_valid_chat_id_func,
            'emit_func': emit_func,
        },
    )
    if not chat_id:
        return

    user_id = session_store['user_id']
    if not socket_rate_ok_func(user_id, 'messages_seen'):
        emit_func('error', {'message': 'Too many messages. Please wait a little.'})
        return

    conn = get_db_connection_func()
    should_notify = False
    is_group_chat = False
    partner = None
    group_read_updates: list[dict] = []
    try:
        resolved = _resolve_read_context(
            conn,
            context={
                'user_id': user_id,
                'chat_id': chat_id,
                'chat_partner_state_func': chat_partner_state_func,
                'emit_func': emit_func,
            },
        )
        if not resolved:
            return
        partner = resolved['partner']
        is_group_chat = bool(resolved['is_group_chat'])

        cursor, affected_message_ids = _apply_messages_seen_updates(
            conn,
            context={
                'is_group_chat': is_group_chat,
                'chat_id': chat_id,
                'user_id': user_id,
            },
        )
        should_notify = cursor.rowcount > 0 if cursor is not None else False
        if should_notify and is_group_chat and affected_message_ids:
            group_read_updates = build_group_read_updates(
                conn,
                chat_id=chat_id,
                message_ids=affected_message_ids,
            )
        conn.commit()
    finally:
        conn.close()

    _emit_messages_seen_updates(
        context={
            'emit_func': emit_func,
            'should_notify': should_notify,
            'is_group_chat': is_group_chat,
            'chat_id': chat_id,
            'user_id': user_id,
            'group_read_updates': group_read_updates,
            'partner': partner,
        },
    )


def handle_voice_message_listened_event(  # noqa: PLR0913 - dependency-injected socket handler contract
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
    emit_func,
):
    data = require_payload_dict_func(data)
    if data is None:
        return
    if not socket_csrf_ok_func(data):
        return

    payload = _validate_voice_listened_payload(
        data,
        context={
            'positive_int_func': positive_int_func,
            'is_valid_chat_id_func': is_valid_chat_id_func,
            'emit_func': emit_func,
        },
    )
    if not payload:
        return
    chat_id = payload['chat_id']
    message_id = payload['message_id']

    user_id = session_store['user_id']
    if not socket_rate_ok_func(user_id, 'voice_message_listened'):
        return

    conn = get_db_connection_func()
    partner = None
    is_group_chat = False
    updated_rows = 0
    try:
        resolved = _resolve_read_context(
            conn,
            context={
                'user_id': user_id,
                'chat_id': chat_id,
                'chat_partner_state_func': chat_partner_state_func,
                'emit_func': emit_func,
            },
        )
        if not resolved:
            return
        partner = resolved['partner']
        is_group_chat = bool(resolved['is_group_chat'])
        updated_rows = _apply_voice_listened_update(
            conn,
            context={
                'is_group_chat': is_group_chat,
                'message_id': message_id,
                'user_id': user_id,
                'chat_id': chat_id,
                'partner': partner,
            },
        )
        conn.commit()
    finally:
        conn.close()

    _emit_voice_listened_update(
        context={
            'emit_func': emit_func,
            'updated_rows': updated_rows,
            'partner': partner,
            'is_group_chat': is_group_chat,
            'chat_id': chat_id,
            'message_id': message_id,
        },
    )
