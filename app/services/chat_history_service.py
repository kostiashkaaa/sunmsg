from app.services.chat_members import get_chat_type, list_chat_member_public_keys
from app.services.disappearing_messages import get_chat_auto_delete
from app.services.group_receipts import (
    build_group_read_updates,
    collect_group_read_details_map,
    list_unread_group_receipt_message_ids,
)
from app.services.reactions import fetch_reactions_map
from app.services.user import get_safe_avatar_url, is_contact_for_avatar
from app.services.user_privacy import can_share_read_receipt, can_share_voice_listened


def _count_visible_messages(conn, *, chat_id: str, user_id: int, is_group_chat: bool) -> int:
    if is_group_chat:
        row = conn.execute(
            '''
            SELECT COUNT(*) AS total
            FROM messages m
            JOIN message_receipts mr ON mr.message_id = m.id
            WHERE m.chat_id = ?
              AND mr.user_id = ?
              AND mr.deleted_for_user = 0
            ''',
            (chat_id, user_id),
        ).fetchone()
    else:
        row = conn.execute(
            '''
            SELECT COUNT(*) AS total
            FROM messages m
            WHERE m.chat_id = ?
              AND ((m.sender_id = ? AND m.deleted_by_sender = 0) OR (m.receiver_id = ? AND m.deleted_by_receiver = 0))
            ''',
            (chat_id, user_id, user_id),
        ).fetchone()
    return int(row['total'] or 0) if row else 0


def _safe_sender_avatar_url(conn, *, row, viewer_id: int):
    sender_id = int(row['sender_id'])
    return get_safe_avatar_url(
        {
            'id': sender_id,
            'avatar_url': row['sender_avatar_url'],
            'avatar_visibility': row['sender_avatar_visibility'] if 'sender_avatar_visibility' in row.keys() else 'all',
            'is_contact': is_contact_for_avatar(conn, viewer_id=viewer_id, owner_id=sender_id),
        },
        viewer_id,
    )


