def fetch_blocked_users_for_user(conn, *, user_id: int) -> list[dict]:
    blocked_users = conn.execute(
        '''
        SELECT b.blocked_id as blocked_user_id, u.username, u.display_name, u.public_key
        FROM block_list b
        JOIN users u ON b.blocked_id = u.id
        WHERE b.blocker_id = ?
        ORDER BY b.created_at DESC
        ''',
        (user_id,),
    ).fetchall()
    return [
        {
            'blocked_user_id': row['blocked_user_id'],
            'blocked_username': row['username'],
            'blocked_display_name': row['display_name'],
            'blocked_public_key': row['public_key'],
        }
        for row in blocked_users
    ]


def emit_block_state_events(
    conn,
    *,
    a_user_id: int,
    b_user_id: int,
    shared_chat_id_func,
    normalize_block_state_func,
    build_block_state_func,
    emit_func,
):
    a_user = conn.execute('SELECT id, public_key FROM users WHERE id = ?', (a_user_id,)).fetchone()
    b_user = conn.execute('SELECT id, public_key FROM users WHERE id = ?', (b_user_id,)).fetchone()
    if not a_user or not b_user:
        return

    chat_id = shared_chat_id_func(conn, a_user_id, b_user_id)

    state_a = normalize_block_state_func(build_block_state_func(conn, a_user_id, b_user_id))
    state_b = normalize_block_state_func(build_block_state_func(conn, b_user_id, a_user_id))

    emit_func(
        'chat_block_state',
        {
            'chat_id': chat_id,
            'partner_user_id': b_user_id,
            **state_a,
        },
        room=a_user['public_key'],
    )
    emit_func(
        'chat_block_state',
        {
            'chat_id': chat_id,
            'partner_user_id': a_user_id,
            **state_b,
        },
        room=b_user['public_key'],
    )

    if chat_id:
        emit_func('force_leave_chat', {'chat_id': chat_id}, room=a_user['public_key'])
        emit_func('force_leave_chat', {'chat_id': chat_id}, room=b_user['public_key'])
        emit_func('partner_stop_typing', {'chat_id': chat_id}, room=a_user['public_key'])
        emit_func('partner_stop_typing', {'chat_id': chat_id}, room=b_user['public_key'])

    if state_b['blocked_me']:
        emit_func(
            'you_are_blocked',
            {
                'blocker_public_key': a_user['public_key'],
                'chat_id': chat_id,
            },
            room=b_user['public_key'],
        )


def block_user_for_user(
    conn,
    *,
    user_id: int,
    blocked_user_id: int,
    normalize_block_state_func,
    build_block_state_func,
    emit_block_state_events_func,
):
    exists = conn.execute('SELECT 1 FROM users WHERE id = ?', (blocked_user_id,)).fetchone()
    if not exists:
        return {'status': 'target_missing'}

    conn.execute(
        '''
        INSERT INTO block_list (blocker_id, blocked_id)
        SELECT ?, ?
        WHERE NOT EXISTS (
            SELECT 1
            FROM block_list
            WHERE blocker_id = ? AND blocked_id = ?
        )
        ''',
        (user_id, blocked_user_id, user_id, blocked_user_id),
    )
    conn.execute(
        '''
        DELETE FROM dialog_requests
        WHERE (sender_id = ? AND receiver_id = ?)
           OR (sender_id = ? AND receiver_id = ?)
        ''',
        (user_id, blocked_user_id, blocked_user_id, user_id),
    )
    conn.commit()

    state = normalize_block_state_func(build_block_state_func(conn, user_id, blocked_user_id))
    emit_block_state_events_func(conn, user_id, blocked_user_id)
    return {'status': 'ok', 'block_state': state}


def unblock_user_for_user(
    conn,
    *,
    user_id: int,
    blocked_user_id: int,
    normalize_block_state_func,
    build_block_state_func,
    emit_block_state_events_func,
):
    conn.execute(
        'DELETE FROM block_list WHERE blocker_id = ? AND blocked_id = ?',
        (user_id, blocked_user_id),
    )
    conn.commit()
    state = normalize_block_state_func(build_block_state_func(conn, user_id, blocked_user_id))
    emit_block_state_events_func(conn, user_id, blocked_user_id)
    return {'status': 'ok', 'block_state': state}
