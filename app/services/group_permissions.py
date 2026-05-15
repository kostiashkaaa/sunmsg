from __future__ import annotations

from app.services.chat_members import GROUP_ROLE_MEMBER, normalize_group_role

ALLOWED_GROUP_SLOW_MODE_SECONDS = (0, 5, 10, 30, 60, 300, 900, 3600)

DEFAULT_GROUP_PERMISSIONS = {
    'members_can_send_messages': True,
    'members_can_send_media': True,
    'members_can_add_members': False,
    'members_can_pin_messages': False,
    'members_can_change_info': False,
    'slow_mode_seconds': 0,
}

GROUP_PERMISSION_COLUMN_MAP = {
    'members_can_send_messages': 'group_perm_send_messages',
    'members_can_send_media': 'group_perm_send_media',
    'members_can_add_members': 'group_perm_add_members',
    'members_can_pin_messages': 'group_perm_pin_messages',
    'members_can_change_info': 'group_perm_change_info',
    'slow_mode_seconds': 'group_slow_mode_seconds',
}

_MEDIA_MESSAGE_TYPES = {'photo', 'video', 'audio', 'file', 'voice'}


def _normalize_bool(value, *, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(int(value))
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {'1', 'true', 'yes', 'on'}:
            return True
        if normalized in {'0', 'false', 'no', 'off'}:
            return False
    return bool(default)


def normalize_group_slow_mode_seconds(value) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = 0
    return parsed if parsed in ALLOWED_GROUP_SLOW_MODE_SECONDS else 0


def normalize_group_permissions_payload(raw_permissions) -> dict[str, bool | int]:
    source = raw_permissions if isinstance(raw_permissions, dict) else {}
    return {
        'members_can_send_messages': _normalize_bool(
            source.get('members_can_send_messages'),
            default=bool(DEFAULT_GROUP_PERMISSIONS['members_can_send_messages']),
        ),
        'members_can_send_media': _normalize_bool(
            source.get('members_can_send_media'),
            default=bool(DEFAULT_GROUP_PERMISSIONS['members_can_send_media']),
        ),
        'members_can_add_members': _normalize_bool(
            source.get('members_can_add_members'),
            default=bool(DEFAULT_GROUP_PERMISSIONS['members_can_add_members']),
        ),
        'members_can_pin_messages': _normalize_bool(
            source.get('members_can_pin_messages'),
            default=bool(DEFAULT_GROUP_PERMISSIONS['members_can_pin_messages']),
        ),
        'members_can_change_info': _normalize_bool(
            source.get('members_can_change_info'),
            default=bool(DEFAULT_GROUP_PERMISSIONS['members_can_change_info']),
        ),
        'slow_mode_seconds': normalize_group_slow_mode_seconds(source.get('slow_mode_seconds')),
    }


def extract_group_permissions_from_chat_row(chat_row) -> dict[str, bool | int]:
    if not chat_row:
        return dict(DEFAULT_GROUP_PERMISSIONS)

    try:
        row_keys = {str(key) for key in chat_row.keys()}
    except Exception:  # noqa: BLE001
        row_keys = set()

    payload = {}
    for permission_key, column_name in GROUP_PERMISSION_COLUMN_MAP.items():
        if column_name in row_keys:
            payload[permission_key] = chat_row[column_name]
        else:
            payload[permission_key] = DEFAULT_GROUP_PERMISSIONS[permission_key]

    return normalize_group_permissions_payload(payload)


def load_group_permissions(conn, *, chat_id: str) -> dict[str, bool | int]:
    normalized_chat_id = str(chat_id or '').strip()
    if not normalized_chat_id:
        return dict(DEFAULT_GROUP_PERMISSIONS)

    try:
        row = conn.execute(
            "SELECT * FROM chats WHERE chat_id = ? LIMIT 1",
            (normalized_chat_id,),
        ).fetchone()
    except Exception:  # noqa: BLE001
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001
            pass
        return dict(DEFAULT_GROUP_PERMISSIONS)

    return extract_group_permissions_from_chat_row(row)


def role_uses_member_permissions(role: str | None) -> bool:
    return normalize_group_role(role) == GROUP_ROLE_MEMBER


def is_media_message_type(message_type: str | None) -> bool:
    return str(message_type or '').strip().lower() in _MEDIA_MESSAGE_TYPES
