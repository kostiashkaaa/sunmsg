import re

from flask import (
    current_app,
    flash,
    jsonify,
    make_response,
    redirect,
    render_template,
    request,
    session,
    url_for,
)

from app.database import get_db_connection
from app.db_backend import DatabaseError, IntegrityError
from app.extensions import limiter, socketio
from app.forms import SettingsForm
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
from app.services.client_preferences import client_preferences_from_db, client_preferences_to_json
from app.services.locale import language_from_user_row
from app.services.presence import is_effectively_online
from app.services.refresh_tokens import clear_refresh_cookie
from .context import (
    auth_bp,
)

@auth_bp.route('/settings', methods=['GET', 'POST'])
def settings():
    if 'public_key_pem' not in session:
        flash('Пожалуйста, войдите в систему.', 'danger')
        return redirect(url_for('auth.index'))

    embed_mode = str(request.args.get('embed', '')).strip().lower() in {'1', 'true', 'yes'}
    user_public_key_pem = session['public_key_pem']
    form = SettingsForm()

    conn = get_db_connection()
    try:
        user = conn.execute(
            '''
            SELECT id, username, display_name, public_key, is_public,
                   auto_decline_requests, hide_online_status, avatar_url, avatar_visibility, group_invite_privacy, bio, language,
                   client_preferences
            FROM users
            WHERE public_key = ?
            ''',
            (user_public_key_pem,),
        ).fetchone()

        if not user:
            flash('Пользователь не найден.', 'danger')
            return redirect(url_for('auth.index'))

        if form.validate_on_submit():
            username = form.username.data.strip()
            display_name = form.display_name.data.strip()
            is_public = bool(form.is_public.data)
            auto_decline_requests = bool(form.auto_decline_requests.data)
            hide_online_status = bool(form.hide_online_status.data)
            reset_keys = bool(form.reset_keys.data)

            try:
                conn.execute('''
                    UPDATE users
                    SET username = ?, display_name = ?, is_public = ?,
                        auto_decline_requests = ?, hide_online_status = ?,
                        avatar_visibility = COALESCE(?, avatar_visibility),
                        language = COALESCE(?, language)
                    WHERE public_key = ?
                ''', (username, display_name, is_public, auto_decline_requests,
                      hide_online_status, None, None, user_public_key_pem))

                conn.commit()
                if reset_keys:
                    flash('Внимание: сброс ключей больше не выполняется на сервере. Сгенерируйте новые на клиенте.', 'warning')
                else:
                    flash('Настройки успешно сохранены.', 'success')
            except DatabaseError as e:
                flash(f'Ошибка при сохранении настроек: {e}', 'danger')

            return redirect(url_for('auth.settings'))

        form.username.data = user['username']
        form.display_name.data = user['display_name']
        form.is_public.data = bool(user['is_public'])
        form.auto_decline_requests.data = bool(user['auto_decline_requests'])
        form.hide_online_status.data = bool(user['hide_online_status'])
    finally:
        conn.close()

    return render_template(
        'settings.html',
        form=form,
        current_username=user['username'],
        current_display_name=user['display_name'],
        public_key_pem=user['public_key'],
        embed_mode=embed_mode,
        ui_language=language_from_user_row(user),
        client_preferences=client_preferences_from_db(
            user['client_preferences'] if 'client_preferences' in user.keys() else None
        ),
    )

@auth_bp.route('/api/get_settings', methods=['GET'])
@limiter.limit("60 per minute")
def get_settings():
    if 'public_key_pem' not in session:
        return jsonify({'error': 'Пользователь не аутентифицирован.'}), 401

    user_public_key_pem = session['public_key_pem']
    conn = get_db_connection()
    user = conn.execute(
        '''
        SELECT id, username, display_name, public_key, is_public,
               auto_decline_requests, mute_dialog_requests, hide_online_status, is_online, last_seen,
               avatar_url, avatar_visibility,
               group_invite_privacy,
               bio, language, client_preferences
        FROM users
        WHERE public_key = ?
        ''',
        (user_public_key_pem,),
    ).fetchone()
    conn.close()

    if not user:
        return jsonify({'error': 'Пользователь не найден.'}), 404

    effective_online = is_effectively_online(
        user['public_key'],
        persisted=bool(user['is_online']) if 'is_online' in user.keys() else False,
    )

    return jsonify({
        'username':             user['username'],
        'display_name':         user['display_name'],
        'is_public':            bool(user['is_public']),
        'auto_decline_requests': bool(user['auto_decline_requests']),
        'mute_dialog_requests': bool(user['mute_dialog_requests']) if 'mute_dialog_requests' in user.keys() else False,
        'hide_online_status':   bool(user['hide_online_status']),
        'avatar_url':           user['avatar_url'] if 'avatar_url' in user.keys() else None,
        'avatar_visibility':    user['avatar_visibility'] if 'avatar_visibility' in user.keys() else 'all',
        'group_invite_privacy': (
            str(user['group_invite_privacy'] or '').strip().lower()
            if 'group_invite_privacy' in user.keys() and str(user['group_invite_privacy'] or '').strip().lower() in {'all', 'contacts', 'nobody'}
            else 'all'
        ),
        'bio':                  (user['bio'] if 'bio' in user.keys() else '') or '',
        'language':             language_from_user_row(user),
        'online':               bool(effective_online),
        'last_seen':            user['last_seen'] if 'last_seen' in user.keys() else None,
        'client_preferences':   client_preferences_from_db(
            user['client_preferences'] if 'client_preferences' in user.keys() else None
        ),
    })

