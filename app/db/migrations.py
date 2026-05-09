from __future__ import annotations

import logging
import threading

from flask import current_app, has_app_context

from app.db.connection import database_url, get_db_connection
from app.db.schema import (
    chat_pins_supports_multiple,
    ensure_base_schema,
    socket_rate_limits_support_event_scope,
    table_columns,
)
from app.services.favorites_chat import ensure_saved_messages_chat

logger = logging.getLogger(__name__)

CHAT_PINS_MULTIPLE_MIGRATION = (5, 'allow_multiple_pinned_messages_per_chat')
SOCKET_RATE_EVENT_SCOPE_MIGRATION = (6, 'socket_rate_limits_per_event_scope')
SAVED_MESSAGES_CHAT_BACKFILL_MIGRATION = (7, 'backfill_saved_messages_chats')
PUSH_SUBSCRIPTIONS_MIGRATION = (8, 'create_push_subscriptions_table')
MODERATION_CORE_MIGRATION = (9, 'create_moderation_core_tables')
MODERATION_QUEUE_MIGRATION = (10, 'create_moderation_jobs_table')
GROUP_CHATS_SCHEMA_MIGRATION = (11, 'introduce_group_chats_membership_and_receipts')
MODERATION_RBAC_MIGRATION = (12, 'create_moderation_user_roles_table')
GROUP_CHAT_PROFILE_FIELDS_MIGRATION = (13, 'add_group_chat_profile_fields')
GROUP_CHAT_OWNER_ROLE_MIGRATION = (14, 'backfill_group_owner_role')
SUPPORT_REQUESTS_MIGRATION = (15, 'create_support_requests_table')
USER_PROFILE_NORMALIZATION_MIGRATION = (16, 'normalize_user_profile_defaults')

_chat_pins_schema_lock = threading.Lock()
_chat_pins_schema_checked = False
_migrations_run_lock = threading.Lock()
_migrations_run_cache_keys: set[str] = set()


def _migration_cache_key() -> str:
    db_url = str(database_url() or '').strip()
    schema_name = ''
    if has_app_context():
        schema_name = str(current_app.config.get('DATABASE_SCHEMA') or '').strip()
    return f'{db_url}|{schema_name}'


def _should_use_migration_cache() -> bool:
    if not has_app_context():
        return False
    # Keep tests deterministic: always execute full migration flow in TESTING mode.
    return not bool(current_app.config.get('TESTING'))


def add_column_if_missing(conn, cursor, table_name: str, column_name: str, ddl: str) -> None:
    if column_name in table_columns(cursor, table_name):
        return
    safe_table = '"{}"'.format(table_name.replace('"', '""'))
    cursor.execute(f'ALTER TABLE {safe_table} ADD COLUMN {ddl}')
    conn.commit()
    logger.info('Migration: added %s to %s', column_name, table_name)


def drop_not_null_if_set(conn, cursor, table_name: str, column_name: str) -> None:
    row = cursor.execute(
        '''
        SELECT is_nullable
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = ?
          AND column_name = ?
        ''',
        (table_name, column_name),
    ).fetchone()
    if not row:
        return
    if str(row['is_nullable'] or '').upper() == 'YES':
        return

    safe_table = '"{}"'.format(table_name.replace('"', '""'))
    safe_column = '"{}"'.format(column_name.replace('"', '""'))
    cursor.execute(f'ALTER TABLE {safe_table} ALTER COLUMN {safe_column} DROP NOT NULL')
    conn.commit()
    logger.info('Migration: dropped NOT NULL for %s.%s', table_name, column_name)


def ensure_chat_pins_multiple_support(*, force: bool = False) -> None:
    global _chat_pins_schema_checked

    if _chat_pins_schema_checked and not force:
        return

    with _chat_pins_schema_lock:
        if _chat_pins_schema_checked and not force:
            return

        conn = get_db_connection()
        try:
            ensure_base_schema(conn)
            cursor = conn.cursor()
            if not chat_pins_supports_multiple(cursor):
                raise RuntimeError('chat_pins primary key shape mismatch; expected (chat_id, message_id)')
            cursor.execute(
                '''
                INSERT INTO schema_migrations (version, name)
                VALUES (?, ?)
                ON CONFLICT(version) DO NOTHING
                ''',
                CHAT_PINS_MULTIPLE_MIGRATION,
            )
            conn.commit()
            _chat_pins_schema_checked = True
        finally:
            conn.close()


