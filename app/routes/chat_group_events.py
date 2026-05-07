from __future__ import annotations

from typing import Any, Callable

from app.services.chat_members import CHAT_TYPE_GROUP, list_chat_member_public_keys


def emit_group_event(
    conn,
    *,
    chat_id: str,
    event_name: str,
    payload: dict[str, Any],
    socketio_emit_func: Callable[..., Any],
) -> None:
    normalized_chat_id = str(chat_id or '').strip()
    if not normalized_chat_id:
        return
    socketio_emit_func(event_name, payload, room=normalized_chat_id)
    for member in list_chat_member_public_keys(conn, normalized_chat_id):
        member_pub = str(member['public_key'] or '')
        if member_pub:
            socketio_emit_func(event_name, payload, room=member_pub)


def emit_group_snapshot(conn, *, chat_id: str, socketio_emit_func: Callable[..., Any]) -> None:
    normalized_chat_id = str(chat_id or '').strip()
    if not normalized_chat_id:
        return
    chat_row = conn.execute(
        '''
        SELECT chat_id, chat_name, chat_description, chat_avatar_url
        FROM chats
        WHERE chat_id = ?
        ''',
        (normalized_chat_id,),
    ).fetchone()
    if not chat_row:
        return
    payload = {
        'chat_id': str(chat_row['chat_id']),
        'chat_name': str(chat_row['chat_name'] or ''),
        'chat_description': str(chat_row['chat_description'] or ''),
        'chat_avatar_url': str(chat_row['chat_avatar_url'] or ''),
        'chat_type': CHAT_TYPE_GROUP,
    }
    emit_group_event(
        conn,
        chat_id=normalized_chat_id,
        event_name='group_chat_updated',
        payload=payload,
        socketio_emit_func=socketio_emit_func,
    )
