"""
Presence store: tracks connected SIDs and active (visible) tabs per user.

Uses Redis when REDIS_URL is set, otherwise falls back to in-process dicts.
The fallback is safe for single-process deployments (for example threading mode).
With multiple workers you MUST set REDIS_URL; otherwise each worker keeps its
own independent state and online status will be wrong.
"""

import logging
import os
import threading

from app.services.logging_safety import redact_url_for_log

logger = logging.getLogger(__name__)

def _presence_ttl_seconds() -> int:
    try:
        return max(60, int(os.environ.get('PRESENCE_REDIS_TTL_SECONDS') or 900))
    except (TypeError, ValueError):
        return 900


_REDIS_TTL = _presence_ttl_seconds()


def _make_redis_store(redis_url: str):
    try:
        import redis

        redis_client = redis.Redis.from_url(redis_url, decode_responses=True)
        redis_client.ping()
        logger.info('Presence store: using Redis (%s)', redact_url_for_log(redis_url))
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
_store_lock = threading.Lock()

# Redis key helpers
_PREFIX_CONN = 'presence:conn:'
_PREFIX_ACT = 'presence:act:'
_PREFIX_CONN_SID = 'presence:conn:sid:'
_PREFIX_ACT_SID = 'presence:act:sid:'


def _sid_key(prefix: str, pub: str, sid: str) -> str:
    return f'{prefix}{pub}:{sid}'


def _sid_key_prefix(prefix: str, pub: str) -> str:
    return f'{prefix}{pub}:'


def _prune_redis_set(set_key: str, sid_prefix: str) -> int:
    members = _redis.smembers(set_key)
    stale_members = [sid for sid in members if not _redis.exists(sid_prefix + sid)]
    if stale_members:
        _redis.srem(set_key, *stale_members)
    count = int(_redis.scard(set_key) or 0)
    if count <= 0:
        _redis.delete(set_key)
    else:
        _redis.expire(set_key, _REDIS_TTL)
    return count


def _add_redis_sid_with_limit(set_key: str, sid_key: str, sid_prefix: str, sid: str, max_connections: int) -> int:
    return int(
        _redis.eval(
            '''
            local set_key = KEYS[1]
            local sid_key = KEYS[2]
            local sid = ARGV[1]
            local ttl = tonumber(ARGV[2])
            local max_connections = tonumber(ARGV[3])
            local sid_prefix = ARGV[4]

            local members = redis.call('SMEMBERS', set_key)
            for _, member in ipairs(members) do
                if redis.call('EXISTS', sid_prefix .. member) == 0 then
                    redis.call('SREM', set_key, member)
                end
            end

            local already_present = redis.call('SISMEMBER', set_key, sid)
            local count = redis.call('SCARD', set_key)
            if max_connections > 0 and already_present == 0 and count >= max_connections then
                return -1
            end

            redis.call('SADD', set_key, sid)
            redis.call('SET', sid_key, '1', 'EX', ttl)
            redis.call('EXPIRE', set_key, ttl)
            return redis.call('SCARD', set_key)
            ''',
            2,
            set_key,
            sid_key,
            sid,
            _REDIS_TTL,
            max(0, int(max_connections or 0)),
            sid_prefix,
        )
    )


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


def add_connected(pub: str, sid: str, *, max_connections: int = 0) -> int:
    """Register a new SID for pub. Returns total connected-SID count."""
    _ensure_configured()
    if _redis is not None:
        return _add_redis_sid_with_limit(
            _PREFIX_CONN + pub,
            _sid_key(_PREFIX_CONN_SID, pub, sid),
            _sid_key_prefix(_PREFIX_CONN_SID, pub),
            sid,
            max_connections,
        )
    with _store_lock:
        sid_set = _connected.setdefault(pub, set())
        limit = max(0, int(max_connections or 0))
        if limit > 0 and sid not in sid_set and len(sid_set) >= limit:
            return -1
        sid_set.add(sid)
        return len(sid_set)


def remove_connected(pub: str, sid: str) -> int:
    """Remove a SID. Returns remaining connected-SID count."""
    _ensure_configured()
    if _redis is not None:
        key = _PREFIX_CONN + pub
        active_key = _PREFIX_ACT + pub
        pipe = _redis.pipeline()
        pipe.srem(key, sid)
        pipe.srem(active_key, sid)
        pipe.delete(_sid_key(_PREFIX_CONN_SID, pub, sid))
        pipe.delete(_sid_key(_PREFIX_ACT_SID, pub, sid))
        pipe.execute()
        count = _prune_redis_set(key, _sid_key_prefix(_PREFIX_CONN_SID, pub))
        _prune_redis_set(active_key, _sid_key_prefix(_PREFIX_ACT_SID, pub))
        return count
    with _store_lock:
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
    if _redis is not None:
        return _prune_redis_set(_PREFIX_CONN + pub, _sid_key_prefix(_PREFIX_CONN_SID, pub))
    with _store_lock:
        return len(_connected.get(pub, set()))


def add_active(pub: str, sid: str) -> int:
    """Mark tab as visible/active. Returns active-tab count."""
    _ensure_configured()
    if _redis is not None:
        connected_key = _PREFIX_CONN + pub
        key = _PREFIX_ACT + pub
        pipe = _redis.pipeline()
        pipe.sadd(connected_key, sid)
        pipe.set(_sid_key(_PREFIX_CONN_SID, pub, sid), '1', ex=_REDIS_TTL)
        pipe.expire(connected_key, _REDIS_TTL)
        pipe.sadd(key, sid)
        pipe.set(_sid_key(_PREFIX_ACT_SID, pub, sid), '1', ex=_REDIS_TTL)
        pipe.expire(key, _REDIS_TTL)
        pipe.scard(key)
        results = pipe.execute()
        return int(results[-1] or 0)
    with _store_lock:
        _connected.setdefault(pub, set()).add(sid)
        _active.setdefault(pub, set()).add(sid)
        return len(_active[pub])


def remove_active(pub: str, sid: str) -> int:
    """Mark tab as hidden/inactive. Returns remaining active-tab count."""
    _ensure_configured()
    if _redis is not None:
        connected_key = _PREFIX_CONN + pub
        key = _PREFIX_ACT + pub
        pipe = _redis.pipeline()
        pipe.sadd(connected_key, sid)
        pipe.set(_sid_key(_PREFIX_CONN_SID, pub, sid), '1', ex=_REDIS_TTL)
        pipe.expire(connected_key, _REDIS_TTL)
        pipe.srem(key, sid)
        pipe.delete(_sid_key(_PREFIX_ACT_SID, pub, sid))
        pipe.execute()
        return _prune_redis_set(key, _sid_key_prefix(_PREFIX_ACT_SID, pub))
    with _store_lock:
        _connected.setdefault(pub, set()).add(sid)
        sid_set = _active.get(pub)
        if sid_set:
            sid_set.discard(sid)
            if not sid_set:
                _active.pop(pub, None)
        return len(_active.get(pub, set()))


def count_active(pub: str) -> int:
    """Return number of active (visible) tabs for pub."""
    _ensure_configured()
    if _redis is not None:
        return _prune_redis_set(_PREFIX_ACT + pub, _sid_key_prefix(_PREFIX_ACT_SID, pub))
    with _store_lock:
        return len(_active.get(pub, set()))


def is_effectively_online(pub: str | None, *, persisted: bool = False) -> bool:
    """Resolve current online state from the shared presence store first."""
    normalized_pub = str(pub or '').strip()
    if not normalized_pub:
        return bool(persisted)
    return count_active(normalized_pub) > 0
