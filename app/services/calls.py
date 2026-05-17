from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone


_CALL_STATUSES = {'ringing', 'active', 'ended', 'rejected', 'cancelled', 'missed', 'failed'}
_CALL_TYPES = {'audio', 'video'}
_CALL_RING_TIMEOUT_SECONDS = 60
# An 'active' call with no participant traffic this long is considered abandoned
# (both peers closed their tab without a clean call_end). Reaped so the chat is
# not blocked forever by a phantom call_already_active.
_CALL_ACTIVE_STALE_SECONDS = 12 * 60 * 60
_CALL_LOG_FINAL_STATUSES = {'ended', 'rejected', 'cancelled', 'missed', 'failed'}


def generate_call_id() -> str:
    return str(uuid.uuid4())


def _lock_chat_for_calls(conn, chat_id: str) -> None:
    """Serialize call-session creation per chat with a transaction-scoped
    advisory lock. Released automatically on commit/rollback. Prevents two
    concurrent call_initiate requests from both creating a 'ringing' session."""
    conn.execute(
        "SELECT pg_advisory_xact_lock(hashtext('suncall:' || ?))",
        (str(chat_id),),
    )


def create_call_session_locked(
    conn, *, chat_id: str, initiator_id: int, call_type: str,
) -> str | None:
    """Atomically reap stale calls, verify no live call exists, and create a new
    'ringing' session — all under a per-chat advisory lock held until commit.

    Returns the new call_id, or None if a live call already exists in the chat.
    The caller MUST treat a non-None return as committed."""
    _lock_chat_for_calls(conn, chat_id)
    mark_missed_calls(conn, chat_id)
    _reap_stale_active_calls(conn, chat_id)
    if get_active_call_in_chat(conn, chat_id) is not None:
        conn.commit()
        return None
    call_id = generate_call_id()
    create_call_session(conn, call_id=call_id, chat_id=chat_id,
                         initiator_id=initiator_id, call_type=call_type)
    return call_id


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


def accept_call(conn, call_id: str, user_id: int) -> bool:
    updated = conn.execute(
        '''
        UPDATE call_sessions
        SET status = 'active', accepted_at = CURRENT_TIMESTAMP
        WHERE call_id = ? AND status = 'ringing'
        ''',
        (call_id,),
    )
    if updated.rowcount <= 0:
        conn.commit()
        return False
    conn.execute(
        '''
        INSERT INTO call_participants (call_id, user_id, joined_at)
        VALUES (?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(call_id, user_id) DO UPDATE SET joined_at = CURRENT_TIMESTAMP, left_at = NULL
        ''',
        (call_id, user_id),
    )
    conn.commit()
    return True


def end_call(conn, call_id: str, user_id: int, *, final_status: str = 'ended') -> bool:
    now = datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')
    participant_update = conn.execute(
        '''
        UPDATE call_participants
        SET left_at = ?
        WHERE call_id = ? AND user_id = ? AND left_at IS NULL
        ''',
        (now, call_id, user_id),
    )
    if participant_update.rowcount <= 0:
        conn.commit()
        return False

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
        return False

    duration_sec = None
    if row['accepted_at']:
        try:
            fmt = '%Y-%m-%d %H:%M:%S'
            accepted = datetime.strptime(str(row['accepted_at']), fmt).replace(tzinfo=timezone.utc)
            ended = datetime.now(timezone.utc)
            duration_sec = max(0, int((ended - accepted).total_seconds()))
        except Exception:
            pass

    updated = conn.execute(
        '''
        UPDATE call_sessions
        SET status = ?, ended_at = ?, duration_sec = ?
        WHERE call_id = ? AND status = 'active'
        ''',
        (final_status, now, duration_sec, call_id),
    )
    conn.commit()
    return updated.rowcount > 0


def reject_call(conn, call_id: str) -> bool:
    updated = conn.execute(
        '''
        UPDATE call_sessions
        SET status = 'rejected', ended_at = CURRENT_TIMESTAMP
        WHERE call_id = ? AND status = 'ringing'
        ''',
        (call_id,),
    )
    conn.commit()
    return updated.rowcount > 0


def cancel_call(conn, call_id: str) -> bool:
    updated = conn.execute(
        '''
        UPDATE call_sessions
        SET status = 'cancelled', ended_at = CURRENT_TIMESTAMP
        WHERE call_id = ? AND status = 'ringing'
        ''',
        (call_id,),
    )
    conn.commit()
    return updated.rowcount > 0


