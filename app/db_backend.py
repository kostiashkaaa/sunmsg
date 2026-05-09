from __future__ import annotations

import hashlib
import os
import re
from time import perf_counter
from collections.abc import Iterable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timezone
from typing import Any

from app.db.sql_profile import profile_sql_query

BEGIN_IMMEDIATE_RE = re.compile(r'^\s*BEGIN\s+IMMEDIATE\s*;?\s*$', re.IGNORECASE)
INSERT_OR_IGNORE_RE = re.compile(r'^\s*INSERT\s+OR\s+IGNORE\s+INTO\s+', re.IGNORECASE)
ON_CONFLICT_RE = re.compile(r'\bON\s+CONFLICT\b', re.IGNORECASE)


class DatabaseError(Exception):
    pass


class IntegrityError(DatabaseError):
    pass


class OperationalError(DatabaseError):
    pass


@dataclass(frozen=True)
class CompatRow:
    values: tuple[Any, ...]
    columns: tuple[str, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, '_map', {name: self.values[idx] for idx, name in enumerate(self.columns)})

    def __getitem__(self, key):
        if isinstance(key, int):
            return self.values[key]
        return self._map[key]

    def __iter__(self):
        return iter(self.values)

    def __len__(self) -> int:
        return len(self.values)

    def keys(self):
        return list(self.columns)

    def get(self, key, default=None):
        return self._map.get(key, default)


