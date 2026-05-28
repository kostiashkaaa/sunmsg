import os
import uuid

from app.db_backend import DatabaseError
from app.services.av_scan import AVScanError
from app.services.image_sanitizer import (
    ImageSanitizationError,
    is_sanitizable_extension,
    sanitize_inplace,
)
from app.services.user_privacy import can_send_direct_message


def delete_file_quietly(path: str) -> None:
    try:
        if os.path.exists(path):
            os.remove(path)
    except OSError:
        pass


def _normalize_scan_extensions(raw_extensions) -> set[str]:
    if raw_extensions is None:
        return set()
    if isinstance(raw_extensions, str):
        values = raw_extensions.split(',')
    else:
        try:
            values = list(raw_extensions)
        except TypeError:
            values = [raw_extensions]
    normalized = set()
    for value in values:
        token = str(value or '').strip().lower()
        if token:
            normalized.add(token)
    return normalized


def _normalize_media_extension(ext: str, uploaded_mime: str | None) -> str:
    normalized_ext = str(ext or '').strip().lower()
    normalized_mime = str(uploaded_mime or '').strip().lower()
    if normalized_ext == 'mpga':
        return 'mp3'
    if normalized_ext == 'mpeg' and normalized_mime.startswith('audio/'):
        return 'mp3'
    return normalized_ext


def _close_connection_quietly(conn) -> None:
    try:
        conn.close()
    except Exception:  # noqa: BLE001
        pass


def _close_connection_and_return(conn, result, should_close: bool):
    if should_close:
        _close_connection_quietly(conn)
    return result


def _voice_upload_forbidden_result():
    return {
        'status': 'forbidden',
        'error': 'Голосовые сообщения временно недоступны.',
        'code': 403,
    }


def upload_avatar_for_user(  # noqa: PLR0913 - dependency-injected avatar upload contract
    conn,
    *,
    user_id: int,
    uploaded_file,
    upload_folder: str,
    max_avatar_size: int,
    allowed_file_func,
    validate_magic_func,
    list_visible_contact_public_keys_func,
    socketio_emit_func,
    own_public_key: str,
    project_root: str,
):
    if not uploaded_file:
        return {'status': 'invalid', 'error': 'Файл не найден.', 'code': 400}
    if uploaded_file.filename == '':
        return {'status': 'invalid', 'error': 'Файл не выбран.', 'code': 400}
    if not allowed_file_func(uploaded_file.filename):
        return {'status': 'invalid', 'error': 'Допустимые форматы: png, jpg, jpeg, webp, gif', 'code': 400}

    ext = uploaded_file.filename.rsplit('.', 1)[1].lower()
    if not validate_magic_func(uploaded_file, ext):
        return {'status': 'invalid', 'error': 'Файл повреждён или тип не совпадает с расширением.', 'code': 400}

    uploaded_file.seek(0, 2)
    size = uploaded_file.tell()
    uploaded_file.seek(0)
    if size > max_avatar_size:
        return {'status': 'invalid', 'error': 'Файл превышает максимум (макс. 4 МБ).', 'code': 400}

    filename = f"{uuid.uuid4().hex}.{ext}"
    filepath = os.path.join(upload_folder, filename)
    avatar_url = f'/static/avatars/{filename}'
    old_path = ''

    try:
        uploaded_file.save(filepath)

        # Drop EXIF/XMP/IPTC and any trailing polyglot payload by re-encoding
        # through Pillow. Avatars are always raster images (svg is blocked
        # upstream), so this is unconditional. `size` is the post-sanitize
        # value because the file is rewritten in place.
        try:
            size = sanitize_inplace(filepath, ext=ext)
        except ImageSanitizationError as exc:
            delete_file_quietly(filepath)
            reason = str(exc)
            if reason.startswith('image_too_large'):
                return {'status': 'invalid', 'error': 'Изображение слишком большое (более 50 МП).', 'code': 400}
            if reason == 'pillow_not_installed':
                # Production checklist forbids this state; treat as server error.
                return {'status': 'invalid', 'error': 'Обработка изображений недоступна.', 'code': 500}
            return {'status': 'invalid', 'error': 'Изображение не удалось обработать.', 'code': 400}

        old = conn.execute('SELECT avatar_url FROM users WHERE id = ?', (user_id,)).fetchone()
        if old and old['avatar_url']:
            old_path = os.path.join(project_root, old['avatar_url'].lstrip('/'))

        conn.execute('UPDATE users SET avatar_url = ? WHERE id = ?', (avatar_url, user_id))
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:  # noqa: BLE001
            pass
        delete_file_quietly(filepath)
        raise

    updated = conn.execute(
        'SELECT id, username, display_name, public_key, avatar_url FROM users WHERE id = ?',
        (user_id,),
    ).fetchone()
    contacts = list_visible_contact_public_keys_func(conn, user_id)
    if old_path:
        delete_file_quietly(old_path)

    if updated:
        profile_payload = {
            'user_id': updated['id'],
            'public_key': updated['public_key'],
            'display_name': updated['display_name'],
            'username': updated['username'],
            'avatar_url': updated['avatar_url'],
        }
        for contact in contacts:
            socketio_emit_func('profile_updated', profile_payload, room=contact['public_key'])
        if own_public_key:
            socketio_emit_func('own_profile_updated', profile_payload, room=own_public_key)

    return {'status': 'ok', 'avatar_url': avatar_url}


