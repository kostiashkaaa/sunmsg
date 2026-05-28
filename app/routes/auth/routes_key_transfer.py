import json
import logging
import secrets
import time

from flask import jsonify, request, session

from app.database import get_db_connection
from app.extensions import limiter
from app.routes.auth_helpers_key_transfer import (
    KEY_TRANSFER_SESSION_TTL_SECONDS,
    cleanup_key_transfer_sessions,
    cleanup_login_key_transfer_sessions,
    clear_pending_login_qr,
    is_valid_b64url_blob,
    is_valid_key_transfer_session_id,
    is_valid_p256_jwk,
    pending_login_qr_session_id,
    stage_pending_login_qr,
)
from .context import auth_bp

logger = logging.getLogger(__name__)


def _notify_key_transfer_submitted(user_id: int) -> None:
    try:
        from app.services.web_push import send_security_event_to_user

        send_security_event_to_user(
            user_id=int(user_id),
            event='key_transfer_submitted',
            message='Ваш приватный ключ передан на новое устройство. Если это были не вы — немедленно ротируйте ключ.',
        )
    except Exception:  # noqa: BLE001
        logger.exception('key_transfer: security notification failed user_id=%s', user_id)


@auth_bp.route('/api/key_transfer/sessions', methods=['POST'])
@limiter.limit("20 per minute")
def key_transfer_create_session():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401

    data = request.get_json(silent=True) or {}
    receiver_public_jwk = data.get('receiver_public_jwk')
    if not is_valid_p256_jwk(receiver_public_jwk):
        return jsonify({'success': False, 'error': 'Некорректный публичный ключ устройства.'}), 400

    user_id = int(session['user_id'])
    now = int(time.time())
    expires_at = now + KEY_TRANSFER_SESSION_TTL_SECONDS
    session_id = secrets.token_urlsafe(24)
    receiver_public_jwk_json = json.dumps(receiver_public_jwk, ensure_ascii=False, separators=(',', ':'))

    conn = get_db_connection()
    try:
        cleanup_key_transfer_sessions(conn)
        conn.execute(
            '''
            INSERT INTO key_transfer_sessions (
                id, user_id, receiver_public_jwk, status, created_at, expires_at
            ) VALUES (?, ?, ?, ?, ?, ?)
            ''',
            (session_id, user_id, receiver_public_jwk_json, 'pending', now, expires_at),
        )
        conn.commit()
    finally:
        conn.close()

    return jsonify(
        {
            'success': True,
            'session_id': session_id,
            'qr_text': f'sun-key-transfer:{session_id}',
            'expires_in_seconds': KEY_TRANSFER_SESSION_TTL_SECONDS,
        }
    )

@auth_bp.route('/api/key_transfer/sessions/<session_id>', methods=['GET'])
@limiter.limit("60 per minute")
def key_transfer_get_session(session_id):
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401
    if not is_valid_key_transfer_session_id(session_id):
        return jsonify({'success': False, 'error': 'Некорректный идентификатор сессии.'}), 400

    user_id = int(session['user_id'])
    now = int(time.time())
    conn = get_db_connection()
    try:
        cleanup_key_transfer_sessions(conn)
        row = conn.execute(
            '''
            SELECT id, receiver_public_jwk, status, expires_at
            FROM key_transfer_sessions
            WHERE id = ? AND user_id = ?
            ''',
            (session_id, user_id),
        ).fetchone()
    finally:
        conn.close()

    if not row:
        return jsonify({'success': False, 'error': 'Сессия переноса ключа не найдена.'}), 404
    if int(row['expires_at'] or 0) <= now:
        return jsonify({'success': False, 'error': 'Сессия переноса ключа истекла.'}), 410

    try:
        receiver_public_jwk = json.loads(row['receiver_public_jwk'])
    except json.JSONDecodeError:
        return jsonify({'success': False, 'error': 'Данные сессии повреждены.'}), 500

    return jsonify(
        {
            'success': True,
            'state': str(row['status'] or 'pending'),
            'receiver_public_jwk': receiver_public_jwk,
            'expires_at': int(row['expires_at']),
        }
    )

