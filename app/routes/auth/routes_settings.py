import re

from flask import (
    current_app,
    flash,
    jsonify,
    make_response,
    redirect,
    request,
    session,
    url_for,
)

from app.database import get_db_connection
from app.db_backend import DatabaseError, IntegrityError
from app.extensions import limiter, socketio
from app.routes.socket_emit import build_route_socket_emitter
from app.routes.auth_helpers_settings import (
    AVATAR_FOLDER,
    CHAT_MEDIA_FOLDER,
    DISPLAY_NAME_MAX_LENGTH,
    USERNAME_MAX_LENGTH,
    avatar_storage_name_from_profile_url,
    logger,
    safe_remove_stored_file_from_dir,
)
from app.services.blocking import list_visible_contact_public_keys
from app.services.chat_members import CHAT_TYPE_GROUP, get_chat_type
from app.services.client_preferences import client_preferences_from_db, client_preferences_to_json
from app.services.locale import language_from_user_row
from app.services.presence import is_effectively_online
from app.services.refresh_tokens import clear_refresh_cookie
from app.services.user_privacy import normalize_privacy_choice
from .context import (
    auth_bp,
)

_emit_socket_event = build_route_socket_emitter(
    raw_emit_func=socketio.emit,
    get_db_connection_func=get_db_connection,
    logger=logger,
)


def _partition_account_chat_ids(conn, chat_ids: list[str]) -> tuple[list[str], list[str]]:
    direct_chat_ids: list[str] = []
    group_chat_ids: list[str] = []
    for chat_id in chat_ids:
        normalized_chat_id = str(chat_id or '').strip()
        if not normalized_chat_id:
            continue
        if get_chat_type(conn, normalized_chat_id) == CHAT_TYPE_GROUP:
            group_chat_ids.append(normalized_chat_id)
        else:
            direct_chat_ids.append(normalized_chat_id)
    return direct_chat_ids, group_chat_ids


@auth_bp.route('/settings', methods=['GET', 'POST'])
def settings():
    if 'public_key_pem' not in session:
        flash('Пожалуйста, войдите в систему.', 'danger')
        return redirect(url_for('auth.index'))

    return redirect(url_for('chat.chat_index'))

