from pathlib import Path
import os
import re
from typing import Any

import psycopg
from psycopg.rows import dict_row

from app.db_backend import (
    CompatRow,
    DatabaseError,
    IntegrityError,
    OperationalError,
    _normalize_db_value,
    _split_sql_statements,
    ensure_postgres_schema,
    rewrite_postgres_sql,
    testing_schema_from_identifier,
)
from app.db.schema import ensure_base_schema


_SCHEMA_BY_KEY: dict[str, str] = {}


def _base_database_url() -> str:
    return str(
        os.environ.get('TEST_DATABASE_URL')
        or os.environ.get('DATABASE_URL')
        or ''
    ).strip()

_AUTOINCREMENT_PK_RE = re.compile(
    r'(?P<prefix>\b[\w"]+\b\s+)INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT\b',
    re.IGNORECASE,
)
_INTEGER_PK_RE = re.compile(
    r'(?P<prefix>\b[\w"]+\b\s+)INTEGER\s+PRIMARY\s+KEY\b',
    re.IGNORECASE,
)
_INSERT_OR_REPLACE_RE = re.compile(r'^\s*INSERT\s+OR\s+REPLACE\s+INTO\s+', re.IGNORECASE)
_DATETIME_NOW_WITH_OFFSET_RE = re.compile(
    r"datetime\s*\(\s*'now'\s*,\s*'([+-]?\d+)\s+(seconds?|minutes?|hours?|days?)'\s*\)",
    re.IGNORECASE,
)
_DATETIME_NOW_RE = re.compile(r"datetime\s*\(\s*'now'\s*\)", re.IGNORECASE)


def _as_db_key(database: Any) -> str:
    if isinstance(database, Path):
        return str(database.resolve())
    text = str(database or '').strip()
    if not text:
        return ':memory:'
    if text == ':memory:':
        return ':memory:'
    try:
        return str(Path(text).resolve())
    except OSError:
        return text


def _schema_for_key(db_key: str) -> str:
    schema = _SCHEMA_BY_KEY.get(db_key)
    if schema:
        return schema
    schema = testing_schema_from_identifier(db_key)
    _SCHEMA_BY_KEY[db_key] = schema
    return schema


def _map_exception(exc: Exception) -> Exception:
    sqlstate = str(getattr(exc, 'sqlstate', '') or '')
    message = str(exc)
    if sqlstate.startswith('23'):
        return IntegrityError(message)
    if sqlstate.startswith(('42', '22', '0A')):
        return OperationalError(message)
    return DatabaseError(message)


def _rewrite_meta_queries(sql: str, params):
    lowered = str(sql or '').strip().lower().rstrip(';')
    if not lowered:
        return None

    pragma_fk_switch = re.match(r'^pragma\s+foreign_keys(?:\s*=\s*(on|off|0|1))?$', lowered)
    if pragma_fk_switch:
        return 'SELECT 1', ()

    pragma_fk_list = re.match(r'^pragma\s+foreign_key_list\(\s*("?[\w]+"?)\s*\)$', lowered)
    if pragma_fk_list:
        table_name = pragma_fk_list.group(1).strip('"')
        return (
            '''
            SELECT
                kcu.ordinal_position AS id,
                kcu.column_name AS "from",
                ccu.table_name AS "table",
                ccu.column_name AS "to"
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON tc.constraint_name = ccu.constraint_name
             AND tc.table_schema = ccu.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = current_schema()
              AND tc.table_name = %s
            ORDER BY kcu.ordinal_position
            ''',
            (table_name,),
        )

    pragma_table_info = re.match(r'^pragma\s+table_info\(\s*("?[\w]+"?)\s*\)$', lowered)
    if pragma_table_info:
        table_name = pragma_table_info.group(1).strip('"')
        return (
            '''
            SELECT
                (ordinal_position - 1) AS cid,
                column_name AS name,
                data_type AS type,
                CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS notnull,
                column_default AS dflt_value,
                0 AS pk
            FROM information_schema.columns
            WHERE table_schema = current_schema()
              AND table_name = %s
            ORDER BY ordinal_position
            ''',
            (table_name,),
        )

    return None


