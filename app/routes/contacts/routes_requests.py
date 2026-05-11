from flask import jsonify, request, session

from app.database import get_db_connection
from app.extensions import limiter, socketio
from app.routes.socket_emit import build_route_socket_emitter
from app.routes.contacts_utils import canonical_username, parse_int
from app.routes.dialog_request_handlers import (
    build_accept_request_socket_events,
    build_decline_request_socket_event,
    fetch_pending_dialog_requests_for_user,
)
from app.routes.dialog_request_route_handlers import (
    process_accept_request,
    process_accept_request_route,
    process_decline_request,
    process_decline_request_route,
    process_get_dialog_requests,
)
from app.routes.dialog_request_workflows import (
    accept_dialog_request_workflow,
    decline_dialog_request_workflow,
    send_dialog_request_workflow,
)
from app.routes.chat_group_events import emit_group_event
from app.routes.send_request_route_handlers import (
    process_send_request,
    process_send_request_route,
)
from app.services.blocking import block_forbidden_response
from app.services.blocking import build_block_state, normalize_block_state
from app.services.crypto import generate_chat_id
from app.services.group_invite_requests import (
    accept_group_invite_request,
    decline_group_invite_request,
    fetch_pending_group_invite_requests_for_user,
)
from app.services.user import get_safe_avatar_url

from .context import (
    ACCEPT_REQUEST_BLOCKED_ERROR,
    AUTH_REQUIRED_ERROR,
    AUTO_DECLINE_REQUEST_ERROR,
    BLOCKED_REQUEST_ERROR,
    CHAT_NOT_FOUND_ERROR,
    DEFAULT_PRIVATE_CHAT_NAME,
    DIALOG_REQUESTS_FETCH_FAILED_ERROR,
    INVALID_CONTACT_USER_ID_ERROR,
    INVALID_REQUEST_DATA_ERROR,
    REQUEST_SENT_MESSAGE,
    SELF_REQUEST_ERROR,
    SEND_REQUEST_COOLDOWN_ERROR,
    SEND_REQUEST_FAILED_ERROR,
    USERNAME_PATTERN,
    USER_NOT_FOUND_ERROR,
    contacts_bp,
)

_emit_socket_event = build_route_socket_emitter(
    raw_emit_func=socketio.emit,
    get_db_connection_func=get_db_connection,
    logger=None,
)


@contacts_bp.route('/send_request', methods=['POST'])
@limiter.limit("15 per minute")
def send_request_route():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': AUTH_REQUIRED_ERROR}), 401

    user_id = session['user_id']
    data = request.get_json()

    conn = get_db_connection()
    result = process_send_request_route(
        conn,
        sender_user_id=user_id,
        data=data,
        parse_int_func=parse_int,
        process_send_request_func=process_send_request,
        send_dialog_request_workflow_func=send_dialog_request_workflow,
        normalize_block_state_func=normalize_block_state,
        build_block_state_func=build_block_state,
    )
    conn.close()

    if result['status'] == 'invalid_payload':
        return jsonify({'success': False, 'error': INVALID_REQUEST_DATA_ERROR}), 400
    if result['status'] == 'invalid_contact_user_id':
        return jsonify({'success': False, 'error': INVALID_CONTACT_USER_ID_ERROR}), 400
    if result['status'] == 'self_request':
        return jsonify({'success': False, 'error': SELF_REQUEST_ERROR}), 400
    if result['status'] == 'db_error':
        return jsonify({'success': False, 'error': SEND_REQUEST_FAILED_ERROR}), 500
    if result['status'] == 'receiver_missing':
        return jsonify({'success': False, 'error': USER_NOT_FOUND_ERROR}), 404
    if result['status'] == 'blocked':
        return block_forbidden_response(BLOCKED_REQUEST_ERROR, result['block_state'])
    if result['status'] == 'auto_decline':
        return jsonify({'success': False, 'error': AUTO_DECLINE_REQUEST_ERROR}), 403
    if result['status'] == 'cooldown':
        retry_after = int(result.get('retry_after') or 0)
        payload = {'success': False, 'error': SEND_REQUEST_COOLDOWN_ERROR}
        if retry_after > 0:
            payload['retry_after'] = retry_after
        return jsonify(payload), 429

    event = result.get('event')
    if event:
        _emit_socket_event('new_dialog_request', event['payload'], room=event['room'])

    return jsonify({'success': True, 'message': REQUEST_SENT_MESSAGE})


