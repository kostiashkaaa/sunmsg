from __future__ import annotations

from flask import Blueprint, Flask

from app.routes.chat_group_profile_routes import register_chat_group_profile_routes


class _NoopLimiter:
    def limit(self, _rule: str):
        def _decorator(func):
            return func

        return _decorator


def _create_app():
    app = Flask(__name__)
    app.secret_key = 'test-secret'
    bp = Blueprint('chat_group_profile_test', __name__)
    register_chat_group_profile_routes(
        bp,
        limiter=_NoopLimiter(),
        get_db_connection_func=lambda: None,
    )
    app.register_blueprint(bp)
    return app


def test_group_info_requires_auth_session():
    app = _create_app()
    client = app.test_client()

    response = client.get('/api/chats/group/info?chat_id=abc')
    payload = response.get_json()

    assert response.status_code == 401
    assert payload['success'] is False


def test_group_info_requires_chat_id():
    app = _create_app()
    client = app.test_client()
    with client.session_transaction() as sess:
        sess['user_id'] = 1

    response = client.get('/api/chats/group/info')
    payload = response.get_json()

    assert response.status_code == 400
    assert payload['success'] is False
