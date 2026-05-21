from __future__ import annotations

from typing import Any

from app.services.feature_access_common import (
    is_truthy_setting,
    resolve_feature_access_user,
    safe_feature_text,
)

CALL_FEATURE_ALLOWLIST_SETTING_KEY = 'allowlist_enabled'


def is_call_allowlist_enabled(conn) -> bool:
    row = conn.execute(
        '''
        SELECT value
        FROM call_feature_settings
        WHERE key = ?
        LIMIT 1
        ''',
        (CALL_FEATURE_ALLOWLIST_SETTING_KEY,),
    ).fetchone()
    if row is None:
        return True
    return is_truthy_setting(row['value'])


def set_call_allowlist_enabled(conn, *, enabled: bool, actor_user_id: int | None) -> None:
    conn.execute(
        '''
        INSERT INTO call_feature_settings (key, value, updated_by_user_id, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
            value = EXCLUDED.value,
            updated_by_user_id = EXCLUDED.updated_by_user_id,
            updated_at = CURRENT_TIMESTAMP
        ''',
        (
            CALL_FEATURE_ALLOWLIST_SETTING_KEY,
            '1' if enabled else '0',
            int(actor_user_id) if actor_user_id else None,
        ),
    )


def resolve_user_for_call_access(conn, identifier: Any) -> dict | None:
    return resolve_feature_access_user(conn, identifier)


def grant_call_access(
    conn,
    *,
    identifier: Any,
    granted_by_user_id: int,
    note: Any = '',
) -> dict:
    user = resolve_user_for_call_access(conn, identifier)
    if user is None:
        raise ValueError('user_not_found')

    conn.execute(
        '''
        INSERT INTO call_feature_allowlist (user_id, granted_by_user_id, note, created_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
            granted_by_user_id = EXCLUDED.granted_by_user_id,
            note = EXCLUDED.note
        ''',
        (
            user['user_id'],
            int(granted_by_user_id),
            safe_feature_text(note),
        ),
    )
    return user


def revoke_call_access(conn, *, user_id: int) -> bool:
    result = conn.execute(
        '''
        DELETE FROM call_feature_allowlist
        WHERE user_id = ?
        ''',
        (int(user_id),),
    )
    return int(result.rowcount or 0) > 0


def list_call_allowed_users(conn) -> list[dict]:
    rows = conn.execute(
        '''
        SELECT
            cfa.user_id,
            cfa.granted_by_user_id,
            cfa.note,
            cfa.created_at,
            u.username,
            u.display_name,
            u.avatar_url,
            grantor.username AS granted_by_username
        FROM call_feature_allowlist cfa
        JOIN users u ON u.id = cfa.user_id
        LEFT JOIN users grantor ON grantor.id = cfa.granted_by_user_id
        ORDER BY cfa.created_at DESC, cfa.user_id ASC
        '''
    ).fetchall()
    return [
        {
            'user_id': int(row['user_id']),
            'username': str(row['username'] or ''),
            'display_name': str(row['display_name'] or ''),
            'avatar_url': str(row['avatar_url'] or ''),
            'granted_by_user_id': int(row['granted_by_user_id']) if row['granted_by_user_id'] is not None else None,
            'granted_by_username': str(row['granted_by_username'] or ''),
            'note': str(row['note'] or ''),
            'created_at': str(row['created_at'] or ''),
        }
        for row in rows
    ]


def can_user_use_calls(conn, *, user_id: int) -> bool:
    if not is_call_allowlist_enabled(conn):
        return True
    row = conn.execute(
        '''
        SELECT 1
        FROM call_feature_allowlist
        WHERE user_id = ?
        LIMIT 1
        ''',
        (int(user_id),),
    ).fetchone()
    return row is not None


def can_users_use_calls(conn, user_ids) -> bool:
    if not is_call_allowlist_enabled(conn):
        return True

    normalized_ids = set()
    for raw_user_id in user_ids or ():
        try:
            user_id = int(raw_user_id)
        except (TypeError, ValueError):
            continue
        if user_id > 0:
            normalized_ids.add(user_id)
    normalized_ids = sorted(normalized_ids)
    if not normalized_ids:
        return False

    placeholders = ', '.join('?' for _ in normalized_ids)
    rows = conn.execute(
        f'''
        SELECT user_id
        FROM call_feature_allowlist
        WHERE user_id IN ({placeholders})
        ''',
        tuple(normalized_ids),
    ).fetchall()
    allowed_ids = {int(row['user_id']) for row in rows}
    return all(user_id in allowed_ids for user_id in normalized_ids)


def call_feature_state(conn) -> dict:
    return {
        'allowlist_enabled': is_call_allowlist_enabled(conn),
        'allowed_users': list_call_allowed_users(conn),
    }
