from __future__ import annotations

import inspect
from typing import Any

from app.sockets.event_envelope import emit_enveloped_socket_event


def _extract_payload_chat_id(payload: Any) -> str:
    if not isinstance(payload, dict):
        return ''
    return str(payload.get('chat_id') or '').strip()


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


def _resolve_raw_emit_func(raw_emit_func):
    bound_owner = getattr(raw_emit_func, '__self__', None)
    bound_name = getattr(raw_emit_func, '__name__', None)
    if bound_owner is None or not bound_name:
        return raw_emit_func, lambda: True
    original_bound_func = getattr(raw_emit_func, '__func__', raw_emit_func)

    def is_current_emit_original():
        current_emit = getattr(bound_owner, bound_name)
        return getattr(current_emit, '__func__', current_emit) is original_bound_func

    def call_current_bound_emit(*args, **kwargs):
        return getattr(bound_owner, bound_name)(*args, **kwargs)

    return call_current_bound_emit, is_current_emit_original


def build_route_socket_emitter(*, raw_emit_func, get_db_connection_func, logger):
    get_envelope_connection = _build_envelope_connection_factory(get_db_connection_func)
    emit_func, is_current_emit_original = _resolve_raw_emit_func(raw_emit_func)

    def emit_socket_event(event_name: str, payload: Any = None, *args, chat_id: str | None = None, request_id: str | None = None, **kwargs):
        payload_object = payload if payload is not None else {}
        if not is_current_emit_original() or not (str(chat_id or '').strip() or _extract_payload_chat_id(payload_object)):
            return emit_func(str(event_name or '').strip(), payload_object, *args, **kwargs)

        return emit_enveloped_socket_event(
            raw_emit_func=emit_func,
            get_db_connection_func=get_envelope_connection,
            logger=logger,
            event_type=event_name,
            payload=payload_object,
            chat_id=chat_id,
            request_id=request_id,
            args=args,
            kwargs=kwargs,
        )

    return emit_socket_event
