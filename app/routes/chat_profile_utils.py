def shared_chat_id(conn, user_id: int, contact_id: int) -> str | None:
    row = conn.execute(
        '''
        SELECT chat_id
        FROM contacts
        WHERE user_id = ? AND contact_id = ?
        LIMIT 1
        ''',
        (user_id, contact_id),
    ).fetchone()
    return row['chat_id'] if row else None


def fetch_conversation_stats(conn, user_id: int, other_user_id: int):
    chat_id = shared_chat_id(conn, user_id, other_user_id)
    if chat_id:
        return conn.execute(
            '''
            SELECT
                SUM(CASE WHEN message_type = 'photo' THEN 1 ELSE 0 END) AS photos,
                SUM(CASE WHEN message_type = 'video' THEN 1 ELSE 0 END) AS videos,
                SUM(CASE WHEN message_type = 'audio' THEN 1 ELSE 0 END) AS audio,
                SUM(CASE WHEN message_type = 'voice' THEN 1 ELSE 0 END) AS voices,
                SUM(CASE WHEN message_type = 'file' THEN 1 ELSE 0 END) AS files,
                SUM(CASE WHEN message_type = 'link' THEN 1 ELSE 0 END) AS links
            FROM messages
            WHERE chat_id = ?
            ''',
            (chat_id,),
        ).fetchone()

    return conn.execute(
        '''
        SELECT
            SUM(CASE WHEN message_type = 'photo' THEN 1 ELSE 0 END) AS photos,
            SUM(CASE WHEN message_type = 'video' THEN 1 ELSE 0 END) AS videos,
            SUM(CASE WHEN message_type = 'audio' THEN 1 ELSE 0 END) AS audio,
            SUM(CASE WHEN message_type = 'voice' THEN 1 ELSE 0 END) AS voices,
            SUM(CASE WHEN message_type = 'file' THEN 1 ELSE 0 END) AS files,
            SUM(CASE WHEN message_type = 'link' THEN 1 ELSE 0 END) AS links
        FROM messages
        WHERE (sender_id = ? AND receiver_id = ?) OR (sender_id = ? AND receiver_id = ?)
        ''',
        (user_id, other_user_id, other_user_id, user_id),
    ).fetchone()
