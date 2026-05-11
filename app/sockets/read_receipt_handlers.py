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
            or 'не существует' in message
        )
    )


def handle_messages_seen_event(
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

    chat_id = (data.get('chat_id') or '').strip()
    if not chat_id:
        return
    if not is_valid_chat_id_func(chat_id):
        emit_func('error', {'message': 'Invalid chat ID.'})
        return

    user_id = session_store['user_id']
    if not socket_rate_ok_func(user_id, 'messages_seen'):
        emit_func('error', {'message': 'Too many messages. Please wait a little.'})
        return

    conn = get_db_connection_func()
    partner, block_state = chat_partner_state_func(conn, user_id, chat_id)
    if not partner:
        conn.close()
        return
    is_group_chat = get_chat_type(conn, chat_id) == 'group'
    if block_state and block_state['is_blocked']:
        conn.close()
        emit_func('chat_block_state', {'chat_id': chat_id, 'partner_user_id': partner['contact_id'], **block_state})
        return

    cursor = None
    affected_message_ids: list[int] = []
    group_read_updates: list[dict] = []
    try:
        read_at_row = conn.execute('SELECT CURRENT_TIMESTAMP AS read_at').fetchone()
        read_at_value = read_at_row['read_at'] if read_at_row else None
        if is_group_chat:
            affected_message_ids = list_unread_group_receipt_message_ids(
                conn,
                chat_id=chat_id,
                user_id=user_id,
            )
            cursor = conn.execute(
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
        else:
            cursor = conn.execute(
                '''
                UPDATE messages
                SET is_read = 1,
                    is_delivered = 1,
                    read_at = COALESCE(read_at, ?)
                WHERE chat_id = ? AND receiver_id = ? AND is_read = 0
                ''',
                (read_at_value, chat_id, user_id),
            )
    except Exception as exc:
        if not _is_missing_read_at_column_error(exc):
            conn.close()
            raise
        try:
            conn.rollback()
        except Exception:
            pass
        if is_group_chat:
            if not affected_message_ids:
                affected_message_ids = list_unread_group_receipt_message_ids(
                    conn,
                    chat_id=chat_id,
                    user_id=user_id,
                )
            cursor = conn.execute(
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
        else:
            cursor = conn.execute(
                '''
                UPDATE messages
                SET is_read = 1,
                    is_delivered = 1
                WHERE chat_id = ? AND receiver_id = ? AND is_read = 0
                ''',
                (chat_id, user_id),
            )
    should_notify = cursor.rowcount > 0 if cursor is not None else False
    if should_notify and is_group_chat and affected_message_ids:
        group_read_updates = build_group_read_updates(
            conn,
            chat_id=chat_id,
            message_ids=affected_message_ids,
        )
    conn.commit()
    conn.close()

    if should_notify and is_group_chat:
        if group_read_updates:
            emit_func(
                'group_messages_read',
                {
                    'chat_id': chat_id,
                    'reader_user_id': int(user_id),
                    'updates': group_read_updates,
                },
                room=chat_id,
            )
        emit_func('messages_read', {'chat_id': chat_id, 'is_group': True}, room=chat_id)
    elif should_notify and partner and partner['public_key']:
        emit_func('messages_read', {'chat_id': chat_id, 'is_group': False}, room=partner['public_key'])


def handle_voice_message_listened_event(
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

    chat_id = (data.get('chat_id') or '').strip()
    message_id = positive_int_func(data.get('msg_id') or data.get('message_id'))
    if not chat_id or message_id is None:
        return
    if not is_valid_chat_id_func(chat_id):
        emit_func('error', {'message': 'Invalid chat ID.'})
        return

    user_id = session_store['user_id']
    if not socket_rate_ok_func(user_id, 'voice_message_listened'):
        return

    conn = get_db_connection_func()
    try:
        partner, block_state = chat_partner_state_func(conn, user_id, chat_id)
        if not partner:
            return
        is_group_chat = get_chat_type(conn, chat_id) == 'group'
        if block_state and block_state['is_blocked']:
            emit_func('chat_block_state', {'chat_id': chat_id, 'partner_user_id': partner['contact_id'], **block_state})
            return

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
        updated_rows = int(cursor.rowcount or 0)
        conn.commit()

        if updated_rows > 0 and partner['public_key']:
            emit_func(
                'voice_message_listened',
                {
                    'chat_id': chat_id,
                    'msg_id': int(message_id),
                },
                room=partner['public_key'],
            )
        elif updated_rows > 0 and is_group_chat:
            emit_func(
                'voice_message_listened',
                {
                    'chat_id': chat_id,
                    'msg_id': int(message_id),
                },
                room=chat_id,
            )
    finally:
        conn.close()
