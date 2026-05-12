from __future__ import annotations

import inspect
from typing import Any

from app.sockets.event_envelope import emit_enveloped_socket_event


def _build_envelope_connection_factory(get_db_connection_func):
    try:
        supports_request_scope_kw = 'request_scoped' in inspect.signature(get_db_connection_func).parameters
    except (TypeError, ValueError):
        supports_request_scope_kw = False

    def get_envelope_connection():
        if supports_request_scope_kw:
            return get_db_connection_func(request_scoped=False)
        return get_db_connection_func()

    return get_envelope_connection


def build_route_socket_emitter(*, raw_emit_func, get_db_connection_func, logger):
    get_envelope_connection = _build_envelope_connection_factory(get_db_connection_func)

    def emit_socket_event(event_name: str, payload: Any = None, *args, chat_id: str | None = None, request_id: str | None = None, **kwargs):
        return emit_enveloped_socket_event(
            raw_emit_func=raw_emit_func,
            get_db_connection_func=get_envelope_connection,
            logger=logger,
            event_type=event_name,
            payload=payload if payload is not None else {},
            chat_id=chat_id,
            request_id=request_id,
            args=args,
            kwargs=kwargs,
        )

    return emit_socket_event
