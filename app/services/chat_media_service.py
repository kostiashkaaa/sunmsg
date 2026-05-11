import os
import uuid

from app.db_backend import DatabaseError
from app.services.av_scan import AVScanError


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
    uploaded_file.save(filepath)

    avatar_url = f'/static/avatars/{filename}'

    old = conn.execute('SELECT avatar_url FROM users WHERE id = ?', (user_id,)).fetchone()
    if old and old['avatar_url']:
        old_path = os.path.join(project_root, old['avatar_url'].lstrip('/'))
        delete_file_quietly(old_path)

    conn.execute('UPDATE users SET avatar_url = ? WHERE id = ?', (avatar_url, user_id))
    conn.commit()

    updated = conn.execute(
        'SELECT id, username, display_name, public_key, avatar_url FROM users WHERE id = ?',
        (user_id,),
    ).fetchone()
    contacts = list_visible_contact_public_keys_func(conn, user_id)

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
    conn,
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
):
    partner = get_chat_partner_func(conn, user_id, chat_id)
    if not partner:
        return {'status': 'forbidden', 'error': 'Доступ к чату запрещен.', 'code': 403}
    block_state = serialize_block_state_func(build_block_state_func(conn, user_id, partner['contact_id']))
    if block_state['is_blocked']:
        return {
            'status': 'blocked',
            'error': 'Нельзя загружать медиа: пользователь заблокирован.',
            'block_state': block_state,
        }

    if not uploaded_file or not uploaded_file.filename:
        return {'status': 'invalid', 'error': 'Файл не найден.', 'code': 400}

    raw_filename = str(uploaded_file.filename or '').strip().replace('\x00', '')
    filename = os.path.basename(raw_filename.replace('\\', '/'))
    if not filename or '.' not in filename:
        return {'status': 'invalid', 'error': 'Неподдерживаемое имя файла.', 'code': 400}

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

    ensure_chat_exists_func(conn, chat_id)
    safe_name = f"{uuid.uuid4().hex}.{ext}"
    path = os.path.join(chat_media_folder, safe_name)
    uploaded_file.save(path)

    scan_extensions = _normalize_scan_extensions(av_scan_extensions)
    should_scan_this_file = av_scan_enabled and ext in scan_extensions
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
    try:
        cur = conn.execute(
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
        conn.commit()
    except DatabaseError:
        delete_file_quietly(path)
        raise

    return {
        'status': 'ok',
        'media_id': media_id,
        'mime': mime,
        'media_type': detect_chat_media_type_func(mime),
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
