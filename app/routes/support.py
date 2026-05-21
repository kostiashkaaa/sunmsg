from __future__ import annotations

from flask import Blueprint, flash, jsonify, redirect, render_template, request, session, url_for

from app.database import get_db_connection
from app.extensions import limiter
from app.routes.moderation_access import configured_moderator_ids
from app.services import admin_user_management as admin_user_service
from app.services import moderation as moderation_service
from app.services import support as support_service
from app.services.locale import detect_auth_language, normalize_language

support_bp = Blueprint('support', __name__)


def _auth_user_id() -> int | None:
    return moderation_service.parse_int(session.get('user_id'), min_value=1)


def _is_moderator_user(user_id: int) -> bool:
    conn = get_db_connection()
    try:
        return moderation_service.is_moderator_user(
            conn,
            user_id=int(user_id),
            moderator_ids_override=configured_moderator_ids(),
        )
    finally:
        conn.close()


def _require_moderator_json():
    user_id = _auth_user_id()
    if user_id is None:
        return None, (jsonify({'success': False, 'error': 'auth_required'}), 401)
    if not _is_moderator_user(user_id):
        return None, (jsonify({'success': False, 'error': 'forbidden'}), 403)
    return user_id, None


def _require_moderator_page():
    user_id = _auth_user_id()
    if user_id is None:
        return None, redirect(url_for('auth.index'))
    if not _is_moderator_user(user_id):
        return None, redirect('/chat')
    return user_id, None


def _redirect_support_console_with_lookup(lookup_query: str):
    clean_lookup_query = str(lookup_query or '').strip()
    if clean_lookup_query:
        return redirect(url_for('support.moderation_support_console', user_query=clean_lookup_query))
    return redirect(url_for('support.moderation_support_console'))


@support_bp.route('/support/feedback', methods=['GET'])
@limiter.limit('120 per minute')
def feedback_page():
    user_id = _auth_user_id()
    username = ''
    display_name = ''
    if user_id is not None:
        conn = get_db_connection()
        try:
            row = conn.execute(
                '''
                SELECT username, display_name
                FROM users
                WHERE id = ?
                LIMIT 1
                ''',
                (int(user_id),),
            ).fetchone()
        finally:
            conn.close()
        if row:
            username = str(row['username'] or '')
            display_name = str(row['display_name'] or '')

    ui_language = normalize_language(
        session.get('ui_language') or session.get('guest_ui_language'),
        default=detect_auth_language(request),
    )
    return render_template(
        'support_feedback.html',
        ui_language=ui_language,
        user_id=user_id,
        username=username,
        display_name=display_name,
    )


@support_bp.route('/api/support/requests', methods=['POST'])
@limiter.limit('20 per hour')
def submit_support_request():
    payload = request.get_json(silent=True) or {}
    user_id = _auth_user_id()
    source_page = support_service.normalize_source_page(payload.get('source_page') or 'unknown')
    category = support_service.normalize_category(payload.get('category') or 'general')
    subject = support_service.normalize_subject(payload.get('subject'))
    body = support_service.normalize_body(payload.get('message') or payload.get('body'))
    contact_email = support_service.normalize_email(payload.get('contact_email'))
    contact_handle = support_service.normalize_handle(payload.get('contact_handle'))
    created_by_username = support_service.normalize_handle(payload.get('username'))

    if not subject:
        return jsonify({'success': False, 'error': 'subject_required'}), 400
    if not body:
        return jsonify({'success': False, 'error': 'body_required'}), 400

    conn = get_db_connection()
    try:
        if user_id is not None:
            user_row = conn.execute(
                '''
                SELECT username
                FROM users
                WHERE id = ?
                LIMIT 1
                ''',
                (int(user_id),),
            ).fetchone()
            if user_row:
                created_by_username = str(user_row['username'] or '') or created_by_username

        result = support_service.create_support_request(
            conn,
            created_by_user_id=user_id,
            created_by_username=created_by_username,
            contact_email=contact_email,
            contact_handle=contact_handle,
            source_page=source_page,
            category=category,
            subject=subject,
            body=body,
            priority=support_service.normalize_priority(payload.get('priority')),
            meta={
                'user_agent': str(request.headers.get('User-Agent') or '')[:300],
                'remote_addr': str(request.remote_addr or '')[:120],
            },
        )
    except ValueError as exc:
        conn.rollback()
        return jsonify({'success': False, 'error': str(exc)}), 400
    except Exception:
        conn.rollback()
        return jsonify({'success': False, 'error': 'support_request_create_failed'}), 500
    finally:
        conn.close()

    return jsonify({'success': True, **result})


