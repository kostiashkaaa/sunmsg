from __future__ import annotations

import os
import threading
import time
from pathlib import Path

from flask import current_app, g, has_app_context

from app.db_backend import (
    PostgresConnectionAdapter,
    connect_postgres_raw,
    testing_schema_from_identifier,
)

_REQUEST_CONNECTION_KEY = '_sun_request_db_connection'
_POOL_REGISTRY_LOCK = threading.Lock()
_POOL_REGISTRY: dict[tuple[str, str], '_PostgresAdapterPool'] = {}
_DEFAULT_DB_POOL_MAX_SIZE = 12
_DEFAULT_DB_POOL_ACQUIRE_TIMEOUT_SECONDS = 5.0


def database_url() -> str:
    return str(os.environ.get('DATABASE_URL') or '').strip()


def resolve_database_identifier(database_path) -> str:
    if isinstance(database_path, Path):
        return str(database_path.resolve())
    text = str(database_path or '').strip()
    if not text:
        return ''
    if text == ':memory:':
        return text
    try:
        return str(Path(text).resolve())
    except OSError:
        return text


def schema_for_database_path(database_path) -> str:
    return testing_schema_from_identifier(resolve_database_identifier(database_path))


def _is_raw_connection_open(raw_connection) -> bool:
    if raw_connection is None:
        return False
    try:
        return not bool(getattr(raw_connection, 'closed', True))
    except Exception:  # noqa: BLE001
        return False


def _resolve_schema_name() -> str:
    if has_app_context():
        return str(current_app.config.get('DATABASE_SCHEMA') or '').strip()
    return str(os.environ.get('DATABASE_SCHEMA') or '').strip()


def _resolve_db_pool_max_size() -> int:
    raw_value = str(os.environ.get('DB_POOL_MAX_SIZE') or '').strip()
    if not raw_value:
        return _DEFAULT_DB_POOL_MAX_SIZE
    try:
        parsed = int(raw_value)
    except (TypeError, ValueError):
        return _DEFAULT_DB_POOL_MAX_SIZE
    return max(1, parsed)


def _resolve_db_pool_acquire_timeout_seconds() -> float:
    raw_value = str(os.environ.get('DB_POOL_ACQUIRE_TIMEOUT_SECONDS') or '').strip()
    if not raw_value:
        return _DEFAULT_DB_POOL_ACQUIRE_TIMEOUT_SECONDS
    try:
        parsed = float(raw_value)
    except (TypeError, ValueError):
        return _DEFAULT_DB_POOL_ACQUIRE_TIMEOUT_SECONDS
    return max(0.0, parsed)


class _PooledConnection:
    def __init__(self, pool: '_PostgresAdapterPool | None', adapter: PostgresConnectionAdapter) -> None:
        self._pool = pool
        self._adapter = adapter
        self._closed = False

    @property
    def is_closed(self) -> bool:
        return self._closed

    def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        adapter = self._adapter
        self._adapter = None
        if adapter is None:
            return
        if self._pool is None:
            adapter.close()
            return
        self._pool.release(adapter)

    def __getattr__(self, name):
        if self._closed or self._adapter is None:
            raise RuntimeError('Database connection already closed')
        return getattr(self._adapter, name)


