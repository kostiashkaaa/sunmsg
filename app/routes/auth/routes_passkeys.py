import logging
import json
import re
import secrets

import pyotp
from flask import current_app, jsonify, request, session
from flask_wtf.csrf import generate_csrf

from app.database import get_db_connection
from app.db_backend import IntegrityError
from app.extensions import limiter
from app.services.locale import language_from_user_row
from app.services.totp_secret_store import decode_totp_secret, has_totp_secret
from .context import (
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptor,
    ResidentKeyRequirement,
    UserVerificationRequirement,
    auth_bp,
    base64url_to_bytes,
    bytes_to_base64url,
    generate_authentication_options,
    generate_registration_options,
    options_to_json,
    verify_authentication_response,
    verify_registration_response,
    _clear_pending_passkey_login,
    _clear_pending_passkey_register,
    _login_success_response,
    _passkey_configuration_error,
    _passkey_expected_origin,
    _passkey_rp_id,
    _pending_passkey_login_context,
    _pending_passkey_register_context,
    _resolve_guest_ui_language,
    _stage_pending_passkey_login,
    _stage_pending_passkey_register,
    _stage_pending_totp,
    _extract_passkey_credential_id,
    _webauthn_unavailable_response,
)

logger = logging.getLogger(__name__)
_MAX_PASSKEYS_PER_USER = 10


def _user_passkey_count(conn, user_id: int) -> int:
    row = conn.execute(
        'SELECT COUNT(*) AS cnt FROM user_passkeys WHERE user_id = ?',
        (int(user_id),),
    ).fetchone()
    return int(row['cnt'] or 0) if row else 0


def _totp_step_up_error(conn, *, user_id: int, totp_code: str) -> tuple[str, int] | None:
    row = conn.execute(
        'SELECT totp_secret FROM users WHERE id = ?',
        (int(user_id),),
    ).fetchone()
    if not row or not has_totp_secret(row['totp_secret']):
        return None
    normalized_code = str(totp_code or '').strip()
    if not re.fullmatch(r'\d{6}', normalized_code):
        return ('Введите 6-значный TOTP-код для подтверждения.', 400)
    secret = decode_totp_secret(row['totp_secret'])
    if not secret or not pyotp.TOTP(secret).verify(normalized_code, valid_window=1):
        return ('Неверный TOTP-код.', 401)
    return None


@auth_bp.route('/api/passkeys', methods=['GET'])
@limiter.limit("60 per minute")
def api_passkeys():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401

    conn = get_db_connection()
    try:
        rows = conn.execute(
            '''
            SELECT credential_id, label, transports, created_at, last_used_at
            FROM user_passkeys
            WHERE user_id = ?
            ORDER BY created_at DESC
            ''',
            (session['user_id'],),
        ).fetchall()
    finally:
        conn.close()

    passkeys = []
    for row in rows:
        transports_raw = str(row['transports'] or '').strip()
        transports = [part for part in transports_raw.split(',') if part]
        passkeys.append(
            {
                'credential_id': row['credential_id'],
                'label': row['label'] or '',
                'transports': transports,
                'created_at': str(row['created_at'] or ''),
                'last_used_at': str(row['last_used_at'] or ''),
            }
        )

    return jsonify({'success': True, 'passkeys': passkeys})

