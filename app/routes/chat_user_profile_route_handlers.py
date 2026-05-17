from app.services.user_privacy import is_privacy_allowed


def process_get_user_profile(  # noqa: PLR0913 - dependency-injected route handler contract
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
    get_spotify_status_func=None,
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
    is_self = int(user['id']) == int(current_user_id)
    if not is_contact and not is_public and not is_self:
        return {
            'status': 'ok',
            'payload': {
                'success': True,
                'restricted': True,
                'private_profile': True,
                'is_contact': False,
                'can_send_request': False,
                'user_id': user['id'],
                'block_state': {
                    'is_blocked': False,
                    'blocked_by_me': False,
                    'blocked_me': False,
                },
                'online': None,
                'last_seen': None,
                'created_at': user['created_at'] if 'created_at' in user.keys() else None,
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
                'private_profile': False,
                'is_contact': is_contact,
                'can_send_request': False,
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
    can_send_request = bool(
        not is_self
        and not is_contact
        and is_public
        and not block_state['is_blocked']
        and is_privacy_allowed(
            conn,
            owner_id=target_user_id,
            viewer_id=current_user_id,
            policy=user['message_privacy'] if 'message_privacy' in user.keys() else None,
        )
    )
    can_view_bio = is_privacy_allowed(
        conn,
        owner_id=target_user_id,
        viewer_id=current_user_id,
        policy=user['bio_visibility'] if 'bio_visibility' in user.keys() else None,
    )
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

    spotify_status = None
    if callable(get_spotify_status_func):
        try:
            spotify_status = get_spotify_status_func(conn, current_user_id, target_user_id)
        except Exception:
            spotify_status = None

    return {
        'status': 'ok',
        'payload': {
            'success': True,
            'restricted': False,
            'private_profile': False,
            'is_contact': is_contact,
            'can_send_request': can_send_request,
            'user_id': user['id'],
            'block_state': block_state,
            'online': online,
            'last_seen': last_seen,
            'created_at': user_created_at,
            'display_name': user['display_name'],
            'username': user['username'],
            'public_key': user['public_key'],
            'avatar_url': get_safe_avatar_url_func(user, current_user_id),
            'bio': ((user['bio'] if 'bio' in user.keys() else '') or '') if can_view_bio else '',
            'stats': {
                'photos': int(stats['photos'] or 0),
                'videos': int(stats['videos'] or 0),
                'audio': int(stats['audio'] or 0),
                'voices': int(stats['voices'] or 0),
                'files': int(stats['files'] or 0),
                'links': int(stats['links'] or 0),
            },
            'spotify_status': spotify_status,
        },
    }
