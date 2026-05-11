import logging
import threading
from flask import current_app, request, session
from flask_socketio import disconnect, emit, join_room, leave_room
from flask_wtf.csrf import validate_csrf
from wtforms.validators import ValidationError

from app.database import get_db_connection
from app.sockets.delivery import collect_and_mark_delivered, emit_delivered_events
from app.sockets.event_envelope import emit_enveloped_socket_event
from app.sockets.rate_limit import (
    socket_connect_ip_rate_ok,
    socket_connect_ip_rate_ok_redis,
    socket_rate_ok,
    socket_signal_interval_ok,
)
from app.sockets.validation import (
    clear_invalid_session_user,
    normalize_request_id,
    parse_db_utc_timestamp,
    positive_int,
    require_payload_dict,
    sanitize_message_type,
)
from app.services.blocking import (
    block_error_payload,
    normalize_block_state,
)

from . import chat_access
from . import errors

logger = logging.getLogger(__name__)

_EVENT_SHARED_SYMBOLS = (join_room, leave_room)

_MSG_LIMIT = 30
_MSG_WINDOW = 60
_SOCKET_RATE_DEFAULT_EVENT = 'default'
_SOCKET_EVENT_RATE_LIMITS = {
    'activity_update': (120, 60),
    'join': (60, 60),
    'leave': (60, 60),
    'send_message': (30, 60),
    'edit_message': (30, 60),
    'delete_messages': (30, 60),
    'toggle_reaction': (45, 60),
    'messages_seen': (60, 60),
    'voice_message_listened': (120, 60),
    'typing': (30, 60),
    'stop_typing': (45, 60),
    'pin_message': (20, 60),
    'unpin_message': (20, 60),
    'favorite_message': (30, 60),
    'unfavorite_message': (30, 60),
}
_TYPING_EVENT_MIN_INTERVALS = {
    'typing': 2.5,
    'stop_typing': 1.0,
}
_typing_event_last_emit = {}
_ALLOWED_MESSAGE_TYPES = {'text', 'link', 'photo', 'video', 'audio', 'file'}
_MAX_MESSAGE_EDITS = 5
_MESSAGE_EDIT_WINDOW_SECONDS = 48 * 60 * 60
_DEFAULT_SOCKET_CONNECT_IP_LIMIT = 180
_DEFAULT_SOCKET_CONNECT_IP_WINDOW_SECONDS = 60
_DEFAULT_SOCKET_MAX_CONNECTIONS_PER_USER = 12
_CONNECT_IP_ATTEMPTS = {}
_CONNECT_IP_ATTEMPTS_LOCK = threading.Lock()
_CONNECT_IP_ATTEMPTS_MAX_KEYS = 4096
_CONNECT_IP_REDIS_CLIENT = None
_CONNECT_IP_REDIS_URL = ''
_CONNECT_IP_REDIS_LOCK = threading.Lock()
_CONNECT_IP_REDIS_LAST_ERROR_URL = ''


def _clear_invalid_session_user() -> None:
    clear_invalid_session_user(session)


def _socket_rate_ok(user_id: int, event_name: str | None = None) -> bool:
    return socket_rate_ok(
        user_id,
        event_name=event_name,
        get_db_connection=get_db_connection,
        logger=logger,
        default_event_name=_SOCKET_RATE_DEFAULT_EVENT,
        default_limit=_MSG_LIMIT,
        default_window=_MSG_WINDOW,
        event_limits=_SOCKET_EVENT_RATE_LIMITS,
    )


def _socket_signal_interval_ok(user_id: int, event_name: str) -> bool:
    return socket_signal_interval_ok(
        user_id,
        event_name,
        typing_event_min_intervals=_TYPING_EVENT_MIN_INTERVALS,
        last_emit_by_event=_typing_event_last_emit,
        window_seconds=_MSG_WINDOW,
    )


def _socket_connect_ip_rate_ok(remote_ip: str | None, *, limit: int, window_seconds: int) -> bool:
    redis_client = _get_socket_connect_ip_redis_client()
    if redis_client is not None:
        try:
            return socket_connect_ip_rate_ok_redis(
                remote_ip,
                limit=limit,
                window_seconds=window_seconds,
                redis_client=redis_client,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                'Socket connect Redis IP rate-limit failed, fallback to in-memory limiter: %s',
                exc,
            )

    return socket_connect_ip_rate_ok(
        remote_ip,
        limit=limit,
        window_seconds=window_seconds,
        attempts_by_ip=_CONNECT_IP_ATTEMPTS,
        attempts_lock=_CONNECT_IP_ATTEMPTS_LOCK,
        max_tracked_ips=_CONNECT_IP_ATTEMPTS_MAX_KEYS,
    )