@support_bp.route('/api/support/requests', methods=['GET'])
@limiter.limit('120 per minute')
def list_support_requests_json():
    _, auth_error = _require_moderator_json()
    if auth_error:
        return auth_error
    status = str(request.args.get('status') or '').strip().lower()
    category = str(request.args.get('category') or '').strip().lower()
    limit = moderation_service.parse_int(request.args.get('limit'), min_value=1, max_value=200) or 50
    offset = moderation_service.parse_int(request.args.get('offset'), min_value=0, max_value=50_000) or 0
    conn = get_db_connection()
    try:
        requests_payload = support_service.list_support_requests(
            conn,
            status=status,
            category=category,
            limit=limit,
            offset=offset,
        )
    finally:
        conn.close()
    return jsonify({'success': True, 'requests': requests_payload})


@support_bp.route('/api/support/requests/<int:request_id>/resolve', methods=['POST'])
@limiter.limit('120 per minute')
def resolve_support_request_json(request_id: int):
    moderator_user_id, auth_error = _require_moderator_json()
    if auth_error:
        return auth_error
    payload = request.get_json(silent=True) or {}
    next_status = str(payload.get('status') or '').strip().lower()
    resolution_note = support_service.normalize_body(payload.get('resolution_note'), max_length=2000)
    assign_to = moderation_service.parse_int(payload.get('assigned_moderator_user_id'), min_value=1)
    conn = get_db_connection()
    try:
        result = support_service.resolve_support_request(
            conn,
            request_id=int(request_id),
            moderator_user_id=int(moderator_user_id),
            next_status=next_status,
            resolution_note=resolution_note,
            assign_to_user_id=assign_to,
        )
    except ValueError as exc:
        conn.rollback()
        message = str(exc)
        status_code = 404 if message == 'support_request_not_found' else 400
        return jsonify({'success': False, 'error': message}), status_code
    except Exception:
        conn.rollback()
        return jsonify({'success': False, 'error': 'support_request_update_failed'}), 500
    finally:
        conn.close()
    return jsonify({'success': True, **result})


@support_bp.route('/api/support/users/lookup', methods=['GET'])
@limiter.limit('120 per minute')
def lookup_users_json():
    _, auth_error = _require_moderator_json()
    if auth_error:
        return auth_error
    query = str(request.args.get('q') or '').strip()
    include_history_raw = str(request.args.get('include_history') or '').strip().lower()
    include_history = include_history_raw in {'1', 'true', 'yes', 'on'}
    if not query:
        return jsonify({'success': True, 'users': []})
    conn = get_db_connection()
    try:
        users = support_service.lookup_users(conn, query=query, limit=20)
        if include_history:
            users = support_service.attach_user_moderation_context(conn, users, history_limit=8)
    finally:
        conn.close()
    return jsonify({'success': True, 'users': users})