@auth_bp.route('/api/get_settings', methods=['GET'])
@limiter.limit("60 per minute")
def get_settings():
    if 'public_key_pem' not in session:
        return jsonify({'error': 'Пользователь не аутентифицирован.'}), 401

    user_public_key_pem = session['public_key_pem']
    conn = get_db_connection()
    try:
        user = conn.execute(
            '''
            SELECT id, username, display_name, public_key, is_public,
                   auto_decline_requests, mute_dialog_requests, hide_online_status, is_online, last_seen,
                   avatar_url, avatar_visibility,
                   last_seen_visibility, bio_visibility, forward_link_privacy,
                   group_invite_privacy, voice_message_privacy, message_privacy,
                   read_receipts_privacy, typing_privacy, voice_listened_privacy,
                   call_privacy, public_key_search_privacy,
                   bio, status_text, language, client_preferences
            FROM users
            WHERE public_key = ?
            ''',
            (user_public_key_pem,),
        ).fetchone()
    finally:
        conn.close()

    if not user:
        return jsonify({'error': 'Пользователь не найден.'}), 404

    try:
        effective_online = is_effectively_online(
            user['public_key'],
            persisted=bool(user['is_online']) if 'is_online' in user.keys() else False,
        )
    except Exception:
        effective_online = False

    return jsonify({
        'success':              True,
        'username':             user['username'],
        'display_name':         user['display_name'],
        'is_public':            bool(user['is_public']),
        'auto_decline_requests': bool(user['auto_decline_requests']),
        'mute_dialog_requests': bool(user['mute_dialog_requests']) if 'mute_dialog_requests' in user.keys() else False,
        'hide_online_status':   bool(user['hide_online_status']),
        'last_seen_visibility': normalize_privacy_choice(
            user['last_seen_visibility'] if 'last_seen_visibility' in user.keys() else None,
            default='nobody' if bool(user['hide_online_status']) else 'all',
        ),
        'avatar_url':           user['avatar_url'] if 'avatar_url' in user.keys() else None,
        'avatar_visibility':    user['avatar_visibility'] if 'avatar_visibility' in user.keys() else 'all',
        'bio_visibility':       normalize_privacy_choice(user['bio_visibility'] if 'bio_visibility' in user.keys() else None),
        'forward_link_privacy': normalize_privacy_choice(user['forward_link_privacy'] if 'forward_link_privacy' in user.keys() else None),
        'group_invite_privacy': (
            str(user['group_invite_privacy'] or '').strip().lower()
            if 'group_invite_privacy' in user.keys() and str(user['group_invite_privacy'] or '').strip().lower() in {'all', 'contacts', 'nobody'}
            else 'all'
        ),
        'voice_message_privacy': normalize_privacy_choice(user['voice_message_privacy'] if 'voice_message_privacy' in user.keys() else None),
        'message_privacy':       normalize_privacy_choice(user['message_privacy'] if 'message_privacy' in user.keys() else None),
        'read_receipts_privacy': normalize_privacy_choice(user['read_receipts_privacy'] if 'read_receipts_privacy' in user.keys() else None),
        'typing_privacy':        normalize_privacy_choice(user['typing_privacy'] if 'typing_privacy' in user.keys() else None),
        'voice_listened_privacy': normalize_privacy_choice(user['voice_listened_privacy'] if 'voice_listened_privacy' in user.keys() else None),
        'call_privacy':          normalize_privacy_choice(user['call_privacy'] if 'call_privacy' in user.keys() else None),
        'public_key_search_privacy': normalize_privacy_choice(user['public_key_search_privacy'] if 'public_key_search_privacy' in user.keys() else None),
        'bio':                  (user['bio'] if 'bio' in user.keys() else '') or '',
        'status_text':          (user['status_text'] if 'status_text' in user.keys() else '') or '',
        'language':             language_from_user_row(user),
        'online':               bool(effective_online),
        'last_seen':            user['last_seen'] if 'last_seen' in user.keys() else None,
        'client_preferences':   client_preferences_from_db(
            user['client_preferences'] if 'client_preferences' in user.keys() else None
        ),
    })

