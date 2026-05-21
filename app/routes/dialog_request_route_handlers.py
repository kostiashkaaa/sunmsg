def process_accept_request(  # noqa: PLR0913 - dependency-injected route handler contract
    conn,
    *,
    receiver_user_id: int,
    sender_public_key: str | None,
    accept_dialog_request_workflow_func,
    normalize_block_state_func,
    build_block_state_func,
    generate_chat_id_func,
    default_chat_name: str,
    build_accept_request_socket_events_func,
    get_safe_avatar_url_func,
):
    result = accept_dialog_request_workflow_func(
        conn,
        receiver_user_id=receiver_user_id,
        sender_public_key=sender_public_key,
        normalize_block_state_func=normalize_block_state_func,
        build_block_state_func=build_block_state_func,
        generate_chat_id_func=generate_chat_id_func,
        default_chat_name=default_chat_name,
    )

    if result['status'] == 'sender_missing':
        return {'status': 'sender_missing'}

    if result['status'] == 'blocked':
        return {'status': 'blocked', 'block_state': result['block_state']}

    if result['status'] == 'request_missing':
        return {'status': 'request_missing'}

    events = build_accept_request_socket_events_func(
        chat_id=result['chat_id'],
        sender=result['sender'],
        receiver=result['user_info'],
        receiver_user_id=receiver_user_id,
        sender_public_key=result['sender_public_key'],
        get_safe_avatar_url_func=get_safe_avatar_url_func,
    )
    return {
        'status': 'ok',
        'chat_id': result['chat_id'],
        'events': events,
    }


def process_accept_request_route(  # noqa: PLR0913 - dependency-injected route handler contract
    conn,
    *,
    receiver_user_id: int,
    data,
    process_accept_request_func,
    accept_dialog_request_workflow_func,
    normalize_block_state_func,
    build_block_state_func,
    generate_chat_id_func,
    default_chat_name: str,
    build_accept_request_socket_events_func,
    get_safe_avatar_url_func,
):
    sender_public_key = (data or {}).get('sender_public_key')
    return process_accept_request_func(
        conn,
        receiver_user_id=receiver_user_id,
        sender_public_key=sender_public_key,
        accept_dialog_request_workflow_func=accept_dialog_request_workflow_func,
        normalize_block_state_func=normalize_block_state_func,
        build_block_state_func=build_block_state_func,
        generate_chat_id_func=generate_chat_id_func,
        default_chat_name=default_chat_name,
        build_accept_request_socket_events_func=build_accept_request_socket_events_func,
        get_safe_avatar_url_func=get_safe_avatar_url_func,
    )


def process_get_dialog_requests(
    conn,
    *,
    user_id: int,
    fetch_pending_dialog_requests_for_user_func,
    fetch_pending_outgoing_dialog_requests_for_user_func=None,
):
    try:
        requests_list = fetch_pending_dialog_requests_for_user_func(conn, user_id=user_id)
        if fetch_pending_outgoing_dialog_requests_for_user_func is not None:
            requests_list = [
                *requests_list,
                *fetch_pending_outgoing_dialog_requests_for_user_func(conn, user_id=user_id),
            ]
    except Exception:
        return {'status': 'error'}

    return {'status': 'ok', 'dialog_requests': requests_list}


def process_cancel_request(  # noqa: PLR0913 - dependency-injected route handler contract
    conn,
    *,
    sender_user_id: int,
    receiver_user_id: int | None,
    receiver_public_key: str | None,
    cancel_dialog_request_workflow_func,
    build_cancel_request_socket_events_func,
):
    result = cancel_dialog_request_workflow_func(
        conn,
        sender_user_id=sender_user_id,
        receiver_user_id=receiver_user_id,
        receiver_public_key=receiver_public_key,
    )

    if result['status'] == 'receiver_missing':
        return {'status': 'receiver_missing'}
    if result['status'] == 'sender_missing':
        return {'status': 'sender_missing'}

    events = []
    if result['updated']:
        events = build_cancel_request_socket_events_func(
            sender_public_key=result['sender_public_key'],
            receiver_public_key=result['receiver_public_key'],
        )
    return {'status': 'ok', 'events': events}


def process_cancel_request_route(  # noqa: PLR0913 - dependency-injected route handler contract
    conn,
    *,
    sender_user_id: int,
    data,
    parse_int_func,
    process_cancel_request_func,
    cancel_dialog_request_workflow_func,
    build_cancel_request_socket_events_func,
):
    payload = data or {}
    receiver_user_id = parse_int_func(payload.get('receiver_user_id'))
    receiver_public_key = str(payload.get('receiver_public_key') or '').strip()
    if not receiver_user_id and not receiver_public_key:
        return {'status': 'invalid_payload'}
    if receiver_user_id and int(sender_user_id) == int(receiver_user_id):
        return {'status': 'self_request'}

    return process_cancel_request_func(
        conn,
        sender_user_id=sender_user_id,
        receiver_user_id=receiver_user_id,
        receiver_public_key=receiver_public_key,
        cancel_dialog_request_workflow_func=cancel_dialog_request_workflow_func,
        build_cancel_request_socket_events_func=build_cancel_request_socket_events_func,
    )


def process_decline_request(  # noqa: PLR0913 - dependency-injected route handler contract
    conn,
    *,
    receiver_user_id: int,
    sender_public_key: str | None,
    decline_dialog_request_workflow_func,
    build_decline_request_socket_event_func,
    action: str,
):
    result = decline_dialog_request_workflow_func(
        conn,
        receiver_user_id=receiver_user_id,
        sender_public_key=sender_public_key,
    )

    if result['status'] == 'sender_missing':
        return {'status': 'sender_missing'}

    event = None
    if result['updated']:
        event = build_decline_request_socket_event_func(
            sender_public_key=result['sender_public_key'],
            sender_display_name=result['sender_display_name'],
            action=action,
        )

    return {'status': 'ok', 'event': event}


def process_decline_request_route(  # noqa: PLR0913 - dependency-injected route handler contract
    conn,
    *,
    receiver_user_id: int,
    data,
    process_decline_request_func,
    decline_dialog_request_workflow_func,
    build_decline_request_socket_event_func,
    action: str,
):
    sender_public_key = (data or {}).get('sender_public_key')
    return process_decline_request_func(
        conn,
        receiver_user_id=receiver_user_id,
        sender_public_key=sender_public_key,
        decline_dialog_request_workflow_func=decline_dialog_request_workflow_func,
        build_decline_request_socket_event_func=build_decline_request_socket_event_func,
        action=action,
    )
