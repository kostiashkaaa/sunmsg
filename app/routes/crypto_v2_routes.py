"""
Flask blueprint: /api/crypto — X25519/Ed25519/DR/MLS key management.

Endpoints:
  POST /api/crypto/keys              — публикация X25519 + Ed25519 ключей пользователя
  GET  /api/crypto/prekey-bundle/<user_id> — получение prekey bundle для X3DH
  POST /api/crypto/prekeys/signed    — загрузка signed prekey
  POST /api/crypto/prekeys/one-time  — загрузка one-time prekeys (batch)
  GET  /api/crypto/dr-session/<chat_id>   — получение DR состояния сессии
  POST /api/crypto/dr-session/<chat_id>   — сохранение / обновление DR состояния
  POST /api/crypto/mls/key-packages  — публикация MLS KeyPackage
  GET  /api/crypto/mls/key-packages/<user_id> — получить KeyPackage пользователя
  POST /api/crypto/mls/group/<chat_id>/commit — применить MLS Commit
  POST /api/crypto/mls/group/<chat_id>/welcome — сохранить Welcome для участника
  GET  /api/crypto/mls/pending/<chat_id>  — получить pending MLS сообщения
"""

from __future__ import annotations

import json
import logging
import time

from flask import Blueprint, jsonify, request, session

from app.database import get_db_connection
from app.extensions import limiter
from app.services.crypto import (
    is_valid_ed25519_public_key,
    is_valid_x25519_public_key,
    is_valid_v3_payload,
    verify_ed25519_signature,
)

logger = logging.getLogger(__name__)

crypto_v2_bp = Blueprint('crypto_v2', __name__, url_prefix='/api/crypto')

_B64U_MAX = 65536
_SESSION_STATE_MAX = 256 * 1024
_MLS_PAYLOAD_MAX = 512 * 1024
_PREKEY_BATCH_MAX = 100


def _current_user_id() -> int | None:
    uid = session.get('user_id')
    return int(uid) if uid else None


def _require_auth():
    uid = _current_user_id()
    if not uid:
        return jsonify({'error': 'unauthorized'}), 401
    return uid


# ── Публикация ключей пользователя ────────────────────────────────────────────

@crypto_v2_bp.route('/keys', methods=['POST'])
@limiter.limit('20 per minute')
def publish_identity_keys():
    """Сохраняет X25519 + Ed25519 публичные ключи пользователя."""
    uid = _require_auth()
    if not isinstance(uid, int):
        return uid

    data = request.get_json(silent=True) or {}
    x25519_pub = str(data.get('x25519_public_key') or '').strip()
    ed25519_pub = str(data.get('ed25519_public_key') or '').strip()
    challenge = str(data.get('challenge') or '').strip()
    signature = str(data.get('signature') or '').strip()

    if not is_valid_x25519_public_key(x25519_pub):
        return jsonify({'error': 'invalid_x25519_key'}), 400
    if not is_valid_ed25519_public_key(ed25519_pub):
        return jsonify({'error': 'invalid_ed25519_key'}), 400
    if not challenge or not signature:
        return jsonify({'error': 'challenge_required'}), 400

    # Верификация: пользователь подписывает challenge своим новым Ed25519 ключом
    if not verify_ed25519_signature(ed25519_pub, challenge, signature):
        return jsonify({'error': 'signature_invalid'}), 401

    conn = get_db_connection()
    try:
        conn.execute(
            '''
            UPDATE users
               SET x25519_public_key = ?,
                   ed25519_public_key = ?,
                   crypto_version = 3
             WHERE id = ?
            ''',
            (x25519_pub, ed25519_pub, uid),
        )
        conn.commit()
    finally:
        conn.close()

    return jsonify({'ok': True, 'crypto_version': 3})


# ── Prekey bundle ─────────────────────────────────────────────────────────────

