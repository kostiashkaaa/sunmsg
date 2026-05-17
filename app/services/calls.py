from __future__ import annotations

import uuid
from datetime import datetime, timezone


_CALL_STATUSES = {'ringing', 'active', 'ended', 'rejected', 'cancelled', 'missed', 'failed'}
_CALL_TYPES = {'audio', 'video'}
_CALL_RING_TIMEOUT_SECONDS = 60


def generate_call_id() -> str:
    return str(uuid.uuid4())


def create_call_session(conn, *, call_id: str, chat_id: str, initiator_id: int, call_type: str) -> None:
    conn.execute(
        '''
        INSERT INTO call_sessions (call_id, chat_id, initiator_id, call_type, status, started_at)
        VALUES (?, ?, ?, ?, 'ringing', CURRENT_TIMESTAMP)
        ''',
        (call_id, chat_id, initiator_id, call_type),
    )
    conn.execute(
        '''
        INSERT INTO call_participants (call_id, user_id, joined_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ''',
        (call_id, initiator_id),
    )
    conn.commit()


def get_call_session(conn, call_id: str) -> dict | None:
    row = conn.execute(
        'SELECT * FROM call_sessions WHERE call_id = ?',
        (call_id,),
    ).fetchone()
    if row is None:
        return None
    return dict(row)


def get_active_call_in_chat(conn, chat_id: str) -> dict | None:
    row = conn.execute(
        '''
        SELECT * FROM call_sessions
        WHERE chat_id = ? AND status IN ('ringing', 'active')
        ORDER BY started_at DESC
        LIMIT 1
        ''',
        (chat_id,),
    ).fetchone()
    if row is None:
        return None
    return dict(row)


def get_user_active_call(conn, user_id: int) -> dict | None:
    row = conn.execute(
        '''
        SELECT cs.*
        FROM call_sessions cs
        JOIN call_participants cp ON cs.call_id = cp.call_id
        WHERE cp.user_id = ?
          AND cs.status IN ('ringing', 'active')
          AND cp.left_at IS NULL
        ORDER BY cs.started_at DESC
        LIMIT 1
        ''',
        (user_id,),
    ).fetchone()
    if row is None:
        return None
    return dict(row)


def accept_call(conn, call_id: str, user_id: int) -> None:
    conn.execute(
        '''
        UPDATE call_sessions
        SET status = 'active', accepted_at = CURRENT_TIMESTAMP
        WHERE call_id = ? AND status = 'ringing'
        ''',
        (call_id,),
    )
    conn.execute(
        '''
        INSERT INTO call_participants (call_id, user_id, joined_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(call_id, user_id) DO UPDATE SET joined_at = CURRENT_TIMESTAMP, left_at = NULL
        ''',
        (call_id, user_id),
    )
    conn.commit()


def end_call(conn, call_id: str, user_id: int, *, final_status: str = 'ended') -> None:
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    conn.execute(
        '''
        UPDATE call_participants
        SET left_at = ?
        WHERE call_id = ? AND user_id = ? AND left_at IS NULL
        ''',
        (now, call_id, user_id),
    )
    row = conn.execute(
        '''
        SELECT cs.started_at, cs.accepted_at, cs.status
        FROM call_sessions cs
        WHERE cs.call_id = ?
        ''',
        (call_id,),
    ).fetchone()
    if row is None:
        conn.commit()
        return

    duration_sec = None
    if row['accepted_at']:
        try:
            fmt = '%Y-%m-%d %H:%M:%S'
            accepted = datetime.strptime(str(row['accepted_at']), fmt).replace(tzinfo=timezone.utc)
            ended = datetime.now(timezone.utc)
            duration_sec = max(0, int((ended - accepted).total_seconds()))
        except Exception:
            pass

    conn.execute(
        '''
        UPDATE call_sessions
        SET status = ?, ended_at = ?, duration_sec = ?
        WHERE call_id = ? AND status NOT IN ('ended', 'rejected', 'cancelled', 'missed', 'failed')
        ''',
        (final_status, now, duration_sec, call_id),
    )
    conn.commit()


def reject_call(conn, call_id: str) -> None:
    conn.execute(
        '''
        UPDATE call_sessions
        SET status = 'rejected', ended_at = CURRENT_TIMESTAMP
        WHERE call_id = ? AND status = 'ringing'
        ''',
        (call_id,),
    )
    conn.commit()


def cancel_call(conn, call_id: str) -> None:
    conn.execute(
        '''
        UPDATE call_sessions
        SET status = 'cancelled', ended_at = CURRENT_TIMESTAMP
        WHERE call_id = ? AND status = 'ringing'
        ''',
        (call_id,),
    )
    conn.commit()


def mark_missed_calls(conn, chat_id: str) -> list[str]:
    """Mark ringing calls older than timeout as missed. Returns list of affected call_ids."""
    rows = conn.execute(
        '''
        SELECT call_id FROM call_sessions
        WHERE chat_id = ?
          AND status = 'ringing'
          AND started_at < CURRENT_TIMESTAMP - INTERVAL '? seconds'
        ''',
        (chat_id, _CALL_RING_TIMEOUT_SECONDS),
    ).fetchall()
    call_ids = [str(r['call_id']) for r in rows]
    for call_id in call_ids:
        conn.execute(
            '''
            UPDATE call_sessions
            SET status = 'missed', ended_at = CURRENT_TIMESTAMP
            WHERE call_id = ?
            ''',
            (call_id,),
        )
    if call_ids:
        conn.commit()
    return call_ids


def get_call_history(conn, chat_id: str, *, limit: int = 50, offset: int = 0) -> list[dict]:
    rows = conn.execute(
        '''
        SELECT cs.call_id, cs.initiator_id, cs.call_type, cs.status,
               cs.started_at, cs.ended_at, cs.duration_sec,
               u.display_name AS initiator_name, u.username AS initiator_username,
               u.avatar_url AS initiator_avatar
        FROM call_sessions cs
        JOIN users u ON cs.initiator_id = u.id
        WHERE cs.chat_id = ?
        ORDER BY cs.started_at DESC
        LIMIT ? OFFSET ?
        ''',
        (chat_id, limit, offset),
    ).fetchall()
    return [dict(r) for r in rows]