@contacts_bp.route('/send_request_by_username', methods=['POST'])
@limiter.limit("15 per minute")
def send_request_by_username_route():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': AUTH_REQUIRED_ERROR}), 401

    data = request.get_json() or {}
    username = canonical_username(data.get('username'))
    if not username or not USERNAME_PATTERN.fullmatch(username):
        return jsonify({'success': False, 'error': INVALID_REQUEST_DATA_ERROR}), 400

    sender_user_id = int(session['user_id'])
    conn = get_db_connection()
    try:
        receiver_row = conn.execute(
            'SELECT id FROM users WHERE username = ? LIMIT 1',
            (username,),
        ).fetchone()
        if not receiver_row:
            return jsonify({'success': False, 'error': USER_NOT_FOUND_ERROR}), 404

        receiver_user_id = int(receiver_row['id'])
        if sender_user_id == receiver_user_id:
            return jsonify({'success': False, 'error': SELF_REQUEST_ERROR}), 400

        result = process_send_request(
            conn,
            sender_user_id=sender_user_id,
            receiver_user_id=receiver_user_id,
            send_dialog_request_workflow_func=send_dialog_request_workflow,
            normalize_block_state_func=normalize_block_state,
            build_block_state_func=build_block_state,
        )
    finally:
        conn.close()

    if result['status'] == 'db_error':
        return jsonify({'success': False, 'error': SEND_REQUEST_FAILED_ERROR}), 500
    if result['status'] == 'receiver_missing':
        return jsonify({'success': False, 'error': USER_NOT_FOUND_ERROR}), 404
    if result['status'] == 'blocked':
        return block_forbidden_response(BLOCKED_REQUEST_ERROR, result['block_state'])
    if result['status'] == 'auto_decline':
        return jsonify({'success': False, 'error': AUTO_DECLINE_REQUEST_ERROR}), 403
    if result['status'] == 'cooldown':
        retry_after = int(result.get('retry_after') or 0)
        payload = {'success': False, 'error': SEND_REQUEST_COOLDOWN_ERROR}
        if retry_after > 0:
            payload['retry_after'] = retry_after
        return jsonify(payload), 429

    event = result.get('event')
    if event:
        _emit_socket_event('new_dialog_request', event['payload'], room=event['room'])

    return jsonify({'success': True, 'message': REQUEST_SENT_MESSAGE})


@contacts_bp.route('/get_dialog_requests', methods=['GET'])
@limiter.limit("60 per minute")
def get_dialog_requests():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': AUTH_REQUIRED_ERROR}), 401

    user_id = session['user_id']
    conn = get_db_connection()
    result = process_get_dialog_requests(
        conn,
        user_id=user_id,
        fetch_pending_dialog_requests_for_user_func=fetch_pending_dialog_requests_for_user,
    )

    if result['status'] == 'error':
        conn.close()
        return jsonify({'success': False, 'error': DIALOG_REQUESTS_FETCH_FAILED_ERROR}), 500

    group_requests = fetch_pending_group_invite_requests_for_user(conn, user_id=int(user_id))
    conn.close()
    return jsonify({'success': True, 'dialog_requests': [*result['dialog_requests'], *group_requests]}), 200