@auth_bp.route('/api/passkeys/register/options', methods=['POST'])
@limiter.limit("20 per minute")
def passkeys_register_options():
    if generate_registration_options is None:
        return _webauthn_unavailable_response()
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401
    configuration_error = _passkey_configuration_error()
    if configuration_error:
        return jsonify({'success': False, 'error': configuration_error}), 400

    conn = get_db_connection()
    try:
        user = conn.execute(
            'SELECT id, username, display_name FROM users WHERE id = ?',
            (session['user_id'],),
        ).fetchone()
        if not user:
            return jsonify({'success': False, 'error': 'Пользователь не найден.'}), 404

        existing_rows = conn.execute(
            'SELECT credential_id FROM user_passkeys WHERE user_id = ?',
            (user['id'],),
        ).fetchall()
        if len(existing_rows) >= _MAX_PASSKEYS_PER_USER:
            return jsonify({'success': False, 'error': 'Достигнут лимит passkey для аккаунта.'}), 400
    finally:
        conn.close()

    exclude_credentials = []
    for row in existing_rows:
        credential_id = str(row['credential_id'] or '').strip()
        if not credential_id:
            continue
        try:
            exclude_credentials.append(
                PublicKeyCredentialDescriptor(id=base64url_to_bytes(credential_id))
            )
        except Exception:
            logger.warning('Skipping malformed credential_id for user_id=%s', user['id'])

    challenge = secrets.token_bytes(32)
    challenge_b64 = bytes_to_base64url(challenge)
    _stage_pending_passkey_register(user['id'], challenge_b64)

    try:
        options = generate_registration_options(
            rp_id=_passkey_rp_id(),
            rp_name=str(current_app.config.get('WEBAUTHN_RP_NAME') or 'SUN Messenger'),
            user_name=str(user['username']),
            user_id=str(user['id']).encode('utf-8'),
            user_display_name=str(user['display_name'] or user['username']),
            challenge=challenge,
            authenticator_selection=AuthenticatorSelectionCriteria(
                resident_key=ResidentKeyRequirement.REQUIRED,
                require_resident_key=True,
                user_verification=UserVerificationRequirement.REQUIRED,
            ),
            exclude_credentials=exclude_credentials or None,
        )
    except Exception as exc:
        logger.warning('passkeys_register_options failed user_id=%s: %s', session.get('user_id'), exc)
        return jsonify({'success': False, 'error': 'Не удалось подготовить Passkey-вход для этого устройства.'}), 400

    return jsonify({
        'success': True,
        'options': json.loads(options_to_json(options)),
    })

@auth_bp.route('/api/passkeys/register/verify', methods=['POST'])
@limiter.limit("20 per minute")
def passkeys_register_verify():  # noqa: C901 - passkey verification flow and persistence
    if verify_registration_response is None:
        return _webauthn_unavailable_response()
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401

    pending = _pending_passkey_register_context()
    if not pending:
        return jsonify({'success': False, 'error': 'Сессия регистрации passkey истекла. Повторите попытку.'}), 401
    if int(session['user_id']) != int(pending['user_id']):
        _clear_pending_passkey_register()
        return jsonify({'success': False, 'error': 'Некорректный пользователь для регистрации passkey.'}), 401

    data = request.get_json(silent=True) or {}
    credential = data.get('credential')
    label = str(data.get('label') or '').strip()[:80]
    if not isinstance(credential, dict):
        return jsonify({'success': False, 'error': 'Некорректный ответ passkey.'}), 400

    try:
        verification = verify_registration_response(
            credential=credential,
            expected_challenge=base64url_to_bytes(pending['challenge_b64']),
            expected_rp_id=_passkey_rp_id(),
            expected_origin=_passkey_expected_origin(),
            require_user_verification=True,
        )
    except Exception as exc:
        logger.warning('Passkey register verify failed user_id=%s: %s', session.get('user_id'), exc)
        return jsonify({'success': False, 'error': 'Не удалось зарегистрировать passkey.'}), 400
    finally:
        _clear_pending_passkey_register()

    credential_id_b64 = bytes_to_base64url(verification.credential_id)
    credential_public_key_b64 = bytes_to_base64url(verification.credential_public_key)
    transports_value = credential.get('response', {}).get('transports', [])
    transports = []
    if isinstance(transports_value, list):
        for item in transports_value:
            text = str(item or '').strip().lower()
            if text and text not in transports:
                transports.append(text)

    conn = get_db_connection()
    try:
        if _user_passkey_count(conn, int(session['user_id'])) >= _MAX_PASSKEYS_PER_USER:
            return jsonify({'success': False, 'error': 'Достигнут лимит passkey для аккаунта.'}), 400
        conn.execute(
            '''
            INSERT INTO user_passkeys (user_id, credential_id, credential_public_key, sign_count, transports, label)
            VALUES (?, ?, ?, ?, ?, ?)
            ''',
            (
                session['user_id'],
                credential_id_b64,
                credential_public_key_b64,
                int(verification.sign_count),
                ','.join(transports),
                label or None,
            ),
        )
        conn.commit()
    except IntegrityError:
        return jsonify({'success': False, 'error': 'Этот passkey уже зарегистрирован.'}), 400
    finally:
        conn.close()

    return jsonify({'success': True})