def migration_applied(cursor, version: int) -> bool:
    row = cursor.execute(
        '''
        SELECT 1
        FROM schema_migrations
        WHERE version = ?
        ''',
        (version,),
    ).fetchone()
    return row is not None


def backfill_saved_messages_chats(conn, cursor) -> int:
    users = cursor.execute(
        '''
        SELECT id, public_key
        FROM users
        WHERE COALESCE(public_key, '') <> ''
        '''
    ).fetchall()
    updated_count = 0
    for user in users:
        chat_id = ensure_saved_messages_chat(
            conn,
            user_id=int(user['id']),
            public_key=str(user['public_key'] or ''),
        )
        if chat_id:
            updated_count += 1
    return updated_count


def backfill_chat_members(conn, cursor) -> None:
    cursor.execute(
        '''
        INSERT INTO chat_members (user_id, chat_id, role)
        SELECT DISTINCT c.user_id, c.chat_id, 'member'
        FROM contacts c
        ON CONFLICT(user_id, chat_id) DO NOTHING
        '''
    )
    cursor.execute(
        '''
        INSERT INTO chat_members (user_id, chat_id, role)
        SELECT DISTINCT m.sender_id, m.chat_id, 'member'
        FROM messages m
        ON CONFLICT(user_id, chat_id) DO NOTHING
        '''
    )
    cursor.execute(
        '''
        INSERT INTO chat_members (user_id, chat_id, role)
        SELECT DISTINCT m.receiver_id, m.chat_id, 'member'
        FROM messages m
        WHERE m.receiver_id IS NOT NULL
        ON CONFLICT(user_id, chat_id) DO NOTHING
        '''
    )
    cursor.execute(
        '''
        WITH member_counts AS (
            SELECT chat_id, COUNT(DISTINCT user_id) AS members_count
            FROM chat_members
            GROUP BY chat_id
        )
        UPDATE chats AS ch
        SET chat_type = CASE
            WHEN COALESCE(mc.members_count, 0) > 2 THEN 'group'
            ELSE 'direct'
        END
        FROM member_counts mc
        WHERE ch.chat_id = mc.chat_id
        '''
    )
    cursor.execute(
        '''
        UPDATE chats
        SET created_by_user_id = (
            SELECT MIN(cm.user_id)
            FROM chat_members cm
            WHERE cm.chat_id = chats.chat_id
        )
        WHERE created_by_user_id IS NULL
        '''
    )


def backfill_message_receipts(conn, cursor) -> None:
    cursor.execute(
        '''
        INSERT INTO message_receipts (
            message_id,
            user_id,
            is_delivered,
            delivered_at,
            is_read,
            read_at,
            voice_listened,
            deleted_for_user,
            updated_at
        )
        SELECT
            m.id,
            m.sender_id,
            1,
            COALESCE(m.read_at, m.created_at),
            1,
            COALESCE(m.read_at, m.created_at),
            0,
            COALESCE(m.deleted_by_sender, 0),
            CURRENT_TIMESTAMP
        FROM messages m
        ON CONFLICT(message_id, user_id) DO NOTHING
        '''
    )


def backfill_group_owner_roles(conn, cursor) -> None:
    cursor.execute(
        '''
        UPDATE chat_members AS cm
        SET role = 'owner'
        FROM chats ch
        WHERE ch.chat_id = cm.chat_id
          AND ch.chat_type = 'group'
          AND ch.created_by_user_id = cm.user_id
          AND LOWER(COALESCE(cm.role, '')) = 'admin'
        '''
    )
    cursor.execute(
        '''
        UPDATE chat_members
        SET role = 'member'
        WHERE LOWER(COALESCE(role, '')) NOT IN ('owner', 'admin', 'moderator', 'member')
        '''
    )
    cursor.execute(
        '''
        INSERT INTO message_receipts (
            message_id,
            user_id,
            is_delivered,
            delivered_at,
            is_read,
            read_at,
            voice_listened,
            deleted_for_user,
            updated_at
        )
        SELECT
            m.id,
            m.receiver_id,
            COALESCE(m.is_delivered, 0),
            CASE
                WHEN COALESCE(m.is_delivered, 0) = 1 THEN COALESCE(m.read_at, m.created_at)
                ELSE NULL
            END,
            COALESCE(m.is_read, 0),
            m.read_at,
            COALESCE(m.voice_listened_by_receiver, 0),
            COALESCE(m.deleted_by_receiver, 0),
            CURRENT_TIMESTAMP
        FROM messages m
        WHERE m.receiver_id IS NOT NULL
        ON CONFLICT(message_id, user_id) DO NOTHING
        '''
    )


