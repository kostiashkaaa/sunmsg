from __future__ import annotations

import threading
import time
from collections import defaultdict
from dataclasses import dataclass
from typing import Any

from app.services.logging_safety import sanitize_log_text


@dataclass
class _Timing:
    count: int = 0
    total_seconds: float = 0.0
    max_seconds: float = 0.0

    def add(self, duration_seconds: float) -> None:
        safe_duration = max(0.0, float(duration_seconds or 0.0))
        self.count += 1
        self.total_seconds += safe_duration
        self.max_seconds = max(self.max_seconds, safe_duration)


_LOCK = threading.Lock()
_HTTP: dict[tuple[str, str, str, int], _Timing] = defaultdict(_Timing)
_SOCKET: dict[tuple[str, str], _Timing] = defaultdict(_Timing)
_STARTED_AT = time.time()


def record_http_request(*, method: str, route: str, status_code: int, duration_seconds: float) -> None:
    status = int(status_code or 0)
    status_class = f'{status // 100}xx' if status > 0 else 'unknown'
    key = (
        _label(method or 'GET'),
        _label(route or 'unknown'),
        status_class,
        status,
    )
    with _LOCK:
        _HTTP[key].add(duration_seconds)


def record_socket_event(*, event_name: str, status: str, duration_seconds: float) -> None:
    key = (_label(event_name or 'unknown'), _label(status or 'ok'))
    with _LOCK:
        _SOCKET[key].add(duration_seconds)


def prometheus_text(
    *,
    db_pool_metrics: list[dict[str, Any]] | None = None,
    redis_metrics: dict[str, Any] | None = None,
    moderation_queue: dict[str, int] | None = None,
) -> str:
    with _LOCK:
        http_snapshot = list(_HTTP.items())
        socket_snapshot = list(_SOCKET.items())

    lines: list[str] = []
    lines.append('# HELP sun_process_uptime_seconds Process uptime in seconds.')
    lines.append('# TYPE sun_process_uptime_seconds gauge')
    lines.append(f'sun_process_uptime_seconds {max(0, time.time() - _STARTED_AT):.3f}')

    lines.append('# HELP sun_http_requests_total HTTP requests by method, route, and status.')
    lines.append('# TYPE sun_http_requests_total counter')
    lines.append('# HELP sun_http_request_duration_seconds_sum Total HTTP request duration.')
    lines.append('# TYPE sun_http_request_duration_seconds_sum counter')
    lines.append('# HELP sun_http_request_duration_seconds_count HTTP request duration sample count.')
    lines.append('# TYPE sun_http_request_duration_seconds_count counter')
    lines.append('# HELP sun_http_request_duration_seconds_max Maximum observed HTTP request duration.')
    lines.append('# TYPE sun_http_request_duration_seconds_max gauge')
    for (method, route, status_class, status_code), timing in sorted(http_snapshot):
        labels = f'method="{method}",route="{route}",status_class="{status_class}",status="{status_code}"'
        lines.append(f'sun_http_requests_total{{{labels}}} {timing.count}')
        lines.append(f'sun_http_request_duration_seconds_sum{{{labels}}} {timing.total_seconds:.6f}')
        lines.append(f'sun_http_request_duration_seconds_count{{{labels}}} {timing.count}')
        lines.append(f'sun_http_request_duration_seconds_max{{{labels}}} {timing.max_seconds:.6f}')

    lines.append('# HELP sun_socketio_events_total Socket.IO events by name and status.')
    lines.append('# TYPE sun_socketio_events_total counter')
    lines.append('# HELP sun_socketio_event_duration_seconds_sum Total Socket.IO handler duration.')
    lines.append('# TYPE sun_socketio_event_duration_seconds_sum counter')
    lines.append('# HELP sun_socketio_event_duration_seconds_count Socket.IO handler duration sample count.')
    lines.append('# TYPE sun_socketio_event_duration_seconds_count counter')
    lines.append('# HELP sun_socketio_event_duration_seconds_max Maximum observed Socket.IO handler duration.')
    lines.append('# TYPE sun_socketio_event_duration_seconds_max gauge')
    for (event_name, status), timing in sorted(socket_snapshot):
        labels = f'event="{event_name}",status="{status}"'
        lines.append(f'sun_socketio_events_total{{{labels}}} {timing.count}')
        lines.append(f'sun_socketio_event_duration_seconds_sum{{{labels}}} {timing.total_seconds:.6f}')
        lines.append(f'sun_socketio_event_duration_seconds_count{{{labels}}} {timing.count}')
        lines.append(f'sun_socketio_event_duration_seconds_max{{{labels}}} {timing.max_seconds:.6f}')

    _append_db_pool_metrics(lines, db_pool_metrics or [])
    _append_redis_metrics(lines, redis_metrics or {})
    _append_moderation_queue(lines, moderation_queue or {})
    return '\n'.join(lines) + '\n'


def _append_db_pool_metrics(lines: list[str], pools: list[dict[str, Any]]) -> None:
    lines.append('# HELP sun_db_pool_connections Database pool connections by schema and state.')
    lines.append('# TYPE sun_db_pool_connections gauge')
    lines.append('# HELP sun_db_pool_exhaustions_total Database pool acquire timeouts.')
    lines.append('# TYPE sun_db_pool_exhaustions_total counter')
    for pool in pools:
        schema = _label(pool.get('schema') or 'public')
        for state in ('in_use', 'idle', 'total', 'max_size'):
            lines.append(
                f'sun_db_pool_connections{{schema="{schema}",state="{state}"}} '
                f'{int(pool.get(state) or 0)}'
            )
        lines.append(
            f'sun_db_pool_exhaustions_total{{schema="{schema}"}} '
            f'{int(pool.get("exhaustions_total") or 0)}'
        )


def _append_redis_metrics(lines: list[str], metrics: dict[str, Any]) -> None:
    lines.append('# HELP sun_redis_up Redis health, 1 when ping succeeds.')
    lines.append('# TYPE sun_redis_up gauge')
    lines.append(f'sun_redis_up {1 if metrics.get("up") else 0}')
    for key in ('connected_clients', 'used_memory_bytes', 'keyspace_keys', 'pubsub_channels', 'pubsub_patterns'):
        if key in metrics:
            metric_name = f'sun_redis_{key}'
            lines.append(f'# TYPE {metric_name} gauge')
            lines.append(f'{metric_name} {int(metrics.get(key) or 0)}')
    queues = metrics.get('queues') or {}
    lines.append('# HELP sun_redis_queue_length Redis list/stream/sorted-set backlog lengths for configured keys.')
    lines.append('# TYPE sun_redis_queue_length gauge')
    for name, length in sorted(queues.items()):
        lines.append(f'sun_redis_queue_length{{queue="{_label(name)}"}} {int(length or 0)}')


def _append_moderation_queue(lines: list[str], queue: dict[str, int]) -> None:
    lines.append('# HELP sun_moderation_jobs Moderation job counts by status.')
    lines.append('# TYPE sun_moderation_jobs gauge')
    for status in ('pending', 'processing', 'failed'):
        lines.append(f'sun_moderation_jobs{{status="{status}"}} {int(queue.get(status) or 0)}')


def _label(value: object) -> str:
    return sanitize_log_text(str(value or '')).replace('\\', '\\\\').replace('"', '\\"')[:160]
