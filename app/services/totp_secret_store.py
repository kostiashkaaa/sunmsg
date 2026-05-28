from __future__ import annotations

import base64
import hashlib
from typing import Any

from cryptography.fernet import Fernet, InvalidToken, MultiFernet
from flask import current_app

_PREFIX = 'fernet:'


def _derive_fernet_from_str(secret: str) -> Fernet:
    derived = hashlib.sha256(str(secret or '').encode('utf-8')).digest()
    return Fernet(base64.urlsafe_b64encode(derived))


def _fernet() -> MultiFernet:
    """Build the TOTP encryption stack.

    Preference order:
      1. `TOTP_ENCRYPTION_KEY` — a dedicated secret. When present, this is
         the *only* key used for new encryptions. Rotate by setting
         `TOTP_ENCRYPTION_KEY_OLD` to the previous value; the old key stays
         available for decryption until you re-encrypt everything.
      2. `SECRET_KEY` — historical fallback. New deployments should set
         TOTP_ENCRYPTION_KEY and never let it drift from SECRET_KEY again.

    MultiFernet picks the first key for encrypt() and tries each in turn for
    decrypt(), giving us painless key rotation without a flag day.
    """
    primary = str(current_app.config.get('TOTP_ENCRYPTION_KEY') or '').strip()
    legacy = str(current_app.config.get('TOTP_ENCRYPTION_KEY_OLD') or '').strip()
    secret_key_fallback = str(current_app.config.get('SECRET_KEY') or '').strip()

    chain: list[Fernet] = []
    if primary:
        chain.append(_derive_fernet_from_str(primary))
        if legacy:
            chain.append(_derive_fernet_from_str(legacy))
        # Even when a dedicated key is set, fall back to SECRET_KEY for
        # records encrypted before the migration; otherwise users with
        # pre-existing TOTP would be locked out the moment the dedicated
        # key is introduced.
        if secret_key_fallback and secret_key_fallback != primary:
            chain.append(_derive_fernet_from_str(secret_key_fallback))
    else:
        if not secret_key_fallback:
            raise RuntimeError(
                'TOTP encryption key not configured: set TOTP_ENCRYPTION_KEY '
                '(preferred) or SECRET_KEY.'
            )
        chain.append(_derive_fernet_from_str(secret_key_fallback))

    return MultiFernet(chain)


def encode_totp_secret(secret: str) -> str:
    normalized = str(secret or '').strip()
    if not normalized:
        return ''
    token = _fernet().encrypt(normalized.encode('utf-8')).decode('ascii')
    return f'{_PREFIX}{token}'


def decode_totp_secret(stored_secret: Any) -> str:
    raw = str(stored_secret or '').strip()
    if not raw:
        return ''
    if not raw.startswith(_PREFIX):
        return raw
    token = raw[len(_PREFIX):].encode('ascii')
    try:
        return _fernet().decrypt(token).decode('utf-8')
    except (InvalidToken, UnicodeDecodeError, ValueError):
        return ''


def is_encoded_totp_secret(stored_secret: Any) -> bool:
    return str(stored_secret or '').strip().startswith(_PREFIX)


def has_totp_secret(stored_secret: Any) -> bool:
    return bool(str(stored_secret or '').strip())