@auth_bp.route('/api/save_settings', methods=['POST'])
@limiter.limit("20 per minute")
def api_save_settings():
    """JSON-based settings save (used by settings.html)"""
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
    hide_online_status_db = None if hide_online_status is None else int(bool(hide_online_status))

    conn = get_db_connection()
    try:
        # Читаем старые настройки ДО обновления (чтобы отследить изменения)
        old_user = conn.execute(
            '''
            SELECT username, display_name, avatar_url, bio, hide_online_status
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
            conn.execute('''
                UPDATE users SET
                    username             = COALESCE(?, username),
                    display_name         = COALESCE(?, display_name),
                    is_public            = COALESCE(?, is_public),
                    auto_decline_requests= COALESCE(?, auto_decline_requests),
                    mute_dialog_requests = COALESCE(?, mute_dialog_requests),
                    hide_online_status   = COALESCE(?, hide_online_status),
                    avatar_visibility    = COALESCE(?, avatar_visibility),
                    group_invite_privacy = COALESCE(?, group_invite_privacy),
                    bio                  = COALESCE(?, bio),
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
                avatar_visibility,
                group_invite_privacy,
                bio_value,
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
            SELECT id, username, display_name, public_key, avatar_url, bio,
                   hide_online_status, is_online, last_seen, language
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
                for field_name in ('username', 'display_name', 'avatar_url', 'bio')
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
                    'bio':          (updated['bio'] or ''),
                }

                # Эмитим каждому контакту в его персональную комнату
                for c in contacts:
                    socketio.emit('profile_updated', profile_payload, room=c['public_key'])

                # Самому себе (для обновления сайдбара)
                socketio.emit('own_profile_updated', profile_payload, room=pub)

            # Реалтайм-обновление онлайн-статуса при изменении настройки скрытия
            if status_changed:
                contact_pub_keys = [c['public_key'] for c in contacts]
                if new_hide:
                    # Скрыли статус — отправить "оффлайн" всем контактам
                    status_payload = {'public_key': pub, 'online': False, 'last_seen': None}
                    for cpk in contact_pub_keys:
                        socketio.emit('user_status', status_payload, room=cpk)
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
                        socketio.emit('user_status', status_payload, room=cpk)

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
        if chat_ids:
            placeholders = ','.join(['?'] * len(chat_ids))
            media_rows = conn.execute(
                f'''
                SELECT storage_name
                FROM chat_media
                WHERE uploader_id = ? OR chat_id IN ({placeholders})
                ''',
                (user_id, *chat_ids)
            ).fetchall()
            media_storage_names = [row['storage_name'] for row in media_rows if row and row['storage_name']]
            conn.execute(
                f'DELETE FROM chat_media WHERE uploader_id = ? OR chat_id IN ({placeholders})',
                (user_id, *chat_ids)
            )
        else:
            media_rows = conn.execute(
                'SELECT storage_name FROM chat_media WHERE uploader_id = ?',
                (user_id,)
            ).fetchall()
            media_storage_names = [row['storage_name'] for row in media_rows if row and row['storage_name']]
            conn.execute('DELETE FROM chat_media WHERE uploader_id = ?', (user_id,))

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
        if chat_ids:
            conn.execute(
                f'DELETE FROM pinned_chats WHERE chat_id IN ({placeholders})',
                tuple(chat_ids),
            )
            conn.execute(
                f'DELETE FROM chat_pins WHERE chat_id IN ({placeholders})',
                tuple(chat_ids),
            )
            conn.execute(
                f'DELETE FROM chats WHERE chat_id IN ({placeholders})',
                tuple(chat_ids),
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
        logger.exception('delete_account error')
        return jsonify({'success': False, 'error': 'Ошибка при удалении аккаунта.'}), 500
    finally:
        conn.close()
