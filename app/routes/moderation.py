from __future__ import annotations

import json

from flask import Blueprint, Response, current_app, flash, jsonify, redirect, render_template, request, session, url_for

from app.database import get_db_connection
from app.extensions import limiter
from app.services import call_feature_access
from app.services import moderation as moderation_service

moderation_bp = Blueprint('moderation', __name__)


def _require_auth_user_id():
    user_id = session.get('user_id')
    parsed = moderation_service.parse_int(user_id, min_value=1)
    if parsed is None:
        return None, (jsonify({'success': False, 'error': 'auth_required'}), 401)
    return parsed, None


def _moderator_ids() -> set[int]:
    raw_ids = str(current_app.config.get('MODERATOR_USER_IDS') or '').strip()
    return moderation_service.moderator_id_set(raw_ids)


def _is_moderator_user(user_id: int) -> bool:
    conn = get_db_connection()
    try:
        return moderation_service.is_moderator_user(
            conn,
            user_id=user_id,
            moderator_ids_override=_moderator_ids(),
        )
    finally:
        conn.close()


def _blocked_public_domains() -> list[str]:
    raw = str(current_app.config.get('MODERATION_BLOCKED_PUBLIC_DOMAINS') or '').strip()
    return moderation_service.parse_csv(raw)


def _high_risk_ip_cidrs() -> list[str]:
    raw = str(current_app.config.get('MODERATION_HIGH_RISK_IP_CIDRS') or '').strip()
    return moderation_service.parse_csv(raw)


def _require_moderator_json():
    user_id, auth_error = _require_auth_user_id()
    if auth_error:
        return None, auth_error
    if not _is_moderator_user(user_id):
        return None, (jsonify({'success': False, 'error': 'forbidden'}), 403)
    return user_id, None


def _triage_settings() -> dict:
    return {
        'auto_action_threshold': float(current_app.config.get('MODERATION_AUTO_ACTION_THRESHOLD', 0.85)),
        'auto_action_type': str(current_app.config.get('MODERATION_AUTO_ACTION_TYPE') or 'mute_temp').strip().lower(),
        'auto_action_ttl_seconds': int(current_app.config.get('MODERATION_AUTO_ACTION_TTL_SECONDS', 3600) or 0),
        'rate_window_seconds': int(current_app.config.get('MODERATION_REPORT_RATE_WINDOW_SECONDS', 3600) or 3600),
        'repeat_window_days': int(current_app.config.get('MODERATION_REPEAT_WINDOW_DAYS', 90) or 90),
        'rate_threshold': int(current_app.config.get('MODERATION_REPORT_RATE_THRESHOLD', 5) or 5),
        'high_risk_ip_cidrs': _high_risk_ip_cidrs(),
    }


def _sla_by_priority_seconds() -> dict[int, int]:
    return {
        1: int(current_app.config.get('MODERATION_SLA_PRIORITY_1_SECONDS', 15 * 60) or 15 * 60),
        2: int(current_app.config.get('MODERATION_SLA_PRIORITY_2_SECONDS', 60 * 60) or 60 * 60),
        3: int(current_app.config.get('MODERATION_SLA_PRIORITY_3_SECONDS', 4 * 60 * 60) or 4 * 60 * 60),
        4: int(current_app.config.get('MODERATION_SLA_PRIORITY_4_SECONDS', 12 * 60 * 60) or 12 * 60 * 60),
    }


