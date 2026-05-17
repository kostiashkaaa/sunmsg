"""Session lifetime policy shared by auth routes and refresh-token storage."""

from __future__ import annotations

import time
from typing import Any

DAY_SECONDS = 24 * 60 * 60
SESSION_AUTO_LOGOUT_WEEK_SECONDS = 7 * DAY_SECONDS
SESSION_AUTO_LOGOUT_MONTH_SECONDS = 30 * DAY_SECONDS
SESSION_AUTO_LOGOUT_THREE_MONTHS_SECONDS = 90 * DAY_SECONDS
SESSION_AUTO_LOGOUT_SIX_MONTHS_SECONDS = 180 * DAY_SECONDS

SESSION_AUTO_LOGOUT_DEFAULT_SECONDS = SESSION_AUTO_LOGOUT_MONTH_SECONDS
SESSION_AUTO_LOGOUT_ALLOWED_SECONDS = (
    SESSION_AUTO_LOGOUT_WEEK_SECONDS,
    SESSION_AUTO_LOGOUT_MONTH_SECONDS,
    SESSION_AUTO_LOGOUT_THREE_MONTHS_SECONDS,
    SESSION_AUTO_LOGOUT_SIX_MONTHS_SECONDS,
)

_OPTION_LABELS = {
    SESSION_AUTO_LOGOUT_WEEK_SECONDS: ('1 неделя', '1 week'),
    SESSION_AUTO_LOGOUT_MONTH_SECONDS: ('1 месяц', '1 month'),
    SESSION_AUTO_LOGOUT_THREE_MONTHS_SECONDS: ('3 месяца', '3 months'),
    SESSION_AUTO_LOGOUT_SIX_MONTHS_SECONDS: ('6 месяцев', '6 months'),
}


def parse_session_auto_logout_seconds(value: Any) -> int | None:
    try:
        seconds = int(value)
    except (TypeError, ValueError):
        return None
    if seconds not in SESSION_AUTO_LOGOUT_ALLOWED_SECONDS:
        return None
    return seconds


def normalize_session_auto_logout_seconds(value: Any) -> int:
    return parse_session_auto_logout_seconds(value) or SESSION_AUTO_LOGOUT_DEFAULT_SECONDS


def session_auto_logout_seconds_from_row(row: Any) -> int:
    if not row:
        return SESSION_AUTO_LOGOUT_DEFAULT_SECONDS
    try:
        return normalize_session_auto_logout_seconds(row['session_auto_logout_seconds'])
    except (KeyError, TypeError, IndexError):
        return SESSION_AUTO_LOGOUT_DEFAULT_SECONDS


def session_auto_logout_options() -> list[dict[str, Any]]:
    return [
        {
            'seconds': seconds,
            'label_ru': _OPTION_LABELS[seconds][0],
            'label_en': _OPTION_LABELS[seconds][1],
        }
        for seconds in SESSION_AUTO_LOGOUT_ALLOWED_SECONDS
    ]


def apply_session_auto_logout(session_store: Any, ttl_seconds: Any, *, now: int | None = None) -> int:
    ttl = normalize_session_auto_logout_seconds(ttl_seconds)
    current = int(time.time()) if now is None else int(now)
    session_store.permanent = True
    session_store['session_auto_logout_seconds'] = ttl
    session_store['session_expires_at'] = current + ttl
    session_store['session_last_activity_touch_at'] = current
    return ttl


def session_auto_logout_payload(session_store: Any) -> dict[str, int]:
    ttl = normalize_session_auto_logout_seconds(session_store.get('session_auto_logout_seconds'))
    try:
        expires_at = int(session_store.get('session_expires_at') or 0)
    except (TypeError, ValueError):
        expires_at = 0
    return {
        'session_auto_logout_seconds': ttl,
        'session_expires_at': expires_at,
    }
