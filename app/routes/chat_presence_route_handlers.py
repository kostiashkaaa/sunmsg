def process_get_online_status(  # noqa: PLR0913 - dependency-injected route handler contract
    conn,
    *,
    current_user_id: int,
    target_raw,
    parse_int_func,
    fetch_user_func,
    has_contact_func,
    build_block_state_func,
    serialize_block_state_func,
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

    if not has_contact_func(conn, current_user_id, target_user_id):
        return {'status': 'forbidden'}

    block_state = serialize_block_state_func(
        build_block_state_func(conn, current_user_id, target_user_id)
    )
    if block_state['is_blocked']:
        return {'status': 'blocked', 'block_state': block_state}

    if user['hide_online_status']:
        online = False
        last_seen = None
    else:
        online = is_effectively_online_func(
            user['public_key'],
            persisted=bool(user['is_online']),
        )
        last_seen = user['last_seen']

    return {
        'status': 'ok',
        'payload': {
            'success': True,
            'online': online,
            'last_seen': last_seen,
            'avatar_url': get_safe_avatar_url_func(user, current_user_id),
        },
    }