@moderation_bp.route('/api/moderation/reports', methods=['POST'])
@limiter.limit('30 per minute')
def moderation_submit_report():
    user_id, auth_error = _require_auth_user_id()
    if auth_error:
        return auth_error

    payload = request.get_json(silent=True) or {}
    target_type = moderation_service.normalize_target_type(payload.get('target_type'))
    target_id = moderation_service.normalize_target_id(payload.get('target_id'))
    if not target_type or not target_id:
        return jsonify({'success': False, 'error': 'invalid_target'}), 400

    message_id = moderation_service.parse_int(payload.get('message_id'), min_value=1)
    reason_code = moderation_service.normalize_reason_code(payload.get('reason_code'))
    subreason_code = moderation_service.normalize_optional_code(payload.get('subreason_code'))
    comment = moderation_service.normalize_comment(payload.get('comment'))

    idempotency_key = (
        moderation_service.normalize_idempotency_key(request.headers.get('Idempotency-Key'))
        or moderation_service.normalize_idempotency_key(payload.get('idempotency_key'))
        or moderation_service.normalize_idempotency_key(payload.get('client_event_id'))
    )
    if not idempotency_key:
        return jsonify({'success': False, 'error': 'idempotency_key_required'}), 400

    remote_ip = str(request.remote_addr or '').strip()
    async_enabled = bool(current_app.config.get('MODERATION_REPORT_ASYNC_ENABLED', True))
    settings = _triage_settings()

    conn = get_db_connection()
    try:
        if async_enabled:
            result = moderation_service.create_report_and_enqueue(
                conn,
                reporter_user_id=user_id,
                target_type=target_type,
                target_id=target_id,
                message_id=message_id,
                reason_code=reason_code,
                subreason_code=subreason_code,
                comment=comment,
                idempotency_key=idempotency_key,
                remote_ip=remote_ip,
            )
        else:
            result = moderation_service.create_report_and_case(
                conn,
                reporter_user_id=user_id,
                target_type=target_type,
                target_id=target_id,
                message_id=message_id,
                reason_code=reason_code,
                subreason_code=subreason_code,
                comment=comment,
                idempotency_key=idempotency_key,
                remote_ip=remote_ip,
                **settings,
            )
    except ValueError as exc:
        conn.rollback()
        return jsonify({'success': False, 'error': str(exc)}), 400
    except Exception:
        conn.rollback()
        return jsonify({'success': False, 'error': 'report_submit_failed'}), 500
    finally:
        conn.close()

    return jsonify(
        {
            'success': True,
            'report_id': result['report_id'],
            'case_id': result.get('case_id') or None,
            'created': result['created'],
            'status': result.get('status', 'received'),
            'action_applied': result.get('action_applied'),
            'risk_score': result.get('risk_score'),
            'confidence': result.get('confidence'),
            'next_poll_after_sec': 30,
        }
    )


@moderation_bp.route('/api/moderation/reports/<int:report_id>', methods=['GET'])
@limiter.limit('120 per minute')
def moderation_get_report_status(report_id: int):
    user_id, auth_error = _require_auth_user_id()
    if auth_error:
        return auth_error

    conn = get_db_connection()
    try:
        status = moderation_service.report_status(
            conn,
            report_id=int(report_id),
            reporter_user_id=user_id,
        )
    finally:
        conn.close()

    if not status:
        return jsonify({'success': False, 'error': 'report_not_found'}), 404
    return jsonify({'success': True, **status})


@moderation_bp.route('/api/moderation/cases', methods=['GET'])
@limiter.limit('120 per minute')
def moderation_list_cases():
    user_id, auth_error = _require_moderator_json()
    if auth_error:
        return auth_error

    state = str(request.args.get('state') or '').strip().lower()
    limit = moderation_service.parse_int(request.args.get('limit'), min_value=1, max_value=200) or 50
    offset = moderation_service.parse_int(request.args.get('offset'), min_value=0, max_value=50_000) or 0

    conn = get_db_connection()
    try:
        cases = moderation_service.list_cases(
            conn,
            state=state,
            limit=limit,
            offset=offset,
        )
    finally:
        conn.close()
    return jsonify({'success': True, 'cases': cases})


