"""Integration tests for the call subsystem.

These exercise the service layer (app/services/calls.py) and the WebRTC signal
relay validator against the real PostgreSQL test database, covering the call
lifecycle, race-condition guards, and abandoned-call cleanup added in the
second-iteration call audit.
"""
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.services.calls import (
    accept_call,
    cancel_call,
    create_call_session,
    create_call_session_locked,
    end_call,
    get_active_call_in_chat,
    get_call_session,
    get_user_active_call,
    get_user_live_calls,
    mark_missed_calls,
    reject_call,
    terminate_call_on_disconnect,
    _reap_stale_active_calls,
)
from app.sockets.call_handlers import _signal_payload_ok
from tests._pg_test_db import connect_test_db


# ── Schema helpers ────────────────────────────────────────────────────────────

def _init_schema(conn) -> None:
    conn.executescript(
        '''
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            public_key TEXT NOT NULL DEFAULT '',
            username TEXT NOT NULL DEFAULT '',
            display_name TEXT NOT NULL DEFAULT '',
            avatar_url TEXT
        );
        CREATE TABLE contacts (
            id INTEGER PRIMARY KEY,
            user_id INTEGER NOT NULL,
            contact_id INTEGER NOT NULL,
            chat_id TEXT NOT NULL
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY,
            chat_id TEXT NOT NULL,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER,
            message TEXT NOT NULL,
            message_type TEXT DEFAULT 'text',
            is_delivered INTEGER DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            call_id TEXT DEFAULT NULL
        );
        CREATE TABLE call_sessions (
            call_id TEXT PRIMARY KEY,
            chat_id TEXT NOT NULL,
            initiator_id INTEGER NOT NULL,
            call_type TEXT NOT NULL DEFAULT 'audio',
            status TEXT NOT NULL DEFAULT 'ringing',
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            accepted_at TIMESTAMP DEFAULT NULL,
            ended_at TIMESTAMP DEFAULT NULL,
            duration_sec INTEGER DEFAULT NULL,
            mediasoup_room_id TEXT DEFAULT NULL
        );
        CREATE TABLE call_participants (
            call_id TEXT NOT NULL,
            user_id INTEGER NOT NULL,
            joined_at TIMESTAMP DEFAULT NULL,
            left_at TIMESTAMP DEFAULT NULL,
            was_muted INTEGER NOT NULL DEFAULT 0,
            had_video INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (call_id, user_id)
        );
        '''
    )
    conn.execute(
        'CREATE UNIQUE INDEX idx_messages_call_id'
        ' ON messages(call_id) WHERE call_id IS NOT NULL'
    )
    conn.execute(
        "INSERT INTO users (id, username, display_name) VALUES"
        " (1, 'alice', 'Alice'), (2, 'bob', 'Bob'), (3, 'carol', 'Carol')"
    )
    # Direct chat between alice (1) and bob (2): a row per direction.
    conn.execute(
        "INSERT INTO contacts (user_id, contact_id, chat_id) VALUES"
        " (1, 2, 'chat-ab'), (2, 1, 'chat-ab')"
    )
    conn.commit()


@pytest.fixture()
def conn(tmp_path: Path):
    connection = connect_test_db(tmp_path / 'calls.db')
    _init_schema(connection)
    try:
        yield connection
    finally:
        connection.close()


def _set_started_at(conn, call_id: str, *, seconds_ago: int) -> None:
    conn.execute(
        "UPDATE call_sessions SET started_at = CURRENT_TIMESTAMP"
        " - (? * INTERVAL '1 second') WHERE call_id = ?",
        (seconds_ago, call_id),
    )
    conn.commit()


# ── Lifecycle ─────────────────────────────────────────────────────────────────

