def process_public_user_card_route(  # noqa: PLR0913 - dependency-injected route handler contract
    conn,
    *,
    target_username: str,
    resolve_viewer_context_func,
    process_public_user_card_func,
    resolve_public_user_card_context_func,
    normalize_block_state_func,
    build_block_state_func,
    get_safe_avatar_url_func,
):
    viewer_id, viewer = resolve_viewer_context_func(conn)
    result = process_public_user_card_func(
        conn,
        target_username=target_username,
        viewer_id=viewer_id,
        viewer_row=viewer,
        resolve_public_user_card_context_func=resolve_public_user_card_context_func,
        normalize_block_state_func=normalize_block_state_func,
        build_block_state_func=build_block_state_func,
        get_safe_avatar_url_func=get_safe_avatar_url_func,
    )
    return result


def process_start_dialog_from_public_card_route(  # noqa: PLR0913 - dependency-injected route handler contract
    conn,
    *,
    target_username: str,
    resolve_viewer_context_func,
    process_start_dialog_from_public_card_func,
    start_dialog_from_public_card_workflow_func,
    normalize_block_state_func,
    build_block_state_func,
    send_dialog_request_workflow_func,
):
    viewer_id, viewer = resolve_viewer_context_func(conn)
    if not viewer_id or not viewer:
        return {'status': 'session_expired'}

    result = process_start_dialog_from_public_card_func(
        conn,
        viewer_id=viewer_id,
        viewer_row=viewer,
        target_username=target_username,
        start_dialog_from_public_card_workflow_func=start_dialog_from_public_card_workflow_func,
        normalize_block_state_func=normalize_block_state_func,
        build_block_state_func=build_block_state_func,
        send_dialog_request_workflow_func=send_dialog_request_workflow_func,
    )
    return result
