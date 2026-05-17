from __future__ import annotations

import base64
import hashlib
from typing import Any

from cryptography.fernet import Fernet, InvalidToken
from flask import current_app

_PREFIX = 'fernet:'


def _fernet() -> Fernet:
    secret_key = str(current_app.config.get('SECRET_KEY') or '').encode('utf-8')
    derived = hashlib.sha256(secret_key).digest()
    return Fernet(base64.urlsafe_b64encode(derived))


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