def test_lifecycle_initiate_accept_end(conn):
    call_id = create_call_session_locked(
        conn, chat_id='chat-ab', initiator_id=1, call_type='audio')
    assert call_id is not None

    call = get_call_session(conn, call_id)
    assert call['status'] == 'ringing'
    assert get_user_active_call(conn, 1)['call_id'] == call_id

    assert accept_call(conn, call_id, 2) is True
    assert get_call_session(conn, call_id)['status'] == 'active'

    assert end_call(conn, call_id, 1, final_status='ended') is True
    assert get_call_session(conn, call_id)['status'] == 'ended'
    assert get_active_call_in_chat(conn, 'chat-ab') is None


def test_end_call_records_duration_from_iso_timestamp(conn):
    call_id = create_call_session_locked(
        conn, chat_id='chat-ab', initiator_id=1, call_type='audio')
    assert accept_call(conn, call_id, 2) is True
    accepted_at = (datetime.now(timezone.utc) - timedelta(seconds=65)).isoformat()
    conn.execute('UPDATE call_sessions SET accepted_at = ? WHERE call_id = ?', (accepted_at, call_id))
    conn.commit()

    assert end_call(conn, call_id, 1, final_status='ended') is True

    duration = int(get_call_session(conn, call_id)['duration_sec'])
    assert 60 <= duration <= 70


def test_reject_transitions_ringing_to_rejected(conn):
    call_id = create_call_session_locked(
        conn, chat_id='chat-ab', initiator_id=1, call_type='audio')
    assert reject_call(conn, call_id) is True
    assert get_call_session(conn, call_id)['status'] == 'rejected'
    # A rejected call no longer counts as active for the chat.
    assert get_active_call_in_chat(conn, 'chat-ab') is None


def test_cancel_transitions_ringing_to_cancelled(conn):
    call_id = create_call_session_locked(
        conn, chat_id='chat-ab', initiator_id=1, call_type='audio')
    assert cancel_call(conn, call_id) is True
    assert get_call_session(conn, call_id)['status'] == 'cancelled'


def test_missed_call_after_ring_timeout(conn):
    call_id = create_call_session_locked(
        conn, chat_id='chat-ab', initiator_id=1, call_type='audio')
    _set_started_at(conn, call_id, seconds_ago=120)

    missed = mark_missed_calls(conn, 'chat-ab')
    assert missed == [call_id]
    assert get_call_session(conn, call_id)['status'] == 'missed'
    # A call log message is created exactly once.
    row = conn.execute(
        'SELECT COUNT(*) AS n FROM messages WHERE call_id = ?', (call_id,),
    ).fetchone()
    assert row['n'] == 1


# ── Race conditions ───────────────────────────────────────────────────────────

def test_double_accept_only_first_wins(conn):
    """A second accept (double click / two tabs) must not re-activate the call
    or insert a duplicate participant — WHERE status='ringing' guards it."""
    call_id = create_call_session_locked(
        conn, chat_id='chat-ab', initiator_id=1, call_type='audio')

    assert accept_call(conn, call_id, 2) is True
    assert accept_call(conn, call_id, 2) is False

    rows = conn.execute(
        'SELECT COUNT(*) AS n FROM call_participants WHERE call_id = ? AND user_id = 2',
        (call_id,),
    ).fetchone()
    assert rows['n'] == 1


def test_accept_then_cancel_does_not_revert_active_call(conn):
    """Once accepted, a late cancel must be a no-op (status already 'active')."""
    call_id = create_call_session_locked(
        conn, chat_id='chat-ab', initiator_id=1, call_type='audio')
    assert accept_call(conn, call_id, 2) is True
    assert cancel_call(conn, call_id) is False
    assert get_call_session(conn, call_id)['status'] == 'active'


