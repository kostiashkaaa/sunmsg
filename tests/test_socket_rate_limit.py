import logging
import threading
from pathlib import Path

from app.sockets.rate_limit import (
    is_legacy_socket_rate_schema_error,
    redis_token_bucket_rate_ok,
    redis_token_buckets_rate_ok,
    resolve_socket_rate_config,
    socket_connect_ip_rate_ok,
    socket_connect_ip_rate_ok_redis,
    socket_rate_ok,
    socket_rate_ok_redis,
    socket_signal_interval_ok,
)
from app.db_backend import DatabaseError
from tests._pg_test_db import connect_test_db


def _connect(db_path: Path):
    return connect_test_db(db_path)


def test_resolve_socket_rate_config_defaults_and_overrides():
    event_limits = {
        'typing': (30, 60),
        'activity_update': (120, 60),
    }

    assert resolve_socket_rate_config(
        None,
        default_event_name='default',
        default_limit=10,
        default_window=50,
        event_limits=event_limits,
    ) == ('default', 10, 50)

    assert resolve_socket_rate_config(
        '  TYPING  ',
        default_event_name='default',
        default_limit=10,
        default_window=50,
        event_limits=event_limits,
    ) == ('typing', 30, 60)

    assert resolve_socket_rate_config(
        'unknown',
        default_event_name='default',
        default_limit=10,
        default_window=50,
        event_limits=event_limits,
    ) == ('unknown', 10, 50)


def test_is_legacy_socket_rate_schema_error_detection():
    assert is_legacy_socket_rate_schema_error(DatabaseError('no such column: event_name')) is True
    assert is_legacy_socket_rate_schema_error(DatabaseError('NO SUCH COLUMN: EVENT_NAME')) is True
    assert is_legacy_socket_rate_schema_error(DatabaseError('some other db error')) is False


def test_socket_signal_interval_ok_throttles_and_prunes():
    state: dict[tuple[int, str], float] = {
        (9, 'typing'): -500.0,
    }
    intervals = {'typing': 2.0}

    assert socket_signal_interval_ok(
        1,
        'typing',
        typing_event_min_intervals=intervals,
        last_emit_by_event=state,
        window_seconds=60,
        max_entries=2,
        now_monotonic=10.0,
    ) is True
    assert socket_signal_interval_ok(
        1,
        'typing',
        typing_event_min_intervals=intervals,
        last_emit_by_event=state,
        window_seconds=60,
        max_entries=2,
        now_monotonic=11.0,
    ) is False
    assert socket_signal_interval_ok(
        2,
        'typing',
        typing_event_min_intervals=intervals,
        last_emit_by_event=state,
        window_seconds=60,
        max_entries=2,
        now_monotonic=1000.0,
    ) is True

    assert (9, 'typing') not in state
    assert (1, 'typing') not in state
    assert (2, 'typing') in state


def test_socket_connect_ip_rate_ok_limits_and_resets_window():
    attempts = {}
    lock = threading.Lock()

    assert socket_connect_ip_rate_ok(
        '203.0.113.10',
        limit=2,
        window_seconds=60,
        attempts_by_ip=attempts,
        attempts_lock=lock,
        now_ts=100.0,
    ) is True
    assert socket_connect_ip_rate_ok(
        '203.0.113.10',
        limit=2,
        window_seconds=60,
        attempts_by_ip=attempts,
        attempts_lock=lock,
        now_ts=101.0,
    ) is True
    assert socket_connect_ip_rate_ok(
        '203.0.113.10',
        limit=2,
        window_seconds=60,
        attempts_by_ip=attempts,
        attempts_lock=lock,
        now_ts=102.0,
    ) is False

    # Old entries expire after the window and permit a new connection.
    assert socket_connect_ip_rate_ok(
        '203.0.113.10',
        limit=2,
        window_seconds=60,
        attempts_by_ip=attempts,
        attempts_lock=lock,
        now_ts=161.0,
    ) is True


class _FakeRedisSlidingWindow:
    def __init__(self):
        self._store: dict[str, list[tuple[int, str]]] = {}

    def eval(self, _script, _numkeys, key, now_ms, window_ms, limit, member, _ttl):
        now = int(now_ms)
        window = int(window_ms)
        max_allowed = int(limit)

        bucket = self._store.setdefault(str(key), [])
        threshold = now - window
        bucket = [(score, item) for score, item in bucket if score > threshold]
        if len(bucket) >= max_allowed:
            self._store[str(key)] = bucket
            return 0

        bucket.append((now, str(member)))
        self._store[str(key)] = bucket
        return 1


