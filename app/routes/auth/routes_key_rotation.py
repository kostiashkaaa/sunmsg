"""Public-key rotation endpoint.

A user rotates by:
1. Generating a fresh RSA keypair client-side.
2. Re-encrypting their login_vault (which holds the recovery-words-protected
   private key) for the new keypair.
3. Signing `{old_pub, new_pub, ts}` with the *old* private key — proof that
   the rotation came from someone who holds the current key.

The server verifies the signature with the user's stored public key, swaps
both columns atomically, revokes all refresh tokens (forces re-login on
every device — including the originating one, which is expected since its
private key is now stale), and writes an audit row.

There is no way to recover an account whose old private key is lost: by
design, the server never holds plaintext private material. This endpoint
exists for *proactive* rotation, not key loss.
"""

from __future__ import annotations

import base64
import json
import logging
import time

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from flask import current_app, jsonify, make_response, request, session

from app.database import get_db_connection
from app.extensions import limiter
from app.routes.auth_helpers_register import normalize_login_vault_payload
from app.services.crypto import add_pem_headers, normalize_public_key
from app.services.refresh_tokens import (
    REFRESH_COOKIE_NAME,
    clear_refresh_cookie,
    revoke_all_for_user,
)
from .context import auth_bp

logger = logging.getLogger(__name__)

# Max age of the client-side `ts` field. Tight, so a captured rotation
# request can't be replayed days later if the old private key leaks.
_ROTATION_TIMESTAMP_SKEW_SECONDS = 5 * 60
# RSA keys we accept. Matches the bounds used at registration time.
_MIN_PUBLIC_KEY_PEM_BYTES = 200
_MAX_PUBLIC_KEY_PEM_BYTES = 4 * 1024
_MIN_RSA_KEY_BITS = 2048


def _load_user_public_key(pem_value: str):
    full_pem = add_pem_headers(pem_value)
    return serialization.load_pem_public_key(
        full_pem.encode('utf-8'),
        backend=default_backend(),
    )


def _validate_new_public_key_pem(raw_pem: str) -> str | None:
    """Return canonical headerless PEM or None if rejected."""
    candidate = str(raw_pem or '').strip()
    if not candidate:
        return None
    if not (_MIN_PUBLIC_KEY_PEM_BYTES <= len(candidate) <= _MAX_PUBLIC_KEY_PEM_BYTES):
        return None
    try:
        loaded = serialization.load_pem_public_key(
            add_pem_headers(candidate).encode('utf-8'),
            backend=default_backend(),
        )
    except (ValueError, TypeError):
        return None
    if not isinstance(loaded, rsa.RSAPublicKey):
        return None
    if loaded.key_size < _MIN_RSA_KEY_BITS:
        return None
    return normalize_public_key(candidate)


def _signed_payload_bytes(*, old_pem: str, new_pem: str, ts: int) -> bytes:
    # Stable JSON — same key order on client and server. Don't include
    # any user-provided field that we don't validate.
    return json.dumps(
        {
            'op': 'key_rotation_v1',
            'old_public_key': old_pem,
            'new_public_key': new_pem,
            'ts': int(ts),
        },
        separators=(',', ':'),
        sort_keys=True,
    ).encode('utf-8')


