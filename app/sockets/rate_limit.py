import time
from collections import deque
from collections.abc import Callable, Mapping, MutableMapping
from logging import Logger
from math import ceil
from typing import Any

_SOCKET_RATE_TOKEN_BUCKETS_LUA = '''
local now_ms = tonumber(ARGV[1])
local states = {}

for i = 1, #KEYS do
  local offset = 2 + ((i - 1) * 4)
  local capacity = tonumber(ARGV[offset])
  local window_ms = tonumber(ARGV[offset + 1])
  local cost = tonumber(ARGV[offset + 2])
  local ttl_seconds = tonumber(ARGV[offset + 3])

  if capacity > 0 and window_ms > 0 and cost > 0 then
    local values = redis.call('HMGET', KEYS[i], 'tokens', 'updated_at')
    local tokens = tonumber(values[1])
    local updated_at = tonumber(values[2])

    if tokens == nil or updated_at == nil then
      tokens = capacity
      updated_at = now_ms
    else
      local elapsed_ms = now_ms - updated_at
      if elapsed_ms < 0 then
        elapsed_ms = 0
      end
      local refill = (elapsed_ms * capacity) / window_ms
      tokens = math.min(capacity, tokens + refill)
    end

    if tokens < cost then
      return 0
    end

    states[i] = {tokens - cost, ttl_seconds}
  else
    states[i] = false
  end
end

for i = 1, #KEYS do
  local state = states[i]
  if state then
    redis.call('HSET', KEYS[i], 'tokens', state[1], 'updated_at', now_ms)
    redis.call('EXPIRE', KEYS[i], state[2])
  end
end

return 1
'''
_SOCKET_RATE_REDIS_KEY_PREFIX = 'socket:rate:'
_SOCKET_CONNECT_IP_RATE_LUA = '''
local key = KEYS[1]
local now_ms = tonumber(ARGV[1])
local window_ms = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local ttl_seconds = tonumber(ARGV[5])

local threshold = now_ms - window_ms
redis.call('ZREMRANGEBYSCORE', key, '-inf', threshold)
local count = redis.call('ZCARD', key)
if count >= limit then
  return 0
end
redis.call('ZADD', key, now_ms, member)
redis.call('EXPIRE', key, ttl_seconds)
return 1
'''
_SOCKET_CONNECT_IP_REDIS_KEY_PREFIX = 'socket:connect:ip:'


def _scaled_limit(limit: int, multiplier: float) -> int:
    normalized_limit = int(limit)
    if normalized_limit <= 0:
        return normalized_limit
    try:
        normalized_multiplier = float(multiplier)
    except (TypeError, ValueError):
        normalized_multiplier = 1.0
    if normalized_multiplier <= 0:
        return 0
    return max(1, int(ceil(float(normalized_limit) * normalized_multiplier)))


def _normalize_bucket_key(key: str, *, key_prefix: str) -> str:
    raw_key = str(key or '').strip()
    if not raw_key:
        raise ValueError('rate-limit bucket key is required')
    prefix = str(key_prefix or '')
    if prefix and raw_key.startswith(prefix):
        return raw_key
    return f'{prefix}{raw_key}'


def resolve_socket_rate_config(
    event_name: str | None,
    *,
    default_event_name: str,
    default_limit: int,
    default_window: int,
    event_limits: Mapping[str, tuple[int, int]],
) -> tuple[str, int, int]:
    label = str(event_name or default_event_name).strip().lower() or default_event_name
    if label == default_event_name:
        return label, int(default_limit), int(default_window)
    limit, window = event_limits.get(label, (int(default_limit), int(default_window)))
    return label, int(limit), int(window)


