from flask import jsonify, request, session


def register_chat_profile_routes(
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
):
    @chat_bp.route('/get_online_status', methods=['GET'])
    def get_online_status():
        if 'user_id' not in session:
            return jsonify({'success': False}), 401

        current_user_id = session['user_id']
        conn = get_db_connection_func()
        try:
            result = process_get_online_status_func(
                conn,
                current_user_id=current_user_id,
                target_raw=request.args.get('user_id'),
                parse_int_func=int,
                fetch_user_func=lambda db_conn, target_user_id: db_conn.execute(
                    'SELECT is_online, last_seen, public_key, hide_online_status, avatar_url, avatar_visibility FROM users WHERE id = ?',
                    (target_user_id,),
                ).fetchone(),
                has_contact_func=lambda db_conn, owner_user_id, target_user_id: db_conn.execute(
                    'SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ?',
                    (owner_user_id, target_user_id),
                ).fetchone() is not None,
                build_block_state_func=build_block_state_func,
                serialize_block_state_func=serialize_block_state_func,
                is_effectively_online_func=is_effectively_online_func,
                get_safe_avatar_url_func=get_safe_avatar_url_func,
            )

            if result['status'] == 'invalid_target':
                return jsonify({'success': False}), 400
            if result['status'] == 'not_found':
                return jsonify({'success': False}), 404
            if result['status'] == 'forbidden':
                return jsonify({'success': False}), 403
            if result['status'] == 'blocked':
                return block_forbidden_response_func('Status unavailable: user is blocked.', result['block_state'])

            return jsonify(result['payload'])
        finally:
            conn.close()

    @chat_bp.route('/get_user_profile', methods=['GET'])
    @limiter.limit("60 per minute")
    def get_user_profile():
        if 'user_id' not in session:
            return jsonify({'success': False}), 401

        uid = session['user_id']
        conn = get_db_connection_func()
        try:
            result = process_get_user_profile_func(
                conn,
                current_user_id=uid,
                target_raw=request.args.get('user_id'),
                parse_int_func=int,
                fetch_user_func=lambda db_conn, target_user_id: db_conn.execute(
                    'SELECT * FROM users WHERE id = ?',
                    (target_user_id,),
                ).fetchone(),
                has_contact_func=lambda db_conn, owner_user_id, target_user_id: db_conn.execute(
                    'SELECT 1 FROM contacts WHERE user_id = ? AND contact_id = ?',
                    (owner_user_id, target_user_id),
                ).fetchone() is not None,
                build_block_state_func=build_block_state_func,
                serialize_block_state_func=serialize_block_state_func,
                fetch_conversation_stats_func=fetch_conversation_stats_func,
                is_effectively_online_func=is_effectively_online_func,
                get_safe_avatar_url_func=get_safe_avatar_url_func,
            )

            if result['status'] == 'invalid_target':
                return jsonify({'success': False}), 400
            if result['status'] == 'not_found':
                return jsonify({'success': False}), 404

            return jsonify(result['payload'])
        finally:
            conn.close()

