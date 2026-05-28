from __future__ import annotations

import hashlib
import logging
import re
from urllib.parse import urlsplit, urlunsplit

_SECRET_QUERY_KEYS = {'access_token', 'code', 'id_token', 'refresh_token', 'state', 'token'}
_SECRET_SCHEMES = {'postgres', 'postgresql', 'redis', 'rediss', 'redis+unix'}
_BEARER_RE = re.compile(r'\b(Bearer|Token)\s+[A-Za-z0-9._~+/=-]+', re.IGNORECASE)
_QUERY_SECRET_RE = re.compile(
    r'([?&](?:access_token|code|id_token|refresh_token|state|token)=)[^&\s]+',
    re.IGNORECASE,
)


def redact_url_for_log(value: object) -> str:
    raw = str(value or '').strip()
    if not raw:
        return ''
    try:
        parsed = urlsplit(raw)
    except ValueError:
        return sanitize_log_text(raw)

    if not parsed.scheme:
        return sanitize_log_text(raw)

    netloc = parsed.netloc
    query = parsed.query
    if parsed.password and parsed.scheme.lower() in _SECRET_SCHEMES:
        host = parsed.hostname or ''
        if ':' in host and not host.startswith('['):
            host = f'[{host}]'
        if parsed.port:
            host = f'{host}:{parsed.port}'
        username = parsed.username or ''
        netloc = f'{username}:***@{host}' if username else f'***@{host}'

    if query:
        parts = []
        for item in query.split('&'):
            key, sep, val = item.partition('=')
            if key.lower() in _SECRET_QUERY_KEYS and sep:
                parts.append(f'{key}=***')
            else:
                parts.append(f'{key}{sep}{val}' if sep else key)
        query = '&'.join(parts)

    return sanitize_log_text(urlunsplit((parsed.scheme, netloc, parsed.path, query, parsed.fragment)))


def sanitize_log_text(value: object) -> str:
    text = str(value)
    text = _BEARER_RE.sub(lambda match: f'{match.group(1)} ***', text)
    text = _QUERY_SECRET_RE.sub(lambda match: f'{match.group(1)}***', text)
    return text


def hash_identifier_for_log(value: object, *, prefix: str = 'id') -> str:
    raw = str(value or '').strip()
    if not raw:
        return ''
    digest = hashlib.sha256(raw.encode('utf-8', errors='ignore')).hexdigest()[:12]
    return f'{prefix}:{digest}'


class SecretRedactionFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = sanitize_log_text(record.msg)
        if isinstance(record.args, dict):
            record.args = {key: _sanitize_arg(value) for key, value in record.args.items()}
        elif isinstance(record.args, tuple):
            record.args = tuple(_sanitize_arg(value) for value in record.args)
        return True


def _sanitize_arg(value: object) -> object:
    if isinstance(value, str):
        return redact_url_for_log(value) if '://' in value else sanitize_log_text(value)
    return value