def _get_socket_connect_ip_redis_client():
    global _CONNECT_IP_REDIS_CLIENT, _CONNECT_IP_REDIS_URL, _CONNECT_IP_REDIS_LAST_ERROR_URL

    redis_url = str(current_app.config.get('REDIS_URL') or '').strip()
    if not redis_url:
        return None

    with _CONNECT_IP_REDIS_LOCK:
        if _CONNECT_IP_REDIS_CLIENT is not None and _CONNECT_IP_REDIS_URL == redis_url:
            return _CONNECT_IP_REDIS_CLIENT

        try:
            import redis

            client = redis.Redis.from_url(redis_url, decode_responses=False)
            client.ping()
            _CONNECT_IP_REDIS_CLIENT = client
            _CONNECT_IP_REDIS_URL = redis_url
            _CONNECT_IP_REDIS_LAST_ERROR_URL = ''
            return _CONNECT_IP_REDIS_CLIENT
        except Exception as exc:  # noqa: BLE001
            if _CONNECT_IP_REDIS_LAST_ERROR_URL != redis_url:
                logger.warning(
                    'Socket connect IP rate-limit Redis init failed for %s, using in-memory fallback: %s',
                    redis_url,
                    exc,
                )
                _CONNECT_IP_REDIS_LAST_ERROR_URL = redis_url
            _CONNECT_IP_REDIS_CLIENT = None
            _CONNECT_IP_REDIS_URL = redis_url
            return None


def _socket_connect_limits():
    cfg = current_app.config
    ip_limit = max(
        0,
        int(cfg.get('SOCKET_CONNECT_IP_LIMIT', _DEFAULT_SOCKET_CONNECT_IP_LIMIT) or 0),
    )
    ip_window_seconds = max(
        1,
        int(
            cfg.get(
                'SOCKET_CONNECT_IP_WINDOW_SECONDS',
                _DEFAULT_SOCKET_CONNECT_IP_WINDOW_SECONDS,
            )
            or 1
        ),
    )
    max_connections_per_user = max(
        0,
        int(
            cfg.get(
                'SOCKET_MAX_CONNECTIONS_PER_USER',
                _DEFAULT_SOCKET_MAX_CONNECTIONS_PER_USER,
            )
            or 0
        ),
    )
    return ip_limit, ip_window_seconds, max_connections_per_user


def _clear_socket_connect_rate_state() -> None:
    global _CONNECT_IP_REDIS_CLIENT, _CONNECT_IP_REDIS_URL, _CONNECT_IP_REDIS_LAST_ERROR_URL
    with _CONNECT_IP_ATTEMPTS_LOCK:
        _CONNECT_IP_ATTEMPTS.clear()
    with _CONNECT_IP_REDIS_LOCK:
        _CONNECT_IP_REDIS_CLIENT = None
        _CONNECT_IP_REDIS_URL = ''
        _CONNECT_IP_REDIS_LAST_ERROR_URL = ''


def _parse_db_utc_timestamp(value):
    return parse_db_utc_timestamp(value)


def _socket_csrf_ok(data) -> bool:
    return errors.socket_csrf_ok(
        data,
        validate_csrf_func=validate_csrf,
        emit_func=emit,
        logger=logger,
        user_id=session.get('user_id'),
        validation_error_cls=ValidationError,
    )


def _socket_connect_csrf_ok(auth) -> bool:
    return errors.socket_connect_csrf_ok(
        auth,
        validate_csrf_func=validate_csrf,
        logger=logger,
        user_id=session.get('user_id'),
        sid=getattr(request, 'sid', '-'),
        validation_error_cls=ValidationError,
    )


def _require_payload_dict(data):
    return require_payload_dict(data, emit_func=emit)


def _positive_int(value):
    return positive_int(value)


def _normalize_request_id(value) -> str:
    return normalize_request_id(value)


def _sanitize_message_type(value):
    return sanitize_message_type(value, allowed_message_types=_ALLOWED_MESSAGE_TYPES)


def _emit_blocked_error(message: str, state=None, request_id: str | None = None):
    errors.emit_blocked_error(
        message,
        state=state,
        request_id=request_id,
        block_error_payload_func=block_error_payload,
        normalize_block_state_func=normalize_block_state,
        emit_func=emit,
    )


def _emit_socket_event(event_name: str, payload=None, *args, chat_id: str | None = None, request_id: str | None = None, **kwargs):
    return emit_enveloped_socket_event(
        raw_emit_func=emit,
        get_db_connection_func=get_db_connection,
        logger=logger,
        event_type=event_name,
        payload=payload if payload is not None else {},
        chat_id=chat_id,
        request_id=request_id,
        args=args,
        kwargs=kwargs,
    )


def _chat_partner_state(conn, user_id: int, chat_id: str):
    return chat_access.chat_partner_state(conn, user_id, chat_id)


def _emit_chat_status_for_user(conn, user_id: int, payload: dict):
    chat_access.emit_chat_status_for_user(conn, user_id, payload, emit_func=_emit_socket_event)


def _collect_and_mark_delivered(conn, receiver_id: int, *, chat_id: str | None = None):
    return collect_and_mark_delivered(conn, receiver_id, chat_id=chat_id)


def _emit_delivered_events(delivered_rows):
    emit_delivered_events(delivered_rows, emit_func=_emit_socket_event)


def authenticated_only(f):
    from functools import wraps

    @wraps(f)
    def wrapped(*args, **kwargs):
        if 'public_key_pem' not in session or 'user_id' not in session:
            disconnect()
            return
        return f(*args, **kwargs)

    return wrapped
