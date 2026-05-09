from __future__ import annotations

import re


_MENTION_PATTERN = re.compile(r'(?<![A-Za-z0-9_])@([A-Za-z0-9_]{1,50})(?![A-Za-z0-9_])')


def extract_mentioned_usernames(text: str, *, max_mentions: int = 32) -> list[str]:
    raw_text = str(text or '')
    if not raw_text:
        return []

    mentions: list[str] = []
    seen: set[str] = set()
    for match in _MENTION_PATTERN.finditer(raw_text):
        username = str(match.group(1) or '').strip().lower()
        if not username or username in seen:
            continue
        seen.add(username)
        mentions.append(username)
        if len(mentions) >= max(1, int(max_mentions)):
            break
    return mentions


def resolve_group_mentioned_members(
    conn,
    *,
    chat_id: str,
    mentioned_usernames: list[str] | tuple[str, ...],
    exclude_user_id: int | None = None,
) -> list[dict]:
    normalized_usernames = [
        str(value or '').strip().lower()
        for value in (mentioned_usernames or [])
        if str(value or '').strip()
    ]
    if not normalized_usernames:
        return []

    unique_usernames = list(dict.fromkeys(normalized_usernames))
    placeholders = ', '.join('?' * len(unique_usernames))
    params: list[object] = [str(chat_id), *unique_usernames]

    exclude_sql = ''
    if exclude_user_id is not None:
        exclude_sql = ' AND cm.user_id <> ?'
        params.append(int(exclude_user_id))

    try:
        rows = conn.execute(
            f'''
            SELECT cm.user_id, COALESCE(u.username, '') AS username, COALESCE(u.public_key, '') AS public_key
            FROM chat_members cm
            JOIN users u ON u.id = cm.user_id
            WHERE cm.chat_id = ?
              AND LOWER(u.username) IN ({placeholders})
              {exclude_sql}
            ORDER BY cm.user_id ASC
            ''',
            tuple(params),
        ).fetchall()
    except Exception:  # noqa: BLE001
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001
            pass
        rows = conn.execute(
            f'''
            SELECT DISTINCT c.user_id, COALESCE(u.username, '') AS username, COALESCE(u.public_key, '') AS public_key
            FROM contacts c
            JOIN users u ON u.id = c.user_id
            WHERE c.chat_id = ?
              AND LOWER(u.username) IN ({placeholders})
              {exclude_sql.replace('cm.user_id', 'c.user_id')}
            ORDER BY c.user_id ASC
            ''',
            tuple(params),
        ).fetchall()

    result: list[dict] = []
    seen_ids: set[int] = set()
    for row in rows:
        member_id = int(row['user_id'])
        if member_id <= 0 or member_id in seen_ids:
            continue
        seen_ids.add(member_id)
        result.append(
            {
                'user_id': member_id,
                'username': str(row['username'] or '').strip(),
                'public_key': str(row['public_key'] or '').strip(),
            }
        )
    return result

