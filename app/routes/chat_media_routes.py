from flask import current_app, jsonify, request, send_from_directory, session, url_for

from app.db_backend import DatabaseError
from app.services.chat_media_service import (
    resolve_avatar_for_viewer,
    resolve_chat_media_access,
    upload_avatar_for_user,
    upload_chat_media_for_user,
)

_CHAT_MEDIA_MULTIPART_OVERHEAD_BYTES = 1024 * 1024


def register_chat_media_routes(
    chat_bp,
    *,
    logger,
    limiter,
    socketio,
    get_db_connection_func,
    is_valid_chat_id_func,
    ensure_chat_exists_func,
    scan_file_func,
    get_chat_partner_func,
    build_block_state_func,
    serialize_block_state_func,
    block_forbidden_response_func,
    list_visible_contact_public_keys_func,
    allowed_avatar_file_func,
    validate_avatar_magic_func,
    validate_chat_media_content_func,
    normalize_chat_media_mime_func,
    detect_chat_media_type_func,
    get_safe_avatar_url_func,
    chat_media_rate_limit_key_func,
    get_upload_folder_func,
    get_chat_media_folder_func,
    get_allowed_chat_media_extensions_func,
    get_max_avatar_size_func,
    get_max_chat_media_size_func,
    get_dangerous_inline_mime_prefixes_func,
    get_project_root_func,
):
    @chat_bp.route('/upload_avatar', methods=['POST'])
    @limiter.limit("10 per hour")
    def upload_avatar():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Необходимо войти.'}), 401
        if 'avatar' not in request.files:
            return jsonify({'success': False, 'error': 'Файл не найден.'}), 400

        user_id = session['user_id']
        conn = get_db_connection_func()
        try:
            result = upload_avatar_for_user(
                conn,
                user_id=user_id,
                uploaded_file=request.files.get('avatar'),
                upload_folder=get_upload_folder_func(),
                max_avatar_size=get_max_avatar_size_func(),
                allowed_file_func=allowed_avatar_file_func,
                validate_magic_func=validate_avatar_magic_func,
                list_visible_contact_public_keys_func=list_visible_contact_public_keys_func,
                socketio_emit_func=socketio.emit,
                own_public_key=str(session.get('public_key_pem') or ''),
                project_root=get_project_root_func(),
            )
            if result['status'] != 'ok':
                return jsonify({'success': False, 'error': result['error']}), result.get('code', 400)
            return jsonify({'success': True, 'avatar_url': result['avatar_url']}), 200
        finally:
            conn.close()

    @chat_bp.route('/upload_chat_media', methods=['POST'])
    @limiter.limit("120 per hour")
    def upload_chat_media():
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Необходимо войти в систему.'}), 401
        # Allow multipart envelope bytes so a valid chat media file is not rejected
        # by global MAX_CONTENT_LENGTH before route-level validation runs.
        request.max_content_length = int(get_max_chat_media_size_func()) + _CHAT_MEDIA_MULTIPART_OVERHEAD_BYTES
        if 'file' not in request.files:
            return jsonify({'success': False, 'error': 'Файл не найден.'}), 400

        uploaded = request.files['file']
        chat_id = (request.form.get('chat_id') or '').strip()
        if not chat_id:
            return jsonify({'success': False, 'error': 'Chat ID missing.'}), 400
        if not is_valid_chat_id_func(chat_id):
            return jsonify({'success': False, 'error': 'Invalid chat ID.'}), 400

        user_id = session['user_id']
        conn = get_db_connection_func()
        try:
            result = upload_chat_media_for_user(
                conn,
                user_id=user_id,
                chat_id=chat_id,
                uploaded_file=uploaded,
                chat_media_folder=get_chat_media_folder_func(),
                allowed_extensions=get_allowed_chat_media_extensions_func(),
                max_chat_media_size=get_max_chat_media_size_func(),
                validate_chat_media_content_func=validate_chat_media_content_func,
                get_chat_partner_func=get_chat_partner_func,
                build_block_state_func=build_block_state_func,
                serialize_block_state_func=serialize_block_state_func,
                ensure_chat_exists_func=ensure_chat_exists_func,
                normalize_chat_media_mime_func=normalize_chat_media_mime_func,
                detect_chat_media_type_func=detect_chat_media_type_func,
                scan_file_func=scan_file_func,
                av_scan_enabled=bool(current_app.config.get('CHAT_MEDIA_AV_SCAN_ENABLED', False)),
                av_fail_closed=bool(current_app.config.get('CHAT_MEDIA_AV_FAIL_CLOSED', False)),
                av_command_template=str(current_app.config.get('CHAT_MEDIA_AV_COMMAND') or ''),
                av_timeout_seconds=int(current_app.config.get('CHAT_MEDIA_AV_TIMEOUT_SECONDS', 20) or 20),
                av_scan_extensions=current_app.config.get('CHAT_MEDIA_AV_SCAN_EXTENSIONS') or (),
            )
            if result['status'] == 'forbidden':
                return jsonify({'success': False, 'error': result['error']}), result.get('code', 403)
            if result['status'] == 'blocked':
                return block_forbidden_response_func(result['error'], result['block_state'])
            if result['status'] != 'ok':
                if result['status'] in {'av_blocked', 'av_unavailable'}:
                    if result['status'] == 'av_blocked':
                        logger.warning(
                            'chat media blocked by AV scanner chat_id=%s user_id=%s signature=%s',
                            chat_id,
                            user_id,
                            result.get('signature') or 'unknown',
                        )
                    else:
                        logger.warning('chat media AV scan failed for chat_id=%s user_id=%s', chat_id, user_id)
                return jsonify({'success': False, 'error': result['error']}), result.get('code', 400)

            media_url = url_for('chat.get_chat_media', media_id=result['media_id'])
            return jsonify(
                {
                    'success': True,
                    'url': media_url,
                    'mime': result['mime'],
                    'media_type': result['media_type'],
                    'name': result['name'],
                    'size': result['size'],
                }
            ), 200
        except DatabaseError:
            return jsonify({'success': False, 'error': 'Ошибка сохранения файла.'}), 500
        finally:
            conn.close()

    @chat_bp.route('/chat_media/<int:media_id>', methods=['GET'])
    @limiter.limit("10000 per hour", key_func=chat_media_rate_limit_key_func)
    @limiter.limit("1200 per minute", key_func=chat_media_rate_limit_key_func)
    def get_chat_media(media_id: int):
        if 'user_id' not in session:
            return jsonify({'success': False, 'error': 'Необходимо войти в систему.'}), 401

        user_id = session['user_id']
        conn = get_db_connection_func()
        try:
            result = resolve_chat_media_access(
                conn,
                user_id=user_id,
                media_id=media_id,
                get_chat_partner_func=get_chat_partner_func,
                build_block_state_func=build_block_state_func,
                serialize_block_state_func=serialize_block_state_func,
                dangerous_inline_mime_prefixes=get_dangerous_inline_mime_prefixes_func(),
                cache_max_age_seconds=int(current_app.config.get('CHAT_MEDIA_CACHE_MAX_AGE_SECONDS', 3600) or 0),
            )
            if result['status'] == 'not_found':
                return jsonify({'success': False, 'error': 'Файл не найден.'}), 404
            if result['status'] == 'forbidden':
                return jsonify({'success': False, 'error': 'Доступ запрещен.'}), 403
            if result['status'] == 'blocked':
                return block_forbidden_response_func(
                    'Доступ к медиа запрещен: пользователь заблокирован.',
                    result['block_state'],
                )

            response = send_from_directory(
                get_chat_media_folder_func(),
                result['storage_name'],
                mimetype=result['mime_type'],
                as_attachment=result['serve_as_attachment'],
                max_age=result['cache_max_age'],
                conditional=True,
            )
            response.cache_control.private = True
            response.vary.add('Cookie')
            response.headers['X-Content-Type-Options'] = 'nosniff'
            return response
        finally:
            conn.close()

    @chat_bp.route('/get_avatar', methods=['GET'])
    def get_avatar():
        if 'user_id' not in session:
            return jsonify({'success': False}), 401

        viewer_id = session['user_id']
        target_uid = request.args.get('user_id')
        pub_key = request.args.get('public_key')

        conn = get_db_connection_func()
        try:
            result = resolve_avatar_for_viewer(
                conn,
                viewer_id=viewer_id,
                target_user_id=target_uid,
                target_public_key=pub_key,
                get_safe_avatar_url_func=get_safe_avatar_url_func,
            )
        finally:
            conn.close()

        if result['status'] == 'invalid':
            return jsonify({'success': False}), 400
        if result['status'] == 'not_found':
            return jsonify({'success': False}), 404
        return jsonify({'success': True, 'avatar_url': result['avatar_url']})
