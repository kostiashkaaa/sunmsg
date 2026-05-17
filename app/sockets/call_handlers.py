from __future__ import annotations

import logging

from app.services.calls import (
    accept_call,
    cancel_call,
    create_call_session,
    end_call,
    generate_call_id,
    get_active_call_in_chat,
    get_call_session,
    get_user_active_call,
    mark_missed_calls,
    reject_call,
)

logger = logging.getLogger(__name__)

_CALL_RING_TIMEOUT_SECONDS = 60


def _chat_members(conn, chat_id: str, user_id: int) -> list[int]:
    # Direct chats use contacts table; group chats use chat_members
    rows = conn.execute(
        'SELECT contact_id AS user_id FROM contacts WHERE chat_id = %s AND user_id = %s',
        (chat_id, user_id),
    ).fetchall()
    if rows:
        return [int(r['user_id']) for r in rows]
    # Fallback: group chat
    rows = conn.execute(
        'SELECT user_id FROM chat_members WHERE chat_id = %s AND user_id != %s',
        (chat_id, user_id),
    ).fetchall()
    return [int(r['user_id']) for r in rows]


def _is_chat_member(conn, chat_id: str, user_id: int) -> bool:
    # Direct chat: check contacts table
    row = conn.execute(
        'SELECT 1 FROM contacts WHERE chat_id = %s AND user_id = %s',
        (chat_id, user_id),
    ).fetchone()
    if row:
        return True
    # Group chat: check chat_members
    row = conn.execute(
        'SELECT 1 FROM chat_members WHERE chat_id = %s AND user_id = %s',
        (chat_id, user_id),
    ).fetchone()
    return row is not None


def _is_call_participant(conn, call_id: str, user_id: int) -> bool:
    row = conn.execute(
        'SELECT 1 FROM call_participants WHERE call_id = %s AND user_id = %s AND left_at IS NULL',
        (call_id, user_id),
    ).fetchone()
    return row is not None


def _refresh_stale_ringing_call(conn, call: dict | None) -> dict | None:
    if call is None or call['status'] != 'ringing':
        return call
    mark_missed_calls(conn, call['chat_id'])
    return get_call_session(conn, call['call_id'])


# ── Lifecycle handlers ────────────────────────────────────────────────────────

def handle_call_initiate(
    data, *, session_store, require_payload_dict_func, socket_csrf_ok_func,
    socket_rate_ok_func, is_valid_chat_id_func, get_db_connection_func,
    emit_func, logger=logger,
):
    user_id = session_store.get('user_id')
    if not require_payload_dict_func(data):
        return
    if not socket_csrf_ok_func(data):
        return
    if not socket_rate_ok_func(user_id, 'call_initiate'):
        return

    chat_id = str(data.get('chat_id') or '').strip()
    call_type = str(data.get('call_type') or 'audio').strip()
    if call_type not in ('audio', 'video'):
        call_type = 'audio'
    request_id = str(data.get('request_id') or '').strip() or None

    if not is_valid_chat_id_func(chat_id):
        emit_func('call_error', {'error': 'invalid_chat_id', 'request_id': request_id})
        return

    conn = get_db_connection_func(request_scoped=False)
    try:
        if not _is_chat_member(conn, chat_id, user_id):
            emit_func('call_error', {'error': 'not_member', 'request_id': request_id})
            return

        mark_missed_calls(conn)

        existing = get_active_call_in_chat(conn, chat_id)
        if existing:
            emit_func('call_error', {'error': 'call_already_active', 'call_id': existing['call_id'], 'request_id': request_id})
            return

        if get_user_active_call(conn, user_id):
            emit_func('call_error', {'error': 'user_busy', 'request_id': request_id})
            return

        call_id = generate_call_id()
        create_call_session(conn, call_id=call_id, chat_id=chat_id, initiator_id=user_id, call_type=call_type)

        row = conn.execute(
            'SELECT display_name, username, avatar_url FROM users WHERE id = %s', (user_id,),
        ).fetchone()
        initiator_info = {
            'user_id': user_id,
            'display_name': str(row['display_name'] or '') if row else '',
            'username':     str(row['username']     or '') if row else '',
            'avatar_url':   str(row['avatar_url']   or '') if row else '',
        }

        emit_func('call_initiated', {
            'call_id': call_id, 'chat_id': chat_id,
            'call_type': call_type, 'initiator': initiator_info,
            'request_id': request_id,
        })

        for pid in _chat_members(conn, chat_id, user_id):
            emit_func('call_incoming', {
                'call_id': call_id, 'chat_id': chat_id,
                'call_type': call_type, 'initiator': initiator_info,
            }, to=f'user_{pid}')

        logger.info('Call initiated: call_id=%s chat=%s user=%s type=%s', call_id, chat_id, user_id, call_type)
    except Exception:
        logger.exception('Error in handle_call_initiate')
        emit_func('call_error', {'error': 'server_error', 'request_id': request_id})
    finally:
        conn.close()


