def handle_activity_update_event(
    data,
    *,
    session_store,
    request_sid,
    require_payload_dict_func,
    socket_csrf_ok_func,
    socket_rate_ok_func,
    add_active_func,
    remove_active_func,
    count_active_func,
    count_connected_func,
    get_db_connection_func,
    emit_chat_status_for_user_func,
    utc_now_text_func,
    logger,
):
    if 'public_key_pem' not in session_store or 'user_id' not in session_store:
        return
    data = require_payload_dict_func(data)
    if data is None:
        return
    if not socket_csrf_ok_func(data):
        return

    pub = session_store['public_key_pem']
    uid = session_store['user_id']
    if not socket_rate_ok_func(uid, 'activity_update'):
        return
    is_active = bool(data.get('active', True))
    was_active = count_active_func(pub) > 0

    if is_active:
        add_active_func(pub, request_sid)
    else:
        remove_active_func(pub, request_sid)
    still_active = count_active_func(pub) > 0

    if was_active != still_active:
        conn = get_db_connection_func()
        try:
            user_row = conn.execute(
                'SELECT hide_online_status FROM users WHERE id = ?',
                (uid,),
            ).fetchone()
            hide_status = bool(user_row['hide_online_status']) if user_row else False

            if still_active:
                conn.execute('UPDATE users SET is_online = 1 WHERE id = ?', (uid,))
                conn.commit()
                if not hide_status:
                    emit_chat_status_for_user_func(conn, uid, {'public_key': pub, 'online': True})
            else:
                now = utc_now_text_func()
                conn.execute('UPDATE users SET is_online = 0, last_seen = ? WHERE id = ?', (now, uid))
                conn.commit()
                if not hide_status:
                    emit_chat_status_for_user_func(conn, uid, {'public_key': pub, 'online': False, 'last_seen': now})
        finally:
            conn.close()

    logger.debug(
        'User %s activity_update sid=%s active=%s active_tabs=%s connected_tabs=%s',
        uid,
        request_sid,
        is_active,
        count_active_func(pub),
        count_connected_func(pub),
    )