def test_concurrent_initiate_creates_single_call(conn):
    """create_call_session_locked serializes per chat: the second initiate while
    a call is already ringing returns None instead of a duplicate session."""
    first = create_call_session_locked(
        conn, chat_id='chat-ab', initiator_id=1, call_type='audio')
    assert first is not None

    second = create_call_session_locked(
        conn, chat_id='chat-ab', initiator_id=2, call_type='audio')
    assert second is None

    rows = conn.execute(
        "SELECT COUNT(*) AS n FROM call_sessions"
        " WHERE chat_id = 'chat-ab' AND status IN ('ringing', 'active')",
    ).fetchone()
    assert rows['n'] == 1


def test_initiate_allowed_after_previous_call_ends(conn):
    first = create_call_session_locked(
        conn, chat_id='chat-ab', initiator_id=1, call_type='audio')
    accept_call(conn, first, 2)
    end_call(conn, first, 1, final_status='ended')

    second = create_call_session_locked(
        conn, chat_id='chat-ab', initiator_id=1, call_type='audio')
    assert second is not None and second != first


# ── Abandoned-call cleanup ────────────────────────────────────────────────────

def test_reap_stale_active_calls_unblocks_chat(conn):
    """An 'active' call whose peers vanished must be reaped to 'failed' so it no
    longer blocks new calls in the chat."""
    call_id = create_call_session_locked(
        conn, chat_id='chat-ab', initiator_id=1, call_type='audio')
    accept_call(conn, call_id, 2)
    _set_started_at(conn, call_id, seconds_ago=13 * 60 * 60)

    reaped = _reap_stale_active_calls(conn, 'chat-ab')
    assert reaped == [call_id]
    assert get_call_session(conn, call_id)['status'] == 'failed'
    assert get_active_call_in_chat(conn, 'chat-ab') is None
    # All participants are marked as having left.
    rows = conn.execute(
        'SELECT COUNT(*) AS n FROM call_participants'
        ' WHERE call_id = ? AND left_at IS NULL',
        (call_id,),
    ).fetchone()
    assert rows['n'] == 0


def test_reap_leaves_fresh_active_calls_untouched(conn):
    call_id = create_call_session_locked(
        conn, chat_id='chat-ab', initiator_id=1, call_type='audio')
    accept_call(conn, call_id, 2)
    assert _reap_stale_active_calls(conn, 'chat-ab') == []
    assert get_call_session(conn, call_id)['status'] == 'active'


def test_mark_missed_skips_already_transitioned_call(conn):
    """Idempotency: if a call left 'ringing' between SELECT and UPDATE, the row
    is skipped instead of producing a duplicate call-log message."""
    call_id = create_call_session_locked(
        conn, chat_id='chat-ab', initiator_id=1, call_type='audio')
    _set_started_at(conn, call_id, seconds_ago=120)
    # Simulate a concurrent worker finishing the call first.
    reject_call(conn, call_id)

    missed = mark_missed_calls(conn, 'chat-ab')
    assert missed == []
    assert get_call_session(conn, call_id)['status'] == 'rejected'


# ── Disconnect cleanup ────────────────────────────────────────────────────────

def test_terminate_active_call_on_disconnect_ends_it(conn):
    call_id = create_call_session_locked(
        conn, chat_id='chat-ab', initiator_id=1, call_type='audio')
    accept_call(conn, call_id, 2)

    call = get_call_session(conn, call_id)
    assert terminate_call_on_disconnect(conn, call, 2) == 'ended'
    assert get_call_session(conn, call_id)['status'] == 'ended'


def test_terminate_ringing_call_on_initiator_disconnect_cancels(conn):
    call_id = create_call_session_locked(
        conn, chat_id='chat-ab', initiator_id=1, call_type='audio')
    call = get_call_session(conn, call_id)
    assert terminate_call_on_disconnect(conn, call, 1) == 'cancelled'
    assert get_call_session(conn, call_id)['status'] == 'cancelled'


def test_terminate_ringing_call_on_callee_disconnect_rejects(conn):
    call_id = create_call_session_locked(
        conn, chat_id='chat-ab', initiator_id=1, call_type='audio')
    call = get_call_session(conn, call_id)
    assert terminate_call_on_disconnect(conn, call, 2) == 'rejected'
    assert get_call_session(conn, call_id)['status'] == 'rejected'


