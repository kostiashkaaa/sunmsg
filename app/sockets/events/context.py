import logging
import threading
from flask import current_app, has_app_context, request, session
from flask_socketio import disconnect, emit, join_room, leave_room
from flask_wtf.csrf import validate_csrf
from wtforms.validators import ValidationError

from app.database import get_db_connection
from app.sockets.delivery import collect_and_mark_delivered, emit_delivered_events
from app.services.event_envelope import emit_enveloped_socket_event
from app.sockets.rate_limit import (
    redis_token_bucket_rate_ok,
    redis_token_buckets_rate_ok,
    socket_connect_ip_rate_ok,
    socket_connect_ip_rate_ok_redis,
    socket_rate_ok,
    socket_rate_ok_redis,
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
from app.services.abuse_protection import (
    has_reciprocal_contact,
    user_trust_profile,
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
    'set_chat_auto_delete': (10, 60),
    # Calls signalling
    'call_initiate': (5, 60),
    'call_accept': (15, 60),
    'call_reject': (15, 60),
    'call_cancel': (15, 60),
    'call_end': (20, 60),
    'call_sync': (20, 60),
    'call_media_state': (60, 60),
    'call_offer': (10, 60),
    'call_answer': (10, 60),
    'call_ice_candidate': (300, 60),
}
_TYPING_EVENT_MIN_INTERVALS = {
    'typing': 2.5,
    'stop_typing': 1.0,
}
_typing_event_last_emit = {}
_ALLOWED_MESSAGE_TYPES = {'text', 'link', 'photo', 'video', 'audio', 'file', 'voice'}
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
_SOCKET_RATE_REDIS_CLIENT = None
_SOCKET_RATE_REDIS_URL = ''
_SOCKET_RATE_REDIS_LOCK = threading.Lock()
_SOCKET_RATE_REDIS_LAST_ERROR_URL = ''


def _clear_invalid_session_user() -> None:
    clear_invalid_session_user(session)


def _socket_rate_ok(user_id: int, event_name: str | None = None) -> bool:
    cfg = current_app.config if has_app_context() else {}
    redis_client = _get_socket_rate_redis_client()
    if redis_client is not None:
        try:
            return socket_rate_ok_redis(
                user_id,
                event_name=event_name,
                redis_client=redis_client,
                default_event_name=_SOCKET_RATE_DEFAULT_EVENT,
                default_limit=_MSG_LIMIT,
                default_window=_MSG_WINDOW,
                event_limits=_SOCKET_EVENT_RATE_LIMITS,
                global_event_limit=int(cfg.get('SOCKET_RATE_GLOBAL_EVENT_LIMIT', 0) or 0),
                global_event_window=int(cfg.get('SOCKET_RATE_GLOBAL_EVENT_WINDOW_SECONDS', 60) or 60),
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning('Socket Redis rate-limit failed user_id=%s event=%s: %s', user_id, event_name, exc)
            if str(cfg.get('ENV_NAME') or '').strip().lower() == 'production':
                return False

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


def _socket_send_context_rate_check(
    conn,
    *,
    sender_id: int,
    chat_id: str,
    chat_type: str,
    receiver_id: int | None,
    message_type: str,
) -> dict:
    cfg = current_app.config
    redis_client = _get_socket_rate_redis_client()
    if redis_client is None:
        return {'allowed': True, 'reason': 'redis_unavailable', 'auto_mute': False}

    profile = user_trust_profile(
        conn,
        user_id=int(sender_id),
        new_account_seconds=int(cfg.get('TRUST_RAMP_NEW_ACCOUNT_SECONDS', 0) or 0),
        signal_window_seconds=int(cfg.get('TRUST_RAMP_SIGNAL_WINDOW_SECONDS', 86400) or 86400),
        min_confirmed_contacts=int(cfg.get('TRUST_RAMP_MIN_CONFIRMED_CONTACTS', 0) or 0),
        min_inbound_repliers=int(cfg.get('TRUST_RAMP_MIN_INBOUND_REPLIERS', 0) or 0),
    )
    is_limited = bool(profile.get('is_limited'))
    burst_limit = int(
        cfg.get(
            'SOCKET_SEND_NEW_ACCOUNT_BURST_LIMIT' if is_limited else 'SOCKET_SEND_BURST_LIMIT',
            0,
        )
        or 0
    )
    chat_sender_limit = int(
        cfg.get(
            'SOCKET_SEND_NEW_ACCOUNT_CHAT_SENDER_LIMIT' if is_limited else 'SOCKET_SEND_CHAT_SENDER_LIMIT',
            0,
        )
        or 0
    )
    media_limit = int(
        cfg.get(
            'SOCKET_SEND_NEW_ACCOUNT_MEDIA_LIMIT' if is_limited else 'SOCKET_SEND_MEDIA_LIMIT',
            0,
        )
        or 0
    )
    buckets = [
        {
            'key': f'user:{int(sender_id)}:burst:send_message',
            'limit': burst_limit,
            'window_seconds': int(cfg.get('SOCKET_SEND_BURST_WINDOW_SECONDS', 10) or 10),
        },
        {
            'key': f'chat:{str(chat_id)}:sender:{int(sender_id)}',
            'limit': chat_sender_limit,
            'window_seconds': int(cfg.get('SOCKET_SEND_CHAT_SENDER_WINDOW_SECONDS', 60) or 60),
        },
    ]
    normalized_message_type = str(message_type or 'text').strip().lower()
    if normalized_message_type in {'photo', 'video', 'audio', 'file', 'voice'}:
        buckets.append(
            {
                'key': f'user:{int(sender_id)}:media:{normalized_message_type}',
                'limit': media_limit,
                'window_seconds': int(cfg.get('SOCKET_SEND_MEDIA_WINDOW_SECONDS', 3600) or 3600),
            }
        )
    if (
        str(chat_type or '').strip().lower() != 'group'
        and receiver_id
        and not has_reciprocal_contact(conn, sender_id=int(sender_id), receiver_id=int(receiver_id))
    ):
        buckets.append(
            {
                'key': f'recipient:{int(receiver_id)}:unknown_sender:{int(sender_id)}',
                'limit': int(cfg.get('SOCKET_SEND_UNKNOWN_RECIPIENT_LIMIT', 0) or 0),
                'window_seconds': int(
                    cfg.get('SOCKET_SEND_UNKNOWN_RECIPIENT_WINDOW_SECONDS', 86400) or 86400
                ),
            }
        )

    try:
        if not redis_token_buckets_rate_ok(redis_client, buckets):
            return {'allowed': False, 'reason': 'context_rate_limit', 'auto_mute': False, 'profile': profile}
        send_spike_limit = int(cfg.get('ABUSE_AUTO_MUTE_SENDS_THRESHOLD', 0) or 0)
        if send_spike_limit > 0 and not redis_token_bucket_rate_ok(
            redis_client,
            f'user:{int(sender_id)}:abuse:send_spike',
            limit=send_spike_limit,
            window_seconds=int(cfg.get('ABUSE_AUTO_MUTE_WINDOW_SECONDS', 3600) or 3600),
        ):
            return {'allowed': False, 'reason': 'send_rate_spike', 'auto_mute': True, 'profile': profile}
    except Exception as exc:  # noqa: BLE001
        logger.warning('Socket send context Redis rate-limit failed user_id=%s: %s', sender_id, exc)
        if str(cfg.get('ENV_NAME') or '').strip().lower() == 'production':
            return {'allowed': False, 'reason': 'redis_error', 'auto_mute': False, 'profile': profile}

    return {'allowed': True, 'reason': 'ok', 'auto_mute': False, 'profile': profile}


def _socket_signal_interval_ok(user_id: int, event_name: str) -> bool:
    return socket_signal_interval_ok(
        user_id,
        event_name,
        typing_event_min_intervals=_TYPING_EVENT_MIN_INTERVALS,
        last_emit_by_event=_typing_event_last_emit,
        window_seconds=_MSG_WINDOW,
    )


def _get_socket_rate_redis_client():
    global _SOCKET_RATE_REDIS_CLIENT, _SOCKET_RATE_REDIS_URL, _SOCKET_RATE_REDIS_LAST_ERROR_URL

    if not has_app_context():
        return None

    cfg = current_app.config
    redis_url = str(cfg.get('SOCKET_RATE_REDIS_URL') or cfg.get('REDIS_URL') or '').strip()
    if not redis_url:
        return None

    with _SOCKET_RATE_REDIS_LOCK:
        if _SOCKET_RATE_REDIS_CLIENT is not None and _SOCKET_RATE_REDIS_URL == redis_url:
            return _SOCKET_RATE_REDIS_CLIENT

        try:
            import redis

            client = redis.Redis.from_url(redis_url, decode_responses=False)
            client.ping()
            _SOCKET_RATE_REDIS_CLIENT = client
            _SOCKET_RATE_REDIS_URL = redis_url
            _SOCKET_RATE_REDIS_LAST_ERROR_URL = ''
            logger.info('Socket rate-limit store: using Redis (%s)', redis_url)
            return _SOCKET_RATE_REDIS_CLIENT
        except Exception as exc:  # noqa: BLE001
            _SOCKET_RATE_REDIS_CLIENT = None
            _SOCKET_RATE_REDIS_URL = redis_url
            if _SOCKET_RATE_REDIS_LAST_ERROR_URL != redis_url:
                logger.warning(
                    'Socket rate-limit Redis init failed for %s, using DB fallback outside production: %s',
                    redis_url,
                    exc,
                )
                _SOCKET_RATE_REDIS_LAST_ERROR_URL = redis_url
    return None


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
