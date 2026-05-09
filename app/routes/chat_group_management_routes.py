from __future__ import annotations

import os
import uuid

from flask import jsonify, request, session
from werkzeug.utils import secure_filename

from app.routes.chat_group_common import (
    MAX_GROUP_DESCRIPTION_LENGTH,
    MAX_GROUP_TITLE_LENGTH,
    new_group_chat_id,
    normalize_group_description,
    normalize_member_ids,
)
from app.routes.chat_group_events import emit_group_event, emit_group_snapshot
from app.services import moderation as moderation_service
from app.services.chat_members import (
    CHAT_TYPE_GROUP,
    ensure_chat_members,
    get_chat_type,
    is_chat_member,
    list_chat_member_public_keys,
)
from app.services.chat_media_service import delete_file_quietly
from app.services.group_invite_requests import (
    build_group_invite_request_payload,
    ensure_group_invite_request,
    should_route_group_invite_to_request,
)
from app.services.group_authorization import ACTION_CHANGE_SETTINGS, ACTION_INVITE


def register_chat_group_management_routes(
    chat_bp,
    *,
    limiter,
    get_db_connection_func,
    socketio_emit_func,
    authorize_group_action_or_error_func,
    allowed_avatar_file_func=None,
    validate_avatar_magic_func=None,
    get_upload_folder_func=None,
    get_project_root_func=None,
    get_max_avatar_size_func=None,
):
    @chat_bp.route('/api/chats/group/create', methods=['POST'])
    @limiter.limit('20 per hour')
    def create_group_chat():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Authorization required.'}), 401

        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({'success': False, 'error': 'Invalid payload.'}), 400

        creator_id = int(session['user_id'])
        title = str(data.get('title') or '').strip()
        if len(title) < 2 or len(title) > MAX_GROUP_TITLE_LENGTH:
            return jsonify({'success': False, 'error': 'Group title must be between 2 and 120 characters.'}), 400
        description = normalize_group_description(data.get('description'))
        if len(description) > MAX_GROUP_DESCRIPTION_LENGTH:
            return jsonify({'success': False, 'error': 'Group description is too long.'}), 400

        requested_member_ids = normalize_member_ids(data.get('member_user_ids'))
        requested_member_ids = [uid for uid in requested_member_ids if uid != creator_id]
        if not requested_member_ids:
            return jsonify({'success': False, 'error': 'At least one member is required.'}), 400

        conn = get_db_connection_func()
        try:
            placeholders = ', '.join('?' * len(requested_member_ids))
            rows = conn.execute(
                f'''
                SELECT id, public_key
                FROM users
                WHERE id IN ({placeholders})
                ''',
                tuple(requested_member_ids),
            ).fetchall()
            member_ids = sorted({int(row['id']) for row in rows})
            if len(member_ids) != len(requested_member_ids):
                return jsonify({'success': False, 'error': 'Some members were not found.'}), 404

            public_key_by_user_id = {
                int(row['id']): str(row['public_key'] or '').strip()
                for row in rows
            }
            auto_add_member_ids: list[int] = []
            requested_member_ids: list[int] = []
            for candidate_user_id in member_ids:
                if should_route_group_invite_to_request(
                    conn,
                    inviter_user_id=creator_id,
                    invitee_user_id=int(candidate_user_id),
                ):
                    requested_member_ids.append(int(candidate_user_id))
                else:
                    auto_add_member_ids.append(int(candidate_user_id))

            chat_id = new_group_chat_id(creator_user_id=creator_id)
            conn.execute(
                '''
                INSERT INTO chats (chat_id, chat_name, chat_type, chat_description, created_by_user_id)
                VALUES (?, ?, ?, ?, ?)
                ''',
                (chat_id, title, CHAT_TYPE_GROUP, description, creator_id),
            )
            ensure_chat_members(
                conn,
                chat_id,
                [creator_id],
                role='owner',
                added_by_user_id=creator_id,
            )
            ensure_chat_members(
                conn,
                chat_id,
                auto_add_member_ids,
                role='member',
                added_by_user_id=creator_id,
            )
            created_request_ids: dict[int, int] = {}
            for candidate_user_id in requested_member_ids:
                request_id = ensure_group_invite_request(
                    conn,
                    chat_id=chat_id,
                    inviter_user_id=creator_id,
                    invitee_user_id=int(candidate_user_id),
                )
                if request_id > 0:
                    created_request_ids[int(candidate_user_id)] = int(request_id)
            conn.commit()

            creator_pub = str(session.get('public_key_pem') or '').strip()
            payload = {
                'chat_id': chat_id,
                'chat_name': title,
                'chat_description': description,
                'chat_avatar_url': '',
                'chat_type': CHAT_TYPE_GROUP,
                'members_count': len(auto_add_member_ids) + 1,
            }
            if creator_pub:
                socketio_emit_func('group_chat_created', payload, room=creator_pub)
            for member in list_chat_member_public_keys(conn, chat_id, exclude_user_id=creator_id):
                member_pub = str(member['public_key'] or '')
                if member_pub:
                    socketio_emit_func('group_chat_created', payload, room=member_pub)
            for requested_user_id, request_id in created_request_ids.items():
                target_pub = public_key_by_user_id.get(int(requested_user_id), '')
                if not target_pub:
                    continue
                request_payload = build_group_invite_request_payload(conn, request_id=request_id)
                if request_payload:
                    socketio_emit_func('new_group_invite_request', request_payload, room=target_pub)

            return jsonify(
                {
                    'success': True,
                    'chat_id': chat_id,
                    'chat_name': title,
                    'chat_description': description,
                    'chat_avatar_url': '',
                    'chat_type': CHAT_TYPE_GROUP,
                    'members_count': len(auto_add_member_ids) + 1,
                    'requested_member_ids': requested_member_ids,
                }
            ), 201
        finally:
            conn.close()

    @chat_bp.route('/api/chats/group/add_members', methods=['POST'])
    @limiter.limit('40 per hour')
    def add_group_members():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Authorization required.'}), 401

        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({'success': False, 'error': 'Invalid payload.'}), 400

        user_id = int(session['user_id'])
        chat_id = str(data.get('chat_id') or '').strip()
        if not chat_id:
            return jsonify({'success': False, 'error': 'chat_id is required.'}), 400

        member_ids = normalize_member_ids(data.get('member_user_ids'))
        member_ids = [mid for mid in member_ids if mid != user_id]
        if not member_ids:
            return jsonify({'success': False, 'error': 'No members to add.'}), 400

        conn = get_db_connection_func()
        try:
            if get_chat_type(conn, chat_id) != CHAT_TYPE_GROUP:
                return jsonify({'success': False, 'error': 'Group chat not found.'}), 404
            if not is_chat_member(conn, user_id, chat_id):
                return jsonify({'success': False, 'error': 'Forbidden.'}), 403
            _, auth_error = authorize_group_action_or_error_func(
                conn,
                actor_user_id=user_id,
                chat_id=chat_id,
                action=ACTION_INVITE,
                denied_message='Only owner/admin/moderator can add members.',
            )
            if auth_error:
                return auth_error

            placeholders = ', '.join('?' * len(member_ids))
            rows = conn.execute(
                f'''
                SELECT id, public_key
                FROM users
                WHERE id IN ({placeholders})
                ''',
                tuple(member_ids),
            ).fetchall()
            resolved_ids = sorted({int(row['id']) for row in rows})
            if len(resolved_ids) != len(member_ids):
                return jsonify({'success': False, 'error': 'Some members were not found.'}), 404
            public_key_by_user_id = {
                int(row['id']): str(row['public_key'] or '').strip()
                for row in rows
            }

            for candidate_user_id in resolved_ids:
                restriction = moderation_service.active_group_restriction(
                    conn,
                    chat_id=chat_id,
                    user_id=int(candidate_user_id),
                )
                if restriction and str(restriction.get('action_type') or '').strip().lower() in {'ban_temp', 'ban_perma'}:
                    return jsonify(
                        {
                            'success': False,
                            'error': 'User has an active group ban and cannot be invited yet.',
                            'target_user_id': int(candidate_user_id),
                            'restriction': restriction,
                        }
                    ), 403

            auto_add_ids: list[int] = []
            request_only_ids: list[int] = []
            for candidate_user_id in resolved_ids:
                if should_route_group_invite_to_request(
                    conn,
                    inviter_user_id=user_id,
                    invitee_user_id=int(candidate_user_id),
                ):
                    request_only_ids.append(int(candidate_user_id))
                else:
                    auto_add_ids.append(int(candidate_user_id))

            if auto_add_ids:
                ensure_chat_members(
                    conn,
                    chat_id,
                    auto_add_ids,
                    role='member',
                    added_by_user_id=user_id,
                )

            created_request_ids: dict[int, int] = {}
            for candidate_user_id in request_only_ids:
                request_id = ensure_group_invite_request(
                    conn,
                    chat_id=chat_id,
                    inviter_user_id=user_id,
                    invitee_user_id=int(candidate_user_id),
                )
                if request_id > 0:
                    created_request_ids[int(candidate_user_id)] = int(request_id)
            conn.commit()

            if auto_add_ids:
                payload = {
                    'chat_id': chat_id,
                    'added_member_ids': auto_add_ids,
                }
                emit_group_event(
                    conn,
                    chat_id=chat_id,
                    event_name='group_members_added',
                    payload=payload,
                    socketio_emit_func=socketio_emit_func,
                )
            for requested_user_id, request_id in created_request_ids.items():
                target_pub = public_key_by_user_id.get(int(requested_user_id), '')
                if not target_pub:
                    continue
                request_payload = build_group_invite_request_payload(conn, request_id=request_id)
                if request_payload:
                    socketio_emit_func('new_group_invite_request', request_payload, room=target_pub)

            return jsonify(
                {
                    'success': True,
                    'chat_id': chat_id,
                    'added_member_ids': auto_add_ids,
                    'requested_member_ids': request_only_ids,
                }
            ), 200
        finally:
            conn.close()

    @chat_bp.route('/api/chats/group/update', methods=['POST'])
    @limiter.limit('40 per hour')
    def update_group_chat():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Authorization required.'}), 401

        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({'success': False, 'error': 'Invalid payload.'}), 400

        user_id = int(session['user_id'])
        chat_id = str(data.get('chat_id') or '').strip()
        if not chat_id:
            return jsonify({'success': False, 'error': 'chat_id is required.'}), 400

        has_title = 'title' in data
        has_description = 'description' in data
        if not has_title and not has_description:
            return jsonify({'success': False, 'error': 'Nothing to update.'}), 400

        title = str(data.get('title') or '').strip() if has_title else None
        if has_title and (len(title) < 2 or len(title) > MAX_GROUP_TITLE_LENGTH):
            return jsonify({'success': False, 'error': 'Group title must be between 2 and 120 characters.'}), 400

        description = normalize_group_description(data.get('description')) if has_description else None
        if has_description and len(description) > MAX_GROUP_DESCRIPTION_LENGTH:
            return jsonify({'success': False, 'error': 'Group description is too long.'}), 400

        conn = get_db_connection_func()
        try:
            if get_chat_type(conn, chat_id) != CHAT_TYPE_GROUP:
                return jsonify({'success': False, 'error': 'Group chat not found.'}), 404
            if not is_chat_member(conn, user_id, chat_id):
                return jsonify({'success': False, 'error': 'Forbidden.'}), 403
            _, auth_error = authorize_group_action_or_error_func(
                conn,
                actor_user_id=user_id,
                chat_id=chat_id,
                action=ACTION_CHANGE_SETTINGS,
                denied_message='Only owner/admin can change group settings.',
            )
            if auth_error:
                return auth_error

            updates = []
            params = []
            if has_title:
                updates.append('chat_name = ?')
                params.append(title)
            if has_description:
                updates.append('chat_description = ?')
                params.append(description)
            if updates:
                params.append(chat_id)
                conn.execute(
                    f'''
                    UPDATE chats
                    SET {', '.join(updates)}
                    WHERE chat_id = ?
                    ''',
                    tuple(params),
                )
            conn.commit()

            chat_row = conn.execute(
                '''
                SELECT chat_name, chat_description, chat_avatar_url
                FROM chats
                WHERE chat_id = ?
                ''',
                (chat_id,),
            ).fetchone()
            emit_group_snapshot(conn, chat_id=chat_id, socketio_emit_func=socketio_emit_func)

            return jsonify(
                {
                    'success': True,
                    'chat_id': chat_id,
                    'chat_name': str(chat_row['chat_name'] or ''),
                    'chat_description': str(chat_row['chat_description'] or ''),
                    'chat_avatar_url': str(chat_row['chat_avatar_url'] or ''),
                }
            ), 200
        finally:
            conn.close()

    @chat_bp.route('/api/chats/group/upload_avatar', methods=['POST'])
    @limiter.limit('20 per hour')
    def upload_group_avatar():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Authorization required.'}), 401
        if 'avatar' not in request.files:
            return jsonify({'success': False, 'error': 'Avatar file not found.'}), 400
        if not callable(get_upload_folder_func) or not callable(get_project_root_func):
            return jsonify({'success': False, 'error': 'Avatar upload is unavailable.'}), 503

        chat_id = str(request.form.get('chat_id') or '').strip()
        if not chat_id:
            return jsonify({'success': False, 'error': 'chat_id is required.'}), 400

        user_id = int(session['user_id'])
        uploaded_file = request.files.get('avatar')
        if not uploaded_file or uploaded_file.filename == '':
            return jsonify({'success': False, 'error': 'Avatar file not found.'}), 400
        if not callable(allowed_avatar_file_func) or not allowed_avatar_file_func(uploaded_file.filename):
            return jsonify({'success': False, 'error': 'Unsupported file format.'}), 400

        ext = str(uploaded_file.filename).rsplit('.', 1)[1].lower()
        if callable(validate_avatar_magic_func) and not validate_avatar_magic_func(uploaded_file, ext):
            return jsonify({'success': False, 'error': 'File signature mismatch.'}), 400

        max_size = int(get_max_avatar_size_func() or 4 * 1024 * 1024) if callable(get_max_avatar_size_func) else 4 * 1024 * 1024
        uploaded_file.stream.seek(0, os.SEEK_END)
        size = uploaded_file.stream.tell()
        uploaded_file.stream.seek(0)
        if size > max_size:
            return jsonify({'success': False, 'error': 'Avatar file is too large.'}), 400

        conn = get_db_connection_func()
        try:
            if get_chat_type(conn, chat_id) != CHAT_TYPE_GROUP:
                return jsonify({'success': False, 'error': 'Group chat not found.'}), 404
            if not is_chat_member(conn, user_id, chat_id):
                return jsonify({'success': False, 'error': 'Forbidden.'}), 403
            _, auth_error = authorize_group_action_or_error_func(
                conn,
                actor_user_id=user_id,
                chat_id=chat_id,
                action=ACTION_CHANGE_SETTINGS,
                denied_message='Only owner/admin can change group settings.',
            )
            if auth_error:
                return auth_error

            old_row = conn.execute(
                '''
                SELECT chat_avatar_url
                FROM chats
                WHERE chat_id = ?
                ''',
                (chat_id,),
            ).fetchone()
            old_avatar_url = str(old_row['chat_avatar_url'] or '').strip() if old_row else ''

            safe_ext = secure_filename(ext).strip('.') or 'png'
            filename = f'group_{chat_id[:12]}_{uuid.uuid4().hex}.{safe_ext}'
            upload_folder = get_upload_folder_func()
            os.makedirs(upload_folder, exist_ok=True)
            filepath = os.path.join(upload_folder, filename)
            uploaded_file.save(filepath)
            avatar_url = f'/static/avatars/{filename}'

            conn.execute(
                '''
                UPDATE chats
                SET chat_avatar_url = ?
                WHERE chat_id = ?
                ''',
                (avatar_url, chat_id),
            )
            conn.commit()

            if old_avatar_url:
                old_path = os.path.join(get_project_root_func(), old_avatar_url.lstrip('/'))
                delete_file_quietly(old_path)

            emit_group_snapshot(conn, chat_id=chat_id, socketio_emit_func=socketio_emit_func)
            return jsonify({'success': True, 'chat_id': chat_id, 'chat_avatar_url': avatar_url}), 200
        finally:
            conn.close()