def _normalize_db_value(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.tzinfo is not None:
            value = value.astimezone(timezone.utc).replace(tzinfo=None)
        return value.strftime('%Y-%m-%d %H:%M:%S')
    if isinstance(value, date):
        return value.strftime('%Y-%m-%d')
    if isinstance(value, time):
        if value.tzinfo is not None:
            value = value.replace(tzinfo=None)
        return value.strftime('%H:%M:%S')
    return value


def _raise_database_compatible_error(exc: Exception) -> None:
    sqlstate = str(getattr(exc, 'sqlstate', '') or '')
    if sqlstate.startswith('23'):
        raise IntegrityError(str(exc)) from exc
    if sqlstate.startswith(('42', '22')):
        raise OperationalError(str(exc)) from exc
    raise DatabaseError(str(exc)) from exc


def testing_schema_from_identifier(identifier: str) -> str:
    normalized = str(identifier or '').strip().lower() or 'default'
    schema_salt = str(os.environ.get('TEST_SCHEMA_SALT') or '').strip().lower()
    if schema_salt:
        normalized = f'{schema_salt}:{normalized}'
    digest = hashlib.sha1(normalized.encode('utf-8')).hexdigest()[:16]
    return f'test_{digest}'


def ensure_postgres_schema(database_url: str, schema_name: str) -> None:
    schema = str(schema_name or '').strip()
    if not schema:
        return
    dsn = str(database_url or '').strip()
    if not dsn:
        return

    try:
        import psycopg
    except ImportError:
        return

    with psycopg.connect(dsn, autocommit=True, options='-c timezone=UTC', connect_timeout=5) as raw_conn:
        with raw_conn.cursor() as cur:
            cur.execute(f'CREATE SCHEMA IF NOT EXISTS "{schema}"')


def _replace_qmark_params(sql: str) -> str:
    result: list[str] = []
    in_single = False
    in_double = False
    index = 0
    length = len(sql)

    while index < length:
        char = sql[index]

        if char == "'" and not in_double:
            result.append(char)
            if in_single and index + 1 < length and sql[index + 1] == "'":
                result.append("'")
                index += 2
                continue
            in_single = not in_single
            index += 1
            continue

        if char == '"' and not in_single:
            in_double = not in_double
            result.append(char)
            index += 1
            continue

        if char == '?' and not in_single and not in_double:
            result.append('%s')
        else:
            result.append(char)
        index += 1

    return ''.join(result)


def _append_on_conflict_do_nothing(sql: str) -> str:
    if ON_CONFLICT_RE.search(sql):
        return sql

    stripped = sql.rstrip()
    suffix = ''
    if stripped.endswith(';'):
        stripped = stripped[:-1].rstrip()
        suffix = ';'

    return f'{stripped} ON CONFLICT DO NOTHING{suffix}'


def rewrite_postgres_sql(sql: str) -> str:
    text = str(sql or '')
    if not text:
        return text

    if BEGIN_IMMEDIATE_RE.match(text):
        return 'BEGIN'

    rewritten = _replace_qmark_params(text)

    if INSERT_OR_IGNORE_RE.match(rewritten):
        rewritten = INSERT_OR_IGNORE_RE.sub('INSERT INTO ', rewritten, count=1)
        rewritten = _append_on_conflict_do_nothing(rewritten)

    return rewritten


def _split_sql_statements(script: str) -> list[str]:
    statements: list[str] = []
    current: list[str] = []
    in_single = False
    in_double = False
    index = 0
    length = len(script)

    while index < length:
        char = script[index]

        if char == "'" and not in_double:
            current.append(char)
            if in_single and index + 1 < length and script[index + 1] == "'":
                current.append("'")
                index += 2
                continue
            in_single = not in_single
            index += 1
            continue

        if char == '"' and not in_single:
            in_double = not in_double
            current.append(char)
            index += 1
            continue

        if char == ';' and not in_single and not in_double:
            statement = ''.join(current).strip()
            if statement:
                statements.append(statement)
            current = []
            index += 1
            continue

        current.append(char)
        index += 1

    tail = ''.join(current).strip()
    if tail:
        statements.append(tail)
    return statements


class PostgresCursorAdapter:
    def __init__(self, cursor) -> None:
        self._cursor = cursor

    @property
    def rowcount(self):
        return self._cursor.rowcount

    @property
    def description(self):
        return self._cursor.description

    def execute(self, query: str, params: Sequence[Any] | None = None):
        sql = rewrite_postgres_sql(query)
        started_at = perf_counter()
        try:
            if params is None:
                self._cursor.execute(sql)
            else:
                self._cursor.execute(sql, params)
        except Exception as exc:
            duration_ms = (perf_counter() - started_at) * 1000.0
            profile_sql_query(
                query=sql,
                duration_ms=duration_ms,
                params_count=len(params) if params is not None else 0,
                rowcount=getattr(self._cursor, 'rowcount', None),
                ok=False,
            )
            _raise_database_compatible_error(exc)
        duration_ms = (perf_counter() - started_at) * 1000.0
        profile_sql_query(
            query=sql,
            duration_ms=duration_ms,
            params_count=len(params) if params is not None else 0,
            rowcount=getattr(self._cursor, 'rowcount', None),
            ok=True,
        )
        return self

    def executemany(self, query: str, seq_of_params: Iterable[Sequence[Any]]):
        sql = rewrite_postgres_sql(query)
        started_at = perf_counter()
        try:
            self._cursor.executemany(sql, seq_of_params)
        except Exception as exc:
            duration_ms = (perf_counter() - started_at) * 1000.0
            profile_sql_query(
                query=sql,
                duration_ms=duration_ms,
                params_count=0,
                rowcount=getattr(self._cursor, 'rowcount', None),
                ok=False,
            )
            _raise_database_compatible_error(exc)
        duration_ms = (perf_counter() - started_at) * 1000.0
        profile_sql_query(
            query=sql,
            duration_ms=duration_ms,
            params_count=0,
            rowcount=getattr(self._cursor, 'rowcount', None),
            ok=True,
        )
        return self

    def fetchone(self):
        try:
            row = self._cursor.fetchone()
        except Exception as exc:
            _raise_database_compatible_error(exc)

        if row is None:
            return None

        columns = tuple(column.name for column in self._cursor.description or [])
        return CompatRow(tuple(_normalize_db_value(value) for value in row), columns)

    def fetchall(self):
        try:
            rows = self._cursor.fetchall()
        except Exception as exc:
            _raise_database_compatible_error(exc)

        columns = tuple(column.name for column in self._cursor.description or [])
        return [
            CompatRow(tuple(_normalize_db_value(value) for value in row), columns)
            for row in rows
        ]

    def fetchmany(self, size: int | None = None):
        try:
            rows = self._cursor.fetchmany(size) if size is not None else self._cursor.fetchmany()
        except Exception as exc:
            _raise_database_compatible_error(exc)

        columns = tuple(column.name for column in self._cursor.description or [])
        return [
            CompatRow(tuple(_normalize_db_value(value) for value in row), columns)
            for row in rows
        ]

    def __iter__(self):
        for row in self.fetchall():
            yield row

    def close(self):
        self._cursor.close()


class PostgresConnectionAdapter:
    def __init__(self, connection) -> None:
        self._connection = connection

    def cursor(self):
        try:
            cursor = self._connection.cursor()
        except Exception as exc:
            _raise_database_compatible_error(exc)
        return PostgresCursorAdapter(cursor)

    def execute(self, query: str, params: Sequence[Any] | None = None):
        cursor = self.cursor()
        return cursor.execute(query, params)

    def executescript(self, script: str):
        cursor = self.cursor()
        try:
            for statement in _split_sql_statements(script):
                cursor.execute(statement)
        finally:
            cursor.close()

    def commit(self):
        try:
            self._connection.commit()
        except Exception as exc:
            _raise_database_compatible_error(exc)

    def rollback(self):
        try:
            self._connection.rollback()
        except Exception as exc:
            _raise_database_compatible_error(exc)

    def close(self):
        self._connection.close()


def connect_postgres(database_url: str, *, schema_name: str | None = None):
    connection = connect_postgres_raw(database_url, schema_name=schema_name)
    return PostgresConnectionAdapter(connection)


def connect_postgres_raw(database_url: str, *, schema_name: str | None = None):
    try:
        import psycopg
    except ImportError as exc:
        raise RuntimeError(
            'PostgreSQL runtime requires psycopg. Install dependencies from requirements.txt.'
        ) from exc

    if not str(database_url or '').strip():
        raise RuntimeError('DATABASE_URL must be set for PostgreSQL runtime')

    options = ['-c timezone=UTC']
    if schema_name is None:
        database_schema = str(os.environ.get('DATABASE_SCHEMA') or '').strip()
    else:
        database_schema = str(schema_name or '').strip()
    if database_schema:
        options.insert(0, f'-c search_path={database_schema},public')

    connection = psycopg.connect(
        str(database_url),
        autocommit=False,
        options=' '.join(options),
        connect_timeout=5,
    )
    return connection
