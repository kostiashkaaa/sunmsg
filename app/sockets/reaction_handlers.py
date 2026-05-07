from app.services.chat_members import get_chat_type


def handle_toggle_reaction_event(
    data,
    *,
    session_store,
    require_payload_dict_func,
    socket_csrf_ok_func,
    positive_int_func,
    sanitize_reaction_emoji_func,
    normalize_request_id_func,
    is_valid_chat_id_func,
    socket_rate_ok_func,
    get_db_connection_func,
    chat_partner_state_func,
    emit_blocked_error_func,
    fetch_reactions_map_func,
    emit_func,
    utc_now_iso_func,
    logger,
    database_error_cls=None,
):
    error_cls = database_error_cls or Exception
    data = require_payload_dict_func(data)
    if data is None:
        return
    if not socket_csrf_ok_func(data):
        return

    chat_id = (data.get('chat_id') or '').strip()
    message_id = positive_int_func(data.get('message_id'))
    emoji = sanitize_reaction_emoji_func(data.get('emoji'))
    request_id = normalize_request_id_func(data.get('request_id'))
    if not chat_id or message_id is None or not emoji:
        payload = {'message': 'Invalid reaction payload.'}
        if request_id:
            payload['request_id'] = request_id
        emit_func('error', payload)
        return
    if not is_valid_chat_id_func(chat_id):
        payload = {'message': 'Invalid chat ID.'}
        if request_id:
            payload['request_id'] = request_id
        emit_func('error', payload)
        return

    uid = session_store['user_id']
    sender_pub = session_store.get('public_key_pem')
    if not socket_rate_ok_func(uid, 'toggle_reaction'):
        emit_func('error', {'message': 'Too many messages. Please wait a little.'})
        return

    conn = get_db_connection_func()
    try:
        partner, block_state = chat_partner_state_func(conn, uid, chat_id)
        if not partner:
            return
        is_group_chat = get_chat_type(conn, chat_id) == 'group'
        if block_state and block_state['is_blocked']:
            emit_func('chat_block_state', {'chat_id': chat_id, 'partner_user_id': partner['contact_id'], **block_state})
            emit_blocked_error_func(
                'Reactions are unavailable because the user is blocked.',
                block_state,
                request_id=request_id,
            )
            return

        msg = conn.execute(
            '''
            SELECT id
            FROM messages
            WHERE id = ?
              AND chat_id = ?
            ''',
            (message_id, chat_id),
        ).fetchone()
        if not msg:
            payload = {'message': 'Message not found.'}
            if request_id:
                payload['request_id'] = request_id
            emit_func('error', payload)
            return

        conn.execute('BEGIN')
        existing = conn.execute(
            'SELECT emoji FROM message_reactions WHERE message_id = ? AND user_id = ?',
            (message_id, uid),
        ).fetchone()

        action = 'added'
        if existing and existing['emoji'] == emoji:
            conn.execute(
                'DELETE FROM message_reactions WHERE message_id = ? AND user_id = ?',
                (message_id, uid),
            )
            action = 'removed'
        elif existing:
            conn.execute(
                '''
                UPDATE message_reactions
                SET emoji = ?, chat_id = ?, created_at = CURRENT_TIMESTAMP
                WHERE message_id = ? AND user_id = ?
                ''',
                (emoji, chat_id, message_id, uid),
            )
            action = 'updated'
        else:
            conn.execute(
                '''
                INSERT INTO message_reactions (message_id, chat_id, user_id, emoji)
                VALUES (?, ?, ?, ?)
                ''',
                (message_id, chat_id, uid, emoji),
            )

        conn.commit()
        updated_at = utc_now_iso_func()
        actor_reactions = fetch_reactions_map_func(conn, chat_id, [message_id], uid).get(message_id, [])
        partner_reactions = []
        if not is_group_chat and partner['contact_id'] is not None:
            partner_reactions = fetch_reactions_map_func(conn, chat_id, [message_id], partner['contact_id']).get(message_id, [])
    except error_cls as exc:
        logger.error('toggle_reaction failed uid=%s chat_id=%s message_id=%s: %s', uid, chat_id, message_id, exc)
        conn.rollback()
        payload = {'message': 'Failed to update reaction.'}
        if request_id:
            payload['request_id'] = request_id
        emit_func('error', payload)
        return
    finally:
        conn.close()

    payload_base = {
        'chat_id': chat_id,
        'message_id': int(message_id),
        'emoji': emoji,
        'action': action,
        'actor_public_key': sender_pub,
        'updated_at': updated_at,
    }
    if request_id:
        payload_base['request_id'] = request_id
    if sender_pub:
        emit_func('message_reactions_updated', {**payload_base, 'reactions': actor_reactions}, room=sender_pub)
    if is_group_chat:
        emit_func('message_reactions_updated', {**payload_base, 'reactions': actor_reactions}, room=chat_id)
    elif partner and partner['public_key']:
        emit_func('message_reactions_updated', {**payload_base, 'reactions': partner_reactions}, room=partner['public_key'])
