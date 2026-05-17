from flask import session

from app.database import get_db_connection
from app.extensions import socketio
from app.services.crypto import is_valid_chat_id
from app.sockets.call_handlers import (
    handle_call_accept,
    handle_call_cancel,
    handle_call_end,
    handle_call_initiate,
    handle_call_media_state,
    handle_call_reject,
    handle_call_sync,
    handle_call_webrtc_signal,
)
from app.services.presence import count_active
from app.services.web_push import send_call_incoming_push

from . import context as ctx

_WEBRTC_SIGNAL_EVENTS = (
    'call_offer',
    'call_answer',
    'call_ice_candidate',
)


@socketio.on('call_initiate')
@ctx.authenticated_only
def on_call_initiate(data):
    handle_call_initiate(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        socket_rate_ok_func=ctx._socket_rate_ok,
        is_valid_chat_id_func=is_valid_chat_id,
        get_db_connection_func=get_db_connection,
        emit_func=ctx._emit_socket_event,
        count_active_func=count_active,
        send_call_incoming_push_func=send_call_incoming_push,
        logger=ctx.logger,
    )


@socketio.on('call_accept')
@ctx.authenticated_only
def on_call_accept(data):
    handle_call_accept(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        socket_rate_ok_func=ctx._socket_rate_ok,
        get_db_connection_func=get_db_connection,
        emit_func=ctx._emit_socket_event,
        logger=ctx.logger,
    )


@socketio.on('call_reject')
@ctx.authenticated_only
def on_call_reject(data):
    handle_call_reject(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        socket_rate_ok_func=ctx._socket_rate_ok,
        get_db_connection_func=get_db_connection,
        emit_func=ctx._emit_socket_event,
        logger=ctx.logger,
    )


@socketio.on('call_cancel')
@ctx.authenticated_only
def on_call_cancel(data):
    handle_call_cancel(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        socket_rate_ok_func=ctx._socket_rate_ok,
        get_db_connection_func=get_db_connection,
        emit_func=ctx._emit_socket_event,
        logger=ctx.logger,
    )


@socketio.on('call_end')
@ctx.authenticated_only
def on_call_end(data):
    handle_call_end(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        socket_rate_ok_func=ctx._socket_rate_ok,
        get_db_connection_func=get_db_connection,
        emit_func=ctx._emit_socket_event,
        logger=ctx.logger,
    )


@socketio.on('call_sync')
@ctx.authenticated_only
def on_call_sync(data):
    handle_call_sync(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        socket_rate_ok_func=ctx._socket_rate_ok,
        get_db_connection_func=get_db_connection,
        emit_func=ctx._emit_socket_event,
        logger=ctx.logger,
    )


@socketio.on('call_media_state')
@ctx.authenticated_only
def on_call_media_state(data):
    handle_call_media_state(
        data,
        session_store=session,
        require_payload_dict_func=ctx._require_payload_dict,
        socket_csrf_ok_func=ctx._socket_csrf_ok,
        socket_rate_ok_func=ctx._socket_rate_ok,
        get_db_connection_func=get_db_connection,
        emit_func=ctx._emit_socket_event,
        logger=ctx.logger,
    )


def _make_webrtc_signal_handler(event_name: str):
    @ctx.authenticated_only
    def _handler(data):
        handle_call_webrtc_signal(
            data,
            session_store=session,
            require_payload_dict_func=ctx._require_payload_dict,
            socket_csrf_ok_func=ctx._socket_csrf_ok,
            socket_rate_ok_func=ctx._socket_rate_ok,
            get_db_connection_func=get_db_connection,
            emit_func=ctx._emit_socket_event,
            event_name=event_name,
            logger=ctx.logger,
        )
    _handler.__name__ = f'on_{event_name}'
    return _handler


for _event in _WEBRTC_SIGNAL_EVENTS:
    socketio.on(_event)(_make_webrtc_signal_handler(_event))