def redis_token_buckets_rate_ok(
    redis_client,
    buckets: list[Mapping[str, Any]],
    *,
    key_prefix: str = _SOCKET_RATE_REDIS_KEY_PREFIX,
    now_ts: float | None = None,
) -> bool:
    normalized_buckets: list[dict[str, int | str]] = []
    for bucket in buckets or []:
        limit = int(bucket.get('limit', 0) or 0)
        window_seconds = int(bucket.get('window_seconds', 0) or 0)
        cost = int(bucket.get('cost', 1) or 1)
        if limit <= 0 or window_seconds <= 0 or cost <= 0:
            continue
        normalized_buckets.append(
            {
                'key': _normalize_bucket_key(str(bucket.get('key') or ''), key_prefix=key_prefix),
                'limit': limit,
                'window_seconds': window_seconds,
                'cost': cost,
            }
        )

    if not normalized_buckets:
        return True

    now = float(now_ts if now_ts is not None else time.time())
    now_ms = int(now * 1000)
    keys = [str(bucket['key']) for bucket in normalized_buckets]
    args: list[str] = [str(now_ms)]
    for bucket in normalized_buckets:
        window_seconds = int(bucket['window_seconds'])
        ttl_seconds = max(int(window_seconds * 2), 120)
        args.extend(
            [
                str(int(bucket['limit'])),
                str(max(1, int(window_seconds * 1000))),
                str(int(bucket['cost'])),
                str(ttl_seconds),
            ]
        )

    allowed = redis_client.eval(
        _SOCKET_RATE_TOKEN_BUCKETS_LUA,
        len(keys),
        *keys,
        *args,
    )
    return int(allowed or 0) == 1


def redis_token_bucket_rate_ok(
    redis_client,
    key: str,
    *,
    limit: int,
    window_seconds: int,
    cost: int = 1,
    key_prefix: str = _SOCKET_RATE_REDIS_KEY_PREFIX,
    now_ts: float | None = None,
) -> bool:
    return redis_token_buckets_rate_ok(
        redis_client,
        [
            {
                'key': key,
                'limit': limit,
                'window_seconds': window_seconds,
                'cost': cost,
            }
        ],
        key_prefix=key_prefix,
        now_ts=now_ts,
    )


def socket_rate_ok_redis(
    user_id: int,
    *,
    event_name: str | None = None,
    redis_client,
    default_event_name: str,
    default_limit: int,
    default_window: int,
    event_limits: Mapping[str, tuple[int, int]],
    global_event_limit: int = 0,
    global_event_window: int = 60,
    key_prefix: str = _SOCKET_RATE_REDIS_KEY_PREFIX,
    limit_multiplier: float = 1.0,
    now_ts: float | None = None,
) -> bool:
    event_key, limit, window = resolve_socket_rate_config(
        event_name,
        default_event_name=default_event_name,
        default_limit=default_limit,
        default_window=default_window,
        event_limits=event_limits,
    )
    scaled_limit = _scaled_limit(limit, limit_multiplier)
    buckets = [
        {
            'key': f'user:{int(user_id)}:event:{event_key}',
            'limit': scaled_limit,
            'window_seconds': int(window),
        }
    ]
    if int(global_event_limit or 0) > 0 and int(global_event_window or 0) > 0:
        buckets.append(
            {
                'key': f'global:event:{event_key}',
                'limit': int(global_event_limit),
                'window_seconds': int(global_event_window),
            }
        )
    return redis_token_buckets_rate_ok(
        redis_client,
        buckets,
        key_prefix=key_prefix,
        now_ts=now_ts,
    )


def is_legacy_socket_rate_schema_error(exc: Exception) -> bool:
    message = str(exc or '').strip().lower()
    return (
        (
            'no such column' in message
            or 'does not exist' in message
            or 'не существует' in message
        )
        and 'event_name' in message
    )


