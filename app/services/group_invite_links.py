from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone


def _generate_token() -> str:
    return secrets.token_urlsafe(16)


def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def create_invite_link(conn, *, chat_id: str, created_by: int, max_uses: int | None = None, expires_in_hours: int | None = None) -> dict:
    token = _generate_token()
    expires_at = None
    if expires_in_hours:
        expires_at = (_utcnow_naive() + timedelta(hours=expires_in_hours)).isoformat()

    conn.execute(
        '''
        UPDATE group_invite_links SET is_active = 0
        WHERE chat_id = ? AND is_active = 1
        ''',
        (chat_id,),
    )
    conn.execute(
        '''
        INSERT INTO group_invite_links (chat_id, token, created_by, max_uses, expires_at, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
        ''',
        (chat_id, token, created_by, max_uses, expires_at),
    )
    return {'token': token, 'max_uses': max_uses, 'expires_at': expires_at}


def get_active_invite_link(conn, chat_id: str) -> dict | None:
    row = conn.execute(
        '''
        SELECT token, max_uses, uses_count, expires_at, created_at
        FROM group_invite_links
        WHERE chat_id = ? AND is_active = 1
        ORDER BY created_at DESC
        LIMIT 1
        ''',
        (chat_id,),
    ).fetchone()
    if not row:
        return None
    return {
        'token': row['token'],
        'max_uses': row['max_uses'],
        'uses_count': row['uses_count'],
        'expires_at': str(row['expires_at'] or ''),
        'created_at': str(row['created_at'] or ''),
    }


def revoke_invite_links(conn, chat_id: str) -> None:
    conn.execute(
        'UPDATE group_invite_links SET is_active = 0 WHERE chat_id = ?',
        (chat_id,),
    )


def resolve_invite_link(conn, token: str) -> dict | None:
    row = conn.execute(
        '''
        SELECT gil.id, gil.chat_id, gil.max_uses, gil.uses_count, gil.expires_at, gil.is_active,
               c.chat_name, c.chat_avatar_url, c.chat_description,
               (SELECT COUNT(*) FROM chat_members cm WHERE cm.chat_id = gil.chat_id) AS member_count
        FROM group_invite_links gil
        JOIN chats c ON c.chat_id = gil.chat_id
        WHERE gil.token = ?
        ''',
        (token,),
    ).fetchone()
    if not row:
        return None
    if not row['is_active']:
        return None
    if row['max_uses'] and int(row['uses_count']) >= int(row['max_uses']):
        return None
    if row['expires_at']:
        try:
            exp = datetime.fromisoformat(str(row['expires_at']))
            if exp < _utcnow_naive():
                return None
        except ValueError:
            pass
    return dict(row)


def consume_invite_link(conn, token: str, user_id: int) -> dict | None:
    """Returns the chat_id if the link is valid and the user was added, or None."""
    link = resolve_invite_link(conn, token)
    if not link:
        return None
    chat_id = str(link['chat_id'])
    already = conn.execute(
        'SELECT 1 FROM chat_members WHERE user_id = ? AND chat_id = ?',
        (user_id, chat_id),
    ).fetchone()
    if already:
        return {'chat_id': chat_id, 'already_member': True}

    insert_result = conn.execute(
        '''
        INSERT INTO chat_members (user_id, chat_id, role)
        VALUES (?, ?, ?)
        ON CONFLICT (user_id, chat_id) DO NOTHING
        ''',
        (user_id, chat_id, 'member'),
    )
    if int(getattr(insert_result, 'rowcount', 0) or 0) <= 0:
        return {'chat_id': chat_id, 'already_member': True}

    reserve_result = conn.execute(
        '''
        UPDATE group_invite_links
        SET uses_count = uses_count + 1
        WHERE token = ?
          AND is_active = 1
          AND (max_uses IS NULL OR uses_count < max_uses)
          AND (expires_at IS NULL OR expires_at >= ?)
        ''',
        (token, _utcnow_naive().isoformat()),
    )
    if int(getattr(reserve_result, 'rowcount', 0) or 0) != 1:
        conn.execute(
            'DELETE FROM chat_members WHERE user_id = ? AND chat_id = ?',
            (user_id, chat_id),
        )
        return None
    return {'chat_id': chat_id, 'already_member': False}
