from __future__ import annotations

import os
import sys
import time
from urllib.parse import quote, unquote, urlparse, urlunparse

import psycopg

from app.config import load_environment


DEFAULT_ATTEMPTS = 10
DEFAULT_DELAY_SECONDS = 1.0
DEFAULT_CONNECT_TIMEOUT_SECONDS = 2


def _database_name(database_url: str) -> str:
    parsed = urlparse(str(database_url or ""))
    name = unquote(str(parsed.path or "").lstrip("/")).strip()
    if not name:
        raise RuntimeError("TEST_DATABASE_URL must include a database name.")
    return name


def _with_database(database_url: str, database_name: str) -> str:
    parsed = urlparse(str(database_url or ""))
    if parsed.scheme.lower() not in {"postgres", "postgresql"}:
        raise RuntimeError("TEST_DATABASE_URL must use a PostgreSQL DSN.")
    safe_name = quote(str(database_name or "").strip(), safe="")
    if not safe_name:
        raise RuntimeError("PostgreSQL maintenance database name is empty.")
    return urlunparse(parsed._replace(path=f"/{safe_name}"))


def _quote_ident(value: str) -> str:
    return '"' + str(value or "").replace('"', '""') + '"'


def _connect_with_retry(database_url: str):
    last_error: Exception | None = None
    for attempt in range(1, DEFAULT_ATTEMPTS + 1):
        try:
            return psycopg.connect(
                database_url,
                autocommit=True,
                connect_timeout=DEFAULT_CONNECT_TIMEOUT_SECONDS,
                options="-c timezone=UTC",
            )
        except psycopg.Error as exc:
            last_error = exc
            if attempt == DEFAULT_ATTEMPTS:
                break
            time.sleep(DEFAULT_DELAY_SECONDS)
    raise RuntimeError("PostgreSQL is not reachable for test database preparation.") from last_error


def prepare_test_database() -> None:
    load_environment()
    test_database_url = str(os.environ.get("TEST_DATABASE_URL") or "").strip()
    runtime_database_url = str(os.environ.get("DATABASE_URL") or "").strip()
    maintenance_url = str(os.environ.get("POSTGRES_MAINTENANCE_URL") or "").strip()

    if not test_database_url:
        raise RuntimeError("TEST_DATABASE_URL must be set before running PostgreSQL tests.")
    if runtime_database_url and runtime_database_url == test_database_url:
        raise RuntimeError("TEST_DATABASE_URL must differ from DATABASE_URL.")

    test_database_name = _database_name(test_database_url)
    if not maintenance_url:
        maintenance_url = _with_database(test_database_url, "postgres")

    with _connect_with_retry(maintenance_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT 1 FROM pg_database WHERE datname = %s",
                (test_database_name,),
            )
            if cur.fetchone() is None:
                cur.execute(f"CREATE DATABASE {_quote_ident(test_database_name)}")

    with _connect_with_retry(test_database_url):
        pass


def main() -> int:
    try:
        prepare_test_database()
    except Exception as exc:  # noqa: BLE001 - CLI reports the actionable setup error.
        print(f"failed to prepare PostgreSQL test database: {exc}", file=sys.stderr)
        return 1
    print("PostgreSQL test database is ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