def socket_rate_ok(  # noqa: PLR0913 - injected rate-limit storage contract
    user_id: int,
    *,
    event_name: str | None = None,
    get_db_connection: Callable[[], Any],
    logger: Logger,
    default_event_name: str,
    default_limit: int,
    default_window: int,
    event_limits: Mapping[str, tuple[int, int]],
    legacy_warned_state: MutableMapping[str, bool] | None = None,
    now_ts: int | None = None,
) -> bool:
    event_key, limit, window = resolve_socket_rate_config(
        event_name,
        default_event_name=default_event_name,
        default_limit=default_limit,
        default_window=default_window,
        event_limits=event_limits,
    )
    if limit <= 0 or window <= 0:
        return True

    now = int(now_ts if now_ts is not None else time.time())
    conn = None
    try:
        conn = get_db_connection()
        conn.execute('BEGIN')
        row = conn.execute(
            '''
            SELECT window_started_at, event_count
            FROM socket_rate_limits
            WHERE user_id = ? AND event_name = ?
            ''',
            (user_id, event_key),
        ).fetchone()

        if not row or (now - int(row['window_started_at'])) >= window:
            conn.execute(
                '''
                INSERT INTO socket_rate_limits (
                    user_id,
                    event_name,
                    window_started_at,
                    event_count,
                    updated_at
                )
                VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id, event_name) DO UPDATE SET
                    window_started_at = excluded.window_started_at,
                    event_count = 1,
                    updated_at = CURRENT_TIMESTAMP
                ''',
                (user_id, event_key, now),
            )
            conn.commit()
            return True

        if int(row['event_count'] or 0) >= limit:
            conn.commit()
            return False

        conn.execute(
            '''
            UPDATE socket_rate_limits
            SET event_count = event_count + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ? AND event_name = ?
            ''',
            (user_id, event_key),
        )
        conn.commit()
        return True
    except Exception as exc:  # noqa: BLE001
        if is_legacy_socket_rate_schema_error(exc):
            if conn is not None:
                try:
                    conn.rollback()
                except Exception:  # noqa: BLE001
                    pass
                conn.close()
                conn = None
            if legacy_warned_state is None:
                legacy_warned_state = {}
            return socket_rate_ok_legacy(
                user_id,
                limit=limit,
                window=window,
                now=now,
                get_db_connection=get_db_connection,
                logger=logger,
                legacy_warned_state=legacy_warned_state,
            )
        logger.error(
            'socket rate-limit storage error user_id=%s event=%s: %s',
            user_id,
            event_key,
            exc,
        )
        return False
    finally:
        if conn is not None:
            conn.close()


def socket_rate_ok_legacy(  # noqa: PLR0913 - legacy storage fallback contract
    user_id: int,
    *,
    limit: int,
    window: int,
    now: int,
    get_db_connection: Callable[[], Any],
    logger: Logger,
    legacy_warned_state: MutableMapping[str, bool],
) -> bool:
    if not bool(legacy_warned_state.get('warned')):
        logger.warning(
            'socket rate-limit table uses legacy schema without event scope; '
            'falling back to user-wide throttling until migrations are applied'
        )
        legacy_warned_state['warned'] = True

    conn = None
    try:
        conn = get_db_connection()
        conn.execute('BEGIN')
        row = conn.execute(
            '''
            SELECT window_started_at, event_count
            FROM socket_rate_limits
            WHERE user_id = ?
            ''',
            (user_id,),
        ).fetchone()

        if not row or (now - int(row['window_started_at'])) >= window:
            conn.execute(
                '''
                INSERT INTO socket_rate_limits (
                    user_id,
                    window_started_at,
                    event_count,
                    updated_at
                )
                VALUES (?, ?, 1, CURRENT_TIMESTAMP)
                ON CONFLICT(user_id) DO UPDATE SET
                    window_started_at = excluded.window_started_at,
                    event_count = 1,
                    updated_at = CURRENT_TIMESTAMP
                ''',
                (user_id, now),
            )
            conn.commit()
            return True

        if int(row['event_count'] or 0) >= limit:
            conn.commit()
            return False

        conn.execute(
            '''
            UPDATE socket_rate_limits
            SET event_count = event_count + 1,
                updated_at = CURRENT_TIMESTAMP
            WHERE user_id = ?
            ''',
            (user_id,),
        )
        conn.commit()
        return True
    except Exception as exc:  # noqa: BLE001
        logger.error(
            'legacy socket rate-limit storage error user_id=%s: %s',
            user_id,
            exc,
        )
        return False
    finally:
        if conn is not None:
            conn.close()


