"""
Liveness and readiness probes for orchestration and uptime monitoring.

- /health (alias: /healthz): cheap liveness — process is up and the Flask
  worker can serve a request. Used by nginx upstream checks and uptime pings.
- /ready  (alias: /readyz):  readiness — DB and (if configured) Redis respond.
  Used by load balancers / k8s to decide whether to route traffic.

Both endpoints are CSRF-exempt and bypass rate limiting; they must stay cheap.
"""
from __future__ import annotations

import logging
import hmac
import os
import time

from flask import Blueprint, Response, current_app, jsonify, request

from app.db.connection import collect_pool_metrics
from app.database import get_db_connection
from app.extensions import limiter
from app.services.operations_metrics import prometheus_text

logger = logging.getLogger(__name__)

health_bp = Blueprint('health', __name__)

# Resolved once on import. DEPLOY_SHA is set by the deploy workflow; fall back
# to APP_RELEASE for environments that prefer semver/tag names.
_BUILD_SHA = (
    str(os.environ.get('DEPLOY_SHA') or os.environ.get('APP_RELEASE') or '').strip()
    or 'unknown'
)
_BUILD_STARTED_AT = int(time.time())


def _check_database(timeout_seconds: float = 2.0) -> tuple[bool, str]:
    started = time.monotonic()
    try:
        conn = get_db_connection()
        try:
            conn.execute('SELECT 1').fetchone()
        finally:
            conn.close()
    except Exception:  # noqa: BLE001 — probe must not raise
        logger.warning('Readiness database check failed', exc_info=True)
        return False, 'unavailable'
    elapsed = time.monotonic() - started
    if elapsed > timeout_seconds:
        return False, 'slow'
    return True, f'{elapsed * 1000:.0f}ms'


def _check_redis(timeout_seconds: float = 2.0) -> tuple[bool | None, str]:
    redis_url = str(current_app.config.get('REDIS_URL') or '').strip()
    if not redis_url:
        # Redis is optional for dev. Report as "skipped" rather than failed.
        return None, 'not configured'
    started = time.monotonic()
    try:
        import redis as redis_module  # local import: optional dependency

        client = redis_module.Redis.from_url(
            redis_url,
            socket_timeout=timeout_seconds,
            socket_connect_timeout=timeout_seconds,
        )
        client.ping()
    except Exception:  # noqa: BLE001
        logger.warning('Readiness Redis check failed', exc_info=True)
        return False, 'unavailable'
    elapsed = time.monotonic() - started
    if elapsed > timeout_seconds:
        return False, 'slow'
    return True, f'{elapsed * 1000:.0f}ms'


@health_bp.route('/health', methods=['GET'])
@health_bp.route('/healthz', methods=['GET'])
@limiter.exempt
def health():
    """Liveness probe. Returns 200 if the worker can answer at all."""
    payload = {
        'status': 'ok',
        'service': 'sunmessenger-web',
        'build': _BUILD_SHA,
        'env': current_app.config.get('ENV_NAME', 'unknown'),
        'uptime_seconds': int(time.time()) - _BUILD_STARTED_AT,
    }
    response = jsonify(payload)
    response.headers['Cache-Control'] = 'no-store'
    return response, 200


@health_bp.route('/ready', methods=['GET'])
@health_bp.route('/readyz', methods=['GET'])
@limiter.exempt
def ready():
    """
    Readiness probe. Returns 200 only when backing services respond.
    On failure returns 503 so load balancers route traffic elsewhere.
    """
    db_ok, db_detail = _check_database()
    redis_ok, redis_detail = _check_redis()

    # Redis is optional: treat None (not configured) as not-blocking.
    blocking_failures = [db_ok is False]
    if redis_ok is False:
        blocking_failures.append(True)

    overall_ok = not any(blocking_failures)
    status_code = 200 if overall_ok else 503

    payload = {
        'status': 'ready' if overall_ok else 'degraded',
        'build': _BUILD_SHA,
        'env': current_app.config.get('ENV_NAME', 'unknown'),
        'checks': {
            'database': {
                'ok': bool(db_ok),
                'detail': db_detail,
            },
            'redis': {
                'ok': redis_ok if redis_ok is not None else 'skipped',
                'detail': redis_detail,
            },
        },
        'pool': collect_pool_metrics(),
    }
    if not overall_ok:
        # Log once so ops can correlate with monitoring alerts.
        logger.warning('Readiness probe failed: %s', payload['checks'])

    response = jsonify(payload)
    response.headers['Cache-Control'] = 'no-store'
    return response, status_code