def load_chat_history(  # noqa: PLR0913, C901, PLR0915 - dependency-injected history loader contract
    conn,
    *,
    user_id: int,
    chat_id: str,
    limit: int,
    before_id: int | None,
    after_id: int | None,
    include_pins: bool,
    include_favorites: bool,
    get_chat_partner_func,
    build_block_state_func,
    serialize_block_state_func,
    socketio_emit_func,
):
    partner = get_chat_partner_func(conn, user_id, chat_id)
    if not partner:
        return {'status': 'forbidden'}
    is_group_chat = get_chat_type(conn, chat_id) == 'group'

    partner_id = partner['contact_id']
    if partner_id is None:
        block_state = {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False}
    else:
        block_state = serialize_block_state_func(build_block_state_func(conn, user_id, partner_id))
    updated_rows = 0
    group_read_updates: list[dict] = []
    if before_id is None and not block_state['is_blocked']:
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
        updated_rows = cursor.rowcount
        should_notify_read = can_share_read_receipt(
            conn,
            reader_id=user_id,
            viewer_id=None if is_group_chat else partner_id,
        )
        if updated_rows > 0 and should_notify_read and is_group_chat and affected_message_ids:
            group_read_updates = build_group_read_updates(
                conn,
                chat_id=chat_id,
                message_ids=affected_message_ids,
            )
        conn.commit()
        if updated_rows > 0 and should_notify_read and is_group_chat:
            if group_read_updates:
                socketio_emit_func(
                    'group_messages_read',
                    {
                        'chat_id': chat_id,
                        'reader_user_id': int(user_id),
                        'updates': group_read_updates,
                    },
                    room=chat_id,
                )
            socketio_emit_func('messages_read', {'chat_id': chat_id, 'is_group': True}, room=chat_id)
        elif updated_rows > 0 and should_notify_read and partner['public_key']:
            socketio_emit_func('messages_read', {'chat_id': chat_id, 'is_group': False}, room=partner['public_key'])

    params = [chat_id]
    history_window_sql = ''
    order_sql = 'ORDER BY m.id DESC'
    reverse_messages = True
    if before_id is not None:
        history_window_sql = ' AND m.id < ?'
        params.append(before_id)
    elif after_id is not None:
        history_window_sql = ' AND m.id > ?'
        params.append(after_id)
        order_sql = 'ORDER BY m.id ASC'
        reverse_messages = False
    params.append(limit)

    if is_group_chat:
        group_params = [user_id, chat_id]
        if before_id is not None:
            group_params.append(before_id)
        elif after_id is not None:
            group_params.append(after_id)
        group_params.append(limit)
        messages = conn.execute(f'''
            SELECT
                m.id,
                m.sender_id,
                m.receiver_id,
                m.message,
                m.message_type,
                COALESCE(mr.is_read, 0) AS is_read,
                mr.read_at,
                COALESCE(mr.is_delivered, 0) AS is_delivered,
                COALESCE(mr.voice_listened, 0) AS voice_listened_by_receiver,
                m.is_edited,
                m.created_at,
                m.reply_to_id,
                m.forward_from_name,
                m.forward_from_user_id,
                m.expires_at,
                m.album_id,
                us.public_key AS sender_public_key,
                COALESCE(NULLIF(us.display_name, ''), NULLIF(us.username, ''), 'Участник') AS sender_display_name,
                COALESCE(us.username, '') AS sender_username,
                us.avatar_url AS sender_avatar_url,
                us.avatar_visibility AS sender_avatar_visibility,
                rm.message AS reply_message,
                ur.public_key AS reply_sender_pub
            FROM messages m
            JOIN message_receipts mr ON mr.message_id = m.id AND mr.user_id = ?
            LEFT JOIN users us ON us.id = m.sender_id
            LEFT JOIN messages rm ON m.reply_to_id = rm.id
            LEFT JOIN users ur ON ur.id = rm.sender_id
            WHERE m.chat_id = ?
              AND mr.deleted_for_user = 0
              {history_window_sql}
            {order_sql}
            LIMIT ?
        ''', tuple(group_params)).fetchall()
    else:
        direct_params = [chat_id, user_id, user_id]
        if before_id is not None:
            direct_params.append(before_id)
        elif after_id is not None:
            direct_params.append(after_id)
        direct_params.append(limit)
        messages = conn.execute(f'''
            SELECT m.id, m.sender_id, m.receiver_id, m.message, m.message_type,
                   m.is_read, m.read_at, m.is_delivered, m.voice_listened_by_receiver, m.is_edited, m.created_at, m.reply_to_id,
                   m.forward_from_name, m.forward_from_user_id, m.expires_at, m.album_id,
                   us.public_key as sender_public_key,
                    COALESCE(NULLIF(us.display_name, ''), NULLIF(us.username, ''), 'Участник') AS sender_display_name,
                    COALESCE(us.username, '') AS sender_username,
                    us.avatar_url AS sender_avatar_url,
                    us.avatar_visibility AS sender_avatar_visibility,
                    rm.message  as reply_message,
                   ur.public_key as reply_sender_pub
            FROM messages m
            LEFT JOIN users us ON us.id = m.sender_id
            LEFT JOIN messages rm ON m.reply_to_id = rm.id
            LEFT JOIN users ur ON ur.id = rm.sender_id
            WHERE m.chat_id = ?
            AND ((m.sender_id = ? AND m.deleted_by_sender = 0) OR (m.receiver_id = ? AND m.deleted_by_receiver = 0))
            {history_window_sql}
            {order_sql}
            LIMIT ?
        ''', tuple(direct_params)).fetchall()
    if reverse_messages:
        messages = list(reversed(messages))
    message_ids = [int(msg['id']) for msg in messages]
    reactions_map = fetch_reactions_map(conn, chat_id, message_ids, user_id)
    group_read_map: dict[int, dict] = {}
    if is_group_chat:
        own_group_message_ids = [
            int(msg['id'])
            for msg in messages
            if int(msg['sender_id']) == int(user_id)
        ]
        if own_group_message_ids:
            group_read_map = collect_group_read_details_map(
                conn,
                chat_id=chat_id,
                message_ids=own_group_message_ids,
                viewer_user_id=user_id,
            )
    favorite_message_ids = set()
    if include_favorites and message_ids:
        placeholders = ', '.join('?' * len(message_ids))
        favorite_rows = conn.execute(
            f'''
            SELECT message_id
            FROM favorite_messages
            WHERE user_id = ?
              AND chat_id = ?
              AND message_id IN ({placeholders})
            ''',
            (user_id, chat_id, *message_ids),
        ).fetchall()
        favorite_message_ids = {
            int(row['message_id'])
            for row in favorite_rows
            if row['message_id'] is not None
        }

    messages_list = []
    for msg in messages:
        msg_id = int(msg['id'])
        is_self = int(msg['sender_id']) == int(user_id)
        base_is_read = bool(msg['is_read'])
        base_read_at = msg['read_at']
        voice_listened_by_partner = bool(msg['voice_listened_by_receiver'])
        if not is_group_chat and is_self and msg['receiver_id'] is not None:
            reader_id = int(msg['receiver_id'])
            if not can_share_read_receipt(conn, reader_id=reader_id, viewer_id=user_id):
                base_is_read = False
                base_read_at = None
            if not can_share_voice_listened(conn, listener_id=reader_id, viewer_id=user_id):
                voice_listened_by_partner = False
        group_read_payload = {}
        if is_group_chat and is_self:
            read_meta = group_read_map.get(
                msg_id,
                {
                    'read_count': 0,
                    'readers': [],
                    'latest_read_at': None,
                },
            )
            read_count = int(read_meta.get('read_count') or 0)
            group_read_payload = {
                'group_read_count': read_count,
                'group_readers': list(read_meta.get('readers') or []),
            }
            base_is_read = read_count > 0
            base_read_at = read_meta.get('latest_read_at') or None

        messages_list.append(
            {
                'id': msg_id,
                'sender_user_id': msg['sender_id'],
                'sender_public_key': msg['sender_public_key'],
                'sender_display_name': str(msg['sender_display_name'] or ''),
                'sender_username': str(msg['sender_username'] or ''),
                'sender_avatar_url': _safe_sender_avatar_url(conn, row=msg, viewer_id=user_id),
                'message': msg['message'],
                'message_type': msg['message_type'] or 'text',
                'created_at': msg['created_at'],
                'is_read': bool(base_is_read),
                'read_at': base_read_at,
                'is_delivered': bool(msg['is_delivered']),
                'voice_listened_by_partner': voice_listened_by_partner,
                'is_edited': bool(msg['is_edited']),
                'is_self': is_self,
                'reply_to_id': msg['reply_to_id'],
                'reply_message': msg['reply_message'],
                'reply_sender_pub': msg['reply_sender_pub'],
                'forward_from_name': str(msg['forward_from_name'] or '').strip(),
                'forward_from_user_id': int(msg['forward_from_user_id']) if msg['forward_from_user_id'] is not None else None,
                'expires_at': int(msg['expires_at']) if msg['expires_at'] is not None else None,
                'album_id': str(msg['album_id']).strip() if msg['album_id'] else None,
                'reactions': reactions_map.get(msg_id, []),
                'is_favorite': msg_id in favorite_message_ids,
                **group_read_payload,
            }
        )

    pins_data = []
    if include_pins:
        pins = conn.execute(
            '''
            SELECT cp.message_id, cp.message_content, cp.sender_pub, cp.pinned_at, m.created_at
            FROM chat_pins cp
            JOIN messages m ON m.id = cp.message_id
            WHERE cp.chat_id = ?
            ORDER BY m.created_at ASC, cp.message_id ASC
            ''',
            (chat_id,),
        ).fetchall()
        pins_data = [
            {
                'message_id': pin['message_id'],
                'message_content': pin['message_content'],
                'sender_pub': pin['sender_pub'],
                'pinned_at': pin['pinned_at'],
                'created_at': pin['created_at'],
            }
            for pin in pins
        ]
    pin_data = None
    if pins_data:
        first_pin = pins_data[0]
        pin_data = {
            'message_id': first_pin['message_id'],
            'message_content': first_pin['message_content'],
            'sender_pub': first_pin['sender_pub'],
        }

    favorites_data = []
    if include_favorites:
        favorites = conn.execute(
            '''
            SELECT fm.message_id, fm.message_content, fm.sender_pub, fm.favorited_at, m.created_at
            FROM favorite_messages fm
            JOIN messages m ON m.id = fm.message_id
            WHERE fm.user_id = ? AND fm.chat_id = ?
            ORDER BY fm.favorited_at DESC, fm.message_id DESC
            ''',
            (user_id, chat_id),
        ).fetchall()
        favorites_data = [
            {
                'message_id': favorite['message_id'],
                'message_content': favorite['message_content'],
                'sender_pub': favorite['sender_pub'],
                'favorited_at': favorite['favorited_at'],
                'created_at': favorite['created_at'],
            }
            for favorite in favorites
        ]

    has_more_before = False
    if messages_list:
        oldest_loaded_id = messages_list[0]['id']
        if is_group_chat:
            has_more_before = conn.execute(
                '''
                SELECT 1
                FROM messages m
                JOIN message_receipts mr ON mr.message_id = m.id
                WHERE m.chat_id = ?
                  AND mr.user_id = ?
                  AND mr.deleted_for_user = 0
                  AND m.id < ?
                LIMIT 1
                ''',
                (chat_id, user_id, oldest_loaded_id),
            ).fetchone() is not None
        else:
            has_more_before = conn.execute(
                '''
                SELECT 1
                FROM messages m
                WHERE m.chat_id = ?
                  AND ((m.sender_id = ? AND m.deleted_by_sender = 0) OR (m.receiver_id = ? AND m.deleted_by_receiver = 0))
                  AND m.id < ?
                LIMIT 1
                ''',
                (chat_id, user_id, user_id, oldest_loaded_id),
            ).fetchone() is not None

    response_payload = {
        'success': True,
        'messages': messages_list,
        'total_messages': _count_visible_messages(
            conn,
            chat_id=chat_id,
            user_id=user_id,
            is_group_chat=is_group_chat,
        ),
        'pins': pins_data,
        'pin': pin_data,
        'favorites': favorites_data,
        'has_more_before': has_more_before,
        'block_state': block_state,
        'auto_delete_seconds': get_chat_auto_delete(conn, chat_id),
    }
    if after_id is not None:
        response_payload['has_more_after'] = len(messages_list) == limit

    return {'status': 'ok', 'payload': response_payload}