@moderation_bp.route('/api/moderation/cases/<int:case_id>/actions', methods=['POST'])
@limiter.limit('120 per minute')
def moderation_apply_case_action(case_id: int):
    user_id, auth_error = _require_moderator_json()
    if auth_error:
        return auth_error

    payload = request.get_json(silent=True) or {}
    action_type = str(payload.get('action') or payload.get('action_type') or '').strip().lower()
    if not action_type:
        return jsonify({'success': False, 'error': 'action_required'}), 400
    reason_code = moderation_service.normalize_reason_code(payload.get('reason_code') or 'manual_action')
    duration_seconds = moderation_service.parse_int(payload.get('duration_sec'), min_value=0, max_value=31_536_000) or 0
    note = moderation_service.normalize_comment(payload.get('note'), max_length=512)

    conn = get_db_connection()
    try:
        result = moderation_service.apply_case_action(
            conn,
            case_id=int(case_id),
            moderator_user_id=user_id,
            action_type=action_type,
            reason_code=reason_code,
            duration_seconds=duration_seconds,
            note=note,
        )
    except ValueError as exc:
        conn.rollback()
        return jsonify({'success': False, 'error': str(exc)}), 404
    except Exception:
        conn.rollback()
        return jsonify({'success': False, 'error': 'case_action_failed'}), 500
    finally:
        conn.close()

    return jsonify({'success': True, **result})


@moderation_bp.route('/api/moderation/appeals', methods=['POST'])
@limiter.limit('30 per minute')
def moderation_submit_appeal():
    user_id, auth_error = _require_auth_user_id()
    if auth_error:
        return auth_error

    payload = request.get_json(silent=True) or {}
    sanction_id = moderation_service.parse_int(payload.get('sanction_id'), min_value=1)
    if sanction_id is None:
        return jsonify({'success': False, 'error': 'invalid_sanction_id'}), 400
    text = moderation_service.normalize_comment(payload.get('text'), max_length=2000)

    conn = get_db_connection()
    try:
        result = moderation_service.submit_appeal(
            conn,
            sanction_id=sanction_id,
            appellant_user_id=user_id,
            text=text,
        )
    except ValueError as exc:
        conn.rollback()
        message = str(exc)
        status = 404 if message == 'sanction_not_found' else 403
        return jsonify({'success': False, 'error': message}), status
    except Exception:
        conn.rollback()
        return jsonify({'success': False, 'error': 'appeal_submit_failed'}), 500
    finally:
        conn.close()

    return jsonify({'success': True, **result})


@moderation_bp.route('/api/moderation/appeals/<int:appeal_id>', methods=['GET'])
@limiter.limit('120 per minute')
def moderation_get_appeal(appeal_id: int):
    user_id, auth_error = _require_auth_user_id()
    if auth_error:
        return auth_error
    allow_moderator_view = _is_moderator_user(user_id)

    conn = get_db_connection()
    try:
        row = conn.execute(
            '''
            SELECT
                a.id,
                a.sanction_id,
                a.appellant_user_id,
                a.state,
                a.reviewer_user_id,
                a.resolution_note,
                a.created_at,
                a.resolved_at
            FROM moderation_appeals a
            WHERE a.id = ?
              AND (? = 1 OR a.appellant_user_id = ?)
            LIMIT 1
            ''',
            (appeal_id, 1 if allow_moderator_view else 0, user_id),
        ).fetchone()
    finally:
        conn.close()

    if not row:
        return jsonify({'success': False, 'error': 'appeal_not_found'}), 404
    return jsonify(
        {
            'success': True,
            'appeal_id': int(row['id']),
            'sanction_id': int(row['sanction_id']),
            'appellant_user_id': int(row['appellant_user_id']),
            'state': str(row['state']),
            'reviewer_user_id': int(row['reviewer_user_id']) if row['reviewer_user_id'] is not None else None,
            'resolution_note': str(row['resolution_note'] or ''),
            'created_at': str(row['created_at'] or ''),
            'resolved_at': str(row['resolved_at'] or ''),
        }
    )


@moderation_bp.route('/api/moderation/appeals', methods=['GET'])
@limiter.limit('120 per minute')
def moderation_list_appeals():
    _, auth_error = _require_moderator_json()
    if auth_error:
        return auth_error
    state = str(request.args.get('state') or '').strip().lower()
    limit = moderation_service.parse_int(request.args.get('limit'), min_value=1, max_value=200) or 50
    offset = moderation_service.parse_int(request.args.get('offset'), min_value=0, max_value=50_000) or 0
    conn = get_db_connection()
    try:
        appeals = moderation_service.list_appeals(conn, state=state, limit=limit, offset=offset)
    finally:
        conn.close()
    return jsonify({'success': True, 'appeals': appeals})


