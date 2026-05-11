from __future__ import annotations

from flask import jsonify

from app.services.group_authorization import authorize_group_action


def build_authorize_group_action_or_error(  # noqa: PLR0913 - dependency-injected authorization factory contract
    *,
    authorize_group_action_func=authorize_group_action,
):
    def _authorize_group_action_or_error(  # noqa: PLR0913 - authorization decision contract
        conn,
        *,
        actor_user_id: int,
        chat_id: str,
        action: str,
        target_user_id: int | None = None,
        next_role: str | None = None,
        denied_message: str | None = None,
    ):
        decision = authorize_group_action_func(
            conn,
            actor_user_id=int(actor_user_id),
            chat_id=str(chat_id),
            action=action,
            target_user_id=target_user_id,
            next_role=next_role,
        )
        if decision.allowed:
            return decision, None
        return None, (
            jsonify({'success': False, 'error': denied_message or decision.message or 'Forbidden.'}),
            403,
        )

    return _authorize_group_action_or_error
