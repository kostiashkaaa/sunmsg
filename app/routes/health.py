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
import os
import time

from flask import Blueprint, current_app, jsonify

from app.database import get_db_connection
from app.db.connection import collect_pool_metrics
from app.extensions import limiter

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
    except Exception as exc:  # noqa: BLE001 — probe must not raise
        return False, f'{type(exc).__name__}: {exc}'
    elapsed = time.monotonic() - started
    if elapsed > timeout_seconds:
        return False, f'slow ({elapsed:.2f}s > {timeout_seconds:.2f}s)'
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
    except Exception as exc:  # noqa: BLE001
        return False, f'{type(exc).__name__}: {exc}'
    elapsed = time.monotonic() - started
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
