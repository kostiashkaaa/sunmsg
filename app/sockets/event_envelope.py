from __future__ import annotations

import json
import time
import uuid
from datetime import datetime, timezone
from typing import Any


ENVELOPE_VERSION = 1
_MAX_DIFF_LIMIT = 500
_DEFAULT_DIFF_LIMIT = 100
_NON_PERSISTED_CHAT_EVENTS = {
    'error',
    'partner_typing',
    'partner_stop_typing',
    'user_status',
    'force_leave_chat',
    # Calls: transient WebRTC negotiation events
    'call_incoming',
    'call_accepted',
    'call_rejected',
    'call_cancelled',
    'call_ended',
    'call_error',
    'call_media_state',
    'call_offer',
    'call_answer',
    'call_ice_candidate',
}
_INTERNAL_EMIT_CACHE_KEY = '__sun_emit_cache__'
_EMIT_CACHE_REUSE_WINDOW_SECONDS = 5.0


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')


def _normalize_chat_id(value: Any) -> str | None:
    if value is None:
        return None
    chat_id = str(value).strip()
    return chat_id or None


def _normalize_request_id(value: Any) -> str | None:
    if value is None:
        return None
    request_id = str(value).strip()
    return request_id or None


def _extract_chat_id(payload: Any, *, explicit_chat_id: str | None = None) -> str | None:
    if explicit_chat_id:
        return explicit_chat_id
    if isinstance(payload, dict):
        return _normalize_chat_id(payload.get('chat_id'))
    return None


def _extract_request_id(payload: Any, *, explicit_request_id: str | None = None) -> str | None:
    if explicit_request_id:
        return explicit_request_id
    if isinstance(payload, dict):
        return _normalize_request_id(payload.get('request_id'))
    return None


def _next_chat_pts(conn, chat_id: str) -> int:
    conn.execute(
        '''
        INSERT INTO chat_event_state (chat_id, last_pts, updated_at)
        VALUES (?, 1, CURRENT_TIMESTAMP)
        ON CONFLICT(chat_id) DO UPDATE SET
            last_pts = chat_event_state.last_pts + 1,
            updated_at = CURRENT_TIMESTAMP
        ''',
        (chat_id,),
    )
    row = conn.execute(
        '''
        SELECT last_pts
        FROM chat_event_state
        WHERE chat_id = ?
        ''',
        (chat_id,),
    ).fetchone()
    return int(row['last_pts']) if row and row['last_pts'] is not None else 1


def _serialize_payload(payload: Any) -> str:
    return json.dumps(payload, ensure_ascii=False, separators=(',', ':'))


def _deserialize_payload(payload_json: str | None) -> Any:
    if not payload_json:
        return {}
    try:
        return json.loads(payload_json)
    except Exception:  # noqa: BLE001
        return {}


