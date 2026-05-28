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
    user_room = f'user_{uid}'
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

        connection_limit = int(max_connections_per_user or 0)
        if connection_limit > 0:
            try:
                total = add_connected_func(pub, request_sid, max_connections=connection_limit)
            except TypeError:
                current_tabs = int(count_connected_func(pub) or 0) if count_connected_func is not None else 0
                if current_tabs >= connection_limit:
                    logger.warning(
                        'Socket connect rejected by tab cap user_id=%s sid=%s tabs=%s limit=%s',
                        uid,
                        request_sid,
                        current_tabs,
                        max_connections_per_user,
                    )
                    raise connection_refused_error_cls('too many concurrent connections')
                total = add_connected_func(pub, request_sid)
        else:
            total = add_connected_func(pub, request_sid)
        if int(total or 0) < 0:
            logger.warning(
                'Socket connect rejected by tab cap user_id=%s sid=%s tabs=%s limit=%s',
                uid,
                request_sid,
                count_connected_func(pub) if count_connected_func is not None else '-',
                max_connections_per_user,
            )
            raise connection_refused_error_cls('too many concurrent connections')

        join_room_func(pub)
        join_room_func(user_room)
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


def _terminate_calls_after_disconnect_grace(
    *,
    uid,
    pub,
    count_connected_func,
    terminate_calls_func,
    sleep_func,
    grace_seconds,
    logger,
):
    try:
        sleep_func(grace_seconds)
        if int(count_connected_func(pub) or 0) > 0:
            return
        terminate_calls_func(uid)
    except Exception:  # noqa: BLE001
        logger.exception('Call cleanup on delayed disconnect failed for user_id=%s', uid)


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
    terminate_calls_func=None,
    terminate_calls_grace_seconds=0,
    start_background_task_func=None,
    sleep_func=None,
):
    if 'public_key_pem' not in session_store or 'user_id' not in session_store:
        return

    pub = session_store['public_key_pem']
    uid = session_store['user_id']
    user_room = f'user_{uid}'

    leave_room_func(pub)
    leave_room_func(user_room)

    was_active = count_active_func(pub) > 0
    remove_connected_func(pub, request_sid)
    remove_active_func(pub, request_sid)
    still_active = count_active_func(pub) > 0

    # When the user's very last tab/device closes, end any call they are still
    # in — otherwise an 'active' call hangs forever and blocks the chat.
    if terminate_calls_func is not None and int(count_connected_func(pub) or 0) <= 0:
        grace_seconds = max(0, int(terminate_calls_grace_seconds or 0))
        if grace_seconds > 0 and callable(start_background_task_func) and callable(sleep_func):
            start_background_task_func(
                _terminate_calls_after_disconnect_grace,
                uid=uid,
                pub=pub,
                count_connected_func=count_connected_func,
                terminate_calls_func=terminate_calls_func,
                sleep_func=sleep_func,
                grace_seconds=grace_seconds,
                logger=logger,
            )
        else:
            try:
                terminate_calls_func(uid)
            except Exception:  # noqa: BLE001
                logger.exception('Call cleanup on disconnect failed for user_id=%s', uid)

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
