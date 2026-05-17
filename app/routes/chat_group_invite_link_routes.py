from __future__ import annotations

from flask import jsonify, request, session

from app.routes.trust_limits import trust_ramped_limit
from app.services.chat_members import get_chat_type, is_chat_member, CHAT_TYPE_GROUP
from app.services.group_authorization import ACTION_CHANGE_SETTINGS
from app.services.group_invite_links import (
    create_invite_link,
    get_active_invite_link,
    revoke_invite_links,
    resolve_invite_link,
    consume_invite_link,
)
from app.services.crypto import is_valid_chat_id


def register_chat_group_invite_link_routes(
    chat_bp,
    *,
    limiter,
    get_db_connection_func,
    socketio_emit_func,
    authorize_group_action_or_error_func,
):
    group_mutation_rate_limit = trust_ramped_limit(
        get_db_connection_func=get_db_connection_func,
        standard_rule='20 per hour',
        limited_config_key='TRUST_RAMP_GROUP_MUTATION_LIMIT',
        limited_default_rule='10 per hour',
    )

    @chat_bp.route('/api/chats/group/invite-link', methods=['GET'])
    @limiter.limit('60 per minute')
    def get_group_invite_link():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Authorization required.'}), 401
        chat_id = str(request.args.get('chat_id') or '').strip()
        if not chat_id or not is_valid_chat_id(chat_id):
            return jsonify({'success': False, 'error': 'Invalid chat_id.'}), 400
        user_id = int(session['user_id'])
        conn = get_db_connection_func()
        try:
            if not is_chat_member(conn, user_id, chat_id):
                return jsonify({'success': False, 'error': 'Not a member.'}), 403
            link = get_active_invite_link(conn, chat_id)
        finally:
            conn.close()
        return jsonify({'success': True, 'link': link})

    @chat_bp.route('/api/chats/group/invite-link', methods=['POST'])
    @limiter.limit(group_mutation_rate_limit)
    def create_group_invite_link():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Authorization required.'}), 401
        data = request.get_json(silent=True) or {}
        chat_id = str(data.get('chat_id') or '').strip()
        if not chat_id or not is_valid_chat_id(chat_id):
            return jsonify({'success': False, 'error': 'Invalid chat_id.'}), 400
        user_id = int(session['user_id'])

        max_uses_raw = data.get('max_uses')
        max_uses = None
        if max_uses_raw is not None:
            try:
                max_uses = int(max_uses_raw)
                if max_uses <= 0:
                    max_uses = None
            except (TypeError, ValueError):
                pass

        expires_in_hours_raw = data.get('expires_in_hours')
        expires_in_hours = None
        if expires_in_hours_raw is not None:
            try:
                expires_in_hours = int(expires_in_hours_raw)
                if expires_in_hours <= 0:
                    expires_in_hours = None
            except (TypeError, ValueError):
                pass

        conn = get_db_connection_func()
        try:
            if get_chat_type(conn, chat_id) != CHAT_TYPE_GROUP:
                return jsonify({'success': False, 'error': 'Not a group chat.'}), 400
            _, auth_error = authorize_group_action_or_error_func(
                conn, actor_user_id=user_id, chat_id=chat_id, action=ACTION_CHANGE_SETTINGS
            )
            if auth_error:
                return auth_error
            link = create_invite_link(
                conn,
                chat_id=chat_id,
                created_by=user_id,
                max_uses=max_uses,
                expires_in_hours=expires_in_hours,
            )
            conn.commit()
        finally:
            conn.close()
        return jsonify({'success': True, 'link': link})

    @chat_bp.route('/api/chats/group/invite-link/revoke', methods=['POST'])
    @limiter.limit(group_mutation_rate_limit)
    def revoke_group_invite_link():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Authorization required.'}), 401
        data = request.get_json(silent=True) or {}
        chat_id = str(data.get('chat_id') or '').strip()
        if not chat_id or not is_valid_chat_id(chat_id):
            return jsonify({'success': False, 'error': 'Invalid chat_id.'}), 400
        user_id = int(session['user_id'])
        conn = get_db_connection_func()
        try:
            _, auth_error = authorize_group_action_or_error_func(
                conn, actor_user_id=user_id, chat_id=chat_id, action=ACTION_CHANGE_SETTINGS
            )
            if auth_error:
                return auth_error
            revoke_invite_links(conn, chat_id)
            conn.commit()
        finally:
            conn.close()
        return jsonify({'success': True})

    @chat_bp.route('/api/join/<token>', methods=['GET'])
    @limiter.limit('60 per minute')
    def preview_group_invite_link(token):
        token = str(token or '').strip()
        if not token:
            return jsonify({'success': False, 'error': 'Invalid link.'}), 404
        conn = get_db_connection_func()
        try:
            link = resolve_invite_link(conn, token)
        finally:
            conn.close()
        if not link:
            return jsonify({'success': False, 'error': 'Link is expired or invalid.'}), 404
        return jsonify({
            'success': True,
            'chat_name': link['chat_name'],
            'chat_avatar_url': link.get('chat_avatar_url'),
            'chat_description': link.get('chat_description') or '',
            'member_count': link.get('member_count', 0),
            'token': token,
        })

    @chat_bp.route('/api/join/<token>', methods=['POST'])
    @limiter.limit('10 per minute')
    def join_via_invite_link(token):
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Authorization required.'}), 401
        token = str(token or '').strip()
        if not token:
            return jsonify({'success': False, 'error': 'Invalid link.'}), 404
        user_id = int(session['user_id'])
        conn = get_db_connection_func()
        try:
            result = consume_invite_link(conn, token, user_id)
            if not result:
                return jsonify({'success': False, 'error': 'Link is expired, invalid, or has reached its usage limit.'}), 404
            conn.commit()
            chat_id = result['chat_id']
            already_member = result.get('already_member', False)
            if not already_member:
                socketio_emit_func('group_member_joined', {
                    'chat_id': chat_id,
                    'user_id': user_id,
                }, room=chat_id)
        finally:
            conn.close()
        return jsonify({'success': True, 'chat_id': chat_id, 'already_member': already_member})
