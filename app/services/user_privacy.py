from __future__ import annotations

from app.db.schema import table_columns

PRIVACY_ALL = 'all'
PRIVACY_CONTACTS = 'contacts'
PRIVACY_NOBODY = 'nobody'
PRIVACY_VALUES = {PRIVACY_ALL, PRIVACY_CONTACTS, PRIVACY_NOBODY}


def normalize_privacy_choice(value, *, default: str = PRIVACY_ALL) -> str:
    normalized = str(value or '').strip().lower()
    if normalized in PRIVACY_VALUES:
        return normalized
    return default if default in PRIVACY_VALUES else PRIVACY_ALL


def is_contact(conn, *, owner_id: int, viewer_id: int | None) -> bool:
    if viewer_id is None:
        return False
    if int(owner_id) == int(viewer_id):
        return True
    return (
        conn.execute(
            'SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ? LIMIT 1',
            (owner_id, viewer_id),
        ).fetchone()
        is not None
    )


def is_privacy_allowed(conn, *, owner_id: int, viewer_id: int | None, policy) -> bool:
    if viewer_id is not None and int(owner_id) == int(viewer_id):
        return True
    normalized = normalize_privacy_choice(policy)
    if normalized == PRIVACY_ALL:
        return True
    if normalized == PRIVACY_NOBODY:
        return False
    return is_contact(conn, owner_id=owner_id, viewer_id=viewer_id)


_ALLOWED_PRIVACY_COLUMNS = frozenset({'voice_message_privacy', 'message_privacy'})


def _users_table_has_column(conn, column_name: str) -> bool:
    try:
        return column_name in table_columns(conn, 'users')
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return False


def can_send_direct_message(conn, *, receiver_id: int, sender_id: int, message_type: str) -> bool:
    column_name = 'voice_message_privacy' if str(message_type or '').strip().lower() == 'voice' else 'message_privacy'
    if column_name not in _ALLOWED_PRIVACY_COLUMNS:
        return True
    if not _users_table_has_column(conn, column_name):
        return True
    try:
        row = conn.execute(
            f'SELECT {column_name} FROM users WHERE id = ?',
            (receiver_id,),
        ).fetchone()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return True
    if not row:
        return False
    return is_privacy_allowed(
        conn,
        owner_id=receiver_id,
        viewer_id=sender_id,
        policy=row[column_name],
    )


def can_link_forward_author(conn, *, author_user_id: int, actor_user_id: int) -> bool:
    if not _users_table_has_column(conn, 'forward_link_privacy'):
        return True
    try:
        row = conn.execute(
            'SELECT forward_link_privacy FROM users WHERE id = ?',
            (author_user_id,),
        ).fetchone()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass
        return True
    if not row:
        return False
    return is_privacy_allowed(
        conn,
        owner_id=author_user_id,
        viewer_id=actor_user_id,
        policy=row['forward_link_privacy'],
    )