def handle_call_accept(
    data, *, session_store, require_payload_dict_func, socket_csrf_ok_func,
    socket_rate_ok_func, get_db_connection_func, emit_func, logger=logger,
):
    user_id = session_store.get('user_id')
    if not require_payload_dict_func(data):
        return
    if not socket_csrf_ok_func(data):
        return
    if not socket_rate_ok_func(user_id, 'call_accept'):
        return

    call_id    = str(data.get('call_id')    or '').strip()
    request_id = str(data.get('request_id') or '').strip() or None

    if not call_id:
        emit_func('call_error', {'error': 'missing_call_id', 'request_id': request_id})
        return

    conn = get_db_connection_func(request_scoped=False)
    try:
        call = _refresh_stale_ringing_call(conn, get_call_session(conn, call_id))
        if call is None or call['status'] != 'ringing':
            emit_func('call_error', {'error': 'call_not_found_or_expired', 'call_id': call_id, 'request_id': request_id})
            return

        if int(call['initiator_id']) == int(user_id) or not _is_chat_member(conn, call['chat_id'], user_id):
            emit_func('call_error', {'error': 'not_member', 'call_id': call_id, 'request_id': request_id})
            return

        mark_missed_calls(conn)

        if get_user_active_call(conn, user_id):
            emit_func('call_error', {'error': 'user_busy', 'request_id': request_id})
            return

        if not accept_call(conn, call_id, user_id):
            emit_func('call_error', {'error': 'call_not_found_or_expired', 'call_id': call_id, 'request_id': request_id})
            return

        emit_func('call_accepted', {'call_id': call_id, 'user_id': user_id, 'request_id': request_id})
        emit_func('call_accepted', {'call_id': call_id, 'user_id': user_id},
                  to=f'user_{call["initiator_id"]}')

        logger.info('Call accepted: call_id=%s user=%s', call_id, user_id)
    except Exception:
        logger.exception('Error in handle_call_accept')
        emit_func('call_error', {'error': 'server_error', 'request_id': request_id})
    finally:
        conn.close()


def handle_call_reject(
    data, *, session_store, require_payload_dict_func, socket_csrf_ok_func,
    socket_rate_ok_func, get_db_connection_func, emit_func, logger=logger,
):
    user_id = session_store.get('user_id')
    if not require_payload_dict_func(data):
        return
    if not socket_csrf_ok_func(data):
        return
    if not socket_rate_ok_func(user_id, 'call_reject'):
        return

    call_id    = str(data.get('call_id')    or '').strip()
    request_id = str(data.get('request_id') or '').strip() or None
    if not call_id:
        return

    conn = get_db_connection_func(request_scoped=False)
    try:
        call = _refresh_stale_ringing_call(conn, get_call_session(conn, call_id))
        if call is None or call['status'] != 'ringing':
            return
        if int(call['initiator_id']) == int(user_id) or not _is_chat_member(conn, call['chat_id'], user_id):
            return
        if not reject_call(conn, call_id):
            return
        emit_func('call_rejected', {'call_id': call_id, 'user_id': user_id},
                  to=f'user_{call["initiator_id"]}')
        emit_func('call_rejected', {'call_id': call_id, 'user_id': user_id, 'request_id': request_id})
        logger.info('Call rejected: call_id=%s user=%s', call_id, user_id)
    except Exception:
        logger.exception('Error in handle_call_reject')
    finally:
        conn.close()


def handle_call_cancel(
    data, *, session_store, require_payload_dict_func, socket_csrf_ok_func,
    socket_rate_ok_func, get_db_connection_func, emit_func, logger=logger,
):
    user_id = session_store.get('user_id')
    if not require_payload_dict_func(data):
        return
    if not socket_csrf_ok_func(data):
        return
    if not socket_rate_ok_func(user_id, 'call_cancel'):
        return

    call_id    = str(data.get('call_id')    or '').strip()
    request_id = str(data.get('request_id') or '').strip() or None

    conn = get_db_connection_func(request_scoped=False)
    try:
        call = _refresh_stale_ringing_call(conn, get_call_session(conn, call_id))
        if call is None or call['status'] != 'ringing' or int(call['initiator_id']) != int(user_id):
            return
        if not cancel_call(conn, call_id):
            return
        for pid in _chat_members(conn, call['chat_id'], user_id):
            emit_func('call_cancelled', {'call_id': call_id}, to=f'user_{pid}')
        emit_func('call_cancelled', {'call_id': call_id, 'request_id': request_id})
        logger.info('Call cancelled: call_id=%s user=%s', call_id, user_id)
    except Exception:
        logger.exception('Error in handle_call_cancel')
    finally:
        conn.close()


