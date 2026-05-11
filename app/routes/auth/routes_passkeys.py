import ipaddress
import logging
import json
import secrets
import time
from urllib.parse import urlparse

from flask import current_app, jsonify, make_response, request, session
from flask_wtf.csrf import generate_csrf

from app.database import get_db_connection
from app.db_backend import IntegrityError
from app.extensions import limiter
from app.services.locale import (
    detect_auth_language,
    language_from_user_row,
    normalize_language,
)
from app.services.refresh_tokens import issue_refresh_token, set_refresh_cookie
from app.services.session_state import resolve_guest_ui_language
from app.routes.auth_utils import wants_remember
from .context import (
    auth_bp,
)

logger = logging.getLogger(__name__)
_PENDING_TOTP_TTL_SECONDS = 5 * 60
_PENDING_PASSKEY_REGISTER_TTL_SECONDS = 5 * 60
_PENDING_PASSKEY_LOGIN_TTL_SECONDS = 5 * 60

try:
    from webauthn import (
        generate_registration_options,
        verify_registration_response,
        generate_authentication_options,
        verify_authentication_response,
        options_to_json,
    )
    from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
    from webauthn.helpers.structs import (
        AuthenticatorSelectionCriteria,
        PublicKeyCredentialDescriptor,
        ResidentKeyRequirement,
        UserVerificationRequirement,
    )
    _WEBAUTHN_IMPORT_ERROR = ''
except Exception as webauthn_import_error:  # pragma: no cover - dependency guard
    generate_registration_options = None
    verify_registration_response = None
    generate_authentication_options = None
    verify_authentication_response = None
    options_to_json = None
    base64url_to_bytes = None
    bytes_to_base64url = None
    AuthenticatorSelectionCriteria = None
    PublicKeyCredentialDescriptor = None
    ResidentKeyRequirement = None
    UserVerificationRequirement = None
    _WEBAUTHN_IMPORT_ERROR = str(webauthn_import_error)


def _webauthn_unavailable_response():
    message = 'Passkey вход временно недоступен на сервере.'
    if _WEBAUTHN_IMPORT_ERROR:
        logger.warning('WebAuthn unavailable: %s', _WEBAUTHN_IMPORT_ERROR)
    return jsonify({'success': False, 'error': message}), 503


def _resolve_guest_ui_language() -> str:
    return resolve_guest_ui_language(
        req=request,
        session_state=session,
        detect_auth_language=detect_auth_language,
        normalize_language=normalize_language,
    )


def _wants_remember(data) -> bool:
    return wants_remember(data)


def _clear_pending_totp() -> None:
    for key in (
        'pending_totp_user_id',
        'pending_totp_public_key',
        'pending_totp_remember',
        'pending_totp_issued_at',
    ):
        session.pop(key, None)


def _stage_pending_totp(user, *, remember: bool) -> None:
    _clear_pending_totp()
    session.pop('user_id', None)
    session.pop('public_key_pem', None)
    session['pending_totp_user_id'] = int(user['id'])
    session['pending_totp_public_key'] = user['public_key']
    session['pending_totp_remember'] = bool(remember)
    session['pending_totp_issued_at'] = int(time.time())


def _login_success_response(user_id: int, *, remember: bool):
    payload = {'success': True}
    session.permanent = bool(remember)
    response = make_response(jsonify(payload))
    raw, _exp = issue_refresh_token(user_id)
    secure = bool(current_app.config.get('SESSION_COOKIE_SECURE'))
    set_refresh_cookie(response, raw, secure=secure)
    return response


def _passkey_rp_id() -> str:
    configured_raw = str(current_app.config.get('WEBAUTHN_RP_ID') or '').strip()
    configured = configured_raw
    if configured_raw and '://' in configured_raw:
        try:
            configured = str((urlparse(configured_raw).hostname) or '').strip()
        except Exception:
            configured = configured_raw
    configured = str(configured).strip().lower().split(':', 1)[0]
    if configured:
        return configured
    return str(request.host.split(':', 1)[0] or '').strip().lower()


