import time

from flask import current_app, jsonify, make_response, request, session

from app.database import get_db_connection
from app.extensions import limiter
from app.routes.auth_helpers_sessions import current_refresh_family_id
from app.services.refresh_tokens import (
    REFRESH_COOKIE_NAME,
    SESSION_TOKEN_TTL_SECONDS,
    clear_refresh_cookie,
    set_refresh_cookie,
)
from app.services.session_policy import (
    apply_session_auto_logout,
    parse_session_auto_logout_seconds,
    session_auto_logout_payload,
    session_auto_logout_options,
    session_auto_logout_seconds_from_row,
)
from .context import auth_bp

@auth_bp.route('/api/session_devices', methods=['GET'])
@limiter.limit("30 per minute")
def api_session_devices():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401

    user_id = int(session['user_id'])
    now = int(time.time())
    conn = get_db_connection()
    try:
        current_family_id = current_refresh_family_id(conn, request.cookies.get(REFRESH_COOKIE_NAME))
        policy_row = conn.execute(
            'SELECT session_auto_logout_seconds FROM users WHERE id = ?',
            (user_id,),
        ).fetchone()
        rows = conn.execute(
            '''
            SELECT family_id, created_at, last_used_at, expires_at, user_agent, ip
            FROM refresh_tokens
            WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
            ORDER BY COALESCE(last_used_at, created_at) DESC, created_at DESC
            ''',
            (user_id, now),
        ).fetchall()
    finally:
        conn.close()

    devices = []
    for row in rows:
        created = int(row['created_at'] or 0)
        expires = int(row['expires_at'] or 0)
        # Refresh-cookie devices use the user-selected auto-logout TTL.
        persistent = (expires - created) > SESSION_TOKEN_TTL_SECONDS
        devices.append({
            'family_id': str(row['family_id']),
            'created_at': created,
            'last_used_at': int(row['last_used_at'] or created),
            'expires_at': expires,
            'user_agent': str(row['user_agent'] or '').strip(),
            'ip': str(row['ip'] or '').strip(),
            'is_current': bool(current_family_id and str(row['family_id']) == current_family_id),
            'persistent': persistent,
        })

    has_current_device = any(bool(device.get('is_current')) for device in devices)
    if not has_current_device:
        ip_candidates = (
            request.headers.get('CF-Connecting-IP'),
            request.headers.get('True-Client-IP'),
            request.headers.get('X-Real-IP'),
            (request.headers.get('X-Forwarded-For') or '').split(',')[0],
            request.remote_addr,
        )
        current_ip = ''
        for value in ip_candidates:
            parsed = str(value or '').strip()
            if parsed:
                current_ip = parsed[:64]
                break
        devices.append(
            {
                'family_id': '',
                'created_at': now,
                'last_used_at': now,
                'expires_at': now,
                'user_agent': (request.headers.get('User-Agent') or '')[:255],
                'ip': current_ip,
                'is_current': True,
                'persistent': False,
            }
        )

    return jsonify({
        'success': True,
        'devices': devices,
        'session_auto_logout_seconds': session_auto_logout_seconds_from_row(policy_row),
        'session_expires_at': session_auto_logout_payload(session)['session_expires_at'],
        'session_auto_logout_options': session_auto_logout_options(),
    })

@auth_bp.route('/api/session_devices/auto_logout', methods=['POST'])
@limiter.limit("20 per minute")
def api_update_session_auto_logout():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401

    data = request.get_json(silent=True) or {}
    seconds = parse_session_auto_logout_seconds(data.get('session_auto_logout_seconds'))
    if seconds is None:
        return jsonify({'success': False, 'error': 'Недопустимый срок завершения сессии.'}), 400

    user_id = int(session['user_id'])
    now = int(time.time())
    new_expires_at = now + seconds
    raw_token = request.cookies.get(REFRESH_COOKIE_NAME)
    conn = get_db_connection()
    try:
        current_family_id = current_refresh_family_id(conn, raw_token)
        conn.execute(
            'UPDATE users SET session_auto_logout_seconds = ? WHERE id = ?',
            (seconds, user_id),
        )
        cur = conn.execute(
            '''
            UPDATE refresh_tokens
            SET expires_at = ?
            WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ?
            ''',
            (new_expires_at, user_id, now),
        )
        conn.commit()
        updated = int(cur.rowcount or 0)
    finally:
        conn.close()

    apply_session_auto_logout(session, seconds, now=now)
    response = make_response(jsonify({
        'success': True,
        'session_auto_logout_seconds': seconds,
        'session_expires_at': session_auto_logout_payload(session)['session_expires_at'],
        'session_auto_logout_options': session_auto_logout_options(),
        'updated_sessions': updated,
    }))
    if raw_token and current_family_id:
        secure = bool(current_app.config.get('SESSION_COOKIE_SECURE'))
        set_refresh_cookie(response, raw_token, secure=secure, max_age_seconds=seconds)
    return response

@auth_bp.route('/api/session_devices/revoke', methods=['POST'])
@limiter.limit("20 per minute")
def api_revoke_session_device():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401

    data = request.get_json(silent=True) or {}
    family_id = str(data.get('family_id') or '').strip()
    if not family_id:
        return jsonify({'success': False, 'error': 'family_id обязателен.'}), 400

    user_id = int(session['user_id'])
    now = int(time.time())
    conn = get_db_connection()
    try:
        current_family_id = current_refresh_family_id(conn, request.cookies.get(REFRESH_COOKIE_NAME))
        cur = conn.execute(
            '''
            UPDATE refresh_tokens
            SET revoked_at = ?
            WHERE user_id = ? AND family_id = ? AND revoked_at IS NULL
            ''',
            (now, user_id, family_id),
        )
        conn.commit()
        revoked = int(cur.rowcount or 0)
    finally:
        conn.close()

    signed_out_current = bool(current_family_id and family_id == current_family_id and revoked > 0)
    response = make_response(jsonify({'success': True, 'revoked': revoked, 'signed_out_current': signed_out_current}))
    if signed_out_current:
        secure = bool(current_app.config.get('SESSION_COOKIE_SECURE'))
        clear_refresh_cookie(response, secure=secure)
    return response

@auth_bp.route('/api/session_devices/revoke_others', methods=['POST'])
@limiter.limit("10 per minute")
def api_revoke_other_session_devices():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401

    user_id = int(session['user_id'])
    now = int(time.time())
    conn = get_db_connection()
    try:
        current_family_id = current_refresh_family_id(conn, request.cookies.get(REFRESH_COOKIE_NAME))
        if current_family_id:
            cur = conn.execute(
                '''
                UPDATE refresh_tokens
                SET revoked_at = ?
                WHERE user_id = ? AND family_id != ? AND revoked_at IS NULL
                ''',
                (now, user_id, current_family_id),
            )
        else:
            cur = conn.execute(
                '''
                UPDATE refresh_tokens
                SET revoked_at = ?
                WHERE user_id = ? AND revoked_at IS NULL
                ''',
                (now, user_id),
            )
        conn.commit()
        revoked = int(cur.rowcount or 0)
    finally:
        conn.close()

    return jsonify({'success': True, 'revoked': revoked})
