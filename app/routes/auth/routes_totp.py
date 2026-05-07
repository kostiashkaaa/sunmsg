import re

import pyotp
from flask import jsonify, request, session

from app.database import get_db_connection
from app.extensions import limiter
from app.routes.auth_helpers_totp import (
    clear_pending_totp,
    clear_pending_totp_setup,
    pending_totp_setup_context,
    stage_pending_totp_setup,
)
from .context import auth_bp

@auth_bp.route('/api/totp_status', methods=['GET'])
@limiter.limit("30 per minute")
def api_totp_status():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401

    conn = get_db_connection()
    try:
        user = conn.execute(
            'SELECT id, username, totp_secret, totp_enabled_at FROM users WHERE id = ?',
            (session['user_id'],),
        ).fetchone()
    finally:
        conn.close()

    if not user:
        return jsonify({'success': False, 'error': 'Пользователь не найден.'}), 404

    pending_setup = pending_totp_setup_context(session, user_id=session['user_id'])
    setup_pending = pending_setup is not None
    totp_secret = ''
    totp_uri = ''
    if setup_pending:
        totp_secret = pending_setup['secret']
        totp_uri = pyotp.totp.TOTP(totp_secret).provisioning_uri(
            name=user['username'],
            issuer_name='SUN Messenger',
        )

    return jsonify({
        'success': True,
        'enabled': bool(user['totp_secret']),
        'totp_enabled_at': str(user['totp_enabled_at'] or ''),
        'setup_pending': setup_pending,
        'totp_secret': totp_secret,
        'totp_uri': totp_uri,
        'username': user['username'],
    })

@auth_bp.route('/api/totp_manage', methods=['POST'])
@limiter.limit("10 per minute")
def api_totp_manage():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401

    data = request.get_json(silent=True) or {}
    action = str(data.get('action') or '').strip().lower()
    if action not in {'enable', 'disable', 'regenerate'}:
        return jsonify({'success': False, 'error': 'Неизвестное действие.'}), 400

    conn = get_db_connection()
    try:
        user = conn.execute(
            'SELECT id, username, totp_secret, totp_enabled_at FROM users WHERE id = ?',
            (session['user_id'],),
        ).fetchone()
        if not user:
            return jsonify({'success': False, 'error': 'Пользователь не найден.'}), 404

        if action == 'disable':
            conn.execute(
                'UPDATE users SET totp_secret = NULL, totp_enabled_at = NULL WHERE id = ?',
                (user['id'],),
            )
            conn.commit()
            clear_pending_totp(session)
            clear_pending_totp_setup(session)
            return jsonify({'success': True, 'enabled': False, 'totp_enabled_at': '', 'setup_pending': False})

        # enable/regenerate: issue a fresh secret and wait for verification.
        totp_secret = pyotp.random_base32()
        stage_pending_totp_setup(session, user_id=user['id'], secret=totp_secret)
    finally:
        conn.close()

    totp_uri = pyotp.totp.TOTP(totp_secret).provisioning_uri(
        name=user['username'],
        issuer_name='SUN Messenger',
    )
    return jsonify({
        'success': True,
        'enabled': bool(user['totp_secret']),
        'totp_enabled_at': str(user['totp_enabled_at'] or ''),
        'setup_pending': True,
        'totp_secret': totp_secret,
        'totp_uri': totp_uri,
    })

@auth_bp.route('/api/totp_setup/verify', methods=['POST'])
@limiter.limit("20 per minute")
def api_totp_setup_verify():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401

    pending_setup = pending_totp_setup_context(session, user_id=session['user_id'])
    if not pending_setup:
        return jsonify({'success': False, 'error': 'Нет активной TOTP-настройки. Запросите QR-код заново.'}), 400

    data = request.get_json(silent=True) or {}
    totp_code = str(data.get('totp_code') or '').strip()
    if not re.fullmatch(r'\d{6}', totp_code):
        return jsonify({'success': False, 'error': 'Введите 6-значный код из Authenticator.'}), 400

    totp = pyotp.TOTP(pending_setup['secret'])
    if not totp.verify(totp_code, valid_window=1):
        return jsonify({'success': False, 'error': 'Неверный код. Проверьте время на устройстве.'}), 400

    conn = get_db_connection()
    try:
        conn.execute(
            '''
            UPDATE users
            SET totp_secret = ?, totp_enabled_at = COALESCE(totp_enabled_at, CURRENT_TIMESTAMP)
            WHERE id = ?
            ''',
            (pending_setup['secret'], int(session['user_id'])),
        )
        conn.commit()
        user = conn.execute(
            'SELECT totp_enabled_at FROM users WHERE id = ?',
            (int(session['user_id']),),
        ).fetchone()
    finally:
        conn.close()

    clear_pending_totp_setup(session)
    return jsonify({
        'success': True,
        'enabled': True,
        'setup_pending': False,
        'totp_enabled_at': str((user['totp_enabled_at'] if user else '') or ''),
    })
