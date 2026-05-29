from __future__ import annotations

import logging

from app.services.calls import (
    accept_call,
    cancel_call,
    create_call_log_message,
    create_call_session_locked,
    end_call,
    get_active_call_in_chat,
    get_call_session,
    get_user_active_call,
    get_user_live_calls,
    mark_missed_calls,
    reject_call,
    terminate_call_on_disconnect,
)
from app.services.call_feature_access import can_user_use_calls
from app.services.call_metrics import record_call_quality_sample
from app.services.user import get_safe_avatar_url
from app.services.user_privacy import can_receive_call

logger = logging.getLogger(__name__)

_CALL_RING_TIMEOUT_SECONDS = 60

# Upper bounds for relayed WebRTC signalling payloads. A well-formed SDP for a
# 1:1 audio/video call is a few KB; ICE candidates are well under 1 KB. These
# caps stop a malicious participant from flooding huge payloads (OOM / DoS).
_MAX_SDP_BYTES = 64 * 1024
_MAX_ICE_CANDIDATE_BYTES = 4 * 1024


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


def _call_participant_ids(conn, call_id: str, *, exclude_user_id: int | None = None) -> list[int]:
    rows = conn.execute(
        '''
        SELECT user_id
        FROM call_participants
        WHERE call_id = %s AND left_at IS NULL
        ORDER BY joined_at, user_id
        ''',
        (call_id,),
    ).fetchall()
    exclude = int(exclude_user_id) if exclude_user_id is not None else None
    ids = []
    for row in rows:
        participant_id = int(row['user_id'])
        if exclude is not None and participant_id == exclude:
            continue
        ids.append(participant_id)
    return ids


def _refresh_stale_ringing_call(conn, call: dict | None) -> dict | None:
    if call is None or call['status'] != 'ringing':
        return call
    mark_missed_calls(conn, call['chat_id'])
    return get_call_session(conn, call['call_id'])


def _emit_call_log_message(conn, call_id: str, emit_func, recipient_user_ids) -> None:
    payload = create_call_log_message(conn, call_id)
    if not payload:
        return
    seen = set()
    for raw_user_id in recipient_user_ids:
        try:
            user_id = int(raw_user_id)
        except (TypeError, ValueError):
            continue
        if user_id <= 0 or user_id in seen:
            continue
        seen.add(user_id)
        emit_func('receive_message', payload, to=f'user_{user_id}')


def _user_identity(conn, user_id: int, *, viewer_id: int | None = None) -> dict:
    try:
        row = conn.execute(
            'SELECT id, public_key, display_name, username, avatar_url, avatar_visibility FROM users WHERE id = %s',
            (int(user_id),),
        ).fetchone()
    except Exception:
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001
            pass
        row = conn.execute(
            "SELECT id, public_key, display_name, username, avatar_url, 'all' AS avatar_visibility FROM users WHERE id = %s",
            (int(user_id),),
        ).fetchone()
    if not row:
        return {
            'user_id': int(user_id),
            'public_key': '',
            'display_name': '',
            'username': '',
            'avatar_url': '',
        }
    return {
        'user_id': int(row['id']),
        'public_key': str(row['public_key'] or ''),
        'display_name': str(row['display_name'] or ''),
        'username': str(row['username'] or ''),
        'avatar_url': str(get_safe_avatar_url(row, viewer_id if viewer_id is not None else user_id) or ''),
    }


def _call_partner_identity(conn, call: dict, user_id: int) -> dict:
    initiator_id = int(call.get('initiator_id') or 0)
    if initiator_id and initiator_id != int(user_id):
        return _user_identity(conn, initiator_id, viewer_id=user_id)
    participant_ids = _call_participant_ids(
        conn,
        str(call.get('call_id') or ''),
        exclude_user_id=int(user_id),
    )
    if not participant_ids:
        participant_ids = _chat_members(conn, str(call.get('chat_id') or ''), user_id)
    for participant_id in participant_ids:
        if int(participant_id) != int(user_id):
            return _user_identity(conn, int(participant_id), viewer_id=user_id)
    return _user_identity(conn, initiator_id or user_id, viewer_id=user_id)


def _partner_media_state(conn, call_id: str, user_id: int) -> dict:
    row = conn.execute(
        '''
        SELECT was_muted, had_video
        FROM call_participants
        WHERE call_id = %s AND user_id != %s AND left_at IS NULL
        ORDER BY joined_at, user_id
        LIMIT 1
        ''',
        (call_id, int(user_id)),
    ).fetchone()
    return {
        'audio_muted': bool(row['was_muted']) if row else False,
        'video_enabled': bool(row['had_video']) if row else False,
    }