def test_get_user_live_calls_lists_only_non_final(conn):
    active = create_call_session_locked(
        conn, chat_id='chat-ab', initiator_id=1, call_type='audio')
    accept_call(conn, active, 2)

    live = get_user_live_calls(conn, 1)
    assert [c['call_id'] for c in live] == [active]

    end_call(conn, active, 1, final_status='ended')
    assert get_user_live_calls(conn, 1) == []


# ── WebRTC signal payload validation ──────────────────────────────────────────

def test_signal_payload_accepts_well_formed_offer():
    assert _signal_payload_ok('call_offer', {
        'sdp': {'type': 'offer', 'sdp': 'v=0\r\n...'},
    }) is True


def test_signal_payload_rejects_oversized_sdp():
    huge = 'a' * (128 * 1024)
    assert _signal_payload_ok('call_answer', {
        'sdp': {'type': 'answer', 'sdp': huge},
    }) is False


def test_signal_payload_rejects_malformed_sdp_shape():
    assert _signal_payload_ok('call_offer', {'sdp': 'not-a-dict'}) is False
    assert _signal_payload_ok('call_offer', {'sdp': {'type': 'bogus', 'sdp': 'x'}}) is False
    assert _signal_payload_ok('call_offer', {'sdp': {'type': 'offer'}}) is False
    assert _signal_payload_ok('call_offer', {'sdp': {'type': 'answer', 'sdp': 'x'}}) is False
    assert _signal_payload_ok('call_answer', {'sdp': {'type': 'offer', 'sdp': 'x'}}) is False


def test_signal_payload_allows_end_of_candidates():
    assert _signal_payload_ok('call_ice_candidate', {'candidate': None}) is True


def test_signal_payload_accepts_normal_ice_candidate():
    assert _signal_payload_ok('call_ice_candidate', {
        'candidate': {'candidate': 'candidate:1 1 udp 2 1.2.3.4 5 typ host',
                      'sdpMid': '0', 'sdpMLineIndex': 0},
    }) is True


def test_signal_payload_rejects_oversized_ice_candidate():
    assert _signal_payload_ok('call_ice_candidate', {
        'candidate': {'candidate': 'x' * (8 * 1024)},
    }) is False


def test_signal_payload_rejects_unknown_event():
    assert _signal_payload_ok('call_bogus', {'sdp': {'type': 'offer', 'sdp': 'x'}}) is False


# ── No-recipient guard ────────────────────────────────────────────────────────

def test_saved_messages_chat_yields_only_self_member(conn):
    """A Saved Messages chat stores a self-referential contact row, so
    _chat_members echoes the caller back. The initiate handler filters the
    caller out of that list and then treats the result as 'no_recipients'."""
    from app.sockets.call_handlers import _chat_members
    conn.execute(
        "INSERT INTO contacts (user_id, contact_id, chat_id) VALUES (3, 3, 'chat-self')"
    )
    conn.commit()
    # _chat_members returns the self id; the handler-side filter removes it.
    members = _chat_members(conn, 'chat-self', 3)
    callees = [p for p in members if p != 3]
    assert callees == []
    assert _chat_members(conn, 'chat-ab', 1) == [2]


def test_create_call_session_low_level_inserts_participant(conn):
    create_call_session(
        conn, call_id='c-1', chat_id='chat-ab', initiator_id=1, call_type='video')
    row = conn.execute(
        'SELECT call_type, status FROM call_sessions WHERE call_id = ?', ('c-1',),
    ).fetchone()
    assert row['call_type'] == 'video' and row['status'] == 'ringing'
    part = conn.execute(
        'SELECT COUNT(*) AS n FROM call_participants WHERE call_id = ? AND user_id = 1',
        ('c-1',),
    ).fetchone()
    assert part['n'] == 1