def upload_chat_media_for_user(  # noqa: PLR0913, C901 - dependency-injected media upload contract
    conn=None,
    *,
    user_id: int,
    chat_id: str,
    uploaded_file,
    chat_media_folder: str,
    allowed_extensions: set[str],
    max_chat_media_size: int,
    validate_chat_media_content_func,
    get_chat_partner_func,
    build_block_state_func,
    serialize_block_state_func,
    ensure_chat_exists_func,
    normalize_chat_media_mime_func,
    detect_chat_media_type_func,
    scan_file_func,
    av_scan_enabled: bool,
    av_fail_closed: bool,
    av_command_template: str,
    av_timeout_seconds: int,
    av_scan_extensions,
    media_hint: str = '',
    get_db_connection_func=None,
):
    owns_connections = callable(get_db_connection_func)
    active_conn = get_db_connection_func() if owns_connections else conn
    if active_conn is None:
        raise RuntimeError('Database connection is required for chat media upload.')

    partner = get_chat_partner_func(active_conn, user_id, chat_id)
    if not partner:
        return _close_connection_and_return(
            active_conn,
            {'status': 'forbidden', 'error': 'Доступ к чату запрещен.', 'code': 403},
            owns_connections,
        )
    block_state = serialize_block_state_func(build_block_state_func(active_conn, user_id, partner['contact_id']))
    if block_state['is_blocked']:
        return _close_connection_and_return(
            active_conn,
            {
                'status': 'blocked',
                'error': 'Нельзя загружать медиа: пользователь заблокирован.',
                'block_state': block_state,
            },
            owns_connections,
        )
    if not uploaded_file or not uploaded_file.filename:
        return _close_connection_and_return(
            active_conn,
            {'status': 'invalid', 'error': 'Файл не найден.', 'code': 400},
            owns_connections,
        )

    raw_filename = str(uploaded_file.filename or '').strip().replace('\x00', '')
    filename = os.path.basename(raw_filename.replace('\\', '/'))
    if not filename or '.' not in filename:
        return _close_connection_and_return(
            active_conn,
            {'status': 'invalid', 'error': 'Неподдерживаемое имя файла.', 'code': 400},
            owns_connections,
        )
    normalized_media_hint = str(media_hint or '').strip().lower()
    is_voice_upload = normalized_media_hint in {'voice', 'voice_message'} or filename.lower().startswith('voice-')
    if is_voice_upload and not can_send_direct_message(
        active_conn,
        receiver_id=partner['contact_id'],
        sender_id=user_id,
        message_type='voice',
    ):
        return _close_connection_and_return(active_conn, _voice_upload_forbidden_result(), owns_connections)
    if owns_connections:
        _close_connection_quietly(active_conn)

    ext = _normalize_media_extension(
        filename.rsplit('.', 1)[1],
        getattr(uploaded_file, 'mimetype', None),
    )
    if ext not in allowed_extensions:
        return {'status': 'invalid', 'error': 'Неподдерживаемый формат файла.', 'code': 400}

    uploaded_file.stream.seek(0, os.SEEK_END)
    size = uploaded_file.stream.tell()
    uploaded_file.stream.seek(0)
    if size > max_chat_media_size:
        return {'status': 'invalid', 'error': 'Размер файла превышает 100 МБ.', 'code': 400}

    if not validate_chat_media_content_func(uploaded_file, ext):
        return {'status': 'invalid', 'error': 'Файл не прошёл проверку содержимого.', 'code': 400}

    safe_name = f"{uuid.uuid4().hex}.{ext}"
    path = os.path.join(chat_media_folder, safe_name)
    uploaded_file.save(path)

    # Strip EXIF/XMP/IPTC and any trailing payload for raster image uploads.
    # Non-image media (audio/video/docs) skip this step — they need format-
    # specific scrubbing handled by the AV scanner.
    if is_sanitizable_extension(ext):
        try:
            size = sanitize_inplace(path, ext=ext)
        except ImageSanitizationError as exc:
            delete_file_quietly(path)
            reason = str(exc)
            if reason.startswith('image_too_large'):
                return {'status': 'invalid', 'error': 'Изображение слишком большое (более 50 МП).', 'code': 400}
            if reason == 'pillow_not_installed':
                return {'status': 'invalid', 'error': 'Обработка изображений недоступна.', 'code': 500}
            return {'status': 'invalid', 'error': 'Изображение не удалось обработать.', 'code': 400}

    scan_extensions = _normalize_scan_extensions(av_scan_extensions)
    should_scan_this_file = av_scan_enabled and ('*' in scan_extensions or ext in scan_extensions)
    if should_scan_this_file:
        try:
            av_result = scan_file_func(
                path,
                command_template=av_command_template,
                timeout_seconds=av_timeout_seconds,
            )
        except AVScanError:
            if av_fail_closed:
                delete_file_quietly(path)
                return {
                    'status': 'av_unavailable',
                    'error': 'Антивирусная проверка временно недоступна. Попробуйте позже.',
                    'code': 503,
                }
        else:
            if av_result.infected:
                delete_file_quietly(path)
                return {
                    'status': 'av_blocked',
                    'error': 'Файл отклонён политикой безопасности.',
                    'code': 400,
                    'signature': av_result.signature or 'unknown',
                }

    mime = normalize_chat_media_mime_func(uploaded_file.mimetype, filename, ext)
    insert_conn = get_db_connection_func() if owns_connections else conn
    if insert_conn is None:
        delete_file_quietly(path)
        raise RuntimeError('Database connection is required for chat media upload.')
    try:
        ensure_chat_exists_func(insert_conn, chat_id)
        cur = insert_conn.execute(
            '''
            INSERT INTO chat_media (chat_id, uploader_id, storage_name, original_name, mime_type, size)
            VALUES (?, ?, ?, ?, ?, ?)
            RETURNING id
            ''',
            (chat_id, user_id, safe_name, filename, mime, size),
        )
        inserted_row = cur.fetchone()
        media_id = inserted_row['id'] if inserted_row else None
        if media_id is None:
            raise DatabaseError('Failed to resolve inserted media id')
        insert_conn.commit()
    except DatabaseError:
        delete_file_quietly(path)
        raise
    finally:
        if owns_connections:
            _close_connection_quietly(insert_conn)

    return {
        'status': 'ok',
        'media_id': media_id,
        'mime': mime,
        'media_type': 'voice' if is_voice_upload else detect_chat_media_type_func(mime),
        'name': filename,
        'size': size,
    }


