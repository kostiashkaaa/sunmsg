from __future__ import annotations

from typing import Any

LIQUID_GLASS_FEATURE_ALLOWLIST_SETTING_KEY = 'allowlist_enabled'

_TRUE_VALUES = {'1', 'true', 'yes', 'on', 'enabled'}


def _truthy(value: Any) -> bool:
    return str(value or '').strip().lower() in _TRUE_VALUES


def _safe_text(value: Any, *, max_length: int = 512) -> str:
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


def is_liquid_glass_allowlist_enabled(conn) -> bool:
    row = conn.execute(
        '''
        SELECT value
        FROM liquid_glass_feature_settings
        WHERE key = ?
        LIMIT 1
        ''',
        (LIQUID_GLASS_FEATURE_ALLOWLIST_SETTING_KEY,),
    ).fetchone()
    if row is None:
        return True
    return _truthy(row['value'])


def set_liquid_glass_allowlist_enabled(conn, *, enabled: bool, actor_user_id: int | None) -> None:
    conn.execute(
        '''
        INSERT INTO liquid_glass_feature_settings (key, value, updated_by_user_id, updated_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(key) DO UPDATE SET
            value = EXCLUDED.value,
            updated_by_user_id = EXCLUDED.updated_by_user_id,
            updated_at = CURRENT_TIMESTAMP
        ''',
        (
            LIQUID_GLASS_FEATURE_ALLOWLIST_SETTING_KEY,
            '1' if enabled else '0',
            int(actor_user_id) if actor_user_id else None,
        ),
    )


def resolve_user_for_liquid_glass_access(conn, identifier: Any) -> dict | None:
    raw_identifier = _safe_text(identifier, max_length=80).lstrip('@')
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


def grant_liquid_glass_access(
    conn,
    *,
    identifier: Any,
    granted_by_user_id: int,
    note: Any = '',
) -> dict:
    user = resolve_user_for_liquid_glass_access(conn, identifier)
    if user is None:
        raise ValueError('user_not_found')

    conn.execute(
        '''
        INSERT INTO liquid_glass_feature_allowlist (user_id, granted_by_user_id, note, created_at)
        VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
            granted_by_user_id = EXCLUDED.granted_by_user_id,
            note = EXCLUDED.note
        ''',
        (
            user['user_id'],
            int(granted_by_user_id),
            _safe_text(note),
        ),
    )
    return user


def revoke_liquid_glass_access(conn, *, user_id: int) -> bool:
    result = conn.execute(
        '''
        DELETE FROM liquid_glass_feature_allowlist
        WHERE user_id = ?
        ''',
        (int(user_id),),
    )
    return int(result.rowcount or 0) > 0


def list_liquid_glass_allowed_users(conn) -> list[dict]:
    rows = conn.execute(
        '''
        SELECT
            lgfa.user_id,
            lgfa.granted_by_user_id,
            lgfa.note,
            lgfa.created_at,
            u.username,
            u.display_name,
            u.avatar_url,
            grantor.username AS granted_by_username
        FROM liquid_glass_feature_allowlist lgfa
        JOIN users u ON u.id = lgfa.user_id
        LEFT JOIN users grantor ON grantor.id = lgfa.granted_by_user_id
        ORDER BY lgfa.created_at DESC, lgfa.user_id ASC
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


def can_user_use_liquid_glass(conn, *, user_id: int) -> bool:
    if not is_liquid_glass_allowlist_enabled(conn):
        return True
    row = conn.execute(
        '''
        SELECT 1
        FROM liquid_glass_feature_allowlist
        WHERE user_id = ?
        LIMIT 1
        ''',
        (int(user_id),),
    ).fetchone()
    return row is not None


def liquid_glass_feature_state(conn) -> dict:
    return {
        'allowlist_enabled': is_liquid_glass_allowlist_enabled(conn),
        'allowed_users': list_liquid_glass_allowed_users(conn),
    }