@health_bp.route('/metrics', methods=['GET'])
@limiter.exempt
def metrics():
    if not _metrics_authorized():
        return Response('unauthorized\n', status=401, mimetype='text/plain')

    body = prometheus_text(
        db_pool_metrics=collect_pool_metrics(),
        redis_metrics=_collect_redis_metrics(),
        moderation_queue=_collect_moderation_queue_metrics(),
    )
    response = Response(body, content_type='text/plain; version=0.0.4; charset=utf-8')
    response.headers['Cache-Control'] = 'no-store'
    return response


def _metrics_authorized() -> bool:
    token = str(current_app.config.get('METRICS_TOKEN') or os.environ.get('METRICS_TOKEN') or '').strip()
    if not token:
        return True
    auth_header = str(request.headers.get('Authorization') or '').strip()
    header_token = str(request.headers.get('X-Metrics-Token') or '').strip()
    return (
        hmac.compare_digest(auth_header, f'Bearer {token}')
        or hmac.compare_digest(header_token, token)
    )


def _collect_redis_metrics() -> dict:
    redis_url = str(current_app.config.get('REDIS_URL') or '').strip()
    if not redis_url:
        return {'up': False}
    try:
        import redis as redis_module

        client = redis_module.Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_timeout=1.0,
            socket_connect_timeout=1.0,
        )
        client.ping()
        info = client.info()
        metrics_payload = {
            'up': True,
            'connected_clients': int(info.get('connected_clients') or 0),
            'used_memory_bytes': int(info.get('used_memory') or 0),
            'keyspace_keys': _redis_keyspace_count(info),
            'pubsub_channels': _safe_redis_count(client.pubsub_channels),
            'pubsub_patterns': _safe_redis_count(client.pubsub_patterns),
            'queues': _collect_redis_queue_lengths(client),
        }
        return metrics_payload
    except Exception:  # noqa: BLE001 - metrics endpoint must keep rendering
        return {'up': False}


def _redis_keyspace_count(info: dict) -> int:
    total = 0
    for key, value in info.items():
        if not str(key).startswith('db') or not isinstance(value, dict):
            continue
        total += int(value.get('keys') or 0)
    return total


def _safe_redis_count(func) -> int:
    try:
        return len(func())
    except Exception:  # noqa: BLE001
        return 0


def _collect_redis_queue_lengths(client) -> dict[str, int]:
    raw_patterns = str(current_app.config.get('REDIS_QUEUE_METRIC_KEYS') or '').strip()
    if not raw_patterns:
        return {}
    queue_lengths: dict[str, int] = {}
    scanned = 0
    for pattern in [item.strip() for item in raw_patterns.split(',') if item.strip()]:
        for key in client.scan_iter(pattern, count=100):
            scanned += 1
            if scanned > 1000:
                return queue_lengths
            queue_type = str(client.type(key) or '').lower()
            if queue_type == 'list':
                queue_lengths[key] = int(client.llen(key) or 0)
            elif queue_type == 'stream':
                queue_lengths[key] = int(client.xlen(key) or 0)
            elif queue_type == 'zset':
                queue_lengths[key] = int(client.zcard(key) or 0)
            elif queue_type == 'set':
                queue_lengths[key] = int(client.scard(key) or 0)
    return queue_lengths


def _collect_moderation_queue_metrics() -> dict[str, int]:
    try:
        conn = get_db_connection()
        try:
            row = conn.execute(
                '''
                SELECT
                    COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                    COUNT(*) FILTER (WHERE status = 'processing') AS processing,
                    COUNT(*) FILTER (WHERE status = 'failed') AS failed
                FROM moderation_jobs
                '''
            ).fetchone()
        finally:
            conn.close()
    except Exception:  # noqa: BLE001
        return {}

    if not row:
        return {}
    return {
        'pending': int(row['pending'] or 0),
        'processing': int(row['processing'] or 0),
        'failed': int(row['failed'] or 0),
    }
