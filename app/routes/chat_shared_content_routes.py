from __future__ import annotations

from flask import jsonify, request, session

from app.db_backend import DatabaseError
from app.services.chat_shared_content_service import (
    load_shared_content_candidates,
    normalize_shared_content_type,
)


def _parse_positive_optional_int(raw_value, *, field_name: str):
    value_raw = str(raw_value or '').strip()
    if not value_raw:
        return None, None
    try:
        value = int(value_raw)
    except (TypeError, ValueError):
        return None, (jsonify({'success': False, 'error': f'Invalid {field_name}.'}), 400)
    if value <= 0:
        return None, (jsonify({'success': False, 'error': f'Invalid {field_name}.'}), 400)
    return value, None


def register_chat_shared_content_routes(
    chat_bp,
    *,
    logger,
    limiter,
    get_db_connection_func,
    is_valid_chat_id_func,
    get_chat_partner_func,
):
    @chat_bp.route('/api/chats/shared-content-candidates', methods=['GET'])
    @limiter.limit('120 per minute')
    def get_shared_content_candidates():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Authorization required.'}), 401

        chat_id = str(request.args.get('chat_id', '') or '').strip()
        if not chat_id:
            return jsonify({'success': False, 'error': 'Chat identifier is missing.'}), 400
        if not is_valid_chat_id_func(chat_id):
            return jsonify({'success': False, 'error': 'Invalid chat_id format.'}), 400

        try:
            limit = int(request.args.get('limit', 80))
        except (TypeError, ValueError):
            limit = 80
        limit = max(1, min(limit, 120))

        before_id, before_error = _parse_positive_optional_int(
            request.args.get('before_id', ''),
            field_name='before_id',
        )
        if before_error:
            return before_error

        conn = get_db_connection_func()
        try:
            result = load_shared_content_candidates(
                conn,
                user_id=int(session['user_id']),
                chat_id=chat_id,
                content_type=normalize_shared_content_type(request.args.get('type')),
                limit=limit,
                before_id=before_id,
                get_chat_partner_func=get_chat_partner_func,
            )
            if result['status'] == 'forbidden':
                return jsonify({'success': False, 'error': 'Chat not found.'}), 403
            return jsonify(result['payload']), 200
        except DatabaseError as exc:
            logger.error('get_shared_content_candidates error: %s', exc)
            return jsonify({'success': False, 'error': 'Server error.'}), 500
        finally:
            conn.close()
