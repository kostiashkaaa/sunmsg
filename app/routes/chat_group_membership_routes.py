from __future__ import annotations

from flask import jsonify, request, session

from app.routes.chat_group_events import emit_group_event
from app.services import moderation as moderation_service
from app.services.chat_members import (
    CHAT_TYPE_GROUP,
    get_chat_type,
    get_group_member_role,
    is_chat_member,
    list_chat_member_public_keys,
    normalize_group_role,
)
from app.services.group_authorization import (
    ACTION_BAN,
    ACTION_CHANGE_ROLE,
    ACTION_KICK,
)
from app.services.group_chat_membership_service import remove_group_member_with_cleanup


def register_chat_group_membership_routes(  # noqa: C901,PLR0915
    chat_bp,
    *,
    limiter,
    get_db_connection_func,
    socketio_emit_func,
    authorize_group_action_or_error_func,
):
    @chat_bp.route('/api/chats/group/set_role', methods=['POST'])
    @limiter.limit('60 per hour')
    def set_group_member_role():  # noqa: C901
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Authorization required.'}), 401

        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({'success': False, 'error': 'Invalid payload.'}), 400

        user_id = int(session['user_id'])
        chat_id = str(data.get('chat_id') or '').strip()
        target_user_id = int(data.get('target_user_id') or 0)
        next_role = normalize_group_role(data.get('role'))
        if not chat_id:
            return jsonify({'success': False, 'error': 'chat_id is required.'}), 400
        if target_user_id <= 0:
            return jsonify({'success': False, 'error': 'target_user_id is required.'}), 400
        if next_role not in {'owner', 'admin', 'moderator', 'member'}:
            return jsonify({'success': False, 'error': 'Invalid role.'}), 400

        conn = get_db_connection_func()
        try:
            if get_chat_type(conn, chat_id) != CHAT_TYPE_GROUP:
                return jsonify({'success': False, 'error': 'Group chat not found.'}), 404
            if not is_chat_member(conn, user_id, chat_id):
                return jsonify({'success': False, 'error': 'Forbidden.'}), 403
            actor_role = get_group_member_role(conn, user_id, chat_id)
            if not actor_role:
                return jsonify({'success': False, 'error': 'Forbidden.'}), 403

            target_row = conn.execute(
                '''
                SELECT role
                FROM chat_members
                WHERE user_id = ? AND chat_id = ?
                ''',
                (target_user_id, chat_id),
            ).fetchone()
            if not target_row:
                return jsonify({'success': False, 'error': 'Member not found.'}), 404

            current_role = normalize_group_role(target_row['role'])
            if current_role == next_role:
                return jsonify({'success': True, 'chat_id': chat_id, 'target_user_id': target_user_id, 'role': next_role}), 200

            if next_role == 'owner':
                if actor_role != 'owner':
                    return jsonify({'success': False, 'error': 'Only owner can transfer ownership.'}), 403
                if target_user_id == user_id:
                    return jsonify({'success': False, 'error': 'You already own this group.'}), 400
                conn.execute(
                    '''
                    UPDATE chat_members
                    SET role = 'admin'
                    WHERE user_id = ? AND chat_id = ? AND role = 'owner'
                    ''',
                    (user_id, chat_id),
                )
                conn.execute(
                    '''
                    UPDATE chat_members
                    SET role = 'owner'
                    WHERE user_id = ? AND chat_id = ?
                    ''',
                    (target_user_id, chat_id),
                )
            else:
                _, auth_error = authorize_group_action_or_error_func(
                    conn,
                    actor_user_id=user_id,
                    chat_id=chat_id,
                    action=ACTION_CHANGE_ROLE,
                    target_user_id=target_user_id,
                    next_role=next_role,
                    denied_message='Only owner/admin can manage roles.',
                )
                if auth_error:
                    return auth_error
                if current_role == 'owner':
                    return jsonify({'success': False, 'error': 'Owner role can only be transferred.'}), 400
                if actor_role != 'owner' and next_role == 'admin':
                    return jsonify({'success': False, 'error': 'Only owner can assign admin role.'}), 403
                conn.execute(
                    '''
                    UPDATE chat_members
                    SET role = ?
                    WHERE user_id = ? AND chat_id = ?
                    ''',
                    (next_role, target_user_id, chat_id),
                )
            conn.commit()

            payload = {
                'chat_id': chat_id,
                'target_user_id': target_user_id,
                'role': next_role,
            }
            emit_group_event(
                conn,
                chat_id=chat_id,
                event_name='group_members_updated',
                payload=payload,
                socketio_emit_func=socketio_emit_func,
            )
            return jsonify({'success': True, **payload}), 200
        finally:
            conn.close()

    @chat_bp.route('/api/chats/group/leave', methods=['POST'])
    @limiter.limit('30 per hour')
    def leave_group_chat():  # noqa: C901
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Authorization required.'}), 401

        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({'success': False, 'error': 'Invalid payload.'}), 400

        user_id = int(session['user_id'])
        chat_id = str(data.get('chat_id') or '').strip()
        if not chat_id:
            return jsonify({'success': False, 'error': 'chat_id is required.'}), 400

        conn = get_db_connection_func()
        try:
            if get_chat_type(conn, chat_id) != CHAT_TYPE_GROUP:
                return jsonify({'success': False, 'error': 'Group chat not found.'}), 404
            if not is_chat_member(conn, user_id, chat_id):
                return jsonify({'success': False, 'error': 'Forbidden.'}), 403

            role = get_group_member_role(conn, user_id, chat_id) or 'member'
            transferred_owner_id: int | None = None

            if role == 'owner':
                owners_row = conn.execute(
                    '''
                    SELECT COUNT(*) AS owners_count
                    FROM chat_members
                    WHERE chat_id = ? AND role = 'owner'
                    ''',
                    (chat_id,),
                ).fetchone()
                owners_count = int(owners_row['owners_count'] or 0) if owners_row else 0

                # If the leaving member is the only owner, we must either hand
                # ownership to a successor (admin → moderator → member, by
                # joined_at ASC) or dissolve the group if they are the last member.
                if owners_count <= 1:
                    members_total_row = conn.execute(
                        'SELECT COUNT(*) AS members_count FROM chat_members WHERE chat_id = ?',
                        (chat_id,),
                    ).fetchone()
                    members_total = int(members_total_row['members_count'] or 0) if members_total_row else 0

                    if members_total <= 1:
                        # The owner is alone in the group — dissolve the chat entirely.
                        member_pubkeys = [
                            str(row['public_key'] or '')
                            for row in list_chat_member_public_keys(conn, chat_id)
                            if row and row['public_key']
                        ]
                        conn.execute('DELETE FROM messages WHERE chat_id = ?', (chat_id,))
                        conn.execute('DELETE FROM chat_members WHERE chat_id = ?', (chat_id,))
                        conn.execute('DELETE FROM contacts WHERE chat_id = ?', (chat_id,))
                        conn.execute('DELETE FROM chats WHERE chat_id = ?', (chat_id,))
                        conn.commit()

                        deleted_payload = {'chat_id': chat_id}
                        socketio_emit_func('chat_deleted', deleted_payload, room=chat_id)
                        for pubkey in member_pubkeys:
                            socketio_emit_func('chat_deleted', deleted_payload, room=pubkey)

                        return jsonify({
                            'success': True,
                            'chat_id': chat_id,
                            'left_user_id': user_id,
                            'group_disbanded': True,
                        }), 200

                    # Otherwise pick a successor by role priority,
                    # and within a role, the longest-standing member.
                    successor_row = conn.execute(
                        '''
                        SELECT user_id
                        FROM chat_members
                        WHERE chat_id = ? AND user_id != ?
                        ORDER BY
                            CASE role
                                WHEN 'admin' THEN 0
                                WHEN 'moderator' THEN 1
                                ELSE 2
                            END,
                            joined_at ASC,
                            user_id ASC
                        LIMIT 1
                        ''',
                        (chat_id, user_id),
                    ).fetchone()
                    if successor_row and successor_row['user_id']:
                        transferred_owner_id = int(successor_row['user_id'])
                        conn.execute(
                            '''
                            UPDATE chat_members
                            SET role = 'owner'
                            WHERE chat_id = ? AND user_id = ?
                            ''',
                            (chat_id, transferred_owner_id),
                        )

            remove_group_member_with_cleanup(conn, chat_id=chat_id, user_id=user_id)
            conn.commit()

            payload = {
                'chat_id': chat_id,
                'left_user_id': user_id,
            }
            if transferred_owner_id:
                payload['new_owner_user_id'] = transferred_owner_id
            emit_group_event(
                conn,
                chat_id=chat_id,
                event_name='group_members_updated',
                payload=payload,
                socketio_emit_func=socketio_emit_func,
            )
            return jsonify({'success': True, **payload}), 200
        finally:
            conn.close()

    @chat_bp.route('/api/chats/group/remove_member', methods=['POST'])
    @limiter.limit('60 per hour')
    def remove_group_member():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Authorization required.'}), 401

        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({'success': False, 'error': 'Invalid payload.'}), 400

        actor_user_id = int(session['user_id'])
        chat_id = str(data.get('chat_id') or '').strip()
        target_user_id = int(data.get('target_user_id') or 0)
        if not chat_id:
            return jsonify({'success': False, 'error': 'chat_id is required.'}), 400
        if target_user_id <= 0:
            return jsonify({'success': False, 'error': 'target_user_id is required.'}), 400

        conn = get_db_connection_func()
        try:
            if get_chat_type(conn, chat_id) != CHAT_TYPE_GROUP:
                return jsonify({'success': False, 'error': 'Group chat not found.'}), 404
            if not is_chat_member(conn, actor_user_id, chat_id):
                return jsonify({'success': False, 'error': 'Forbidden.'}), 403

            _, auth_error = authorize_group_action_or_error_func(
                conn,
                actor_user_id=actor_user_id,
                chat_id=chat_id,
                action=ACTION_KICK,
                target_user_id=target_user_id,
                denied_message='Only owner/admin/moderator can remove members.',
            )
            if auth_error:
                return auth_error

            target_exists = is_chat_member(conn, target_user_id, chat_id)
            if not target_exists:
                return jsonify({'success': False, 'error': 'Member not found.'}), 404

            remove_group_member_with_cleanup(conn, chat_id=chat_id, user_id=target_user_id)
            conn.commit()

            payload = {
                'chat_id': chat_id,
                'removed_user_id': int(target_user_id),
                'removed_by_user_id': int(actor_user_id),
            }
            emit_group_event(
                conn,
                chat_id=chat_id,
                event_name='group_members_updated',
                payload=payload,
                socketio_emit_func=socketio_emit_func,
            )
            return jsonify({'success': True, **payload}), 200
        finally:
            conn.close()

    @chat_bp.route('/api/chats/group/sanctions', methods=['POST'])
    @limiter.limit('40 per hour')
    def apply_group_member_sanction():  # noqa: C901
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Authorization required.'}), 401

        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({'success': False, 'error': 'Invalid payload.'}), 400

        actor_user_id = int(session['user_id'])
        chat_id = str(data.get('chat_id') or '').strip()
        target_user_id = int(data.get('target_user_id') or 0)
        action_type = str(data.get('action_type') or '').strip().lower()
        reason_code = str(data.get('reason_code') or 'group_moderation').strip().lower()
        try:
            duration_seconds = int(data.get('duration_seconds') or 0)
        except (TypeError, ValueError):
            duration_seconds = -1
        note = str(data.get('note') or '').strip()
        if not chat_id:
            return jsonify({'success': False, 'error': 'chat_id is required.'}), 400
        if target_user_id <= 0:
            return jsonify({'success': False, 'error': 'target_user_id is required.'}), 400

        conn = get_db_connection_func()
        try:
            if get_chat_type(conn, chat_id) != CHAT_TYPE_GROUP:
                return jsonify({'success': False, 'error': 'Group chat not found.'}), 404
            if not is_chat_member(conn, actor_user_id, chat_id):
                return jsonify({'success': False, 'error': 'Forbidden.'}), 403
            _, auth_error = authorize_group_action_or_error_func(
                conn,
                actor_user_id=actor_user_id,
                chat_id=chat_id,
                action=ACTION_BAN,
                target_user_id=target_user_id,
                denied_message='Only owner/admin/moderator can apply sanctions.',
            )
            if auth_error:
                return auth_error
            if not is_chat_member(conn, target_user_id, chat_id):
                return jsonify({'success': False, 'error': 'Member not found.'}), 404
            result = moderation_service.apply_group_member_sanction(
                conn,
                chat_id=chat_id,
                target_user_id=target_user_id,
                moderator_user_id=actor_user_id,
                action_type=action_type,
                reason_code=reason_code,
                duration_seconds=duration_seconds,
                note=note,
            )

            if action_type in {'ban_temp', 'ban_perma'}:
                remove_group_member_with_cleanup(conn, chat_id=chat_id, user_id=target_user_id)
                conn.commit()

            payload = {
                'chat_id': chat_id,
                'target_user_id': int(target_user_id),
                'action_type': str(result['action_type']),
                'sanction_id': int(result['sanction_id']),
                'expires_at': result.get('expires_at'),
            }
            emit_group_event(
                conn,
                chat_id=chat_id,
                event_name='group_member_sanctioned',
                payload=payload,
                socketio_emit_func=socketio_emit_func,
            )
            return jsonify({'success': True, **payload}), 200
        except ValueError as exc:
            conn.rollback()
            return jsonify({'success': False, 'error': str(exc)}), 400
        except Exception:
            conn.rollback()
            return jsonify({'success': False, 'error': 'group_sanction_apply_failed'}), 500
        finally:
            conn.close()
