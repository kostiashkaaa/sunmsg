import re
import base64
import hashlib
import json
import logging
import os
import secrets
import time
import ipaddress
from urllib.parse import urlparse
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from flask import Blueprint, request, jsonify, session, current_app, make_response, flash, redirect, render_template, url_for
from flask_wtf.csrf import generate_csrf
import pyotp

from app.db_backend import DatabaseError, IntegrityError
from app.extensions import limiter, socketio
from app.forms import LoginForm, RegistrationForm, SettingsForm
from app.services.blocking import list_visible_contact_public_keys
from app.services.crypto import add_pem_headers, normalize_public_key
from app.services.refresh_tokens import (
    REFRESH_COOKIE_NAME,
    clear_refresh_cookie,
    issue_refresh_token,
    revoke_refresh_token,
    rotate_refresh_token,
    set_refresh_cookie,
)

from app.database import get_db_connection
from app.services.locale import detect_auth_language, language_from_user_row, normalize_language
from app.services.favorites_chat import ensure_saved_messages_chat
from app.services.presence import is_effectively_online
from app.services.session_state import (
    clear_invalid_session_user as _clear_invalid_session_user_impl,
    resolve_guest_ui_language as _resolve_guest_ui_language_impl,
    session_user_exists as _session_user_exists_impl,
)
from app.routes.auth_utils import (
    avatar_storage_name_from_url,
    build_decoy_login_vault,
    is_valid_b64_blob,
    normalize_login_vault,
    safe_remove_stored_file,
    wants_remember,
)
from app.routes.auth_session_utils import (
    consume_register_challenge,
    issue_register_challenge,
)

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

auth_bp = Blueprint('auth', __name__)
logger = logging.getLogger(__name__)
_LOGIN_VAULT_MAX_BYTES = 24 * 1024
_USERNAME_MAX_LENGTH = 50
_DISPLAY_NAME_MAX_LENGTH = 50
_B64_PATTERN = re.compile(r'^[A-Za-z0-9+/]+={0,2}$')
_REGISTER_CHALLENGE_TTL_SECONDS = 5 * 60
_PENDING_TOTP_TTL_SECONDS = 5 * 60
_PENDING_TOTP_SETUP_TTL_SECONDS = 10 * 60
_PENDING_PASSKEY_REGISTER_TTL_SECONDS = 5 * 60
_PENDING_PASSKEY_LOGIN_TTL_SECONDS = 5 * 60
_KEY_TRANSFER_SESSION_TTL_SECONDS = 3 * 60
_KEY_TRANSFER_SESSION_ID_PATTERN = re.compile(r'^[A-Za-z0-9_-]{16,128}$')
_B64URL_PATTERN = re.compile(r'^[A-Za-z0-9_-]+$')
_BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
CHAT_MEDIA_FOLDER = os.path.join(_BASE_DIR, 'storage', 'chat_media')
AVATAR_FOLDER = os.path.join(_BASE_DIR, 'static', 'avatars')

# Keep shared symbols alive for split route modules importing from .context.
_ROUTE_SHARED_SYMBOLS = (
    base64,
    json,
    secrets,
    InvalidSignature,
    default_backend,
    hashes,
    serialization,
    padding,
    flash,
    redirect,
    render_template,
    url_for,
    generate_csrf,
    pyotp,
    DatabaseError,
    IntegrityError,
    limiter,
    socketio,
    LoginForm,
    RegistrationForm,
    SettingsForm,
    list_visible_contact_public_keys,
    add_pem_headers,
    normalize_public_key,
    clear_refresh_cookie,
    rotate_refresh_token,
    language_from_user_row,
    is_effectively_online,
)


def _resolve_guest_ui_language() -> str:
    return _resolve_guest_ui_language_impl(
        req=request,
        session_state=session,
        detect_auth_language=detect_auth_language,
        normalize_language=normalize_language,
    )


def _clear_invalid_session_user() -> None:
    _clear_invalid_session_user_impl(session)


def _session_user_exists() -> bool:
    return _session_user_exists_impl(
        user_id=session.get('user_id'),
        public_key=session.get('public_key_pem'),
        get_db_connection=get_db_connection,
        logger=logger,
    )


