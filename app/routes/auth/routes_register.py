import base64
import re
import time

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from flask import current_app, jsonify, make_response, request, session

from app.database import get_db_connection
from app.db_backend import IntegrityError
from app.extensions import limiter
from app.routes.auth_helpers_register import (
    DISPLAY_NAME_MAX_LENGTH,
    REGISTER_CHALLENGE_TTL_SECONDS,
    USERNAME_MAX_LENGTH,
    consume_register_challenge_from_session,
    ensure_default_saved_messages_chat,
    issue_register_challenge_for_session,
    logger,
    normalize_login_vault_payload,
)
from app.services.crypto import add_pem_headers, normalize_public_key
from app.services.locale import detect_auth_language, normalize_language
from app.services.refresh_tokens import issue_refresh_token, set_refresh_cookie
from app.services.session_policy import SESSION_AUTO_LOGOUT_DEFAULT_SECONDS, apply_session_auto_logout
from .context import (
    auth_bp,
)

@auth_bp.route('/api/get_register_challenge', methods=['POST'])
@limiter.limit("10 per minute")
def get_register_challenge():
    """One-time challenge used to prove private-key ownership during registration."""
    challenge = issue_register_challenge_for_session(session)
    return jsonify({'success': True, 'challenge': challenge})

@auth_bp.route('/api/register_client', methods=['POST'])
@limiter.limit("5 per minute")
def register_client():  # noqa: C901, PLR0915 - registration orchestration with validation gates
    """Registers a new user without enabling TOTP by default."""
    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip()
    display_name = (data.get('display_name') or '').strip()
    public_key_pem = data.get('public_key')
    login_vault = data.get('login_vault')
    register_challenge = str(data.get('register_challenge') or '').strip()
    register_signature = str(data.get('register_signature') or '').strip()
    requested_language = data.get('language')

    if not username or not display_name or not public_key_pem:
        return jsonify({'success': False, 'error': 'Все поля обязательны.'}), 400
    if not register_challenge or not register_signature:
        return jsonify({'success': False, 'error': 'Не подтверждено владение приватным ключом.'}), 400
    if len(username) < 2:
        return jsonify({'success': False, 'error': 'Никнейм должен содержать не менее 2 символов.'}), 400
    if len(username) > USERNAME_MAX_LENGTH:
        return jsonify({'success': False, 'error': 'Никнейм не должен превышать 50 символов.'}), 400
    if len(display_name) > DISPLAY_NAME_MAX_LENGTH:
        return jsonify({'success': False, 'error': 'Отображаемое имя не должно превышать 50 символов.'}), 400

    if not re.fullmatch(r'[a-z0-9_]+', username):
        return jsonify({'success': False, 'error': 'Никнейм может содержать только a–z, 0–9, _'}), 400

    expected_challenge, challenge_issued_at = consume_register_challenge_from_session(session)
    if not expected_challenge or expected_challenge != register_challenge:
        return jsonify({'success': False, 'error': 'Регистрационный challenge недействителен. Повторите попытку.'}), 400
    if (int(time.time()) - int(challenge_issued_at)) > REGISTER_CHALLENGE_TTL_SECONDS:
        return jsonify({'success': False, 'error': 'Регистрационный challenge устарел. Повторите попытку.'}), 400

    public_key_pem = normalize_public_key(public_key_pem)
    normalized_login_vault = normalize_login_vault_payload(login_vault)
    if login_vault is not None and normalized_login_vault is None:
        return jsonify({'success': False, 'error': 'Некорректный формат login_vault.'}), 400

    try:
        full_public_key = add_pem_headers(public_key_pem)
        public_key = serialization.load_pem_public_key(
            full_public_key.encode('utf-8'),
            backend=default_backend()
        )
        signature = base64.b64decode(register_signature, validate=True)
        public_key.verify(
            signature,
            register_challenge.encode('utf-8'),
            padding.PKCS1v15(),
            hashes.SHA256()
        )
    except InvalidSignature:
        return jsonify({'success': False, 'error': 'Подпись challenge недействительна.'}), 401
    except Exception:
        logger.exception('register_client challenge verify failed')
        return jsonify({'success': False, 'error': 'Ошибка проверки владения ключом.'}), 400

    conn = get_db_connection()
    created_user_id = 0
    created_user_public_key = ''
    try:
        profile_language = normalize_language(
            requested_language,
            default=normalize_language(session.get('guest_ui_language'), default=detect_auth_language(request)),
        )
        conn.execute(
            '''
            INSERT INTO users (
                public_key, username, display_name, totp_secret, totp_enabled_at, login_vault, language
            ) VALUES (?, ?, ?, NULL, NULL, ?, ?)
            ''',
            (public_key_pem, username, display_name, normalized_login_vault, profile_language)
        )
        inserted_user = conn.execute(
            '''
            SELECT id, public_key
            FROM users
            WHERE username = ?
            ''',
            (username,),
        ).fetchone()
        if not inserted_user:
            logger.error('register_client failed to reload inserted user username=%s', username)
            return jsonify({'success': False, 'error': 'Не удалось завершить регистрацию. Повторите попытку.'}), 500
        created_user_id = int(inserted_user['id'])
        created_user_public_key = str(inserted_user['public_key'] or '')
        ensure_default_saved_messages_chat(
            conn,
            user_id=created_user_id,
            public_key=created_user_public_key,
        )
        conn.commit()
    except IntegrityError as exc:
        err_text = str(exc).lower()
        if 'username' in err_text or 'unique' in err_text:
            return jsonify({'success': False, 'error': 'Имя пользователя уже занято.'}), 400
        logger.exception('register_client integrity error')
        return jsonify({'success': False, 'error': 'Ошибка базы данных при регистрации.'}), 500
    finally:
        conn.close()

    session['user_id'] = created_user_id
    session['public_key_pem'] = created_user_public_key
    session['ui_language'] = profile_language
    apply_session_auto_logout(session, SESSION_AUTO_LOGOUT_DEFAULT_SECONDS)
    for key in (
        'pending_totp_user_id',
        'pending_totp_public_key',
        'pending_totp_remember',
        'pending_totp_issued_at',
        'pending_totp_setup_user_id',
        'pending_totp_setup_secret',
        'pending_totp_setup_issued_at',
    ):
        session.pop(key, None)

    response = make_response(jsonify({'success': True}))
    raw, _exp = issue_refresh_token(
        created_user_id,
        ttl_seconds=SESSION_AUTO_LOGOUT_DEFAULT_SECONDS,
    )
    secure = bool(current_app.config.get('SESSION_COOKIE_SECURE'))
    set_refresh_cookie(
        response,
        raw,
        secure=secure,
        max_age_seconds=SESSION_AUTO_LOGOUT_DEFAULT_SECONDS,
    )
    return response