@moderation_bp.route('/api/moderation/appeals/<int:appeal_id>/resolve', methods=['POST'])
@limiter.limit('120 per minute')
def moderation_resolve_appeal(appeal_id: int):
    user_id, auth_error = _require_moderator_json()
    if auth_error:
        return auth_error
    payload = request.get_json(silent=True) or {}
    resolution = str(payload.get('resolution') or '').strip().lower()
    resolution_note = moderation_service.normalize_comment(payload.get('resolution_note'), max_length=2000)
    conn = get_db_connection()
    try:
        result = moderation_service.resolve_appeal(
            conn,
            appeal_id=int(appeal_id),
            reviewer_user_id=user_id,
            resolution=resolution,
            resolution_note=resolution_note,
        )
    except ValueError as exc:
        conn.rollback()
        message = str(exc)
        status = 404 if message == 'appeal_not_found' else 400
        return jsonify({'success': False, 'error': message}), status
    except Exception:
        conn.rollback()
        return jsonify({'success': False, 'error': 'appeal_resolve_failed'}), 500
    finally:
        conn.close()
    return jsonify({'success': True, **result})


@moderation_bp.route('/api/moderation/metrics', methods=['GET'])
@limiter.limit('120 per minute')
def moderation_get_metrics():
    _, auth_error = _require_moderator_json()
    if auth_error:
        return auth_error
    since_hours = moderation_service.parse_int(request.args.get('hours'), min_value=1, max_value=24 * 90) or 24
    conn = get_db_connection()
    try:
        metrics = moderation_service.moderation_metrics(conn, since_hours=since_hours)
    finally:
        conn.close()
    return jsonify({'success': True, **metrics})


@moderation_bp.route('/metrics/moderation', methods=['GET'])
@limiter.limit('120 per minute')
def moderation_prometheus_metrics():
    _, auth_error = _require_moderator_json()
    if auth_error:
        return auth_error
    since_hours = moderation_service.parse_int(request.args.get('hours'), min_value=1, max_value=24 * 90) or 24
    conn = get_db_connection()
    try:
        metrics = moderation_service.moderation_metrics(conn, since_hours=since_hours)
    finally:
        conn.close()
    body = moderation_service.moderation_metrics_prometheus_text(metrics)
    return Response(body, mimetype='text/plain')


@moderation_bp.route('/moderation/console', methods=['GET'])
@limiter.limit('120 per minute')
def moderation_console():
    user_id, auth_error = _require_auth_user_id()
    if auth_error:
        return redirect(url_for('auth.login'))
    if not _is_moderator_user(user_id):
        return redirect('/chat')

    state = str(request.args.get('state') or 'open').strip().lower()
    limit = moderation_service.parse_int(request.args.get('limit'), min_value=1, max_value=200) or 50
    offset = moderation_service.parse_int(request.args.get('offset'), min_value=0, max_value=50_000) or 0
    refresh_seconds = moderation_service.parse_int(request.args.get('refresh'), min_value=5, max_value=300) or 15

    conn = get_db_connection()
    try:
        cases = moderation_service.list_cases(conn, state=state, limit=limit, offset=offset)
        metrics = moderation_service.moderation_metrics(conn, since_hours=24)
        call_feature = call_feature_access.call_feature_state(conn)
    finally:
        conn.close()

    return render_template(
        'moderation_console.html',
        cases=cases,
        metrics=metrics,
        state=state,
        limit=limit,
        offset=offset,
        refresh_seconds=refresh_seconds,
        sla_by_priority_seconds=_sla_by_priority_seconds(),
        call_feature=call_feature,
    )


