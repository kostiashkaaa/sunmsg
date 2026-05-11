from __future__ import annotations

from typing import Any

from app.sockets.event_envelope import emit_enveloped_socket_event


def build_route_socket_emitter(*, raw_emit_func, get_db_connection_func, logger):
    def emit_socket_event(event_name: str, payload: Any = None, *args, chat_id: str | None = None, request_id: str | None = None, **kwargs):
        return emit_enveloped_socket_event(
            raw_emit_func=raw_emit_func,
            get_db_connection_func=get_db_connection_func,
            logger=logger,
            event_type=event_name,
            payload=payload if payload is not None else {},
            chat_id=chat_id,
            request_id=request_id,
            args=args,
            kwargs=kwargs,
        )

    return emit_socket_event
