def shared_chat_id(conn, a_user_id: int, b_user_id: int):
    row = conn.execute(
        '''
        SELECT c1.chat_id
        FROM contacts c1
        JOIN contacts c2 ON c1.chat_id = c2.chat_id
        WHERE c1.user_id = ? AND c1.contact_id = ?
          AND c2.user_id = ? AND c2.contact_id = ?
        LIMIT 1
        ''',
        (a_user_id, b_user_id, b_user_id, a_user_id),
    ).fetchone()
    return row['chat_id'] if row else None


def resolve_viewer_context(conn, session_store):
    raw_user_id = session_store.get('user_id')
    if raw_user_id is None:
        return None, None

    try:
        viewer_id = int(raw_user_id)
    except (TypeError, ValueError):
        return None, None

    viewer = conn.execute(
        'SELECT id, username FROM users WHERE id = ?',
        (viewer_id,),
    ).fetchone()
    if not viewer:
        return None, None

    return viewer_id, viewer


def ensure_pinned_chats_table(conn):
    conn.execute(
        '''
        CREATE TABLE IF NOT EXISTS pinned_chats (
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            chat_id TEXT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
            pin_order INTEGER NOT NULL DEFAULT 0,
            pinned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, chat_id)
        )
        '''
    )
    conn.execute(
        '''
        CREATE INDEX IF NOT EXISTS idx_pinned_chats_user_id
        ON pinned_chats(user_id, pin_order)
        '''
    )
