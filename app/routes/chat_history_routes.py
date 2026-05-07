from flask import jsonify, request, session

from app.db_backend import DatabaseError
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
    socketio,
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
                socketio_emit_func=socketio.emit,
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
                socketio_emit_func=socketio.emit,
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
                socketio_emit_func=socketio.emit,
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
