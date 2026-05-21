from __future__ import annotations

from typing import Any

_TRUE_VALUES = {'1', 'true', 'yes', 'on', 'enabled'}


def is_truthy_setting(value: Any) -> bool:
    return str(value or '').strip().lower() in _TRUE_VALUES


def safe_feature_text(value: Any, *, max_length: int = 512) -> str:
    return str(value or '').strip()[:max_length]


def _user_payload(row) -> dict | None:
    if row is None:
        return None
    return {
        'user_id': int(row['id']),
        'username': str(row['username'] or ''),
        'display_name': str(row['display_name'] or ''),
        'avatar_url': str(row['avatar_url'] or ''),
    }


def resolve_feature_access_user(conn, identifier: Any) -> dict | None:
    raw_identifier = safe_feature_text(identifier, max_length=80).lstrip('@')
    if not raw_identifier:
        return None

    if raw_identifier.isdigit():
        row = conn.execute(
            '''
            SELECT id, username, display_name, avatar_url
            FROM users
            WHERE id = ?
            LIMIT 1
            ''',
            (int(raw_identifier),),
        ).fetchone()
        return _user_payload(row)

    row = conn.execute(
        '''
        SELECT id, username, display_name, avatar_url
        FROM users
        WHERE LOWER(username) = LOWER(?)
        LIMIT 1
        ''',
        (raw_identifier,),
    ).fetchone()
    return _user_payload(row)
