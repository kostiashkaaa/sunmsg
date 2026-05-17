from flask import jsonify, request, session

from app.services.spotify import get_public_listening_status as _spotify_get_status


def _unauthorized_response():
    return jsonify({'success': False}), 401


def _fetch_presence_row(db_conn, target_user_id):
    return db_conn.execute(
        'SELECT is_online, last_seen, public_key, hide_online_status, avatar_url, avatar_visibility FROM users WHERE id = ?',
        (target_user_id,),
    ).fetchone()


def _fetch_user_row(db_conn, target_user_id):
    return db_conn.execute(
        'SELECT * FROM users WHERE id = ?',
        (target_user_id,),
    ).fetchone()


def _has_contact(db_conn, owner_user_id, target_user_id):
    return (
        db_conn.execute(
            'SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ?',
            (owner_user_id, target_user_id),
        ).fetchone()
        is not None
    )


def _response_for_online_status(result, *, block_forbidden_response_func):
    status = result.get('status')
    if status == 'invalid_target':
        return jsonify({'success': False}), 400
    if status == 'not_found':
        return jsonify({'success': False}), 404
    if status == 'forbidden':
        return jsonify({'success': False}), 403
    if status == 'blocked':
        return block_forbidden_response_func(
            'Status unavailable: user is blocked.',
            result['block_state'],
        )
    return jsonify(result['payload'])


def _response_for_user_profile(result):
    status = result.get('status')
    if status == 'invalid_target':
        return jsonify({'success': False}), 400
    if status == 'not_found':
        return jsonify({'success': False}), 404
    return jsonify(result['payload'])


def register_chat_profile_routes(  # noqa: PLR0913
    chat_bp,
    *,
    limiter,
    get_db_connection_func,
    process_get_online_status_func,
    process_get_user_profile_func,
    build_block_state_func,
    serialize_block_state_func,
    block_forbidden_response_func,
    is_effectively_online_func,
    get_safe_avatar_url_func,
    fetch_conversation_stats_func,
) -> None:
    @chat_bp.route('/get_online_status', methods=['GET'])
    def get_online_status():
        if 'user_id' not in session:
            return _unauthorized_response()

        current_user_id = session['user_id']
        conn = get_db_connection_func()
        try:
            result = process_get_online_status_func(
                conn,
                current_user_id=current_user_id,
                target_raw=request.args.get('user_id'),
                parse_int_func=int,
                fetch_user_func=_fetch_presence_row,
                has_contact_func=_has_contact,
                build_block_state_func=build_block_state_func,
                serialize_block_state_func=serialize_block_state_func,
                is_effectively_online_func=is_effectively_online_func,
                get_safe_avatar_url_func=get_safe_avatar_url_func,
            )
            return _response_for_online_status(
                result,
                block_forbidden_response_func=block_forbidden_response_func,
            )
        finally:
            conn.close()

    @chat_bp.route('/get_user_profile', methods=['GET'])
    @limiter.limit("60 per minute")
    def get_user_profile():
        if 'user_id' not in session:
            return _unauthorized_response()

        uid = session['user_id']
        conn = get_db_connection_func()
        try:
            result = process_get_user_profile_func(
                conn,
                current_user_id=uid,
                target_raw=request.args.get('user_id'),
                parse_int_func=int,
                fetch_user_func=_fetch_user_row,
                has_contact_func=_has_contact,
                build_block_state_func=build_block_state_func,
                serialize_block_state_func=serialize_block_state_func,
                fetch_conversation_stats_func=fetch_conversation_stats_func,
                is_effectively_online_func=is_effectively_online_func,
                get_safe_avatar_url_func=get_safe_avatar_url_func,
                get_spotify_status_func=_spotify_get_status,
            )
            return _response_for_user_profile(result)
        finally:
            conn.close()
