from datetime import datetime, timezone

from flask import request, session
from flask_socketio import emit

from app.database import get_db_connection
from app.extensions import socketio
from app.services.crypto import is_valid_chat_id
from app.services.presence import (
    add_active,
    count_active,
    count_connected,
    remove_active,
)
from app.sockets.read_receipt_handlers import (
    handle_messages_seen_event,
    handle_voice_message_listened_event,
)
from app.sockets.room_handlers import (
    handle_join_event,
    handle_leave_event,
)
from app.sockets.typing_handlers import (
    handle_stop_typing_event,
    handle_typing_event,
)
from app.sockets.presence_handlers import handle_activity_update_event

from . import context as ctx


@socketio.on('activity_update')
@ctx.authenticated_only
def handle_activity_update(data):
    handle_activity_update_event(
        data,
        session_store=session,
        request_sid=request.sid,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        socket_rate_ok_func=ctx._socket_rate_ok,
        add_active_func=add_active,
        remove_active_func=remove_active,
        count_active_func=count_active,
        count_connected_func=count_connected,
        get_db_connection_func=get_db_connection,
        emit_chat_status_for_user_func=ctx._emit_chat_status_for_user,
        utc_now_text_func=lambda: datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),
        logger=ctx.logger,
    )


@socketio.on('join')
@ctx.authenticated_only
def on_join(data):
    handle_join_event(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        is_valid_chat_id_func=is_valid_chat_id,
        socket_rate_ok_func=ctx._socket_rate_ok,
        get_db_connection_func=get_db_connection,
        chat_partner_state_func=ctx._chat_partner_state,
        join_room_func=ctx.join_room,
        emit_blocked_error_func=ctx._emit_blocked_error,
        emit_func=emit,
        blocked_error_message='Чат доступен только для чтения: пользователь заблокирован.',
        unauthorized_error_message='Необходимо войти в систему.',
        logger=ctx.logger,
    )


@socketio.on('leave')
@ctx.authenticated_only
def on_leave(data):
    handle_leave_event(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        socket_rate_ok_func=ctx._socket_rate_ok,
        is_valid_chat_id_func=is_valid_chat_id,
        leave_room_func=ctx.leave_room,
    )


@socketio.on('messages_seen')
@ctx.authenticated_only
def handle_messages_seen(data):
    handle_messages_seen_event(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        is_valid_chat_id_func=is_valid_chat_id,
        socket_rate_ok_func=ctx._socket_rate_ok,
        get_db_connection_func=get_db_connection,
        chat_partner_state_func=ctx._chat_partner_state,
        emit_func=emit,
    )


@socketio.on('voice_message_listened')
@ctx.authenticated_only
def handle_voice_message_listened(data):
    handle_voice_message_listened_event(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        positive_int_func=ctx._positive_int,
        is_valid_chat_id_func=is_valid_chat_id,
        socket_rate_ok_func=ctx._socket_rate_ok,
        get_db_connection_func=get_db_connection,
        chat_partner_state_func=ctx._chat_partner_state,
        emit_func=emit,
    )


@socketio.on('typing')
@ctx.authenticated_only
def handle_typing(data):
    handle_typing_event(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        socket_signal_interval_ok_func=ctx._socket_signal_interval_ok,
        socket_rate_ok_func=ctx._socket_rate_ok,
        is_valid_chat_id_func=is_valid_chat_id,
        get_db_connection_func=get_db_connection,
        chat_partner_state_func=ctx._chat_partner_state,
        emit_func=emit,
    )


@socketio.on('stop_typing')
@ctx.authenticated_only
def handle_stop_typing(data):
    handle_stop_typing_event(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        socket_signal_interval_ok_func=ctx._socket_signal_interval_ok,
        socket_rate_ok_func=ctx._socket_rate_ok,
        is_valid_chat_id_func=is_valid_chat_id,
        get_db_connection_func=get_db_connection,
        chat_partner_state_func=ctx._chat_partner_state,
        emit_func=emit,
    )
