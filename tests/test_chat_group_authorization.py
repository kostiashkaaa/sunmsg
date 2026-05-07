from __future__ import annotations

from dataclasses import dataclass

from flask import Flask

from app.routes.chat_group_authorization import build_authorize_group_action_or_error


@dataclass
class _Decision:
    allowed: bool
    message: str = ''


def test_authorize_group_action_or_error_returns_decision_when_allowed():
    app = Flask(__name__)
    captured = {}

    def _fake_authorize(conn, **kwargs):
        captured['kwargs'] = kwargs
        return _Decision(allowed=True)

    authorize = build_authorize_group_action_or_error(authorize_group_action_func=_fake_authorize)

    with app.app_context():
        decision, error = authorize(
            conn=object(),
            actor_user_id=5,
            chat_id='abc',
            action='invite',
            target_user_id=7,
            next_role='member',
        )

    assert error is None
    assert decision.allowed is True
    assert captured['kwargs'] == {
        'actor_user_id': 5,
        'chat_id': 'abc',
        'action': 'invite',
        'target_user_id': 7,
        'next_role': 'member',
    }


def test_authorize_group_action_or_error_returns_http_403_with_message():
    app = Flask(__name__)

    def _fake_authorize(conn, **kwargs):
        return _Decision(allowed=False, message='denied-by-policy')

    authorize = build_authorize_group_action_or_error(authorize_group_action_func=_fake_authorize)

    with app.app_context():
        decision, error = authorize(
            conn=object(),
            actor_user_id=5,
            chat_id='abc',
            action='invite',
        )

    assert decision is None
    assert error is not None
    response, status = error
    assert status == 403
    assert response.get_json() == {'success': False, 'error': 'denied-by-policy'}
