from __future__ import annotations

from app.services import moderation as moderation_service
from app.services.group_authorization import (
    ACTION_BAN,
    ACTION_CHANGE_ROLE,
    ACTION_CHANGE_SETTINGS,
    ACTION_INVITE,
    ACTION_KICK,
    can_role_perform_action,
)
from app.services.group_permissions import extract_group_permissions_from_chat_row
from app.services.group_permissions import role_uses_member_permissions
from app.services.user_privacy import PRIVACY_ALL, PRIVACY_NOBODY, is_privacy_allowed, normalize_privacy_choice

GROUP_PROFILE_MEMBER_PREVIEW_LIMIT = 500


def _fetch_chat_row(conn, chat_id: str):
    return conn.execute(
        '''
        SELECT *
        FROM chats
        WHERE chat_id = ?
        ''',
        (chat_id,),
    ).fetchone()


def _fetch_my_role(conn, *, chat_id: str, viewer_user_id: int) -> str:
    my_role_row = conn.execute(
        '''
        SELECT role
        FROM chat_members
        WHERE user_id = ? AND chat_id = ?
        ''',
        (int(viewer_user_id), str(chat_id)),
    ).fetchone()
    return str(my_role_row['role'] or 'member') if my_role_row else 'member'


def _count_group_members(conn, *, chat_id: str) -> int:
    row = conn.execute(
        '''
        SELECT COUNT(*) AS cnt
        FROM chat_members
        WHERE chat_id = ?
        ''',
        (chat_id,),
    ).fetchone()
    return int(row['cnt'] or 0) if row else 0


def _fetch_member_rows(conn, *, chat_id: str, limit: int = GROUP_PROFILE_MEMBER_PREVIEW_LIMIT):
    return conn.execute(
        '''
        SELECT
            u.id AS user_id,
            u.username,
            u.display_name,
            u.public_key,
            u.avatar_url,
            u.avatar_visibility,
            u.is_online,
            u.last_seen,
            u.hide_online_status,
            u.last_seen_visibility,
            cm.role
        FROM chat_members cm
        JOIN users u ON u.id = cm.user_id
        WHERE cm.chat_id = ?
        ORDER BY
            CASE
                WHEN cm.role = 'owner' THEN 0
                WHEN cm.role = 'admin' THEN 1
                WHEN cm.role = 'moderator' THEN 2
                ELSE 3
            END,
            LOWER(COALESCE(u.display_name, u.username, '')) ASC,
            u.id ASC
        LIMIT ?
        ''',
        (chat_id, int(limit)),
    ).fetchall()


def _load_active_sanctions_by_user_id(conn, *, chat_id: str, member_rows) -> dict[int, dict]:
    member_ids = [int(row['user_id']) for row in member_rows]
    sanctions_by_user_id: dict[int, dict] = {}
    if not member_ids:
        return sanctions_by_user_id

    subject_ids = [
        moderation_service.make_group_member_subject_id(chat_id, member_id)
        for member_id in member_ids
    ]
    placeholders = ', '.join('?' * len(subject_ids))
    sanction_rows = conn.execute(
        f'''
        SELECT id, subject_id, action_type, reason_code, expires_at
        FROM moderation_sanctions
        WHERE subject_type = ?
          AND subject_id IN ({placeholders})
          AND status = 'active'
          AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        ORDER BY created_at DESC
        ''',
        (moderation_service.GROUP_MEMBER_SUBJECT_TYPE, *subject_ids),
    ).fetchall()
    for sanction_row in sanction_rows:
        parsed_subject = moderation_service.parse_group_member_subject_id(sanction_row['subject_id'])
        if not parsed_subject:
            continue
        _, sanction_user_id = parsed_subject
        if sanction_user_id in sanctions_by_user_id:
            continue
        sanctions_by_user_id[sanction_user_id] = {
            'sanction_id': int(sanction_row['id']),
            'action_type': str(sanction_row['action_type'] or ''),
            'reason_code': str(sanction_row['reason_code'] or ''),
            'expires_at': str(sanction_row['expires_at'] or ''),
        }
    return sanctions_by_user_id