def mark_missed_calls(conn, chat_id: str | None = None) -> list[str]:
    """Mark ringing calls older than timeout as missed. Returns list of affected call_ids."""
    cutoff = (
        datetime.now(timezone.utc) - timedelta(seconds=_CALL_RING_TIMEOUT_SECONDS)
    ).strftime('%Y-%m-%d %H:%M:%S')
    if chat_id is None:
        rows = conn.execute(
            '''
            SELECT call_id FROM call_sessions
            WHERE status = 'ringing'
              AND started_at < ?
            ''',
            (cutoff,),
        ).fetchall()
    else:
        rows = conn.execute(
            '''
            SELECT call_id FROM call_sessions
            WHERE chat_id = ?
              AND status = 'ringing'
              AND started_at < ?
            ''',
            (chat_id, cutoff),
        ).fetchall()
    affected: list[str] = []
    for call_id in (str(r['call_id']) for r in rows):
        updated = conn.execute(
            '''
            UPDATE call_sessions
            SET status = 'missed', ended_at = CURRENT_TIMESTAMP
            WHERE call_id = ? AND status = 'ringing'
            ''',
            (call_id,),
        )
        # rowcount == 0: another worker (scheduler vs. handler) already
        # transitioned this call — skip the log message to avoid a UNIQUE
        # violation on idx_messages_call_id aborting the whole transaction.
        if updated.rowcount <= 0:
            continue
        affected.append(call_id)
        call = get_call_session(conn, call_id)
        if call:
            _create_call_log_message_for_call(conn, call, commit=False)
    if affected:
        conn.commit()
    return affected


def _reap_stale_active_calls(conn, chat_id: str | None = None) -> list[str]:
    """Mark 'active' calls abandoned long ago as 'failed'. Without this an
    'active' session whose peers both vanished (closed tab, lost network)
    blocks every future call in the chat via get_active_call_in_chat()."""
    cutoff = (
        datetime.now(timezone.utc) - timedelta(seconds=_CALL_ACTIVE_STALE_SECONDS)
    ).strftime('%Y-%m-%d %H:%M:%S')
    if chat_id is None:
        rows = conn.execute(
            "SELECT call_id FROM call_sessions WHERE status = 'active' AND started_at < ?",
            (cutoff,),
        ).fetchall()
    else:
        rows = conn.execute(
            "SELECT call_id FROM call_sessions"
            " WHERE chat_id = ? AND status = 'active' AND started_at < ?",
            (chat_id, cutoff),
        ).fetchall()
    affected: list[str] = []
    for call_id in (str(r['call_id']) for r in rows):
        updated = conn.execute(
            '''
            UPDATE call_sessions
            SET status = 'failed', ended_at = CURRENT_TIMESTAMP
            WHERE call_id = ? AND status = 'active'
            ''',
            (call_id,),
        )
        if updated.rowcount <= 0:
            continue
        affected.append(call_id)
        conn.execute(
            "UPDATE call_participants SET left_at = CURRENT_TIMESTAMP"
            " WHERE call_id = ? AND left_at IS NULL",
            (call_id,),
        )
        call = get_call_session(conn, call_id)
        if call:
            _create_call_log_message_for_call(conn, call, commit=False)
    if affected:
        conn.commit()
    return affected