def _serialize_live_call_for_user(conn, call: dict, user_id: int) -> dict:
    call_id = str(call.get('call_id') or '')
    status = str(call.get('status') or '')
    return {
        'call_id': call_id,
        'chat_id': str(call.get('chat_id') or ''),
        'call_type': str(call.get('call_type') or 'audio'),
        'status': status,
        'initiator_id': int(call.get('initiator_id') or 0),
        'role': 'initiator' if int(call.get('initiator_id') or 0) == int(user_id) else 'callee',
        'accepted_at': str(call.get('accepted_at') or ''),
        'partner': _call_partner_identity(conn, call, user_id),
        'partner_media': _partner_media_state(conn, call_id, user_id) if status == 'active' else None,
    }


def _emit_active_call_ended(conn, call: dict, call_id: str, user_id: int, request_id: str | None, emit_func) -> bool:
    if not _is_call_participant(conn, call_id, user_id):
        return False
    other_user_ids = _call_participant_ids(conn, call_id, exclude_user_id=user_id)
    if not end_call(conn, call_id, user_id, final_status='ended'):
        return False
    updated = get_call_session(conn, call_id)
    duration = updated['duration_sec'] if updated else None
    recipient_ids = [user_id, *other_user_ids]
    _emit_call_log_message(conn, call_id, emit_func, recipient_ids)

    for pid in other_user_ids:
        emit_func('call_ended', {'call_id': call_id, 'ended_by': user_id, 'duration_sec': duration},
                  to=f'user_{pid}')
    emit_func('call_ended', {'call_id': call_id, 'ended_by': user_id,
                             'duration_sec': duration, 'request_id': request_id},
              to=f'user_{user_id}')
    return True


def _send_incoming_call_push_if_needed(
    conn, *, call_id: str, chat_id: str, call_type: str, initiator: dict,
    receiver_user_id: int, count_active_func=None, send_call_incoming_push_func=None,
    send_call_incoming_voip_push_func=None,
    logger=logger,
) -> None:
    if not callable(send_call_incoming_push_func) and not callable(send_call_incoming_voip_push_func):
        return
    receiver = _user_identity(conn, receiver_user_id)
    receiver_public_key = str(receiver.get('public_key') or '').strip()
    if callable(count_active_func) and receiver_public_key and count_active_func(receiver_public_key) > 0:
        return
    payload = {
        'receiver_user_id': receiver_user_id,
        'initiator_user_id': int(initiator.get('user_id') or 0),
        'initiator_display_name': str(initiator.get('display_name') or ''),
        'initiator_username': str(initiator.get('username') or ''),
        'chat_id': chat_id,
        'call_id': call_id,
        'call_type': call_type,
    }
    if callable(send_call_incoming_push_func):
        try:
            send_call_incoming_push_func(**payload)
        except Exception:  # noqa: BLE001
            logger.warning('Incoming call web push failed for receiver_id=%s', receiver_user_id)
    if callable(send_call_incoming_voip_push_func):
        try:
            send_call_incoming_voip_push_func(
                **payload,
                initiator_avatar_url=str(initiator.get('avatar_url') or ''),
            )
        except Exception:  # noqa: BLE001
            logger.warning('Incoming call APNs VoIP push failed for receiver_id=%s', receiver_user_id)

# ── Lifecycle handlers ────────────────────────────────────────────────────────

