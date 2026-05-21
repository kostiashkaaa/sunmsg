from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from app.services.time_utils import to_db_timestamp, utc_now


def parse_db_timestamp(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        parsed = value
    else:
        raw = str(value or '').strip()
        if not raw:
            return None
        try:
            parsed = datetime.fromisoformat(raw.replace('Z', '+00:00'))
        except ValueError:
            return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _safe_count(conn, query: str, params: tuple = ()) -> int:
    try:
        row = conn.execute(query, params).fetchone()
    except Exception:  # noqa: BLE001 - old test schemas may omit optional abuse tables/columns
        return 0
    if not row:
        return 0
    try:
        return int(row['cnt'] or 0)
    except Exception:  # noqa: BLE001
        try:
            return int(row[0] or 0)
        except Exception:  # noqa: BLE001
            return 0


def _user_created_at(conn, user_id: int) -> datetime | None:
    try:
        row = conn.execute(
            '''
            SELECT created_at
            FROM users
            WHERE id = ?
            LIMIT 1
            ''',
            (int(user_id),),
        ).fetchone()
    except Exception:  # noqa: BLE001 - schemas before the trust-ramp migration had no users.created_at
        return None
    if not row:
        return None
    try:
        return parse_db_timestamp(row['created_at'])
    except Exception:  # noqa: BLE001
        return None


def user_trust_profile(
    conn,
    *,
    user_id: int,
    now: datetime | None = None,
    new_account_seconds: int = 24 * 60 * 60,
    signal_window_seconds: int = 24 * 60 * 60,
    min_confirmed_contacts: int = 3,
    min_inbound_repliers: int = 2,
    max_recent_reports: int = 0,
    max_recent_blocks: int = 0,
) -> dict[str, Any]:
    checked_at = now or utc_now()
    created_at = _user_created_at(conn, int(user_id))
    if created_at is None:
        return {
            'is_limited': False,
            'account_age_seconds': None,
            'confirmed_contacts': 0,
            'inbound_repliers': 0,
            'recent_reports': 0,
            'recent_blocks': 0,
            'reason': 'created_at_unavailable',
        }

    age_seconds = max(0, int((checked_at - created_at).total_seconds()))
    since_ts = to_db_timestamp(checked_at - timedelta(seconds=max(60, int(signal_window_seconds))))
    confirmed_contacts = _safe_count(
        conn,
        '''
        SELECT COUNT(*) AS cnt
        FROM contacts
        WHERE user_id = ?
        ''',
        (int(user_id),),
    )
    inbound_repliers = _safe_count(
        conn,
        '''
        SELECT COUNT(DISTINCT sender_id) AS cnt
        FROM messages
        WHERE receiver_id = ?
          AND created_at >= ?
        ''',
        (int(user_id), since_ts),
    )
    recent_reports = _safe_count(
        conn,
        '''
        SELECT COUNT(DISTINCT reporter_user_id) AS cnt
        FROM moderation_reports
        WHERE target_type = 'user'
          AND target_id = ?
          AND created_at >= ?
        ''',
        (str(int(user_id)), since_ts),
    )
    recent_blocks = _safe_count(
        conn,
        '''
        SELECT COUNT(DISTINCT blocker_id) AS cnt
        FROM block_list
        WHERE blocked_id = ?
          AND created_at >= ?
        ''',
        (int(user_id), since_ts),
    )

    is_new = age_seconds < max(1, int(new_account_seconds))
    has_positive_signals = (
        confirmed_contacts >= max(0, int(min_confirmed_contacts))
        and inbound_repliers >= max(0, int(min_inbound_repliers))
        and recent_reports <= max(0, int(max_recent_reports))
        and recent_blocks <= max(0, int(max_recent_blocks))
    )
    is_limited = bool(is_new and not has_positive_signals)
    return {
        'is_limited': is_limited,
        'account_age_seconds': age_seconds,
        'confirmed_contacts': confirmed_contacts,
        'inbound_repliers': inbound_repliers,
        'recent_reports': recent_reports,
        'recent_blocks': recent_blocks,
        'reason': 'new_account' if is_limited else 'trusted',
    }


def trust_limited_rate_rule(
    conn,
    *,
    user_id: int,
    standard_rule: str,
    limited_rule: str,
    new_account_seconds: int,
    signal_window_seconds: int,
    min_confirmed_contacts: int,
    min_inbound_repliers: int,
) -> str:
    profile = user_trust_profile(
        conn,
        user_id=int(user_id),
        new_account_seconds=int(new_account_seconds),
        signal_window_seconds=int(signal_window_seconds),
        min_confirmed_contacts=int(min_confirmed_contacts),
        min_inbound_repliers=int(min_inbound_repliers),
    )
    return str(limited_rule if profile.get('is_limited') else standard_rule)


def has_reciprocal_contact(conn, *, sender_id: int, receiver_id: int | None) -> bool:
    if not receiver_id:
        return False
    try:
        row = conn.execute(
            '''
            SELECT 1
            FROM contacts
            WHERE user_id = ?
              AND contact_id = ?
            LIMIT 1
            ''',
            (int(receiver_id), int(sender_id)),
        ).fetchone()
    except Exception:  # noqa: BLE001
        return False
    return row is not None
