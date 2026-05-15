from datetime import datetime, timezone

from app.services.user_privacy import is_privacy_allowed, normalize_privacy_choice


_SEND_REQUEST_COOLDOWN_SECONDS = 45


def _parse_dialog_request_timestamp(raw_value):
    if not raw_value:
        return None
    text = str(raw_value).strip()
    if not text:
        return None
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S'):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    try:
        parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def send_dialog_request_workflow(
    conn,
    *,
    sender_user_id: int,
    receiver_user_id: int,
    normalize_block_state_func,
    build_block_state_func,
):
    try:
        contact = conn.execute(
            'SELECT auto_decline_requests, message_privacy FROM users WHERE id = ?',
            (receiver_user_id,),
        ).fetchone()
    except Exception:
        contact = conn.execute(
            'SELECT auto_decline_requests FROM users WHERE id = ?',
            (receiver_user_id,),
        ).fetchone()
    if not contact:
        return {'status': 'receiver_missing'}

    block_state = normalize_block_state_func(build_block_state_func(conn, sender_user_id, receiver_user_id))
    if block_state['is_blocked']:
        return {'status': 'blocked', 'block_state': block_state}

    message_privacy = normalize_privacy_choice(
        contact['message_privacy'] if 'message_privacy' in contact.keys() else None
    )
    if contact['auto_decline_requests'] or not is_privacy_allowed(
        conn,
        owner_id=receiver_user_id,
        viewer_id=sender_user_id,
        policy=message_privacy,
    ):
        return {'status': 'auto_decline'}

    existing_request = conn.execute(
        '''
        SELECT id, status, timestamp
        FROM dialog_requests
        WHERE sender_id = ? AND receiver_id = ?
        ORDER BY id DESC
        LIMIT 1
        ''',
        (sender_user_id, receiver_user_id),
    ).fetchone()

    if existing_request and existing_request['status'] == 'pending':
        requested_at = _parse_dialog_request_timestamp(existing_request['timestamp'])
        if requested_at is not None:
            now = datetime.now(timezone.utc)
            elapsed = max(0, int((now - requested_at).total_seconds()))
            if elapsed < _SEND_REQUEST_COOLDOWN_SECONDS:
                return {
                    'status': 'cooldown',
                    'retry_after': max(1, _SEND_REQUEST_COOLDOWN_SECONDS - elapsed),
                }

        conn.execute(
            'UPDATE dialog_requests SET timestamp = CURRENT_TIMESTAMP WHERE id = ?',
            (existing_request['id'],),
        )
        conn.commit()
        return {'status': 'ok', 'event': None}

    conn.execute(
        '''
        DELETE FROM dialog_requests WHERE (sender_id = ? AND receiver_id = ?)
           OR (sender_id = ? AND receiver_id = ?)
        ''',
        (sender_user_id, receiver_user_id, receiver_user_id, sender_user_id),
    )
    conn.execute(
        'INSERT INTO dialog_requests (sender_id, receiver_id) VALUES (?, ?)',
        (sender_user_id, receiver_user_id),
    )
    conn.commit()

    sender_info = conn.execute(
        'SELECT public_key, display_name, username, avatar_url, avatar_visibility FROM users WHERE id = ?',
        (sender_user_id,),
    ).fetchone()
    contact_info = conn.execute(
        'SELECT public_key FROM users WHERE id = ?',
        (receiver_user_id,),
    ).fetchone()

    event = None
    if sender_info and contact_info:
        visibility = sender_info['avatar_visibility'] or 'all'
        avatar = sender_info['avatar_url'] if visibility == 'all' else None
        event = {
            'room': contact_info['public_key'],
            'payload': {
                'sender_public_key': sender_info['public_key'],
                'sender_display_name': sender_info['display_name'],
                'sender_username': sender_info['username'],
                'sender_avatar': avatar,
            },
        }

    return {'status': 'ok', 'event': event}


