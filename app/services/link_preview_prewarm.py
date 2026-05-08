from __future__ import annotations

import atexit
import threading
from concurrent.futures import ThreadPoolExecutor
from collections.abc import Callable

_PREWARM_MAX_WORKERS = 3
_PREWARM_EXECUTOR = ThreadPoolExecutor(
    max_workers=_PREWARM_MAX_WORKERS,
    thread_name_prefix='link-preview-prewarm',
)
_PREWARM_PENDING_LOCK = threading.Lock()
_PREWARM_PENDING_URLS: set[str] = set()

atexit.register(_PREWARM_EXECUTOR.shutdown, wait=True, cancel_futures=False)


def schedule_link_preview_prewarm(
    normalized_url: str,
    *,
    resolve_preview_payload_func: Callable[[str], tuple[dict, int]] | None,
) -> bool:
    safe_url = str(normalized_url or '').strip()
    if not safe_url:
        return False
    if not callable(resolve_preview_payload_func):
        return False

    with _PREWARM_PENDING_LOCK:
        if safe_url in _PREWARM_PENDING_URLS:
            return False
        _PREWARM_PENDING_URLS.add(safe_url)

    def _task():
        try:
            resolve_preview_payload_func(safe_url)
        except Exception:
            return
        finally:
            with _PREWARM_PENDING_LOCK:
                _PREWARM_PENDING_URLS.discard(safe_url)

    _PREWARM_EXECUTOR.submit(_task)
    return True
