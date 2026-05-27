import base64
import json
import logging
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
    g,
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
from app.services.refresh_tokens import (
    REFRESH_COOKIE_NAME,
    clear_refresh_cookie,
    refresh_cookie_max_age_from_expiry,
    rotate_refresh_token,
    set_refresh_cookie,
)
from app.services.session_policy import (
    apply_session_auto_logout,
    session_auto_logout_payload,
    session_auto_logout_seconds_from_row,
)
from .context import (
    auth_bp,
    _build_decoy_login_vault,
    _clear_invalid_session_user,
    _clear_pending_passkey_login,
    _clear_pending_totp,
    _login_success_response,
    _normalize_login_vault,
    _pending_totp_context,
    _resolve_guest_ui_language,
    _revoke_request_refresh_cookie,
    _session_user_exists,
    _stage_pending_totp,
    _totp_rate_limit_key,
)
from app.services.web_push import deactivate_user_push_subscriptions
from app.services.totp_backup_codes import verify_and_consume_backup_code
from app.services.totp_secret_store import (
    decode_totp_secret,
    encode_totp_secret,
    is_encoded_totp_secret,
)

logger = logging.getLogger(__name__)

_LOGIN_CHALLENGE_TTL_SECONDS = 5 * 60


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
                user_id, new_raw, new_exp = rotated
                conn = get_db_connection()
                try:
                    user = conn.execute(
                        'SELECT id, public_key, language, session_auto_logout_seconds FROM users WHERE id = ?',
                        (user_id,),
                    ).fetchone()
                finally:
                    conn.close()
                if user:
                    session.clear()
                    session['user_id'] = user['id']
                    session['public_key_pem'] = user['public_key']
                    session['ui_language'] = language_from_user_row(user, default=_resolve_guest_ui_language())
                    apply_session_auto_logout(session, session_auto_logout_seconds_from_row(user))

                    response = make_response(redirect(url_for('chat.chat_index')))
                    secure = bool(current_app.config.get('SESSION_COOKIE_SECURE'))
                    set_refresh_cookie(
                        response,
                        new_raw,
                        secure=secure,
                        max_age_seconds=refresh_cookie_max_age_from_expiry(new_exp),
                    )
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

    response = make_response(render_template(
        'index.html',
        registration_form=registration_form,
        login_form=login_form,
        ui_language=ui_language,
    ))
    if request.args.get('reset_client') == '1':
        response.headers['Clear-Site-Data'] = '"cache"'
    return response


@auth_bp.route('/reset-client', methods=['GET'])
def reset_client_state():
    target_url = url_for(
        'auth.index',
        reset_client='1',
        reset_done='1',
        reset_v=int(time.time()),
    )
    csp_nonce = str(getattr(g, 'csp_nonce', '') or '')
    target_json = json.dumps(target_url)
    html = f"""<!doctype html>
<html lang="ru">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>SUN reset</title>
    <style nonce="{csp_nonce}">
        body {{
            margin: 0;
            min-height: 100vh;
            display: grid;
            place-items: center;
            background: #f7f4ee;
            color: #221d19;
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }}
        main {{
            width: min(100% - 40px, 420px);
            border: 1px solid #ddd5c8;
            border-radius: 14px;
            background: #fffdf8;
            padding: 24px;
            box-sizing: border-box;
        }}
        h1 {{
            margin: 0 0 12px;
            font-size: 26px;
            line-height: 1.1;
        }}
        p {{
            margin: 0;
            color: #6d6459;
            line-height: 1.45;
        }}
    </style>
</head>
<body>
    <main>
        <h1>Reset SUN</h1>
        <p id="status">Cleaning browser cache...</p>
    </main>
    <script nonce="{csp_nonce}">
    (() => {{
        const targetUrl = {target_json};
        const statusEl = document.getElementById('status');
        const setStatus = (text) => {{
            if (statusEl) statusEl.textContent = text;
        }};
        const runStep = async (label, action) => {{
            try {{
                await action();
            }} catch (_error) {{}}
            setStatus(label);
        }};
        const reset = async () => {{
            await runStep('Removing old service worker...', async () => {{
                if (!('serviceWorker' in navigator)) return;
                const registrations = await navigator.serviceWorker.getRegistrations();
                await Promise.all(registrations.map((registration) => registration.unregister()));
            }});
            await runStep('Clearing static cache...', async () => {{
                if (!('caches' in window)) return;
                const keys = await caches.keys();
                await Promise.all(keys.map((key) => caches.delete(key)));
            }});
            setStatus('Opening fresh SUN...');
            window.setTimeout(() => {{
                window.location.replace(targetUrl);
            }}, 250);
        }};
        reset().catch(() => {{
            window.location.replace(targetUrl);
        }});
    }})();
    </script>
</body>
</html>"""
    response = make_response(html)
    response.headers['Content-Type'] = 'text/html; charset=utf-8'
    response.headers['Clear-Site-Data'] = '"cache"'
    return response


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
        return jsonify({'success': False, 'error': 'Неверный запрос аутентификации.'}), 400
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
        return jsonify({'success': False, 'error': 'Сначала подтвердите вход словами восстановления.'}), 401
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
            totp_secret = decode_totp_secret(user['totp_secret'])
            if not totp_secret:
                return jsonify({'success': False, 'error': 'Invalid TOTP configuration.'}), 401
            totp = pyotp.TOTP(totp_secret)
            if not totp.verify(totp_code, valid_window=1):
                return jsonify({'success': False, 'error': 'Неверный код. Проверьте время на устройстве.'}), 401
            if not is_encoded_totp_secret(user['totp_secret']):
                conn.execute(
                    'UPDATE users SET totp_secret = ? WHERE id = ?',
                    (encode_totp_secret(totp_secret), int(user['id'])),
                )
                conn.commit()
    finally:
        conn.close()

    session.clear()
    session['public_key_pem'] = user['public_key']
    session['user_id'] = user['id']
    session['ui_language'] = language_from_user_row(user, default=_resolve_guest_ui_language())

    return _login_success_response(user['id'])

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

    user_id, new_raw, new_exp = result

    conn = get_db_connection()
    try:
        user = conn.execute(
            'SELECT id, public_key, language, session_auto_logout_seconds FROM users WHERE id = ?',
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
    apply_session_auto_logout(session, session_auto_logout_seconds_from_row(user))

    response = make_response(jsonify({
        'success': True,
        'csrf_token': generate_csrf(),
        **session_auto_logout_payload(session),
    }))
    secure = bool(current_app.config.get('SESSION_COOKIE_SECURE'))
    set_refresh_cookie(
        response,
        new_raw,
        secure=secure,
        max_age_seconds=refresh_cookie_max_age_from_expiry(new_exp),
    )
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