@auth_bp.route('/api/passkeys/delete', methods=['POST'])
@limiter.limit("20 per minute")
def passkeys_delete():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401

    data = request.get_json(silent=True) or {}
    credential_id = str(data.get('credential_id') or '').strip()
    totp_code = str(data.get('totp_code') or '').strip()
    if not credential_id:
        return jsonify({'success': False, 'error': 'Не указан credential_id.'}), 400

    conn = get_db_connection()
    try:
        step_up_error = _totp_step_up_error(conn, user_id=int(session['user_id']), totp_code=totp_code)
        if step_up_error is not None:
            message, status_code = step_up_error
            return jsonify({'success': False, 'error': message}), status_code
        existing = conn.execute(
            'SELECT id FROM user_passkeys WHERE user_id = ? AND credential_id = ?',
            (session['user_id'], credential_id),
        ).fetchone()
        if not existing:
            return jsonify({'success': False, 'error': 'Passkey не найден.'}), 404
        conn.execute(
            'DELETE FROM user_passkeys WHERE user_id = ? AND credential_id = ?',
            (session['user_id'], credential_id),
        )
        conn.commit()
    finally:
        conn.close()

    # Deleting a passkey shrinks the user's 2nd-factor surface. Revoke all
    # refresh tokens so the user must re-authenticate on every device with
    # the remaining factors. Imposes a small UX hit but blocks the
    # "stolen-session deletes passkey then plants its own" scenario.
    try:
        from app.services.refresh_tokens import revoke_all_for_user
        revoke_all_for_user(int(session['user_id']))
    except Exception:  # noqa: BLE001
        pass

    return jsonify({'success': True})

@auth_bp.route('/api/passkey/login/options', methods=['POST'])
@limiter.limit("10 per minute")
def passkey_login_options():  # noqa: C901 - passkey login options branching by username mode
    if generate_authentication_options is None:
        return _webauthn_unavailable_response()

    _clear_pending_passkey_login()
    configuration_error = _passkey_configuration_error()
    if configuration_error:
        return jsonify({'success': False, 'error': configuration_error}), 400

    data = request.get_json(silent=True) or {}
    username = str(data.get('username') or '').strip()

    user_id = None
    allow_credentials = []
    conn = get_db_connection()
    try:
        if username:
            user = conn.execute(
                'SELECT id FROM users WHERE username = ?',
                (username,),
            ).fetchone()
            if not user:
                return jsonify({'success': False, 'error': 'Пользователь не найден.'}), 404
            user_id = int(user['id'])
            passkey_rows = conn.execute(
                'SELECT credential_id FROM user_passkeys WHERE user_id = ?',
                (user_id,),
            ).fetchall()
        else:
            # Username-less login: authenticator picks discoverable credentials.
            passkey_rows = conn.execute('SELECT 1 FROM user_passkeys LIMIT 1').fetchall()
    finally:
        conn.close()

    if not passkey_rows:
        return jsonify({'success': False, 'error': 'Для аккаунта не настроен Passkey.'}), 400

    if username:
        for row in passkey_rows:
            credential_id = str(row['credential_id'] or '').strip()
            if not credential_id:
                continue
            try:
                allow_credentials.append(
                    PublicKeyCredentialDescriptor(id=base64url_to_bytes(credential_id))
                )
            except Exception:
                logger.warning('Skipping malformed passkey credential_id for user_id=%s', user_id)

        if not allow_credentials:
            return jsonify({'success': False, 'error': 'Passkey записи повреждены. Перепривяжите passkey.'}), 400

    challenge = secrets.token_bytes(32)
    challenge_b64 = bytes_to_base64url(challenge)
    _stage_pending_passkey_login(user_id, challenge_b64, remember=True)

    try:
        options = generate_authentication_options(
            rp_id=_passkey_rp_id(),
            challenge=challenge,
            allow_credentials=allow_credentials or None,
            user_verification=UserVerificationRequirement.REQUIRED,
        )
    except Exception as exc:
        logger.warning('passkey_login_options failed for submitted username: %s', exc)
        return jsonify({'success': False, 'error': 'Не удалось подготовить Passkey-вход для этого домена.'}), 400

    return jsonify({
        'success': True,
        'options': json.loads(options_to_json(options)),
    })