def handle_call_end(
    data, *, session_store, require_payload_dict_func, socket_csrf_ok_func,
    socket_rate_ok_func, get_db_connection_func, emit_func, logger=logger,
):
    user_id = session_store.get('user_id')
    if not require_payload_dict_func(data):
        return
    if not socket_csrf_ok_func(data):
        return
    if not socket_rate_ok_func(user_id, 'call_end'):
        return

    call_id    = str(data.get('call_id')    or '').strip()
    request_id = str(data.get('request_id') or '').strip() or None

    conn = get_db_connection_func(request_scoped=False)
    try:
        call = get_call_session(conn, call_id)
        if call is None or call['status'] != 'active':
            return
        if not _is_call_participant(conn, call_id, user_id):
            return
        if not end_call(conn, call_id, user_id, final_status='ended'):
            return
        updated  = get_call_session(conn, call_id)
        duration = updated['duration_sec'] if updated else None

        for pid in _chat_members(conn, call['chat_id'], user_id):
            emit_func('call_ended', {'call_id': call_id, 'ended_by': user_id, 'duration_sec': duration},
                      to=f'user_{pid}')
        emit_func('call_ended', {'call_id': call_id, 'ended_by': user_id,
                                 'duration_sec': duration, 'request_id': request_id})
        logger.info('Call ended: call_id=%s user=%s duration=%s', call_id, user_id, duration)
    except Exception:
        logger.exception('Error in handle_call_end')
    finally:
        conn.close()


def handle_call_media_state(
    data, *, session_store, require_payload_dict_func, socket_csrf_ok_func,
    socket_rate_ok_func, get_db_connection_func, emit_func, logger=logger,
):
    user_id = session_store.get('user_id')
    if not require_payload_dict_func(data):
        return
    if not socket_csrf_ok_func(data):
        return
    if not socket_rate_ok_func(user_id, 'call_media_state'):
        return

    call_id       = str(data.get('call_id')      or '').strip()
    audio_muted   = bool(data.get('audio_muted',   False))
    video_enabled = bool(data.get('video_enabled', False))

    conn = get_db_connection_func(request_scoped=False)
    try:
        call = get_call_session(conn, call_id)
        if call is None or call['status'] != 'active':
            return
        if not _is_call_participant(conn, call_id, user_id):
            return
        for pid in _chat_members(conn, call['chat_id'], user_id):
            emit_func('call_media_state', {
                'call_id': call_id, 'user_id': user_id,
                'audio_muted': audio_muted, 'video_enabled': video_enabled,
            }, to=f'user_{pid}')
    except Exception:
        logger.exception('Error in handle_call_media_state')
    finally:
        conn.close()


# ── P2P WebRTC signal relay ───────────────────────────────────────────────────
# The server relays SDP offer/answer and ICE candidates between the two peers.
# It never decrypts media; SDP still requires trusting the signalling server.

def handle_call_webrtc_signal(
    data, *, session_store, require_payload_dict_func, socket_csrf_ok_func,
    socket_rate_ok_func, get_db_connection_func, emit_func,
    event_name: str, logger=logger,
):
    """Relay a WebRTC P2P signalling message to the other participant."""
    user_id = session_store.get('user_id')
    if not require_payload_dict_func(data):
        return
    if not socket_csrf_ok_func(data):
        return
    if not socket_rate_ok_func(user_id, event_name):
        return

    call_id = str(data.get('call_id') or '').strip()

    conn = get_db_connection_func(request_scoped=False)
    try:
        call = get_call_session(conn, call_id)
        if call is None or call['status'] != 'active':
            return

        # Verify sender is a participant (either initiator or acceptee)
        if not _is_call_participant(conn, call_id, user_id):
            return

        payload = {k: v for k, v in data.items() if k not in ('csrf_token', '_csrf_token')}
        payload['from_user_id'] = user_id

        # Relay to the other participant only
        for pid in _chat_members(conn, call['chat_id'], user_id):
            if _is_call_participant(conn, call_id, pid):
                emit_func(event_name, payload, to=f'user_{pid}')
    except Exception:
        logger.exception('Error in handle_call_webrtc_signal event=%s', event_name)
    finally:
        conn.close()