def _rewrite_sql(sql: str, params):
    meta_rewrite = _rewrite_meta_queries(sql, params)
    if meta_rewrite is not None:
        return meta_rewrite

    text = str(sql or '')
    text = _INSERT_OR_REPLACE_RE.sub('INSERT OR IGNORE INTO ', text, count=1)
    rewritten = rewrite_postgres_sql(text)

    def _replace_datetime_with_offset(match):
        amount = int(match.group(1))
        unit = str(match.group(2) or '').lower()
        if unit.endswith('s'):
            unit = unit[:-1]
        sign = '+' if amount >= 0 else '-'
        return f"(CURRENT_TIMESTAMP {sign} INTERVAL '{abs(amount)} {unit}')"

    rewritten = _DATETIME_NOW_WITH_OFFSET_RE.sub(_replace_datetime_with_offset, rewritten)
    rewritten = _DATETIME_NOW_RE.sub('CURRENT_TIMESTAMP', rewritten)
    rewritten = _AUTOINCREMENT_PK_RE.sub(r'\g<prefix>BIGSERIAL PRIMARY KEY', rewritten)
    rewritten = _INTEGER_PK_RE.sub(r'\g<prefix>BIGSERIAL PRIMARY KEY', rewritten)
    rewritten = re.sub(r'\bAUTOINCREMENT\b', '', rewritten, flags=re.IGNORECASE)
    rewritten = re.sub(r'\bDATETIME\b', 'TIMESTAMP', rewritten, flags=re.IGNORECASE)
    if rewritten.lstrip().upper().startswith('CREATE TABLE'):
        rewritten = re.sub(r'\bINTEGER\b', 'BIGINT', rewritten, flags=re.IGNORECASE)
    return rewritten, params


def _to_compat_row(raw_row, description):
    columns = tuple(col.name for col in (description or []))
    values = tuple(_normalize_db_value(raw_row.get(column)) for column in columns)
    return CompatRow(values, columns)


class _PgTestCursor:
    def __init__(self, conn_wrapper, raw_cursor) -> None:
        self._conn_wrapper = conn_wrapper
        self._cursor = raw_cursor
        self._lastrowid = None

    @property
    def rowcount(self):
        return self._cursor.rowcount

    @property
    def lastrowid(self):
        return self._lastrowid

    def execute(self, sql: str, params=()):
        query, mapped_params = _rewrite_sql(sql, params or ())
        try:
            if mapped_params:
                self._cursor.execute(query, mapped_params)
            else:
                self._cursor.execute(query)
            self._lastrowid = None
        except Exception as exc:  # noqa: BLE001
            raise _map_exception(exc) from exc
        return self

    def executemany(self, sql: str, seq_of_params):
        query, _ = _rewrite_sql(sql, ())
        try:
            self._cursor.executemany(query, seq_of_params)
        except Exception as exc:  # noqa: BLE001
            raise _map_exception(exc) from exc
        return self

    def fetchone(self):
        try:
            row = self._cursor.fetchone()
        except Exception as exc:  # noqa: BLE001
            raise _map_exception(exc) from exc
        if row is None:
            return None
        return _to_compat_row(row, self._cursor.description)

    def fetchall(self):
        try:
            rows = self._cursor.fetchall()
        except Exception as exc:  # noqa: BLE001
            raise _map_exception(exc) from exc
        return [_to_compat_row(row, self._cursor.description) for row in rows]

    def close(self):
        self._cursor.close()


class _PgTestConnection:
    def __init__(self, database_url: str, schema: str):
        options = f'-c timezone=UTC -c search_path={schema},public'
        self._conn = psycopg.connect(
            database_url,
            autocommit=False,
            row_factory=dict_row,
            options=options,
            connect_timeout=5,
        )
        try:
            with self._conn.cursor() as bootstrap_cursor:
                bootstrap_cursor.execute('SET SESSION session_replication_role = replica')
            self._conn.commit()
        except Exception:
            try:
                self._conn.rollback()
            except Exception:
                pass

    def cursor(self):
        return _PgTestCursor(self, self._conn.cursor())

    def execute(self, sql: str, params=()):
        cursor = self.cursor()
        return cursor.execute(sql, params)

    def executescript(self, script: str):
        cursor = self.cursor()
        try:
            for statement in _split_sql_statements(script):
                cursor.execute(statement)
        finally:
            cursor.close()

    def commit(self):
        try:
            self._conn.commit()
        except Exception as exc:  # noqa: BLE001
            raise _map_exception(exc) from exc

    def rollback(self):
        try:
            self._conn.rollback()
        except Exception as exc:  # noqa: BLE001
            raise _map_exception(exc) from exc

    def close(self):
        self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        if exc_type is not None:
            try:
                self.rollback()
            except Exception:  # noqa: BLE001
                pass
        self.close()
        return False


def connect_test_db(database):
    """Open a PostgreSQL connection bound to a per-test schema.

    The harness keys schemas off the path-like identifier so each tmp_path
    gets its own isolated namespace; ':memory:' is treated as a single shared
    in-process schema.
    """
    database_url = _base_database_url()
    if not database_url:
        raise RuntimeError('DATABASE_URL is not configured for tests')

    db_key = _as_db_key(database)
    if db_key != ':memory:':
        try:
            placeholder = Path(db_key)
            placeholder.parent.mkdir(parents=True, exist_ok=True)
            placeholder.touch(exist_ok=True)
        except OSError:
            pass
    schema = _schema_for_key(db_key)
    ensure_postgres_schema(database_url, schema)
    connection = _PgTestConnection(database_url, schema)
    if db_key == ':memory:':
        ensure_base_schema(connection)
    return connection