@support_bp.route('/api/support/users/<int:target_user_id>/actions', methods=['POST'])
@limiter.limit('120 per minute')
def apply_manual_user_action_json(target_user_id: int):
    moderator_user_id, auth_error = _require_moderator_json()
    if auth_error:
        return auth_error
    payload = request.get_json(silent=True) or {}
    action_type = str(payload.get('action_type') or payload.get('action') or '').strip().lower()
    reason_code = moderation_service.normalize_reason_code(payload.get('reason_code') or 'manual_action')
    duration_seconds = moderation_service.parse_int(payload.get('duration_sec'), min_value=0, max_value=31_536_000) or 0
    note = moderation_service.normalize_comment(payload.get('note'), max_length=512)
    conn = get_db_connection()
    try:
        result = moderation_service.apply_manual_user_action(
            conn,
            target_user_id=int(target_user_id),
            moderator_user_id=int(moderator_user_id),
            action_type=action_type,
            reason_code=reason_code,
            duration_seconds=duration_seconds,
            note=note,
        )
    except ValueError as exc:
        conn.rollback()
        message = str(exc)
        status_code = 404 if message == 'target_user_not_found' else 400
        return jsonify({'success': False, 'error': message}), status_code
    except Exception:
        conn.rollback()
        return jsonify({'success': False, 'error': 'manual_user_action_failed'}), 500
    finally:
        conn.close()
    return jsonify({'success': True, **result})


@support_bp.route('/api/support/users/<int:target_user_id>/rename', methods=['POST'])
@limiter.limit('120 per minute')
def rename_user_json(target_user_id: int):
    moderator_user_id, auth_error = _require_moderator_json()
    if auth_error:
        return auth_error
    payload = request.get_json(silent=True) or {}
    new_username = str(payload.get('new_username') or '').strip()
    conn = get_db_connection()
    try:
        result = admin_user_service.rename_user_username(
            conn,
            target_user_id=int(target_user_id),
            new_username=new_username,
            moderator_user_id=int(moderator_user_id),
        )
    except ValueError as exc:
        conn.rollback()
        message = str(exc)
        status_code = 404 if message == 'target_user_not_found' else 400
        return jsonify({'success': False, 'error': message}), status_code
    except Exception:
        conn.rollback()
        return jsonify({'success': False, 'error': 'user_rename_failed'}), 500
    finally:
        conn.close()
    return jsonify({'success': True, **result})


@support_bp.route('/api/support/users/<int:target_user_id>/clear_restrictions', methods=['POST'])
@limiter.limit('120 per minute')
def clear_user_restrictions_json(target_user_id: int):
    moderator_user_id, auth_error = _require_moderator_json()
    if auth_error:
        return auth_error
    payload = request.get_json(silent=True) or {}
    note = moderation_service.normalize_comment(payload.get('note'), max_length=512)
    conn = get_db_connection()
    try:
        result = admin_user_service.clear_user_active_sanctions(
            conn,
            target_user_id=int(target_user_id),
            moderator_user_id=int(moderator_user_id),
            note=note,
        )
    except ValueError as exc:
        conn.rollback()
        message = str(exc)
        status_code = 404 if message == 'target_user_not_found' else 400
        return jsonify({'success': False, 'error': message}), status_code
    except Exception:
        conn.rollback()
        return jsonify({'success': False, 'error': 'clear_restrictions_failed'}), 500
    finally:
        conn.close()
    return jsonify({'success': True, **result})


@support_bp.route('/api/support/users/<int:target_user_id>/delete', methods=['POST'])
@limiter.limit('30 per minute')
def delete_user_json(target_user_id: int):
    moderator_user_id, auth_error = _require_moderator_json()
    if auth_error:
        return auth_error
    if int(target_user_id) == int(moderator_user_id):
        return jsonify({'success': False, 'error': 'cannot_delete_self'}), 400
    conn = get_db_connection()
    try:
        result = admin_user_service.delete_user_account_hard(
            conn,
            target_user_id=int(target_user_id),
            moderator_user_id=int(moderator_user_id),
            remote_addr=str(request.remote_addr or ''),
        )
    except ValueError as exc:
        conn.rollback()
        message = str(exc)
        status_code = 404 if message == 'target_user_not_found' else 400
        return jsonify({'success': False, 'error': message}), status_code
    except Exception:
        conn.rollback()
        return jsonify({'success': False, 'error': 'user_delete_failed'}), 500
    finally:
        conn.close()
    return jsonify({'success': True, **result})


