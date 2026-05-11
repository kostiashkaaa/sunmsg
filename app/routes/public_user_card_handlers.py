def resolve_public_user_card_context(  # noqa: PLR0913 - dependency-injected resolver contract
    conn,
    *,
    target_username: str,
    viewer_id,
    viewer_row,
    normalize_block_state_func,
    build_block_state_func,
    get_safe_avatar_url_func,
):
    target = conn.execute(
        '''
        SELECT
            id,
            username,
            display_name,
            avatar_url,
            avatar_visibility,
            is_public,
            bio
        FROM users
        WHERE username = ?
        LIMIT 1
        ''',
        (target_username,),
    ).fetchone()
    if not target:
        return {'status': 'target_missing'}

    is_self = bool(viewer_id and int(target['id']) == int(viewer_id))
    is_contact = False
    if viewer_id and not is_self:
        is_contact = (
            conn.execute(
                'SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ? LIMIT 1',
                (viewer_id, target['id']),
            ).fetchone()
            is not None
        )

    if not is_self and not is_contact and not bool(target['is_public']):
        return {'status': 'target_private'}

    block_state = normalize_block_state_func({'blocked_by_me': False, 'blocked_me': False})
    if viewer_id and not is_self:
        block_state = normalize_block_state_func(build_block_state_func(conn, viewer_id, target['id']))

    target_payload = dict(target)
    target_payload['is_contact'] = is_contact
    avatar_url = get_safe_avatar_url_func(target_payload, viewer_id)
    can_message = bool(viewer_id and not is_self and not block_state['is_blocked'])
    can_open_chat = bool(can_message and is_contact)
    can_send_request = bool(can_message and not is_contact)
    viewer_username = str(viewer_row['username']).strip() if viewer_row else ''

    return {
        'status': 'ok',
        'profile': {
            'id': target['id'],
            'username': target['username'],
            'display_name': target['display_name'],
            'bio': (target['bio'] or '').strip(),
            'avatar_url': avatar_url,
        },
        'viewer': {
            'is_authenticated': bool(viewer_id),
            'user_id': viewer_id,
            'username': viewer_username,
        },
        'can_message': can_message,
        'can_open_chat': can_open_chat,
        'can_send_request': can_send_request,
        'block_state': block_state,
    }


def process_public_user_card(  # noqa: PLR0913 - dependency-injected handler contract
    conn,
    *,
    target_username: str,
    viewer_id,
    viewer_row,
    resolve_public_user_card_context_func,
    normalize_block_state_func,
    build_block_state_func,
    get_safe_avatar_url_func,
):
    result = resolve_public_user_card_context_func(
        conn,
        target_username=target_username,
        viewer_id=viewer_id,
        viewer_row=viewer_row,
        normalize_block_state_func=normalize_block_state_func,
        build_block_state_func=build_block_state_func,
        get_safe_avatar_url_func=get_safe_avatar_url_func,
    )
    if result['status'] == 'target_missing':
        return {'status': 'not_found'}
    if result['status'] == 'target_private':
        return {'status': 'private', 'username': target_username}
    return result
