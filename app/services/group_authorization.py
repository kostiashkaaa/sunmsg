from __future__ import annotations

from dataclasses import dataclass

from app.services.chat_members import (
    GROUP_ROLE_ADMIN,
    GROUP_ROLE_MEMBER,
    GROUP_ROLE_MODERATOR,
    GROUP_ROLE_OWNER,
    get_group_member_role,
    normalize_group_role,
)

ACTION_INVITE = 'invite'
ACTION_KICK = 'kick'
ACTION_BAN = 'ban'
ACTION_PIN = 'pin'
ACTION_CHANGE_SETTINGS = 'change_group_settings'
ACTION_DELETE_MESSAGES = 'delete_messages'
ACTION_CHANGE_ROLE = 'change_role'

ROLE_PRIORITY = {
    GROUP_ROLE_MEMBER: 0,
    GROUP_ROLE_MODERATOR: 1,
    GROUP_ROLE_ADMIN: 2,
    GROUP_ROLE_OWNER: 3,
}

MIN_ROLE_BY_ACTION = {
    ACTION_INVITE: GROUP_ROLE_MODERATOR,
    ACTION_KICK: GROUP_ROLE_MODERATOR,
    ACTION_BAN: GROUP_ROLE_MODERATOR,
    ACTION_PIN: GROUP_ROLE_MODERATOR,
    ACTION_CHANGE_SETTINGS: GROUP_ROLE_ADMIN,
    ACTION_DELETE_MESSAGES: GROUP_ROLE_MODERATOR,
    ACTION_CHANGE_ROLE: GROUP_ROLE_ADMIN,
}


@dataclass(frozen=True)
class GroupAuthorizationResult:
    allowed: bool
    actor_role: str
    reason: str = ''
    message: str = ''
    target_role: str = ''


def _role_priority(role: str) -> int:
    return int(ROLE_PRIORITY.get(normalize_group_role(role), -1))


def can_role_perform_action(role: str, action: str) -> bool:
    normalized_role = normalize_group_role(role)
    required_role = MIN_ROLE_BY_ACTION.get(str(action or '').strip().lower())
    if not required_role:
        return False
    return _role_priority(normalized_role) >= _role_priority(required_role)


def _deny(
    *,
    actor_role: str,
    reason: str,
    message: str,
    target_role: str = '',
) -> GroupAuthorizationResult:
    return GroupAuthorizationResult(
        allowed=False,
        actor_role=actor_role,
        target_role=target_role,
        reason=reason,
        message=message,
    )


def _validate_change_role_permissions(
    *,
    actor_role: str,
    target_role: str,
    next_role: str | None,
) -> GroupAuthorizationResult | None:
    normalized_next_role = normalize_group_role(next_role)
    if normalized_next_role == GROUP_ROLE_OWNER and actor_role != GROUP_ROLE_OWNER:
        return _deny(
            actor_role=actor_role,
            target_role=target_role,
            reason='owner_only',
            message='Only owner can assign owner role.',
        )
    if actor_role != GROUP_ROLE_OWNER and normalized_next_role == GROUP_ROLE_ADMIN:
        return _deny(
            actor_role=actor_role,
            target_role=target_role,
            reason='owner_only',
            message='Only owner can assign admin role.',
        )
    return None


def authorize_group_action(  # noqa: PLR0913 - explicit authorization contract
    conn,
    *,
    actor_user_id: int,
    chat_id: str,
    action: str,
    target_user_id: int | None = None,
    next_role: str | None = None,
) -> GroupAuthorizationResult:
    normalized_action = str(action or '').strip().lower()
    actor_role = get_group_member_role(conn, int(actor_user_id), str(chat_id))
    if not actor_role:
        return _deny(
            actor_role='',
            reason='not_member',
            message='You are not a member of this group.',
        )
    if not can_role_perform_action(actor_role, normalized_action):
        return _deny(
            actor_role=actor_role,
            reason='insufficient_role',
            message='Insufficient role for this action.',
        )

    if target_user_id is None:
        return GroupAuthorizationResult(allowed=True, actor_role=actor_role)

    target_role = get_group_member_role(conn, int(target_user_id), str(chat_id))
    if not target_role and normalized_action in {ACTION_KICK, ACTION_BAN, ACTION_CHANGE_ROLE}:
        return _deny(
            actor_role=actor_role,
            target_role='',
            reason='target_not_member',
            message='Target user is not a group member.',
        )

    if normalized_action in {ACTION_KICK, ACTION_BAN} and int(target_user_id) == int(actor_user_id):
        return _deny(
            actor_role=actor_role,
            target_role=target_role,
            reason='self_target_forbidden',
            message='You cannot apply this action to yourself.',
        )

    if not target_role:
        return GroupAuthorizationResult(allowed=True, actor_role=actor_role, target_role='')

    actor_priority = _role_priority(actor_role)
    target_priority = _role_priority(target_role)
    if actor_priority <= target_priority and int(actor_user_id) != int(target_user_id):
        return _deny(
            actor_role=actor_role,
            target_role=target_role,
            reason='target_role_too_high',
            message='You cannot manage a member with equal or higher role.',
        )

    if normalized_action == ACTION_CHANGE_ROLE:
        role_error = _validate_change_role_permissions(
            actor_role=actor_role,
            target_role=target_role,
            next_role=next_role,
        )
        if role_error:
            return role_error

    return GroupAuthorizationResult(
        allowed=True,
        actor_role=actor_role,
        target_role=target_role,
    )