def run_migrations() -> None:
    global _chat_pins_schema_checked

    cache_key = _migration_cache_key()
    use_cache = _should_use_migration_cache() and bool(cache_key)
    if use_cache:
        with _migrations_run_lock:
            if cache_key in _migrations_run_cache_keys:
                return

    conn = get_db_connection()
    try:
        ensure_base_schema(conn)
        cursor = conn.cursor()

        add_column_if_missing(conn, cursor, 'messages', 'is_edited', 'is_edited INTEGER DEFAULT 0')
        add_column_if_missing(conn, cursor, 'messages', 'message_type', "message_type TEXT DEFAULT 'text'")
        add_column_if_missing(conn, cursor, 'messages', 'deleted_by_sender', 'deleted_by_sender INTEGER DEFAULT 0')
        add_column_if_missing(conn, cursor, 'messages', 'deleted_by_receiver', 'deleted_by_receiver INTEGER DEFAULT 0')
        add_column_if_missing(conn, cursor, 'messages', 'reply_to_id', 'reply_to_id BIGINT')
        add_column_if_missing(conn, cursor, 'messages', 'forward_from_name', 'forward_from_name TEXT DEFAULT NULL')
        add_column_if_missing(conn, cursor, 'messages', 'forward_from_user_id', 'forward_from_user_id BIGINT')
        add_column_if_missing(conn, cursor, 'messages', 'edit_count', 'edit_count INTEGER DEFAULT 0')
        add_column_if_missing(conn, cursor, 'messages', 'is_delivered', 'is_delivered INTEGER NOT NULL DEFAULT 0')
        add_column_if_missing(conn, cursor, 'messages', 'voice_listened_by_receiver', 'voice_listened_by_receiver INTEGER NOT NULL DEFAULT 0')
        add_column_if_missing(conn, cursor, 'messages', 'read_at', 'read_at TIMESTAMP DEFAULT NULL')
        drop_not_null_if_set(conn, cursor, 'messages', 'receiver_id')

        add_column_if_missing(conn, cursor, 'users', 'display_name', "display_name TEXT NOT NULL DEFAULT ''")
        add_column_if_missing(conn, cursor, 'users', 'is_public', 'is_public INTEGER NOT NULL DEFAULT 1')
        add_column_if_missing(conn, cursor, 'users', 'auto_decline_requests', 'auto_decline_requests INTEGER NOT NULL DEFAULT 0')
        add_column_if_missing(conn, cursor, 'users', 'mute_dialog_requests', 'mute_dialog_requests INTEGER NOT NULL DEFAULT 0')
        add_column_if_missing(conn, cursor, 'users', 'hide_online_status', 'hide_online_status INTEGER NOT NULL DEFAULT 0')
        add_column_if_missing(conn, cursor, 'users', 'last_seen', 'last_seen TEXT')
        add_column_if_missing(conn, cursor, 'users', 'avatar_url', 'avatar_url TEXT DEFAULT NULL')
        add_column_if_missing(conn, cursor, 'users', 'avatar_visibility', "avatar_visibility TEXT DEFAULT 'all'")
        add_column_if_missing(conn, cursor, 'users', 'is_online', 'is_online INTEGER DEFAULT 0')
        add_column_if_missing(conn, cursor, 'users', 'totp_secret', 'totp_secret TEXT')
        add_column_if_missing(conn, cursor, 'users', 'totp_enabled_at', 'totp_enabled_at TIMESTAMP')
        add_column_if_missing(conn, cursor, 'users', 'login_vault', 'login_vault TEXT')
        add_column_if_missing(conn, cursor, 'users', 'bio', "bio TEXT NOT NULL DEFAULT ''")
        add_column_if_missing(conn, cursor, 'users', 'language', "language TEXT NOT NULL DEFAULT 'ru'")
        add_column_if_missing(conn, cursor, 'users', 'client_preferences', "client_preferences TEXT NOT NULL DEFAULT '{}'")
        add_column_if_missing(conn, cursor, 'chats', 'chat_type', "chat_type TEXT NOT NULL DEFAULT 'direct'")
        add_column_if_missing(conn, cursor, 'chats', 'chat_description', "chat_description TEXT NOT NULL DEFAULT ''")
        add_column_if_missing(conn, cursor, 'chats', 'chat_avatar_url', 'chat_avatar_url TEXT DEFAULT NULL')
        add_column_if_missing(conn, cursor, 'chats', 'created_by_user_id', 'created_by_user_id BIGINT')
        if not migration_applied(cursor, USER_PROFILE_NORMALIZATION_MIGRATION[0]):
            cursor.execute(
                '''
                UPDATE users
                SET totp_enabled_at = COALESCE(totp_enabled_at, CURRENT_TIMESTAMP)
                WHERE totp_secret IS NOT NULL
                '''
            )
            cursor.execute(
                '''
                UPDATE users
                SET language = CASE
                    WHEN LOWER(COALESCE(language, '')) = 'en' THEN 'en'
                    ELSE 'ru'
                END
                '''
            )
            cursor.execute(
                '''
                INSERT INTO schema_migrations (version, name)
                VALUES (?, ?)
                ON CONFLICT(version) DO NOTHING
                ''',
                USER_PROFILE_NORMALIZATION_MIGRATION,
            )
            conn.commit()

        if not socket_rate_limits_support_event_scope(cursor):
            raise RuntimeError('socket_rate_limits primary key shape mismatch; expected (user_id, event_name)')

        cursor.execute(
            '''
            INSERT INTO schema_migrations (version, name)
            VALUES (?, ?)
            ON CONFLICT(version) DO NOTHING
            ''',
            SOCKET_RATE_EVENT_SCOPE_MIGRATION,
        )

        if not migration_applied(cursor, SAVED_MESSAGES_CHAT_BACKFILL_MIGRATION[0]):
            backfilled_count = backfill_saved_messages_chats(conn, cursor)
            logger.info('Migration: backfilled saved messages chats for %s users', backfilled_count)
            cursor.execute(
                '''
                INSERT INTO schema_migrations (version, name)
                VALUES (?, ?)
                ON CONFLICT(version) DO NOTHING
                ''',
                SAVED_MESSAGES_CHAT_BACKFILL_MIGRATION,
            )

        cursor.execute(
            '''
            INSERT INTO schema_migrations (version, name)
            VALUES (?, ?)
            ON CONFLICT(version) DO NOTHING
            ''',
            PUSH_SUBSCRIPTIONS_MIGRATION,
        )
        cursor.execute(
            '''
            INSERT INTO schema_migrations (version, name)
            VALUES (?, ?)
            ON CONFLICT(version) DO NOTHING
            ''',
            MODERATION_CORE_MIGRATION,
        )
        cursor.execute(
            '''
            INSERT INTO schema_migrations (version, name)
            VALUES (?, ?)
            ON CONFLICT(version) DO NOTHING
            ''',
            MODERATION_QUEUE_MIGRATION,
        )
        cursor.execute(
            '''
            INSERT INTO schema_migrations (version, name)
            VALUES (?, ?)
            ON CONFLICT(version) DO NOTHING
            ''',
            MODERATION_RBAC_MIGRATION,
        )
        cursor.execute(
            '''
            INSERT INTO schema_migrations (version, name)
            VALUES (?, ?)
            ON CONFLICT(version) DO NOTHING
            ''',
            GROUP_CHAT_PROFILE_FIELDS_MIGRATION,
        )
        cursor.execute(
            '''
            INSERT INTO schema_migrations (version, name)
            VALUES (?, ?)
            ON CONFLICT(version) DO NOTHING
            ''',
            SUPPORT_REQUESTS_MIGRATION,
        )
        if not migration_applied(cursor, GROUP_CHATS_SCHEMA_MIGRATION[0]):
            backfill_chat_members(conn, cursor)
            backfill_message_receipts(conn, cursor)
            cursor.execute(
                '''
                INSERT INTO schema_migrations (version, name)
                VALUES (?, ?)
                ON CONFLICT(version) DO NOTHING
                ''',
                GROUP_CHATS_SCHEMA_MIGRATION,
            )
        if not migration_applied(cursor, GROUP_CHAT_OWNER_ROLE_MIGRATION[0]):
            backfill_group_owner_roles(conn, cursor)
            cursor.execute(
                '''
                INSERT INTO schema_migrations (version, name)
                VALUES (?, ?)
                ON CONFLICT(version) DO NOTHING
                ''',
                GROUP_CHAT_OWNER_ROLE_MIGRATION,
            )
        conn.commit()

        _chat_pins_schema_checked = chat_pins_supports_multiple(cursor)
        if use_cache:
            with _migrations_run_lock:
                _migrations_run_cache_keys.add(cache_key)
    except Exception:
        logger.exception('Migration error')
        raise
    finally:
        conn.close()
