def pin_chat_for_user(
    conn,
    *,
    user_id: int,
    chat_id: str,
    ensure_pinned_chats_table_func,
    ensure_chat_exists_func,
):
    ensure_pinned_chats_table_func(conn)

    in_contacts = conn.execute(
        'SELECT 1 FROM contacts c WHERE c.user_id = ? AND c.chat_id = ? LIMIT 1',
        (user_id, chat_id),
    ).fetchone() is not None

    is_group_member = False
    try:
        is_group_member = conn.execute(
            'SELECT 1 FROM chat_members cm WHERE cm.user_id = ? AND cm.chat_id = ? LIMIT 1',
            (user_id, chat_id),
        ).fetchone() is not None
    except Exception:  # noqa: BLE001
        is_group_member = False

    if not in_contacts and not is_group_member:
        return {'status': 'chat_not_found'}

    existing_pin = conn.execute(
        'SELECT pin_order FROM pinned_chats WHERE user_id = ? AND chat_id = ?',
        (user_id, chat_id),
    ).fetchone()
    if existing_pin is not None:
        return {'status': 'ok', 'pin_order': int(existing_pin['pin_order'])}

    max_order = conn.execute(
        'SELECT COALESCE(MAX(pin_order), -1) FROM pinned_chats WHERE user_id = ?',
        (user_id,),
    ).fetchone()[0]
    new_order = int(max_order) + 1
    ensure_chat_exists_func(conn, chat_id)
    conn.execute(
        'INSERT INTO pinned_chats (user_id, chat_id, pin_order) VALUES (?, ?, ?)',
        (user_id, chat_id, new_order),
    )
    conn.commit()
    return {'status': 'ok', 'pin_order': new_order}


def unpin_chat_for_user(
    conn,
    *,
    user_id: int,
    chat_id: str,
    ensure_pinned_chats_table_func,
):
    ensure_pinned_chats_table_func(conn)
    conn.execute('DELETE FROM pinned_chats WHERE user_id = ? AND chat_id = ?', (user_id, chat_id))
    conn.commit()


def normalize_reordered_pinned_chat_ids(existing_ids, ordered_ids) -> list[str]:
    existing_chat_ids = [str(chat_id) for chat_id in existing_ids]
    existing_set = set(existing_chat_ids)

    normalized_ids = []
    seen_ids = set()
    for raw_chat_id in ordered_ids:
        normalized_chat_id = str(raw_chat_id).strip()
        if not normalized_chat_id or normalized_chat_id not in existing_set or normalized_chat_id in seen_ids:
            continue
        normalized_ids.append(normalized_chat_id)
        seen_ids.add(normalized_chat_id)

    for existing_chat_id in existing_chat_ids:
        if existing_chat_id not in seen_ids:
            normalized_ids.append(existing_chat_id)
    return normalized_ids


def reorder_pinned_chats_for_user(
    conn,
    *,
    user_id: int,
    ordered_ids,
    ensure_pinned_chats_table_func,
):
    ensure_pinned_chats_table_func(conn)
    existing_rows = conn.execute(
        '''
        SELECT chat_id
        FROM pinned_chats
        WHERE user_id = ?
        ORDER BY pin_order ASC, pinned_at ASC
        ''',
        (user_id,),
    ).fetchall()
    existing_ids = [str(row['chat_id']) for row in existing_rows]
    normalized_ids = normalize_reordered_pinned_chat_ids(existing_ids, ordered_ids)

    for idx, chat_id in enumerate(normalized_ids):
        conn.execute(
            'UPDATE pinned_chats SET pin_order = ? WHERE user_id = ? AND chat_id = ?',
            (idx, user_id, str(chat_id)),
        )
    conn.commit()
    return normalized_ids
