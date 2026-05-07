from __future__ import annotations

from app.routes.chat_group_authorization import build_authorize_group_action_or_error
from app.routes.chat_group_management_routes import register_chat_group_management_routes
from app.routes.chat_group_membership_routes import register_chat_group_membership_routes
from app.routes.chat_group_profile_routes import register_chat_group_profile_routes


def register_chat_group_routes(
    chat_bp,
    *,
    limiter,
    get_db_connection_func,
    socketio_emit_func,
    is_effectively_online_func=None,
    get_safe_avatar_url_func=None,
    allowed_avatar_file_func=None,
    validate_avatar_magic_func=None,
    get_upload_folder_func=None,
    get_project_root_func=None,
    get_max_avatar_size_func=None,
):
    authorize_group_action_or_error = build_authorize_group_action_or_error()
    register_chat_group_profile_routes(
        chat_bp,
        limiter=limiter,
        get_db_connection_func=get_db_connection_func,
        is_effectively_online_func=is_effectively_online_func,
        get_safe_avatar_url_func=get_safe_avatar_url_func,
    )

    register_chat_group_management_routes(
        chat_bp,
        limiter=limiter,
        get_db_connection_func=get_db_connection_func,
        socketio_emit_func=socketio_emit_func,
        authorize_group_action_or_error_func=authorize_group_action_or_error,
        allowed_avatar_file_func=allowed_avatar_file_func,
        validate_avatar_magic_func=validate_avatar_magic_func,
        get_upload_folder_func=get_upload_folder_func,
        get_project_root_func=get_project_root_func,
        get_max_avatar_size_func=get_max_avatar_size_func,
    )

    register_chat_group_membership_routes(
        chat_bp,
        limiter=limiter,
        get_db_connection_func=get_db_connection_func,
        socketio_emit_func=socketio_emit_func,
        authorize_group_action_or_error_func=authorize_group_action_or_error,
    )
