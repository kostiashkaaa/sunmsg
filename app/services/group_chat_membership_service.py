from __future__ import annotations


def hide_group_messages_for_member(conn, *, chat_id: str, user_id: int) -> None:
    conn.execute(
        '''
        UPDATE message_receipts AS mr
        SET deleted_for_user = 1,
            updated_at = CURRENT_TIMESTAMP
        FROM messages m
        WHERE mr.message_id = m.id
          AND m.chat_id = ?
          AND mr.user_id = ?
        ''',
        (str(chat_id), int(user_id)),
    )


def remove_group_member_with_cleanup(
    conn,
    *,
    chat_id: str,
    user_id: int,
    hide_messages: bool = True,
) -> None:
    if hide_messages:
        hide_group_messages_for_member(conn, chat_id=chat_id, user_id=user_id)
    conn.execute(
        'DELETE FROM chat_members WHERE user_id = ? AND chat_id = ?',
        (int(user_id), str(chat_id)),
    )
    conn.execute(
        'DELETE FROM contacts WHERE user_id = ? AND chat_id = ?',
        (int(user_id), str(chat_id)),
    )