def _is_valid_b64_blob(value: str, *, min_bytes: int = 1, max_bytes: int = 16 * 1024) -> bool:
    return is_valid_b64_blob(
        value,
        pattern=_B64_PATTERN,
        min_bytes=min_bytes,
        max_bytes=max_bytes,
    )


def _normalize_login_vault(raw_value):
    return normalize_login_vault(
        raw_value,
        login_vault_max_bytes=_LOGIN_VAULT_MAX_BYTES,
        is_valid_b64_blob_func=_is_valid_b64_blob,
    )


def _ensure_default_saved_messages_chat(conn, *, user_id: int, public_key: str) -> str:
    return ensure_saved_messages_chat(
        conn,
        user_id=user_id,
        public_key=public_key,
    )


def _totp_rate_limit_key():
    data = request.get_json(silent=True) or {}
    pending_user_id = session.get('pending_totp_user_id')
    if pending_user_id:
        return f'totp-pending:{pending_user_id}'
    username = str(data.get('username') or '').strip().lower()
    if username:
        return f'totp:{username}'
    return f"totp-ip:{request.remote_addr or '-'}"

def _build_decoy_login_vault():
    return build_decoy_login_vault()


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


def _clear_pending_totp_setup() -> None:
    for key in (
        'pending_totp_setup_user_id',
        'pending_totp_setup_secret',
        'pending_totp_setup_issued_at',
    ):
        session.pop(key, None)


def _stage_pending_totp_setup(*, user_id: int, secret: str) -> None:
    _clear_pending_totp_setup()
    session['pending_totp_setup_user_id'] = int(user_id)
    session['pending_totp_setup_secret'] = str(secret or '').strip()
    session['pending_totp_setup_issued_at'] = int(time.time())


def _pending_totp_setup_context(*, user_id: int | None = None):
    pending_user_id = session.get('pending_totp_setup_user_id')
    pending_secret = str(session.get('pending_totp_setup_secret') or '').strip()
    issued_at_raw = session.get('pending_totp_setup_issued_at')
    if not pending_user_id or not pending_secret or not issued_at_raw:
        _clear_pending_totp_setup()
        return None
    try:
        issued_at = int(issued_at_raw)
        pending_user_id = int(pending_user_id)
    except (TypeError, ValueError):
        _clear_pending_totp_setup()
        return None
    if user_id is not None and pending_user_id != int(user_id):
        _clear_pending_totp_setup()
        return None
    if int(time.time()) - issued_at > _PENDING_TOTP_SETUP_TTL_SECONDS:
        _clear_pending_totp_setup()
        return None
    return {
        'user_id': pending_user_id,
        'secret': pending_secret,
    }


def _clear_pending_login_qr() -> None:
    for key in (
        'pending_login_qr_session_id',
        'pending_login_qr_issued_at',
    ):
        session.pop(key, None)


def _stage_pending_login_qr(session_id: str) -> None:
    _clear_pending_login_qr()
    session['pending_login_qr_session_id'] = str(session_id or '').strip()
    session['pending_login_qr_issued_at'] = int(time.time())


def _pending_login_qr_session_id() -> str:
    session_id = str(session.get('pending_login_qr_session_id') or '').strip()
    issued_at_raw = session.get('pending_login_qr_issued_at')
    if not session_id or not issued_at_raw:
        _clear_pending_login_qr()
        return ''
    try:
        issued_at = int(issued_at_raw)
    except (TypeError, ValueError):
        _clear_pending_login_qr()
        return ''
    if int(time.time()) - issued_at > _KEY_TRANSFER_SESSION_TTL_SECONDS:
        _clear_pending_login_qr()
        return ''
    if not _is_valid_key_transfer_session_id(session_id):
        _clear_pending_login_qr()
        return ''
    return session_id


def _stage_pending_totp(user, *, remember: bool) -> None:
    _clear_pending_totp()
    session.pop('user_id', None)
    session.pop('public_key_pem', None)
    session['pending_totp_user_id'] = int(user['id'])
    session['pending_totp_public_key'] = user['public_key']
    session['pending_totp_remember'] = bool(remember)
    session['pending_totp_issued_at'] = int(time.time())