@auth_bp.route('/api/keys/rotate', methods=['POST'])
@limiter.limit('5 per hour')
def api_keys_rotate():  # noqa: C901, PLR0911 - guarded validation chain
    if 'user_id' not in session or 'public_key_pem' not in session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401

    data = request.get_json(silent=True) or {}
    if not isinstance(data, dict):
        return jsonify({'success': False, 'error': 'Некорректный запрос.'}), 400

    new_pem_raw = data.get('new_public_key')
    signature_b64 = data.get('signature')
    ts_raw = data.get('ts')
    new_login_vault_raw = data.get('new_login_vault')

    canonical_new_pem = _validate_new_public_key_pem(new_pem_raw)
    if not canonical_new_pem:
        return jsonify({'success': False, 'error': 'Некорректный новый публичный ключ.'}), 400

    try:
        ts = int(ts_raw)
    except (TypeError, ValueError):
        return jsonify({'success': False, 'error': 'Некорректная метка времени.'}), 400
    now = int(time.time())
    if abs(now - ts) > _ROTATION_TIMESTAMP_SKEW_SECONDS:
        return jsonify({'success': False, 'error': 'Истекла метка времени запроса.'}), 400

    if not isinstance(signature_b64, str) or not signature_b64.strip():
        return jsonify({'success': False, 'error': 'Отсутствует подпись.'}), 400
    try:
        signature_bytes = base64.b64decode(signature_b64, validate=True)
    except (ValueError, TypeError):
        return jsonify({'success': False, 'error': 'Некорректная подпись.'}), 400

    normalized_new_vault = normalize_login_vault_payload(new_login_vault_raw)
    if new_login_vault_raw is not None and normalized_new_vault is None:
        return jsonify({'success': False, 'error': 'Некорректный формат нового login_vault.'}), 400

    old_pem_session = str(session.get('public_key_pem') or '').strip()
    if not old_pem_session:
        return jsonify({'success': False, 'error': 'Не авторизован.'}), 401

    if canonical_new_pem == normalize_public_key(old_pem_session):
        return jsonify({'success': False, 'error': 'Новый ключ должен отличаться от текущего.'}), 400

    conn = get_db_connection()
    try:
        user_row = conn.execute(
            'SELECT id, public_key, username FROM users WHERE id = ?',
            (int(session['user_id']),),
        ).fetchone()
        if not user_row:
            return jsonify({'success': False, 'error': 'Пользователь не найден.'}), 404

        # Bind signature verification to the *stored* public key, not the
        # session value — defends against a stale session pointing at an
        # already-rotated key.
        stored_old_pem = str(user_row['public_key'] or '').strip()
        if not stored_old_pem:
            return jsonify({'success': False, 'error': 'Текущий ключ отсутствует.'}), 500
        if stored_old_pem != old_pem_session:
            # Session claims a different key than DB — refuse rather than
            # rotate an unknown predecessor.
            return jsonify({'success': False, 'error': 'Сессия устарела, войдите заново.'}), 409

        try:
            old_public_key = _load_user_public_key(stored_old_pem)
        except (ValueError, TypeError):
            logger.exception('rotate: failed to load stored public key user_id=%s', session.get('user_id'))
            return jsonify({'success': False, 'error': 'Внутренняя ошибка ключа.'}), 500

        payload_bytes = _signed_payload_bytes(
            old_pem=normalize_public_key(stored_old_pem),
            new_pem=canonical_new_pem,
            ts=ts,
        )
        try:
            old_public_key.verify(
                signature_bytes,
                payload_bytes,
                padding.PKCS1v15(),
                hashes.SHA256(),
            )
        except InvalidSignature:
            logger.warning('rotate: invalid signature user_id=%s', session.get('user_id'))
            return jsonify({'success': False, 'error': 'Подпись не прошла проверку.'}), 401

        # Uniqueness: someone else must not already hold this public key.
        clash = conn.execute(
            'SELECT id FROM users WHERE public_key = ? AND id != ?',
            (canonical_new_pem, int(user_row['id'])),
        ).fetchone()
        if clash:
            return jsonify({'success': False, 'error': 'Этот ключ уже используется.'}), 409

        conn.execute(
            'UPDATE users SET public_key = ?, login_vault = ? WHERE id = ?',
            (canonical_new_pem, normalized_new_vault, int(user_row['id'])),
        )
        conn.commit()
    finally:
        conn.close()

    # Revoke every refresh token: the device that rotated must log in again
    # with the new private key, and any other devices holding the old key
    # are now stale.
    try:
        revoke_all_for_user(int(user_row['id']))
    except Exception:  # noqa: BLE001
        logger.exception('rotate: revoke_all_for_user failed user_id=%s', user_row['id'])

    # Audit trail. Keep payload minimal — public key fingerprints, not
    # bodies, to keep the log small.
    try:
        from hashlib import sha256

        old_fp = sha256(normalize_public_key(stored_old_pem).encode('utf-8')).hexdigest()[:16]
        new_fp = sha256(canonical_new_pem.encode('utf-8')).hexdigest()[:16]
        logger.info(
            'key_rotation user_id=%s old_fp=%s new_fp=%s',
            user_row['id'], old_fp, new_fp,
        )
    except Exception:  # noqa: BLE001
        pass

    session.clear()
    response = make_response(jsonify({'success': True}))
    secure = bool(current_app.config.get('SESSION_COOKIE_SECURE'))
    # Clear our own refresh cookie too; the client must perform a full login.
    if request.cookies.get(REFRESH_COOKIE_NAME):
        clear_refresh_cookie(response, secure=secure)
    return response