def accept_dialog_request_workflow(  # noqa: PLR0913 - dependency-injected workflow contract
    conn,
    *,
    receiver_user_id: int,
    sender_public_key: str,
    normalize_block_state_func,
    build_block_state_func,
    generate_chat_id_func,
    default_chat_name: str,
):
    sender = conn.execute(
        'SELECT id, public_key, username, display_name, avatar_url, avatar_visibility FROM users WHERE public_key = ?',
        (sender_public_key,),
    ).fetchone()
    if not sender:
        return {'status': 'sender_missing'}

    sender_id = sender['id']
    block_state = normalize_block_state_func(build_block_state_func(conn, receiver_user_id, sender_id))
    if block_state['is_blocked']:
        return {'status': 'blocked', 'block_state': block_state}

    user_info = conn.execute(
        'SELECT id, public_key, display_name, username, avatar_url, avatar_visibility FROM users WHERE id = ?',
        (receiver_user_id,),
    ).fetchone()
    cursor = conn.cursor()
    dialog_request = cursor.execute(
        '''
        SELECT id FROM dialog_requests
        WHERE sender_id = ? AND receiver_id = ? AND status = 'pending'
        ''',
        (sender_id, receiver_user_id),
    ).fetchone()
    if not dialog_request:
        return {'status': 'request_missing'}

    chat_id = generate_chat_id_func(user_info['public_key'], sender_public_key)
    existing_chat = cursor.execute('SELECT chat_id FROM chats WHERE chat_id = ?', (chat_id,)).fetchone()
    if not existing_chat:
        cursor.execute('INSERT INTO chats (chat_id, chat_name) VALUES (?, ?)', (chat_id, default_chat_name))

    cursor.execute(
        '''
        INSERT INTO contacts (user_id, contact_id, chat_id)
        SELECT ?, ?, ?
        WHERE NOT EXISTS (
            SELECT 1
            FROM contacts
            WHERE user_id = ? AND contact_id = ?
        )
        ''',
        (receiver_user_id, sender_id, chat_id, receiver_user_id, sender_id),
    )
    cursor.execute(
        '''
        INSERT INTO contacts (user_id, contact_id, chat_id)
        SELECT ?, ?, ?
        WHERE NOT EXISTS (
            SELECT 1
            FROM contacts
            WHERE user_id = ? AND contact_id = ?
        )
        ''',
        (sender_id, receiver_user_id, chat_id, sender_id, receiver_user_id),
    )
    cursor.execute("UPDATE dialog_requests SET status = 'accepted' WHERE id = ?", (dialog_request['id'],))
    conn.commit()

    return {
        'status': 'ok',
        'chat_id': chat_id,
        'sender': sender,
        'user_info': user_info,
        'sender_public_key': sender_public_key,
    }


def decline_dialog_request_workflow(
    conn,
    *,
    receiver_user_id: int,
    sender_public_key: str,
):
    sender = conn.execute(
        'SELECT id, public_key FROM users WHERE public_key = ?',
        (sender_public_key,),
    ).fetchone()
    user_info = conn.execute(
        'SELECT display_name, username FROM users WHERE id = ?',
        (receiver_user_id,),
    ).fetchone()
    if not sender:
        return {'status': 'sender_missing'}

    cursor = conn.cursor()
    dialog_request = cursor.execute(
        '''
        SELECT id FROM dialog_requests
        WHERE sender_id = ? AND receiver_id = ? AND status = 'pending'
        ''',
        (sender['id'], receiver_user_id),
    ).fetchone()

    updated = False
    if dialog_request:
        cursor.execute("UPDATE dialog_requests SET status = 'declined' WHERE id = ?", (dialog_request['id'],))
        conn.commit()
        updated = True

    return {
        'status': 'ok',
        'updated': updated,
        'sender_public_key': sender['public_key'],
        'sender_display_name': user_info['display_name'] if user_info else None,
    }
