from flask import jsonify, request, session

from app.database import get_db_connection
from app.extensions import limiter
from app.routes.blocking_handlers import (
    block_user_for_user,
    fetch_blocked_users_for_user,
    unblock_user_for_user,
)
from app.routes.blocking_route_handlers import (
    process_block_user,
    process_block_user_route,
    process_get_blocked_users,
    process_unblock_user,
    process_unblock_user_route,
)
from app.routes.contacts_utils import parse_int
from app.services.blocking import build_block_state, normalize_block_state

from .context import (
    AUTH_REQUIRED_ERROR,
    BLOCK_OPERATION_FAILED_ERROR,
    INVALID_BLOCKED_USER_ID_ERROR,
    USER_NOT_FOUND_ERROR,
    _emit_block_state_events,
    contacts_bp,
    logger,
)


@contacts_bp.route('/get_blocked_users')
@limiter.limit("60 per minute")
def get_blocked_users():
    if 'user_id' not in session:
        return jsonify({'error': AUTH_REQUIRED_ERROR}), 401

    user_id = session['user_id']
    conn = get_db_connection()
    result = process_get_blocked_users(
        conn,
        user_id=user_id,
        fetch_blocked_users_for_user_func=fetch_blocked_users_for_user,
    )
    conn.close()
    return jsonify({'blocked_users': result['blocked_users']})


@contacts_bp.route('/block_user', methods=['POST'])
@limiter.limit("20 per minute")
def block_user():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': AUTH_REQUIRED_ERROR}), 401

    data = request.get_json() or {}
    user_id = session['user_id']

    conn = get_db_connection()
    result = process_block_user_route(
        conn,
        user_id=user_id,
        data=data,
        parse_int_func=parse_int,
        process_block_user_func=process_block_user,
        block_user_for_user_func=block_user_for_user,
        normalize_block_state_func=normalize_block_state,
        build_block_state_func=build_block_state,
        emit_block_state_events_func=_emit_block_state_events,
        logger_exception_func=logger.exception,
    )
    if result['status'] == 'invalid_blocked_user_id':
        conn.close()
        return jsonify({'success': False, 'error': INVALID_BLOCKED_USER_ID_ERROR}), 400
    if result['status'] == 'self_block_forbidden':
        conn.close()
        return jsonify({'success': False}), 400
    if result['status'] == 'target_missing':
        conn.close()
        return jsonify({'success': False, 'error': USER_NOT_FOUND_ERROR}), 404
    if result['status'] == 'error':
        conn.close()
        return jsonify({'success': False, 'error': BLOCK_OPERATION_FAILED_ERROR}), 500

    conn.close()
    return jsonify({'success': True, 'block_state': result['block_state']})


@contacts_bp.route('/unblock_user', methods=['POST'])
@limiter.limit("20 per minute")
def unblock_user():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': AUTH_REQUIRED_ERROR}), 401

    data = request.get_json() or {}
    user_id = session['user_id']

    conn = get_db_connection()
    result = process_unblock_user_route(
        conn,
        user_id=user_id,
        data=data,
        parse_int_func=parse_int,
        process_unblock_user_func=process_unblock_user,
        unblock_user_for_user_func=unblock_user_for_user,
        normalize_block_state_func=normalize_block_state,
        build_block_state_func=build_block_state,
        emit_block_state_events_func=_emit_block_state_events,
    )
    if result['status'] == 'invalid_blocked_user_id':
        conn.close()
        return jsonify({'success': False, 'error': INVALID_BLOCKED_USER_ID_ERROR}), 400
    conn.close()
    return jsonify({'success': True, 'block_state': result['block_state']})
