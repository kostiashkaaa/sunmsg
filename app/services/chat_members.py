from __future__ import annotations


CHAT_TYPE_DIRECT = 'direct'
CHAT_TYPE_GROUP = 'group'
GROUP_ROLE_OWNER = 'owner'
GROUP_ROLE_ADMIN = 'admin'
GROUP_ROLE_MODERATOR = 'moderator'
GROUP_ROLE_MEMBER = 'member'
GROUP_ROLES = {
    GROUP_ROLE_OWNER,
    GROUP_ROLE_ADMIN,
    GROUP_ROLE_MODERATOR,
    GROUP_ROLE_MEMBER,
}


def normalize_chat_type(value: str | None) -> str:
    text = str(value or '').strip().lower()
    if text == CHAT_TYPE_GROUP:
        return CHAT_TYPE_GROUP
    return CHAT_TYPE_DIRECT


def normalize_group_role(value: str | None) -> str:
    normalized = str(value or '').strip().lower()
    if normalized in GROUP_ROLES:
        return normalized
    return GROUP_ROLE_MEMBER


def get_group_member_role(conn, user_id: int, chat_id: str) -> str:
    row = conn.execute(
        '''
        SELECT role
        FROM chat_members
        WHERE user_id = ? AND chat_id = ?
        LIMIT 1
        ''',
        (int(user_id), str(chat_id)),
    ).fetchone()
    if not row:
        return ''
    return normalize_group_role(row['role'])


def _infer_group_chat_type(conn, chat_id: str) -> str:
    try:
        row = conn.execute(
            '''
            SELECT 1
            FROM chat_members
            WHERE chat_id = ?
            LIMIT 1
            ''',
            (chat_id,),
        ).fetchone()
    except Exception:  # noqa: BLE001
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001
            pass
        row = None
    return CHAT_TYPE_GROUP if row else CHAT_TYPE_DIRECT


def get_chat_type(conn, chat_id: str) -> str:
    try:
        row = conn.execute(
            '''
            SELECT chat_type
            FROM chats
            WHERE chat_id = ?
            ''',
            (chat_id,),
        ).fetchone()
    except Exception:  # noqa: BLE001
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001
            pass
        return _infer_group_chat_type(conn, chat_id)

    normalized = normalize_chat_type(row['chat_type'] if row else None)
    if normalized == CHAT_TYPE_GROUP:
        return CHAT_TYPE_GROUP

    # Backward compatibility: legacy rows can miss chat_type for groups.
    raw_chat_type = str((row['chat_type'] if row else '') or '').strip().lower()
    if not raw_chat_type:
        return _infer_group_chat_type(conn, chat_id)
    return CHAT_TYPE_DIRECT


def is_chat_member(conn, user_id: int, chat_id: str) -> bool:
    try:
        row = conn.execute(
            '''
            SELECT 1
            FROM chat_members
            WHERE user_id = ? AND chat_id = ?
            LIMIT 1
            ''',
            (user_id, chat_id),
        ).fetchone()
    except Exception:  # noqa: BLE001
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001
            pass
        row = None
    if row:
        return True
    # Backward-compatibility: legacy direct chats still use contacts.
    row = conn.execute(
        '''
        SELECT 1
        FROM contacts
        WHERE user_id = ? AND chat_id = ?
        LIMIT 1
        ''',
        (user_id, chat_id),
    ).fetchone()
    return row is not None


def list_chat_member_public_keys(conn, chat_id: str, *, exclude_user_id: int | None = None):
    params = [chat_id]
    exclude_sql = ''
    if exclude_user_id is not None:
        exclude_sql = ' AND u.id <> ?'
        params.append(int(exclude_user_id))
    try:
        rows = conn.execute(
            f'''
            SELECT DISTINCT u.id, u.public_key
            FROM chat_members cm
            JOIN users u ON u.id = cm.user_id
            WHERE cm.chat_id = ?
              AND COALESCE(u.public_key, '') <> ''
              {exclude_sql}
            ORDER BY u.id ASC
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
            SELECT DISTINCT u.id, u.public_key
            FROM contacts c
            JOIN users u ON u.id = c.user_id
            WHERE c.chat_id = ?
              AND COALESCE(u.public_key, '') <> ''
              {exclude_sql}
            ORDER BY u.id ASC
            ''',
            tuple(params),
        ).fetchall()
    return rows


def list_chat_member_user_ids(conn, chat_id: str, *, exclude_user_id: int | None = None) -> list[int]:
    params = [chat_id]
    exclude_sql = ''
    if exclude_user_id is not None:
        exclude_sql = ' AND user_id <> ?'
        params.append(int(exclude_user_id))
    try:
        rows = conn.execute(
            f'''
            SELECT user_id
            FROM chat_members
            WHERE chat_id = ?
              {exclude_sql}
            ORDER BY user_id ASC
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
            SELECT DISTINCT user_id
            FROM contacts
            WHERE chat_id = ?
              {exclude_sql}
            ORDER BY user_id ASC
            ''',
            tuple(params),
        ).fetchall()
    return [int(row['user_id']) for row in rows]


def ensure_chat_members(conn, chat_id: str, user_ids: list[int], *, role: str = 'member', added_by_user_id: int | None = None) -> None:
    normalized_role = normalize_group_role(role)
    unique_ids = sorted({int(uid) for uid in user_ids if uid is not None})
    for uid in unique_ids:
        try:
            conn.execute(
                '''
                INSERT INTO chat_members (user_id, chat_id, role, added_by_user_id)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id, chat_id) DO NOTHING
                ''',
                (uid, chat_id, normalized_role, added_by_user_id),
            )
        except Exception:  # noqa: BLE001
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001
                pass
            # Legacy schema compatibility in isolated tests.
            continue
