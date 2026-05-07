from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from app.db.connection import database_url as _database_url
from app.db.connection import resolve_database_identifier, schema_for_database_path
from app.db_backend import ensure_postgres_schema


def quote_ident(value: str) -> str:
    return '"' + str(value or '').replace('"', '""') + '"'


def safe_label(value: str | None) -> str:
    return re.sub(r'[^a-z0-9._-]+', '-', str(value or 'backup').strip().lower()).strip('-') or 'backup'


def backup_stamp() -> str:
    return datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')


def resolve_pg_tool(env_name: str, default_name: str) -> str:
    configured = str(os.environ.get(env_name) or '').strip()
    candidate = configured or default_name
    if os.path.isabs(candidate):
        if os.path.exists(candidate):
            return candidate
        raise RuntimeError(f'{default_name} executable not found: {candidate}')

    resolved = shutil.which(candidate)
    if resolved:
        return resolved
    raise RuntimeError(
        f'{default_name} executable not found in PATH. '
        f'Set {env_name} to the absolute executable path.'
    )


def postgres_tool_env(database_url: str) -> tuple[dict[str, str], str, str]:
    env = os.environ.copy()
    parsed = urlparse(str(database_url or '').strip())
    if parsed.scheme.lower() not in {'postgres', 'postgresql'} or not parsed.path:
        return env, '', str(database_url or '').strip()

    database_name = unquote(parsed.path.lstrip('/'))
    if parsed.hostname:
        env['PGHOST'] = parsed.hostname
    if parsed.port:
        env['PGPORT'] = str(parsed.port)
    if database_name:
        env['PGDATABASE'] = database_name
    if parsed.username:
        env['PGUSER'] = unquote(parsed.username)
    if parsed.password:
        env['PGPASSWORD'] = unquote(parsed.password)

    query = parse_qs(parsed.query or '')
    sslmode = (query.get('sslmode') or [''])[0]
    if sslmode:
        env['PGSSLMODE'] = sslmode

    return env, database_name, ''


def run_postgres_tool(command: list[str], *, env: dict[str, str], tool_name: str) -> None:
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


def validate_postgres_backup_tools(*, resolve_pg_tool_func=resolve_pg_tool) -> dict[str, str]:
    return {
        'pg_dump': resolve_pg_tool_func('PG_DUMP_PATH', 'pg_dump'),
        'pg_restore': resolve_pg_tool_func('PG_RESTORE_PATH', 'pg_restore'),
    }


def create_database_backup(
    database_path=None,
    *,
    backup_dir='backups',
    label=None,
    database_url_func=_database_url,
    resolve_database_identifier_func=resolve_database_identifier,
    schema_for_database_path_func=schema_for_database_path,
    ensure_postgres_schema_func=ensure_postgres_schema,
    backup_stamp_func=backup_stamp,
    safe_label_func=safe_label,
    resolve_pg_tool_func=resolve_pg_tool,
    postgres_tool_env_func=postgres_tool_env,
    run_postgres_tool_func=run_postgres_tool,
) -> str:
    current_database_url = database_url_func()
    if not current_database_url:
        raise RuntimeError('DATABASE_URL must be set')

    if database_path:
        return _create_schema_reference_backup(
            database_path,
            backup_dir=backup_dir,
            label=label,
            database_url=current_database_url,
            resolve_database_identifier_func=resolve_database_identifier_func,
            schema_for_database_path_func=schema_for_database_path_func,
            ensure_postgres_schema_func=ensure_postgres_schema_func,
            backup_stamp_func=backup_stamp_func,
            safe_label_func=safe_label_func,
        )

    return _create_pg_dump_backup(
        current_database_url,
        backup_dir=backup_dir,
        label=label,
        backup_stamp_func=backup_stamp_func,
        safe_label_func=safe_label_func,
        resolve_pg_tool_func=resolve_pg_tool_func,
        postgres_tool_env_func=postgres_tool_env_func,
        run_postgres_tool_func=run_postgres_tool_func,
    )


def restore_database_backup(
    backup_path,
    *,
    target_path=None,
    database_url_func=_database_url,
    resolve_database_identifier_func=resolve_database_identifier,
    schema_for_database_path_func=schema_for_database_path,
    ensure_postgres_schema_func=ensure_postgres_schema,
    resolve_pg_tool_func=resolve_pg_tool,
    postgres_tool_env_func=postgres_tool_env,
    run_postgres_tool_func=run_postgres_tool,
    quote_ident_func=quote_ident,
) -> None:
    current_database_url = database_url_func()
    if not current_database_url:
        raise RuntimeError('DATABASE_URL must be set')

    backup_file = Path(str(backup_path or '')).resolve()
    payload = {}
    if backup_file.is_file():
        try:
            payload = json.loads(backup_file.read_text(encoding='utf-8') or '{}')
        except json.JSONDecodeError:
            payload = {}
    elif not resolve_database_identifier_func(backup_path):
        raise RuntimeError(f'Backup file not found: {backup_file}')

    if payload.get('kind') == 'postgres_schema_reference_backup' or target_path:
        _restore_schema_reference_backup(
            payload,
            backup_path,
            target_path=target_path,
            database_url=current_database_url,
            resolve_database_identifier_func=resolve_database_identifier_func,
            schema_for_database_path_func=schema_for_database_path_func,
            ensure_postgres_schema_func=ensure_postgres_schema_func,
            quote_ident_func=quote_ident_func,
        )
        return

    if not backup_file.is_file():
        raise RuntimeError(f'Backup file not found: {backup_file}')

    _restore_pg_dump_backup(
        backup_file,
        database_url=current_database_url,
        resolve_pg_tool_func=resolve_pg_tool_func,
        postgres_tool_env_func=postgres_tool_env_func,
        run_postgres_tool_func=run_postgres_tool_func,
    )


