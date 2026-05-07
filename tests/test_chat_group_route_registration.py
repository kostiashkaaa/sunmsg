from __future__ import annotations

from flask import Blueprint, Flask

from app.routes.chat_group_routes import register_chat_group_routes


class _NoopLimiter:
    def limit(self, _rule: str):
        def _decorator(func):
            return func

        return _decorator


def test_register_chat_group_routes_exposes_expected_group_endpoints():
    app = Flask(__name__)
    bp = Blueprint('chat_group_test', __name__)

    register_chat_group_routes(
        bp,
        limiter=_NoopLimiter(),
        get_db_connection_func=lambda: None,
        socketio_emit_func=lambda *args, **kwargs: None,
        is_effectively_online_func=lambda *args, **kwargs: False,
        get_safe_avatar_url_func=lambda row, user_id: str(row.get('avatar_url', '')),
        allowed_avatar_file_func=lambda filename: True,
        validate_avatar_magic_func=lambda uploaded, ext: True,
        get_upload_folder_func=lambda: '.',
        get_project_root_func=lambda: '.',
        get_max_avatar_size_func=lambda: 1024,
    )
    app.register_blueprint(bp)

    registered_paths = {
        rule.rule
        for rule in app.url_map.iter_rules()
        if rule.rule.startswith('/api/chats/group/')
    }
    assert registered_paths >= {
        '/api/chats/group/create',
        '/api/chats/group/add_members',
        '/api/chats/group/info',
        '/api/chats/group/update',
        '/api/chats/group/set_role',
        '/api/chats/group/leave',
        '/api/chats/group/remove_member',
        '/api/chats/group/sanctions',
        '/api/chats/group/upload_avatar',
    }