@moderation_bp.route('/moderation/console/calls/settings', methods=['POST'])
@limiter.limit('30 per minute')
def moderation_console_update_call_settings():
    user_id, auth_error = _require_auth_user_id()
    if auth_error:
        return redirect(url_for('auth.login'))
    if not _is_moderator_user(user_id):
        return redirect('/chat')

    allowlist_enabled = str(request.form.get('allowlist_enabled') or '').strip() == '1'
    conn = get_db_connection()
    try:
        call_feature_access.set_call_allowlist_enabled(
            conn,
            enabled=allowlist_enabled,
            actor_user_id=user_id,
        )
        moderation_service.add_audit_log(
            conn,
            actor_type='moderator',
            actor_id=str(user_id),
            action='call_feature_settings_update',
            entity_type='call_feature',
            entity_id='allowlist_enabled',
            details_json=json.dumps({'allowlist_enabled': allowlist_enabled}, ensure_ascii=False),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        flash('Не удалось обновить доступ к звонкам', 'error')
    else:
        flash('Настройки звонков обновлены', 'success')
    finally:
        conn.close()
    return redirect(url_for('moderation.moderation_console'))


@moderation_bp.route('/moderation/console/calls/allowlist', methods=['POST'])
@limiter.limit('60 per minute')
def moderation_console_grant_call_access():
    user_id, auth_error = _require_auth_user_id()
    if auth_error:
        return redirect(url_for('auth.login'))
    if not _is_moderator_user(user_id):
        return redirect('/chat')

    identifier = str(request.form.get('identifier') or '').strip()
    note = moderation_service.normalize_comment(request.form.get('note'), max_length=512)
    if not identifier:
        flash('Укажите ID или username пользователя', 'error')
        return redirect(url_for('moderation.moderation_console'))

    conn = get_db_connection()
    try:
        granted_user = call_feature_access.grant_call_access(
            conn,
            identifier=identifier,
            granted_by_user_id=user_id,
            note=note,
        )
        moderation_service.add_audit_log(
            conn,
            actor_type='moderator',
            actor_id=str(user_id),
            action='call_feature_access_grant',
            entity_type='user',
            entity_id=str(granted_user['user_id']),
            details_json=json.dumps({'identifier': identifier, 'note': note}, ensure_ascii=False),
        )
        conn.commit()
    except ValueError as exc:
        conn.rollback()
        message = 'Пользователь не найден' if str(exc) == 'user_not_found' else 'Не удалось выдать доступ'
        flash(message, 'error')
    except Exception:
        conn.rollback()
        flash('Не удалось выдать доступ к звонкам', 'error')
    else:
        flash('Доступ к звонкам выдан', 'success')
    finally:
        conn.close()
    return redirect(url_for('moderation.moderation_console'))


@moderation_bp.route('/moderation/console/calls/allowlist/<int:target_user_id>/delete', methods=['POST'])
@limiter.limit('60 per minute')
def moderation_console_revoke_call_access(target_user_id: int):
    user_id, auth_error = _require_auth_user_id()
    if auth_error:
        return redirect(url_for('auth.login'))
    if not _is_moderator_user(user_id):
        return redirect('/chat')

    conn = get_db_connection()
    try:
        removed = call_feature_access.revoke_call_access(conn, user_id=int(target_user_id))
        moderation_service.add_audit_log(
            conn,
            actor_type='moderator',
            actor_id=str(user_id),
            action='call_feature_access_revoke',
            entity_type='user',
            entity_id=str(target_user_id),
            details_json=json.dumps({'removed': removed}, ensure_ascii=False),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        flash('Не удалось убрать доступ к звонкам', 'error')
    else:
        flash('Доступ к звонкам убран' if removed else 'Пользователя не было в списке доступа', 'success')
    finally:
        conn.close()
    return redirect(url_for('moderation.moderation_console'))


@moderation_bp.route('/moderation/console/cases/<int:case_id>/action', methods=['POST'])
@limiter.limit('120 per minute')
def moderation_console_apply_action(case_id: int):
    user_id, auth_error = _require_auth_user_id()
    if auth_error:
        return redirect(url_for('auth.login'))
    if not _is_moderator_user(user_id):
        return redirect('/chat')

    action_type = str(request.form.get('action_type') or '').strip().lower()
    reason_code = moderation_service.normalize_reason_code(request.form.get('reason_code') or 'manual_action')
    duration_seconds = moderation_service.parse_int(
        request.form.get('duration_sec'),
        min_value=0,
        max_value=31_536_000,
    ) or 0
    note = moderation_service.normalize_comment(request.form.get('note'), max_length=512)

    conn = get_db_connection()
    try:
        moderation_service.apply_case_action(
            conn,
            case_id=int(case_id),
            moderator_user_id=user_id,
            action_type=action_type,
            reason_code=reason_code,
            duration_seconds=duration_seconds,
            note=note,
        )
    except ValueError as exc:
        conn.rollback()
        flash(f'Action failed: {str(exc)}', 'error')
    except Exception:
        conn.rollback()
        flash('Action failed: internal error', 'error')
    else:
        flash('Action applied', 'success')
    finally:
        conn.close()
    return redirect(url_for('moderation.moderation_console'))


@moderation_bp.route('/moderation/console/sanctions/<int:sanction_id>/lift', methods=['POST'])
@limiter.limit('120 per minute')
def moderation_console_lift_sanction(sanction_id: int):
    user_id, auth_error = _require_auth_user_id()
    if auth_error:
        return redirect(url_for('auth.login'))
    if not _is_moderator_user(user_id):
        return redirect('/chat')

    note = moderation_service.normalize_comment(request.form.get('note'), max_length=512)

    conn = get_db_connection()
    try:
        moderation_service.lift_sanction(
            conn,
            sanction_id=int(sanction_id),
            moderator_user_id=user_id,
            note=note,
        )
    except ValueError as exc:
        conn.rollback()
        flash(f'Lift failed: {str(exc)}', 'error')
    except Exception:
        conn.rollback()
        flash('Lift failed: internal error', 'error')
    else:
        flash('Restriction lifted', 'success')
    finally:
        conn.close()
    return redirect(url_for('moderation.moderation_console'))


@moderation_bp.route('/moderation/console/appeals', methods=['GET'])
@limiter.limit('120 per minute')
def moderation_console_appeals():
    user_id, auth_error = _require_auth_user_id()
    if auth_error:
        return redirect(url_for('auth.login'))
    if not _is_moderator_user(user_id):
        return redirect('/chat')

    state = str(request.args.get('state') or 'submitted').strip().lower()
    limit = moderation_service.parse_int(request.args.get('limit'), min_value=1, max_value=200) or 50
    offset = moderation_service.parse_int(request.args.get('offset'), min_value=0, max_value=50_000) or 0
    refresh_seconds = moderation_service.parse_int(request.args.get('refresh'), min_value=5, max_value=300) or 15

    conn = get_db_connection()
    try:
        appeals = moderation_service.list_appeals(conn, state=state, limit=limit, offset=offset)
        metrics = moderation_service.moderation_metrics(conn, since_hours=24)
    finally:
        conn.close()

    return render_template(
        'moderation_appeals_console.html',
        appeals=appeals,
        metrics=metrics,
        state=state,
        limit=limit,
        offset=offset,
        refresh_seconds=refresh_seconds,
    )


@moderation_bp.route('/moderation/console/appeals/<int:appeal_id>/resolve', methods=['POST'])
@limiter.limit('120 per minute')
def moderation_console_resolve_appeal(appeal_id: int):
    user_id, auth_error = _require_auth_user_id()
    if auth_error:
        return redirect(url_for('auth.login'))
    if not _is_moderator_user(user_id):
        return redirect('/chat')

    resolution = str(request.form.get('resolution') or '').strip().lower()
    resolution_note = moderation_service.normalize_comment(request.form.get('resolution_note'), max_length=2000)

    conn = get_db_connection()
    try:
        moderation_service.resolve_appeal(
            conn,
            appeal_id=int(appeal_id),
            reviewer_user_id=user_id,
            resolution=resolution,
            resolution_note=resolution_note,
        )
    except ValueError as exc:
        conn.rollback()
        flash(f'Appeal resolution failed: {str(exc)}', 'error')
    except Exception:
        conn.rollback()
        flash('Appeal resolution failed: internal error', 'error')
    else:
        flash('Appeal resolved', 'success')
    finally:
        conn.close()
    return redirect(url_for('moderation.moderation_console_appeals'))


def pre_moderation_public_link_check(message_text: str) -> dict:
    return moderation_service.evaluate_public_links(
        message_text,
        blocked_domains=_blocked_public_domains(),
    )
