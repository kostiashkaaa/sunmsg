def process_block_user(
    conn,
    *,
    user_id: int,
    blocked_user_id: int,
    block_user_for_user_func,
    normalize_block_state_func,
    build_block_state_func,
    emit_block_state_events_func,
    logger_exception_func,
):
    try:
        result = block_user_for_user_func(
            conn,
            user_id=user_id,
            blocked_user_id=blocked_user_id,
            normalize_block_state_func=normalize_block_state_func,
            build_block_state_func=build_block_state_func,
            emit_block_state_events_func=emit_block_state_events_func,
        )
    except Exception:
        logger_exception_func('block_user error')
        return {'status': 'error'}

    if result['status'] == 'target_missing':
        return {'status': 'target_missing'}

    return {'status': 'ok', 'block_state': result['block_state']}


def process_unblock_user(
    conn,
    *,
    user_id: int,
    blocked_user_id: int,
    unblock_user_for_user_func,
    normalize_block_state_func,
    build_block_state_func,
    emit_block_state_events_func,
):
    result = unblock_user_for_user_func(
        conn,
        user_id=user_id,
        blocked_user_id=blocked_user_id,
        normalize_block_state_func=normalize_block_state_func,
        build_block_state_func=build_block_state_func,
        emit_block_state_events_func=emit_block_state_events_func,
    )
    return {'status': 'ok', 'block_state': result['block_state']}


def process_get_blocked_users(
    conn,
    *,
    user_id: int,
    fetch_blocked_users_for_user_func,
):
    blocked_users = fetch_blocked_users_for_user_func(conn, user_id=user_id)
    return {'status': 'ok', 'blocked_users': blocked_users}


def process_block_user_route(
    conn,
    *,
    user_id: int,
    data,
    parse_int_func,
    process_block_user_func,
    block_user_for_user_func,
    normalize_block_state_func,
    build_block_state_func,
    emit_block_state_events_func,
    logger_exception_func,
):
    blocked_user_id = parse_int_func((data or {}).get('blocked_user_id'))
    if not blocked_user_id:
        return {'status': 'invalid_blocked_user_id'}
    if int(user_id) == int(blocked_user_id):
        return {'status': 'self_block_forbidden'}

    return process_block_user_func(
        conn,
        user_id=user_id,
        blocked_user_id=blocked_user_id,
        block_user_for_user_func=block_user_for_user_func,
        normalize_block_state_func=normalize_block_state_func,
        build_block_state_func=build_block_state_func,
        emit_block_state_events_func=emit_block_state_events_func,
        logger_exception_func=logger_exception_func,
    )


def process_unblock_user_route(
    conn,
    *,
    user_id: int,
    data,
    parse_int_func,
    process_unblock_user_func,
    unblock_user_for_user_func,
    normalize_block_state_func,
    build_block_state_func,
    emit_block_state_events_func,
):
    blocked_user_id = parse_int_func((data or {}).get('blocked_user_id'))
    if not blocked_user_id:
        return {'status': 'invalid_blocked_user_id'}

    return process_unblock_user_func(
        conn,
        user_id=user_id,
        blocked_user_id=blocked_user_id,
        unblock_user_for_user_func=unblock_user_for_user_func,
        normalize_block_state_func=normalize_block_state_func,
        build_block_state_func=build_block_state_func,
        emit_block_state_events_func=emit_block_state_events_func,
    )
