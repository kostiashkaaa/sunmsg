"""
Presence store: tracks connected SIDs and active (visible) tabs per user.

Uses Redis when REDIS_URL is set, otherwise falls back to in-process dicts.
The fallback is safe for single-process deployments (for example threading mode).
With multiple workers you MUST set REDIS_URL; otherwise each worker keeps its
own independent state and online status will be wrong.
"""

import logging
import os

logger = logging.getLogger(__name__)

_REDIS_TTL = 86400  # 24 h - safety expiry for orphaned keys


def _make_redis_store(redis_url: str):
    try:
        import redis

        redis_client = redis.Redis.from_url(redis_url, decode_responses=True)
        redis_client.ping()
        logger.info('Presence store: using Redis (%s)', redis_url)
        return redis_client
    except Exception as exc:
        logger.warning(
            'Presence store: Redis unavailable (%s), falling back to in-process dicts.',
            exc,
        )
        return None


_redis = None
_configured_redis_url = None
_configured_env_name = None

# in-process fallback
_connected: dict[str, set] = {}
_active: dict[str, set] = {}

# Redis key helpers
_PREFIX_CONN = 'presence:conn:'
_PREFIX_ACT = 'presence:act:'


def _normalize_redis_url(redis_url: str | None = None) -> str:
    return str(redis_url or os.environ.get('REDIS_URL') or '').strip()


def _normalize_env_name(env_name: str | None = None) -> str:
    return str(
        env_name
        or os.environ.get('APP_ENV')
        or os.environ.get('FLASK_ENV')
        or ''
    ).strip().lower()


def configure_presence(redis_url: str | None = None, env_name: str | None = None):
    global _redis, _configured_redis_url, _configured_env_name

    normalized_redis_url = _normalize_redis_url(redis_url)
    normalized_env_name = _normalize_env_name(env_name)
    if (
        normalized_redis_url == _configured_redis_url
        and normalized_env_name == _configured_env_name
    ):
        return _redis

    _configured_redis_url = normalized_redis_url
    _configured_env_name = normalized_env_name
    _redis = _make_redis_store(normalized_redis_url) if normalized_redis_url else None

    if _redis is None and normalized_env_name == 'production':
        logger.warning(
            'Presence store: REDIS_URL not set in production. '
            'Online status will be incorrect with multiple workers.'
        )

    return _redis


def _ensure_configured() -> None:
    normalized_redis_url = _normalize_redis_url()
    normalized_env_name = _normalize_env_name()
    if (
        normalized_redis_url != _configured_redis_url
        or normalized_env_name != _configured_env_name
    ):
        configure_presence(normalized_redis_url, normalized_env_name)


def add_connected(pub: str, sid: str) -> int:
    """Register a new SID for pub. Returns total connected-SID count."""
    _ensure_configured()
    if _redis:
        key = _PREFIX_CONN + pub
        pipe = _redis.pipeline()
        pipe.sadd(key, sid)
        pipe.expire(key, _REDIS_TTL)
        pipe.scard(key)
        results = pipe.execute()
        return results[2]
    _connected.setdefault(pub, set()).add(sid)
    return len(_connected[pub])


def remove_connected(pub: str, sid: str) -> int:
    """Remove a SID. Returns remaining connected-SID count."""
    _ensure_configured()
    if _redis:
        key = _PREFIX_CONN + pub
        active_key = _PREFIX_ACT + pub
        _redis.srem(key, sid)
        _redis.srem(active_key, sid)
        count = _redis.scard(key)
        if count == 0:
            _redis.delete(key)
            _redis.delete(active_key)
        return count
    sid_set = _connected.get(pub)
    if sid_set:
        sid_set.discard(sid)
        if not sid_set:
            _connected.pop(pub, None)
    active_set = _active.get(pub)
    if active_set:
        active_set.discard(sid)
        if not active_set:
            _active.pop(pub, None)
    return len(_connected.get(pub, set()))


def count_connected(pub: str) -> int:
    """Return number of connected tabs (active or background) for pub."""
    _ensure_configured()
    if _redis:
        return _redis.scard(_PREFIX_CONN + pub)
    return len(_connected.get(pub, set()))


def add_active(pub: str, sid: str) -> int:
    """Mark tab as visible/active. Returns active-tab count."""
    _ensure_configured()
    if _redis:
        key = _PREFIX_ACT + pub
        pipe = _redis.pipeline()
        pipe.sadd(key, sid)
        pipe.expire(key, _REDIS_TTL)
        pipe.scard(key)
        results = pipe.execute()
        return results[2]
    _active.setdefault(pub, set()).add(sid)
    return len(_active[pub])


def remove_active(pub: str, sid: str) -> int:
    """Mark tab as hidden/inactive. Returns remaining active-tab count."""
    _ensure_configured()
    if _redis:
        key = _PREFIX_ACT + pub
        _redis.srem(key, sid)
        count = _redis.scard(key)
        if count == 0:
            _redis.delete(key)
        return count
    sid_set = _active.get(pub)
    if sid_set:
        sid_set.discard(sid)
        if not sid_set:
            _active.pop(pub, None)
    return len(_active.get(pub, set()))


def count_active(pub: str) -> int:
    """Return number of active (visible) tabs for pub."""
    _ensure_configured()
    if _redis:
        return _redis.scard(_PREFIX_ACT + pub)
    return len(_active.get(pub, set()))


def is_effectively_online(pub: str | None, *, persisted: bool = False) -> bool:
    """Resolve current online state from the shared presence store first."""
    normalized_pub = str(pub or '').strip()
    if not normalized_pub:
        return bool(persisted)
    return count_active(normalized_pub) > 0