def get_user_live_calls(conn, user_id: int) -> list[dict]:
    """All non-final call sessions the user is currently a participant of."""
    rows = conn.execute(
        '''
        SELECT cs.*
        FROM call_sessions cs
        JOIN call_participants cp ON cs.call_id = cp.call_id
        WHERE cp.user_id = ?
          AND cs.status IN ('ringing', 'active')
          AND cp.left_at IS NULL
        ''',
        (user_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def terminate_call_on_disconnect(conn, call: dict, user_id: int) -> str | None:
    """End a single call because `user_id`'s socket disconnected.

    'active'  → 'ended'   (other peer is told the call finished)
    'ringing' → 'cancelled' if the user is the initiator, else 'rejected'.

    Returns the final status applied, or None if the call already moved on.
    Commits on success."""
    call_id = str(call.get('call_id') or '')
    status = str(call.get('status') or '')
    if status == 'active':
        return 'ended' if end_call(conn, call_id, user_id, final_status='ended') else None
    if status == 'ringing':
        is_initiator = int(call.get('initiator_id') or 0) == int(user_id)
        if is_initiator:
            return 'cancelled' if cancel_call(conn, call_id) else None
        # A ringing callee that disconnects is treated as rejecting.
        if reject_call(conn, call_id):
            conn.execute(
                "UPDATE call_participants SET left_at = CURRENT_TIMESTAMP"
                " WHERE call_id = ? AND user_id = ? AND left_at IS NULL",
                (call_id, user_id),
            )
            conn.commit()
            return 'rejected'
        return None
    return None


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


def create_call_log_message(conn, call_id: str) -> dict | None:
    """Persist a chat-visible call card for a finished call and return its socket payload."""
    call = get_call_session(conn, call_id)
    if not call:
        return None
    return _create_call_log_message_for_call(conn, call, commit=True)


def _create_call_log_message_for_call(conn, call: dict, *, commit: bool) -> dict | None:
    call_id = str(call.get('call_id') or '').strip()
    chat_id = str(call.get('chat_id') or '').strip()
    status = str(call.get('status') or '').strip()
    if not call_id or not chat_id or status not in _CALL_LOG_FINAL_STATUSES:
        return None

    if _call_log_message_exists(conn, call_id):
        return None

    initiator_id = int(call.get('initiator_id') or 0)
    if initiator_id <= 0:
        return None

    message_text = json.dumps(
        {
            '__suncall': True,
            'version': 1,
            'call_id': call_id,
            'call_type': str(call.get('call_type') or 'audio'),
            'status': status,
            'initiator_id': initiator_id,
            'duration_sec': _safe_int(call.get('duration_sec')),
            'started_at': _safe_text(call.get('started_at')),
            'ended_at': _safe_text(call.get('ended_at')),
        },
        ensure_ascii=False,
        separators=(',', ':'),
    )
    receiver_id = _resolve_direct_call_receiver_id(conn, chat_id, initiator_id)
    row = conn.execute(
        '''
        INSERT INTO messages (
            chat_id, sender_id, receiver_id, message, message_type,
            is_delivered, created_at, call_id
        )
        VALUES (?, ?, ?, ?, 'call', 1, CURRENT_TIMESTAMP, ?)
        RETURNING id, created_at
        ''',
        (chat_id, initiator_id, receiver_id, message_text, call_id),
    ).fetchone()
    if commit:
        conn.commit()
    if row is None:
        return None

    sender = _get_call_sender_identity(conn, initiator_id)
    return {
        'id': row['id'],
        'chat_id': chat_id,
        'sender_user_id': initiator_id,
        'sender_public_key': sender['public_key'],
        'sender_display_name': sender['display_name'],
        'sender_username': sender['username'],
        'sender_avatar_url': sender['avatar_url'],
        'message': message_text,
        'message_type': 'call',
        'is_read': False,
        'is_delivered': True,
        'voice_listened_by_partner': False,
        'created_at': _safe_text(row['created_at']),
        'reactions': [],
    }


def _call_log_message_exists(conn, call_id: str) -> bool:
    row = conn.execute(
        'SELECT 1 FROM messages WHERE call_id = ? LIMIT 1',
        (call_id,),
    ).fetchone()
    return row is not None


def _resolve_direct_call_receiver_id(conn, chat_id: str, initiator_id: int) -> int | None:
    row = conn.execute(
        '''
        SELECT contact_id FROM contacts
        WHERE chat_id = ? AND user_id = ?
        LIMIT 1
        ''',
        (chat_id, initiator_id),
    ).fetchone()
    if row is None:
        return None
    receiver_id = int(row['contact_id'] or 0)
    return receiver_id if receiver_id > 0 else None


def _get_call_sender_identity(conn, user_id: int) -> dict:
    row = conn.execute(
        '''
        SELECT public_key, display_name, username, avatar_url
        FROM users
        WHERE id = ?
        ''',
        (user_id,),
    ).fetchone()
    if row is None:
        return {
            'public_key': '',
            'display_name': '',
            'username': '',
            'avatar_url': '',
        }
    return {
        'public_key': _safe_text(row['public_key']),
        'display_name': _safe_text(row['display_name']),
        'username': _safe_text(row['username']),
        'avatar_url': _safe_text(row['avatar_url']),
    }


def _safe_text(value) -> str:
    return str(value or '')


def _safe_int(value) -> int:
    try:
        parsed = int(value or 0)
    except (TypeError, ValueError):
        return 0
    return max(0, parsed)