@crypto_v2_bp.route('/prekey-bundle/<int:peer_user_id>', methods=['GET'])
@limiter.limit('60 per minute')
def get_prekey_bundle(peer_user_id: int):
    """Возвращает prekey bundle для X3DH инициализации DR сессии."""
    uid = _require_auth()
    if not isinstance(uid, int):
        return uid

    conn = get_db_connection()
    try:
        user = conn.execute(
            'SELECT x25519_public_key, ed25519_public_key, crypto_version FROM users WHERE id = ?',
            (peer_user_id,),
        ).fetchone()

        if not user or not user['x25519_public_key']:
            return jsonify({'error': 'user_not_found_or_no_v3_keys'}), 404

        # Последний signed prekey
        spk_row = conn.execute(
            '''
            SELECT prekey_id, public_key, signature
              FROM user_signed_prekeys
             WHERE user_id = ?
             ORDER BY created_at DESC
             LIMIT 1
            ''',
            (peer_user_id,),
        ).fetchone()

        # Один one-time prekey (помечаем как claimed)
        otpk_row = conn.execute(
            '''
            SELECT id, prekey_id, public_key
              FROM user_one_time_prekeys
             WHERE user_id = ? AND claimed_at IS NULL
             ORDER BY created_at ASC
             LIMIT 1
            ''',
            (peer_user_id,),
        ).fetchone()

        bundle = {
            'user_id': peer_user_id,
            'identity_key': user['x25519_public_key'],
            'ed25519_key': user['ed25519_public_key'],
            'crypto_version': user['crypto_version'],
        }

        if spk_row:
            bundle['signed_prekey'] = {
                'id': spk_row['prekey_id'],
                'public_key': spk_row['public_key'],
                'signature': spk_row['signature'],
            }

        if otpk_row:
            conn.execute(
                'UPDATE user_one_time_prekeys SET claimed_at = CURRENT_TIMESTAMP WHERE id = ?',
                (otpk_row['id'],),
            )
            conn.commit()
            bundle['one_time_prekey'] = {
                'id': otpk_row['prekey_id'],
                'public_key': otpk_row['public_key'],
            }

        return jsonify(bundle)
    finally:
        conn.close()


# ── Signed prekeys ────────────────────────────────────────────────────────────

@crypto_v2_bp.route('/prekeys/signed', methods=['POST'])
@limiter.limit('10 per minute')
def upload_signed_prekey():
    """Загружает новый signed prekey пользователя."""
    uid = _require_auth()
    if not isinstance(uid, int):
        return uid

    data = request.get_json(silent=True) or {}
    prekey_id = data.get('prekey_id')
    public_key = str(data.get('public_key') or '').strip()
    signature = str(data.get('signature') or '').strip()

    if not isinstance(prekey_id, int) or prekey_id < 0:
        return jsonify({'error': 'invalid_prekey_id'}), 400
    if not is_valid_x25519_public_key(public_key):
        return jsonify({'error': 'invalid_public_key'}), 400
    if not signature:
        return jsonify({'error': 'signature_required'}), 400

    conn = get_db_connection()
    try:
        conn.execute(
            '''
            INSERT INTO user_signed_prekeys (user_id, prekey_id, public_key, signature)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(user_id, prekey_id) DO UPDATE
               SET public_key = excluded.public_key,
                   signature  = excluded.signature,
                   created_at = CURRENT_TIMESTAMP
            ''',
            (uid, prekey_id, public_key, signature),
        )
        conn.commit()
    finally:
        conn.close()

    return jsonify({'ok': True})


# ── One-time prekeys ──────────────────────────────────────────────────────────

@crypto_v2_bp.route('/prekeys/one-time', methods=['POST'])
@limiter.limit('10 per minute')
def upload_one_time_prekeys():
    """Загружает пачку one-time prekeys."""
    uid = _require_auth()
    if not isinstance(uid, int):
        return uid

    data = request.get_json(silent=True) or {}
    prekeys = data.get('prekeys')
    if not isinstance(prekeys, list) or not prekeys:
        return jsonify({'error': 'prekeys_required'}), 400
    if len(prekeys) > _PREKEY_BATCH_MAX:
        return jsonify({'error': 'too_many_prekeys'}), 400

    conn = get_db_connection()
    try:
        for pk in prekeys:
            if not isinstance(pk, dict):
                continue
            pid = pk.get('id')
            pub = str(pk.get('public_key') or '').strip()
            if not isinstance(pid, int) or pid < 0:
                continue
            if not is_valid_x25519_public_key(pub):
                continue
            conn.execute(
                '''
                INSERT INTO user_one_time_prekeys (user_id, prekey_id, public_key)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id, prekey_id) DO NOTHING
                ''',
                (uid, pid, pub),
            )
        conn.commit()
    finally:
        conn.close()

    return jsonify({'ok': True})


