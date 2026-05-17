import base64
import json
from datetime import datetime, timezone

from app.services.disappearing_messages import apply_expiry_to_new_message as _apply_message_expiry
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
from app.services.user_privacy import can_link_forward_author, can_send_direct_message
from app.sockets.idempotency import (
    mark_request_completed,
    release_request,
    reserve_request,
)


def _resolve_socket_request_handlers(
    *,
    reserve_socket_request_func=None,
    mark_socket_request_completed_func=None,
    release_socket_request_func=None,
):
    reserve_fn = reserve_socket_request_func if callable(reserve_socket_request_func) else reserve_request
    complete_fn = (
        mark_socket_request_completed_func
        if callable(mark_socket_request_completed_func)
        else mark_request_completed
    )
    release_fn = release_socket_request_func if callable(release_socket_request_func) else release_request
    return reserve_fn, complete_fn, release_fn


def _reserve_socket_request_or_emit_duplicate(
    *,
    reserve_fn,
    emit_func,
    user_id: int,
    event_name: str,
    request_id: str,
):
    allowed, reservation = reserve_fn(
        user_id=user_id,
        event_name=event_name,
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
        return False, None
    return True, reservation


def _normalize_socket_request_id(data, normalize_request_id_func=None) -> str:
    raw_request_id = data.get('request_id') if isinstance(data, dict) else ''
    if callable(normalize_request_id_func):
        return normalize_request_id_func(raw_request_id)
    return str(raw_request_id or '').strip()


def _send_error_payload(message: str, *, request_id: str | None = None, **extra) -> dict:
    payload = {'message': message}
    normalized_request_id = str(request_id or '').strip()
    if normalized_request_id:
        payload['request_id'] = normalized_request_id
    payload.update(extra)
    return payload


def _emit_send_error(emit_func, message: str, *, request_id: str | None = None, **extra) -> None:
    emit_func('error', _send_error_payload(message, request_id=request_id, **extra))


def _emit_moderation_restriction_error(emit_func, restriction: dict, *, request_id: str | None = None) -> None:
    _emit_send_error(
        emit_func,
        'Messaging is temporarily restricted by moderation.',
        request_id=request_id,
        code='moderation_restriction',
        restriction=restriction,
    )


def _non_empty_string(value) -> bool:
    return isinstance(value, str) and bool(value.strip())


def _base64_decoded_length_at_least(value, minimum_bytes: int) -> bool:
    if not _non_empty_string(value):
        return False
    normalized = str(value).strip()
    normalized += '=' * ((4 - (len(normalized) % 4)) % 4)
    try:
        decoded = base64.b64decode(normalized, altchars=b'-_', validate=True)
    except (ValueError, TypeError):
        return False
    return len(decoded) >= int(minimum_bytes)


def _load_e2ee_message_payload(raw_message: str) -> dict | None:
    try:
        payload = json.loads(str(raw_message or '').strip())
    except (TypeError, ValueError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _has_e2ee_key_envelope(payload: dict, chat_type: str) -> bool:
    encrypted_keys = payload.get('encrypted_keys')
    has_multi_recipient_keys = (
        isinstance(encrypted_keys, list)
        and any(_base64_decoded_length_at_least(item, 128) for item in encrypted_keys)
    )
    if str(chat_type or '') == 'group':
        return has_multi_recipient_keys
    return (
        has_multi_recipient_keys
        or (
            _base64_decoded_length_at_least(payload.get('encrypted_key_receiver'), 128)
            and _base64_decoded_length_at_least(payload.get('encrypted_key_sender'), 128)
        )
    )


def _is_valid_e2ee_message_payload(raw_message: str, *, chat_type: str) -> bool:
    payload = _load_e2ee_message_payload(raw_message)
    if not payload:
        return False
    if not _base64_decoded_length_at_least(payload.get('encrypted_message'), 16):
        return False
    if not _base64_decoded_length_at_least(payload.get('iv'), 12):
        return False
    if not _base64_decoded_length_at_least(payload.get('signature'), 128):
        return False
    return _has_e2ee_key_envelope(payload, chat_type)


def _emit_e2ee_required_error(emit_func, *, request_id: str = '') -> None:
    _emit_send_error(
        emit_func,
        'Encrypted message payload is required.',
        request_id=request_id,
        code='e2ee_payload_required',
    )


def _resolve_message_table_columns(conn) -> set[str]:
    try:
        probe_cursor = conn.execute('SELECT * FROM messages LIMIT 0')
    except Exception:
        return set()
    description = getattr(probe_cursor, 'description', None) or ()
    column_names = set()
    for column in description:
        name = getattr(column, 'name', None)
        if name is None:
            try:
                name = column[0]
            except (IndexError, TypeError):
                name = None
        if name:
            column_names.add(str(name).strip())
    return column_names


def _resolve_message_table_capabilities(conn) -> dict[str, bool]:
    message_columns = _resolve_message_table_columns(conn)
    return {
        'supports_forward_metadata': (
            'forward_from_name' in message_columns
            and 'forward_from_user_id' in message_columns
        ),
        'supports_album_metadata': 'album_id' in message_columns,
    }


def _supports_forward_metadata(conn) -> bool:
    return _resolve_message_table_capabilities(conn)['supports_forward_metadata']


def _sync_direct_contact_chat(conn, *, sender_id: int, receiver_id: int, chat_id: str) -> None:
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


def _resolve_group_mentions_context(
    conn,
    *,
    chat_id: str,
    sender_id: int,
    message: str,
    message_type: str,
    mentioned_usernames=None,
) -> tuple[list[dict], list[int], list[str], str]:
    raw_mentioned_usernames = (
        _normalize_group_mentioned_usernames(mentioned_usernames)
        or _extract_group_mention_usernames(message, message_type)
    )
    if not raw_mentioned_usernames:
        return [], [], [], ''

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
    if not mentioned_members:
        return mentioned_members, mentioned_user_ids, mentioned_usernames, ''

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
    return mentioned_members, mentioned_user_ids, mentioned_usernames, group_chat_display_name


def _normalize_group_mentioned_usernames(raw_value) -> list[str]:
    if not isinstance(raw_value, list):
        return []
    normalized: list[str] = []
    seen = set()
    for item in raw_value[:32]:
        username = str(item or '').strip().lstrip('@').lower()
        if not username or username in seen:
            continue
        seen.add(username)
        normalized.append(username)
    return normalized


def _resolve_group_restriction(
    conn,
    *,
    chat_id: str,
    sender_id: int,
    group_restriction_lookup_func=None,
):
    if not callable(group_restriction_lookup_func):
        return None
    try:
        return group_restriction_lookup_func(
            conn,
            chat_id=chat_id,
            user_id=sender_id,
        )
    except Exception:
        return None


def _resolve_group_slow_mode_retry_after(
    conn,
    *,
    chat_id: str,
    sender_id: int,
    utc_now_text_func=None,
) -> int | None:
    if not callable(utc_now_text_func):
        return None
    group_permissions = load_group_permissions(conn, chat_id=chat_id)
    slow_mode_seconds = int(group_permissions.get('slow_mode_seconds') or 0)
    if slow_mode_seconds <= 0:
        return None

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
    if not last_message_ts or not now_ts:
        return None

    elapsed_seconds = max(0, int((now_ts - last_message_ts).total_seconds()))
    if elapsed_seconds >= slow_mode_seconds:
        return None
    return slow_mode_seconds - elapsed_seconds


def _is_group_send_allowed(
    conn,
    *,
    sender_id: int,
    chat_id: str,
    emit_func,
    context: dict | None = None,
) -> bool:
    message_context = context or {}
    message_type = str(message_context.get('message_type') or 'text')
    group_restriction_lookup_func = message_context.get('group_restriction_lookup_func')
    utc_now_text_func = message_context.get('utc_now_text_func')
    request_id = str(message_context.get('request_id') or '').strip()

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
        _emit_send_error(emit_func, 'You are not a member of this chat.', request_id=request_id)
        return False

    group_restriction = _resolve_group_restriction(
        conn,
        chat_id=chat_id,
        sender_id=sender_id,
        group_restriction_lookup_func=group_restriction_lookup_func,
    )
    if group_restriction:
        restriction_type = str(group_restriction.get('action_type') or '').strip().lower()
        if restriction_type in {'mute_temp', 'ban_temp', 'ban_perma'}:
            _emit_send_error(
                emit_func,
                'Messaging is restricted in this group by moderation.',
                request_id=request_id,
                code='group_moderation_restriction',
                restriction=group_restriction,
            )
            return False

    group_permissions = load_group_permissions(conn, chat_id=chat_id)
    sender_role = get_group_member_role(conn, sender_id, chat_id)
    if not role_uses_member_permissions(sender_role):
        return True

    if not bool(group_permissions.get('members_can_send_messages')):
        _emit_send_error(
            emit_func,
            'Participants cannot send messages in this group.',
            request_id=request_id,
            code='group_permissions_messages_disabled',
        )
        return False
    if is_media_message_type(message_type) and not bool(group_permissions.get('members_can_send_media')):
        _emit_send_error(
            emit_func,
            'Participants cannot send media in this group.',
            request_id=request_id,
            code='group_permissions_media_disabled',
        )
        return False

    remaining_seconds = _resolve_group_slow_mode_retry_after(
        conn,
        chat_id=chat_id,
        sender_id=sender_id,
        utc_now_text_func=utc_now_text_func,
    )
    if remaining_seconds is None:
        return True
    _emit_send_error(
        emit_func,
        'Slow mode is enabled. Please wait before sending another message.',
        request_id=request_id,
        code='group_permissions_slow_mode',
        retry_after_seconds=remaining_seconds,
    )
    return False


def _validate_send_payload(data, *, context: dict | None = None) -> dict | None:
    send_context = context or {}
    session_store = send_context.get('session_store') or {}
    socket_rate_ok_func = send_context.get('socket_rate_ok_func')
    is_valid_chat_id_func = send_context.get('is_valid_chat_id_func')
    sanitize_message_type_func = send_context.get('sanitize_message_type_func')
    emit_func = send_context.get('emit_func')
    request_id = str(send_context.get('request_id') or '').strip()

    sender_id = session_store['user_id']
    sender_pub = session_store['public_key_pem']
    message = str(data.get('message') or '').strip()
    chat_id = str(data.get('chat_id') or '').strip()
    message_type = sanitize_message_type_func(data.get('message_type', 'text'))

    if not socket_rate_ok_func(sender_id, 'send_message'):
        _emit_send_error(emit_func, 'Too many messages. Please wait a little.', request_id=request_id)
        return None
    if not message or not chat_id:
        _emit_send_error(emit_func, 'Invalid payload.', request_id=request_id)
        return None
    if len(message) > 64000:
        _emit_send_error(emit_func, 'Message is too long (max 64000 characters).', request_id=request_id)
        return None
    if not is_valid_chat_id_func(chat_id):
        _emit_send_error(emit_func, 'Invalid chat ID.', request_id=request_id)
        return None

    return {
        'sender_id': sender_id,
        'sender_pub': sender_pub,
        'message': message,
        'chat_id': chat_id,
        'message_type': message_type,
    }


def _passes_send_moderation_checks(conn, *, context: dict | None = None) -> bool:
    send_context = context or {}
    moderation_user_restriction_func = send_context.get('moderation_user_restriction_func')
    moderation_public_link_check_func = send_context.get('moderation_public_link_check_func')
    sender_id = int(send_context.get('sender_id') or 0)
    message = str(send_context.get('message') or '')
    emit_func = send_context.get('emit_func')
    request_id = str(send_context.get('request_id') or '').strip()

    if callable(moderation_user_restriction_func):
        restriction = moderation_user_restriction_func(conn, user_id=sender_id)
        if restriction:
            _emit_moderation_restriction_error(emit_func, restriction, request_id=request_id)
            return False

    if callable(moderation_public_link_check_func):
        link_check = moderation_public_link_check_func(message)
        if link_check and bool(link_check.get('blocked')):
            _emit_send_error(
                emit_func,
                'This public link is blocked by moderation policy.',
                request_id=request_id,
                code='blocked_public_link',
                reason=str(link_check.get('reason') or 'blocked_public_link'),
                domain=str(link_check.get('domain') or ''),
            )
            return False

    return True


def _resolve_send_delivery_context(conn, *, context: dict | None = None) -> dict | None:
    send_context = context or {}
    sender_id = int(send_context.get('sender_id') or 0)
    chat_id = str(send_context.get('chat_id') or '')
    message_type = str(send_context.get('message_type') or 'text')
    group_restriction_lookup_func = send_context.get('group_restriction_lookup_func')
    utc_now_text_func = send_context.get('utc_now_text_func')
    count_connected_func = send_context.get('count_connected_func')
    build_block_state_func = send_context.get('build_block_state_func')
    normalize_block_state_func = send_context.get('normalize_block_state_func')
    emit_blocked_error_func = send_context.get('emit_blocked_error_func')
    emit_func = send_context.get('emit_func')
    request_id = str(send_context.get('request_id') or '').strip()

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
        _emit_send_error(emit_func, 'You are not a member of this chat.', request_id=request_id)
        return None
    if chat_type == 'group':
        if not _is_group_send_allowed(
            conn,
            sender_id=sender_id,
            chat_id=chat_id,
            emit_func=emit_func,
            context={
                'message_type': message_type,
                'group_restriction_lookup_func': group_restriction_lookup_func,
                'utc_now_text_func': utc_now_text_func,
                'request_id': request_id,
            },
        ):
            return None

    receiver_id = contact['contact_id'] if contact else None
    receiver_pub = contact['public_key'] if contact else ''
    receiver_is_connected = count_connected_func(receiver_pub) > 0 if receiver_pub else False
    if chat_type != 'group':
        block_state = normalize_block_state_func(build_block_state_func(conn, sender_id, receiver_id))
        if block_state['is_blocked']:
            emit_func('chat_block_state', {'chat_id': chat_id, 'partner_user_id': receiver_id, **block_state})
            try:
                emit_blocked_error_func(
                    'Messaging is unavailable because the user is blocked.',
                    block_state,
                    request_id=request_id,
                )
            except TypeError:
                emit_blocked_error_func('Messaging is unavailable because the user is blocked.', block_state)
            return None
        if not can_send_direct_message(
            conn,
            receiver_id=receiver_id,
            sender_id=sender_id,
            message_type=message_type,
        ):
            _emit_send_error(
                emit_func,
                'This user does not allow this message type.',
                request_id=request_id,
                code='recipient_privacy_restricted',
            )
            return None

    return {
        'chat_type': chat_type,
        'contact': contact,
        'receiver_id': receiver_id,
        'receiver_pub': receiver_pub,
        'receiver_is_connected': receiver_is_connected,
    }


def _send_group_mention_pushes(context: dict | None = None) -> None:
    send_context = context or {}
    send_web_push_notification_func = send_context.get('send_web_push_notification_func')
    mentioned_members = send_context.get('mentioned_members') or []
    count_connected_func = send_context.get('count_connected_func')
    sender_id = int(send_context.get('sender_id') or 0)
    sender_display_name = str(send_context.get('sender_display_name') or '')
    sender_username = str(send_context.get('sender_username') or '')
    chat_id = str(send_context.get('chat_id') or '')
    message_type = str(send_context.get('message_type') or 'text')
    group_chat_display_name = str(send_context.get('group_chat_display_name') or '')
    logger = send_context.get('logger')

    if not mentioned_members or not callable(send_web_push_notification_func):
        return
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


def _send_direct_push_if_needed(context: dict | None = None) -> None:
    send_context = context or {}
    send_web_push_notification_func = send_context.get('send_web_push_notification_func')
    receiver_is_connected = bool(send_context.get('receiver_is_connected'))
    receiver_id = send_context.get('receiver_id')
    sender_id = int(send_context.get('sender_id') or 0)
    sender_display_name = str(send_context.get('sender_display_name') or '')
    sender_username = str(send_context.get('sender_username') or '')
    chat_id = str(send_context.get('chat_id') or '')
    message_type = str(send_context.get('message_type') or 'text')
    logger = send_context.get('logger')

    if receiver_is_connected or not callable(send_web_push_notification_func):
        return
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


def _emit_group_send_result(context: dict | None = None) -> None:
    send_context = context or {}
    emit_func = send_context.get('emit_func')
    payload = send_context.get('payload') or {}
    chat_id = str(send_context.get('chat_id') or '')
    sender_pub = str(send_context.get('sender_pub') or '')
    group_member_public_keys = send_context.get('group_member_public_keys') or []

    emit_func('receive_message', payload, room=chat_id)
    emit_func('receive_message', payload, room=sender_pub)
    emit_func('message_sent', payload, room=sender_pub)
    for member in group_member_public_keys:
        member_pub = str(member['public_key'] or '')
        if member_pub:
            emit_func('receive_message', payload, room=member_pub)
    _send_group_mention_pushes(send_context)


def _emit_direct_send_result(context: dict | None = None) -> None:
    send_context = context or {}
    emit_func = send_context.get('emit_func')
    payload = send_context.get('payload') or {}
    receiver_pub = str(send_context.get('receiver_pub') or '')
    sender_pub = str(send_context.get('sender_pub') or '')

    emit_func('receive_message', payload, room=receiver_pub)
    emit_func('receive_message', payload, room=sender_pub)
    emit_func('message_sent', payload, room=sender_pub)
    _send_direct_push_if_needed(send_context)


def _emit_send_result(context: dict | None = None) -> None:
    send_context = context or {}
    chat_type = str(send_context.get('chat_type') or '')
    if chat_type == 'group':
        _emit_group_send_result(send_context)
        return
    _emit_direct_send_result(send_context)


def _resolve_reply_target_id(conn, *, reply_to_id: int | None, chat_id: str) -> int | None:
    if reply_to_id is None:
        return None
    reply_exists = conn.execute(
        'SELECT 1 FROM messages WHERE id = ? AND chat_id = ?',
        (reply_to_id, chat_id),
    ).fetchone()
    if not reply_exists:
        return None
    return reply_to_id


def _insert_message_row(
    conn,
    *,
    context: dict | None = None,
):
    send_context = context or {}
    supports_forward_metadata = bool(send_context.get('supports_forward_metadata'))
    supports_album_metadata = bool(send_context.get('supports_album_metadata'))
    chat_type = str(send_context.get('chat_type') or '')
    chat_id = str(send_context.get('chat_id') or '')
    sender_id = int(send_context.get('sender_id') or 0)
    receiver_id = send_context.get('receiver_id')
    message = str(send_context.get('message') or '')
    message_type = str(send_context.get('message_type') or 'text')
    reply_to_id = send_context.get('reply_to_id')
    forward_from_name = send_context.get('forward_from_name')
    forward_from_user_id = send_context.get('forward_from_user_id')
    album_id = send_context.get('album_id') or None
    receiver_is_connected = bool(send_context.get('receiver_is_connected'))

    # Build the INSERT dynamically: the base columns are always present, while
    # forward/album columns are appended only when the schema supports them.
    # Group messages have no receiver and are immediately delivered; direct
    # messages carry the receiver id and the live-delivery flag. All column
    # names are code-defined literals, so this is not an injection surface.
    is_group = chat_type == 'group'
    columns = ['chat_id', 'sender_id', 'receiver_id', 'message', 'message_type', 'reply_to_id']
    values: list = [
        chat_id,
        sender_id,
        None if is_group else receiver_id,
        message,
        message_type,
        reply_to_id,
    ]
    if supports_forward_metadata:
        columns += ['forward_from_name', 'forward_from_user_id']
        values += [forward_from_name, forward_from_user_id]
    if supports_album_metadata:
        columns.append('album_id')
        values.append(album_id)
    columns.append('is_delivered')
    values.append(1 if is_group else int(receiver_is_connected))

    placeholders = ', '.join(['?'] * len(values))
    sql = (
        f"INSERT INTO messages ({', '.join(columns)}) "
        f"VALUES ({placeholders}) "
        f"RETURNING id, created_at"
    )
    return conn.execute(sql, tuple(values))


def _apply_group_message_receipts(
    conn,
    *,
    context: dict | None = None,
) -> list[dict]:
    send_context = context or {}
    chat_type = str(send_context.get('chat_type') or '')
    chat_id = str(send_context.get('chat_id') or '')
    msg_id = int(send_context.get('msg_id') or 0)
    sender_id = int(send_context.get('sender_id') or 0)
    message_created_at = send_context.get('message_created_at')

    if chat_type != 'group':
        return []
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
    return list_chat_member_public_keys(conn, chat_id, exclude_user_id=sender_id)


def _resolve_reply_preview_for_send(
    conn,
    *,
    context: dict | None = None,
) -> tuple[int | None, str | None, str | None]:
    send_context = context or {}
    reply_to_id = send_context.get('reply_to_id')
    if reply_to_id is None:
        return None, None, None
    chat_id = str(send_context.get('chat_id') or '')
    looks_like_ciphertext_func = send_context.get('looks_like_ciphertext_func')
    logger = send_context.get('logger')

    rm = conn.execute(
        'SELECT m.message, u.public_key FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ? AND m.chat_id = ?',
        (reply_to_id, chat_id),
    ).fetchone()
    if not rm:
        return reply_to_id, None, None

    raw = rm['message']
    if callable(looks_like_ciphertext_func) and looks_like_ciphertext_func(raw):
        return reply_to_id, raw, rm['public_key']
    logger.warning('reply_to_id=%s has non-ciphertext content; dropping reply preview', reply_to_id)
    return None, None, rm['public_key']


def _resolve_sender_identity_for_send(
    conn,
    *,
    context: dict | None = None,
) -> tuple[str, str, str]:
    send_context = context or {}
    sender_id = int(send_context.get('sender_id') or 0)
    sender_display_name = str(send_context.get('sender_display_name') or '')
    sender_username = str(send_context.get('sender_username') or '')

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

    sender_avatar_url = ''
    if sender_row:
        if not sender_display_name:
            sender_display_name = str(sender_row['display_name'] or sender_row['username'] or '').strip()
        if not sender_username:
            sender_username = str(sender_row['username'] or '').strip()
        try:
            sender_avatar_url = str(get_safe_avatar_url(sender_row, sender_id) or '').strip()
        except Exception:
            sender_avatar_url = str(sender_row.get('avatar_url') or '').strip() if hasattr(sender_row, 'get') else ''
    return sender_display_name, sender_username, sender_avatar_url


def _initialize_send_runtime_state(conn, *, context: dict | None = None) -> dict:
    send_context = context or {}
    data = send_context.get('data') or {}
    positive_int_func = send_context.get('positive_int_func')
    chat_type = str(send_context.get('chat_type') or '')
    chat_id = str(send_context.get('chat_id') or '')
    sender_id = int(send_context.get('sender_id') or 0)
    message = str(send_context.get('message') or '')
    message_type = str(send_context.get('message_type') or 'text')
    session_store = send_context.get('session_store') or {}

    reply_to_id = positive_int_func(data.get('reply_to_id'))
    raw_forward_from_name = str(data.get('forward_from_name') or '').strip()
    forward_from_name = raw_forward_from_name[:140] if raw_forward_from_name else None
    forward_from_user_id = positive_int_func(data.get('forward_from_user_id'))
    if forward_from_user_id and not can_link_forward_author(
        conn,
        author_user_id=forward_from_user_id,
        actor_user_id=sender_id,
    ):
        forward_from_user_id = None
    raw_album_id = str(data.get('album_id') or '').strip()
    album_id = raw_album_id[:64] if raw_album_id else None
    group_member_public_keys = []
    mentioned_members: list[dict] = []
    mentioned_user_ids: list[int] = []
    mentioned_usernames: list[str] = []
    group_chat_display_name = ''

    if chat_type == 'group':
        (
            mentioned_members,
            mentioned_user_ids,
            mentioned_usernames,
            group_chat_display_name,
        ) = _resolve_group_mentions_context(
            conn,
            chat_id=chat_id,
            sender_id=sender_id,
            message=message,
            message_type=message_type,
            mentioned_usernames=data.get('mentioned_usernames'),
        )

    sender_display_name = str(session_store.get('display_name') or session_store.get('username') or '').strip()
    sender_username = str(session_store.get('username') or '').strip()
    sender_avatar_url = ''

    return {
        'reply_to_id': reply_to_id,
        'forward_from_name': forward_from_name,
        'forward_from_user_id': forward_from_user_id,
        'album_id': album_id,
        'group_member_public_keys': group_member_public_keys,
        'mentioned_members': mentioned_members,
        'mentioned_user_ids': mentioned_user_ids,
        'mentioned_usernames': mentioned_usernames,
        'group_chat_display_name': group_chat_display_name,
        'sender_display_name': sender_display_name,
        'sender_username': sender_username,
        'sender_avatar_url': sender_avatar_url,
    }


def _persist_send_flow(conn, *, context: dict | None = None):
    send_context = context or {}
    error_cls = send_context.get('error_cls') or Exception
    release_fn = send_context.get('release_fn')
    complete_fn = send_context.get('complete_fn')
    reservation = send_context.get('reservation')
    logger = send_context.get('logger')
    emit_func = send_context.get('emit_func')
    request_id = str(send_context.get('request_id') or '').strip()
    ensure_chat_exists_func = send_context.get('ensure_chat_exists_func')
    chat_id = str(send_context.get('chat_id') or '')
    chat_type = str(send_context.get('chat_type') or '')
    sender_id = int(send_context.get('sender_id') or 0)
    receiver_id = send_context.get('receiver_id')
    message = str(send_context.get('message') or '')
    message_type = str(send_context.get('message_type') or 'text')
    reply_to_id = send_context.get('reply_to_id')
    forward_from_name = send_context.get('forward_from_name')
    forward_from_user_id = send_context.get('forward_from_user_id')
    album_id = send_context.get('album_id') or None
    receiver_is_connected = bool(send_context.get('receiver_is_connected'))
    looks_like_ciphertext_func = send_context.get('looks_like_ciphertext_func')
    sender_display_name = str(send_context.get('sender_display_name') or '')
    sender_username = str(send_context.get('sender_username') or '')

    try:
        ensure_chat_exists_func(conn, chat_id)
        message_table_capabilities = _resolve_message_table_capabilities(conn)
        supports_forward_metadata = message_table_capabilities['supports_forward_metadata']
        supports_album_metadata = message_table_capabilities['supports_album_metadata']
        if chat_type != 'group':
            _sync_direct_contact_chat(
                conn,
                sender_id=sender_id,
                receiver_id=receiver_id,
                chat_id=chat_id,
            )

        reply_to_id = _resolve_reply_target_id(conn, reply_to_id=reply_to_id, chat_id=chat_id)
        cur = _insert_message_row(
            conn,
            context={
                'supports_forward_metadata': supports_forward_metadata,
                'supports_album_metadata': supports_album_metadata,
                'chat_type': chat_type,
                'chat_id': chat_id,
                'sender_id': sender_id,
                'receiver_id': receiver_id,
                'message': message,
                'message_type': message_type,
                'reply_to_id': reply_to_id,
                'forward_from_name': forward_from_name,
                'forward_from_user_id': forward_from_user_id,
                'album_id': album_id,
                'receiver_is_connected': receiver_is_connected,
            },
        )
        inserted_row = cur.fetchone()
        msg_id = inserted_row['id'] if inserted_row else None
        if msg_id is None:
            raise error_cls('Failed to resolve inserted message id')
        message_created_at = inserted_row['created_at'] if inserted_row else None

        group_member_public_keys = _apply_group_message_receipts(
            conn,
            context={
                'chat_type': chat_type,
                'chat_id': chat_id,
                'msg_id': msg_id,
                'sender_id': sender_id,
                'message_created_at': message_created_at,
            },
        )
        expires_at = _apply_message_expiry(conn, message_id=msg_id, chat_id=chat_id)
        if chat_type != 'group' and receiver_id is not None and int(sender_id) == int(receiver_id):
            conn.execute(
                'UPDATE messages SET is_read = 1, is_delivered = 1 WHERE id = ?',
                (msg_id,),
            )
        conn.commit()

        reply_to_id, reply_message, reply_sender_pub = _resolve_reply_preview_for_send(
            conn,
            context={
                'reply_to_id': reply_to_id,
                'chat_id': chat_id,
                'looks_like_ciphertext_func': looks_like_ciphertext_func,
                'logger': logger,
            },
        )

        sender_display_name, sender_username, sender_avatar_url = _resolve_sender_identity_for_send(
            conn,
            context={
                'sender_id': sender_id,
                'sender_display_name': sender_display_name,
                'sender_username': sender_username,
            },
        )
    except error_cls as exc:
        release_fn(reservation)
        logger.error('Error saving message: %s', exc)
        _emit_send_error(emit_func, 'Failed to save message.', request_id=request_id)
        return None
    finally:
        conn.close()

    complete_fn(reservation)
    return {
        'msg_id': msg_id,
        'message_created_at': message_created_at,
        'group_member_public_keys': group_member_public_keys,
        'reply_to_id': reply_to_id,
        'reply_message': reply_message,
        'reply_sender_pub': reply_sender_pub,
        'sender_display_name': sender_display_name,
        'sender_username': sender_username,
        'sender_avatar_url': sender_avatar_url,
        'expires_at': expires_at,
        'album_id': album_id if supports_album_metadata else None,
    }


def _finalize_send_message(context: dict | None = None) -> None:
    send_context = context or {}
    chat_type = str(send_context.get('chat_type') or '')
    sender_id = send_context.get('sender_id')
    receiver_id = send_context.get('receiver_id')
    is_self_chat = (
        chat_type != 'group'
        and sender_id is not None
        and receiver_id is not None
        and int(sender_id) == int(receiver_id)
    )
    payload = {
        'id': send_context.get('msg_id'),
        'chat_id': str(send_context.get('chat_id') or ''),
        'sender_user_id': int(send_context.get('sender_id') or 0),
        'sender_public_key': str(send_context.get('sender_pub') or ''),
        'sender_display_name': str(send_context.get('sender_display_name') or ''),
        'sender_username': str(send_context.get('sender_username') or ''),
        'sender_avatar_url': str(send_context.get('sender_avatar_url') or ''),
        'message': str(send_context.get('message') or ''),
        'is_read': is_self_chat,
        'is_delivered': True if is_self_chat else (bool(send_context.get('receiver_is_connected')) if chat_type != 'group' else True),
        'voice_listened_by_partner': False,
        'created_at': send_context.get('message_created_at') or send_context.get('utc_now_text_func')(),
        'client_id': send_context.get('client_id'),
        'request_id': str(send_context.get('request_id') or ''),
        'reply_to_id': send_context.get('reply_to_id'),
        'reply_message': send_context.get('reply_message'),
        'reply_sender_pub': send_context.get('reply_sender_pub'),
        'forward_from_name': send_context.get('forward_from_name'),
        'forward_from_user_id': send_context.get('forward_from_user_id'),
        'album_id': send_context.get('album_id') or None,
        'reactions': [],
        'expires_at': send_context.get('expires_at'),
    }
    if chat_type == 'group':
        payload['group_read_count'] = 0
        payload['group_readers'] = []
        payload['mentioned_user_ids'] = send_context.get('mentioned_user_ids') or []
        payload['mentioned_usernames'] = send_context.get('mentioned_usernames') or []

    _emit_send_result(
        {
            'emit_func': send_context.get('emit_func'),
            'send_web_push_notification_func': send_context.get('send_web_push_notification_func'),
            'count_connected_func': send_context.get('count_connected_func'),
            'logger': send_context.get('logger'),
            'payload': payload,
            'chat_type': chat_type,
            'sender_pub': send_context.get('sender_pub'),
            'receiver_pub': send_context.get('receiver_pub'),
            'receiver_is_connected': send_context.get('receiver_is_connected'),
            'receiver_id': send_context.get('receiver_id'),
            'sender_id': send_context.get('sender_id'),
            'chat_id': send_context.get('chat_id'),
            'message_type': send_context.get('message_type'),
            'sender_display_name': send_context.get('sender_display_name'),
            'sender_username': send_context.get('sender_username'),
            'group_chat_display_name': send_context.get('group_chat_display_name'),
            'group_member_public_keys': send_context.get('group_member_public_keys'),
            'mentioned_members': send_context.get('mentioned_members'),
        }
    )


def _validate_delete_request(data, *, context: dict | None = None) -> dict | None:
    delete_context = context or {}
    session_store = delete_context.get('session_store') or {}
    positive_int_func = delete_context.get('positive_int_func')
    socket_rate_ok_func = delete_context.get('socket_rate_ok_func')
    is_valid_chat_id_func = delete_context.get('is_valid_chat_id_func')
    emit_func = delete_context.get('emit_func')

    msg_ids = _normalize_delete_message_ids(data, positive_int_func)
    chat_id = str(data.get('chat_id') or '').strip()
    mode = _resolve_delete_mode(data)
    uid = session_store['user_id']
    pub = session_store['public_key_pem']

    if not socket_rate_ok_func(uid, 'delete_messages'):
        emit_func('error', {'message': 'Too many messages. Please wait a little.'})
        return None
    if len(msg_ids) > 100:
        emit_func('error', {'message': 'Too many messages selected. Maximum is 100.'})
        return None
    if not msg_ids or not chat_id:
        return None
    if not is_valid_chat_id_func(chat_id):
        return None

    return {
        'msg_ids': msg_ids,
        'chat_id': chat_id,
        'mode': mode,
        'uid': uid,
        'pub': pub,
        # for_all: hard-delete for every group member; requires moderator rights.
        # The actual permission check is deferred to _resolve_group_delete_capability.
        'requested_for_all': mode == 'for_all',
    }


def _resolve_delete_partner_access(conn, *, context: dict | None = None):
    delete_context = context or {}
    chat_partner_state_func = delete_context.get('chat_partner_state_func')
    uid = int(delete_context.get('uid') or 0)
    chat_id = str(delete_context.get('chat_id') or '')
    emit_func = delete_context.get('emit_func')
    emit_blocked_error_func = delete_context.get('emit_blocked_error_func')

    partner, block_state = chat_partner_state_func(conn, uid, chat_id)
    if not partner:
        return None
    if not block_state or not block_state['is_blocked']:
        return partner

    emit_func('chat_block_state', {'chat_id': chat_id, 'partner_user_id': partner['contact_id'], **block_state})
    emit_blocked_error_func('Deletion is unavailable because the user is blocked.', block_state)
    return None


def _normalize_delete_message_ids(data, positive_int_func) -> list[int]:
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
    return msg_ids


def _resolve_delete_mode(data) -> str:
    mode = data.get('mode', 'for_me')
    # 'for_all' is the group moderator mode: hard-delete for every member
    if mode not in ('for_both', 'for_me', 'for_all'):
        return 'for_me'
    return mode


def _resolve_group_delete_capability(
    conn,
    *,
    chat_type: str,
    uid: int,
    chat_id: str,
    authorize_group_action_func=None,
) -> bool:
    if chat_type != 'group' or not callable(authorize_group_action_func):
        return False
    try:
        return bool(authorize_group_action_func(conn, uid, chat_id, 'delete_messages'))
    except Exception:  # noqa: BLE001
        return False


def _fetch_delete_rows(conn, *, msg_ids: list[int], chat_id: str, uid: int, chat_type: str):
    placeholders = ', '.join('?' * len(msg_ids))
    if chat_type == 'group':
        return conn.execute(
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
    return conn.execute(
        f'SELECT id, sender_id, receiver_id FROM messages'
        f' WHERE id IN ({placeholders}) AND chat_id = ? AND (sender_id = ? OR receiver_id = ?)',
        (*msg_ids, chat_id, uid, uid),
    ).fetchall()


def _partition_delete_rows(rows, *, context: dict | None = None) -> dict[str, list[int]]:
    delete_context = context or {}
    mode = str(delete_context.get('mode') or 'for_me')
    uid = int(delete_context.get('uid') or 0)
    chat_type = str(delete_context.get('chat_type') or '')
    can_delete_any_group_message = bool(delete_context.get('can_delete_any_group_message'))

    deleted_ids = []
    for_both_delete_ids = []
    for_me_sender_ids = []
    for_me_receiver_ids = []

    for msg in rows:
        msg_id = msg['id']
        if mode == 'for_all':
            # Moderator/admin hard-delete: removes for every group member.
            # Requires can_delete_any_group_message flag — enforced by the caller.
            if chat_type == 'group' and can_delete_any_group_message:
                for_both_delete_ids.append(msg_id)
                deleted_ids.append(msg_id)
        elif mode == 'for_both':
            if chat_type == 'group':
                can_delete_for_both = msg['sender_id'] == uid or can_delete_any_group_message
            else:
                can_delete_for_both = msg['sender_id'] == uid or msg['receiver_id'] == uid
            if can_delete_for_both:
                for_both_delete_ids.append(msg_id)
                deleted_ids.append(msg_id)
        elif mode == 'for_me':
            if chat_type == 'group':
                if msg['sender_id'] == uid:
                    for_me_sender_ids.append(msg_id)
                else:
                    for_me_receiver_ids.append(msg_id)
            else:
                if msg['sender_id'] == uid:
                    for_me_sender_ids.append(msg_id)
                if msg['receiver_id'] == uid:
                    for_me_receiver_ids.append(msg_id)
            deleted_ids.append(msg_id)

    return {
        'deleted_ids': deleted_ids,
        'for_both_delete_ids': for_both_delete_ids,
        'for_me_sender_ids': for_me_sender_ids,
        'for_me_receiver_ids': for_me_receiver_ids,
    }


def _apply_delete_mutations(
    conn,
    *,
    context: dict | None = None,
) -> None:
    delete_context = context or {}
    chat_type = str(delete_context.get('chat_type') or '')
    uid = int(delete_context.get('uid') or 0)
    for_both_delete_ids = list(delete_context.get('for_both_delete_ids') or [])
    for_me_sender_ids = list(delete_context.get('for_me_sender_ids') or [])
    for_me_receiver_ids = list(delete_context.get('for_me_receiver_ids') or [])

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
        return

    if for_me_sender_ids:
        ph = ', '.join('?' * len(for_me_sender_ids))
        conn.execute(f'UPDATE messages SET deleted_by_sender = 1 WHERE id IN ({ph})', for_me_sender_ids)
    if for_me_receiver_ids:
        ph = ', '.join('?' * len(for_me_receiver_ids))
        conn.execute(f'UPDATE messages SET deleted_by_receiver = 1 WHERE id IN ({ph})', for_me_receiver_ids)


def _emit_deleted_messages(emit_func, *, context: dict | None = None) -> None:
    delete_context = context or {}
    deleted_ids = list(delete_context.get('deleted_ids') or [])
    chat_id = str(delete_context.get('chat_id') or '')
    mode = str(delete_context.get('mode') or 'for_me')
    request_id = str(delete_context.get('request_id') or '')
    pub = str(delete_context.get('pub') or '')
    chat_type = str(delete_context.get('chat_type') or '')
    partner = delete_context.get('partner')

    if not deleted_ids:
        return

    payload = {'msg_ids': deleted_ids, 'chat_id': chat_id, 'mode': mode}
    if request_id:
        payload['request_id'] = request_id
    if mode in ('for_both', 'for_all'):
        emit_func('messages_deleted', payload, room=chat_id)
        emit_func('messages_deleted', payload, room=pub)
        if partner and partner['public_key']:
            emit_func('messages_deleted', payload, room=partner['public_key'])
        return

    emit_func('messages_deleted', payload, room=pub)
    if chat_type == 'group':
        emit_func('messages_deleted', payload, room=chat_id)


def _validate_edit_payload(
    data,
    *,
    positive_int_func,
    is_valid_chat_id_func,
    emit_func,
) -> dict | None:
    msg_id = positive_int_func(data.get('msg_id'))
    new_content = data.get('new_content')
    chat_id = str(data.get('chat_id') or '').strip()

    if not msg_id or not new_content or not chat_id:
        return None
    if not isinstance(new_content, str):
        emit_func('error', {'message': 'Invalid payload.'})
        return None
    new_content = new_content.strip()
    if not new_content:
        emit_func('error', {'message': 'Invalid payload.'})
        return None
    if len(new_content) > 64000:
        emit_func('error', {'message': 'Message is too long (max 64000 characters).'})
        return None
    if not is_valid_chat_id_func(chat_id):
        emit_func('error', {'message': 'Invalid chat ID.'})
        return None
    return {'msg_id': msg_id, 'new_content': new_content, 'chat_id': chat_id}


def _is_edit_chat_access_allowed(
    conn,
    *,
    context: dict | None = None,
) -> bool:
    edit_context = context or {}
    uid = int(edit_context.get('uid') or 0)
    chat_id = str(edit_context.get('chat_id') or '')
    chat_partner_state_func = edit_context.get('chat_partner_state_func')
    emit_blocked_error_func = edit_context.get('emit_blocked_error_func')
    emit_func = edit_context.get('emit_func')

    partner, block_state = chat_partner_state_func(conn, uid, chat_id)
    if not partner:
        return False
    if not block_state or not block_state['is_blocked']:
        return True
    emit_func('chat_block_state', {'chat_id': chat_id, 'partner_user_id': partner['contact_id'], **block_state})
    emit_blocked_error_func('Editing is unavailable because the user is blocked.', block_state)
    return False


def _validate_edit_target(msg, *, context: dict | None = None) -> dict | None:
    edit_context = context or {}
    chat_id = str(edit_context.get('chat_id') or '')
    uid = edit_context.get('uid')
    positive_int_func = edit_context.get('positive_int_func')
    parse_db_utc_timestamp_func = edit_context.get('parse_db_utc_timestamp_func')
    utc_now_func = edit_context.get('utc_now_func')
    message_edit_window_seconds = float(edit_context.get('message_edit_window_seconds') or 0)
    max_message_edits = int(edit_context.get('max_message_edits') or 0)
    emit_func = edit_context.get('emit_func')

    if not msg or str(msg['chat_id'] or '').strip() != chat_id:
        return None

    msg_sender_id = positive_int_func(msg['sender_id']) if callable(positive_int_func) else None
    current_user_id = positive_int_func(uid) if callable(positive_int_func) else None
    if not msg_sender_id or not current_user_id or msg_sender_id != current_user_id:
        emit_func('error', {'message': 'You can only edit your own messages.'})
        return None

    created_at = parse_db_utc_timestamp_func(msg['created_at']) if callable(parse_db_utc_timestamp_func) else None
    if created_at and callable(utc_now_func):
        if (utc_now_func() - created_at).total_seconds() > message_edit_window_seconds:
            emit_func('error', {'message': 'Editing window expired for this message.'})
            return None

    edit_count = int(msg['edit_count'] or 0)
    if edit_count >= max_message_edits:
        emit_func('error', {'message': 'Edit limit reached for this message.'})
        return None

    return {
        'current_user_id': current_user_id,
        'receiver_public_key': str(msg['receiver_public_key'] or '').strip(),
    }


def _apply_edit_message_update(conn, *, context: dict | None = None) -> bool:
    edit_context = context or {}
    reserve_socket_request_func = edit_context.get('reserve_socket_request_func')
    mark_socket_request_completed_func = edit_context.get('mark_socket_request_completed_func')
    release_socket_request_func = edit_context.get('release_socket_request_func')
    emit_func = edit_context.get('emit_func')
    current_user_id = int(edit_context.get('current_user_id') or 0)
    request_id = str(edit_context.get('request_id') or '')
    new_content = str(edit_context.get('new_content') or '')
    message_type = str(edit_context.get('message_type') or 'text')
    msg_id = edit_context.get('msg_id')
    chat_id = str(edit_context.get('chat_id') or '')

    reserve_fn, complete_fn, release_fn = _resolve_socket_request_handlers(
        reserve_socket_request_func=reserve_socket_request_func,
        mark_socket_request_completed_func=mark_socket_request_completed_func,
        release_socket_request_func=release_socket_request_func,
    )
    allowed, reservation = _reserve_socket_request_or_emit_duplicate(
        reserve_fn=reserve_fn,
        emit_func=emit_func,
        user_id=current_user_id,
        event_name='edit_message',
        request_id=request_id,
    )
    if not allowed:
        return False

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
            release_fn(reservation)
            emit_func('error', {'message': 'You can only edit your own messages.'})
            return False
        conn.commit()
    except Exception:
        release_fn(reservation)
        raise

    complete_fn(reservation)
    return True


def _emit_edited_message(emit_func, *, context: dict | None = None) -> None:
    edit_context = context or {}
    msg_id = edit_context.get('msg_id')
    new_content = str(edit_context.get('new_content') or '')
    chat_id = str(edit_context.get('chat_id') or '')
    message_type = str(edit_context.get('message_type') or 'text')
    sender_public_key = str(edit_context.get('sender_public_key') or '')
    request_id = str(edit_context.get('request_id') or '')
    chat_type = str(edit_context.get('chat_type') or '')
    receiver_public_key = str(edit_context.get('receiver_public_key') or '')

    payload = {
        'msg_id': msg_id,
        'new_content': new_content,
        'chat_id': chat_id,
        'message_type': message_type,
        'sender_public_key': sender_public_key,
    }
    if request_id:
        payload['request_id'] = request_id

    sender_room = sender_public_key
    if sender_room:
        emit_func('message_edited', payload, room=sender_room)
    if chat_type == 'group':
        emit_func('message_edited', payload, room=chat_id)
    elif receiver_public_key and receiver_public_key != sender_room:
        emit_func('message_edited', payload, room=receiver_public_key)


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


def handle_edit_message_event(  # noqa: PLR0913 - dependency-injected socket handler contract
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

    edit_payload = _validate_edit_payload(
        data,
        positive_int_func=positive_int_func,
        is_valid_chat_id_func=is_valid_chat_id_func,
        emit_func=emit_func,
    )
    if not edit_payload:
        return
    msg_id = edit_payload['msg_id']
    new_content = edit_payload['new_content']
    chat_id = edit_payload['chat_id']
    uid = session_store['user_id']

    if not socket_rate_ok_func(uid, 'edit_message'):
        emit_func('error', {'message': 'Too many messages. Please wait a little.'})
        return

    message_type = sanitize_message_type_func(data.get('message_type', 'text'))
    request_id = _normalize_socket_request_id(data, normalize_request_id_func)

    conn = get_db_connection_func()
    try:
        if not _is_edit_chat_access_allowed(
            conn,
            context={
                'uid': uid,
                'chat_id': chat_id,
                'chat_partner_state_func': chat_partner_state_func,
                'emit_blocked_error_func': emit_blocked_error_func,
                'emit_func': emit_func,
            },
        ):
            return

        chat_type = get_chat_type(conn, chat_id)
        if not _is_valid_e2ee_message_payload(new_content, chat_type=chat_type):
            _emit_e2ee_required_error(emit_func, request_id=request_id)
            return
        msg = conn.execute(
            '''
            SELECT m.sender_id, m.chat_id, m.created_at, m.edit_count, u.public_key AS receiver_public_key
            FROM messages m
            LEFT JOIN users u ON m.receiver_id = u.id
            WHERE m.id = ?
            ''',
            (msg_id,),
        ).fetchone()

        target = _validate_edit_target(
            msg,
            context={
                'chat_id': chat_id,
                'uid': uid,
                'positive_int_func': positive_int_func,
                'parse_db_utc_timestamp_func': parse_db_utc_timestamp_func,
                'utc_now_func': utc_now_func,
                'message_edit_window_seconds': message_edit_window_seconds,
                'max_message_edits': max_message_edits,
                'emit_func': emit_func,
            },
        )
        if not target:
            return
        current_user_id = target['current_user_id']
        receiver_public_key = target['receiver_public_key']

        update_applied = _apply_edit_message_update(
            conn,
            context={
                'reserve_socket_request_func': reserve_socket_request_func,
                'mark_socket_request_completed_func': mark_socket_request_completed_func,
                'release_socket_request_func': release_socket_request_func,
                'emit_func': emit_func,
                'current_user_id': current_user_id,
                'request_id': request_id,
                'new_content': new_content,
                'message_type': message_type,
                'msg_id': msg_id,
                'chat_id': chat_id,
            },
        )
    finally:
        conn.close()
    if not update_applied:
        return

    _emit_edited_message(
        emit_func,
        context={
            'msg_id': msg_id,
            'new_content': new_content,
            'chat_id': chat_id,
            'message_type': message_type,
            'sender_public_key': session_store.get('public_key_pem', ''),
            'request_id': request_id,
            'chat_type': chat_type,
            'receiver_public_key': receiver_public_key,
        },
    )


def handle_delete_messages_event(  # noqa: PLR0913 - dependency-injected socket handler contract
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

    delete_request = _validate_delete_request(
        data,
        context={
            'session_store': session_store,
            'positive_int_func': positive_int_func,
            'socket_rate_ok_func': socket_rate_ok_func,
            'is_valid_chat_id_func': is_valid_chat_id_func,
            'emit_func': emit_func,
        },
    )
    if not delete_request:
        return

    msg_ids = delete_request['msg_ids']
    chat_id = delete_request['chat_id']
    mode = delete_request['mode']
    uid = delete_request['uid']
    pub = delete_request['pub']
    request_id = _normalize_socket_request_id(data, normalize_request_id_func)
    reserve_fn, complete_fn, release_fn = _resolve_socket_request_handlers(
        reserve_socket_request_func=reserve_socket_request_func,
        mark_socket_request_completed_func=mark_socket_request_completed_func,
        release_socket_request_func=release_socket_request_func,
    )
    allowed, reservation = _reserve_socket_request_or_emit_duplicate(
        reserve_fn=reserve_fn,
        emit_func=emit_func,
        user_id=uid,
        event_name='delete_messages',
        request_id=request_id,
    )
    if not allowed:
        return

    conn = get_db_connection_func()
    try:
        partner = _resolve_delete_partner_access(
            conn,
            context={
                'chat_partner_state_func': chat_partner_state_func,
                'uid': uid,
                'chat_id': chat_id,
                'emit_func': emit_func,
                'emit_blocked_error_func': emit_blocked_error_func,
            },
        )
        if not partner:
            release_fn(reservation)
            return

        chat_type = get_chat_type(conn, chat_id)
        can_delete_any_group_message = _resolve_group_delete_capability(
            conn,
            chat_type=chat_type,
            uid=uid,
            chat_id=chat_id,
            authorize_group_action_func=authorize_group_action_func,
        )
        rows = _fetch_delete_rows(
            conn,
            msg_ids=msg_ids,
            chat_id=chat_id,
            uid=uid,
            chat_type=chat_type,
        )
        partitioned = _partition_delete_rows(
            rows,
            context={
                'mode': mode,
                'uid': uid,
                'chat_type': chat_type,
                'can_delete_any_group_message': can_delete_any_group_message,
            },
        )
        _apply_delete_mutations(
            conn,
            context={
                'chat_type': chat_type,
                'uid': uid,
                'for_both_delete_ids': partitioned['for_both_delete_ids'],
                'for_me_sender_ids': partitioned['for_me_sender_ids'],
                'for_me_receiver_ids': partitioned['for_me_receiver_ids'],
            },
        )

        conn.commit()
        _emit_deleted_messages(
            emit_func,
            context={
                'deleted_ids': partitioned['deleted_ids'],
                'chat_id': chat_id,
                'mode': mode,
                'request_id': request_id,
                'pub': pub,
                'chat_type': chat_type,
                'partner': partner,
            },
        )
        complete_fn(reservation)
    except error_cls as exc:
        release_fn(reservation)
        logger.error('Error deleting messages: %s', exc)
    finally:
        conn.close()


def handle_send_message_event(  # noqa: PLR0913 - dependency-injected socket handler contract
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
    socket_send_context_rate_check_func=None,
    moderation_auto_mute_func=None,
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
    request_id = _normalize_socket_request_id(data, normalize_request_id_func)
    if not socket_csrf_ok_func(data):
        return

    send_payload = _validate_send_payload(
        data,
        context={
            'session_store': session_store,
            'socket_rate_ok_func': socket_rate_ok_func,
            'is_valid_chat_id_func': is_valid_chat_id_func,
            'sanitize_message_type_func': sanitize_message_type_func,
            'emit_func': emit_func,
            'request_id': request_id,
        },
    )
    if not send_payload:
        return
    sender_id = send_payload['sender_id']
    sender_pub = send_payload['sender_pub']
    message = send_payload['message']
    chat_id = send_payload['chat_id']
    message_type = send_payload['message_type']

    conn = get_db_connection_func()
    # _persist_send_flow closes conn in its own finally; the surrounding
    # finally closes it on every earlier exit path (including unexpected
    # exceptions). _PooledConnection.close() is idempotent, so closing again
    # after _persist_send_flow already released the connection is harmless.
    try:
        if not _passes_send_moderation_checks(
            conn,
            context={
                'moderation_user_restriction_func': moderation_user_restriction_func,
                'moderation_public_link_check_func': moderation_public_link_check_func,
                'sender_id': sender_id,
                'message': message,
                'emit_func': emit_func,
                'request_id': request_id,
            },
        ):
            return

        if callable(moderation_auto_mute_func):
            restriction = moderation_auto_mute_func(
                conn,
                sender_id=sender_id,
                trigger='pre_send',
                force=False,
            )
            if restriction:
                _emit_moderation_restriction_error(emit_func, restriction, request_id=request_id)
                return

        delivery_context = _resolve_send_delivery_context(
            conn,
            context={
                'sender_id': sender_id,
                'chat_id': chat_id,
                'message_type': message_type,
                'group_restriction_lookup_func': group_restriction_lookup_func,
                'utc_now_text_func': utc_now_text_func,
                'count_connected_func': count_connected_func,
                'build_block_state_func': build_block_state_func,
                'normalize_block_state_func': normalize_block_state_func,
                'emit_blocked_error_func': emit_blocked_error_func,
                'emit_func': emit_func,
                'request_id': request_id,
            },
        )
        if not delivery_context:
            return
        (
            chat_type,
            receiver_id,
            receiver_pub,
            receiver_is_connected,
        ) = (
            delivery_context['chat_type'],
            delivery_context['receiver_id'],
            delivery_context['receiver_pub'],
            delivery_context['receiver_is_connected'],
        )
        if callable(socket_send_context_rate_check_func):
            send_rate_result = socket_send_context_rate_check_func(
                conn,
                sender_id=sender_id,
                chat_id=chat_id,
                chat_type=chat_type,
                receiver_id=receiver_id,
                message_type=message_type,
            ) or {}
            if not bool(send_rate_result.get('allowed', True)):
                reason = str(send_rate_result.get('reason') or 'context_rate_limit')
                if bool(send_rate_result.get('auto_mute')) and callable(moderation_auto_mute_func):
                    restriction = moderation_auto_mute_func(
                        conn,
                        sender_id=sender_id,
                        trigger=reason,
                        force=True,
                    )
                    if restriction:
                        _emit_moderation_restriction_error(emit_func, restriction, request_id=request_id)
                        return
                _emit_send_error(
                    emit_func,
                    'Too many messages. Please wait a little.',
                    request_id=request_id,
                    code='send_rate_limit',
                    reason=reason,
                )
                return
        if not _is_valid_e2ee_message_payload(message, chat_type=chat_type):
            _emit_e2ee_required_error(emit_func, request_id=request_id)
            return
        runtime_state = _initialize_send_runtime_state(
            conn,
            context={
                'data': data,
                'positive_int_func': positive_int_func,
                'chat_type': chat_type,
                'chat_id': chat_id,
                'sender_id': sender_id,
                'message': message,
                'message_type': message_type,
                'session_store': session_store,
            },
        )
        (
            reply_to_id,
            forward_from_name,
            forward_from_user_id,
            album_id,
            group_member_public_keys,
            mentioned_members,
            mentioned_user_ids,
            mentioned_usernames,
            group_chat_display_name,
            sender_display_name,
            sender_username,
            sender_avatar_url,
        ) = (
            runtime_state['reply_to_id'],
            runtime_state['forward_from_name'],
            runtime_state['forward_from_user_id'],
            runtime_state.get('album_id'),
            runtime_state['group_member_public_keys'],
            runtime_state['mentioned_members'],
            runtime_state['mentioned_user_ids'],
            runtime_state['mentioned_usernames'],
            runtime_state['group_chat_display_name'],
            runtime_state['sender_display_name'],
            runtime_state['sender_username'],
            runtime_state['sender_avatar_url'],
        )
        reserve_fn, complete_fn, release_fn = _resolve_socket_request_handlers(
            reserve_socket_request_func=reserve_socket_request_func,
            mark_socket_request_completed_func=mark_socket_request_completed_func,
            release_socket_request_func=release_socket_request_func,
        )
        allowed, reservation = _reserve_socket_request_or_emit_duplicate(
            reserve_fn=reserve_fn,
            emit_func=emit_func,
            user_id=sender_id,
            event_name='send_message',
            request_id=request_id,
        )
        if not allowed:
            return

        persisted = _persist_send_flow(
            conn,
            context={
                'error_cls': error_cls,
                'release_fn': release_fn,
                'complete_fn': complete_fn,
                'reservation': reservation,
                'logger': logger,
                'emit_func': emit_func,
                'ensure_chat_exists_func': ensure_chat_exists_func,
                'chat_id': chat_id,
                'chat_type': chat_type,
                'sender_id': sender_id,
                'receiver_id': receiver_id,
                'message': message,
                'message_type': message_type,
                'reply_to_id': reply_to_id,
                'forward_from_name': forward_from_name,
                'forward_from_user_id': forward_from_user_id,
                'album_id': album_id,
                'receiver_is_connected': receiver_is_connected,
                'looks_like_ciphertext_func': looks_like_ciphertext_func,
                'sender_display_name': sender_display_name,
                'sender_username': sender_username,
                'request_id': request_id,
            },
        )
    finally:
        conn.close()
    if not persisted:
        return
    (
        msg_id,
        message_created_at,
        group_member_public_keys,
        reply_to_id,
        reply_message,
        reply_sender_pub,
        sender_display_name,
        sender_username,
        sender_avatar_url,
        expires_at,
        album_id,
    ) = (
        persisted['msg_id'],
        persisted['message_created_at'],
        persisted['group_member_public_keys'],
        persisted['reply_to_id'],
        persisted['reply_message'],
        persisted['reply_sender_pub'],
        persisted['sender_display_name'],
        persisted['sender_username'],
        persisted['sender_avatar_url'],
        persisted.get('expires_at'),
        persisted.get('album_id'),
    )

    _finalize_send_message(
        {
            'chat_type': chat_type,
            'msg_id': msg_id,
            'chat_id': chat_id,
            'sender_id': sender_id,
            'sender_pub': sender_pub,
            'sender_display_name': sender_display_name,
            'sender_username': sender_username,
            'sender_avatar_url': sender_avatar_url,
            'message': message,
            'receiver_is_connected': receiver_is_connected,
            'message_created_at': message_created_at,
            'utc_now_text_func': utc_now_text_func,
            'client_id': data.get('client_id'),
            'request_id': request_id,
            'reply_to_id': reply_to_id,
            'reply_message': reply_message,
            'reply_sender_pub': reply_sender_pub,
            'forward_from_name': forward_from_name,
            'forward_from_user_id': forward_from_user_id,
            'album_id': album_id,
            'mentioned_user_ids': mentioned_user_ids,
            'mentioned_usernames': mentioned_usernames,
            'emit_func': emit_func,
            'send_web_push_notification_func': send_web_push_notification_func,
            'count_connected_func': count_connected_func,
            'logger': logger,
            'receiver_pub': receiver_pub,
            'receiver_id': receiver_id,
            'message_type': message_type,
            'group_chat_display_name': group_chat_display_name,
            'group_member_public_keys': group_member_public_keys,
            'mentioned_members': mentioned_members,
            'expires_at': expires_at,
        }
    )
