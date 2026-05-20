import pytest

from app.db import connection as db_connection


class _FakeRawConnection:
    closed = False

    def __init__(self) -> None:
        self.rollback_count = 0
        self.close_count = 0

    def rollback(self) -> None:
        self.rollback_count += 1

    def close(self) -> None:
        self.close_count += 1
        self.closed = True


def test_postgres_pool_times_out_instead_of_opening_unbounded_direct_connection(monkeypatch):
    created_raw_connections: list[_FakeRawConnection] = []

    def fake_connect_raw(database_url, *, schema_name=None):
        raw_connection = _FakeRawConnection()
        created_raw_connections.append(raw_connection)
        return raw_connection

    monkeypatch.setattr(db_connection, 'connect_postgres_raw', fake_connect_raw)

    pool = db_connection._PostgresAdapterPool(
        database_url='postgresql://test',
        schema_name='test_schema',
        max_size=1,
        acquire_timeout_seconds=0.01,
    )

    first_connection = pool.acquire()
    with pytest.raises(TimeoutError):
        pool.acquire()

    assert len(created_raw_connections) == 1

    first_connection.close()
    second_connection = pool.acquire()

    assert len(created_raw_connections) == 1

    second_connection.close()
    pool.dispose()
