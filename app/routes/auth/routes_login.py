import base64
import logging
import re
import secrets
import time

import pyotp
from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
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
from flask_wtf.csrf import generate_csrf

from app.database import get_db_connection
from app.extensions import limiter
from app.forms import LoginForm, RegistrationForm
from app.services.crypto import add_pem_headers
from app.services.locale import detect_auth_language, language_from_user_row, normalize_language
from app.services.session_state import (
    clear_invalid_session_user,
    resolve_guest_ui_language,
    session_user_exists,
)
from app.routes.auth_utils import (
    build_decoy_login_vault,
    is_valid_b64_blob,
    normalize_login_vault,
    wants_remember,
)
from app.services.refresh_tokens import (
    REFRESH_COOKIE_NAME,
    clear_refresh_cookie,
    issue_refresh_token,
    revoke_refresh_token,
    rotate_refresh_token,
    set_refresh_cookie,
)
from .context import (
    auth_bp,
)
from app.services.web_push import deactivate_user_push_subscriptions
from app.services.totp_backup_codes import verify_and_consume_backup_code

logger = logging.getLogger(__name__)

_LOGIN_VAULT_MAX_BYTES = 24 * 1024
_B64_PATTERN = re.compile(r'^[A-Za-z0-9+/]+={0,2}$')
_PENDING_TOTP_TTL_SECONDS = 5 * 60
_LOGIN_CHALLENGE_TTL_SECONDS = 5 * 60


def _resolve_guest_ui_language() -> str:
    return resolve_guest_ui_language(
        req=request,
        session_state=session,
        detect_auth_language=detect_auth_language,
        normalize_language=normalize_language,
    )


def _clear_invalid_session_user() -> None:
    clear_invalid_session_user(session)