class _PostgresAdapterPool:
    def __init__(
        self,
        *,
        database_url: str,
        schema_name: str,
        max_size: int,
        acquire_timeout_seconds: float | None = None,
    ) -> None:
        self._database_url = database_url
        self._schema_name = schema_name
        self._max_size = max(1, int(max_size))
        self._lock = threading.Lock()
        self._condition = threading.Condition(self._lock)
        self._idle_raw_connections: list[object] = []
        self._total_connections = 0
        self._disposed = False
        if acquire_timeout_seconds is None:
            acquire_timeout_seconds = _DEFAULT_DB_POOL_ACQUIRE_TIMEOUT_SECONDS
        self._acquire_timeout_seconds = max(0.0, float(acquire_timeout_seconds))

    def acquire(self) -> _PooledConnection:
        deadline = time.monotonic() + self._acquire_timeout_seconds
        with self._condition:
            while True:
                if self._disposed:
                    raise RuntimeError('Database connection pool is disposed')

                while self._idle_raw_connections:
                    raw_connection = self._idle_raw_connections.pop()
                    if _is_raw_connection_open(raw_connection):
                        return _PooledConnection(self, PostgresConnectionAdapter(raw_connection))
                    self._decrement_total_connections_locked()

                if self._total_connections < self._max_size:
                    self._total_connections += 1
                    should_create_new = True
                    break

                remaining_seconds = deadline - time.monotonic()
                if remaining_seconds <= 0:
                    raise TimeoutError(
                        f'Database connection pool exhausted after '
                        f'{self._acquire_timeout_seconds:.3f}s '
                        f'(max_size={self._max_size})'
                    )
                self._condition.wait(timeout=remaining_seconds)

        if should_create_new:
            try:
                raw_connection = connect_postgres_raw(
                    self._database_url,
                    schema_name=self._schema_name or None,
                )
            except Exception:  # noqa: BLE001
                with self._condition:
                    self._decrement_total_connections_locked()
                raise
            return _PooledConnection(self, PostgresConnectionAdapter(raw_connection))

    def _decrement_total_connections_locked(self) -> None:
        self._total_connections = max(0, self._total_connections - 1)
        self._condition.notify()

    def _rollback_raw_connection(self, raw_connection) -> bool:
        try:
            raw_connection.rollback()
        except Exception:  # noqa: BLE001
            return False
        return True

    def _close_raw_connection_quietly(self, raw_connection) -> None:
        try:
            raw_connection.close()
        except Exception:  # noqa: BLE001
            pass

    def _return_raw_connection_to_idle_pool(self, raw_connection) -> bool:
        with self._condition:
            if self._disposed:
                self._decrement_total_connections_locked()
                return False
            if len(self._idle_raw_connections) < self._max_size and _is_raw_connection_open(raw_connection):
                self._idle_raw_connections.append(raw_connection)
                self._condition.notify()
                return True
            self._decrement_total_connections_locked()
            return False

    def release(self, adapter: PostgresConnectionAdapter) -> None:
        raw_connection = getattr(adapter, '_connection', None)
        if raw_connection is None:
            return

        if not _is_raw_connection_open(raw_connection):
            with self._condition:
                self._decrement_total_connections_locked()
            return

        if not self._rollback_raw_connection(raw_connection):
            self._close_raw_connection_quietly(raw_connection)
            with self._condition:
                self._decrement_total_connections_locked()
            return

        if self._return_raw_connection_to_idle_pool(raw_connection):
            return
        self._close_raw_connection_quietly(raw_connection)

    def dispose(self) -> None:
        with self._condition:
            if self._disposed:
                return
            self._disposed = True
            idle_connections = self._idle_raw_connections
            self._idle_raw_connections = []
            self._total_connections = max(0, self._total_connections - len(idle_connections))
            self._condition.notify_all()

        for raw_connection in idle_connections:
            try:
                raw_connection.close()
            except Exception:  # noqa: BLE001
                pass


def _pool_for(database_url_value: str, schema_name: str) -> _PostgresAdapterPool:
    pool_key = (database_url_value, schema_name)
    with _POOL_REGISTRY_LOCK:
        pool = _POOL_REGISTRY.get(pool_key)
        if pool is None:
            pool = _PostgresAdapterPool(
                database_url=database_url_value,
                schema_name=schema_name,
                max_size=_resolve_db_pool_max_size(),
                acquire_timeout_seconds=_resolve_db_pool_acquire_timeout_seconds(),
            )
            _POOL_REGISTRY[pool_key] = pool
    return pool


def clear_postgres_connection_pools() -> None:
    with _POOL_REGISTRY_LOCK:
        pools = list(_POOL_REGISTRY.values())
        _POOL_REGISTRY.clear()

    for pool in pools:
        pool.dispose()


def _get_request_scoped_connection():
    if not has_app_context():
        return None
    request_scoped = getattr(g, _REQUEST_CONNECTION_KEY, None)
    if request_scoped is None:
        return None
    if getattr(request_scoped, 'is_closed', False):
        try:
            delattr(g, _REQUEST_CONNECTION_KEY)
        except AttributeError:
            pass
        return None
    return request_scoped


def close_request_db_connection() -> None:
    if not has_app_context():
        return
    request_scoped = getattr(g, _REQUEST_CONNECTION_KEY, None)
    if request_scoped is None:
        return
    try:
        request_scoped.close()
    finally:
        try:
            delattr(g, _REQUEST_CONNECTION_KEY)
        except AttributeError:
            pass


def get_db_connection(*, request_scoped: bool = True):
    current_database_url = database_url()
    if not current_database_url:
        raise RuntimeError('DATABASE_URL must be set')

    if request_scoped:
        scoped_connection = _get_request_scoped_connection()
        if scoped_connection is not None:
            return scoped_connection

    schema_name = _resolve_schema_name()
    pooled_connection = _pool_for(current_database_url, schema_name).acquire()

    if request_scoped and has_app_context():
        setattr(g, _REQUEST_CONNECTION_KEY, pooled_connection)

    return pooled_connection


def ensure_chat_exists(conn, chat_id: str, *, chat_name: str = 'New Chat') -> None:
    normalized_chat_id = str(chat_id or '').strip()
    if not normalized_chat_id:
        return
    conn.execute(
        '''
        INSERT INTO chats (chat_id, chat_name)
        VALUES (?, ?)
        ON CONFLICT(chat_id) DO NOTHING
        ''',
        (normalized_chat_id, chat_name),
    )