# ── Double Ratchet сессии ─────────────────────────────────────────────────────

@crypto_v2_bp.route('/dr-session/<chat_id>', methods=['GET'])
@limiter.limit('120 per minute')
def get_dr_session(chat_id: str):
    """Возвращает сериализованное DR состояние для данного чата."""
    uid = _require_auth()
    if not isinstance(uid, int):
        return uid

    conn = get_db_connection()
    try:
        row = conn.execute(
            '''
            SELECT session_state, updated_at
              FROM dr_sessions
             WHERE chat_id = ? AND owner_user_id = ?
            ''',
            (chat_id, uid),
        ).fetchone()

        if not row:
            return jsonify({'session': None})

        return jsonify({
            'session': row['session_state'],
            'updated_at': str(row['updated_at']),
        })
    finally:
        conn.close()


@crypto_v2_bp.route('/dr-session/<chat_id>', methods=['POST'])
@limiter.limit('120 per minute')
def save_dr_session(chat_id: str):
    """Сохраняет / обновляет DR состояние."""
    uid = _require_auth()
    if not isinstance(uid, int):
        return uid

    data = request.get_json(silent=True) or {}
    session_state = data.get('session_state')
    peer_user_id = data.get('peer_user_id')

    if not isinstance(session_state, str) or len(session_state) > _SESSION_STATE_MAX:
        return jsonify({'error': 'invalid_session_state'}), 400
    if not isinstance(peer_user_id, int):
        return jsonify({'error': 'peer_user_id_required'}), 400

    conn = get_db_connection()
    try:
        conn.execute(
            '''
            INSERT INTO dr_sessions (chat_id, owner_user_id, peer_user_id, session_state, updated_at)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(chat_id, owner_user_id) DO UPDATE
               SET session_state = excluded.session_state,
                   updated_at    = CURRENT_TIMESTAMP
            ''',
            (chat_id, uid, peer_user_id, session_state),
        )
        conn.commit()
    finally:
        conn.close()

    return jsonify({'ok': True})


# ── MLS KeyPackages ───────────────────────────────────────────────────────────

@crypto_v2_bp.route('/mls/key-packages', methods=['POST'])
@limiter.limit('10 per minute')
def upload_mls_key_package():
    """Публикует MLS KeyPackage пользователя."""
    uid = _require_auth()
    if not isinstance(uid, int):
        return uid

    data = request.get_json(silent=True) or {}
    key_package = data.get('key_package')
    key_package_ref = str(data.get('key_package_ref') or '').strip()

    if not isinstance(key_package, dict) or not key_package_ref:
        return jsonify({'error': 'key_package_required'}), 400

    key_package_str = json.dumps(key_package)
    if len(key_package_str) > _MLS_PAYLOAD_MAX:
        return jsonify({'error': 'key_package_too_large'}), 400

    conn = get_db_connection()
    try:
        conn.execute(
            '''
            INSERT INTO mls_key_packages (user_id, key_package_ref, key_package)
            VALUES (?, ?, ?)
            ON CONFLICT(key_package_ref) DO NOTHING
            ''',
            (uid, key_package_ref, key_package_str),
        )
        conn.commit()
    finally:
        conn.close()

    return jsonify({'ok': True, 'ref': key_package_ref})


@crypto_v2_bp.route('/mls/key-packages/<int:peer_user_id>', methods=['GET'])
@limiter.limit('60 per minute')
def get_mls_key_package(peer_user_id: int):
    """Возвращает незаявленный MLS KeyPackage пользователя."""
    uid = _require_auth()
    if not isinstance(uid, int):
        return uid

    conn = get_db_connection()
    try:
        row = conn.execute(
            '''
            SELECT id, key_package_ref, key_package
              FROM mls_key_packages
             WHERE user_id = ? AND claimed_at IS NULL
             ORDER BY created_at ASC
             LIMIT 1
            ''',
            (peer_user_id,),
        ).fetchone()

        if not row:
            return jsonify({'error': 'no_key_package'}), 404

        conn.execute(
            'UPDATE mls_key_packages SET claimed_at = CURRENT_TIMESTAMP WHERE id = ?',
            (row['id'],),
        )
        conn.commit()

        return jsonify({
            'key_package_ref': row['key_package_ref'],
            'key_package': json.loads(row['key_package']),
        })
    finally:
        conn.close()


