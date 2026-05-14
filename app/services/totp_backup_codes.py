from __future__ import annotations

import hashlib
import secrets
import string

_CODE_LENGTH = 10
_CODES_PER_SET = 10
_ALPHABET = string.ascii_uppercase + string.digits


def _generate_raw_code() -> str:
    return ''.join(secrets.choice(_ALPHABET) for _ in range(_CODE_LENGTH))


def _hash_code(raw: str) -> str:
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
    code_hash = _hash_code(normalized)
    row = conn.execute(
        '''
        SELECT id FROM totp_backup_codes
        WHERE user_id = ? AND code_hash = ? AND used_at IS NULL
        LIMIT 1
        ''',
        (user_id, code_hash),
    ).fetchone()
    if not row:
        return False
    conn.execute(
        'UPDATE totp_backup_codes SET used_at = CURRENT_TIMESTAMP WHERE id = ?',
        (row['id'],),
    )
    return True
