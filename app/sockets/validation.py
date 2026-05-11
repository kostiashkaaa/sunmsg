from datetime import datetime, timezone
from logging import Logger
from typing import Any


def clear_invalid_session_user(session_store: Any) -> None:
    session_store.pop('user_id', None)
    session_store.pop('public_key_pem', None)


def parse_db_utc_timestamp(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)

    text = str(value).strip()
    if not text:
        return None
    for fmt in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S'):
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    try:
        parsed = datetime.fromisoformat(text.replace('Z', '+00:00'))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def socket_csrf_ok(  # noqa: PLR0913 - validation helper contract
    data,
    *,
    validate_csrf_func,
    emit_func,
    logger: Logger,
    user_id,
    validation_error_cls,
) -> bool:
    token = ''
    if isinstance(data, dict):
        token = str(data.get('csrf_token') or '').strip()

    if not token:
        emit_func('error', {'message': 'CSRF token is required.'})
        return False

    try:
        validate_csrf_func(token)
    except validation_error_cls:
        logger.warning('Socket CSRF validation failed for user_id=%s', user_id)
        emit_func('error', {'message': 'Invalid CSRF token.'})
        return False
    except Exception as exc:
        logger.error('Socket CSRF validation error for user_id=%s: %s', user_id, exc)
        emit_func('error', {'message': 'CSRF validation failed.'})
        return False

    return True


def socket_connect_csrf_ok(  # noqa: PLR0913 - validation helper contract
    auth,
    *,
    validate_csrf_func,
    logger: Logger,
    user_id,
    sid: str,
    validation_error_cls,
) -> bool:
    token = ''
    if isinstance(auth, dict):
        token = str(auth.get('csrf_token') or '').strip()

    if not token:
        logger.warning(
            'Socket connect rejected due to missing CSRF token for user_id=%s sid=%s',
            user_id,
            sid,
        )
        return False

    try:
        validate_csrf_func(token)
    except validation_error_cls:
        logger.warning(
            'Socket connect rejected due to invalid CSRF token for user_id=%s sid=%s',
            user_id,
            sid,
        )
        return False
    except Exception as exc:
        logger.error(
            'Socket connect CSRF validation error for user_id=%s sid=%s: %s',
            user_id,
            sid,
            exc,
        )
        return False

    return True


def require_payload_dict(data, *, emit_func):
    if isinstance(data, dict):
        return data
    emit_func('error', {'message': 'Invalid socket payload.'})
    return None


def positive_int(value):
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def normalize_request_id(value) -> str:
    token = str(value or '').strip()
    if not token:
        return ''
    if len(token) > 72:
        return ''
    return token


def sanitize_message_type(value, *, allowed_message_types) -> str:
    message_type = str(value or 'text').strip().lower()
    return message_type if message_type in allowed_message_types else 'text'
