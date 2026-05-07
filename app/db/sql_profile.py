from __future__ import annotations

import hashlib
import json
import os
import threading
import time
from pathlib import Path

_LOCK = threading.Lock()
_FALSE_VALUES = {'', '0', 'false', 'no', 'off'}


def _as_bool(value: str | None) -> bool:
    return str(value or '').strip().lower() not in _FALSE_VALUES


def _normalize_sql(query: str) -> str:
    return ' '.join(str(query or '').split())


def _runtime_config() -> tuple[bool, float, Path]:
    enabled = _as_bool(os.environ.get('SQL_PROFILE_ENABLED'))
    try:
        slow_ms = float(os.environ.get('SQL_PROFILE_SLOW_MS', '25'))
    except (TypeError, ValueError):
        slow_ms = 25.0
    slow_ms = max(0.0, slow_ms)
    configured_path = str(os.environ.get('SQL_PROFILE_LOG_PATH') or '').strip()
    if configured_path:
        path = Path(configured_path)
    else:
        path = Path('.runtime') / 'sql-profile.ndjson'
    return enabled, slow_ms, path


def profile_sql_query(
    *,
    query: str,
    duration_ms: float,
    params_count: int = 0,
    rowcount: int | None = None,
    ok: bool = True,
) -> None:
    enabled, slow_ms, path = _runtime_config()
    if not enabled or duration_ms < slow_ms:
        return

    normalized = _normalize_sql(query)
    fingerprint = hashlib.sha1(normalized.encode('utf-8')).hexdigest()[:16]
    record = {
        'ts': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'duration_ms': round(float(duration_ms), 3),
        'params_count': int(params_count or 0),
        'rowcount': int(rowcount) if rowcount is not None else None,
        'ok': bool(ok),
        'fingerprint': fingerprint,
        'sql': normalized[:4000],
    }
    line = json.dumps(record, ensure_ascii=False) + '\n'

    with _LOCK:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open('a', encoding='utf-8') as handle:
            handle.write(line)