@support_bp.route('/moderation/console/support', methods=['GET'])
@limiter.limit('120 per minute')
def moderation_support_console():
    _, page_error = _require_moderator_page()
    if page_error:
        return page_error
    status = str(request.args.get('status') or 'open').strip().lower()
    category = str(request.args.get('category') or '').strip().lower()
    limit = moderation_service.parse_int(request.args.get('limit'), min_value=1, max_value=200) or 50
    offset = moderation_service.parse_int(request.args.get('offset'), min_value=0, max_value=50_000) or 0
    refresh_seconds = moderation_service.parse_int(request.args.get('refresh'), min_value=5, max_value=300) or 20
    lookup_query = str(request.args.get('user_query') or '').strip()

    conn = get_db_connection()
    try:
        requests_payload = support_service.list_support_requests(
            conn,
            status=status,
            category=category,
            limit=limit,
            offset=offset,
        )
        users = support_service.lookup_users(conn, query=lookup_query, limit=20) if lookup_query else []
        if users:
            users = support_service.attach_user_moderation_context(conn, users, history_limit=8)
        metrics = moderation_service.moderation_metrics(conn, since_hours=24)
    finally:
        conn.close()

    return render_template(
        'moderation_support_console.html',
        requests=requests_payload,
        users=users,
        metrics=metrics,
        status=status,
        category=category,
        limit=limit,
        offset=offset,
        refresh_seconds=refresh_seconds,
        lookup_query=lookup_query,
    )


@support_bp.route('/moderation/console/support/<int:request_id>/resolve', methods=['POST'])
@limiter.limit('120 per minute')
def moderation_support_console_resolve(request_id: int):
    moderator_user_id, page_error = _require_moderator_page()
    if page_error:
        return page_error

    next_status = str(request.form.get('status') or '').strip().lower()
    resolution_note = support_service.normalize_body(request.form.get('resolution_note'), max_length=2000)
    conn = get_db_connection()
    try:
        support_service.resolve_support_request(
            conn,
            request_id=int(request_id),
            moderator_user_id=int(moderator_user_id),
            next_status=next_status,
            resolution_note=resolution_note,
            assign_to_user_id=int(moderator_user_id),
        )
    except ValueError as exc:
        conn.rollback()
        flash(f'Support request update failed: {str(exc)}', 'error')
    except Exception:
        conn.rollback()
        flash('Support request update failed: internal error', 'error')
    else:
        flash('Support request updated', 'success')
    finally:
        conn.close()
    return redirect(url_for('support.moderation_support_console'))


@support_bp.route('/moderation/console/users/<int:target_user_id>/action', methods=['POST'])
@limiter.limit('120 per minute')
def moderation_console_apply_manual_user_action(target_user_id: int):
    moderator_user_id, page_error = _require_moderator_page()
    if page_error:
        return page_error

    action_type = str(request.form.get('action_type') or '').strip().lower()
    reason_code = moderation_service.normalize_reason_code(request.form.get('reason_code') or 'manual_action')
    duration_seconds = moderation_service.parse_int(
        request.form.get('duration_sec'),
        min_value=0,
        max_value=31_536_000,
    ) or 0
    note = moderation_service.normalize_comment(request.form.get('note'), max_length=512)
    lookup_query = str(request.form.get('lookup_query') or '').strip()

    conn = get_db_connection()
    try:
        moderation_service.apply_manual_user_action(
            conn,
            target_user_id=int(target_user_id),
            moderator_user_id=int(moderator_user_id),
            action_type=action_type,
            reason_code=reason_code,
            duration_seconds=duration_seconds,
            note=note,
        )
    except ValueError as exc:
        conn.rollback()
        flash(f'User action failed: {str(exc)}', 'error')
    except Exception:
        conn.rollback()
        flash('User action failed: internal error', 'error')
    else:
        flash('User action applied', 'success')
    finally:
        conn.close()

    return _redirect_support_console_with_lookup(lookup_query)


