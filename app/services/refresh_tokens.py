"""Refresh-token issuance, rotation and revocation.

A refresh token is a 256-bit random string. The server stores only its SHA-256
hash. Tokens are grouped into a "family" — when a token is rotated, the old row
is marked revoked and a new row is inserted with the same family_id. If a token
that has already been revoked is presented again, the entire family is revoked
(detected reuse — possible theft).
"""

import hashlib
import logging
import secrets
import time
from typing import Any, Optional

from flask import request

from app.db_backend import DatabaseError
from app.database import get_db_connection
from app.services.session_policy import (
    SESSION_AUTO_LOGOUT_DEFAULT_SECONDS,
    normalize_session_auto_logout_seconds,
    session_auto_logout_seconds_from_row,
)

logger = logging.getLogger(__name__)

REFRESH_TOKEN_TTL_SECONDS = SESSION_AUTO_LOGOUT_DEFAULT_SECONDS
SESSION_TOKEN_TTL_SECONDS = 24 * 60 * 60       # 24 hours — lower bound for legacy session labels
REFRESH_COOKIE_NAME = 'refresh_token'
REFRESH_COOKIE_PATH = '/'


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode('utf-8')).hexdigest()


def _client_meta() -> tuple[str, str]:
    ua = (request.headers.get('User-Agent') or '')[:255]
    candidates = (
        request.headers.get('CF-Connecting-IP'),
        request.headers.get('True-Client-IP'),
        request.headers.get('X-Real-IP'),
        (request.headers.get('X-Forwarded-For') or '').split(',')[0],
        request.remote_addr,
    )
    ip = ''
    for value in candidates:
        current = str(value or '').strip()
        if current:
            ip = current[:64]
            break
    return ua, ip