@auth_bp.route('/api/key_transfer/login/sessions', methods=['POST'])
@limiter.limit("20 per minute")
def key_transfer_create_login_session():
    data = request.get_json(silent=True) or {}
    receiver_public_jwk = data.get('receiver_public_jwk')
    if not is_valid_p256_jwk(receiver_public_jwk):
        return jsonify({'success': False, 'error': 'Некорректный публичный ключ устройства.'}), 400

    conn = get_db_connection()
    try:
        now = int(time.time())
        expires_at = now + KEY_TRANSFER_SESSION_TTL_SECONDS
        session_id = secrets.token_urlsafe(16)
        receiver_public_jwk_json = json.dumps(receiver_public_jwk, ensure_ascii=False, separators=(',', ':'))

        cleanup_login_key_transfer_sessions(conn)
        conn.execute(
            '''
            INSERT INTO key_transfer_login_sessions (
                id, receiver_public_jwk, status, created_at, expires_at
            ) VALUES (?, ?, ?, ?, ?)
            ''',
            (session_id, receiver_public_jwk_json, 'pending', now, expires_at),
        )
        conn.commit()
    finally:
        conn.close()

    stage_pending_login_qr(session, session_id)
    return jsonify(
        {
            'success': True,
            'session_id': session_id,
            'qr_text': f'skl:{session_id}',
            'expires_in_seconds': KEY_TRANSFER_SESSION_TTL_SECONDS,
        }
    )

@auth_bp.route('/api/key_transfer/login/sessions/<session_id>/submit', methods=['POST'])
@limiter.limit("20 per minute")
def key_transfer_submit_login_payload(session_id):
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401
    if not is_valid_key_transfer_session_id(session_id):
        return jsonify({'success': False, 'error': 'Некорректный идентификатор сессии.'}), 400

    data = request.get_json(silent=True) or {}
    sender_public_jwk = data.get('sender_public_jwk')
    cipher_text = str(data.get('cipher_text') or '').strip()
    iv = str(data.get('iv') or '').strip()
    if not is_valid_p256_jwk(sender_public_jwk):
        return jsonify({'success': False, 'error': 'Некорректный ключ отправителя.'}), 400
    if not is_valid_b64url_blob(cipher_text, max_len=65536):
        return jsonify({'success': False, 'error': 'Некорректный зашифрованный payload.'}), 400
    if not is_valid_b64url_blob(iv, max_len=128):
        return jsonify({'success': False, 'error': 'Некорректный IV.'}), 400

    now = int(time.time())
    submitter_user_id = int(session['user_id'])
    sender_public_jwk_json = json.dumps(sender_public_jwk, ensure_ascii=False, separators=(',', ':'))
    conn = get_db_connection()
    try:
        cleanup_login_key_transfer_sessions(conn)
        row = conn.execute(
            '''
            SELECT status, expires_at
            FROM key_transfer_login_sessions
            WHERE id = ?
            ''',
            (session_id,),
        ).fetchone()
        if not row:
            return jsonify({'success': False, 'error': 'Сессия QR-входа не найдена.'}), 404
        if int(row['expires_at'] or 0) <= now:
            return jsonify({'success': False, 'error': 'Сессия QR-входа истекла.'}), 410
        if str(row['status'] or '') == 'claimed':
            return jsonify({'success': False, 'error': 'Сессия уже завершена.'}), 410
        if str(row['status'] or '') == 'submitted':
            return jsonify({'success': True, 'already_submitted': True})

        conn.execute(
            '''
            UPDATE key_transfer_login_sessions
            SET sender_public_jwk = ?, encrypted_private_key = ?, iv = ?, submitted_by_user_id = ?,
                status = ?, submitted_at = ?
            WHERE id = ?
            ''',
            (
                sender_public_jwk_json,
                cipher_text,
                iv,
                submitter_user_id,
                'submitted',
                now,
                session_id,
            ),
        )
        conn.commit()
    finally:
        conn.close()

    _notify_key_transfer_submitted(submitter_user_id)

    return jsonify({'success': True})

@auth_bp.route('/api/key_transfer/login/sessions/<session_id>', methods=['GET'])
@limiter.limit("60 per minute")
def key_transfer_get_login_session(session_id):
    if not is_valid_key_transfer_session_id(session_id):
        return jsonify({'success': False, 'error': 'Некорректный идентификатор сессии.'}), 400

    now = int(time.time())
    conn = get_db_connection()
    try:
        cleanup_login_key_transfer_sessions(conn)
        row = conn.execute(
            '''
            SELECT id, receiver_public_jwk, status, expires_at
            FROM key_transfer_login_sessions
            WHERE id = ?
            ''',
            (session_id,),
        ).fetchone()
    finally:
        conn.close()

    if not row:
        return jsonify({'success': False, 'error': 'Сессия QR-входа не найдена.'}), 404
    if int(row['expires_at'] or 0) <= now:
        return jsonify({'success': False, 'error': 'Сессия QR-входа истекла.'}), 410

    try:
        receiver_public_jwk = json.loads(row['receiver_public_jwk'])
    except json.JSONDecodeError:
        return jsonify({'success': False, 'error': 'Данные сессии повреждены.'}), 500

    return jsonify(
        {
            'success': True,
            'state': str(row['status'] or 'pending'),
            'receiver_public_jwk': receiver_public_jwk,
        }
    )

