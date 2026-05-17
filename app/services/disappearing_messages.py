from __future__ import annotations

import logging
import time

from app.db.schema import table_columns

logger = logging.getLogger(__name__)

VALID_TIMERS = {0, 30, 300, 3600, 86400, 604800, 2592000}
TIMER_LABELS = {
    0: 'off',
    30: '30s',
    300: '5m',
    3600: '1h',
    86400: '24h',
    604800: '7d',
    2592000: '30d',
}


def normalize_auto_delete_seconds(value) -> int | None:
    try:
        v = int(value)
    except (TypeError, ValueError):
        return None
    if v not in VALID_TIMERS:
        return None
    return v


def set_chat_auto_delete(conn, chat_id: str, seconds: int) -> None:
    conn.execute(
        'UPDATE chats SET auto_delete_seconds = ? WHERE chat_id = ?',
        (seconds, chat_id),
    )


def get_chat_auto_delete(conn, chat_id: str) -> int:
    if 'auto_delete_seconds' not in table_columns(conn, 'chats'):
        return 0
    row = conn.execute(
        'SELECT auto_delete_seconds FROM chats WHERE chat_id = ?',
        (chat_id,),
    ).fetchone()
    if not row:
        return 0
    try:
        return int(row['auto_delete_seconds'] or 0)
    except (TypeError, ValueError):
        return 0


def apply_expiry_to_new_message(conn, message_id: int, chat_id: str) -> int | None:
    """Set expires_at on a newly inserted message if the chat has auto-delete enabled.
    Returns the unix timestamp when the message will expire, or None."""
    seconds = get_chat_auto_delete(conn, chat_id)
    if not seconds:
        return None
    expires_at = int(time.time()) + seconds
    conn.execute(
        'UPDATE messages SET expires_at = ? WHERE id = ?',
        (expires_at, message_id),
    )
    return expires_at


def _collect_expired_message_rooms(conn, message_ids: list[int]) -> dict[str, set[str]]:
    if not message_ids:
        return {}
    placeholders = ', '.join('?' * len(message_ids))
    rooms_by_chat: dict[str, set[str]] = {}
    rows = conn.execute(
        f'''
        SELECT DISTINCT m.chat_id, u.public_key
        FROM messages m
        JOIN users u ON u.id = m.sender_id OR u.id = m.receiver_id
        WHERE m.id IN ({placeholders})
          AND COALESCE(u.public_key, '') <> ''
        UNION
        SELECT DISTINCT cm.chat_id, u.public_key
        FROM messages m
        JOIN chat_members cm ON cm.chat_id = m.chat_id
        JOIN users u ON u.id = cm.user_id
        WHERE m.id IN ({placeholders})
          AND COALESCE(u.public_key, '') <> ''
        ''',
        (*message_ids, *message_ids),
    ).fetchall()
    for row in rows:
        chat_id = str(row['chat_id'] or '').strip()
        public_key = str(row['public_key'] or '').strip()
        if not chat_id or not public_key:
            continue
        rooms_by_chat.setdefault(chat_id, set()).add(public_key)
    return rooms_by_chat


def cleanup_expired_messages(emit_func=None) -> int:
    """Delete expired messages and optionally notify via socket. Returns deleted count."""
    from app.database import get_db_connection
    conn = get_db_connection()
    try:
        now_ts = int(time.time())
        expired = conn.execute(
            '''
            SELECT m.id, m.chat_id
            FROM messages m
            WHERE m.expires_at IS NOT NULL AND m.expires_at <= ?
            LIMIT 500
            ''',
            (now_ts,),
        ).fetchall()

        if not expired:
            return 0

        ids = [row['id'] for row in expired]
        chat_ids = list({row['chat_id'] for row in expired})
        participant_rooms_by_chat = _collect_expired_message_rooms(conn, ids)

        placeholders = ', '.join('?' * len(ids))
        conn.execute(f'DELETE FROM messages WHERE id IN ({placeholders})', ids)
        conn.commit()

        if emit_func and expired:
            for chat_id in chat_ids:
                chat_expired_ids = [row['id'] for row in expired if row['chat_id'] == chat_id]
                try:
                    payload = {'chat_id': chat_id, 'message_ids': chat_expired_ids}
                    emit_func('messages_expired', payload, room=chat_id)
                    for room in participant_rooms_by_chat.get(str(chat_id), set()):
                        emit_func('messages_expired', payload, room=room)
                except Exception:
                    logger.debug('Could not emit messages_expired for chat %s', chat_id)

        logger.info('Disappearing messages: deleted %s expired messages', len(ids))
        return len(ids)
    except Exception:
        logger.exception('Disappearing messages cleanup failed')
        return 0
    finally:
        conn.close()