@auth_bp.route('/api/passkey/login/verify', methods=['POST'])
@limiter.limit("10 per minute")
def passkey_login_verify():  # noqa: C901 - passkey assertion verification and login finalization
    if verify_authentication_response is None:
        return _webauthn_unavailable_response()

    pending = _pending_passkey_login_context()
    if not pending:
        return jsonify({'success': False, 'error': 'Сессия passkey-входа истекла. Повторите попытку.'}), 401

    data = request.get_json(silent=True) or {}
    credential = data.get('credential')
    if not isinstance(credential, dict):
        return jsonify({'success': False, 'error': 'Некорректный ответ passkey.'}), 400

    credential_id = _extract_passkey_credential_id(credential)
    if not credential_id:
        return jsonify({'success': False, 'error': 'Не удалось определить passkey credential id.'}), 400

    pending_user_id = pending.get('user_id')
    conn = get_db_connection()
    try:
        if pending_user_id:
            user = conn.execute(
                'SELECT id, public_key, totp_secret, language FROM users WHERE id = ?',
                (pending_user_id,),
            ).fetchone()
            if not user:
                _clear_pending_passkey_login()
                return jsonify({'success': False, 'error': 'Пользователь не найден.'}), 404

            passkey_row = conn.execute(
                '''
                SELECT credential_id, credential_public_key, sign_count
                FROM user_passkeys
                WHERE user_id = ? AND credential_id = ?
                ''',
                (user['id'], credential_id),
            ).fetchone()
            if not passkey_row:
                _clear_pending_passkey_login()
                return jsonify({'success': False, 'error': 'Passkey не найден для этого аккаунта.'}), 401
        else:
            row = conn.execute(
                '''
                SELECT
                    p.credential_id,
                    p.credential_public_key,
                    p.sign_count,
                    u.id AS user_id,
                    u.public_key,
                    u.totp_secret,
                    u.language
                FROM user_passkeys p
                JOIN users u ON u.id = p.user_id
                WHERE p.credential_id = ?
                ''',
                (credential_id,),
            ).fetchone()
            if not row:
                _clear_pending_passkey_login()
                return jsonify({'success': False, 'error': 'Passkey не найден для этого аккаунта.'}), 401

            user = {
                'id': row['user_id'],
                'public_key': row['public_key'],
                'totp_secret': row['totp_secret'],
                'language': row['language'],
            }
            passkey_row = {
                'credential_id': row['credential_id'],
                'credential_public_key': row['credential_public_key'],
                'sign_count': row['sign_count'],
            }

        try:
            verification = verify_authentication_response(
                credential=credential,
                expected_challenge=base64url_to_bytes(pending['challenge_b64']),
                expected_rp_id=_passkey_rp_id(),
                expected_origin=_passkey_expected_origin(),
                credential_public_key=base64url_to_bytes(passkey_row['credential_public_key']),
                credential_current_sign_count=int(passkey_row['sign_count'] or 0),
                require_user_verification=True,
            )
        except Exception as exc:
            _clear_pending_passkey_login()
            logger.warning('Passkey login verify failed user_id=%s: %s', user['id'], exc)
            return jsonify({'success': False, 'error': 'Passkey проверка не пройдена.'}), 401

        conn.execute(
            '''
            UPDATE user_passkeys
            SET sign_count = ?, last_used_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND credential_id = ?
            ''',
            (int(verification.new_sign_count), user['id'], credential_id),
        )
        conn.commit()
    finally:
        conn.close()

    _clear_pending_passkey_login()

    if user['totp_secret']:
        _stage_pending_totp(user, remember=True)
        return jsonify(
            {
                'success': True,
                'requires_totp': True,
                'csrf_token': generate_csrf(),
            }
        )

    session.clear()
    session['public_key_pem'] = user['public_key']
    session['user_id'] = user['id']
    session['ui_language'] = language_from_user_row(user, default=_resolve_guest_ui_language())

    return _login_success_response(user['id'])
