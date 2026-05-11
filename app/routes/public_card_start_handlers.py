def start_dialog_from_public_card_workflow(  # noqa: PLR0913 - dependency-injected workflow contract
    conn,
    *,
    viewer_id: int,
    viewer_row,
    target_username: str,
    normalize_block_state_func,
    build_block_state_func,
    send_dialog_request_workflow_func,
):
    target = conn.execute(
        '''
        SELECT
            id,
            username,
            display_name,
            public_key,
            avatar_url,
            avatar_visibility,
            is_public,
            auto_decline_requests
        FROM users
        WHERE username = ?
        LIMIT 1
        ''',
        (target_username,),
    ).fetchone()
    if not target:
        return {'status': 'target_missing'}

    if int(target['id']) == int(viewer_id):
        return {'status': 'open_self', 'viewer_username': viewer_row['username']}

    is_contact = (
        conn.execute(
            'SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ? LIMIT 1',
            (viewer_id, target['id']),
        ).fetchone()
        is not None
    )
    if not is_contact and not bool(target['is_public']):
        return {'status': 'target_private'}

    block_state = normalize_block_state_func(build_block_state_func(conn, viewer_id, target['id']))
    if block_state['is_blocked']:
        return {'status': 'blocked'}

    if is_contact:
        return {
            'status': 'open_existing',
            'viewer_username': viewer_row['username'],
            'target_user_id': target['id'],
        }

    if bool(target['auto_decline_requests']):
        return {'status': 'auto_decline'}

    send_result = send_dialog_request_workflow_func(
        conn,
        sender_user_id=viewer_id,
        receiver_user_id=target['id'],
        normalize_block_state_func=normalize_block_state_func,
        build_block_state_func=build_block_state_func,
    )
    return {
        'status': 'request_sent',
        'event': send_result.get('event'),
    }


def process_start_dialog_from_public_card(  # noqa: PLR0913 - dependency-injected route handler contract
    conn,
    *,
    viewer_id: int,
    viewer_row,
    target_username: str,
    start_dialog_from_public_card_workflow_func,
    normalize_block_state_func,
    build_block_state_func,
    send_dialog_request_workflow_func,
):
    result = start_dialog_from_public_card_workflow_func(
        conn,
        viewer_id=viewer_id,
        viewer_row=viewer_row,
        target_username=target_username,
        normalize_block_state_func=normalize_block_state_func,
        build_block_state_func=build_block_state_func,
        send_dialog_request_workflow_func=send_dialog_request_workflow_func,
    )

    status = result.get('status')
    if status in ('target_missing', 'target_private'):
        return {'status': 'not_found'}
    if status == 'open_self':
        return {'status': 'open_self', 'viewer_username': result.get('viewer_username')}
    if status == 'blocked':
        return {'status': 'blocked'}
    if status == 'open_existing':
        return {
            'status': 'open_existing',
            'viewer_username': result.get('viewer_username'),
            'target_user_id': result.get('target_user_id'),
        }
    if status == 'auto_decline':
        return {'status': 'auto_decline'}

    return {'status': 'request_sent', 'event': result.get('event')}