def _create_pg_dump_backup(
    database_url: str,
    *,
    backup_dir: str,
    label: str | None,
    backup_stamp_func,
    safe_label_func,
    resolve_pg_tool_func,
    postgres_tool_env_func,
    run_postgres_tool_func,
) -> str:
    dump_executable = resolve_pg_tool_func('PG_DUMP_PATH', 'pg_dump')
    env, database_name, raw_dsn = postgres_tool_env_func(database_url)

    root = Path(str(backup_dir or 'backups')).resolve()
    root.mkdir(parents=True, exist_ok=True)
    backup_path = root / f'{backup_stamp_func()}_{safe_label_func(label)}.dump'

    command = [
        dump_executable,
        '--format=custom',
        '--no-owner',
        '--no-acl',
        '--file',
        str(backup_path),
    ]
    database_schema = str(os.environ.get('DATABASE_SCHEMA') or '').strip()
    if database_schema:
        command.extend(['--schema', database_schema])
    if database_name:
        command.extend(['--dbname', database_name])
    elif raw_dsn:
        command.extend(['--dbname', raw_dsn])

    run_postgres_tool_func(command, env=env, tool_name='pg_dump')
    return str(backup_path)


def _create_schema_reference_backup(
    database_path,
    *,
    backup_dir: str,
    label: str | None,
    database_url: str,
    resolve_database_identifier_func,
    schema_for_database_path_func,
    ensure_postgres_schema_func,
    backup_stamp_func,
    safe_label_func,
) -> str:
    source_schema = schema_for_database_path_func(database_path)
    ensure_postgres_schema_func(database_url, source_schema)
    root = Path(str(backup_dir or 'backups')).resolve()
    root.mkdir(parents=True, exist_ok=True)
    backup_path = root / f'{backup_stamp_func()}_{safe_label_func(label)}.json'
    payload = {
        'kind': 'postgres_schema_reference_backup',
        'source_schema': source_schema,
        'source_identifier': resolve_database_identifier_func(database_path),
        'created_at': datetime.now(timezone.utc).isoformat(),
    }
    backup_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding='utf-8')
    return str(backup_path)


def _copy_schema(source_schema: str, target_schema: str, *, database_url: str, quote_ident_func) -> None:
    import psycopg

    source_ident = quote_ident_func(source_schema)
    target_ident = quote_ident_func(target_schema)

    with psycopg.connect(database_url, autocommit=True, options='-c timezone=UTC') as raw_conn:
        with raw_conn.cursor() as cursor:
            cursor.execute(f'DROP SCHEMA IF EXISTS {target_ident} CASCADE')
            cursor.execute(f'CREATE SCHEMA {target_ident}')
            cursor.execute(
                '''
                SELECT tablename
                FROM pg_tables
                WHERE schemaname = %s
                ORDER BY tablename
                ''',
                (source_schema,),
            )
            table_names = [str(row[0]) for row in cursor.fetchall()]
            for table_name in table_names:
                table_ident = quote_ident_func(table_name)
                cursor.execute(
                    f'CREATE TABLE {target_ident}.{table_ident} '
                    f'(LIKE {source_ident}.{table_ident} INCLUDING ALL)'
                )
            for table_name in table_names:
                table_ident = quote_ident_func(table_name)
                cursor.execute(
                    f'INSERT INTO {target_ident}.{table_ident} '
                    f'SELECT * FROM {source_ident}.{table_ident}'
                )


def _restore_schema_reference_backup(
    payload: dict,
    backup_path,
    *,
    target_path=None,
    database_url: str,
    resolve_database_identifier_func,
    schema_for_database_path_func,
    ensure_postgres_schema_func,
    quote_ident_func,
) -> None:
    source_identifier_fallback = resolve_database_identifier_func(backup_path)
    source_schema = str(payload.get('source_schema') or '').strip()
    if not source_schema:
        source_schema = schema_for_database_path_func(source_identifier_fallback)

    target_identifier = resolve_database_identifier_func(target_path)
    if not target_identifier:
        target_identifier = str(payload.get('source_identifier') or '').strip()
    target_schema = schema_for_database_path_func(target_identifier)
    ensure_postgres_schema_func(database_url, source_schema)
    _copy_schema(
        source_schema,
        target_schema,
        database_url=database_url,
        quote_ident_func=quote_ident_func,
    )

    if target_identifier and target_identifier != ':memory:':
        try:
            target_file = Path(target_identifier)
            target_file.parent.mkdir(parents=True, exist_ok=True)
            target_file.touch(exist_ok=True)
        except OSError:
            pass


def _restore_pg_dump_backup(
    backup_file: Path,
    *,
    database_url: str,
    resolve_pg_tool_func,
    postgres_tool_env_func,
    run_postgres_tool_func,
) -> None:
    restore_executable = resolve_pg_tool_func('PG_RESTORE_PATH', 'pg_restore')
    env, database_name, raw_dsn = postgres_tool_env_func(database_url)
    command = [
        restore_executable,
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-acl',
    ]
    if database_name:
        command.extend(['--dbname', database_name])
    elif raw_dsn:
        command.extend(['--dbname', raw_dsn])
    command.append(str(backup_file))
    run_postgres_tool_func(command, env=env, tool_name='pg_restore')

