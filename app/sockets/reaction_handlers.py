from app.services.chat_members import get_chat_type
from app.sockets.error_messages import socket_error_payload


def _emit_error_with_request(emit_func, message: str, request_id: str = '') -> None:
    emit_func('error', socket_error_payload(message, request_id=request_id))


def _validate_toggle_reaction_payload(
    data,
    *,
    context: dict | None = None,
) -> dict | None:
    reaction_context = context or {}
    positive_int_func = reaction_context.get('positive_int_func')
    sanitize_reaction_emoji_func = reaction_context.get('sanitize_reaction_emoji_func')
    normalize_request_id_func = reaction_context.get('normalize_request_id_func')
    is_valid_chat_id_func = reaction_context.get('is_valid_chat_id_func')
    emit_func = reaction_context.get('emit_func')

    chat_id = (data.get('chat_id') or '').strip()
    message_id = positive_int_func(data.get('message_id'))
    emoji = sanitize_reaction_emoji_func(data.get('emoji'))
    request_id = normalize_request_id_func(data.get('request_id'))
    if not chat_id or message_id is None or not emoji:
        _emit_error_with_request(emit_func, 'Invalid reaction payload.', request_id)
        return None
    if not is_valid_chat_id_func(chat_id):
        _emit_error_with_request(emit_func, 'Invalid chat ID.', request_id)
        return None
    return {
        'chat_id': chat_id,
        'message_id': message_id,
        'emoji': emoji,
        'request_id': request_id,
    }


def _resolve_reaction_toggle_context(
    conn,
    *,
    context: dict | None = None,
):
    reaction_context = context or {}
    uid = int(reaction_context.get('uid') or 0)
    chat_id = str(reaction_context.get('chat_id') or '')
    message_id = int(reaction_context.get('message_id') or 0)
    request_id = str(reaction_context.get('request_id') or '')
    chat_partner_state_func = reaction_context.get('chat_partner_state_func')
    emit_blocked_error_func = reaction_context.get('emit_blocked_error_func')
    emit_func = reaction_context.get('emit_func')

    partner, block_state = chat_partner_state_func(conn, uid, chat_id)
    if not partner:
        return None
    is_group_chat = get_chat_type(conn, chat_id) == 'group'
    if block_state and block_state['is_blocked']:
        emit_func('chat_block_state', {'chat_id': chat_id, 'partner_user_id': partner['contact_id'], **block_state})
        emit_blocked_error_func(
            'Reactions are unavailable because the user is blocked.',
            block_state,
            request_id=request_id,
        )
        return None

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
        _emit_error_with_request(emit_func, 'Message not found.', request_id)
        return None

    return {'partner': partner, 'is_group_chat': is_group_chat}


def _apply_reaction_toggle_mutation(
    conn,
    *,
    context: dict | None = None,
) -> str:
    reaction_context = context or {}
    message_id = int(reaction_context.get('message_id') or 0)
    uid = int(reaction_context.get('uid') or 0)
    emoji = str(reaction_context.get('emoji') or '')
    chat_id = str(reaction_context.get('chat_id') or '')

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
    return action


def _resolve_reaction_views(
    conn,
    *,
    context: dict | None = None,
) -> tuple[list, list]:
    reaction_context = context or {}
    fetch_reactions_map_func = reaction_context.get('fetch_reactions_map_func')
    chat_id = str(reaction_context.get('chat_id') or '')
    message_id = int(reaction_context.get('message_id') or 0)
    uid = int(reaction_context.get('uid') or 0)
    partner = reaction_context.get('partner')
    is_group_chat = bool(reaction_context.get('is_group_chat'))

    actor_reactions = fetch_reactions_map_func(conn, chat_id, [message_id], uid).get(message_id, [])
    partner_reactions = []
    if not is_group_chat and partner['contact_id'] is not None:
        partner_reactions = fetch_reactions_map_func(conn, chat_id, [message_id], partner['contact_id']).get(message_id, [])
    return actor_reactions, partner_reactions


def _emit_reaction_toggle_updates(
    context: dict | None = None,
) -> None:
    reaction_context = context or {}
    emit_func = reaction_context.get('emit_func')
    chat_id = str(reaction_context.get('chat_id') or '')
    message_id = int(reaction_context.get('message_id') or 0)
    emoji = str(reaction_context.get('emoji') or '')
    action = str(reaction_context.get('action') or 'added')
    sender_pub = reaction_context.get('sender_pub')
    updated_at = str(reaction_context.get('updated_at') or '')
    request_id = str(reaction_context.get('request_id') or '')
    actor_reactions = reaction_context.get('actor_reactions') or []
    partner_reactions = reaction_context.get('partner_reactions') or []
    partner = reaction_context.get('partner')
    is_group_chat = bool(reaction_context.get('is_group_chat'))

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


def handle_toggle_reaction_event(  # noqa: PLR0913 - dependency-injected socket handler contract
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
    if 'user_id' not in session_store:
        return
    data = require_payload_dict_func(data)
    if data is None:
        return
    if not socket_csrf_ok_func(data):
        return

    payload = _validate_toggle_reaction_payload(
        data,
        context={
            'positive_int_func': positive_int_func,
            'sanitize_reaction_emoji_func': sanitize_reaction_emoji_func,
            'normalize_request_id_func': normalize_request_id_func,
            'is_valid_chat_id_func': is_valid_chat_id_func,
            'emit_func': emit_func,
        },
    )
    if not payload:
        return
    chat_id = payload['chat_id']
    message_id = payload['message_id']
    emoji = payload['emoji']
    request_id = payload['request_id']

    uid = session_store['user_id']
    sender_pub = session_store.get('public_key_pem')
    if not socket_rate_ok_func(uid, 'toggle_reaction'):
        _emit_error_with_request(emit_func, 'Too many messages. Please wait a little.', request_id)
        return

    conn = get_db_connection_func()
    try:
        reaction_context = _resolve_reaction_toggle_context(
            conn,
            context={
                'uid': uid,
                'chat_id': chat_id,
                'message_id': message_id,
                'request_id': request_id,
                'chat_partner_state_func': chat_partner_state_func,
                'emit_blocked_error_func': emit_blocked_error_func,
                'emit_func': emit_func,
            },
        )
        if not reaction_context:
            return
        partner = reaction_context['partner']
        is_group_chat = reaction_context['is_group_chat']
        action = _apply_reaction_toggle_mutation(
            conn,
            context={
                'message_id': message_id,
                'uid': uid,
                'emoji': emoji,
                'chat_id': chat_id,
            },
        )
        updated_at = utc_now_iso_func()
        actor_reactions, partner_reactions = _resolve_reaction_views(
            conn,
            context={
                'fetch_reactions_map_func': fetch_reactions_map_func,
                'chat_id': chat_id,
                'message_id': message_id,
                'uid': uid,
                'partner': partner,
                'is_group_chat': is_group_chat,
            },
        )
    except error_cls as exc:
        logger.error('toggle_reaction failed uid=%s chat_id=%s message_id=%s: %s', uid, chat_id, message_id, exc)
        conn.rollback()
        _emit_error_with_request(emit_func, 'Failed to update reaction.', request_id)
        return
    finally:
        conn.close()

    _emit_reaction_toggle_updates(
        {
            'emit_func': emit_func,
            'chat_id': chat_id,
            'message_id': message_id,
            'emoji': emoji,
            'action': action,
            'sender_pub': sender_pub,
            'updated_at': updated_at,
            'request_id': request_id,
            'actor_reactions': actor_reactions,
            'partner_reactions': partner_reactions,
            'partner': partner,
            'is_group_chat': is_group_chat,
        },
    )
