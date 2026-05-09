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


def build_group_chat_profile_payload(
    *,
    conn,
    chat_id: str,
    viewer_user_id: int,
    get_safe_avatar_url_func=None,
    is_effectively_online_func=None,
) -> dict | None:
    chat_row = conn.execute(
        '''
        SELECT *
        FROM chats
        WHERE chat_id = ?
        ''',
        (chat_id,),
    ).fetchone()
    if not chat_row:
        return None

    my_role_row = conn.execute(
        '''
        SELECT role
        FROM chat_members
        WHERE user_id = ? AND chat_id = ?
        ''',
        (int(viewer_user_id), str(chat_id)),
    ).fetchone()
    my_role = str(my_role_row['role'] or 'member') if my_role_row else 'member'

    member_rows = conn.execute(
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
        ''',
        (chat_id,),
    ).fetchall()

    member_ids = [int(row['user_id']) for row in member_rows]
    sanctions_by_user_id: dict[int, dict] = {}
    if member_ids:
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

    members = []
    for row in member_rows:
        base_avatar = str(row['avatar_url'] or '')
        if callable(get_safe_avatar_url_func):
            try:
                safe_avatar = get_safe_avatar_url_func(row, viewer_user_id)
            except Exception:  # noqa: BLE001
                safe_avatar = base_avatar
        else:
            safe_avatar = base_avatar
        is_hidden = bool(row['hide_online_status'])
        persisted_online = bool(row['is_online'])
        if callable(is_effectively_online_func) and not is_hidden:
            try:
                online = bool(is_effectively_online_func(str(row['public_key'] or ''), persisted=persisted_online))
            except Exception:  # noqa: BLE001
                online = persisted_online
        else:
            online = persisted_online and not is_hidden
        members.append(
            {
                'user_id': int(row['user_id']),
                'username': str(row['username'] or ''),
                'display_name': str(row['display_name'] or row['username'] or ''),
                'public_key': str(row['public_key'] or ''),
                'avatar_url': safe_avatar,
                'role': str(row['role'] or 'member'),
                'online': bool(online),
                'last_seen': row['last_seen'],
                'active_sanction': sanctions_by_user_id.get(int(row['user_id'])),
            }
        )

    my_active_group_sanction = sanctions_by_user_id.get(int(viewer_user_id))
    my_pending_group_appeal = None
    if my_active_group_sanction:
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
            (int(my_active_group_sanction['sanction_id']), int(viewer_user_id)),
        ).fetchone()
        if pending_row:
            my_pending_group_appeal = {
                'appeal_id': int(pending_row['id']),
                'state': str(pending_row['state'] or ''),
                'created_at': str(pending_row['created_at'] or ''),
            }

    can_invite = can_role_perform_action(my_role, ACTION_INVITE)
    can_kick = can_role_perform_action(my_role, ACTION_KICK)
    can_ban = can_role_perform_action(my_role, ACTION_BAN)
    can_change_group_settings = can_role_perform_action(my_role, ACTION_CHANGE_SETTINGS)
    can_manage_roles = can_role_perform_action(my_role, ACTION_CHANGE_ROLE)
    group_permissions = extract_group_permissions_from_chat_row(chat_row)
    member_scoped = role_uses_member_permissions(my_role)
    can_invite_effective = can_invite or (member_scoped and bool(group_permissions.get('members_can_add_members')))
    can_change_settings_effective = can_change_group_settings or (
        member_scoped and bool(group_permissions.get('members_can_change_info'))
    )
    can_pin_effective = can_role_perform_action(my_role, 'pin') or (
        member_scoped and bool(group_permissions.get('members_can_pin_messages'))
    )

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
        'members_count': len(members),
        'members': members,
        'my_role': my_role,
        'can_edit_group': can_change_settings_effective,
        'can_manage_admins': can_manage_roles,
        'permissions': {
            'can_invite': can_invite_effective,
            'can_kick': can_kick,
            'can_ban': can_ban,
            'can_pin': can_pin_effective,
            'can_delete_messages': can_role_perform_action(my_role, 'delete_messages'),
            'can_change_group_settings': can_change_settings_effective,
            'can_manage_roles': can_manage_roles,
        },
        'group_permissions': group_permissions,
        'my_active_group_sanction': my_active_group_sanction,
        'my_pending_group_appeal': my_pending_group_appeal,
    }
