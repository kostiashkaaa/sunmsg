from __future__ import annotations

import json
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
}


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


def _insert_chat_update_event(
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


def build_enveloped_event_payload(
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


def emit_enveloped_socket_event(
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
    normalized_event_name = str(event_type or '').strip()
    normalized_chat_id = _extract_chat_id(payload_object, explicit_chat_id=_normalize_chat_id(chat_id))
    normalized_request_id = _extract_request_id(payload_object, explicit_request_id=_normalize_request_id(request_id))
    event_id = str(uuid.uuid4())
    server_ts = _utc_now_iso()
    chat_pts = None

    should_persist = normalized_chat_id and normalized_event_name not in _NON_PERSISTED_CHAT_EVENTS
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
                payload=payload_object,
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

    wrapped_payload = build_enveloped_event_payload(
        event_type=normalized_event_name,
        payload=payload_object,
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
