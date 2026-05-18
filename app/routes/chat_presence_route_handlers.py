from app.services.user_privacy import PRIVACY_ALL, PRIVACY_CONTACTS, PRIVACY_NOBODY, normalize_privacy_choice


def _row_value(row, key, default=None):
    if row is None:
        return default
    try:
        if hasattr(row, 'keys') and key not in row.keys():
            return default
        return row[key]
    except Exception:
        return row.get(key, default) if hasattr(row, 'get') else default


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

    is_contact = has_contact_func(conn, current_user_id, target_user_id)
    last_seen_policy = normalize_privacy_choice(
        _row_value(user, 'last_seen_visibility'),
        default=PRIVACY_NOBODY if bool(_row_value(user, 'hide_online_status')) else PRIVACY_CONTACTS,
    )
    can_view_status = (
        int(current_user_id) == int(target_user_id)
        or last_seen_policy == PRIVACY_ALL
        or (last_seen_policy == PRIVACY_CONTACTS and is_contact)
    )
    if not is_contact and not can_view_status:
        return {'status': 'forbidden'}

    block_state = serialize_block_state_func(
        build_block_state_func(conn, current_user_id, target_user_id)
    )
    if block_state['is_blocked']:
        return {'status': 'blocked', 'block_state': block_state}

    if not can_view_status:
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
