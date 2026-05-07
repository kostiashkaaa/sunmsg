from __future__ import annotations

import threading
import time
from dataclasses import dataclass


@dataclass(frozen=True)
class Reservation:
    user_id: int
    event_name: str
    request_id: str


_LOCK = threading.Lock()
_ENTRIES: dict[tuple[int, str, str], tuple[float, str]] = {}
_MAX_ENTRIES = 50_000
_PENDING_STATUS = 'pending'
_COMPLETED_STATUS = 'completed'


def _now() -> float:
    return time.monotonic()


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
    now_ts = _now()
    with _LOCK:
        _ENTRIES[key] = (now_ts + float(completed_ttl_seconds), _COMPLETED_STATUS)


def release_request(reservation: Reservation | None) -> None:
    if reservation is None:
        return
    key = (reservation.user_id, reservation.event_name, reservation.request_id)
    with _LOCK:
        _ENTRIES.pop(key, None)
