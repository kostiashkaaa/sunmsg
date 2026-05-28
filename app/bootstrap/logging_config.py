from __future__ import annotations

import json
import logging
import os
import sys
from datetime import datetime, timezone
from typing import Any

from flask import has_request_context, request

from app.services.logging_safety import SecretRedactionFilter, sanitize_log_text


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            'ts': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
            'level': record.levelname,
            'logger': record.name,
            'message': sanitize_log_text(record.getMessage()),
            'module': record.module,
            'line': record.lineno,
            'process': record.process,
            'thread': record.threadName,
        }
        if has_request_context():
            payload['request'] = {
                'method': request.method,
                'path': request.path,
                'endpoint': request.endpoint or '',
                'request_id': request.headers.get('X-Request-ID', ''),
            }
        if record.exc_info:
            payload['exception'] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False, separators=(',', ':'))


def configure_logging(config: dict | None = None) -> None:
    cfg = config or {}
    env_name = str(cfg.get('ENV_NAME') or os.environ.get('APP_ENV') or '').strip().lower()
    if env_name == 'testing' or os.environ.get('PYTEST_CURRENT_TEST'):
        return

    level_name = str(os.environ.get('LOG_LEVEL') or cfg.get('LOG_LEVEL') or 'INFO').upper()
    level = getattr(logging, level_name, logging.INFO)
    log_format = str(os.environ.get('LOG_FORMAT') or cfg.get('LOG_FORMAT') or '').strip().lower()
    if not log_format:
        log_format = 'json' if env_name == 'production' else 'text'

    formatter: logging.Formatter
    if log_format == 'json':
        formatter = JsonLogFormatter()
    else:
        formatter = logging.Formatter('%(asctime)s %(levelname)s %(name)s: %(message)s')

    root = logging.getLogger()
    root.setLevel(level)

    if not root.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setLevel(level)
        handler.setFormatter(formatter)
        handler.addFilter(SecretRedactionFilter())
        root.addHandler(handler)
    else:
        for handler in root.handlers:
            handler.setLevel(level)
            handler.setFormatter(formatter)
            if not any(isinstance(item, SecretRedactionFilter) for item in handler.filters):
                handler.addFilter(SecretRedactionFilter())
