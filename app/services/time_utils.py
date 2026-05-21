from __future__ import annotations

from datetime import datetime, timezone


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def to_db_timestamp(value: datetime) -> str:
    return value.astimezone(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