def socket_signal_interval_ok(  # noqa: PLR0913 - in-memory signal throttling contract
    user_id: int,
    event_name: str,
    *,
    typing_event_min_intervals: Mapping[str, float],
    last_emit_by_event: MutableMapping[tuple[int, str], float],
    window_seconds: int,
    max_entries: int = 4096,
    now_monotonic: float | None = None,
) -> bool:
    min_interval = float(typing_event_min_intervals.get(event_name, 0.0) or 0.0)
    if min_interval <= 0:
        return True

    now = float(now_monotonic if now_monotonic is not None else time.monotonic())
    key = (int(user_id), event_name)
    last_emit = last_emit_by_event.get(key)
    if last_emit is not None and (now - last_emit) < min_interval:
        return False

    last_emit_by_event[key] = now
    if len(last_emit_by_event) > max_entries:
        stale_before = now - max(float(window_seconds), 120.0)
        for state_key, emitted_at in list(last_emit_by_event.items()):
            if emitted_at < stale_before:
                last_emit_by_event.pop(state_key, None)
    return True


def socket_connect_ip_rate_ok(  # noqa: PLR0913 - in-memory IP throttling contract
    ip_address: str | None,
    *,
    limit: int,
    window_seconds: int,
    attempts_by_ip: MutableMapping[str, deque[float]],
    attempts_lock,
    max_tracked_ips: int = 4096,
    now_ts: float | None = None,
) -> bool:
    if limit <= 0 or window_seconds <= 0:
        return True

    now = float(now_ts if now_ts is not None else time.time())
    ip_key = str(ip_address or '-').strip() or '-'
    window_start = now - float(window_seconds)

    with attempts_lock:
        bucket = attempts_by_ip.get(ip_key)
        if bucket is None:
            bucket = deque()
            attempts_by_ip[ip_key] = bucket

        while bucket and bucket[0] <= window_start:
            bucket.popleft()

        if len(bucket) >= limit:
            return False

        bucket.append(now)
        if len(attempts_by_ip) > max_tracked_ips:
            stale_before = now - max(float(window_seconds), 300.0)
            for tracked_ip, tracked_bucket in list(attempts_by_ip.items()):
                while tracked_bucket and tracked_bucket[0] <= stale_before:
                    tracked_bucket.popleft()
                if not tracked_bucket:
                    attempts_by_ip.pop(tracked_ip, None)
    return True


def socket_connect_ip_rate_ok_redis(  # noqa: PLR0913 - redis IP throttling contract
    ip_address: str | None,
    *,
    limit: int,
    window_seconds: int,
    redis_client,
    key_prefix: str = _SOCKET_CONNECT_IP_REDIS_KEY_PREFIX,
    now_ts: float | None = None,
    unique_member: str | None = None,
) -> bool:
    if limit <= 0 or window_seconds <= 0:
        return True

    now = float(now_ts if now_ts is not None else time.time())
    now_ms = int(now * 1000)
    window_ms = max(1, int(float(window_seconds) * 1000))
    ttl_seconds = max(int(window_seconds * 2), 120)
    ip_key = str(ip_address or '-').strip() or '-'
    redis_key = f'{key_prefix}{ip_key}'
    member = unique_member or f'{now_ms}:{time.time_ns()}'

    allowed = redis_client.eval(
        _SOCKET_CONNECT_IP_RATE_LUA,
        1,
        redis_key,
        str(now_ms),
        str(window_ms),
        str(int(limit)),
        member,
        str(ttl_seconds),
    )
    return int(allowed or 0) == 1