def _pending_totp_context():
    user_id = session.get('pending_totp_user_id')
    public_key = str(session.get('pending_totp_public_key') or '').strip()
    issued_at_raw = session.get('pending_totp_issued_at')
    if not user_id or not public_key or not issued_at_raw:
        return None
    try:
        issued_at = int(issued_at_raw)
    except (TypeError, ValueError):
        _clear_pending_totp()
        return None
    if int(time.time()) - issued_at > _PENDING_TOTP_TTL_SECONDS:
        _clear_pending_totp()
        return None
    return {
        'user_id': int(user_id),
        'public_key': public_key,
        'remember': bool(session.get('pending_totp_remember')),
    }


def _webauthn_unavailable_response():
    message = 'Passkey вход временно недоступен на сервере.'
    if _WEBAUTHN_IMPORT_ERROR:
        logger.warning('WebAuthn unavailable: %s', _WEBAUTHN_IMPORT_ERROR)
    return jsonify({'success': False, 'error': message}), 503


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


def _is_valid_p256_jwk(value) -> bool:
    if not isinstance(value, dict):
        return False
    if str(value.get('kty') or '') != 'EC':
        return False
    if str(value.get('crv') or '') != 'P-256':
        return False
    x = str(value.get('x') or '').strip()
    y = str(value.get('y') or '').strip()
    if not x or not y:
        return False
    if len(x) > 200 or len(y) > 200:
        return False
    return bool(_B64URL_PATTERN.fullmatch(x) and _B64URL_PATTERN.fullmatch(y))


def _is_valid_b64url_blob(value: str, *, max_len: int = 16384) -> bool:
    text = str(value or '').strip()
    if not text:
        return False
    if len(text) > max_len:
        return False
    return bool(_B64URL_PATTERN.fullmatch(text))


def _is_valid_key_transfer_session_id(value: str) -> bool:
    return bool(_KEY_TRANSFER_SESSION_ID_PATTERN.fullmatch(str(value or '').strip()))


def _cleanup_key_transfer_sessions(conn) -> None:
    now = int(time.time())
    conn.execute(
        '''
        DELETE FROM key_transfer_sessions
        WHERE expires_at <= ?
           OR (status = 'claimed' AND claimed_at IS NOT NULL AND claimed_at <= ?)
        ''',
        (now, now - 60),
    )


def _cleanup_login_key_transfer_sessions(conn) -> None:
    now = int(time.time())
    conn.execute(
        '''
        DELETE FROM key_transfer_login_sessions
        WHERE expires_at <= ?
           OR (status = 'claimed' AND claimed_at IS NOT NULL AND claimed_at <= ?)
        ''',
        (now, now - 60),
    )


def _login_success_response(user_id: int, *, remember: bool):
    payload = {'success': True}
    session.permanent = bool(remember)
    response = make_response(jsonify(payload))
    if remember:
        raw, _exp = issue_refresh_token(user_id)
        secure = bool(current_app.config.get('SESSION_COOKIE_SECURE'))
        set_refresh_cookie(response, raw, secure=secure)
    return response


def _issue_register_challenge() -> str:
    return issue_register_challenge(session)


def _consume_register_challenge():
    return consume_register_challenge(session)


def _safe_remove_stored_file(base_dir: str, storage_name: str) -> None:
    safe_remove_stored_file(base_dir, storage_name, logger=logger)


def _avatar_storage_name_from_url(avatar_url: str):
    return avatar_storage_name_from_url(avatar_url)


def _current_refresh_family_id(conn, raw_token: str | None):
    raw = str(raw_token or '').strip()
    if not raw:
        return None

    token_hash = hashlib.sha256(raw.encode('utf-8')).hexdigest()
    row = conn.execute(
        'SELECT family_id FROM refresh_tokens WHERE token_hash = ? LIMIT 1',
        (token_hash,),
    ).fetchone()
    if not row or not row['family_id']:
        return None
    return str(row['family_id'])












































def _revoke_request_refresh_cookie() -> bool:
    raw = request.cookies.get(REFRESH_COOKIE_NAME)
    if not raw:
        return False
    return revoke_refresh_token(raw)

# Export shared names (including helper symbols prefixed with '_') for split route modules.
__all__ = [name for name in globals() if not name.startswith('__')]