def mark_messages_as_read(  # noqa: PLR0913 - dependency-injected read-marking contract
    conn,
    *,
    user_id: int,
    chat_id: str,
    get_chat_partner_func,
    build_block_state_func,
    serialize_block_state_func,
    socketio_emit_func,
):
    partner = get_chat_partner_func(conn, user_id, chat_id)
    if not partner:
        return {'status': 'forbidden'}
    is_group_chat = get_chat_type(conn, chat_id) == 'group'
    partner_id = partner['contact_id']
    if partner_id is None:
        block_state = {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False}
    else:
        block_state = serialize_block_state_func(build_block_state_func(conn, user_id, partner_id))
    if block_state['is_blocked']:
        return {'status': 'blocked', 'block_state': block_state}

    read_at_row = conn.execute('SELECT CURRENT_TIMESTAMP AS read_at').fetchone()
    read_at_value = read_at_row['read_at'] if read_at_row else None
    affected_message_ids: list[int] = []
    group_read_updates: list[dict] = []
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
    updated_rows = cursor.rowcount
    should_notify_read = can_share_read_receipt(
        conn,
        reader_id=user_id,
        viewer_id=None if is_group_chat else partner_id,
    )
    if updated_rows > 0 and should_notify_read and is_group_chat and affected_message_ids:
        group_read_updates = build_group_read_updates(
            conn,
            chat_id=chat_id,
            message_ids=affected_message_ids,
        )
    conn.commit()

    if updated_rows > 0 and should_notify_read and is_group_chat:
        if group_read_updates:
            socketio_emit_func(
                'group_messages_read',
                {
                    'chat_id': chat_id,
                    'reader_user_id': int(user_id),
                    'updates': group_read_updates,
                },
                room=chat_id,
            )
        socketio_emit_func('messages_read', {'chat_id': chat_id, 'is_group': True}, room=chat_id)
    elif updated_rows > 0 and should_notify_read and partner and partner['public_key']:
        socketio_emit_func('messages_read', {'chat_id': chat_id, 'is_group': False}, room=partner['public_key'])
    return {'status': 'ok'}