@contacts_bp.route('/accept_request', methods=['POST'])
@limiter.limit("30 per minute")
def accept_request():
    if 'user_id' not in session:
        return jsonify({'success': False}), 401

    data = request.get_json() or {}
    user_id = session['user_id']

    conn = get_db_connection()
    request_kind = str(data.get('request_kind') or '').strip().lower()
    if request_kind == 'group_invite':
        request_id = parse_int(data.get('request_id'))
        if request_id is None or request_id <= 0:
            conn.close()
            return jsonify({'success': False, 'error': INVALID_REQUEST_DATA_ERROR}), 400

        processed_group = accept_group_invite_request(
            conn,
            request_id=int(request_id),
            invitee_user_id=int(user_id),
        )
        if processed_group['status'] == 'request_missing':
            conn.close()
            return jsonify({'success': False}), 404
        if processed_group['status'] == 'chat_missing':
            conn.close()
            return jsonify({'success': False, 'error': CHAT_NOT_FOUND_ERROR}), 404

        conn.commit()
        update_payload = {
            'request_kind': 'group_invite',
            'request_id': int(request_id),
            'action': 'accepted',
            'chat_id': str(processed_group['chat_id']),
        }
        my_public_key = str(session.get('public_key_pem') or '').strip()
        if my_public_key:
            _emit_socket_event('group_invite_request_updated', update_payload, room=my_public_key)

        inviter_row = conn.execute(
            '''
            SELECT public_key
            FROM users
            WHERE id = ?
            LIMIT 1
            ''',
            (int(processed_group['inviter_user_id']),),
        ).fetchone()
        inviter_public_key = str(inviter_row['public_key'] or '').strip() if inviter_row else ''
        if inviter_public_key:
            _emit_socket_event('group_invite_request_updated', update_payload, room=inviter_public_key)

        emit_group_event(
            conn,
            chat_id=str(processed_group['chat_id']),
            event_name='group_members_added',
            payload={
                'chat_id': str(processed_group['chat_id']),
                'added_member_ids': [int(user_id)],
            },
            socketio_emit_func=_emit_socket_event,
        )
        conn.close()
        return jsonify({'success': True, 'chat_id': str(processed_group['chat_id'])}), 200

    processed = process_accept_request_route(
        conn,
        receiver_user_id=user_id,
        data=data,
        process_accept_request_func=process_accept_request,
        accept_dialog_request_workflow_func=accept_dialog_request_workflow,
        normalize_block_state_func=normalize_block_state,
        build_block_state_func=build_block_state,
        generate_chat_id_func=generate_chat_id,
        default_chat_name=DEFAULT_PRIVATE_CHAT_NAME,
        build_accept_request_socket_events_func=build_accept_request_socket_events,
        get_safe_avatar_url_func=get_safe_avatar_url,
    )

    if processed['status'] == 'sender_missing':
        conn.close()
        return jsonify({'success': False, 'error': 'Sender not found'}), 404

    if processed['status'] == 'blocked':
        conn.close()
        return block_forbidden_response(ACCEPT_REQUEST_BLOCKED_ERROR, processed['block_state'])

    if processed['status'] == 'request_missing':
        conn.close()
        return jsonify({'success': False}), 404

    for event in processed['events']:
        _emit_socket_event(event['name'], event['payload'], room=event['room'])

    conn.close()
    return jsonify({'success': True, 'chat_id': processed['chat_id']}), 200


@contacts_bp.route('/decline_request', methods=['POST'])
@limiter.limit("30 per minute")
def decline_request():
    if 'user_id' not in session:
        return jsonify({'success': False}), 401

    data = request.get_json() or {}
    user_id = session['user_id']

    conn = get_db_connection()
    request_kind = str(data.get('request_kind') or '').strip().lower()
    if request_kind == 'group_invite':
        request_id = parse_int(data.get('request_id'))
        if request_id is None or request_id <= 0:
            conn.close()
            return jsonify({'success': False, 'error': INVALID_REQUEST_DATA_ERROR}), 400

        processed_group = decline_group_invite_request(
            conn,
            request_id=int(request_id),
            invitee_user_id=int(user_id),
        )
        if processed_group['status'] == 'request_missing':
            conn.close()
            return jsonify({'success': False}), 404

        conn.commit()
        update_payload = {
            'request_kind': 'group_invite',
            'request_id': int(request_id),
            'action': 'declined',
            'chat_id': str(processed_group['chat_id']),
        }
        my_public_key = str(session.get('public_key_pem') or '').strip()
        if my_public_key:
            _emit_socket_event('group_invite_request_updated', update_payload, room=my_public_key)

        inviter_row = conn.execute(
            '''
            SELECT public_key
            FROM users
            WHERE id = ?
            LIMIT 1
            ''',
            (int(processed_group['inviter_user_id']),),
        ).fetchone()
        inviter_public_key = str(inviter_row['public_key'] or '').strip() if inviter_row else ''
        if inviter_public_key:
            _emit_socket_event('group_invite_request_updated', update_payload, room=inviter_public_key)

        conn.close()
        return jsonify({'success': True}), 200

    processed = process_decline_request_route(
        conn,
        receiver_user_id=user_id,
        data=data,
        process_decline_request_func=process_decline_request,
        decline_dialog_request_workflow_func=decline_dialog_request_workflow,
        build_decline_request_socket_event_func=build_decline_request_socket_event,
        action='declined',
    )

    if processed['status'] == 'sender_missing':
        conn.close()
        return jsonify({'success': False}), 404

    event = processed['event']
    if event:
        _emit_socket_event(event['name'], event['payload'], room=event['room'])

    conn.close()
    return jsonify({'success': True}), 200
