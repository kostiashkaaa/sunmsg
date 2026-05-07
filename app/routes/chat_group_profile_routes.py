from __future__ import annotations

from flask import jsonify, request, session

from app.services.chat_members import CHAT_TYPE_GROUP, get_chat_type, is_chat_member
from app.services.group_chat_profile_service import build_group_chat_profile_payload


def register_chat_group_profile_routes(
    chat_bp,
    *,
    limiter,
    get_db_connection_func,
    is_effectively_online_func=None,
    get_safe_avatar_url_func=None,
):
    @chat_bp.route('/api/chats/group/info', methods=['GET'])
    @limiter.limit('120 per hour')
    def get_group_chat_info():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Authorization required.'}), 401

        user_id = int(session['user_id'])
        chat_id = str(request.args.get('chat_id') or '').strip()
        if not chat_id:
            return jsonify({'success': False, 'error': 'chat_id is required.'}), 400

        conn = get_db_connection_func()
        try:
            if get_chat_type(conn, chat_id) != CHAT_TYPE_GROUP:
                return jsonify({'success': False, 'error': 'Group chat not found.'}), 404
            if not is_chat_member(conn, user_id, chat_id):
                return jsonify({'success': False, 'error': 'Forbidden.'}), 403

            payload = build_group_chat_profile_payload(
                conn=conn,
                chat_id=chat_id,
                viewer_user_id=user_id,
                get_safe_avatar_url_func=get_safe_avatar_url_func,
                is_effectively_online_func=is_effectively_online_func,
            )
            if not payload:
                return jsonify({'success': False, 'error': 'Group chat not found.'}), 404
            return jsonify(payload), 200
        finally:
            conn.close()
