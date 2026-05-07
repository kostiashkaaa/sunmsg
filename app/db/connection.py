from __future__ import annotations

import os
from pathlib import Path

from flask import current_app, has_app_context

from app.db_backend import connect_postgres, testing_schema_from_identifier


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


def get_db_connection():
    current_database_url = database_url()
    if not current_database_url:
        raise RuntimeError('DATABASE_URL must be set')
    schema_name = None
    if has_app_context():
        resolved_schema = str(current_app.config.get('DATABASE_SCHEMA') or '').strip()
        if resolved_schema:
            schema_name = resolved_schema
    return connect_postgres(current_database_url, schema_name=schema_name)


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
