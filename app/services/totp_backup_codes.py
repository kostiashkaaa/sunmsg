from __future__ import annotations

import hashlib
import hmac
import secrets
import string

from flask import current_app

_CODE_LENGTH = 10
_CODES_PER_SET = 10
_ALPHABET = string.ascii_uppercase + string.digits


def _generate_raw_code() -> str:
    return ''.join(secrets.choice(_ALPHABET) for _ in range(_CODE_LENGTH))


def _hash_key() -> bytes:
    """Resolve the HMAC key. Prefers TOTP_ENCRYPTION_KEY (same setting that
    secures TOTP secrets); falls back to SECRET_KEY for compatibility with
    deployments that haven't introduced a dedicated key yet.
    """
    try:
        cfg = current_app.config
    except RuntimeError:
        # No app context (CLI tests). HMAC stays deterministic via a fixed
        # marker so dev-mode behaves predictably; production always has an
        # app context.
        return b'sun-totp-backup-fallback'
    primary = str(cfg.get('TOTP_ENCRYPTION_KEY') or '').strip()
    if primary:
        return primary.encode('utf-8')
    secret = str(cfg.get('SECRET_KEY') or '').strip()
    return secret.encode('utf-8') if secret else b'sun-totp-backup-fallback'


def _hash_code(raw: str) -> str:
    """HMAC-SHA256 with the deployment key, so a stolen DB without the key
    cannot brute-force the codes offline. Falls back to SHA-256 verification
    of legacy rows in verify_and_consume_backup_code.
    """
    return hmac.new(_hash_key(), raw.upper().encode('utf-8'), hashlib.sha256).hexdigest()


def _legacy_hash_code(raw: str) -> str:
    """Pre-HMAC hash, kept for backward verification of stored codes that
    were created before this module switched to HMAC. New writes never use
    this path.
    """
    return hashlib.sha256(raw.upper().encode()).hexdigest()


def generate_backup_codes() -> list[str]:
    return [_generate_raw_code() for _ in range(_CODES_PER_SET)]


def store_backup_codes(conn, user_id: int, raw_codes: list[str]) -> None:
    conn.execute('DELETE FROM totp_backup_codes WHERE user_id = ?', (user_id,))
    for raw in raw_codes:
        conn.execute(
            'INSERT INTO totp_backup_codes (user_id, code_hash) VALUES (?, ?)',
            (user_id, _hash_code(raw)),
        )


def delete_backup_codes(conn, user_id: int) -> None:
    conn.execute('DELETE FROM totp_backup_codes WHERE user_id = ?', (user_id,))


def count_unused_backup_codes(conn, user_id: int) -> int:
    row = conn.execute(
        'SELECT COUNT(*) AS cnt FROM totp_backup_codes WHERE user_id = ? AND used_at IS NULL',
        (user_id,),
    ).fetchone()
    return int(row['cnt']) if row else 0


def verify_and_consume_backup_code(conn, user_id: int, raw_input: str) -> bool:
    normalized = str(raw_input or '').strip().upper()
    if not normalized:
        return False
    # Try HMAC first; fall back to the legacy plain-SHA256 hash so users
    # whose codes predate the HMAC migration keep working. On a successful
    # legacy hit we upgrade the row to the new format before consuming.
    candidates = (
        (_hash_code(normalized), False),
        (_legacy_hash_code(normalized), True),
    )
    for candidate_hash, is_legacy in candidates:
        row = conn.execute(
            '''
            SELECT id FROM totp_backup_codes
            WHERE user_id = ? AND code_hash = ? AND used_at IS NULL
            LIMIT 1
            ''',
            (user_id, candidate_hash),
        ).fetchone()
        if not row:
            continue
        if is_legacy:
            conn.execute(
                'UPDATE totp_backup_codes SET code_hash = ? WHERE id = ?',
                (_hash_code(normalized), row['id']),
            )
        conn.execute(
            'UPDATE totp_backup_codes SET used_at = CURRENT_TIMESTAMP WHERE id = ?',
            (row['id'],),
        )
        return True
    return False