@auth_bp.route('/api/key_transfer/sessions/<session_id>/submit', methods=['POST'])
@limiter.limit("20 per minute")
def key_transfer_submit_payload(session_id):
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401
    if not is_valid_key_transfer_session_id(session_id):
        return jsonify({'success': False, 'error': 'Некорректный идентификатор сессии.'}), 400

    data = request.get_json(silent=True) or {}
    sender_public_jwk = data.get('sender_public_jwk')
    cipher_text = str(data.get('cipher_text') or '').strip()
    iv = str(data.get('iv') or '').strip()
    if not is_valid_p256_jwk(sender_public_jwk):
        return jsonify({'success': False, 'error': 'Некорректный ключ отправителя.'}), 400
    if not is_valid_b64url_blob(cipher_text, max_len=65536):
        return jsonify({'success': False, 'error': 'Некорректный зашифрованный payload.'}), 400
    if not is_valid_b64url_blob(iv, max_len=128):
        return jsonify({'success': False, 'error': 'Некорректный IV.'}), 400

    user_id = int(session['user_id'])
    now = int(time.time())
    sender_public_jwk_json = json.dumps(sender_public_jwk, ensure_ascii=False, separators=(',', ':'))
    conn = get_db_connection()
    try:
        cleanup_key_transfer_sessions(conn)
        row = conn.execute(
            '''
            SELECT status, expires_at
            FROM key_transfer_sessions
            WHERE id = ? AND user_id = ?
            ''',
            (session_id, user_id),
        ).fetchone()
        if not row:
            return jsonify({'success': False, 'error': 'Сессия переноса ключа не найдена.'}), 404
        if int(row['expires_at'] or 0) <= now:
            return jsonify({'success': False, 'error': 'Сессия переноса ключа истекла.'}), 410
        if str(row['status'] or '') == 'claimed':
            return jsonify({'success': False, 'error': 'Сессия уже завершена.'}), 410
        if str(row['status'] or '') == 'submitted':
            return jsonify({'success': True, 'already_submitted': True})

        conn.execute(
            '''
            UPDATE key_transfer_sessions
            SET sender_public_jwk = ?, encrypted_private_key = ?, iv = ?, status = ?, submitted_at = ?
            WHERE id = ? AND user_id = ?
            ''',
            (sender_public_jwk_json, cipher_text, iv, 'submitted', now, session_id, user_id),
        )
        conn.commit()
    finally:
        conn.close()

    _notify_key_transfer_submitted(user_id)

    return jsonify({'success': True})

@auth_bp.route('/api/key_transfer/sessions/<session_id>/claim', methods=['POST'])
@limiter.limit("60 per minute")
def key_transfer_claim_payload(session_id):  # noqa: C901 - route-level validation/state transitions
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401
    if not is_valid_key_transfer_session_id(session_id):
        return jsonify({'success': False, 'error': 'Некорректный идентификатор сессии.'}), 400

    user_id = int(session['user_id'])
    now = int(time.time())
    conn = get_db_connection()
    try:
        cleanup_key_transfer_sessions(conn)
        row = conn.execute(
            '''
            SELECT status, expires_at, sender_public_jwk, encrypted_private_key, iv
            FROM key_transfer_sessions
            WHERE id = ? AND user_id = ?
            ''',
            (session_id, user_id),
        ).fetchone()
        if not row:
            return jsonify({'success': False, 'error': 'Сессия переноса ключа не найдена.'}), 404
        if int(row['expires_at'] or 0) <= now:
            return jsonify({'success': False, 'error': 'Сессия переноса ключа истекла.'}), 410

        state = str(row['status'] or 'pending')
        if state == 'claimed':
            return jsonify({'success': False, 'error': 'Сессия уже завершена.'}), 410
        if state != 'submitted':
            return jsonify({'success': True, 'state': 'pending'})


        try:
            sender_public_jwk = json.loads(row['sender_public_jwk'])
        except json.JSONDecodeError:
            return jsonify({'success': False, 'error': 'Данные сессии повреждены.'}), 500

        cipher_text = str(row['encrypted_private_key'] or '').strip()
        iv = str(row['iv'] or '').strip()
        if not is_valid_p256_jwk(sender_public_jwk):
            return jsonify({'success': False, 'error': 'Некорректный ключ отправителя.'}), 500
        if not is_valid_b64url_blob(cipher_text, max_len=65536):
            return jsonify({'success': False, 'error': 'Повреждённый payload ключа.'}), 500
        if not is_valid_b64url_blob(iv, max_len=128):
            return jsonify({'success': False, 'error': 'Повреждённый IV ключа.'}), 500

        claim_cursor = conn.execute(
            '''
            UPDATE key_transfer_sessions
            SET status = ?, claimed_at = ?
            WHERE id = ? AND user_id = ? AND status = ?
            ''',
            ('claimed', now, session_id, user_id, 'submitted'),
        )
        if int(claim_cursor.rowcount or 0) != 1:
            return jsonify({'success': False, 'error': 'Сессия уже завершена.'}), 410
        conn.commit()
    finally:
        conn.close()

    return jsonify(
        {
            'success': True,
            'state': 'submitted',
            'sender_public_jwk': sender_public_jwk,
            'cipher_text': cipher_text,
            'iv': iv,
        }
    )