def _passkey_expected_origin():
    current_origin = f'{request.scheme}://{request.host}'
    configured_raw = str(current_app.config.get('WEBAUTHN_ORIGIN') or '').strip()
    if not configured_raw:
        return current_origin

    configured_origins = [
        part.strip()
        for part in configured_raw.split(',')
        if str(part or '').strip()
    ]
    if not configured_origins:
        return current_origin

    current_host = str(request.host.split(':', 1)[0] or '').strip().lower()
    is_localhost_family = current_host == 'localhost' or current_host.endswith('.localhost')
    if is_localhost_family and current_origin not in configured_origins:
        configured_origins.append(current_origin)

    return configured_origins[0] if len(configured_origins) == 1 else configured_origins


def _is_ip_literal(host: str) -> bool:
    try:
        ipaddress.ip_address(str(host or '').strip())
        return True
    except ValueError:
        return False


def _passkey_configuration_error() -> str:
    rp_id = _passkey_rp_id()
    current_host = str(request.host.split(':', 1)[0] or '').strip().lower()
    is_localhost_family = current_host == 'localhost' or current_host.endswith('.localhost')

    if not rp_id:
        return 'Passkey не настроен: пустой RP ID.'
    if _is_ip_literal(rp_id):
        return (
            'Passkey не работает с IP-адресом. Откройте приложение через домен '
            '(например https://sunmessenger.ru) или localhost.'
        )
    if _is_ip_literal(current_host):
        return (
            'Текущий адрес открыт как IP, а WebAuthn требует домен/localhost. '
            'Откройте сайт через доменное имя.'
        )
    if current_host != rp_id and not current_host.endswith(f'.{rp_id}'):
        return (
            f'RP ID "{rp_id}" не совпадает с текущим хостом "{current_host}". '
            'Проверьте WEBAUTHN_RP_ID и адрес входа.'
        )
    if request.scheme != 'https' and not is_localhost_family:
        return 'Passkey требует HTTPS (исключение только localhost / *.localhost).'
    return ''


def _clear_pending_passkey_register() -> None:
    for key in (
        'pending_passkey_register_user_id',
        'pending_passkey_register_challenge_b64',
        'pending_passkey_register_issued_at',
    ):
        session.pop(key, None)


def _stage_pending_passkey_register(user_id: int, challenge_b64: str) -> None:
    _clear_pending_passkey_register()
    session['pending_passkey_register_user_id'] = int(user_id)
    session['pending_passkey_register_challenge_b64'] = str(challenge_b64)
    session['pending_passkey_register_issued_at'] = int(time.time())


def _pending_passkey_register_context():
    user_id_raw = session.get('pending_passkey_register_user_id')
    challenge_b64 = str(session.get('pending_passkey_register_challenge_b64') or '').strip()
    issued_at_raw = session.get('pending_passkey_register_issued_at')
    if not user_id_raw or not challenge_b64 or not issued_at_raw:
        return None
    try:
        issued_at = int(issued_at_raw)
    except (TypeError, ValueError):
        _clear_pending_passkey_register()
        return None
    if int(time.time()) - issued_at > _PENDING_PASSKEY_REGISTER_TTL_SECONDS:
        _clear_pending_passkey_register()
        return None
    return {
        'user_id': int(user_id_raw),
        'challenge_b64': challenge_b64,
    }


def _clear_pending_passkey_login() -> None:
    for key in (
        'pending_passkey_login_user_id',
        'pending_passkey_login_challenge_b64',
        'pending_passkey_login_remember',
        'pending_passkey_login_issued_at',
    ):
        session.pop(key, None)


def _stage_pending_passkey_login(user_id: int | None, challenge_b64: str, *, remember: bool) -> None:
    _clear_pending_passkey_login()
    _clear_pending_totp()
    session.pop('user_id', None)
    session.pop('public_key_pem', None)
    session['pending_passkey_login_user_id'] = int(user_id) if user_id is not None else 0
    session['pending_passkey_login_challenge_b64'] = str(challenge_b64)
    session['pending_passkey_login_remember'] = bool(remember)
    session['pending_passkey_login_issued_at'] = int(time.time())