def issue_refresh_token(
    user_id: int,
    *,
    family_id: Optional[str] = None,
    ttl_seconds: Optional[int] = None,
) -> tuple[str, int]:
    """Insert a new refresh token row. Returns (raw_token, expires_at_ts)."""
    raw = secrets.token_urlsafe(48)
    now = int(time.time())
    exp = now + normalize_session_auto_logout_seconds(ttl_seconds)
    fam = family_id or secrets.token_hex(16)
    ua, ip = _client_meta()
    conn = get_db_connection()
    try:
        conn.execute(
            '''INSERT INTO refresh_tokens
               (user_id, token_hash, family_id, expires_at, created_at, last_used_at, user_agent, ip)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
            (user_id, _hash(raw), fam, exp, now, now, ua, ip),
        )
        conn.commit()
    finally:
        conn.close()
    return raw, exp


def _revoke_family(conn: Any, family_id: str) -> None:
    now = int(time.time())
    conn.execute(
        'UPDATE refresh_tokens SET revoked_at = ? WHERE family_id = ? AND revoked_at IS NULL',
        (now, family_id),
    )


def rotate_refresh_token(raw_token: str) -> Optional[tuple[int, str, int]]:
    """Validate + rotate. Returns (user_id, new_raw_token, new_exp) or None on failure.

    On reuse of an already-revoked token, the entire family is revoked.
    """
    if not raw_token or not isinstance(raw_token, str):
        return None
    token_hash = _hash(raw_token)
    now = int(time.time())
    conn = get_db_connection()
    try:
        # Keep rotation atomic under concurrent refresh calls.
        conn.execute('BEGIN')
        row = conn.execute(
            '''
            SELECT
                rt.id,
                rt.user_id,
                rt.family_id,
                rt.expires_at,
                rt.revoked_at,
                u.session_auto_logout_seconds
            FROM refresh_tokens rt
            JOIN users u ON u.id = rt.user_id
            WHERE rt.token_hash = ?
            ''',
            (token_hash,),
        ).fetchone()
        if not row:
            conn.rollback()
            return None
        if row['expires_at'] <= now:
            conn.rollback()
            return None
        if row['revoked_at'] is not None:
            # Reuse detected - revoke the whole family.
            logger.warning('refresh token reuse detected user_id=%s family=%s', row['user_id'], row['family_id'])
            _revoke_family(conn, row['family_id'])
            conn.commit()
            return None

        # Mark current as revoked, then issue a new one in the same family.
        cur = conn.execute(
            'UPDATE refresh_tokens SET revoked_at = ?, last_used_at = ? WHERE id = ? AND revoked_at IS NULL',
            (now, now, row['id']),
        )
        if int(cur.rowcount or 0) != 1:
            logger.warning(
                'refresh token concurrent rotate conflict user_id=%s family=%s',
                row['user_id'],
                row['family_id'],
            )
            _revoke_family(conn, row['family_id'])
            conn.commit()
            return None

        new_raw = secrets.token_urlsafe(48)
        ttl_seconds = session_auto_logout_seconds_from_row(row)
        new_exp = now + ttl_seconds
        ua, ip = _client_meta()
        conn.execute(
            '''INSERT INTO refresh_tokens
               (user_id, token_hash, family_id, expires_at, created_at, last_used_at, user_agent, ip)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)''',
            (row['user_id'], _hash(new_raw), row['family_id'], new_exp, now, now, ua, ip),
        )
        conn.commit()
        return row['user_id'], new_raw, new_exp
    except DatabaseError:
        logger.exception('rotate_refresh_token DB error')
        return None
    finally:
        conn.close()


def revoke_refresh_token(raw_token: str) -> bool:
    if not raw_token or not isinstance(raw_token, str):
        return False
    now = int(time.time())
    conn = get_db_connection()
    try:
        cur = conn.execute(
            'UPDATE refresh_tokens SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL',
            (now, _hash(raw_token)),
        )
        conn.commit()
        return cur.rowcount > 0
    except DatabaseError:
        logger.exception('revoke_refresh_token DB error')
        return False
    finally:
        conn.close()


def touch_refresh_token(raw_token: str, user_id: int, *, ttl_seconds: Optional[int] = None) -> bool:
    if not raw_token or not isinstance(raw_token, str):
        return False
    now = int(time.time())
    exp = now + normalize_session_auto_logout_seconds(ttl_seconds)
    conn = get_db_connection()
    try:
        cur = conn.execute(
            '''
            UPDATE refresh_tokens
            SET expires_at = ?, last_used_at = ?
            WHERE token_hash = ?
              AND user_id = ?
              AND revoked_at IS NULL
              AND expires_at > ?
            ''',
            (exp, now, _hash(raw_token), int(user_id), now),
        )
        conn.commit()
        return int(cur.rowcount or 0) == 1
    except DatabaseError:
        logger.exception('touch_refresh_token DB error')
        return False
    finally:
        conn.close()


def revoke_all_for_user(user_id: int) -> int:
    now = int(time.time())
    conn = get_db_connection()
    try:
        cur = conn.execute(
            'UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
            (now, user_id),
        )
        conn.commit()
        return cur.rowcount
    except DatabaseError:
        logger.exception('revoke_all_for_user DB error')
        return 0
    finally:
        conn.close()


def cleanup_expired() -> int:
    cutoff = int(time.time()) - 24 * 60 * 60  # keep 1 extra day for forensics
    conn = get_db_connection()
    try:
        cur = conn.execute('DELETE FROM refresh_tokens WHERE expires_at < ?', (cutoff,))
        conn.commit()
        return cur.rowcount
    except DatabaseError:
        logger.exception('cleanup_expired refresh tokens failed')
        return 0
    finally:
        conn.close()


def refresh_cookie_max_age_from_expiry(expires_at: int, *, now: Optional[int] = None) -> int:
    current = int(time.time()) if now is None else int(now)
    try:
        return max(1, int(expires_at) - current)
    except (TypeError, ValueError):
        return REFRESH_TOKEN_TTL_SECONDS


def set_refresh_cookie(
    response,
    raw_token: str,
    *,
    secure: bool,
    max_age_seconds: Optional[int] = None,
) -> None:
    try:
        max_age = int(max_age_seconds) if max_age_seconds is not None else REFRESH_TOKEN_TTL_SECONDS
    except (TypeError, ValueError):
        max_age = REFRESH_TOKEN_TTL_SECONDS
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        raw_token,
        max_age=max(1, max_age),
        httponly=True,
        secure=secure,
        samesite='Lax',
        path=REFRESH_COOKIE_PATH,
    )


def clear_refresh_cookie(response, *, secure: bool = False) -> None:
    response.set_cookie(
        REFRESH_COOKIE_NAME,
        '',
        max_age=0,
        expires=0,
        httponly=True,
        secure=secure,
        samesite='Lax',
        path=REFRESH_COOKIE_PATH,
    )