def _public_payload(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    return {
        key: value
        for key, value in payload.items()
        if key != _INTERNAL_EMIT_CACHE_KEY
    }


def _extract_cached_emit_meta_dict(payload: Any, event_type: str) -> dict[str, Any] | None:
    if not isinstance(payload, dict):
        return None
    cache = payload.get(_INTERNAL_EMIT_CACHE_KEY)
    if not isinstance(cache, dict):
        return None
    meta = cache.get(event_type)
    if not isinstance(meta, dict):
        return None
    return meta


def _is_cached_meta_fresh(meta: dict[str, Any]) -> bool:
    created_monotonic = meta.get('created_monotonic')
    if not isinstance(created_monotonic, (int, float)):
        return False
    return (time.monotonic() - float(created_monotonic)) <= _EMIT_CACHE_REUSE_WINDOW_SECONDS


def _normalize_cached_chat_pts(raw_value: Any) -> int | None:
    if raw_value is None:
        return None
    try:
        chat_pts = int(raw_value)
    except Exception:  # noqa: BLE001
        return None
    return chat_pts if chat_pts > 0 else None


def _get_cached_emit_meta(payload: Any, *, event_type: str, chat_id: str | None = None) -> dict[str, Any] | None:
    meta = _extract_cached_emit_meta_dict(payload, event_type)
    if not meta:
        return None
    if not _is_cached_meta_fresh(meta):
        return None

    event_id = str(meta.get('event_id') or '').strip()
    server_ts = str(meta.get('server_ts') or '').strip()
    if not event_id or not server_ts:
        return None

    cached_chat_id = _normalize_chat_id(meta.get('chat_id'))
    normalized_chat_id = _normalize_chat_id(chat_id)
    if normalized_chat_id and cached_chat_id and normalized_chat_id != cached_chat_id:
        return None

    cached_request_id = _normalize_request_id(meta.get('request_id'))
    cached_chat_pts_raw = meta.get('chat_pts')
    cached_chat_pts = _normalize_cached_chat_pts(cached_chat_pts_raw)
    if cached_chat_pts_raw is not None and cached_chat_pts is None:
            return None

    return {
        'event_id': event_id,
        'server_ts': server_ts,
        'chat_id': cached_chat_id,
        'chat_pts': cached_chat_pts,
        'request_id': cached_request_id,
    }


def _store_cached_emit_meta(  # noqa: PLR0913 - envelope metadata shape is explicit by design
    payload: Any,
    *,
    event_type: str,
    event_id: str,
    server_ts: str,
    chat_id: str | None,
    chat_pts: int | None,
    request_id: str | None,
) -> None:
    if not isinstance(payload, dict):
        return

    cache = payload.get(_INTERNAL_EMIT_CACHE_KEY)
    if not isinstance(cache, dict):
        cache = {}
        payload[_INTERNAL_EMIT_CACHE_KEY] = cache

    cache[event_type] = {
        'event_id': str(event_id or '').strip(),
        'server_ts': str(server_ts or '').strip(),
        'chat_id': _normalize_chat_id(chat_id),
        'chat_pts': int(chat_pts) if chat_pts is not None else None,
        'request_id': _normalize_request_id(request_id),
        'created_monotonic': time.monotonic(),
    }


def _insert_chat_update_event(  # noqa: PLR0913 - envelope persistence contract
    conn,
    *,
    event_id: str,
    event_type: str,
    server_ts: str,
    chat_id: str,
    chat_pts: int,
    request_id: str | None,
    payload: Any,
) -> None:
    conn.execute(
        '''
        INSERT INTO chat_update_events (
            event_id,
            event_type,
            server_ts,
            chat_id,
            chat_pts,
            request_id,
            payload_json
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id) DO NOTHING
        ''',
        (
            event_id,
            event_type,
            server_ts,
            chat_id,
            int(chat_pts),
            request_id,
            _serialize_payload(payload),
        ),
    )


def build_enveloped_event_payload(  # noqa: PLR0913 - envelope builder API
    *,
    event_type: str,
    payload: Any,
    event_id: str | None = None,
    chat_id: str | None = None,
    chat_pts: int | None = None,
    request_id: str | None = None,
    server_ts: str | None = None,
) -> dict[str, Any]:
    event_name = str(event_type or '').strip()
    now_iso = server_ts or _utc_now_iso()
    resolved_event_id = str(event_id or uuid.uuid4())
    resolved_chat_id = _normalize_chat_id(chat_id) or _extract_chat_id(payload)
    resolved_request_id = _normalize_request_id(request_id) or _extract_request_id(payload)
    payload_object = payload if isinstance(payload, dict) else {'value': payload}

    envelope = {
        'v': ENVELOPE_VERSION,
        'event_id': resolved_event_id,
        'event_type': event_name,
        'server_ts': now_iso,
        'chat_id': resolved_chat_id,
        'chat_pts': int(chat_pts) if chat_pts is not None else None,
        'request_id': resolved_request_id,
    }

    wrapped_payload = dict(payload_object)
    wrapped_payload['envelope'] = envelope
    wrapped_payload['payload'] = payload_object
    wrapped_payload['event_id'] = resolved_event_id
    wrapped_payload['event_type'] = event_name
    wrapped_payload['server_ts'] = now_iso
    if resolved_chat_id:
        wrapped_payload['chat_id'] = resolved_chat_id
    if chat_pts is not None:
        wrapped_payload['chat_pts'] = int(chat_pts)
    if resolved_request_id:
        wrapped_payload['request_id'] = resolved_request_id
    return wrapped_payload


def emit_enveloped_socket_event(  # noqa: PLR0913 - injected socket emit contract
    *,
    raw_emit_func,
    get_db_connection_func,
    logger,
    event_type: str,
    payload: Any = None,
    chat_id: str | None = None,
    request_id: str | None = None,
    args: tuple[Any, ...] = (),
    kwargs: dict[str, Any] | None = None,
) -> Any:
    safe_kwargs = dict(kwargs or {})
    payload_object = payload if payload is not None else {}
    payload_for_emit = _public_payload(payload_object)
    normalized_event_name = str(event_type or '').strip()
    normalized_chat_id = _extract_chat_id(payload_for_emit, explicit_chat_id=_normalize_chat_id(chat_id))
    normalized_request_id = _extract_request_id(payload_for_emit, explicit_request_id=_normalize_request_id(request_id))
    cached_meta = _get_cached_emit_meta(
        payload_object,
        event_type=normalized_event_name,
        chat_id=normalized_chat_id,
    )
    if cached_meta:
        normalized_chat_id = normalized_chat_id or cached_meta['chat_id']
        normalized_request_id = normalized_request_id or cached_meta['request_id']
        event_id = cached_meta['event_id']
        server_ts = cached_meta['server_ts']
        chat_pts = cached_meta['chat_pts']
    else:
        event_id = str(uuid.uuid4())
        server_ts = _utc_now_iso()
        chat_pts = None

    should_persist = (
        cached_meta is None
        and normalized_chat_id
        and normalized_event_name not in _NON_PERSISTED_CHAT_EVENTS
    )
    if should_persist:
        conn = None
        try:
            conn = get_db_connection_func()
            chat_pts = _next_chat_pts(conn, normalized_chat_id)
            _insert_chat_update_event(
                conn,
                event_id=event_id,
                event_type=normalized_event_name,
                server_ts=server_ts,
                chat_id=normalized_chat_id,
                chat_pts=chat_pts,
                request_id=normalized_request_id,
                payload=payload_for_emit,
            )
            conn.commit()
        except Exception as exc:  # noqa: BLE001
            if logger:
                logger.warning(
                    'Socket envelope persistence failed event=%s chat_id=%s: %s',
                    event_type,
                    normalized_chat_id,
                    exc,
                )
            if conn is not None:
                try:
                    conn.rollback()
                except Exception:  # noqa: BLE001
                    pass
        finally:
            if conn is not None:
                try:
                    conn.close()
                except Exception:  # noqa: BLE001
                    pass

    if not cached_meta:
        _store_cached_emit_meta(
            payload_object,
            event_type=normalized_event_name,
            event_id=event_id,
            server_ts=server_ts,
            chat_id=normalized_chat_id,
            chat_pts=chat_pts,
            request_id=normalized_request_id,
        )

    wrapped_payload = build_enveloped_event_payload(
        event_type=normalized_event_name,
        payload=payload_for_emit,
        event_id=event_id,
        chat_id=normalized_chat_id,
        chat_pts=chat_pts,
        request_id=normalized_request_id,
        server_ts=server_ts,
    )
    return raw_emit_func(str(event_type or '').strip(), wrapped_payload, *args, **safe_kwargs)


def get_chat_update_state(conn, *, chat_id: str) -> dict[str, Any]:
    normalized_chat_id = _normalize_chat_id(chat_id)
    if not normalized_chat_id:
        return {'chat_id': '', 'chat_pts': 0}
    row = conn.execute(
        '''
        SELECT last_pts
        FROM chat_event_state
        WHERE chat_id = ?
        ''',
        (normalized_chat_id,),
    ).fetchone()
    last_pts = int(row['last_pts']) if row and row['last_pts'] is not None else 0
    return {'chat_id': normalized_chat_id, 'chat_pts': last_pts}


def get_chat_update_difference(
    conn,
    *,
    chat_id: str,
    from_pts: int,
    limit: int = _DEFAULT_DIFF_LIMIT,
) -> dict[str, Any]:
    normalized_chat_id = _normalize_chat_id(chat_id)
    safe_from_pts = max(0, int(from_pts or 0))
    safe_limit = max(1, min(int(limit or _DEFAULT_DIFF_LIMIT), _MAX_DIFF_LIMIT))
    state = get_chat_update_state(conn, chat_id=normalized_chat_id or '')
    if not normalized_chat_id:
        return {
            'chat_id': '',
            'from_pts': safe_from_pts,
            'chat_pts': state['chat_pts'],
            'events': [],
            'has_more': False,
            'next_from_pts': safe_from_pts,
        }

    rows = conn.execute(
        '''
        SELECT event_id, event_type, server_ts, chat_id, chat_pts, request_id, payload_json
        FROM chat_update_events
        WHERE chat_id = ? AND chat_pts > ?
        ORDER BY chat_pts ASC
        LIMIT ?
        ''',
        (normalized_chat_id, safe_from_pts, safe_limit + 1),
    ).fetchall()

    has_more = len(rows) > safe_limit
    used_rows = rows[:safe_limit]
    events = []
    next_from_pts = safe_from_pts
    for row in used_rows:
        row_payload = _deserialize_payload(row['payload_json'])
        wrapped = build_enveloped_event_payload(
            event_type=str(row['event_type'] or ''),
            payload=row_payload,
            event_id=str(row['event_id'] or ''),
            chat_id=str(row['chat_id'] or ''),
            chat_pts=int(row['chat_pts'] or 0),
            request_id=row['request_id'],
            server_ts=str(row['server_ts'] or ''),
        )
        events.append(wrapped)
        next_from_pts = int(row['chat_pts'] or next_from_pts)

    return {
        'chat_id': normalized_chat_id,
        'from_pts': safe_from_pts,
        'chat_pts': state['chat_pts'],
        'events': events,
        'has_more': has_more,
        'next_from_pts': next_from_pts,
    }