def resolve_chat_media_access(  # noqa: PLR0913 - dependency-injected media access contract
    conn,
    *,
    user_id: int,
    media_id: int,
    get_chat_partner_func,
    build_block_state_func,
    serialize_block_state_func,
    dangerous_inline_mime_prefixes: tuple[str, ...],
    cache_max_age_seconds: int,
):
    media = conn.execute(
        '''
        SELECT id, chat_id, storage_name, mime_type
        FROM chat_media
        WHERE id = ?
        ''',
        (media_id,),
    ).fetchone()
    if not media:
        return {'status': 'not_found'}

    partner = get_chat_partner_func(conn, user_id, media['chat_id'])
    if not partner:
        return {'status': 'forbidden'}

    block_state = serialize_block_state_func(build_block_state_func(conn, user_id, partner['contact_id']))
    if block_state['is_blocked']:
        return {'status': 'blocked', 'block_state': block_state}

    mime_type = (media['mime_type'] or '').lower()
    serve_as_attachment = any(mime_type.startswith(prefix) for prefix in dangerous_inline_mime_prefixes)
    cache_max_age = max(0, int(cache_max_age_seconds or 0))

    return {
        'status': 'ok',
        'storage_name': media['storage_name'],
        'mime_type': media['mime_type'] or None,
        'serve_as_attachment': serve_as_attachment,
        'cache_max_age': cache_max_age,
    }


def resolve_avatar_for_viewer(
    conn,
    *,
    viewer_id: int,
    target_user_id,
    target_public_key,
    get_safe_avatar_url_func,
):
    if target_user_id:
        user = conn.execute(
            '''
            SELECT u.id, u.avatar_url, u.avatar_visibility, u.is_public,
                   EXISTS(
                       SELECT 1 FROM contacts c
                       WHERE c.user_id = ? AND c.contact_id = u.id
                   ) AS is_contact
            FROM users u
            WHERE u.id = ?
            ''',
            (viewer_id, target_user_id),
        ).fetchone()
    elif target_public_key:
        user = conn.execute(
            '''
            SELECT u.id, u.avatar_url, u.avatar_visibility, u.is_public,
                   EXISTS(
                       SELECT 1 FROM contacts c
                       WHERE c.user_id = ? AND c.contact_id = u.id
                   ) AS is_contact
            FROM users u
            WHERE u.public_key = ?
            ''',
            (viewer_id, target_public_key),
        ).fetchone()
    else:
        return {'status': 'invalid'}

    if not user:
        return {'status': 'not_found'}

    return {'status': 'ok', 'avatar_url': get_safe_avatar_url_func(user, viewer_id)}
