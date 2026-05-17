from datetime import datetime, timezone

from flask import request, session

from app.db_backend import DatabaseError
from app.extensions import socketio
from app.database import get_db_connection
from app.services.presence import (
    add_connected,
    count_active,
    count_connected,
    remove_active,
    remove_connected,
)
from app.sockets.connection_handlers import (
    handle_connect_event,
    handle_disconnect_event,
)
from app.sockets.call_handlers import handle_call_disconnect_cleanup

from . import context as ctx


@socketio.on('connect')
def handle_connect(auth=None):
    ip_limit, ip_window_seconds, max_connections_per_user = ctx._socket_connect_limits()
    handle_connect_event(
        auth,
        session_store=session,
        request_sid=request.sid,
        request_remote_addr=request.remote_addr,
        clear_invalid_session_user_func=ctx._clear_invalid_session_user,
        socket_connect_csrf_ok_func=ctx._socket_connect_csrf_ok,
        socket_connect_ip_rate_ok_func=ctx._socket_connect_ip_rate_ok,
        socket_connect_ip_limit=ip_limit,
        socket_connect_ip_window_seconds=ip_window_seconds,
        get_db_connection_func=get_db_connection,
        join_room_func=ctx.join_room,
        count_connected_func=count_connected,
        add_connected_func=add_connected,
        max_connections_per_user=max_connections_per_user,
        collect_and_mark_delivered_func=ctx._collect_and_mark_delivered,
        emit_delivered_events_func=ctx._emit_delivered_events,
        logger=ctx.logger,
        database_error_cls=DatabaseError,
        connection_refused_error_cls=ConnectionRefusedError,
    )


@socketio.on('disconnect')
def handle_disconnect():
    handle_disconnect_event(
        session_store=session,
        request_sid=request.sid,
        leave_room_func=ctx.leave_room,
        count_active_func=count_active,
        remove_connected_func=remove_connected,
        remove_active_func=remove_active,
        count_connected_func=count_connected,
        get_db_connection_func=get_db_connection,
        emit_chat_status_for_user_func=ctx._emit_chat_status_for_user,
        utc_now_text_func=lambda: datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S'),
        logger=ctx.logger,
        terminate_calls_func=lambda uid: handle_call_disconnect_cleanup(
            uid,
            get_db_connection_func=get_db_connection,
            emit_func=ctx._emit_socket_event,
            logger=ctx.logger,
        ),
    )
