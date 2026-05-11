from flask import jsonify, request, session

from app.db_backend import DatabaseError
from app.sockets.event_envelope import get_chat_update_difference, get_chat_update_state
from app.services.chat_history_service import (
    delete_chat_for_user,
    load_chat_history,
    mark_messages_as_read,
)


def register_chat_history_routes(
    chat_bp,
    *,
    logger,
    limiter,
    socketio_emit_func,
    get_db_connection_func,
    is_valid_chat_id_func,
    get_chat_partner_func,
    build_block_state_func,
    serialize_block_state_func,
    block_forbidden_response_func,
):
    @chat_bp.route('/get_chat_history', methods=['GET'])
    @limiter.limit("120 per minute")
    def get_chat_history():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Необходимо войти в систему.'}), 401

        chat_id = request.args.get('chat_id', '').strip()
        if not chat_id:
            return jsonify({'success': False, 'error': 'Chat identifier is missing.'}), 400
        if not is_valid_chat_id_func(chat_id):
            return jsonify({'success': False, 'error': 'Invalid chat_id format.'}), 400

        try:
            limit = int(request.args.get('limit', 40))
        except (TypeError, ValueError):
            limit = 40
        limit = max(1, min(limit, 100))

        before_id_raw = (request.args.get('before_id') or '').strip()
        before_id = None
        if before_id_raw:
            try:
                before_id = int(before_id_raw)
            except (TypeError, ValueError):
                return jsonify({'success': False, 'error': 'Invalid before_id.'}), 400
            if before_id <= 0:
                return jsonify({'success': False, 'error': 'Invalid before_id.'}), 400

        after_id_raw = (request.args.get('after_id') or '').strip()
        after_id = None
        if after_id_raw:
            try:
                after_id = int(after_id_raw)
            except (TypeError, ValueError):
                return jsonify({'success': False, 'error': 'Invalid after_id.'}), 400
            if after_id <= 0:
                return jsonify({'success': False, 'error': 'Invalid after_id.'}), 400

        if before_id is not None and after_id is not None:
            return jsonify({'success': False, 'error': 'before_id and after_id are mutually exclusive.'}), 400

        include_pins_raw = request.args.get('include_pins')
        if include_pins_raw is None:
            include_pins = before_id is None and after_id is None
        else:
            include_pins = str(include_pins_raw).strip().lower() in {'1', 'true', 'yes', 'on'}

        include_favorites_raw = request.args.get('include_favorites')
        if include_favorites_raw is None:
            include_favorites = before_id is None and after_id is None
        else:
            include_favorites = str(include_favorites_raw).strip().lower() in {'1', 'true', 'yes', 'on'}

        user_id = session['user_id']
        conn = get_db_connection_func()
        try:
            result = load_chat_history(
                conn,
                user_id=user_id,
                chat_id=chat_id,
                limit=limit,
                before_id=before_id,
                after_id=after_id,
                include_pins=include_pins,
                include_favorites=include_favorites,
                get_chat_partner_func=get_chat_partner_func,
                build_block_state_func=build_block_state_func,
                serialize_block_state_func=serialize_block_state_func,
                socketio_emit_func=socketio_emit_func,
            )
            if result['status'] == 'forbidden':
                return jsonify({'success': False, 'error': 'Чат не найден.'}), 403

            payload = result['payload']
            logger.debug(
                "get_chat_history: %s messages for uid=%s, before_id=%s, after_id=%s, limit=%s",
                len(payload.get('messages') or []),
                user_id,
                before_id,
                after_id,
                limit,
            )
            return jsonify(payload), 200
        except DatabaseError as exc:
            logger.error('get_chat_history error: %s', exc)
            return jsonify({'success': False, 'error': 'Ошибка сервера.'}), 500
        finally:
            conn.close()

    @chat_bp.route('/updates/state', methods=['GET'])
    @chat_bp.route('/api/updates/state', methods=['GET'])
    @limiter.limit("240 per minute")
    def get_updates_state():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Необходимо войти в систему.'}), 401

        chat_id = request.args.get('chat_id', '').strip()
        if not chat_id:
            return jsonify({'success': False, 'error': 'Chat identifier is missing.'}), 400
        if not is_valid_chat_id_func(chat_id):
            return jsonify({'success': False, 'error': 'Invalid chat_id format.'}), 400

        conn = get_db_connection_func()
        try:
            user_id = int(session['user_id'])
            if not get_chat_partner_func(conn, user_id, chat_id):
                return jsonify({'success': False, 'error': 'Чат не найден.'}), 403
            state = get_chat_update_state(conn, chat_id=chat_id)
            return jsonify({'success': True, **state}), 200
        except DatabaseError as exc:
            logger.error('get_updates_state error: %s', exc)
            return jsonify({'success': False, 'error': 'Ошибка сервера.'}), 500
        finally:
            conn.close()

    @chat_bp.route('/updates/difference', methods=['GET'])
    @chat_bp.route('/api/updates/difference', methods=['GET'])
    @limiter.limit("240 per minute")
    def get_updates_difference():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Необходимо войти в систему.'}), 401

        chat_id = request.args.get('chat_id', '').strip()
        if not chat_id:
            return jsonify({'success': False, 'error': 'Chat identifier is missing.'}), 400
        if not is_valid_chat_id_func(chat_id):
            return jsonify({'success': False, 'error': 'Invalid chat_id format.'}), 400

        try:
            from_pts = int(request.args.get('from_pts', 0))
        except (TypeError, ValueError):
            return jsonify({'success': False, 'error': 'Invalid from_pts.'}), 400
        if from_pts < 0:
            return jsonify({'success': False, 'error': 'Invalid from_pts.'}), 400

        try:
            limit = int(request.args.get('limit', 100))
        except (TypeError, ValueError):
            return jsonify({'success': False, 'error': 'Invalid limit.'}), 400

        conn = get_db_connection_func()
        try:
            user_id = int(session['user_id'])
            if not get_chat_partner_func(conn, user_id, chat_id):
                return jsonify({'success': False, 'error': 'Чат не найден.'}), 403
            diff = get_chat_update_difference(
                conn,
                chat_id=chat_id,
                from_pts=from_pts,
                limit=limit,
            )
            return jsonify({'success': True, **diff}), 200
        except DatabaseError as exc:
            logger.error('get_updates_difference error: %s', exc)
            return jsonify({'success': False, 'error': 'Ошибка сервера.'}), 500
        finally:
            conn.close()

    @chat_bp.route('/search_global_content', methods=['GET'])
    @limiter.limit("30 per minute")
    def search_global_content():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Необходимо войти в систему.'}), 401

        try:
            limit = int(request.args.get('limit', 1800))
        except (TypeError, ValueError):
            limit = 1800
        limit = max(200, min(limit, 4000))

        user_id = session['user_id']
        conn = get_db_connection_func()
        try:
            rows = conn.execute(
                '''
                WITH direct_chats AS (
                    SELECT
                        c.chat_id,
                        COALESCE(
                            NULLIF(c.contact_display_name, ''),
                            NULLIF(u.display_name, ''),
                            NULLIF(u.username, ''),
                            'Chat'
                        ) AS chat_title,
                        u.avatar_url AS chat_avatar_url
                    FROM contacts c
                    JOIN users u ON u.id = c.contact_id
                    WHERE c.user_id = ?
                ),
                group_chats AS (
                    SELECT
                        ch.chat_id,
                        COALESCE(NULLIF(ch.chat_name, ''), 'Group chat') AS chat_title,
                        ch.chat_avatar_url AS chat_avatar_url
                    FROM chat_members cm
                    JOIN chats ch ON ch.chat_id = cm.chat_id
                    WHERE cm.user_id = ?
                      AND COALESCE(NULLIF(ch.chat_type, ''), 'group') = 'group'
                ),
                visible_chats AS (
                    SELECT chat_id, chat_title, chat_avatar_url, 0 AS is_group
                    FROM direct_chats
                    UNION
                    SELECT chat_id, chat_title, chat_avatar_url, 1 AS is_group
                    FROM group_chats
                ),
                direct_messages AS (
                    SELECT
                        m.id,
                        m.chat_id,
                        m.sender_id,
                        m.message,
                        COALESCE(NULLIF(m.message_type, ''), 'text') AS message_type,
                        m.created_at,
                        m.reply_to_id
                    FROM messages m
                    JOIN visible_chats vc ON vc.chat_id = m.chat_id
                    WHERE vc.is_group = 0
                      AND (
                        (m.sender_id = ? AND m.deleted_by_sender = 0)
                        OR
                        (m.receiver_id = ? AND m.deleted_by_receiver = 0)
                      )
                ),
                group_messages AS (
                    SELECT
                        m.id,
                        m.chat_id,
                        m.sender_id,
                        m.message,
                        COALESCE(NULLIF(m.message_type, ''), 'text') AS message_type,
                        m.created_at,
                        m.reply_to_id
                    FROM messages m
                    JOIN visible_chats vc ON vc.chat_id = m.chat_id
                    JOIN message_receipts mr ON mr.message_id = m.id
                    WHERE vc.is_group = 1
                      AND mr.user_id = ?
                      AND mr.deleted_for_user = 0
                ),
                all_messages AS (
                    SELECT * FROM direct_messages
                    UNION ALL
                    SELECT * FROM group_messages
                )
                SELECT
                    am.id,
                    am.chat_id,
                    am.message,
                    am.message_type,
                    am.created_at,
                    am.reply_to_id,
                    rm.message AS reply_message,
                    ur.public_key AS reply_sender_pub,
                    us.id AS sender_user_id,
                    us.public_key AS sender_public_key,
                    COALESCE(NULLIF(us.display_name, ''), NULLIF(us.username, ''), 'Участник') AS sender_display_name,
                    COALESCE(us.username, '') AS sender_username,
                    us.avatar_url AS sender_avatar_url,
                    vc.chat_title,
                    vc.chat_avatar_url
                FROM all_messages am
                JOIN visible_chats vc ON vc.chat_id = am.chat_id
                LEFT JOIN users us ON us.id = am.sender_id
                LEFT JOIN messages rm ON rm.id = am.reply_to_id
                LEFT JOIN users ur ON ur.id = rm.sender_id
                ORDER BY am.id DESC
                LIMIT ?
                ''',
                (user_id, user_id, user_id, user_id, user_id, limit),
            ).fetchall()

            messages = [
                {
                    'id': int(row['id']),
                    'chat_id': row['chat_id'],
                    'message': row['message'],
                    'message_type': row['message_type'] or 'text',
                    'created_at': row['created_at'],
                    'reply_to_id': row['reply_to_id'],
                    'reply_message': row['reply_message'],
                    'reply_sender_pub': row['reply_sender_pub'],
                    'sender_user_id': row['sender_user_id'],
                    'sender_public_key': row['sender_public_key'],
                    'sender_display_name': row['sender_display_name'],
                    'sender_username': row['sender_username'],
                    'sender_avatar_url': row['sender_avatar_url'],
                    'chat_title': row['chat_title'],
                    'chat_avatar_url': row['chat_avatar_url'],
                }
                for row in rows
            ]
            return jsonify({'success': True, 'messages': messages}), 200
        except DatabaseError as exc:
            logger.error('search_global_content error: %s', exc)
            return jsonify({'success': False, 'error': 'Ошибка сервера.'}), 500
        finally:
            conn.close()

    @chat_bp.route('/mark_messages_read', methods=['POST'])
    @limiter.limit("180 per minute")
    def mark_messages_read():
        if 'user_id' not in session:
            return jsonify({'success': False}), 401

        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({'success': False}), 400
        chat_id = data.get('chat_id')
        if not chat_id:
            return jsonify({'success': False}), 400

        user_id = session['user_id']
        conn = get_db_connection_func()
        try:
            result = mark_messages_as_read(
                conn,
                user_id=user_id,
                chat_id=chat_id,
                get_chat_partner_func=get_chat_partner_func,
                build_block_state_func=build_block_state_func,
                serialize_block_state_func=serialize_block_state_func,
                socketio_emit_func=socketio_emit_func,
            )
            if result['status'] == 'forbidden':
                return jsonify({'success': False}), 403
            if result['status'] == 'blocked':
                return block_forbidden_response_func(
                    'Чат доступен только для чтения: пользователь заблокирован.',
                    result['block_state'],
                )
            return jsonify({'success': True}), 200
        except DatabaseError as exc:
            logger.error(exc)
            return jsonify({'success': False}), 500
        finally:
            conn.close()

    @chat_bp.route('/delete_chat', methods=['POST'])
    @limiter.limit("20 per minute")
    def delete_chat():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Необходимо войти в систему.'}), 401

        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({'success': False, 'error': 'Invalid payload.'}), 400
        chat_id = data.get('chat_id')
        mode = data.get('mode', 'for_me')

        if not chat_id:
            return jsonify({'success': False, 'error': 'Chat ID missing.'}), 400

        user_id = session['user_id']
        conn = None
        try:
            conn = get_db_connection_func()
            result = delete_chat_for_user(
                conn,
                user_id=user_id,
                chat_id=chat_id,
                mode=mode,
                socketio_emit_func=socketio_emit_func,
            )
            if result['status'] == 'forbidden':
                return jsonify({'success': False, 'error': 'Вы не участник этого чата.'}), 403
            return jsonify({'success': True}), 200
        except Exception:
            logger.exception('delete_chat error')
            return jsonify({'success': False, 'error': 'Ошибка сервера.'}), 500
        finally:
            if conn is not None:
                conn.close()
