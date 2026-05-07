import time

from flask import current_app, jsonify, make_response, request, session

from app.database import get_db_connection
from app.extensions import limiter
from app.routes.auth_helpers_sessions import current_refresh_family_id
from app.services.refresh_tokens import REFRESH_COOKIE_NAME, clear_refresh_cookie
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

    devices = [
        {
            'family_id': str(row['family_id']),
            'created_at': int(row['created_at'] or 0),
            'last_used_at': int(row['last_used_at'] or row['created_at'] or 0),
            'expires_at': int(row['expires_at'] or 0),
            'user_agent': str(row['user_agent'] or '').strip(),
            'ip': str(row['ip'] or '').strip(),
            'is_current': bool(current_family_id and str(row['family_id']) == current_family_id),
            'persistent': True,
        }
        for row in rows
    ]

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

    return jsonify({'success': True, 'devices': devices})

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