def delete_chat_for_user(
    conn,
    *,
    user_id: int,
    chat_id: str,
    mode: str,
    socketio_emit_func,
):
    row = conn.execute(
        'SELECT 1 FROM contacts WHERE user_id = ? AND chat_id = ?',
        (user_id, chat_id),
    ).fetchone()
    if not row:
        row = conn.execute(
            'SELECT 1 FROM chat_members WHERE user_id = ? AND chat_id = ?',
            (user_id, chat_id),
        ).fetchone()
    if not row:
        return {'status': 'forbidden'}
    is_group_chat = get_chat_type(conn, chat_id) == 'group'

    if mode == 'for_both' and not is_group_chat:
        others = conn.execute(
            'SELECT DISTINCT u.public_key FROM users u '
            'JOIN contacts c ON c.user_id = u.id '
            'WHERE c.chat_id = ? AND c.user_id != ?',
            (chat_id, user_id),
        ).fetchall()
        conn.execute('DELETE FROM messages WHERE chat_id = ?', (chat_id,))
        conn.execute('DELETE FROM contacts WHERE chat_id = ?', (chat_id,))
        conn.commit()
        payload = {'chat_id': chat_id}
        socketio_emit_func('chat_deleted', payload, room=chat_id)
        for other in others:
            if other and other['public_key']:
                socketio_emit_func('chat_deleted', payload, room=other['public_key'])
    else:
        if is_group_chat:
            conn.execute(
                '''
                UPDATE message_receipts AS mr
                SET deleted_for_user = 1,
                    updated_at = CURRENT_TIMESTAMP
                FROM messages m
                WHERE mr.message_id = m.id
                  AND m.chat_id = ?
                  AND mr.user_id = ?
                ''',
                (chat_id, user_id),
            )
            conn.execute('DELETE FROM chat_members WHERE user_id = ? AND chat_id = ?', (user_id, chat_id))
        else:
            conn.execute(
                'UPDATE messages SET deleted_by_sender = 1 WHERE chat_id = ? AND sender_id = ?',
                (chat_id, user_id),
            )
            conn.execute(
                'UPDATE messages SET deleted_by_receiver = 1 WHERE chat_id = ? AND receiver_id = ?',
                (chat_id, user_id),
            )
            conn.execute('DELETE FROM contacts WHERE user_id = ? AND chat_id = ?', (user_id, chat_id))
        conn.commit()
        if is_group_chat:
            payload = {'chat_id': chat_id, 'left_user_id': user_id}
            socketio_emit_func('group_members_updated', payload, room=chat_id)
            for member in list_chat_member_public_keys(conn, chat_id):
                member_pub = str(member['public_key'] or '')
                if member_pub:
                    socketio_emit_func('group_members_updated', payload, room=member_pub)

    return {'status': 'ok'}
