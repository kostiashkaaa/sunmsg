from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from app.db import backup_restore as _backup_restore
from app.db.connection import (
    database_url as _database_url_impl,
    ensure_chat_exists as _ensure_chat_exists_impl,
    get_db_connection as _get_db_connection_impl,
    resolve_database_identifier as _resolve_database_identifier_impl,
    schema_for_database_path as _schema_for_database_path_impl,
)
from app.db.integrity import check_database_integrity as _check_database_integrity_impl
from app.db.migrations import (
    CHAT_PINS_MULTIPLE_MIGRATION,
    SOCKET_RATE_EVENT_SCOPE_MIGRATION,
    ensure_chat_pins_multiple_support as _ensure_chat_pins_multiple_support_impl,
    run_migrations as _run_migrations_impl,
)
from app.db.schema import (
    APPLICATION_TABLES,
    chat_pins_supports_multiple as _chat_pins_supports_multiple_impl,
    socket_rate_limits_support_event_scope as _socket_rate_limits_support_event_scope_impl,
    table_columns as _table_columns_impl,
    table_exists as _table_exists_impl,
    table_primary_key_columns as _table_primary_key_columns_impl,
)
from app.db_backend import ensure_postgres_schema

logger = logging.getLogger(__name__)

_CHAT_PINS_MULTIPLE_MIGRATION = CHAT_PINS_MULTIPLE_MIGRATION
_SOCKET_RATE_EVENT_SCOPE_MIGRATION = SOCKET_RATE_EVENT_SCOPE_MIGRATION
_APPLICATION_TABLES = APPLICATION_TABLES


def _database_url() -> str:
    return _database_url_impl()


def get_db_connection(*, request_scoped: bool = True):
    return _get_db_connection_impl(request_scoped=request_scoped)


def ensure_chat_exists(conn, chat_id: str, *, chat_name: str = 'New Chat') -> None:
    _ensure_chat_exists_impl(conn, chat_id, chat_name=chat_name)


def check_database_integrity(database_path=None) -> dict:
    return _check_database_integrity_impl(database_path)


def ensure_chat_pins_multiple_support(*, force: bool = False) -> None:
    _ensure_chat_pins_multiple_support_impl(force=force)


def run_migrations() -> None:
    _run_migrations_impl()


def _resolve_database_identifier(database_path) -> str:
    return _resolve_database_identifier_impl(database_path)


def _schema_for_database_path(database_path) -> str:
    return _schema_for_database_path_impl(database_path)


def _quote_ident(value: str) -> str:
    return _backup_restore.quote_ident(value)


def _safe_label(value: str | None) -> str:
    return _backup_restore.safe_label(value)


def _backup_stamp() -> str:
    return _backup_restore.backup_stamp()


def _table_exists(cursor, table_name: str) -> bool:
    return _table_exists_impl(cursor, table_name)


def _table_columns(cursor, table_name: str) -> set[str]:
    return _table_columns_impl(cursor, table_name)


def _table_primary_key_columns(cursor, table_name: str) -> list[str]:
    return _table_primary_key_columns_impl(cursor, table_name)


def _chat_pins_supports_multiple(cursor) -> bool:
    return _chat_pins_supports_multiple_impl(cursor)


def _socket_rate_limits_support_event_scope(cursor) -> bool:
    return _socket_rate_limits_support_event_scope_impl(cursor)


def _resolve_pg_tool(env_name: str, default_name: str) -> str:
    return _backup_restore.resolve_pg_tool(env_name, default_name)


def _postgres_tool_env(database_url: str) -> tuple[dict[str, str], str, str]:
    return _backup_restore.postgres_tool_env(database_url)


def _run_postgres_tool(command: list[str], *, env: dict[str, str], tool_name: str) -> None:
    completed = subprocess.run(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        encoding='utf-8',
        errors='replace',
        env=env,
        check=False,
    )
    if completed.returncode == 0:
        return

    stderr = str(completed.stderr or '').strip()
    stdout = str(completed.stdout or '').strip()
    detail = stderr or stdout or f'exit code {completed.returncode}'
    raise RuntimeError(f'{tool_name} failed: {detail}')


def validate_postgres_backup_tools() -> dict[str, str]:
    return _backup_restore.validate_postgres_backup_tools(
        resolve_pg_tool_func=_resolve_pg_tool,
    )


def _create_pg_dump_backup(
    database_url: str,
    *,
    backup_dir: str,
    label: str | None,
) -> str:
    return _backup_restore._create_pg_dump_backup(
        database_url,
        backup_dir=backup_dir,
        label=label,
        backup_stamp_func=_backup_stamp,
        safe_label_func=_safe_label,
        resolve_pg_tool_func=_resolve_pg_tool,
        postgres_tool_env_func=_postgres_tool_env,
        run_postgres_tool_func=_run_postgres_tool,
    )


def _create_schema_reference_backup(database_path, *, backup_dir: str, label: str | None) -> str:
    return _backup_restore._create_schema_reference_backup(
        database_path,
        backup_dir=backup_dir,
        label=label,
        database_url=_database_url(),
        resolve_database_identifier_func=_resolve_database_identifier,
        schema_for_database_path_func=_schema_for_database_path,
        ensure_postgres_schema_func=ensure_postgres_schema,
        backup_stamp_func=_backup_stamp,
        safe_label_func=_safe_label,
    )


def create_database_backup(database_path=None, *, backup_dir='backups', label=None):
    return _backup_restore.create_database_backup(
        database_path,
        backup_dir=backup_dir,
        label=label,
        database_url_func=_database_url,
        resolve_database_identifier_func=_resolve_database_identifier,
        schema_for_database_path_func=_schema_for_database_path,
        ensure_postgres_schema_func=ensure_postgres_schema,
        backup_stamp_func=_backup_stamp,
        safe_label_func=_safe_label,
        resolve_pg_tool_func=_resolve_pg_tool,
        postgres_tool_env_func=_postgres_tool_env,
        run_postgres_tool_func=_run_postgres_tool,
    )


def _copy_schema(source_schema: str, target_schema: str) -> None:
    _backup_restore._copy_schema(
        source_schema,
        target_schema,
        database_url=_database_url(),
        quote_ident_func=_quote_ident,
    )


def _restore_schema_reference_backup(payload: dict, backup_path, *, target_path=None) -> None:
    _backup_restore._restore_schema_reference_backup(
        payload,
        backup_path,
        target_path=target_path,
        database_url=_database_url(),
        resolve_database_identifier_func=_resolve_database_identifier,
        schema_for_database_path_func=_schema_for_database_path,
        ensure_postgres_schema_func=ensure_postgres_schema,
        quote_ident_func=_quote_ident,
    )


def _restore_pg_dump_backup(backup_file: Path, *, database_url: str) -> None:
    _backup_restore._restore_pg_dump_backup(
        backup_file,
        database_url=database_url,
        resolve_pg_tool_func=_resolve_pg_tool,
        postgres_tool_env_func=_postgres_tool_env,
        run_postgres_tool_func=_run_postgres_tool,
    )


def restore_database_backup(backup_path, *, target_path=None):
    return _backup_restore.restore_database_backup(
        backup_path,
        target_path=target_path,
        database_url_func=_database_url,
        resolve_database_identifier_func=_resolve_database_identifier,
        schema_for_database_path_func=_schema_for_database_path,
        ensure_postgres_schema_func=ensure_postgres_schema,
        resolve_pg_tool_func=_resolve_pg_tool,
        postgres_tool_env_func=_postgres_tool_env,
        run_postgres_tool_func=_run_postgres_tool,
        quote_ident_func=_quote_ident,
    )