# ── MLS группа: Welcome / Commit ─────────────────────────────────────────────

@crypto_v2_bp.route('/mls/group/<chat_id>/welcome', methods=['POST'])
@limiter.limit('30 per minute')
def store_mls_welcome(chat_id: str):
    """Сохраняет Welcome сообщение для нового участника группы."""
    uid = _require_auth()
    if not isinstance(uid, int):
        return uid

    data = request.get_json(silent=True) or {}
    recipient_user_id = data.get('recipient_user_id')
    welcome_payload = data.get('welcome')

    if not isinstance(recipient_user_id, int):
        return jsonify({'error': 'recipient_required'}), 400
    if not isinstance(welcome_payload, dict):
        return jsonify({'error': 'welcome_required'}), 400

    payload_str = json.dumps(welcome_payload)
    if len(payload_str) > _MLS_PAYLOAD_MAX:
        return jsonify({'error': 'welcome_too_large'}), 400

    conn = get_db_connection()
    try:
        conn.execute(
            '''
            INSERT INTO mls_pending_messages (chat_id, recipient_user_id, message_type, payload)
            VALUES (?, ?, 'welcome', ?)
            ''',
            (chat_id, recipient_user_id, payload_str),
        )
        conn.commit()
    finally:
        conn.close()

    return jsonify({'ok': True})


@crypto_v2_bp.route('/mls/group/<chat_id>/commit', methods=['POST'])
@limiter.limit('30 per minute')
def store_mls_commit(chat_id: str):
    """Сохраняет Commit для всех участников группы."""
    uid = _require_auth()
    if not isinstance(uid, int):
        return uid

    data = request.get_json(silent=True) or {}
    commit_payload = data.get('commit')
    recipient_ids = data.get('recipient_ids', [])

    if not isinstance(commit_payload, dict):
        return jsonify({'error': 'commit_required'}), 400
    if not isinstance(recipient_ids, list) or not recipient_ids:
        return jsonify({'error': 'recipients_required'}), 400

    payload_str = json.dumps(commit_payload)
    if len(payload_str) > _MLS_PAYLOAD_MAX:
        return jsonify({'error': 'commit_too_large'}), 400

    conn = get_db_connection()
    try:
        for rid in recipient_ids:
            if not isinstance(rid, int) or rid == uid:
                continue
            conn.execute(
                '''
                INSERT INTO mls_pending_messages (chat_id, recipient_user_id, message_type, payload)
                VALUES (?, ?, 'commit', ?)
                ''',
                (chat_id, rid, payload_str),
            )
        conn.commit()
    finally:
        conn.close()

    return jsonify({'ok': True})


@crypto_v2_bp.route('/mls/pending/<chat_id>', methods=['GET'])
@limiter.limit('120 per minute')
def get_mls_pending(chat_id: str):
    """Возвращает pending MLS сообщения (Welcome/Commit) для текущего пользователя."""
    uid = _require_auth()
    if not isinstance(uid, int):
        return uid

    conn = get_db_connection()
    try:
        rows = conn.execute(
            '''
            SELECT id, message_type, payload, created_at
              FROM mls_pending_messages
             WHERE chat_id = ? AND recipient_user_id = ? AND delivered_at IS NULL
             ORDER BY created_at ASC
             LIMIT 50
            ''',
            (chat_id, uid),
        ).fetchall()

        messages = []
        ids = []
        for row in rows:
            messages.append({
                'type': row['message_type'],
                'payload': json.loads(row['payload']),
            })
            ids.append(row['id'])

        if ids:
            placeholders = ','.join('?' * len(ids))
            conn.execute(
                f'UPDATE mls_pending_messages SET delivered_at = CURRENT_TIMESTAMP WHERE id IN ({placeholders})',
                ids,
            )
            conn.commit()

        return jsonify({'messages': messages})
    finally:
        conn.close()
