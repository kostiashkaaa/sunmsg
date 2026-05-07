from __future__ import annotations

import json
import threading
import time

from app.database import get_db_connection

_LINK_PREVIEW_STORE_TABLE_READY = False
_LINK_PREVIEW_STORE_TABLE_LOCK = threading.Lock()
_LINK_PREVIEW_STORE_MAX_PAYLOAD_CHARS = 65_535


def _ensure_link_preview_store_table() -> bool:
    global _LINK_PREVIEW_STORE_TABLE_READY

    if _LINK_PREVIEW_STORE_TABLE_READY:
        return True

    with _LINK_PREVIEW_STORE_TABLE_LOCK:
        if _LINK_PREVIEW_STORE_TABLE_READY:
            return True

        conn = None
        try:
            conn = get_db_connection()
            conn.execute(
                '''
                CREATE TABLE IF NOT EXISTS link_preview_cache (
                    normalized_url TEXT PRIMARY KEY,
                    schema_version INTEGER NOT NULL,
                    expires_at BIGINT NOT NULL,
                    has_meta INTEGER NOT NULL DEFAULT 0,
                    payload_json TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                '''
            )
            conn.execute(
                'CREATE INDEX IF NOT EXISTS idx_link_preview_cache_expires_at ON link_preview_cache(expires_at)'
            )
            conn.execute(
                'CREATE INDEX IF NOT EXISTS idx_link_preview_cache_updated_at ON link_preview_cache(updated_at DESC)'
            )
            conn.commit()
            _LINK_PREVIEW_STORE_TABLE_READY = True
            return True
        except Exception:
            return False
        finally:
            if conn is not None:
                conn.close()


def load_persisted_link_preview(normalized_url: str, *, schema_version: int) -> dict | None:
    safe_url = str(normalized_url or '').strip()
    if not safe_url:
        return None
    if not _ensure_link_preview_store_table():
        return None

    now = int(time.time())
    conn = None
    try:
        conn = get_db_connection()
        row = conn.execute(
            '''
            SELECT payload_json, expires_at
            FROM link_preview_cache
            WHERE normalized_url = ? AND schema_version = ?
            LIMIT 1
            ''',
            (safe_url, int(schema_version)),
        ).fetchone()
        if not row:
            return None

        expires_at = int(row['expires_at'] or 0)
        if expires_at <= now:
            conn.execute(
                'DELETE FROM link_preview_cache WHERE normalized_url = ?',
                (safe_url,),
            )
            conn.commit()
            return None

        raw_payload = str(row['payload_json'] or '')
        if not raw_payload:
            return None
        parsed = json.loads(raw_payload)
        if isinstance(parsed, dict):
            return parsed
        return None
    except Exception:
        return None
    finally:
        if conn is not None:
            conn.close()


def persist_link_preview_payload(
    normalized_url: str,
    payload: dict,
    *,
    schema_version: int,
    ttl_seconds: int,
) -> None:
    safe_url = str(normalized_url or '').strip()
    if not safe_url:
        return
    if not isinstance(payload, dict):
        return
    if not _ensure_link_preview_store_table():
        return

    expires_at = int(time.time()) + max(1, int(ttl_seconds or 1))
    payload_json = json.dumps(payload, ensure_ascii=False, separators=(',', ':'))
    if len(payload_json) > _LINK_PREVIEW_STORE_MAX_PAYLOAD_CHARS:
        return

    conn = None
    try:
        conn = get_db_connection()
        conn.execute(
            '''
            INSERT INTO link_preview_cache (
                normalized_url,
                schema_version,
                expires_at,
                has_meta,
                payload_json,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(normalized_url) DO UPDATE SET
                schema_version = excluded.schema_version,
                expires_at = excluded.expires_at,
                has_meta = excluded.has_meta,
                payload_json = excluded.payload_json,
                updated_at = CURRENT_TIMESTAMP
            ''',
            (
                safe_url,
                int(schema_version),
                expires_at,
                int(bool(payload.get('has_meta'))),
                payload_json,
            ),
        )
        conn.execute(
            'DELETE FROM link_preview_cache WHERE expires_at <= ?',
            (int(time.time()),),
        )
        conn.commit()
    except Exception:
        return
    finally:
        if conn is not None:
            conn.close()