def _resolve_safe_avatar(*, row, viewer_user_id: int, get_safe_avatar_url_func):
    base_avatar = str(row['avatar_url'] or '')
    if not callable(get_safe_avatar_url_func):
        return base_avatar
    try:
        return get_safe_avatar_url_func(row, viewer_user_id)
    except Exception:  # noqa: BLE001
        return base_avatar


def _resolve_last_seen_policy(row) -> str:
    return normalize_privacy_choice(
        row['last_seen_visibility'] if 'last_seen_visibility' in row.keys() else None,
        default=PRIVACY_NOBODY if bool(row['hide_online_status']) else PRIVACY_ALL,
    )


def _can_view_last_seen(*, conn, row, viewer_user_id: int) -> bool:
    return is_privacy_allowed(
        conn,
        owner_id=int(row['user_id']),
        viewer_id=int(viewer_user_id),
        policy=_resolve_last_seen_policy(row),
    )


def _resolve_online_state(*, conn, row, viewer_user_id: int, is_effectively_online_func):
    persisted_online = bool(row['is_online'])
    if not _can_view_last_seen(conn=conn, row=row, viewer_user_id=viewer_user_id):
        return False
    if not callable(is_effectively_online_func):
        return persisted_online
    try:
        return bool(
            is_effectively_online_func(str(row['public_key'] or ''), persisted=persisted_online)
        )
    except Exception:  # noqa: BLE001
        return persisted_online


def _serialize_members(
    *,
    conn,
    member_rows,
    viewer_user_id: int,
    sanctions_by_user_id: dict[int, dict],
    get_safe_avatar_url_func,
    is_effectively_online_func,
) -> list[dict]:
    members: list[dict] = []
    for row in member_rows:
        members.append(
            {
                'user_id': int(row['user_id']),
                'username': str(row['username'] or ''),
                'display_name': str(row['display_name'] or row['username'] or ''),
                'public_key': str(row['public_key'] or ''),
                'avatar_url': _resolve_safe_avatar(
                    row=row,
                    viewer_user_id=viewer_user_id,
                    get_safe_avatar_url_func=get_safe_avatar_url_func,
                ),
                'role': str(row['role'] or 'member'),
                'online': bool(
                    _resolve_online_state(
                        row=row,
                        conn=conn,
                        viewer_user_id=viewer_user_id,
                        is_effectively_online_func=is_effectively_online_func,
                    )
                ),
                'last_seen': row['last_seen'] if _can_view_last_seen(
                    conn=conn,
                    row=row,
                    viewer_user_id=viewer_user_id,
                ) else None,
                'active_sanction': sanctions_by_user_id.get(int(row['user_id'])),
            }
        )
    return members


def _load_pending_group_appeal(conn, *, sanction_id: int, viewer_user_id: int) -> dict | None:
    pending_row = conn.execute(
        '''
        SELECT id, state, created_at
        FROM moderation_appeals
        WHERE sanction_id = ?
          AND appellant_user_id = ?
          AND state IN ('submitted', 'in_review')
        ORDER BY created_at DESC
        LIMIT 1
        ''',
        (int(sanction_id), int(viewer_user_id)),
    ).fetchone()
    if not pending_row:
        return None
    return {
        'appeal_id': int(pending_row['id']),
        'state': str(pending_row['state'] or ''),
        'created_at': str(pending_row['created_at'] or ''),
    }