@auth_bp.route('/api/key_transfer/login/sessions/<session_id>/claim', methods=['POST'])
@limiter.limit("240 per minute")
def key_transfer_claim_login_payload(session_id):  # noqa: C901 - route-level login handoff flow
    if not is_valid_key_transfer_session_id(session_id):
        return jsonify({'success': False, 'error': 'Некорректный идентификатор сессии.'}), 400
    if pending_login_qr_session_id(session) != session_id:
        return jsonify({'success': False, 'error': 'Сессия QR-входа не найдена в этом браузере.'}), 404

    now = int(time.time())
    conn = get_db_connection()
    try:
        session_row = conn.execute(
            '''
            SELECT
                status,
                expires_at,
                sender_public_jwk,
                encrypted_private_key,
                iv,
                submitted_by_user_id
            FROM key_transfer_login_sessions
            WHERE id = ?
            ''',
            (session_id,),
        ).fetchone()
        if not session_row:
            clear_pending_login_qr(session)
            return jsonify({'success': False, 'error': 'Сессия переноса ключа не найдена.'}), 404
        if int(session_row['expires_at'] or 0) <= now:
            clear_pending_login_qr(session)
            return jsonify({'success': False, 'error': 'Сессия переноса ключа истекла.'}), 410

        state = str(session_row['status'] or 'pending')
        if state == 'claimed':
            clear_pending_login_qr(session)
            return jsonify({'success': False, 'error': 'Сессия уже завершена.'}), 410
        if state != 'submitted':
            return jsonify({'success': True, 'state': 'pending'})


        submitted_user_id = session_row['submitted_by_user_id']
        submitted_user = None
        if submitted_user_id:
            submitted_user = conn.execute(
                '''
                SELECT username, display_name, avatar_url
                FROM users
                WHERE id = ?
                ''',
                (submitted_user_id,),
            ).fetchone()

        try:
            sender_public_jwk = json.loads(session_row['sender_public_jwk'])
        except json.JSONDecodeError:
            clear_pending_login_qr(session)
            return jsonify({'success': False, 'error': 'Данные сессии повреждены.'}), 500

        cipher_text = str(session_row['encrypted_private_key'] or '').strip()
        iv = str(session_row['iv'] or '').strip()
        if not is_valid_p256_jwk(sender_public_jwk):
            clear_pending_login_qr(session)
            return jsonify({'success': False, 'error': 'Некорректный ключ отправителя.'}), 500
        if not is_valid_b64url_blob(cipher_text, max_len=65536):
            clear_pending_login_qr(session)
            return jsonify({'success': False, 'error': 'Повреждённый payload ключа.'}), 500
        if not is_valid_b64url_blob(iv, max_len=128):
            clear_pending_login_qr(session)
            return jsonify({'success': False, 'error': 'Повреждённый IV ключа.'}), 500

        claim_cursor = conn.execute(
            '''
            UPDATE key_transfer_login_sessions
            SET status = ?, claimed_at = ?
            WHERE id = ? AND status = ?
            ''',
            ('claimed', now, session_id, 'submitted'),
        )
        if int(claim_cursor.rowcount or 0) != 1:
            clear_pending_login_qr(session)
            return jsonify({'success': False, 'error': 'Сессия уже завершена.'}), 410
        conn.commit()
    finally:
        conn.close()

    clear_pending_login_qr(session)
    return jsonify(
        {
            'success': True,
            'state': 'submitted',
            'username': str((submitted_user['username'] if submitted_user else '') or '').strip(),
            'display_name': str((submitted_user['display_name'] if submitted_user else '') or '').strip(),
            'avatar_url': str((submitted_user['avatar_url'] if submitted_user else '') or '').strip() or None,
            'sender_public_jwk': sender_public_jwk,
            'cipher_text': cipher_text,
            'iv': iv,
        }
    )