def _session_user_exists() -> bool:
    return session_user_exists(
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


def _build_decoy_login_vault():
    return build_decoy_login_vault()


def _wants_remember(data) -> bool:
    return wants_remember(data)


def _totp_rate_limit_key():
    data = request.get_json(silent=True) or {}
    pending_user_id = session.get('pending_totp_user_id')
    if pending_user_id:
        return f'totp-pending:{pending_user_id}'
    username = str(data.get('username') or '').strip().lower()
    if username:
        return f'totp:{username}'
    return f"totp-ip:{request.remote_addr or '-'}"


def _clear_pending_totp() -> None:
    for key in (
        'pending_totp_user_id',
        'pending_totp_public_key',
        'pending_totp_remember',
        'pending_totp_issued_at',
    ):
        session.pop(key, None)


def _clear_pending_passkey_login() -> None:
    for key in (
        'pending_passkey_login_user_id',
        'pending_passkey_login_challenge_b64',
        'pending_passkey_login_remember',
        'pending_passkey_login_issued_at',
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


def _login_success_response(user_id: int, *, remember: bool):
    payload = {'success': True}
    session.permanent = bool(remember)
    response = make_response(jsonify(payload))
    if remember:
        raw, _exp = issue_refresh_token(user_id, ttl_seconds=None)
        secure = bool(current_app.config.get('SESSION_COOKIE_SECURE'))
        set_refresh_cookie(response, raw, secure=secure)
    return response


def _revoke_request_refresh_cookie() -> bool:
    raw = request.cookies.get(REFRESH_COOKIE_NAME)
    if not raw:
        return False
    return revoke_refresh_token(raw)


@auth_bp.route('/', methods=['GET'])
def index():
    if session.get('user_id') and session.get('public_key_pem'):
        if _session_user_exists():
            return redirect(url_for('chat.chat_index'))
        logger.info('Clearing stale session for missing user_id=%s on index', session.get('user_id'))
        _clear_invalid_session_user()
    elif session.get('user_id') or session.get('public_key_pem'):
        logger.info('Clearing incomplete session on index user_id=%s', session.get('user_id'))
        _clear_invalid_session_user()

    if 'user_id' not in session:
        raw_token = request.cookies.get(REFRESH_COOKIE_NAME)
        if raw_token:
            rotated = rotate_refresh_token(raw_token)
            if rotated:
                user_id, new_raw, _new_exp = rotated
                conn = get_db_connection()
                try:
                    user = conn.execute(
                        'SELECT id, public_key, language FROM users WHERE id = ?',
                        (user_id,),
                    ).fetchone()
                finally:
                    conn.close()
                if user:
                    session.clear()
                    session['user_id'] = user['id']
                    session['public_key_pem'] = user['public_key']
                    session['ui_language'] = language_from_user_row(user, default=_resolve_guest_ui_language())
                    session.permanent = True

                    response = make_response(redirect(url_for('chat.chat_index')))
                    secure = bool(current_app.config.get('SESSION_COOKIE_SECURE'))
                    set_refresh_cookie(response, new_raw, secure=secure)
                    return response

                secure = bool(current_app.config.get('SESSION_COOKIE_SECURE'))
                response = make_response(redirect(url_for('auth.index')))
                clear_refresh_cookie(response, secure=secure)
                return response

            secure = bool(current_app.config.get('SESSION_COOKIE_SECURE'))
            response = make_response(redirect(url_for('auth.index')))
            clear_refresh_cookie(response, secure=secure)
            return response

    if 'user_id' in session:
        return redirect(url_for('chat.chat_index'))

    registration_form = RegistrationForm(prefix='register')
    login_form = LoginForm(prefix='login')
    ui_language = _resolve_guest_ui_language()

    return render_template(
        'index.html',
        registration_form=registration_form,
        login_form=login_form,
        ui_language=ui_language,
    )

@auth_bp.route('/api/set_guest_language', methods=['POST'])
@limiter.limit("120 per minute")
def set_guest_language():
    data = request.get_json(silent=True) or {}
    requested_language = data.get('language')
    resolved_language = normalize_language(
        requested_language,
        default=detect_auth_language(request),
    )
    session['guest_ui_language'] = resolved_language
    if not session.get('user_id'):
        session['ui_language'] = resolved_language
    return jsonify({'success': True, 'language': resolved_language})

@auth_bp.route('/api/get_challenge', methods=['POST'])
@limiter.limit("30 per minute")
def get_challenge():
    """Returns a random challenge nonce for signing by the client's Private Key"""
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip().lower()
    username = username.lstrip('@').strip()

    if not username:
        return jsonify({'success': False, 'error': 'Хотя бы имя пользователя обязательно.'}), 400

    _clear_pending_totp()
    _clear_pending_passkey_login()

    conn = get_db_connection()
    try:
        user = conn.execute('SELECT login_vault FROM users WHERE username = ?', (username,)).fetchone()
    finally:
        conn.close()

    challenge = secrets.token_hex(32)
    session['challenge'] = challenge
    session['login_username'] = username
    session['challenge_issued_at'] = int(time.time())
    normalized_vault = _normalize_login_vault(user['login_vault']) if user and user['login_vault'] else None
    login_vault = normalized_vault or _build_decoy_login_vault()

    return jsonify({
        'success': True, 
        'challenge': challenge,
        'login_vault': login_vault
    })

@auth_bp.route('/api/login_challenge', methods=['POST'])
@limiter.limit("30 per minute")
def login_challenge():  # noqa: C901, PLR0915 - auth challenge flow with guarded early exits
    def _clear_login_challenge_state() -> None:
        session.pop('challenge', None)
        session.pop('login_username', None)
        session.pop('challenge_issued_at', None)

    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({'success': False, 'error': 'Неверный запрос аутентификации.'}), 400
    signature_b64 = data.get('signature')

    if (
        not signature_b64
        or 'challenge' not in session
        or 'login_username' not in session
        or 'challenge_issued_at' not in session
    ):
        _clear_login_challenge_state()
        return jsonify({'success': False, 'error': 'Неверный запрос аутентификации.'}), 400

    username = session['login_username']
    challenge = session['challenge']
    try:
        challenge_issued_at = int(session.get('challenge_issued_at'))
    except (TypeError, ValueError):
        _clear_login_challenge_state()
        return jsonify({'success': False, 'error': 'Invalid authentication request.'}), 400
    if int(time.time()) - challenge_issued_at > _LOGIN_CHALLENGE_TTL_SECONDS:
        _clear_login_challenge_state()
        return jsonify({'success': False, 'error': 'Authentication request expired. Get a new challenge.'}), 400

    conn = get_db_connection()
    try:
        user = conn.execute(
            'SELECT id, public_key, totp_secret, language FROM users WHERE username = ?',
            (username,),
        ).fetchone()
    finally:
        conn.close()

    if not user:
        _clear_login_challenge_state()
        _clear_pending_totp()
        _clear_pending_passkey_login()
        return jsonify({'success': False, 'error': 'Неверные данные для входа.'}), 401

    try:
        full_public_key = add_pem_headers(user['public_key'])
        public_key = serialization.load_pem_public_key(
            full_public_key.encode('utf-8'),
            backend=default_backend()
        )
        signature = base64.b64decode(signature_b64)

        public_key.verify(
            signature,
            challenge.encode('utf-8'),
            padding.PKCS1v15(),
            hashes.SHA256()
        )

        _clear_login_challenge_state()
        _clear_pending_passkey_login()

        if user['totp_secret']:
            _stage_pending_totp(user, remember=_wants_remember(data))
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

        return _login_success_response(user['id'], remember=_wants_remember(data))
    except InvalidSignature:
        _clear_login_challenge_state()
        _clear_pending_totp()
        _clear_pending_passkey_login()
        return jsonify({'success': False, 'error': 'Неверная подпись! Приватный ключ не совпадает.'}), 401
    except ValueError:
        _clear_login_challenge_state()
        _clear_pending_totp()
        _clear_pending_passkey_login()
        logger.warning('login_challenge invalid key material')
        return jsonify({'success': False, 'error': 'Неверные данные для входа.'}), 401
    except Exception:
        _clear_login_challenge_state()
        _clear_pending_totp()
        _clear_pending_passkey_login()
        logger.exception('login_challenge unexpected error')
        return jsonify({'success': False, 'error': 'Ошибка аутентификации.'}), 500

@auth_bp.route('/api/login_totp', methods=['POST'])
@limiter.limit("8 per 5 minute", key_func=_totp_rate_limit_key)
def login_totp():
    """Complete login after private-key challenge with a TOTP second factor."""
    data = request.get_json(silent=True) or {}
    totp_code = data.get('totp_code', '').strip()
    pending = _pending_totp_context()

    backup_code = str(data.get('backup_code') or '').strip()

    if not pending:
        return jsonify({'success': False, 'error': 'Сначала подтвердите вход 24 словами.'}), 401
    if not totp_code and not backup_code:
        return jsonify({'success': False, 'error': 'Введите 6-значный код или резервный код.'}), 400
    if totp_code and backup_code:
        return jsonify({'success': False, 'error': 'Укажите только один код — обычный или резервный.'}), 400

    conn = get_db_connection()
    try:
        user = conn.execute(
            'SELECT id, public_key, totp_secret, language FROM users WHERE id = ?',
            (pending['user_id'],),
        ).fetchone()

        if not user or not user['totp_secret'] or user['public_key'] != pending['public_key']:
            _clear_pending_totp()
            return jsonify({'success': False, 'error': 'Неверные данные для входа.'}), 401

        if backup_code:
            if not verify_and_consume_backup_code(conn, int(user['id']), backup_code):
                return jsonify({'success': False, 'error': 'Неверный или уже использованный резервный код.'}), 401
            conn.commit()
        else:
            totp = pyotp.TOTP(user['totp_secret'])
            if not totp.verify(totp_code, valid_window=1):
                return jsonify({'success': False, 'error': 'Неверный код. Проверьте время на устройстве.'}), 401
    finally:
        conn.close()

    remember = bool(pending['remember'])
    session.clear()
    session['public_key_pem'] = user['public_key']
    session['user_id'] = user['id']
    session['ui_language'] = language_from_user_row(user, default=_resolve_guest_ui_language())

    return _login_success_response(user['id'], remember=remember)

@auth_bp.route('/api/refresh', methods=['POST'])
@limiter.limit("60 per minute")
def api_refresh():
    """Rotate refresh token and re-establish session context."""
    raw_token = request.cookies.get(REFRESH_COOKIE_NAME)
    if not raw_token:
        return jsonify({'success': False, 'error': '\u041d\u0435\u0442 refresh-\u0442\u043e\u043a\u0435\u043d\u0430.'}), 401

    result = rotate_refresh_token(raw_token)
    if not result:
        secure = bool(current_app.config.get('SESSION_COOKIE_SECURE'))
        response = make_response(jsonify({'success': False, 'error': 'Refresh-\u0442\u043e\u043a\u0435\u043d \u043d\u0435\u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0442\u0435\u043b\u0435\u043d.'}), 401)
        clear_refresh_cookie(response, secure=secure)
        return response

    user_id, new_raw, _new_exp = result

    conn = get_db_connection()
    try:
        user = conn.execute(
            'SELECT id, public_key, language FROM users WHERE id = ?',
            (user_id,),
        ).fetchone()
    finally:
        conn.close()
    if not user:
        secure = bool(current_app.config.get('SESSION_COOKIE_SECURE'))
        response = make_response(jsonify({'success': False, 'error': 'Пользователь не найден.'}), 401)
        clear_refresh_cookie(response, secure=secure)
        return response

    # Re-establish Flask session so HTTP/socket guards keep working.
    session.clear()
    session['user_id'] = user['id']
    session['public_key_pem'] = user['public_key']
    session['ui_language'] = language_from_user_row(user, default=_resolve_guest_ui_language())
    session.permanent = True

    response = make_response(jsonify({
        'success': True,
        'csrf_token': generate_csrf(),
    }))
    secure = bool(current_app.config.get('SESSION_COOKIE_SECURE'))
    set_refresh_cookie(response, new_raw, secure=secure)
    return response

@auth_bp.route('/logout', methods=['POST'])
def logout():
    if session.get('user_id'):
        conn = get_db_connection()
        try:
            deactivate_user_push_subscriptions(conn, user_id=int(session['user_id']))
            conn.commit()
        finally:
            conn.close()
    _revoke_request_refresh_cookie()
    session.clear()
    flash('Вы успешно вышли из системы.', 'success')
    response = make_response(redirect(url_for('auth.index')))
    secure = bool(current_app.config.get('SESSION_COOKIE_SECURE'))
    clear_refresh_cookie(response, secure=secure)
    return response

@auth_bp.route('/api/logout', methods=['POST'])
def api_logout():
    if session.get('user_id'):
        conn = get_db_connection()
        try:
            deactivate_user_push_subscriptions(conn, user_id=int(session['user_id']))
            conn.commit()
        finally:
            conn.close()
    _revoke_request_refresh_cookie()
    session.clear()
    response = make_response(jsonify({'success': True}))
    secure = bool(current_app.config.get('SESSION_COOKIE_SECURE'))
    clear_refresh_cookie(response, secure=secure)
    return response

@auth_bp.route('/api/get_login_vault', methods=['GET'])
@limiter.limit("20 per minute")
def get_login_vault():
    """Returns the encrypted key vault for the currently authenticated user."""
    if 'user_id' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401
    conn = get_db_connection()
    try:
        row = conn.execute('SELECT login_vault FROM users WHERE id = ?', (session['user_id'],)).fetchone()
        if not row:
            return jsonify({'success': False, 'error': 'Пользователь не найден.'}), 404
        if not row['login_vault']:
            return jsonify({'success': True, 'login_vault': None})
        normalized = _normalize_login_vault(row['login_vault'])
        if not normalized:
            logger.warning('Invalid login_vault in DB for user_id=%s', session.get('user_id'))
            return jsonify({'success': False, 'error': '\u041f\u043e\u0432\u0440\u0435\u0436\u0434\u0451\u043d\u043d\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435 \u0441\u0435\u0439\u0444\u0430.'}), 500
        return jsonify({'success': True, 'login_vault': normalized})
    finally:
        conn.close()