def handle_call_initiate(
    data, *, session_store, require_payload_dict_func, socket_csrf_ok_func,
    socket_rate_ok_func, is_valid_chat_id_func, get_db_connection_func,
    emit_func, count_active_func=None, send_call_incoming_push_func=None,
    send_call_incoming_voip_push_func=None, logger=logger,
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

        # Reachable callees, excluding the caller. The Saved Messages chat
        # stores a self-referential contact row, so _chat_members can echo the
        # caller back — drop it. With no real callee the call would ring nobody
        # for 60 s, so reject it up front.
        callee_ids = list(dict.fromkeys(
            int(p) for p in _chat_members(conn, chat_id, user_id)
            if int(p) != int(user_id)
        ))
        if not callee_ids:
            emit_func('call_error', {'error': 'no_recipients', 'request_id': request_id})
            return

        callee_ids = [
            int(pid) for pid in callee_ids
            if can_receive_call(conn, receiver_id=int(pid), caller_id=int(user_id))
        ]
        if not callee_ids:
            emit_func('call_error', {'error': 'call_privacy_restricted', 'request_id': request_id})
            return

        if len(callee_ids) != 1:
            emit_func('call_error', {'error': 'unsupported_call_topology', 'request_id': request_id})
            return

        participant_ids = [int(user_id), *callee_ids]
        if not can_user_use_calls(conn, user_id=int(user_id)):
            emit_func('call_error', {'error': 'calls_feature_disabled', 'request_id': request_id})
            return

        # Expire any stale ringing calls first, so a call the caller never
        # cancelled does not make them look busy to themselves.
        mark_missed_calls(conn)

        if get_user_active_call(conn, user_id):
            emit_func('call_error', {'error': 'user_busy', 'request_id': request_id})
            return

        callee_id = callee_ids[0]
        if get_user_active_call(conn, callee_id):
            emit_func('call_error', {'error': 'callee_busy', 'request_id': request_id})
            return

        # Per-chat advisory lock makes the "no live call" check + INSERT atomic,
        # so two concurrent call_initiate requests cannot both create a session.
        call_id = create_call_session_locked(
            conn, chat_id=chat_id, initiator_id=user_id, call_type=call_type,
            participant_ids=participant_ids,
        )
        if call_id is None:
            existing = get_active_call_in_chat(conn, chat_id)
            emit_func('call_error', {
                'error': 'call_already_active',
                'call_id': existing['call_id'] if existing else None,
                'request_id': request_id,
            })
            return

        initiator_identity = _user_identity(conn, user_id, viewer_id=user_id)
        initiator_info = {
            'user_id': initiator_identity['user_id'],
            'display_name': initiator_identity['display_name'],
            'username': initiator_identity['username'],
            'avatar_url': initiator_identity['avatar_url'],
        }

        emit_func('call_initiated', {
            'call_id': call_id, 'chat_id': chat_id,
            'call_type': call_type, 'initiator': initiator_info,
            'request_id': request_id,
        })

        for pid in participant_ids:
            if int(pid) == int(user_id):
                continue
            receiver_initiator_identity = _user_identity(conn, user_id, viewer_id=pid)
            receiver_initiator_info = {
                'user_id': receiver_initiator_identity['user_id'],
                'display_name': receiver_initiator_identity['display_name'],
                'username': receiver_initiator_identity['username'],
                'avatar_url': receiver_initiator_identity['avatar_url'],
            }
            emit_func('call_incoming', {
                'call_id': call_id, 'chat_id': chat_id,
                'call_type': call_type, 'initiator': receiver_initiator_info,
            }, to=f'user_{pid}')
            _send_incoming_call_push_if_needed(
                conn,
                call_id=call_id,
                chat_id=chat_id,
                call_type=call_type,
                initiator=receiver_initiator_info,
                receiver_user_id=pid,
                count_active_func=count_active_func,
                send_call_incoming_push_func=send_call_incoming_push_func,
                send_call_incoming_voip_push_func=send_call_incoming_voip_push_func,
                logger=logger,
            )

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
        if not can_receive_call(conn, receiver_id=int(user_id), caller_id=int(call['initiator_id'])):
            emit_func('call_error', {'error': 'call_privacy_restricted', 'call_id': call_id, 'request_id': request_id})
            return

        mark_missed_calls(conn)

        existing_user_call = get_user_active_call(conn, user_id)
        if existing_user_call and str(existing_user_call.get('call_id') or '') != call_id:
            emit_func('call_error', {'error': 'user_busy', 'request_id': request_id})
            return

        if not accept_call(conn, call_id, user_id):
            emit_func('call_error', {'error': 'call_not_found_or_expired', 'call_id': call_id, 'request_id': request_id})
            return

        emit_func('call_accepted', {'call_id': call_id, 'user_id': user_id},
                  to=f'user_{call["initiator_id"]}')
        # Also notify the callee's own room: other tabs/devices that showed the
        # incoming banner must dismiss it now that the call was accepted here.
        emit_func('call_accepted', {'call_id': call_id, 'user_id': user_id, 'request_id': request_id},
                  to=f'user_{user_id}')

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
        _emit_call_log_message(conn, call_id, emit_func, (user_id, call['initiator_id']))
        emit_func('call_rejected', {'call_id': call_id, 'user_id': user_id},
                  to=f'user_{call["initiator_id"]}')
        emit_func('call_rejected', {'call_id': call_id, 'user_id': user_id, 'request_id': request_id},
                  to=f'user_{user_id}')
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
        # _is_chat_member not needed: initiator_id == user_id already proves membership
        # (a non-member cannot have created the call session in the first place).
        if call is None or int(call['initiator_id']) != int(user_id):
            return
        if call['status'] == 'ringing':
            if not cancel_call(conn, call_id):
                return
            other_user_ids = _chat_members(conn, call['chat_id'], user_id)
            recipient_ids = [user_id, *other_user_ids]
            _emit_call_log_message(conn, call_id, emit_func, recipient_ids)
            for pid in other_user_ids:
                emit_func('call_cancelled', {'call_id': call_id}, to=f'user_{pid}')
            emit_func('call_cancelled', {'call_id': call_id, 'request_id': request_id},
                      to=f'user_{user_id}')
            logger.info('Call cancelled: call_id=%s user=%s', call_id, user_id)
            return
        if call['status'] == 'active':
            if _emit_active_call_ended(conn, call, call_id, user_id, request_id, emit_func):
                logger.info('Call ended from late cancel: call_id=%s user=%s', call_id, user_id)
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
        if _emit_active_call_ended(conn, call, call_id, user_id, request_id, emit_func):
            updated = get_call_session(conn, call_id)
            duration = updated['duration_sec'] if updated else None
            logger.info('Call ended: call_id=%s user=%s duration=%s', call_id, user_id, duration)
    except Exception:
        logger.exception('Error in handle_call_end')
    finally:
        conn.close()


def handle_call_sync(
    data, *, session_store, require_payload_dict_func, socket_csrf_ok_func,
    socket_rate_ok_func, get_db_connection_func, emit_func, logger=logger,
):
    user_id = session_store.get('user_id')
    if not require_payload_dict_func(data):
        return
    if not socket_csrf_ok_func(data):
        return
    if not socket_rate_ok_func(user_id, 'call_sync'):
        return

    request_id = str(data.get('request_id') or '').strip() or None
    conn = get_db_connection_func(request_scoped=False)
    try:
        mark_missed_calls(conn)
        call = get_user_active_call(conn, user_id)
        payload = {
            'active_call': _serialize_live_call_for_user(conn, call, user_id) if call else None,
            'request_id': request_id,
        }
        emit_func('call_sync', payload)
    except Exception:
        logger.exception('Error in handle_call_sync')
        emit_func('call_error', {'error': 'server_error', 'request_id': request_id})
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
    video_source_raw = str(data.get('video_source') or '').strip().lower()
    video_source = 'screen' if video_enabled and video_source_raw == 'screen' else 'camera'

    conn = get_db_connection_func(request_scoped=False)
    try:
        call = get_call_session(conn, call_id)
        if call is None or call['status'] != 'active':
            return
        if not _is_call_participant(conn, call_id, user_id):
            return
        conn.execute(
            '''
            UPDATE call_participants
            SET was_muted = %s, had_video = %s
            WHERE call_id = %s AND user_id = %s AND left_at IS NULL
            ''',
            (1 if audio_muted else 0, 1 if video_enabled else 0, call_id, user_id),
        )
        conn.commit()
        for pid in _call_participant_ids(conn, call_id, exclude_user_id=user_id):
            emit_func('call_media_state', {
                'call_id': call_id, 'user_id': user_id,
                'audio_muted': audio_muted, 'video_enabled': video_enabled,
                'video_source': video_source,
            }, to=f'user_{pid}')
    except Exception:
        logger.exception('Error in handle_call_media_state')
    finally:
        conn.close()


def handle_call_quality(
    data, *, session_store, require_payload_dict_func, socket_csrf_ok_func,
    socket_rate_ok_func, get_db_connection_func, logger=logger,
):
    user_id = session_store.get('user_id')
    if not require_payload_dict_func(data):
        return
    if not socket_csrf_ok_func(data):
        return
    if not socket_rate_ok_func(user_id, 'call_quality'):
        return

    call_id = str(data.get('call_id') or '').strip()
    if not call_id:
        return

    conn = get_db_connection_func(request_scoped=False)
    try:
        call = get_call_session(conn, call_id)
        if call is None or call['status'] != 'active':
            return
        if not _is_call_participant(conn, call_id, user_id):
            return
        record_call_quality_sample(call_id=call_id, user_id=int(user_id), payload=data)
    except Exception:
        logger.exception('Error in handle_call_quality')
    finally:
        conn.close()


# ── P2P WebRTC signal relay ───────────────────────────────────────────────────
# The server relays SDP offer/answer and ICE candidates between the two peers.
# It never decrypts media; SDP still requires trusting the signalling server.

def _signal_payload_ok(event_name: str, data: dict) -> bool:
    """Reject malformed or oversized WebRTC signalling payloads before relay.

    Browsers tolerate junk SDP at setRemoteDescription, so the only real risk
    from a malicious participant is payload size (OOM / DoS on broadcast).
    We validate shape just enough to bound the size cheaply."""
    if event_name in ('call_offer', 'call_answer'):
        sdp = data.get('sdp')
        if not isinstance(sdp, dict):
            return False
        sdp_type = sdp.get('type')
        expected_sdp_type = 'offer' if event_name == 'call_offer' else 'answer'
        if sdp_type != expected_sdp_type:
            return False
        sdp_text = sdp.get('sdp')
        if not isinstance(sdp_text, str):
            return False
        if len(sdp_text.encode('utf-8', 'ignore')) > _MAX_SDP_BYTES:
            return False
        return True
    if event_name == 'call_ice_candidate':
        candidate = data.get('candidate')
        # An end-of-candidates signal is null/absent — permitted.
        if candidate is None:
            return True
        if not isinstance(candidate, dict):
            return False
        cand_str = candidate.get('candidate')
        if cand_str is not None and not isinstance(cand_str, str):
            return False
        try:
            encoded = len(str(candidate).encode('utf-8', 'ignore'))
        except Exception:  # noqa: BLE001
            return False
        return encoded <= _MAX_ICE_CANDIDATE_BYTES
    return False


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
    if not call_id:
        return
    if not _signal_payload_ok(event_name, data):
        logger.warning('Dropped malformed/oversized %s from user=%s', event_name, user_id)
        return

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

        # Relay only to current call participants, not every chat member.
        for pid in _call_participant_ids(conn, call_id, exclude_user_id=user_id):
            emit_func(event_name, payload, to=f'user_{pid}')
    except Exception:
        logger.exception('Error in handle_call_webrtc_signal event=%s', event_name)
    finally:
        conn.close()


# ── Disconnect cleanup ────────────────────────────────────────────────────────

def handle_call_disconnect_cleanup(
    user_id, *, get_db_connection_func, emit_func, logger=logger,
):
    """End every live call the user is in because their last socket disconnected.

    Called only when the user has no remaining connected tabs, so closing one
    of several tabs does not kill an in-progress call. Without this an 'active'
    call whose peer simply closed the browser would hang forever (the chat is
    then permanently blocked by call_already_active)."""
    try:
        user_id = int(user_id)
    except (TypeError, ValueError):
        return
    if user_id <= 0:
        return

    conn = get_db_connection_func(request_scoped=False)
    try:
        for call in get_user_live_calls(conn, user_id):
            call_id = str(call.get('call_id') or '')
            chat_id = str(call.get('chat_id') or '')
            participant_other_ids = _call_participant_ids(conn, call_id, exclude_user_id=user_id)
            final_status = terminate_call_on_disconnect(conn, call, user_id)
            if not final_status:
                continue

            other_ids = participant_other_ids or _chat_members(conn, chat_id, user_id)
            _emit_call_log_message(conn, call_id, emit_func, [user_id, *other_ids])

            if final_status == 'ended':
                updated = get_call_session(conn, call_id)
                duration = updated['duration_sec'] if updated else None
                for pid in other_ids:
                    emit_func('call_ended', {
                        'call_id': call_id, 'ended_by': user_id, 'duration_sec': duration,
                    }, to=f'user_{pid}')
            elif final_status == 'cancelled':
                for pid in other_ids:
                    emit_func('call_cancelled', {'call_id': call_id}, to=f'user_{pid}')
            elif final_status == 'rejected':
                emit_func('call_rejected', {'call_id': call_id, 'user_id': user_id},
                          to=f'user_{call["initiator_id"]}')

            logger.info('Call %s ended on disconnect: user=%s status=%s',
                        call_id, user_id, final_status)
    except Exception:
        logger.exception('Error in handle_call_disconnect_cleanup user=%s', user_id)
    finally:
        conn.close()
