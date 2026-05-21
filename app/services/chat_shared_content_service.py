from __future__ import annotations

from app.services.chat_members import get_chat_type
from app.services.user import get_safe_avatar_url, is_contact_for_avatar


SHARED_CONTENT_TYPES = {
    'all': ('photo', 'video', 'audio', 'voice', 'file', 'link', 'call'),
    'media': ('photo', 'video'),
    'files': ('file',),
    'audio': ('audio',),
    'voices': ('voice',),
    'calls': ('call',),
    'links': ('link',),
}


def normalize_shared_content_type(value) -> str:
    normalized = str(value or 'all').strip().lower()
    return normalized if normalized in SHARED_CONTENT_TYPES else 'all'


def _safe_sender_avatar_url(conn, *, row, viewer_id: int):
    sender_id = int(row['sender_user_id'])
    return get_safe_avatar_url(
        {
            'id': sender_id,
            'avatar_url': row['sender_avatar_url'],
            'avatar_visibility': row['sender_avatar_visibility'] if 'sender_avatar_visibility' in row.keys() else 'all',
            'is_contact': is_contact_for_avatar(conn, viewer_id=viewer_id, owner_id=sender_id),
        },
        viewer_id,
    )


def _serialize_candidate(conn, row, *, viewer_id: int) -> dict:
    return {
        'id': int(row['id']),
        'chat_id': row['chat_id'],
        'sender_user_id': row['sender_user_id'],
        'sender_public_key': row['sender_public_key'],
        'sender_display_name': str(row['sender_display_name'] or ''),
        'sender_username': str(row['sender_username'] or ''),
        'sender_avatar_url': _safe_sender_avatar_url(conn, row=row, viewer_id=viewer_id),
        'message': row['message'],
        'message_type': row['message_type'] or 'text',
        'created_at': row['created_at'],
        'reply_to_id': None,
        'reply_message': None,
        'reply_sender_pub': None,
        'reactions': [],
    }


def load_shared_content_candidates(
    conn,
    *,
    user_id: int,
    chat_id: str,
    content_type: str = 'all',
    limit: int = 80,
    before_id: int | None = None,
    get_chat_partner_func,
) -> dict:
    partner = get_chat_partner_func(conn, user_id, chat_id)
    if not partner:
        return {'status': 'forbidden'}

    normalized_type = normalize_shared_content_type(content_type)
    message_types = SHARED_CONTENT_TYPES[normalized_type]
    safe_limit = max(1, min(int(limit or 80), 120))
    page_size = safe_limit + 1
    placeholders = ', '.join('?' for _ in message_types)
    before_sql = ' AND m.id < ?' if before_id is not None else ''

    is_group_chat = get_chat_type(conn, chat_id) == 'group'
    if is_group_chat:
        params = [user_id, chat_id, *message_types]
        if before_id is not None:
            params.append(before_id)
        params.append(page_size)
        rows = conn.execute(
            f'''
            SELECT
                m.id,
                m.chat_id,
                m.sender_id AS sender_user_id,
                m.message,
                COALESCE(NULLIF(m.message_type, ''), 'text') AS message_type,
                m.created_at,
                us.public_key AS sender_public_key,
                COALESCE(NULLIF(us.display_name, ''), NULLIF(us.username, ''), 'Participant') AS sender_display_name,
                COALESCE(us.username, '') AS sender_username,
                us.avatar_url AS sender_avatar_url,
                us.avatar_visibility AS sender_avatar_visibility
            FROM messages m
            JOIN message_receipts mr ON mr.message_id = m.id AND mr.user_id = ?
            LEFT JOIN users us ON us.id = m.sender_id
            WHERE m.chat_id = ?
              AND mr.deleted_for_user = 0
              AND COALESCE(NULLIF(m.message_type, ''), 'text') IN ({placeholders})
              {before_sql}
            ORDER BY m.id DESC
            LIMIT ?
            ''',
            tuple(params),
        ).fetchall()
    else:
        params = [chat_id, user_id, user_id, *message_types]
        if before_id is not None:
            params.append(before_id)
        params.append(page_size)
        rows = conn.execute(
            f'''
            SELECT
                m.id,
                m.chat_id,
                m.sender_id AS sender_user_id,
                m.message,
                COALESCE(NULLIF(m.message_type, ''), 'text') AS message_type,
                m.created_at,
                us.public_key AS sender_public_key,
                COALESCE(NULLIF(us.display_name, ''), NULLIF(us.username, ''), 'Participant') AS sender_display_name,
                COALESCE(us.username, '') AS sender_username,
                us.avatar_url AS sender_avatar_url,
                us.avatar_visibility AS sender_avatar_visibility
            FROM messages m
            LEFT JOIN users us ON us.id = m.sender_id
            WHERE m.chat_id = ?
              AND (
                (m.sender_id = ? AND m.deleted_by_sender = 0)
                OR
                (m.receiver_id = ? AND m.deleted_by_receiver = 0)
              )
              AND COALESCE(NULLIF(m.message_type, ''), 'text') IN ({placeholders})
              {before_sql}
            ORDER BY m.id DESC
            LIMIT ?
            ''',
            tuple(params),
        ).fetchall()

    visible_rows = list(rows[:safe_limit])
    has_more_before = len(rows) > safe_limit
    next_before_id = int(visible_rows[-1]['id']) if has_more_before and visible_rows else None
    return {
        'status': 'ok',
        'payload': {
            'success': True,
            'chat_id': chat_id,
            'type': normalized_type,
            'messages': [_serialize_candidate(conn, row, viewer_id=user_id) for row in visible_rows],
            'has_more_before': has_more_before,
            'next_before_id': next_before_id,
        },
    }