def _pending_passkey_login_context():
    user_id_raw = session.get('pending_passkey_login_user_id')
    challenge_b64 = str(session.get('pending_passkey_login_challenge_b64') or '').strip()
    issued_at_raw = session.get('pending_passkey_login_issued_at')
    if user_id_raw is None or not challenge_b64 or not issued_at_raw:
        return None
    try:
        issued_at = int(issued_at_raw)
        user_id = int(user_id_raw)
    except (TypeError, ValueError):
        _clear_pending_passkey_login()
        return None
    if int(time.time()) - issued_at > _PENDING_PASSKEY_LOGIN_TTL_SECONDS:
        _clear_pending_passkey_login()
        return None
    return {
        'user_id': user_id if user_id > 0 else None,
        'challenge_b64': challenge_b64,
        'remember': bool(session.get('pending_passkey_login_remember')),
    }


def _extract_passkey_credential_id(credential):
    if not isinstance(credential, dict):
        return ''
    raw_id = credential.get('id') or credential.get('rawId')
    return str(raw_id or '').strip()


@auth_bp.route('/api/passkeys', methods=['GET'])
@limiter.limit("60 per minute")
def api_passkeys():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': '?? ???????????.'}), 401

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
        return jsonify({'success': False, 'error': '?? ???????????.'}), 401
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
            return jsonify({'success': False, 'error': '???????????? ?? ??????.'}), 404

        existing_rows = conn.execute(
            'SELECT credential_id FROM user_passkeys WHERE user_id = ?',
            (user['id'],),
        ).fetchall()
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
        return jsonify({'success': False, 'error': '?? ??????? ??????????? Passkey-????? ??? ????? ??????.'}), 400

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
        return jsonify({'success': False, 'error': '?? ???????????.'}), 401

    pending = _pending_passkey_register_context()
    if not pending:
        return jsonify({'success': False, 'error': '?????? ??????????? passkey ???????. ????????? ???????.'}), 401
    if int(session['user_id']) != int(pending['user_id']):
        _clear_pending_passkey_register()
        return jsonify({'success': False, 'error': '???????????? ???????????? ??? ??????????? passkey.'}), 401

    data = request.get_json(silent=True) or {}
    credential = data.get('credential')
    label = str(data.get('label') or '').strip()[:80]
    if not isinstance(credential, dict):
        return jsonify({'success': False, 'error': '???????????? ?????? passkey.'}), 400

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
        return jsonify({'success': False, 'error': '?? ??????? ??????????? passkey.'}), 400
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
        return jsonify({'success': False, 'error': '???? passkey ??? ????????.'}), 400
    finally:
        conn.close()

    return jsonify({'success': True})

@auth_bp.route('/api/passkeys/delete', methods=['POST'])
@limiter.limit("20 per minute")
def passkeys_delete():
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': '?? ???????????.'}), 401

    data = request.get_json(silent=True) or {}
    credential_id = str(data.get('credential_id') or '').strip()
    if not credential_id:
        return jsonify({'success': False, 'error': '?? ?????? credential_id.'}), 400

    conn = get_db_connection()
    try:
        existing = conn.execute(
            'SELECT id FROM user_passkeys WHERE user_id = ? AND credential_id = ?',
            (session['user_id'], credential_id),
        ).fetchone()
        if not existing:
            return jsonify({'success': False, 'error': 'Passkey ?? ??????.'}), 404
        conn.execute(
            'DELETE FROM user_passkeys WHERE user_id = ? AND credential_id = ?',
            (session['user_id'], credential_id),
        )
        conn.commit()
    finally:
        conn.close()

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
    remember = _wants_remember(data)

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
    _stage_pending_passkey_login(user_id, challenge_b64, remember=remember)

    try:
        options = generate_authentication_options(
            rp_id=_passkey_rp_id(),
            challenge=challenge,
            allow_credentials=allow_credentials or None,
            user_verification=UserVerificationRequirement.REQUIRED,
        )
    except Exception as exc:
        logger.warning('passkey_login_options failed username=%s: %s', username, exc)
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

    remember = bool(pending['remember'])
    _clear_pending_passkey_login()

    if user['totp_secret']:
        _stage_pending_totp(user, remember=remember)
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

    return _login_success_response(user['id'], remember=remember)
