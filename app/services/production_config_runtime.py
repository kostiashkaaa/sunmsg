from __future__ import annotations

import os

from app.bootstrap.security import _is_default_or_weak_production_secret, _is_redis_like_uri
from app.config import get_config_class, load_environment
from app.services.turn_pool import select_turn_relays


def _check(name: str, ok: bool, detail: str) -> dict:
    return {
        'name': name,
        'ok': bool(ok),
        'detail': str(detail or ''),
    }


def run_production_config_check(config_name=None, overrides=None):
    load_environment()
    prior_secret_key = os.environ.get('SECRET_KEY')
    prior_database_url = os.environ.get('DATABASE_URL')
    try:
        if not str(os.environ.get('SECRET_KEY') or '').strip():
            override_secret_key = str((overrides or {}).get('SECRET_KEY') or '').strip()
            os.environ['SECRET_KEY'] = override_secret_key or 'temporary-production-check-secret-key-32-bytes'
        if not str(os.environ.get('DATABASE_URL') or '').strip():
            override_database_url = str((overrides or {}).get('DATABASE_URL') or '').strip()
            os.environ['DATABASE_URL'] = (
                override_database_url
                or 'postgresql://sunmessenger:check@127.0.0.1:5432/sunmessenger'
            )
        config = get_config_class(config_name).from_env()
    finally:
        if prior_secret_key is None:
            os.environ.pop('SECRET_KEY', None)
        else:
            os.environ['SECRET_KEY'] = prior_secret_key
        if prior_database_url is None:
            os.environ.pop('DATABASE_URL', None)
        else:
            os.environ['DATABASE_URL'] = prior_database_url

    if overrides:
        config.update(overrides)

    env_name = str(config.get('ENV_NAME') or '').strip().lower()
    using_dev_secret = bool(config.get('USING_DEV_SECRET_KEY'))
    secret_key = str(config.get('SECRET_KEY') or '')
    session_samesite = str(config.get('SESSION_COOKIE_SAMESITE') or '').strip().lower()
    force_https = bool(config.get('FORCE_HTTPS'))
    session_cookie_secure = bool(config.get('SESSION_COOKIE_SECURE'))
    session_cookie_httponly = bool(config.get('SESSION_COOKIE_HTTPONLY'))
    proxy_fix_x_proto = int(config.get('PROXY_FIX_X_PROTO', 0) or 0)
    redis_url = str(config.get('REDIS_URL') or '').strip()
    ratelimit_storage_uri = str(config.get('RATELIMIT_STORAGE_URI') or '').strip()
    socketio_message_queue = str(config.get('SOCKETIO_MESSAGE_QUEUE') or '').strip()
    turn_secret = str(config.get('TURN_SECRET') or '').strip()
    turn_urls_raw = str(config.get('TURN_SERVER_URLS') or config.get('TURN_SERVER_URL') or '').strip()
    try:
        turn_credential_ttl_seconds = int(config.get('TURN_CREDENTIAL_TTL_SECONDS') or 0)
    except (TypeError, ValueError):
        turn_credential_ttl_seconds = 0
    turn_selection = select_turn_relays(
        pool_raw=str(config.get('TURN_SERVER_POOL') or '').strip(),
        legacy_urls_raw=turn_urls_raw,
        limit=int(config.get('TURN_SERVER_POOL_LIMIT') or 2),
    )

    checks = [
        _check('env_is_production', env_name == 'production', f'ENV_NAME={env_name or "-"}'),
        _check(
            'secret_key_strong',
            not _is_default_or_weak_production_secret(secret_key, using_dev_secret=using_dev_secret),
            'SECRET_KEY must be non-default and at least 32 chars',
        ),
        _check('session_cookie_secure', session_cookie_secure, f'SESSION_COOKIE_SECURE={session_cookie_secure}'),
        _check('session_cookie_httponly', session_cookie_httponly, f'SESSION_COOKIE_HTTPONLY={session_cookie_httponly}'),
        _check(
            'session_cookie_samesite',
            session_samesite in {'lax', 'strict'},
            f'SESSION_COOKIE_SAMESITE={session_samesite or "-"}',
        ),
        _check('force_https_enabled', force_https, f'FORCE_HTTPS={force_https}'),
        _check('proxy_fix_x_proto', proxy_fix_x_proto >= 1, f'PROXY_FIX_X_PROTO={proxy_fix_x_proto}'),
        _check(
            'redis_url_valid',
            bool(redis_url) and _is_redis_like_uri(redis_url),
            f'REDIS_URL={"set" if redis_url else "missing"}',
        ),
        _check(
            'ratelimit_storage_uri_valid',
            bool(ratelimit_storage_uri) and _is_redis_like_uri(ratelimit_storage_uri),
            f'RATELIMIT_STORAGE_URI={"set" if ratelimit_storage_uri else "missing"}',
        ),
        _check(
            'socketio_message_queue_valid',
            bool(socketio_message_queue) and _is_redis_like_uri(socketio_message_queue),
            f'SOCKETIO_MESSAGE_QUEUE={"set" if socketio_message_queue else "missing"}',
        ),
        _check(
            'turn_configured_for_calls',
            bool(turn_secret and turn_selection.relays),
            (
                'TURN_SECRET and at least one healthy TURN relay are required '
                f'for production calls; relays={len(turn_selection.relays)}'
            ),
        ),
        _check(
            'turn_credential_ttl_short',
            60 <= turn_credential_ttl_seconds <= 3600,
            f'TURN_CREDENTIAL_TTL_SECONDS={turn_credential_ttl_seconds}',
        ),
    ]

    ok = all(item['ok'] for item in checks)
    report = {
        'env': env_name,
        'status': 'ok' if ok else 'failed',
        'checks': checks,
    }
    return report