@support_bp.route('/moderation/console/users/<int:target_user_id>/rename', methods=['POST'])
@limiter.limit('120 per minute')
def moderation_console_rename_user(target_user_id: int):
    moderator_user_id, page_error = _require_moderator_page()
    if page_error:
        return page_error

    lookup_query = str(request.form.get('lookup_query') or '').strip()
    new_username = str(request.form.get('new_username') or '').strip()

    conn = get_db_connection()
    try:
        result = admin_user_service.rename_user_username(
            conn,
            target_user_id=int(target_user_id),
            new_username=new_username,
            moderator_user_id=int(moderator_user_id),
        )
    except ValueError as exc:
        conn.rollback()
        error_map = {
            'target_user_not_found': 'Пользователь не найден.',
            'username_too_short': 'Никнейм должен содержать минимум 2 символа.',
            'username_too_long': 'Никнейм не должен превышать 50 символов.',
            'invalid_username': 'Никнейм может содержать только a-z, 0-9 и _.',
            'username_taken': 'Этот никнейм уже занят.',
        }
        flash(error_map.get(str(exc), f'Rename failed: {str(exc)}'), 'error')
    except Exception:
        conn.rollback()
        flash('Rename failed: internal error', 'error')
    else:
        if result.get('updated'):
            flash(f'Никнейм изменён: @{result["old_username"]} -> @{result["new_username"]}', 'success')
        else:
            flash('Никнейм не изменён: уже установлено это значение.', 'success')
    finally:
        conn.close()

    return _redirect_support_console_with_lookup(lookup_query)


@support_bp.route('/moderation/console/users/<int:target_user_id>/clear_restrictions', methods=['POST'])
@limiter.limit('120 per minute')
def moderation_console_clear_user_restrictions(target_user_id: int):
    moderator_user_id, page_error = _require_moderator_page()
    if page_error:
        return page_error

    lookup_query = str(request.form.get('lookup_query') or '').strip()
    note = moderation_service.normalize_comment(request.form.get('note'), max_length=512)

    conn = get_db_connection()
    try:
        result = admin_user_service.clear_user_active_sanctions(
            conn,
            target_user_id=int(target_user_id),
            moderator_user_id=int(moderator_user_id),
            note=note,
        )
    except ValueError as exc:
        conn.rollback()
        error_map = {
            'target_user_not_found': 'Пользователь не найден.',
        }
        flash(error_map.get(str(exc), f'Clear restrictions failed: {str(exc)}'), 'error')
    except Exception:
        conn.rollback()
        flash('Clear restrictions failed: internal error', 'error')
    else:
        flash(f'Снято активных ограничений: {int(result["reversed_count"])}', 'success')
    finally:
        conn.close()

    return _redirect_support_console_with_lookup(lookup_query)


@support_bp.route('/moderation/console/users/<int:target_user_id>/delete', methods=['POST'])
@limiter.limit('30 per minute')
def moderation_console_delete_user(target_user_id: int):
    moderator_user_id, page_error = _require_moderator_page()
    if page_error:
        return page_error

    lookup_query = str(request.form.get('lookup_query') or '').strip()
    confirm_text = str(request.form.get('confirm_text') or '').strip().upper()
    if confirm_text != 'DELETE':
        flash('Для удаления введите DELETE в поле подтверждения.', 'error')
        return _redirect_support_console_with_lookup(lookup_query)
    if int(target_user_id) == int(moderator_user_id):
        flash('Нельзя удалить самого себя через админ-консоль.', 'error')
        return _redirect_support_console_with_lookup(lookup_query)

    conn = get_db_connection()
    try:
        result = admin_user_service.delete_user_account_hard(
            conn,
            target_user_id=int(target_user_id),
            moderator_user_id=int(moderator_user_id),
            remote_addr=str(request.remote_addr or ''),
        )
    except ValueError as exc:
        conn.rollback()
        error_map = {
            'target_user_not_found': 'Пользователь не найден.',
        }
        flash(error_map.get(str(exc), f'Delete failed: {str(exc)}'), 'error')
    except Exception:
        conn.rollback()
        flash('Delete failed: internal error', 'error')
    else:
        flash(f'Пользователь @{result["target_username"]} удалён.', 'success')
    finally:
        conn.close()

    return _redirect_support_console_with_lookup(lookup_query)
