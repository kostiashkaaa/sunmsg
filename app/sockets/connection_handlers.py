def handle_connect_event(  # noqa: PLR0913 - dependency-injected socket handler contract
    auth=None,
    *,
    session_store,
    request_sid,
    request_remote_addr=None,
    clear_invalid_session_user_func,
    socket_connect_csrf_ok_func,
    socket_connect_ip_rate_ok_func=None,
    socket_connect_ip_limit: int = 0,
    socket_connect_ip_window_seconds: int = 60,
    get_db_connection_func,
    join_room_func,
    count_connected_func=None,
    add_connected_func,
    max_connections_per_user: int = 0,
    collect_and_mark_delivered_func,
    emit_delivered_events_func,
    logger,
    database_error_cls=None,
    connection_refused_error_cls,
):
    error_cls = database_error_cls or Exception
    if 'public_key_pem' not in session_store or 'user_id' not in session_store:
        clear_invalid_session_user_func()
        raise connection_refused_error_cls('authentication required')

    if not socket_connect_csrf_ok_func(auth):
        raise connection_refused_error_cls('invalid csrf token')

    pub = session_store['public_key_pem']
    uid = session_store['user_id']
    remote_ip = str(request_remote_addr or '').strip()

    if (
        socket_connect_ip_rate_ok_func is not None
        and int(socket_connect_ip_limit or 0) > 0
        and not socket_connect_ip_rate_ok_func(
            remote_ip,
            limit=int(socket_connect_ip_limit),
            window_seconds=int(socket_connect_ip_window_seconds),
        )
    ):
        logger.warning(
            'Socket connect rejected by IP rate limit user_id=%s sid=%s ip=%s',
            uid,
            request_sid,
            remote_ip or '-',
        )
        raise connection_refused_error_cls('connect rate limit exceeded')

    conn = get_db_connection_func()
    try:
        user_row = conn.execute(
            'SELECT hide_online_status FROM users WHERE id = ?',
            (uid,),
        ).fetchone()
        if not user_row:
            logger.warning('Socket connect rejected for missing user_id=%s sid=%s', uid, request_sid)
            clear_invalid_session_user_func()
            raise connection_refused_error_cls('user not found')

        if (
            count_connected_func is not None
            and int(max_connections_per_user or 0) > 0
        ):
            current_tabs = int(count_connected_func(pub) or 0)
            if current_tabs >= int(max_connections_per_user):
                logger.warning(
                    'Socket connect rejected by tab cap user_id=%s sid=%s tabs=%s limit=%s',
                    uid,
                    request_sid,
                    current_tabs,
                    max_connections_per_user,
                )
                raise connection_refused_error_cls('too many concurrent connections')

        join_room_func(pub)
        total = add_connected_func(pub, request_sid)
        logger.info('User %s connected (sid: %s). Total connected tabs: %s', uid, request_sid, total)

        delivered_rows = collect_and_mark_delivered_func(conn, uid)
        if delivered_rows:
            conn.commit()
            emit_delivered_events_func(delivered_rows)
    except error_cls as exc:
        logger.error('Failed to mark messages delivered on connect for user_id=%s: %s', uid, exc)
        conn.rollback()
    finally:
        conn.close()


def handle_disconnect_event(  # noqa: PLR0913 - dependency-injected socket handler contract
    *,
    session_store,
    request_sid,
    leave_room_func,
    count_active_func,
    remove_connected_func,
    remove_active_func,
    count_connected_func,
    get_db_connection_func,
    emit_chat_status_for_user_func,
    utc_now_text_func,
    logger,
):
    if 'public_key_pem' not in session_store or 'user_id' not in session_store:
        return

    pub = session_store['public_key_pem']
    uid = session_store['user_id']

    leave_room_func(pub)

    was_active = count_active_func(pub) > 0
    remove_connected_func(pub, request_sid)
    remove_active_func(pub, request_sid)
    still_active = count_active_func(pub) > 0

    if was_active and not still_active:
        now = utc_now_text_func()
        conn = get_db_connection_func()
        try:
            user_row = conn.execute(
                'SELECT hide_online_status FROM users WHERE id = ?',
                (uid,),
            ).fetchone()
            conn.execute('UPDATE users SET is_online = 0, last_seen = ? WHERE id = ?', (now, uid))
            conn.commit()
            if user_row and not user_row['hide_online_status']:
                emit_chat_status_for_user_func(conn, uid, {'public_key': pub, 'online': False, 'last_seen': now})
        finally:
            conn.close()

    logger.info(
        'User %s SID %s closed. connected_tabs=%s active_tabs=%s',
        uid,
        request_sid,
        count_connected_func(pub),
        count_active_func(pub),
    )
