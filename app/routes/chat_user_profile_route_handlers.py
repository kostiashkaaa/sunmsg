def process_get_user_profile(
    conn,
    *,
    current_user_id: int,
    target_raw,
    parse_int_func,
    fetch_user_func,
    has_contact_func,
    build_block_state_func,
    serialize_block_state_func,
    fetch_conversation_stats_func,
    is_effectively_online_func,
    get_safe_avatar_url_func,
):
    if target_raw in (None, ''):
        return {'status': 'invalid_target'}

    try:
        target_user_id = parse_int_func(target_raw)
    except (TypeError, ValueError):
        return {'status': 'invalid_target'}

    user = fetch_user_func(conn, target_user_id)
    if not user:
        return {'status': 'not_found'}

    is_contact = has_contact_func(conn, current_user_id, target_user_id)
    is_public = bool(user['is_public']) if 'is_public' in user.keys() else True
    if not is_contact and not is_public:
        return {'status': 'not_found'}

    block_state = serialize_block_state_func(
        build_block_state_func(conn, current_user_id, target_user_id)
    )
    user_created_at = user['created_at'] if 'created_at' in user.keys() else None

    if block_state['is_blocked']:
        return {
            'status': 'ok',
            'payload': {
                'success': True,
                'restricted': True,
                'user_id': user['id'],
                'block_state': block_state,
                'online': None,
                'last_seen': None,
                'created_at': user_created_at,
                'display_name': user['display_name'],
                'username': user['username'],
                'public_key': user['public_key'],
                'avatar_url': get_safe_avatar_url_func(user, current_user_id),
                'bio': '',
                'stats': {
                    'photos': 0,
                    'videos': 0,
                    'audio': 0,
                    'voices': 0,
                    'files': 0,
                    'links': 0,
                },
            },
        }

    stats = fetch_conversation_stats_func(conn, current_user_id, target_user_id)
    if is_contact and bool(user['hide_online_status']):
        online = False
        last_seen = None
    elif is_contact:
        online = is_effectively_online_func(
            user['public_key'],
            persisted=bool(user['is_online']),
        )
        last_seen = user['last_seen']
    else:
        online = None
        last_seen = None

    return {
        'status': 'ok',
        'payload': {
            'success': True,
            'restricted': False,
            'user_id': user['id'],
            'block_state': block_state,
            'online': online,
            'last_seen': last_seen,
            'created_at': user_created_at,
            'display_name': user['display_name'],
            'username': user['username'],
            'public_key': user['public_key'],
            'avatar_url': get_safe_avatar_url_func(user, current_user_id),
            'bio': (user['bio'] if 'bio' in user.keys() else '') or '',
            'stats': {
                'photos': int(stats['photos'] or 0),
                'videos': int(stats['videos'] or 0),
                'audio': int(stats['audio'] or 0),
                'voices': int(stats['voices'] or 0),
                'files': int(stats['files'] or 0),
                'links': int(stats['links'] or 0),
            },
        },
    }