class _FakeRedisTokenBuckets:
    def __init__(self):
        self._store: dict[str, dict[str, float]] = {}

    def eval(self, _script, numkeys, *args):
        keys = [str(value) for value in args[:numkeys]]
        raw_args = list(args[numkeys:])
        now_ms = int(raw_args[0])
        states = []
        for index, key in enumerate(keys):
            offset = 1 + (index * 4)
            capacity = float(raw_args[offset])
            window_ms = float(raw_args[offset + 1])
            cost = float(raw_args[offset + 2])
            ttl_seconds = int(raw_args[offset + 3])
            if capacity <= 0 or window_ms <= 0 or cost <= 0:
                states.append(None)
                continue

            current = self._store.get(key)
            if current is None:
                tokens = capacity
                updated_at = now_ms
            else:
                elapsed_ms = max(0, now_ms - int(current['updated_at']))
                tokens = min(capacity, float(current['tokens']) + ((elapsed_ms * capacity) / window_ms))
                updated_at = now_ms

            if tokens < cost:
                return 0
            states.append({'key': key, 'tokens': tokens - cost, 'updated_at': updated_at, 'ttl': ttl_seconds})

        for state in states:
            if state is None:
                continue
            self._store[str(state['key'])] = {
                'tokens': float(state['tokens']),
                'updated_at': float(state['updated_at']),
                'ttl': float(state['ttl']),
            }
        return 1


def test_socket_connect_ip_rate_ok_redis_limits_and_resets_window():
    redis_client = _FakeRedisSlidingWindow()

    assert socket_connect_ip_rate_ok_redis(
        '203.0.113.11',
        limit=2,
        window_seconds=60,
        redis_client=redis_client,
        now_ts=100.0,
        unique_member='1',
    ) is True
    assert socket_connect_ip_rate_ok_redis(
        '203.0.113.11',
        limit=2,
        window_seconds=60,
        redis_client=redis_client,
        now_ts=101.0,
        unique_member='2',
    ) is True
    assert socket_connect_ip_rate_ok_redis(
        '203.0.113.11',
        limit=2,
        window_seconds=60,
        redis_client=redis_client,
        now_ts=102.0,
        unique_member='3',
    ) is False

    assert socket_connect_ip_rate_ok_redis(
        '203.0.113.11',
        limit=2,
        window_seconds=60,
        redis_client=redis_client,
        now_ts=161.0,
        unique_member='4',
    ) is True


def test_redis_token_buckets_rate_ok_is_atomic_when_later_bucket_fails():
    redis_client = _FakeRedisTokenBuckets()

    assert redis_token_buckets_rate_ok(
        redis_client,
        [
            {'key': 'a', 'limit': 2, 'window_seconds': 60},
            {'key': 'b', 'limit': 1, 'window_seconds': 60},
        ],
        now_ts=100.0,
    ) is True
    assert redis_token_buckets_rate_ok(
        redis_client,
        [
            {'key': 'a', 'limit': 2, 'window_seconds': 60},
            {'key': 'b', 'limit': 1, 'window_seconds': 60},
        ],
        now_ts=100.0,
    ) is False

    assert redis_token_bucket_rate_ok(
        redis_client,
        'a',
        limit=2,
        window_seconds=60,
        now_ts=100.0,
    ) is True


def test_socket_rate_ok_redis_applies_global_event_bucket():
    redis_client = _FakeRedisTokenBuckets()

    assert socket_rate_ok_redis(
        1,
        event_name='send_message',
        redis_client=redis_client,
        default_event_name='default',
        default_limit=10,
        default_window=60,
        event_limits={'send_message': (10, 60)},
        global_event_limit=1,
        global_event_window=60,
        now_ts=100.0,
    ) is True
    assert socket_rate_ok_redis(
        2,
        event_name='send_message',
        redis_client=redis_client,
        default_event_name='default',
        default_limit=10,
        default_window=60,
        event_limits={'send_message': (10, 60)},
        global_event_limit=1,
        global_event_window=60,
        now_ts=100.0,
    ) is False


