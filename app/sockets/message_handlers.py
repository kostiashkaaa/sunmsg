import json
from datetime import datetime, timezone

from app.services.chat_members import (
    get_chat_type,
    get_group_member_role,
    list_chat_member_public_keys,
    list_chat_member_user_ids,
)
from app.services.group_permissions import (
    is_media_message_type,
    load_group_permissions,
    role_uses_member_permissions,
)
from app.services.mentions import (
    extract_mentioned_usernames,
    resolve_group_mentioned_members,
)
from app.services.user import get_safe_avatar_url
from app.sockets.idempotency import (
    mark_request_completed,
    release_request,
    reserve_request,
)


def _extract_group_mention_usernames(raw_message: str, message_type: str) -> list[str]:
    normalized_message_type = str(message_type or '').strip().lower()
    if normalized_message_type in {'text', 'link'}:
        return extract_mentioned_usernames(raw_message)

    if normalized_message_type not in {'photo', 'video', 'audio', 'file'}:
        return []

    try:
        payload = json.loads(str(raw_message or ''))
    except Exception:  # noqa: BLE001
        return []
    if not isinstance(payload, dict) or not payload.get('__sunfile'):
        return []
    return extract_mentioned_usernames(str(payload.get('caption') or ''))


def _parse_utc_timestamp(raw_value: str | None) -> datetime | None:
    value = str(raw_value or '').strip()
    if not value:
        return None
    normalized = value.replace('T', ' ')
    if normalized.endswith('Z'):
        normalized = normalized[:-1]
    for fmt in ('%Y-%m-%d %H:%M:%S.%f', '%Y-%m-%d %H:%M:%S'):
        try:
            return datetime.strptime(normalized, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def handle_edit_message_event(
    data,
    *,
    session_store,
    require_payload_dict_func,
    socket_csrf_ok_func,
    positive_int_func,
    socket_rate_ok_func,
    sanitize_message_type_func,
    is_valid_chat_id_func,
    get_db_connection_func,
    chat_partner_state_func,
    emit_blocked_error_func,
    emit_func,
    parse_db_utc_timestamp_func,
    utc_now_func,
    message_edit_window_seconds: int,
    max_message_edits: int,
    logger,
    normalize_request_id_func=None,
    reserve_socket_request_func=None,
    mark_socket_request_completed_func=None,
    release_socket_request_func=None,
):
    if 'user_id' not in session_store:
        return
    data = require_payload_dict_func(data)
    if data is None:
        return
    if not socket_csrf_ok_func(data):
        return

    msg_id = positive_int_func(data.get('msg_id'))
    new_content = data.get('new_content')
    chat_id = (data.get('chat_id') or '').strip()
    uid = session_store['user_id']

    if not socket_rate_ok_func(uid, 'edit_message'):
        emit_func('error', {'message': 'Too many messages. Please wait a little.'})
        return

    if not msg_id or not new_content or not chat_id:
        return
    if not isinstance(new_content, str):
        emit_func('error', {'message': 'Invalid payload.'})
        return
    new_content = new_content.strip()
    if not new_content:
        emit_func('error', {'message': 'Invalid payload.'})
        return
    if len(new_content) > 64000:
        emit_func('error', {'message': 'Message is too long (max 64000 characters).'})
        return
    if not is_valid_chat_id_func(chat_id):
        emit_func('error', {'message': 'Invalid chat ID.'})
        return
    message_type = sanitize_message_type_func(data.get('message_type', 'text'))
    raw_request_id = data.get('request_id') if isinstance(data, dict) else ''
    request_id = (
        normalize_request_id_func(raw_request_id)
        if callable(normalize_request_id_func)
        else str(raw_request_id or '').strip()
    )

    conn = get_db_connection_func()
    partner, block_state = chat_partner_state_func(conn, uid, chat_id)
    if not partner:
        conn.close()
        return
    if block_state and block_state['is_blocked']:
        conn.close()
        emit_func('chat_block_state', {'chat_id': chat_id, 'partner_user_id': partner['contact_id'], **block_state})
        emit_blocked_error_func('Editing is unavailable because the user is blocked.', block_state)
        return

    chat_type = get_chat_type(conn, chat_id)
    msg = conn.execute(
        '''
        SELECT m.sender_id, m.chat_id, m.created_at, m.edit_count, u.public_key AS receiver_public_key
        FROM messages m
        LEFT JOIN users u ON m.receiver_id = u.id
        WHERE m.id = ?
        ''',
        (msg_id,),
    ).fetchone()

    message_type = sanitize_message_type_func(data.get('message_type', 'text'))

    if msg and str(msg['chat_id'] or '').strip() == chat_id:
        msg_sender_id = positive_int_func(msg['sender_id'])
        current_user_id = positive_int_func(uid)
        if not msg_sender_id or not current_user_id or msg_sender_id != current_user_id:
            conn.close()
            emit_func('error', {'message': 'You can only edit your own messages.'})
            return

        created_at = parse_db_utc_timestamp_func(msg['created_at'])
        if created_at and (utc_now_func() - created_at).total_seconds() > float(message_edit_window_seconds):
            conn.close()
            emit_func('error', {'message': 'Editing window expired for this message.'})
            return

        edit_count = int(msg['edit_count'] or 0)
        if edit_count >= max_message_edits:
            conn.close()
            emit_func('error', {'message': 'Edit limit reached for this message.'})
            return

        reserve_fn = reserve_socket_request_func if callable(reserve_socket_request_func) else reserve_request
        complete_fn = (
            mark_socket_request_completed_func
            if callable(mark_socket_request_completed_func)
            else mark_request_completed
        )
        release_fn = release_socket_request_func if callable(release_socket_request_func) else release_request
        allowed, reservation = reserve_fn(
            user_id=current_user_id,
            event_name='edit_message',
            request_id=request_id,
        )
        if not allowed:
            conn.close()
            emit_func(
                'error',
                {
                    'message': 'Duplicate request ignored.',
                    'code': 'duplicate_request',
                    'request_id': request_id,
                },
            )
            return

        try:
            update_result = conn.execute(
                '''
                UPDATE messages
                SET message = ?, is_edited = 1, message_type = ?, edit_count = COALESCE(edit_count, 0) + 1
                WHERE id = ? AND chat_id = ? AND sender_id = ?
                ''',
                (new_content, message_type, msg_id, chat_id, current_user_id),
            )
            if int(getattr(update_result, 'rowcount', 0) or 0) != 1:
                conn.close()
                release_fn(reservation)
                emit_func('error', {'message': 'You can only edit your own messages.'})
                return
            conn.commit()
        except Exception:
            conn.close()
            release_fn(reservation)
            raise
        conn.close()
        complete_fn(reservation)

        payload = {
            'msg_id': msg_id,
            'new_content': new_content,
            'chat_id': chat_id,
            'message_type': message_type,
            'sender_public_key': session_store.get('public_key_pem', ''),
        }
        if request_id:
            payload['request_id'] = request_id

        sender_room = session_store.get('public_key_pem')
        if sender_room:
            emit_func('message_edited', payload, room=sender_room)
        if chat_type == 'group':
            emit_func('message_edited', payload, room=chat_id)
        elif msg['receiver_public_key'] and msg['receiver_public_key'] != sender_room:
            emit_func('message_edited', payload, room=msg['receiver_public_key'])
    else:
        conn.close()


def handle_delete_messages_event(
    data,
    *,
    session_store,
    require_payload_dict_func,
    socket_csrf_ok_func,
    positive_int_func,
    socket_rate_ok_func,
    is_valid_chat_id_func,
    get_db_connection_func,
    chat_partner_state_func,
    emit_blocked_error_func,
    emit_func,
    logger,
    database_error_cls=None,
    authorize_group_action_func=None,
    normalize_request_id_func=None,
    reserve_socket_request_func=None,
    mark_socket_request_completed_func=None,
    release_socket_request_func=None,
):
    error_cls = database_error_cls or Exception
    if 'user_id' not in session_store or 'public_key_pem' not in session_store:
        return
    data = require_payload_dict_func(data)
    if data is None:
        return
    if not socket_csrf_ok_func(data):
        return

    raw_msg_ids = data.get('msg_ids', [])
    if not isinstance(raw_msg_ids, (list, tuple, set)):
        raw_msg_ids = [raw_msg_ids]
    single_msg_id = positive_int_func(data.get('msg_id'))
    if single_msg_id:
        raw_msg_ids = [*raw_msg_ids, single_msg_id]

    msg_ids = []
    seen_msg_ids = set()
    for raw_msg_id in raw_msg_ids:
        parsed = positive_int_func(raw_msg_id)
        if parsed is None or parsed in seen_msg_ids:
            continue
        seen_msg_ids.add(parsed)
        msg_ids.append(parsed)

    chat_id = (data.get('chat_id') or '').strip()
    mode = data.get('mode', 'for_me')
    if mode not in ('for_both', 'for_me'):
        mode = 'for_me'
    uid = session_store['user_id']
    pub = session_store['public_key_pem']

    if not socket_rate_ok_func(uid, 'delete_messages'):
        emit_func('error', {'message': 'Too many messages. Please wait a little.'})
        return

    if len(msg_ids) > 100:
        emit_func('error', {'message': 'Too many messages selected. Maximum is 100.'})
        return

    if not msg_ids or not chat_id:
        return
    if not is_valid_chat_id_func(chat_id):
        return
    raw_request_id = data.get('request_id') if isinstance(data, dict) else ''
    request_id = (
        normalize_request_id_func(raw_request_id)
        if callable(normalize_request_id_func)
        else str(raw_request_id or '').strip()
    )
    reserve_fn = reserve_socket_request_func if callable(reserve_socket_request_func) else reserve_request
    complete_fn = (
        mark_socket_request_completed_func
        if callable(mark_socket_request_completed_func)
        else mark_request_completed
    )
    release_fn = release_socket_request_func if callable(release_socket_request_func) else release_request
    allowed, reservation = reserve_fn(
        user_id=uid,
        event_name='delete_messages',
        request_id=request_id,
    )
    if not allowed:
        emit_func(
            'error',
            {
                'message': 'Duplicate request ignored.',
                'code': 'duplicate_request',
                'request_id': request_id,
            },
        )
        return

    conn = get_db_connection_func()
    try:
        partner, block_state = chat_partner_state_func(conn, uid, chat_id)
        if not partner:
            release_fn(reservation)
            return
        if block_state and block_state['is_blocked']:
            emit_func('chat_block_state', {'chat_id': chat_id, 'partner_user_id': partner['contact_id'], **block_state})
            emit_blocked_error_func('Deletion is unavailable because the user is blocked.', block_state)
            release_fn(reservation)
            return

        placeholders = ', '.join('?' * len(msg_ids))
        chat_type = get_chat_type(conn, chat_id)
        can_delete_any_group_message = False
        if chat_type == 'group' and callable(authorize_group_action_func):
            try:
                can_delete_any_group_message = bool(
                    authorize_group_action_func(conn, uid, chat_id, 'delete_messages')
                )
            except Exception:  # noqa: BLE001
                can_delete_any_group_message = False
        if chat_type == 'group':
            rows = conn.execute(
                f'''
                SELECT m.id, m.sender_id, m.receiver_id
                FROM messages m
                JOIN message_receipts mr ON mr.message_id = m.id
                WHERE m.id IN ({placeholders})
                  AND m.chat_id = ?
                  AND mr.user_id = ?
                  AND mr.deleted_for_user = 0
                ''',
                (*msg_ids, chat_id, uid),
            ).fetchall()
        else:
            rows = conn.execute(
                f'SELECT id, sender_id, receiver_id FROM messages'
                f' WHERE id IN ({placeholders}) AND chat_id = ? AND (sender_id = ? OR receiver_id = ?)',
                (*msg_ids, chat_id, uid, uid),
            ).fetchall()

        deleted_ids = []
        for_both_delete_ids = []
        for_me_sender_ids = []
        for_me_receiver_ids = []

        for msg in rows:
            msg_id = msg['id']
            if mode == 'for_both':
                if msg['sender_id'] == uid or (chat_type == 'group' and can_delete_any_group_message):
                    for_both_delete_ids.append(msg_id)
                    deleted_ids.append(msg_id)
            elif mode == 'for_me':
                if msg['sender_id'] == uid:
                    for_me_sender_ids.append(msg_id)
                else:
                    for_me_receiver_ids.append(msg_id)
                deleted_ids.append(msg_id)

        if for_both_delete_ids:
            ph = ', '.join('?' * len(for_both_delete_ids))
            conn.execute(f'DELETE FROM messages WHERE id IN ({ph})', for_both_delete_ids)
        if chat_type == 'group':
            for_me_ids = sorted({*for_me_sender_ids, *for_me_receiver_ids})
            if for_me_ids:
                ph = ', '.join('?' * len(for_me_ids))
                conn.execute(
                    f'''
                    UPDATE message_receipts
                    SET deleted_for_user = 1,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE user_id = ?
                      AND message_id IN ({ph})
                    ''',
                    (uid, *for_me_ids),
                )
        else:
            if for_me_sender_ids:
                ph = ', '.join('?' * len(for_me_sender_ids))
                conn.execute(f'UPDATE messages SET deleted_by_sender = 1 WHERE id IN ({ph})', for_me_sender_ids)
            if for_me_receiver_ids:
                ph = ', '.join('?' * len(for_me_receiver_ids))
                conn.execute(f'UPDATE messages SET deleted_by_receiver = 1 WHERE id IN ({ph})', for_me_receiver_ids)

        conn.commit()
        if deleted_ids:
            payload = {'msg_ids': deleted_ids, 'chat_id': chat_id, 'mode': mode}
            if request_id:
                payload['request_id'] = request_id
            if mode == 'for_both':
                emit_func('messages_deleted', payload, room=chat_id)
                emit_func('messages_deleted', payload, room=pub)
                if partner and partner['public_key']:
                    emit_func('messages_deleted', payload, room=partner['public_key'])
            else:
                emit_func('messages_deleted', payload, room=pub)
                if chat_type == 'group':
                    emit_func('messages_deleted', payload, room=chat_id)
        complete_fn(reservation)
    except error_cls as exc:
        release_fn(reservation)
        logger.error('Error deleting messages: %s', exc)
    finally:
        conn.close()


def handle_send_message_event(
    data,
    *,
    session_store,
    require_payload_dict_func,
    socket_csrf_ok_func,
    socket_rate_ok_func,
    is_valid_chat_id_func,
    get_db_connection_func,
    count_connected_func,
    build_block_state_func,
    normalize_block_state_func,
    sanitize_message_type_func,
    positive_int_func,
    ensure_chat_exists_func,
    looks_like_ciphertext_func,
    emit_blocked_error_func,
    emit_func,
    utc_now_text_func,
    logger,
    database_error_cls=None,
    send_web_push_notification_func=None,
    moderation_user_restriction_func=None,
    moderation_public_link_check_func=None,
    group_restriction_lookup_func=None,
    normalize_request_id_func=None,
    reserve_socket_request_func=None,
    mark_socket_request_completed_func=None,
    release_socket_request_func=None,
):
    error_cls = database_error_cls or Exception
    if 'user_id' not in session_store or 'public_key_pem' not in session_store:
        return
    data = require_payload_dict_func(data)
    if data is None:
        return
    if not socket_csrf_ok_func(data):
        return

    sender_id = session_store['user_id']
    sender_pub = session_store['public_key_pem']
    message = (data.get('message') or '').strip()
    chat_id = (data.get('chat_id') or '').strip()
    message_type = sanitize_message_type_func(data.get('message_type', 'text'))

    if not socket_rate_ok_func(sender_id, 'send_message'):
        emit_func('error', {'message': 'Too many messages. Please wait a little.'})
        return

    if not message or not chat_id:
        emit_func('error', {'message': 'Invalid payload.'})
        return
    if len(message) > 64000:
        emit_func('error', {'message': 'Message is too long (max 64000 characters).'})
        return
    if not is_valid_chat_id_func(chat_id):
        emit_func('error', {'message': 'Invalid chat ID.'})
        return
    raw_request_id = data.get('request_id') if isinstance(data, dict) else ''
    request_id = (
        normalize_request_id_func(raw_request_id)
        if callable(normalize_request_id_func)
        else str(raw_request_id or '').strip()
    )
    conn = get_db_connection_func()
    if callable(moderation_user_restriction_func):
        restriction = moderation_user_restriction_func(conn, user_id=sender_id)
        if restriction:
            emit_func(
                'error',
                {
                    'message': 'Messaging is temporarily restricted by moderation.',
                    'code': 'moderation_restriction',
                    'restriction': restriction,
                },
            )
            conn.close()
            return

    if callable(moderation_public_link_check_func):
        link_check = moderation_public_link_check_func(message)
        if link_check and bool(link_check.get('blocked')):
            emit_func(
                'error',
                {
                    'message': 'This public link is blocked by moderation policy.',
                    'code': 'blocked_public_link',
                    'reason': str(link_check.get('reason') or 'blocked_public_link'),
                    'domain': str(link_check.get('domain') or ''),
                },
            )
            conn.close()
            return

    chat_type = get_chat_type(conn, chat_id)
    contact = conn.execute(
        '''
        SELECT c.contact_id, u.public_key
        FROM contacts c
        JOIN users u ON c.contact_id = u.id
        WHERE c.user_id = ? AND c.chat_id = ?
        ''',
        (sender_id, chat_id),
    ).fetchone()

    if chat_type != 'group' and not contact:
        conn.close()
        emit_func('error', {'message': 'You are not a member of this chat.'})
        return
    if chat_type == 'group':
        membership_row = conn.execute(
            '''
            SELECT 1
            FROM chat_members
            WHERE user_id = ? AND chat_id = ?
            LIMIT 1
            ''',
            (sender_id, chat_id),
        ).fetchone()
        if not membership_row:
            conn.close()
            emit_func('error', {'message': 'You are not a member of this chat.'})
            return
        if callable(group_restriction_lookup_func):
            try:
                group_restriction = group_restriction_lookup_func(
                    conn,
                    chat_id=chat_id,
                    user_id=sender_id,
                )
            except Exception:
                group_restriction = None
            if group_restriction:
                restriction_type = str(group_restriction.get('action_type') or '').strip().lower()
                if restriction_type in {'mute_temp', 'ban_temp', 'ban_perma'}:
                    emit_func(
                        'error',
                        {
                            'message': 'Messaging is restricted in this group by moderation.',
                            'code': 'group_moderation_restriction',
                            'restriction': group_restriction,
                        },
                    )
                    conn.close()
                    return
        group_permissions = load_group_permissions(conn, chat_id=chat_id)
        sender_role = get_group_member_role(conn, sender_id, chat_id)
        if role_uses_member_permissions(sender_role):
            if not bool(group_permissions.get('members_can_send_messages')):
                conn.close()
                emit_func(
                    'error',
                    {
                        'message': 'Participants cannot send messages in this group.',
                        'code': 'group_permissions_messages_disabled',
                    },
                )
                return
            if is_media_message_type(message_type) and not bool(group_permissions.get('members_can_send_media')):
                conn.close()
                emit_func(
                    'error',
                    {
                        'message': 'Participants cannot send media in this group.',
                        'code': 'group_permissions_media_disabled',
                    },
                )
                return

            slow_mode_seconds = int(group_permissions.get('slow_mode_seconds') or 0)
            if slow_mode_seconds > 0:
                last_message_row = conn.execute(
                    '''
                    SELECT created_at
                    FROM messages
                    WHERE chat_id = ? AND sender_id = ?
                    ORDER BY id DESC
                    LIMIT 1
                    ''',
                    (chat_id, sender_id),
                ).fetchone()
                last_message_ts = _parse_utc_timestamp(last_message_row['created_at'] if last_message_row else '')
                now_ts = _parse_utc_timestamp(utc_now_text_func())
                if last_message_ts and now_ts:
                    elapsed_seconds = max(0, int((now_ts - last_message_ts).total_seconds()))
                    if elapsed_seconds < slow_mode_seconds:
                        remaining_seconds = slow_mode_seconds - elapsed_seconds
                        conn.close()
                        emit_func(
                            'error',
                            {
                                'message': 'Slow mode is enabled. Please wait before sending another message.',
                                'code': 'group_permissions_slow_mode',
                                'retry_after_seconds': remaining_seconds,
                            },
                        )
                        return

    receiver_id = contact['contact_id'] if contact else None
    receiver_pub = contact['public_key'] if contact else ''
    receiver_is_connected = count_connected_func(receiver_pub) > 0 if receiver_pub else False
    if chat_type != 'group':
        block_state = normalize_block_state_func(build_block_state_func(conn, sender_id, receiver_id))
        if block_state['is_blocked']:
            emit_func('chat_block_state', {'chat_id': chat_id, 'partner_user_id': receiver_id, **block_state})
            emit_blocked_error_func('Messaging is unavailable because the user is blocked.', block_state)
            conn.close()
            return

    reply_to_id = positive_int_func(data.get('reply_to_id'))
    raw_forward_from_name = str(data.get('forward_from_name') or '').strip()
    forward_from_name = raw_forward_from_name[:140] if raw_forward_from_name else None
    forward_from_user_id = positive_int_func(data.get('forward_from_user_id'))
    group_member_public_keys = []
    mentioned_members: list[dict] = []
    mentioned_user_ids: list[int] = []
    mentioned_usernames: list[str] = []
    group_chat_display_name = ''
    if chat_type == 'group':
        raw_mentioned_usernames = _extract_group_mention_usernames(message, message_type)
        if raw_mentioned_usernames:
            mentioned_members = resolve_group_mentioned_members(
                conn,
                chat_id=chat_id,
                mentioned_usernames=raw_mentioned_usernames,
                exclude_user_id=sender_id,
            )
            mentioned_user_ids = [int(member['user_id']) for member in mentioned_members]
            mentioned_usernames = [
                str(member.get('username') or '').strip()
                for member in mentioned_members
                if str(member.get('username') or '').strip()
            ]
            if mentioned_members:
                try:
                    chat_name_row = conn.execute(
                        '''
                        SELECT chat_name
                        FROM chats
                        WHERE chat_id = ?
                        LIMIT 1
                        ''',
                        (chat_id,),
                    ).fetchone()
                except Exception:  # noqa: BLE001
                    try:
                        conn.rollback()
                    except Exception:  # noqa: BLE001
                        pass
                    chat_name_row = None
                group_chat_display_name = str(chat_name_row['chat_name'] or '').strip() if chat_name_row else ''
    sender_display_name = str(session_store.get('display_name') or session_store.get('username') or '').strip()
    sender_username = str(session_store.get('username') or '').strip()
    sender_avatar_url = ''
    reserve_fn = reserve_socket_request_func if callable(reserve_socket_request_func) else reserve_request
    complete_fn = (
        mark_socket_request_completed_func
        if callable(mark_socket_request_completed_func)
        else mark_request_completed
    )
    release_fn = release_socket_request_func if callable(release_socket_request_func) else release_request
    allowed, reservation = reserve_fn(
        user_id=sender_id,
        event_name='send_message',
        request_id=request_id,
    )
    if not allowed:
        conn.close()
        emit_func(
            'error',
            {
                'message': 'Duplicate request ignored.',
                'code': 'duplicate_request',
                'request_id': request_id,
            },
        )
        return

    try:
        ensure_chat_exists_func(conn, chat_id)
        message_columns = set()
        try:
            probe_cursor = conn.execute('SELECT * FROM messages LIMIT 0')
            message_columns = {
                str(column[0]).strip()
                for column in (probe_cursor.description or [])
                if column and column[0]
            }
        except Exception:
            message_columns = set()
        supports_forward_metadata = (
            'forward_from_name' in message_columns
            and 'forward_from_user_id' in message_columns
        )
        if chat_type != 'group':
            conn.execute(
                '''
                INSERT INTO contacts (user_id, contact_id, chat_id)
                SELECT ?, ?, ?
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM contacts
                    WHERE user_id = ? AND contact_id = ?
                )
                ''',
                (sender_id, receiver_id, chat_id, sender_id, receiver_id),
            )
            conn.execute(
                '''
                INSERT INTO contacts (user_id, contact_id, chat_id)
                SELECT ?, ?, ?
                WHERE NOT EXISTS (
                    SELECT 1
                    FROM contacts
                    WHERE user_id = ? AND contact_id = ?
                )
                ''',
                (receiver_id, sender_id, chat_id, receiver_id, sender_id),
            )
            conn.execute(
                'UPDATE contacts SET chat_id = ? WHERE user_id = ? AND contact_id = ?',
                (chat_id, sender_id, receiver_id),
            )
            conn.execute(
                'UPDATE contacts SET chat_id = ? WHERE user_id = ? AND contact_id = ?',
                (chat_id, receiver_id, sender_id),
            )

        if reply_to_id is not None:
            reply_exists = conn.execute(
                'SELECT 1 FROM messages WHERE id = ? AND chat_id = ?',
                (reply_to_id, chat_id),
            ).fetchone()
            if not reply_exists:
                reply_to_id = None

        if supports_forward_metadata:
            if chat_type == 'group':
                cur = conn.execute(
                    '''
                    INSERT INTO messages (
                        chat_id,
                        sender_id,
                        receiver_id,
                        message,
                        message_type,
                        reply_to_id,
                        forward_from_name,
                        forward_from_user_id,
                        is_delivered
                    )
                    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, 1)
                    RETURNING id, created_at
                    ''',
                    (
                        chat_id,
                        sender_id,
                        message,
                        message_type,
                        reply_to_id,
                        forward_from_name,
                        forward_from_user_id,
                    ),
                )
            else:
                cur = conn.execute(
                    '''
                    INSERT INTO messages (
                        chat_id,
                        sender_id,
                        receiver_id,
                        message,
                        message_type,
                        reply_to_id,
                        forward_from_name,
                        forward_from_user_id,
                        is_delivered
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    RETURNING id, created_at
                    ''',
                    (
                        chat_id,
                        sender_id,
                        receiver_id,
                        message,
                        message_type,
                        reply_to_id,
                        forward_from_name,
                        forward_from_user_id,
                        int(receiver_is_connected),
                    ),
                )
        else:
            if chat_type == 'group':
                cur = conn.execute(
                    '''
                    INSERT INTO messages (chat_id, sender_id, receiver_id, message, message_type, reply_to_id, is_delivered)
                    VALUES (?, ?, NULL, ?, ?, ?, 1)
                    RETURNING id, created_at
                    ''',
                    (chat_id, sender_id, message, message_type, reply_to_id),
                )
            else:
                cur = conn.execute(
                    '''
                    INSERT INTO messages (chat_id, sender_id, receiver_id, message, message_type, reply_to_id, is_delivered)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    RETURNING id, created_at
                    ''',
                    (chat_id, sender_id, receiver_id, message, message_type, reply_to_id, int(receiver_is_connected)),
                )
        inserted_row = cur.fetchone()
        msg_id = inserted_row['id'] if inserted_row else None
        if msg_id is None:
            raise error_cls('Failed to resolve inserted message id')
        message_created_at = inserted_row['created_at'] if inserted_row else None

        if chat_type == 'group':
            member_ids = list_chat_member_user_ids(conn, chat_id)
            for member_id in member_ids:
                is_self = int(member_id) == int(sender_id)
                delivered = bool(is_self)
                read = bool(is_self)
                conn.execute(
                    '''
                    INSERT INTO message_receipts (
                        message_id,
                        user_id,
                        is_delivered,
                        delivered_at,
                        is_read,
                        read_at,
                        voice_listened,
                        deleted_for_user,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, 0, 0, CURRENT_TIMESTAMP)
                    ''',
                    (
                        msg_id,
                        member_id,
                        int(delivered),
                        (message_created_at if delivered else None),
                        int(read),
                        (message_created_at if read else None),
                    ),
                )
            group_member_public_keys = list_chat_member_public_keys(conn, chat_id, exclude_user_id=sender_id)
        conn.commit()

        reply_message = None
        reply_sender_pub = None
        if reply_to_id is not None:
            rm = conn.execute(
                'SELECT m.message, u.public_key FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ? AND m.chat_id = ?',
                (reply_to_id, chat_id),
            ).fetchone()
            if rm:
                raw = rm['message']
                if looks_like_ciphertext_func(raw):
                    reply_message = raw
                else:
                    logger.warning('reply_to_id=%s has non-ciphertext content; dropping reply preview', reply_to_id)
                    reply_to_id = None
                reply_sender_pub = rm['public_key']

        # Resolve sender identity from DB (source of truth) to avoid stale/empty session labels.
        try:
            sender_row = conn.execute(
                '''
                SELECT id, display_name, username, avatar_url, avatar_visibility
                FROM users
                WHERE id = ?
                ''',
                (sender_id,),
            ).fetchone()
        except Exception:
            sender_row = None

        if sender_row:
            if not sender_display_name:
                sender_display_name = str(sender_row['display_name'] or sender_row['username'] or '').strip()
            if not sender_username:
                sender_username = str(sender_row['username'] or '').strip()
            try:
                sender_avatar_url = str(get_safe_avatar_url(sender_row, sender_id) or '').strip()
            except Exception:
                sender_avatar_url = str(sender_row.get('avatar_url') or '').strip() if hasattr(sender_row, 'get') else ''
    except error_cls as exc:
        release_fn(reservation)
        logger.error('Error saving message: %s', exc)
        emit_func('error', {'message': 'Failed to save message.'})
        return
    finally:
        conn.close()
    complete_fn(reservation)

    payload = {
        'id': msg_id,
        'chat_id': chat_id,
        'sender_user_id': sender_id,
        'sender_public_key': sender_pub,
        'sender_display_name': sender_display_name,
        'sender_username': sender_username,
        'sender_avatar_url': sender_avatar_url,
        'message': message,
        'is_read': False,
        'is_delivered': bool(receiver_is_connected) if chat_type != 'group' else True,
        'voice_listened_by_partner': False,
        'created_at': message_created_at or utc_now_text_func(),
        'client_id': data.get('client_id'),
        'request_id': request_id,
        'reply_to_id': reply_to_id,
        'reply_message': reply_message,
        'reply_sender_pub': reply_sender_pub,
        'forward_from_name': forward_from_name,
        'forward_from_user_id': forward_from_user_id,
        'reactions': [],
    }
    if chat_type == 'group':
        payload['group_read_count'] = 0
        payload['group_readers'] = []
        payload['mentioned_user_ids'] = mentioned_user_ids
        payload['mentioned_usernames'] = mentioned_usernames

    if chat_type == 'group':
        emit_func('receive_message', payload, room=chat_id)
        emit_func('receive_message', payload, room=sender_pub)
        emit_func('message_sent', payload, room=sender_pub)
        for member in group_member_public_keys:
            member_pub = str(member['public_key'] or '')
            if member_pub:
                emit_func('receive_message', payload, room=member_pub)
        if mentioned_members and callable(send_web_push_notification_func):
            for member in mentioned_members:
                member_user_id = int(member['user_id'])
                member_public_key = str(member.get('public_key') or '').strip()
                if member_user_id <= 0:
                    continue
                if member_public_key and count_connected_func(member_public_key) > 0:
                    continue
                try:
                    send_web_push_notification_func(
                        receiver_user_id=member_user_id,
                        sender_user_id=sender_id,
                        sender_display_name=sender_display_name,
                        sender_username=sender_username,
                        chat_id=chat_id,
                        message_type=message_type,
                        notification_type='mention',
                        chat_display_name=group_chat_display_name,
                    )
                except Exception:  # noqa: BLE001
                    logger.warning('Web push mention notification send failed for receiver_id=%s', member_user_id)
    else:
        emit_func('receive_message', payload, room=receiver_pub)
        emit_func('receive_message', payload, room=sender_pub)
        emit_func('message_sent', payload, room=sender_pub)

        if not receiver_is_connected and callable(send_web_push_notification_func):
            try:
                push_payload = {
                    'receiver_user_id': receiver_id,
                    'sender_user_id': sender_id,
                    'sender_display_name': sender_display_name,
                    'sender_username': sender_username,
                    'chat_id': chat_id,
                }
                if message_type != 'text':
                    push_payload['message_type'] = message_type
                send_web_push_notification_func(
                    **push_payload,
                )
            except Exception:  # noqa: BLE001
                logger.warning('Web push notification send failed for receiver_id=%s', receiver_id)