@auth_bp.route('/api/save_settings', methods=['POST'])
@limiter.limit("20 per minute")
def api_save_settings():  # noqa: C901, PLR0915 - settings normalization and persistence fan-out
    """JSON-based settings save used by the embedded chat settings panel."""
    if 'public_key_pem' not in session or 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401

    data = request.get_json(silent=True)
    if not isinstance(data, dict) or not data:
        return jsonify({'success': False, 'error': 'No data.'}), 400

    pub = session['public_key_pem']
    user_id = session['user_id']

    def _normalize_optional_bool(field_name: str):
        if field_name not in data:
            return None
        value = data.get(field_name)
        if value is None:
            return None
        if isinstance(value, bool):
            return value
        if isinstance(value, int) and value in (0, 1):
            return bool(value)
        raise ValueError(f'Поле "{field_name}" должно быть true/false.')

    new_username = data.get('username')
    if new_username is not None:
        new_username = str(new_username).strip()
        if not new_username:
            return jsonify({'success': False, 'error': 'Никнейм не может быть пустым.'}), 400
        if len(new_username) > USERNAME_MAX_LENGTH:
            return jsonify({'success': False, 'error': 'Никнейм не должен превышать 50 символов.'}), 400
        if not re.fullmatch(r'[a-z0-9_]+', new_username):
            return jsonify({'success': False, 'error': 'Никнейм может содержать только a–z, 0–9, _'}), 400

    new_display_name = data.get('display_name')
    if new_display_name is not None:
        new_display_name = str(new_display_name).strip()
        if not new_display_name:
            return jsonify({'success': False, 'error': 'Отображаемое имя не может быть пустым.'}), 400
        if len(new_display_name) > DISPLAY_NAME_MAX_LENGTH:
            return jsonify({'success': False, 'error': 'Отображаемое имя не должно превышать 50 символов.'}), 400

    avatar_visibility = data.get('avatar_visibility')
    if avatar_visibility is not None:
        avatar_visibility = str(avatar_visibility).strip().lower()
        if avatar_visibility not in {'all', 'contacts', 'nobody'}:
            return jsonify({'success': False, 'error': 'Недопустимое значение видимости аватара.'}), 400

    group_invite_privacy = data.get('group_invite_privacy')
    if group_invite_privacy is not None:
        group_invite_privacy = str(group_invite_privacy).strip().lower()
        if group_invite_privacy not in {'all', 'contacts', 'nobody'}:
            return jsonify({'success': False, 'error': 'Недопустимое значение приватности приглашений в группы.'}), 400

    privacy_choice_fields = {
        'last_seen_visibility': 'Недопустимое значение видимости времени захода.',
        'bio_visibility': 'Недопустимое значение видимости раздела "О себе".',
        'forward_link_privacy': 'Недопустимое значение приватности пересылки.',
        'voice_message_privacy': 'Недопустимое значение приватности голосовых сообщений.',
        'message_privacy': 'Недопустимое значение приватности сообщений.',
        'read_receipts_privacy': 'Недопустимое значение приватности отчетов о прочтении.',
        'typing_privacy': 'Недопустимое значение приватности индикатора набора.',
        'voice_listened_privacy': 'Недопустимое значение приватности прослушивания голосовых.',
        'call_privacy': 'Недопустимое значение приватности звонков.',
        'public_key_search_privacy': 'Недопустимое значение приватности поиска по ключу.',
    }
    normalized_privacy_choices = {}
    for field_name, error_text in privacy_choice_fields.items():
        if field_name not in data:
            normalized_privacy_choices[field_name] = None
            continue
        field_value = str(data.get(field_name) or '').strip().lower()
        if field_value not in {'all', 'contacts', 'nobody'}:
            return jsonify({'success': False, 'error': error_text}), 400
        normalized_privacy_choices[field_name] = field_value

    new_language = data.get('language')
    if new_language is not None:
        new_language = str(new_language).strip().lower()
        if new_language not in {'ru', 'en'}:
            return jsonify({'success': False, 'error': 'Недопустимое значение языка интерфейса.'}), 400

    client_preferences_json = None
    if 'client_preferences' in data:
        raw_client_preferences = data.get('client_preferences')
        if raw_client_preferences is None:
            client_preferences_json = '{}'
        elif not isinstance(raw_client_preferences, dict):
            return jsonify({'success': False, 'error': 'Поле "client_preferences" должно быть объектом.'}), 400
        else:
            client_preferences_json = client_preferences_to_json(raw_client_preferences)

    try:
        is_public = _normalize_optional_bool('is_public')
        auto_decline_requests = _normalize_optional_bool('auto_decline_requests')
        mute_dialog_requests = _normalize_optional_bool('mute_dialog_requests')
        hide_online_status = _normalize_optional_bool('hide_online_status')
        reset_keys = _normalize_optional_bool('reset_keys')
    except ValueError as exc:
        return jsonify({'success': False, 'error': str(exc)}), 400

    if reset_keys:
        return jsonify({
            'success': False,
            'error': 'Сброс ключей на сервере отключён. Используйте восстановление/генерацию ключей на клиенте.'
        }), 400

    is_public_db = None if is_public is None else int(bool(is_public))
    auto_decline_requests_db = None if auto_decline_requests is None else int(bool(auto_decline_requests))
    mute_dialog_requests_db = None if mute_dialog_requests is None else int(bool(mute_dialog_requests))
    if normalized_privacy_choices.get('last_seen_visibility') is not None:
        hide_online_status = normalized_privacy_choices['last_seen_visibility'] == 'nobody'
    hide_online_status_db = None if hide_online_status is None else int(bool(hide_online_status))

    conn = get_db_connection()
    try:
        # Читаем старые настройки ДО обновления (чтобы отследить изменения)
        old_user = conn.execute(
            '''
            SELECT username, display_name, avatar_url, bio, status_text, hide_online_status, bio_visibility
            FROM users
            WHERE public_key = ?
            ''',
            (pub,),
        ).fetchone()
        old_hide = bool(old_user and old_user['hide_online_status'])

        try:
            bio_raw = data.get('bio')
            bio_value = None
            if bio_raw is not None:
                bio_value = str(bio_raw).strip()[:280]
            status_text_raw = data.get('status_text')
            status_text_value = None
            if status_text_raw is not None:
                status_text_value = str(status_text_raw).strip()[:100]
            conn.execute('''
                UPDATE users SET
                    username             = COALESCE(?, username),
                    display_name         = COALESCE(?, display_name),
                    is_public            = COALESCE(?, is_public),
                    auto_decline_requests= COALESCE(?, auto_decline_requests),
                    mute_dialog_requests = COALESCE(?, mute_dialog_requests),
                    hide_online_status   = COALESCE(?, hide_online_status),
                    last_seen_visibility = COALESCE(?, last_seen_visibility),
                    avatar_visibility    = COALESCE(?, avatar_visibility),
                    bio_visibility       = COALESCE(?, bio_visibility),
                    forward_link_privacy = COALESCE(?, forward_link_privacy),
                    group_invite_privacy = COALESCE(?, group_invite_privacy),
                    voice_message_privacy= COALESCE(?, voice_message_privacy),
                    message_privacy      = COALESCE(?, message_privacy),
                    read_receipts_privacy= COALESCE(?, read_receipts_privacy),
                    typing_privacy       = COALESCE(?, typing_privacy),
                    voice_listened_privacy= COALESCE(?, voice_listened_privacy),
                    call_privacy         = COALESCE(?, call_privacy),
                    public_key_search_privacy = COALESCE(?, public_key_search_privacy),
                    bio                  = COALESCE(?, bio),
                    status_text          = COALESCE(?, status_text),
                    language             = COALESCE(?, language),
                    client_preferences   = COALESCE(?, client_preferences)
                WHERE public_key = ?
            ''', (
                new_username,
                new_display_name,
                is_public_db,
                auto_decline_requests_db,
                mute_dialog_requests_db,
                hide_online_status_db,
                normalized_privacy_choices['last_seen_visibility'],
                avatar_visibility,
                normalized_privacy_choices['bio_visibility'],
                normalized_privacy_choices['forward_link_privacy'],
                group_invite_privacy,
                normalized_privacy_choices['voice_message_privacy'],
                normalized_privacy_choices['message_privacy'],
                normalized_privacy_choices['read_receipts_privacy'],
                normalized_privacy_choices['typing_privacy'],
                normalized_privacy_choices['voice_listened_privacy'],
                normalized_privacy_choices['call_privacy'],
                normalized_privacy_choices['public_key_search_privacy'],
                bio_value,
                status_text_value,
                new_language,
                client_preferences_json,
                pub
            ))
            conn.commit()
        except IntegrityError:
            return jsonify({'success': False, 'error': 'Это имя пользователя уже занято.'}), 400

        # Читаем актуальные данные после обновления
        updated = conn.execute(
            '''
            SELECT id, username, display_name, public_key, avatar_url, bio, status_text,
                   hide_online_status, bio_visibility, is_online, last_seen, language
            FROM users
            WHERE public_key = ?
            ''',
            (pub,)
        ).fetchone()

        if updated:
            session['ui_language'] = language_from_user_row(updated)

            new_hide = bool(updated['hide_online_status'])
            profile_changed = not old_user or any(
                (
                    str(updated[field_name] or '').strip()
                    != str(old_user[field_name] or '').strip()
                )
                for field_name in ('username', 'display_name', 'avatar_url', 'bio', 'status_text')
            )
            if old_user and 'bio_visibility' in old_user.keys():
                profile_changed = profile_changed or (
                    normalize_privacy_choice(updated['bio_visibility'])
                    != normalize_privacy_choice(old_user['bio_visibility'])
                )
            status_changed = old_hide != new_hide

            contacts = []
            if profile_changed or status_changed:
                contacts = list_visible_contact_public_keys(conn, user_id)

            if profile_changed:
                profile_payload = {
                    'user_id':      updated['id'],
                    'public_key':   updated['public_key'],
                    'display_name': updated['display_name'],
                    'username':     updated['username'],
                    'avatar_url':   updated['avatar_url'],
                    'bio':          (updated['bio'] or '') if normalize_privacy_choice(updated['bio_visibility']) != 'nobody' else '',
                    'status_text':  (updated['status_text'] or '') if 'status_text' in updated.keys() else '',
                }

                # Эмитим каждому контакту в его персональную комнату
                for c in contacts:
                    _emit_socket_event('profile_updated', profile_payload, room=c['public_key'])

                # Самому себе (для обновления сайдбара)
                _emit_socket_event('own_profile_updated', profile_payload, room=pub)

            # Реалтайм-обновление онлайн-статуса при изменении настройки скрытия
            if status_changed:
                contact_pub_keys = [c['public_key'] for c in contacts]
                if new_hide:
                    # Скрыли статус — отправить "оффлайн" всем контактам
                    status_payload = {'public_key': pub, 'online': False, 'last_seen': None}
                    for cpk in contact_pub_keys:
                        _emit_socket_event('user_status', status_payload, room=cpk)
                else:
                    # Показали статус — отправить реальный статус
                    is_online = is_effectively_online(
                        pub,
                        persisted=bool(updated['is_online']) if 'is_online' in updated.keys() else False,
                    )
                    status_payload = {
                        'public_key': pub,
                        'online': is_online,
                        'last_seen': None if is_online else updated['last_seen'],
                    }
                    for cpk in contact_pub_keys:
                        _emit_socket_event('user_status', status_payload, room=cpk)

        return jsonify({'success': True})
    except DatabaseError as exc:
        logger.error('api_save_settings database error user_id=%s: %s', user_id, exc)
        return jsonify({'success': False, 'error': 'Не удалось сохранить настройки. Попробуйте позже.'}), 500
    except Exception as exc:  # noqa: BLE001
        logger.exception('api_save_settings unexpected error user_id=%s: %s', user_id, exc)
        return jsonify({'success': False, 'error': 'Не удалось сохранить настройки. Попробуйте позже.'}), 500
    finally:
        conn.close()

