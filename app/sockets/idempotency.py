from __future__ import annotations

import hashlib
import logging
import math
import os
import threading
import time
from dataclasses import dataclass

from flask import current_app, has_app_context


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Reservation:
    user_id: int
    event_name: str
    request_id: str
    backend: str = 'memory'


_LOCK = threading.Lock()
_ENTRIES: dict[tuple[int, str, str], tuple[float, str]] = {}
_MAX_ENTRIES = 50_000
_PENDING_STATUS = 'pending'
_COMPLETED_STATUS = 'completed'
_REDIS_PREFIX = 'socket:idempotency:'
_REDIS_CLIENT = None
_REDIS_URL = ''
_REDIS_LAST_ERROR_URL = ''


class SocketIdempotencyUnavailable(RuntimeError):
    pass


def _now() -> float:
    return time.monotonic()


def _resolve_redis_url() -> str:
    if has_app_context():
        return str(current_app.config.get('REDIS_URL') or '').strip()
    return str(os.environ.get('REDIS_URL') or '').strip()


def _requires_shared_idempotency() -> bool:
    if has_app_context():
        return str(current_app.config.get('ENV_NAME') or '').strip().lower() == 'production'
    env_name = (
        os.environ.get('APP_ENV')
        or os.environ.get('FLASK_ENV')
        or ''
    )
    return str(env_name).strip().lower() == 'production'


def _get_redis_client():
    global _REDIS_CLIENT, _REDIS_URL, _REDIS_LAST_ERROR_URL

    redis_url = _resolve_redis_url()
    if not redis_url:
        _REDIS_CLIENT = None
        _REDIS_URL = ''
        return None
    if _REDIS_CLIENT is not None and _REDIS_URL == redis_url:
        return _REDIS_CLIENT
    try:
        import redis

        _REDIS_CLIENT = redis.Redis.from_url(redis_url, decode_responses=True)
        _REDIS_URL = redis_url
        _REDIS_LAST_ERROR_URL = ''
        return _REDIS_CLIENT
    except Exception as exc:  # noqa: BLE001
        _REDIS_CLIENT = None
        _REDIS_URL = redis_url
        if _REDIS_LAST_ERROR_URL != redis_url:
            logger.warning('Socket idempotency Redis init failed for %s: %s', redis_url, exc)
            _REDIS_LAST_ERROR_URL = redis_url
        return None


def _redis_key(*, user_id: int, event_name: str, request_id: str) -> str:
    digest = hashlib.sha256(f'{int(user_id)}\0{event_name}\0{request_id}'.encode('utf-8')).hexdigest()
    return f'{_REDIS_PREFIX}{digest}'


def _ttl_seconds(value: float) -> int:
    return max(1, int(math.ceil(float(value))))


def _evict_expired(now_ts: float) -> None:
    expired = [key for key, (expires_at, _status) in _ENTRIES.items() if expires_at <= now_ts]
    for key in expired:
        _ENTRIES.pop(key, None)


def reserve_request(
    *,
    user_id: int,
    event_name: str,
    request_id: str,
    pending_ttl_seconds: float = 20.0,
    completed_ttl_seconds: float = 180.0,
) -> tuple[bool, Reservation | None]:
    normalized_request_id = str(request_id or '').strip()
    normalized_event_name = str(event_name or '').strip()
    if not normalized_request_id or not normalized_event_name:
        return True, None
    if pending_ttl_seconds <= 0 or completed_ttl_seconds <= 0:
        return True, Reservation(int(user_id), normalized_event_name, normalized_request_id)

    key = (int(user_id), normalized_event_name, normalized_request_id)
    redis_client = _get_redis_client()
    if redis_client is not None:
        redis_key = _redis_key(
            user_id=key[0],
            event_name=key[1],
            request_id=key[2],
        )
        try:
            allowed = redis_client.set(
                redis_key,
                _PENDING_STATUS,
                nx=True,
                ex=_ttl_seconds(pending_ttl_seconds),
            )
            if not allowed:
                return False, None
            return True, Reservation(key[0], key[1], key[2], backend='redis')
        except Exception as exc:  # noqa: BLE001
            if _requires_shared_idempotency():
                raise SocketIdempotencyUnavailable('Socket idempotency Redis reserve failed') from exc
            logger.warning('Socket idempotency Redis reserve failed, using memory fallback: %s', exc)
    elif _requires_shared_idempotency():
        raise SocketIdempotencyUnavailable('Socket idempotency Redis is unavailable')

    now_ts = _now()
    with _LOCK:
        _evict_expired(now_ts)
        if len(_ENTRIES) > _MAX_ENTRIES:
            oldest = sorted(_ENTRIES.items(), key=lambda item: item[1][0])[: max(1, len(_ENTRIES) // 10)]
            for stale_key, _value in oldest:
                _ENTRIES.pop(stale_key, None)
        existing = _ENTRIES.get(key)
        if existing is not None:
            expires_at, status = existing
            if expires_at > now_ts and status in {_PENDING_STATUS, _COMPLETED_STATUS}:
                return False, None
        _ENTRIES[key] = (now_ts + float(pending_ttl_seconds), _PENDING_STATUS)
    return True, Reservation(key[0], key[1], key[2])


def mark_request_completed(
    reservation: Reservation | None,
    *,
    completed_ttl_seconds: float = 180.0,
) -> None:
    if reservation is None:
        return
    key = (reservation.user_id, reservation.event_name, reservation.request_id)
    if reservation.backend == 'redis':
        redis_client = _get_redis_client()
        if redis_client is not None:
            try:
                redis_client.set(
                    _redis_key(
                        user_id=reservation.user_id,
                        event_name=reservation.event_name,
                        request_id=reservation.request_id,
                    ),
                    _COMPLETED_STATUS,
                    ex=_ttl_seconds(completed_ttl_seconds),
                )
                return
            except Exception as exc:  # noqa: BLE001
                logger.warning('Socket idempotency Redis complete failed: %s', exc)
    now_ts = _now()
    with _LOCK:
        _ENTRIES[key] = (now_ts + float(completed_ttl_seconds), _COMPLETED_STATUS)


def release_request(reservation: Reservation | None) -> None:
    if reservation is None:
        return
    key = (reservation.user_id, reservation.event_name, reservation.request_id)
    if reservation.backend == 'redis':
        redis_client = _get_redis_client()
        if redis_client is not None:
            try:
                redis_client.delete(
                    _redis_key(
                        user_id=reservation.user_id,
                        event_name=reservation.event_name,
                        request_id=reservation.request_id,
                    )
                )
                return
            except Exception as exc:  # noqa: BLE001
                logger.warning('Socket idempotency Redis release failed: %s', exc)
    with _LOCK:
        _ENTRIES.pop(key, None)