def _build_group_permissions_payload(*, my_role: str, chat_row) -> tuple[dict, dict, bool]:
    can_invite = can_role_perform_action(my_role, ACTION_INVITE)
    can_kick = can_role_perform_action(my_role, ACTION_KICK)
    can_ban = can_role_perform_action(my_role, ACTION_BAN)
    can_change_group_settings = can_role_perform_action(my_role, ACTION_CHANGE_SETTINGS)
    can_manage_roles = can_role_perform_action(my_role, ACTION_CHANGE_ROLE)
    group_permissions = extract_group_permissions_from_chat_row(chat_row)
    member_scoped = role_uses_member_permissions(my_role)
    can_invite_effective = can_invite or (
        member_scoped and bool(group_permissions.get('members_can_add_members'))
    )
    can_change_info_effective = can_change_group_settings or (
        member_scoped and bool(group_permissions.get('members_can_change_info'))
    )
    can_pin_effective = can_role_perform_action(my_role, 'pin') or (
        member_scoped and bool(group_permissions.get('members_can_pin_messages'))
    )
    permissions = {
        'can_invite': can_invite_effective,
        'can_kick': can_kick,
        'can_ban': can_ban,
        'can_pin': can_pin_effective,
        'can_delete_messages': can_role_perform_action(my_role, 'delete_messages'),
        'can_change_group_info': can_change_info_effective,
        'can_change_group_settings': can_change_group_settings,
        'can_manage_roles': can_manage_roles,
    }
    return permissions, group_permissions, can_change_info_effective


def build_group_chat_profile_payload(
    *,
    conn,
    chat_id: str,
    viewer_user_id: int,
    get_safe_avatar_url_func=None,
    is_effectively_online_func=None,
) -> dict | None:
    chat_row = _fetch_chat_row(conn, chat_id=chat_id)
    if not chat_row:
        return None

    my_role = _fetch_my_role(conn, chat_id=chat_id, viewer_user_id=viewer_user_id)
    total_members_count = _count_group_members(conn, chat_id=chat_id)
    member_rows = _fetch_member_rows(conn, chat_id=chat_id)
    sanctions_by_user_id = _load_active_sanctions_by_user_id(
        conn,
        chat_id=chat_id,
        member_rows=member_rows,
    )
    members = _serialize_members(
        conn=conn,
        member_rows=member_rows,
        viewer_user_id=viewer_user_id,
        sanctions_by_user_id=sanctions_by_user_id,
        get_safe_avatar_url_func=get_safe_avatar_url_func,
        is_effectively_online_func=is_effectively_online_func,
    )

    my_active_group_sanction = sanctions_by_user_id.get(int(viewer_user_id))
    my_pending_group_appeal = None
    if my_active_group_sanction:
        my_pending_group_appeal = _load_pending_group_appeal(
            conn,
            sanction_id=int(my_active_group_sanction['sanction_id']),
            viewer_user_id=viewer_user_id,
        )

    permissions, group_permissions, can_change_info_effective = _build_group_permissions_payload(
        my_role=my_role,
        chat_row=chat_row,
    )
    can_manage_roles = bool(permissions['can_manage_roles'])

    return {
        'success': True,
        '_group_profile': True,
        'chat_id': str(chat_row['chat_id']),
        'display_name': str(chat_row['chat_name'] or 'Group chat'),
        'description': str(chat_row['chat_description'] or ''),
        'username': '',
        'public_key': '',
        'avatar_url': str(chat_row['chat_avatar_url'] or ''),
        'online': False,
        'last_seen': None,
        'created_at': None,
        'stats': {'photos': 0, 'files': 0, 'links': 0},
        'members_count': total_members_count,
        'members_preview_limit': GROUP_PROFILE_MEMBER_PREVIEW_LIMIT,
        'members_has_more': total_members_count > len(members),
        'members': members,
        'my_role': my_role,
        'can_edit_group': can_change_info_effective,
        'can_manage_admins': can_manage_roles,
        'permissions': permissions,
        'group_permissions': group_permissions,
        'my_active_group_sanction': my_active_group_sanction,
        'my_pending_group_appeal': my_pending_group_appeal,
    }