@auth_bp.route('/api/delete_account', methods=['POST'])
@limiter.limit("5 per hour")
def delete_account():
    """Permanently deletes the user account and all associated data."""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401

    user_id = session['user_id']
    conn = get_db_connection()
    media_storage_names = []
    avatar_storage_name = None
    try:
        user_row = conn.execute(
            'SELECT username, public_key, avatar_url FROM users WHERE id = ?',
            (user_id,)
        ).fetchone()

        avatar_storage_name = avatar_storage_name_from_profile_url(user_row['avatar_url'] if user_row else None)

        # Collect all chat ids tied to this user, then cleanup media for those chats.
        chat_id_rows = conn.execute(
            '''
            SELECT DISTINCT chat_id
            FROM (
                SELECT chat_id FROM messages WHERE sender_id = ? OR receiver_id = ?
                UNION
                SELECT chat_id FROM contacts WHERE user_id = ? OR contact_id = ?
            )
            WHERE chat_id IS NOT NULL AND chat_id != ''
            ''',
            (user_id, user_id, user_id, user_id)
        ).fetchall()
        chat_ids = [row['chat_id'] for row in chat_id_rows if row and row['chat_id']]
        direct_chat_ids, _group_chat_ids = _partition_account_chat_ids(conn, chat_ids)
        media_lookup_params = [user_id]
        media_where = 'uploader_id = ?'
        if direct_chat_ids:
            direct_placeholders = ','.join(['?'] * len(direct_chat_ids))
            media_where = f'{media_where} OR chat_id IN ({direct_placeholders})'
            media_lookup_params.extend(direct_chat_ids)

        if media_lookup_params:
            media_rows = conn.execute(
                f'''
                SELECT storage_name
                FROM chat_media
                WHERE {media_where}
                ''',
                tuple(media_lookup_params)
            ).fetchall()
            media_storage_names = [row['storage_name'] for row in media_rows if row and row['storage_name']]
            conn.execute(
                f'DELETE FROM chat_media WHERE {media_where}',
                tuple(media_lookup_params)
            )

        # 1. Удаляем все сообщения, где пользователь отправитель или получатель
        conn.execute('DELETE FROM messages WHERE sender_id = ? OR receiver_id = ?', (user_id, user_id))

        # 2. Удаляем все контакты пользователя (и записи о нем у других)
        conn.execute('DELETE FROM contacts WHERE user_id = ? OR contact_id = ?', (user_id, user_id))

        # 3. Удаляем запросы на диалог
        conn.execute('DELETE FROM dialog_requests WHERE sender_id = ? OR receiver_id = ?', (user_id, user_id))

        # 4. Удаляем связанные служебные данные и артефакты чатов.
        conn.execute('DELETE FROM block_list WHERE blocker_id = ? OR blocked_id = ?', (user_id, user_id))
        conn.execute('DELETE FROM pinned_chats WHERE user_id = ?', (user_id,))
        conn.execute('DELETE FROM socket_rate_limits WHERE user_id = ?', (user_id,))
        conn.execute('DELETE FROM dialog_keys WHERE creator_id = ?', (user_id,))
        conn.execute('DELETE FROM refresh_tokens WHERE user_id = ?', (user_id,))
        if direct_chat_ids:
            direct_placeholders = ','.join(['?'] * len(direct_chat_ids))
            conn.execute(
                f'DELETE FROM pinned_chats WHERE chat_id IN ({direct_placeholders})',
                tuple(direct_chat_ids),
            )
            conn.execute(
                f'DELETE FROM chat_pins WHERE chat_id IN ({direct_placeholders})',
                tuple(direct_chat_ids),
            )
            conn.execute(
                f'DELETE FROM chats WHERE chat_id IN ({direct_placeholders})',
                tuple(direct_chat_ids),
            )

        # 5. Удаляем самого пользователя
        conn.execute('DELETE FROM users WHERE id = ?', (user_id,))

        conn.commit()
        logger.info(
            'AUDIT event=account_deleted user_id=%s username=%s public_key=%s ip=%s',
            user_id,
            user_row['username'] if user_row else '-',
            user_row['public_key'] if user_row else '-',
            request.remote_addr or '-'
        )

        if avatar_storage_name:
            safe_remove_stored_file_from_dir(AVATAR_FOLDER, avatar_storage_name)
        for storage_name in set(media_storage_names):
            safe_remove_stored_file_from_dir(CHAT_MEDIA_FOLDER, storage_name)

        session.clear()
        response = make_response(jsonify({'success': True}))
        secure = bool(current_app.config.get('SESSION_COOKIE_SECURE'))
        clear_refresh_cookie(response, secure=secure)
        return response
    except DatabaseError:
        conn.rollback()
        logger.exception('delete_account error')
        return jsonify({'success': False, 'error': 'Ошибка при удалении аккаунта.'}), 500
    finally:
        conn.close()