def test_socket_rate_ok_event_scoped_limits(tmp_path):
    db_path = tmp_path / 'socket-rate-event-scoped.db'
    with _connect(db_path) as conn:
        conn.execute(
            '''
            CREATE TABLE socket_rate_limits (
                user_id INTEGER NOT NULL,
                event_name TEXT NOT NULL,
                window_started_at INTEGER NOT NULL,
                event_count INTEGER NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (user_id, event_name)
            )
            '''
        )
        conn.commit()

    legacy_state = {'warned': False}
    logger = logging.getLogger('test-socket-rate-event-scoped')

    def get_db_connection():
        return _connect(db_path)

    event_limits = {'typing': (2, 60)}

    assert socket_rate_ok(
        7,
        event_name=None,
        get_db_connection=get_db_connection,
        logger=logger,
        default_event_name='default',
        default_limit=1,
        default_window=60,
        event_limits=event_limits,
        legacy_warned_state=legacy_state,
        now_ts=100,
    ) is True
    assert socket_rate_ok(
        7,
        event_name=None,
        get_db_connection=get_db_connection,
        logger=logger,
        default_event_name='default',
        default_limit=1,
        default_window=60,
        event_limits=event_limits,
        legacy_warned_state=legacy_state,
        now_ts=101,
    ) is False

    assert socket_rate_ok(
        7,
        event_name='typing',
        get_db_connection=get_db_connection,
        logger=logger,
        default_event_name='default',
        default_limit=1,
        default_window=60,
        event_limits=event_limits,
        legacy_warned_state=legacy_state,
        now_ts=101,
    ) is True
    assert socket_rate_ok(
        7,
        event_name='typing',
        get_db_connection=get_db_connection,
        logger=logger,
        default_event_name='default',
        default_limit=1,
        default_window=60,
        event_limits=event_limits,
        legacy_warned_state=legacy_state,
        now_ts=101,
    ) is True
    assert socket_rate_ok(
        7,
        event_name='typing',
        get_db_connection=get_db_connection,
        logger=logger,
        default_event_name='default',
        default_limit=1,
        default_window=60,
        event_limits=event_limits,
        legacy_warned_state=legacy_state,
        now_ts=101,
    ) is False

    with _connect(db_path) as conn:
        default_row = conn.execute(
            '''
            SELECT event_count
            FROM socket_rate_limits
            WHERE user_id = ? AND event_name = ?
            ''',
            (7, 'default'),
        ).fetchone()
        typing_row = conn.execute(
            '''
            SELECT event_count
            FROM socket_rate_limits
            WHERE user_id = ? AND event_name = ?
            ''',
            (7, 'typing'),
        ).fetchone()

    assert default_row['event_count'] == 1
    assert typing_row['event_count'] == 2
    assert legacy_state['warned'] is False


def test_socket_rate_ok_falls_back_to_legacy_schema(tmp_path):
    db_path = tmp_path / 'socket-rate-legacy.db'
    with _connect(db_path) as conn:
        conn.execute(
            '''
            CREATE TABLE socket_rate_limits (
                user_id INTEGER PRIMARY KEY,
                window_started_at INTEGER NOT NULL,
                event_count INTEGER NOT NULL,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
            '''
        )
        conn.commit()

    legacy_state = {'warned': False}
    logger = logging.getLogger('test-socket-rate-legacy')

    def get_db_connection():
        return _connect(db_path)

    assert socket_rate_ok(
        42,
        event_name='typing',
        get_db_connection=get_db_connection,
        logger=logger,
        default_event_name='default',
        default_limit=1,
        default_window=60,
        event_limits={},
        legacy_warned_state=legacy_state,
        now_ts=500,
    ) is True
    assert legacy_state['warned'] is True

    assert socket_rate_ok(
        42,
        event_name='typing',
        get_db_connection=get_db_connection,
        logger=logger,
        default_event_name='default',
        default_limit=1,
        default_window=60,
        event_limits={},
        legacy_warned_state=legacy_state,
        now_ts=501,
    ) is False

    with _connect(db_path) as conn:
        row = conn.execute(
            '''
            SELECT event_count
            FROM socket_rate_limits
            WHERE user_id = ?
            ''',
            (42,),
        ).fetchone()

    assert row['event_count'] == 1
