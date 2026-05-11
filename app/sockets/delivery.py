from collections import defaultdict


def _message_receipts_table_exists(conn) -> bool:
    return (
        conn.execute(
            '''
            SELECT 1
            FROM information_schema.tables
            WHERE table_schema = current_schema()
              AND table_name = 'message_receipts'
            '''
        ).fetchone()
        is not None
    )


def _query_undelivered_rows_without_receipts(conn, receiver_id: int, chat_id: str | None):
    if chat_id:
        return conn.execute(
            '''
            SELECT m.id, m.chat_id, u.public_key AS sender_public_key
            FROM messages m
            JOIN users u ON u.id = m.sender_id
            WHERE m.receiver_id = ? AND m.is_delivered = 0 AND m.chat_id = ?
            ''',
            (receiver_id, chat_id),
        ).fetchall()
    return conn.execute(
        '''
        SELECT m.id, m.chat_id, u.public_key AS sender_public_key
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        WHERE m.receiver_id = ? AND m.is_delivered = 0
        ''',
        (receiver_id,),
    ).fetchall()


def _mark_messages_delivered_without_receipts(conn, receiver_id: int, chat_id: str | None) -> None:
    if chat_id:
        conn.execute(
            'UPDATE messages SET is_delivered = 1 WHERE receiver_id = ? AND is_delivered = 0 AND chat_id = ?',
            (receiver_id, chat_id),
        )
        return
    conn.execute(
        'UPDATE messages SET is_delivered = 1 WHERE receiver_id = ? AND is_delivered = 0',
        (receiver_id,),
    )


def _query_undelivered_rows_with_receipts(conn, receiver_id: int, chat_id: str | None):
    if chat_id:
        return conn.execute(
            '''
            SELECT m.id, m.chat_id, u.public_key AS sender_public_key
            FROM messages m
            JOIN users u ON u.id = m.sender_id
            JOIN message_receipts mr ON mr.message_id = m.id
            WHERE mr.user_id = ?
              AND mr.is_delivered = 0
              AND mr.deleted_for_user = 0
              AND m.chat_id = ?
            ''',
            (receiver_id, chat_id),
        ).fetchall()
    return conn.execute(
        '''
        SELECT m.id, m.chat_id, u.public_key AS sender_public_key
        FROM messages m
        JOIN users u ON u.id = m.sender_id
        JOIN message_receipts mr ON mr.message_id = m.id
        WHERE mr.user_id = ?
          AND mr.is_delivered = 0
          AND mr.deleted_for_user = 0
        ''',
        (receiver_id,),
    ).fetchall()


def _mark_receipts_delivered(conn, receiver_id: int, chat_id: str | None) -> None:
    if chat_id:
        conn.execute(
            '''
            UPDATE message_receipts AS mr
            SET is_delivered = 1,
                delivered_at = COALESCE(mr.delivered_at, CURRENT_TIMESTAMP),
                updated_at = CURRENT_TIMESTAMP
            FROM messages m
            WHERE mr.message_id = m.id
              AND mr.user_id = ?
              AND mr.is_delivered = 0
              AND mr.deleted_for_user = 0
              AND m.chat_id = ?
            ''',
            (receiver_id, chat_id),
        )
        return
    conn.execute(
        '''
        UPDATE message_receipts
        SET is_delivered = 1,
            delivered_at = COALESCE(delivered_at, CURRENT_TIMESTAMP),
            updated_at = CURRENT_TIMESTAMP
        WHERE user_id = ?
          AND is_delivered = 0
          AND deleted_for_user = 0
        ''',
        (receiver_id,),
    )


def _mark_messages_delivered_from_receipts(conn, receiver_id: int) -> None:
    conn.execute(
        '''
        UPDATE messages AS m
        SET is_delivered = 1
        WHERE m.receiver_id = ?
          AND m.is_delivered = 0
          AND EXISTS (
              SELECT 1
              FROM message_receipts mr
              WHERE mr.message_id = m.id
                AND mr.user_id = ?
                AND mr.is_delivered = 1
          )
        ''',
        (receiver_id, receiver_id),
    )


def collect_and_mark_delivered(conn, receiver_id: int, *, chat_id: str | None = None):
    use_receipts = _message_receipts_table_exists(conn)
    if use_receipts:
        try:
            rows = _query_undelivered_rows_with_receipts(conn, receiver_id, chat_id)
        except Exception:  # noqa: BLE001
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001
                pass
            use_receipts = False
            rows = _query_undelivered_rows_without_receipts(conn, receiver_id, chat_id)
        else:
            if not rows:
                fallback_rows = _query_undelivered_rows_without_receipts(conn, receiver_id, chat_id)
                if fallback_rows:
                    rows = fallback_rows
                    use_receipts = False
    else:
        rows = _query_undelivered_rows_without_receipts(conn, receiver_id, chat_id)

    if not rows:
        return []
    if use_receipts:
        _mark_receipts_delivered(conn, receiver_id, chat_id)
        _mark_messages_delivered_from_receipts(conn, receiver_id)
        return rows
    _mark_messages_delivered_without_receipts(conn, receiver_id, chat_id)
    return rows


def emit_delivered_events(delivered_rows, *, emit_func):
    grouped = defaultdict(list)
    for row in delivered_rows:
        sender_pub = row['sender_public_key']
        if not sender_pub:
            continue
        grouped[(sender_pub, row['chat_id'])].append(int(row['id']))

    for (sender_pub, row_chat_id), message_ids in grouped.items():
        emit_func(
            'messages_delivered',
            {
                'chat_id': row_chat_id,
                'message_ids': message_ids,
            },
            room=sender_pub,
        )
