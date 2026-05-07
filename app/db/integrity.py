from __future__ import annotations

import os

from app.db.connection import database_url as _database_url
from app.db.connection import get_db_connection, resolve_database_identifier, schema_for_database_path
from app.db.schema import APPLICATION_TABLES, table_exists
from app.db_backend import ensure_postgres_schema


def check_database_integrity(database_path=None) -> dict:
    prev_schema = os.environ.get('DATABASE_SCHEMA')
    resolved_identifier = resolve_database_identifier(database_path)
    if resolved_identifier:
        scoped_schema = schema_for_database_path(resolved_identifier)
        ensure_postgres_schema(_database_url(), scoped_schema)
        os.environ['DATABASE_SCHEMA'] = scoped_schema
    conn = get_db_connection()
    try:
        cursor = conn.cursor()
        fk_violations = []
        for table_name in APPLICATION_TABLES:
            if not table_exists(cursor, table_name):
                continue
            rows = cursor.execute(
                '''
                SELECT conname
                FROM pg_constraint
                WHERE conrelid = ?::regclass
                  AND contype = 'f'
                  AND NOT convalidated
                ''',
                (table_name,),
            ).fetchall()
            for row in rows:
                fk_violations.append({'table': table_name, 'constraint': row['conname']})

        return {
            'ok': not fk_violations,
            'database_url': _database_url() or 'postgres',
            'database_path': resolved_identifier or None,
            'integrity_check': ['ok'] if not fk_violations else ['fk_not_validated'],
            'foreign_key_violations': fk_violations,
        }
    finally:
        conn.close()
        if prev_schema is None:
            os.environ.pop('DATABASE_SCHEMA', None)
        else:
            os.environ['DATABASE_SCHEMA'] = prev_schema

