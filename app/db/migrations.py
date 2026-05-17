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
from app.services.session_policy import SESSION_AUTO_LOGOUT_DEFAULT_SECONDS

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
GROUP_INVITE_REQUESTS_MIGRATION = (17, 'add_group_invite_privacy_and_requests')
CHAT_EVENT_ENVELOPE_MIGRATION = (18, 'add_chat_update_event_envelope_tables')
TOTP_BACKUP_CODES_MIGRATION = (19, 'create_totp_backup_codes_table')
GROUP_INVITE_LINKS_MIGRATION = (20, 'create_group_invite_links_table')
USER_STATUS_TEXT_MIGRATION = (21, 'add_status_text_to_users')
MESSAGE_EXPIRES_AT_MIGRATION = (22, 'add_expires_at_to_messages')
CHAT_AUTO_DELETE_MIGRATION = (23, 'add_auto_delete_seconds_to_chats')
MESSAGE_ALBUM_ID_MIGRATION = (24, 'add_album_id_to_messages')
USER_PRIVACY_CHOICES_MIGRATION = (25, 'add_user_privacy_choices')
SPOTIFY_INTEGRATION_MIGRATION = (26, 'create_spotify_tables')
USER_SESSION_AUTO_LOGOUT_MIGRATION = (27, 'add_user_session_auto_logout_seconds')
CALLS_SCHEMA_MIGRATION = (28, 'create_call_sessions_and_participants_tables')
CALL_FEATURE_ACCESS_MIGRATION = (29, 'create_call_feature_access_tables')

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


def _record_migration(cursor, migration: tuple[int, str]) -> None:
    cursor.execute(
        '''
        INSERT INTO schema_migrations (version, name)
        VALUES (?, ?)
        ON CONFLICT(version) DO NOTHING
        ''',
        migration,
    )


def _run_messages_schema_migrations(conn, cursor) -> None:
    message_columns = (
        ('is_edited', 'is_edited INTEGER DEFAULT 0'),
        ('message_type', "message_type TEXT DEFAULT 'text'"),
        ('deleted_by_sender', 'deleted_by_sender INTEGER DEFAULT 0'),
        ('deleted_by_receiver', 'deleted_by_receiver INTEGER DEFAULT 0'),
        ('reply_to_id', 'reply_to_id BIGINT'),
        ('forward_from_name', 'forward_from_name TEXT DEFAULT NULL'),
        ('forward_from_user_id', 'forward_from_user_id BIGINT'),
        ('edit_count', 'edit_count INTEGER DEFAULT 0'),
        ('is_delivered', 'is_delivered INTEGER NOT NULL DEFAULT 0'),
        ('voice_listened_by_receiver', 'voice_listened_by_receiver INTEGER NOT NULL DEFAULT 0'),
        ('read_at', 'read_at TIMESTAMP DEFAULT NULL'),
    )
    for column_name, ddl in message_columns:
        add_column_if_missing(conn, cursor, 'messages', column_name, ddl)
    drop_not_null_if_set(conn, cursor, 'messages', 'receiver_id')


def _run_users_schema_migrations(conn, cursor) -> None:
    user_columns = (
        ('display_name', "display_name TEXT NOT NULL DEFAULT ''"),
        ('is_public', 'is_public INTEGER NOT NULL DEFAULT 1'),
        ('auto_decline_requests', 'auto_decline_requests INTEGER NOT NULL DEFAULT 0'),
        ('mute_dialog_requests', 'mute_dialog_requests INTEGER NOT NULL DEFAULT 0'),
        ('hide_online_status', 'hide_online_status INTEGER NOT NULL DEFAULT 0'),
        ('last_seen_visibility', "last_seen_visibility TEXT NOT NULL DEFAULT 'all'"),
        ('last_seen', 'last_seen TEXT'),
        ('avatar_url', 'avatar_url TEXT DEFAULT NULL'),
        ('avatar_visibility', "avatar_visibility TEXT DEFAULT 'all'"),
        ('bio_visibility', "bio_visibility TEXT NOT NULL DEFAULT 'all'"),
        ('forward_link_privacy', "forward_link_privacy TEXT NOT NULL DEFAULT 'all'"),
        ('group_invite_privacy', "group_invite_privacy TEXT NOT NULL DEFAULT 'all'"),
        ('voice_message_privacy', "voice_message_privacy TEXT NOT NULL DEFAULT 'all'"),
        ('message_privacy', "message_privacy TEXT NOT NULL DEFAULT 'all'"),
        ('is_online', 'is_online INTEGER DEFAULT 0'),
        ('totp_secret', 'totp_secret TEXT'),
        ('totp_enabled_at', 'totp_enabled_at TIMESTAMP'),
        ('login_vault', 'login_vault TEXT'),
        ('bio', "bio TEXT NOT NULL DEFAULT ''"),
        ('language', "language TEXT NOT NULL DEFAULT 'ru'"),
        ('client_preferences', "client_preferences TEXT NOT NULL DEFAULT '{}'"),
        (
            'session_auto_logout_seconds',
            f'session_auto_logout_seconds INTEGER NOT NULL DEFAULT {SESSION_AUTO_LOGOUT_DEFAULT_SECONDS}',
        ),
    )
    for column_name, ddl in user_columns:
        add_column_if_missing(conn, cursor, 'users', column_name, ddl)


def _run_chats_schema_migrations(conn, cursor) -> None:
    chat_columns = (
        ('chat_type', "chat_type TEXT NOT NULL DEFAULT 'direct'"),
        ('chat_description', "chat_description TEXT NOT NULL DEFAULT ''"),
        ('chat_avatar_url', 'chat_avatar_url TEXT DEFAULT NULL'),
        ('created_by_user_id', 'created_by_user_id BIGINT'),
        ('group_perm_send_messages', 'group_perm_send_messages INTEGER NOT NULL DEFAULT 1'),
        ('group_perm_send_media', 'group_perm_send_media INTEGER NOT NULL DEFAULT 1'),
        ('group_perm_add_members', 'group_perm_add_members INTEGER NOT NULL DEFAULT 0'),
        ('group_perm_pin_messages', 'group_perm_pin_messages INTEGER NOT NULL DEFAULT 0'),
        ('group_perm_change_info', 'group_perm_change_info INTEGER NOT NULL DEFAULT 0'),
        ('group_slow_mode_seconds', 'group_slow_mode_seconds INTEGER NOT NULL DEFAULT 0'),
    )
    for column_name, ddl in chat_columns:
        add_column_if_missing(conn, cursor, 'chats', column_name, ddl)


def _ensure_group_invite_requests_schema(cursor) -> None:
    cursor.execute(
        '''
        CREATE TABLE IF NOT EXISTS group_invite_requests (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            chat_id TEXT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
            inviter_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            invitee_user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            responded_at TIMESTAMP
        )
        '''
    )
    cursor.execute(
        '''
        CREATE INDEX IF NOT EXISTS idx_group_invite_requests_invitee_status_created
            ON group_invite_requests(invitee_user_id, status, created_at DESC)
        '''
    )
    cursor.execute(
        '''
        CREATE INDEX IF NOT EXISTS idx_group_invite_requests_chat_invitee_status
            ON group_invite_requests(chat_id, invitee_user_id, status)
        '''
    )


def _run_user_profile_normalization_migration(conn, cursor) -> None:
    if migration_applied(cursor, USER_PROFILE_NORMALIZATION_MIGRATION[0]):
        return
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
    _record_migration(cursor, USER_PROFILE_NORMALIZATION_MIGRATION)
    conn.commit()


def _run_group_invite_requests_migration(conn, cursor) -> None:
    if migration_applied(cursor, GROUP_INVITE_REQUESTS_MIGRATION[0]):
        return
    cursor.execute(
        '''
        UPDATE users
        SET group_invite_privacy = CASE
            WHEN LOWER(COALESCE(group_invite_privacy, '')) IN ('all', 'contacts', 'nobody')
                THEN LOWER(group_invite_privacy)
            ELSE 'all'
        END
        '''
    )
    _record_migration(cursor, GROUP_INVITE_REQUESTS_MIGRATION)
    conn.commit()


def _validate_socket_rate_limits_schema(cursor) -> None:
    if not socket_rate_limits_support_event_scope(cursor):
        raise RuntimeError('socket_rate_limits primary key shape mismatch; expected (user_id, event_name)')


def _run_saved_messages_backfill_migration(conn, cursor) -> None:
    if migration_applied(cursor, SAVED_MESSAGES_CHAT_BACKFILL_MIGRATION[0]):
        return
    backfilled_count = backfill_saved_messages_chats(conn, cursor)
    logger.info('Migration: backfilled saved messages chats for %s users', backfilled_count)
    _record_migration(cursor, SAVED_MESSAGES_CHAT_BACKFILL_MIGRATION)


def _record_static_schema_migrations(cursor) -> None:
    static_migrations = (
        PUSH_SUBSCRIPTIONS_MIGRATION,
        MODERATION_CORE_MIGRATION,
        MODERATION_QUEUE_MIGRATION,
        MODERATION_RBAC_MIGRATION,
        GROUP_CHAT_PROFILE_FIELDS_MIGRATION,
        SUPPORT_REQUESTS_MIGRATION,
        CHAT_EVENT_ENVELOPE_MIGRATION,
    )
    for migration in static_migrations:
        _record_migration(cursor, migration)


def _run_group_chats_schema_backfill_migration(conn, cursor) -> None:
    if migration_applied(cursor, GROUP_CHATS_SCHEMA_MIGRATION[0]):
        return
    backfill_chat_members(conn, cursor)
    backfill_message_receipts(conn, cursor)
    _record_migration(cursor, GROUP_CHATS_SCHEMA_MIGRATION)


def _run_group_owner_role_backfill_migration(conn, cursor) -> None:
    if migration_applied(cursor, GROUP_CHAT_OWNER_ROLE_MIGRATION[0]):
        return
    backfill_group_owner_roles(conn, cursor)
    _record_migration(cursor, GROUP_CHAT_OWNER_ROLE_MIGRATION)


def _run_new_feature_schema_migrations(conn, cursor) -> None:
    # TOTP backup codes table
    cursor.execute(
        '''
        CREATE TABLE IF NOT EXISTS totp_backup_codes (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            code_hash TEXT NOT NULL,
            used_at TIMESTAMP DEFAULT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        '''
    )
    cursor.execute(
        'CREATE INDEX IF NOT EXISTS idx_totp_backup_codes_user_id ON totp_backup_codes(user_id)'
    )
    _record_migration(cursor, TOTP_BACKUP_CODES_MIGRATION)

    # Group invite links table
    cursor.execute(
        '''
        CREATE TABLE IF NOT EXISTS group_invite_links (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            chat_id TEXT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
            token TEXT NOT NULL UNIQUE,
            created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            max_uses INTEGER DEFAULT NULL,
            uses_count INTEGER NOT NULL DEFAULT 0,
            expires_at TIMESTAMP DEFAULT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        '''
    )
    cursor.execute(
        'CREATE UNIQUE INDEX IF NOT EXISTS idx_group_invite_links_token ON group_invite_links(token)'
    )
    cursor.execute(
        'CREATE INDEX IF NOT EXISTS idx_group_invite_links_chat_active ON group_invite_links(chat_id, is_active)'
    )
    _record_migration(cursor, GROUP_INVITE_LINKS_MIGRATION)

    # status_text column on users
    add_column_if_missing(conn, cursor, 'users', 'status_text', "status_text TEXT NOT NULL DEFAULT ''")
    _record_migration(cursor, USER_STATUS_TEXT_MIGRATION)

    # expires_at on messages (for disappearing messages)
    add_column_if_missing(conn, cursor, 'messages', 'expires_at', 'expires_at BIGINT DEFAULT NULL')
    _record_migration(cursor, MESSAGE_EXPIRES_AT_MIGRATION)

    # auto_delete_seconds on chats (per-chat disappearing timer)
    add_column_if_missing(conn, cursor, 'chats', 'auto_delete_seconds', 'auto_delete_seconds INTEGER NOT NULL DEFAULT 0')
    _record_migration(cursor, CHAT_AUTO_DELETE_MIGRATION)

    # album_id on messages (groups multiple media files into one visual album)
    add_column_if_missing(conn, cursor, 'messages', 'album_id', 'album_id TEXT DEFAULT NULL')
    cursor.execute(
        'CREATE INDEX IF NOT EXISTS idx_messages_album_id ON messages(album_id) WHERE album_id IS NOT NULL'
    )
    _record_migration(cursor, MESSAGE_ALBUM_ID_MIGRATION)

    privacy_columns = (
        ('last_seen_visibility', "last_seen_visibility TEXT NOT NULL DEFAULT 'all'"),
        ('bio_visibility', "bio_visibility TEXT NOT NULL DEFAULT 'all'"),
        ('forward_link_privacy', "forward_link_privacy TEXT NOT NULL DEFAULT 'all'"),
        ('voice_message_privacy', "voice_message_privacy TEXT NOT NULL DEFAULT 'all'"),
        ('message_privacy', "message_privacy TEXT NOT NULL DEFAULT 'all'"),
    )
    for column_name, ddl in privacy_columns:
        add_column_if_missing(conn, cursor, 'users', column_name, ddl)
    cursor.execute(
        '''
        UPDATE users
        SET
            last_seen_visibility = CASE
                WHEN LOWER(COALESCE(last_seen_visibility, '')) IN ('all', 'contacts', 'nobody')
                    THEN LOWER(last_seen_visibility)
                WHEN COALESCE(hide_online_status, 0) = 1 THEN 'nobody'
                ELSE 'all'
            END,
            bio_visibility = CASE
                WHEN LOWER(COALESCE(bio_visibility, '')) IN ('all', 'contacts', 'nobody')
                    THEN LOWER(bio_visibility)
                ELSE 'all'
            END,
            forward_link_privacy = CASE
                WHEN LOWER(COALESCE(forward_link_privacy, '')) IN ('all', 'contacts', 'nobody')
                    THEN LOWER(forward_link_privacy)
                ELSE 'all'
            END,
            voice_message_privacy = CASE
                WHEN LOWER(COALESCE(voice_message_privacy, '')) IN ('all', 'contacts', 'nobody')
                    THEN LOWER(voice_message_privacy)
                ELSE 'all'
            END,
            message_privacy = CASE
                WHEN LOWER(COALESCE(message_privacy, '')) IN ('all', 'contacts', 'nobody')
                    THEN LOWER(message_privacy)
                ELSE 'all'
            END
        '''
    )
    _record_migration(cursor, USER_PRIVACY_CHOICES_MIGRATION)

    # Spotify integration tables
    if not migration_applied(cursor, SPOTIFY_INTEGRATION_MIGRATION[0]):
        cursor.execute(
            '''
            CREATE TABLE IF NOT EXISTS spotify_tokens (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                access_token TEXT NOT NULL,
                refresh_token TEXT NOT NULL,
                token_type TEXT NOT NULL DEFAULT 'Bearer',
                scope TEXT NOT NULL DEFAULT '',
                expires_at BIGINT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
            '''
        )
        cursor.execute(
            '''
            CREATE TABLE IF NOT EXISTS spotify_now_playing (
                user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                is_playing INTEGER NOT NULL DEFAULT 0,
                track_name TEXT,
                artist_name TEXT,
                album_name TEXT,
                album_art_url TEXT,
                spotify_track_url TEXT,
                progress_ms BIGINT DEFAULT 0,
                duration_ms BIGINT DEFAULT 1,
                cached_at DOUBLE PRECISION DEFAULT NULL
            )
            '''
        )
        _record_migration(cursor, SPOTIFY_INTEGRATION_MIGRATION)

    if not migration_applied(cursor, USER_SESSION_AUTO_LOGOUT_MIGRATION[0]):
        add_column_if_missing(
            conn,
            cursor,
            'users',
            'session_auto_logout_seconds',
            f'session_auto_logout_seconds INTEGER NOT NULL DEFAULT {SESSION_AUTO_LOGOUT_DEFAULT_SECONDS}',
        )
        cursor.execute(
            '''
            UPDATE users
            SET session_auto_logout_seconds = ?
            WHERE session_auto_logout_seconds IS NULL
               OR session_auto_logout_seconds NOT IN (?, ?, ?, ?)
            ''',
            (
                SESSION_AUTO_LOGOUT_DEFAULT_SECONDS,
                7 * 24 * 60 * 60,
                30 * 24 * 60 * 60,
                90 * 24 * 60 * 60,
                180 * 24 * 60 * 60,
            ),
        )
        _record_migration(cursor, USER_SESSION_AUTO_LOGOUT_MIGRATION)

def _run_calls_schema_migration(conn, cursor) -> None:
    if migration_applied(cursor, CALLS_SCHEMA_MIGRATION[0]):
        return
    cursor.execute(
        '''
        CREATE TABLE IF NOT EXISTS call_sessions (
            call_id TEXT PRIMARY KEY,
            chat_id TEXT NOT NULL REFERENCES chats(chat_id) ON DELETE CASCADE,
            initiator_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            call_type TEXT NOT NULL DEFAULT 'audio',
            status TEXT NOT NULL DEFAULT 'ringing',
            started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            accepted_at TIMESTAMP DEFAULT NULL,
            ended_at TIMESTAMP DEFAULT NULL,
            duration_sec INTEGER DEFAULT NULL,
            mediasoup_room_id TEXT DEFAULT NULL
        )
        '''
    )
    cursor.execute(
        'CREATE INDEX IF NOT EXISTS idx_call_sessions_chat_id ON call_sessions(chat_id)'
    )
    cursor.execute(
        'CREATE INDEX IF NOT EXISTS idx_call_sessions_initiator ON call_sessions(initiator_id)'
    )
    cursor.execute(
        'CREATE INDEX IF NOT EXISTS idx_call_sessions_status ON call_sessions(status)'
    )
    cursor.execute(
        '''
        CREATE TABLE IF NOT EXISTS call_participants (
            call_id TEXT NOT NULL REFERENCES call_sessions(call_id) ON DELETE CASCADE,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            joined_at TIMESTAMP DEFAULT NULL,
            left_at TIMESTAMP DEFAULT NULL,
            was_muted INTEGER NOT NULL DEFAULT 0,
            had_video INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (call_id, user_id)
        )
        '''
    )
    cursor.execute(
        'CREATE INDEX IF NOT EXISTS idx_call_participants_user ON call_participants(user_id)'
    )
    _record_migration(cursor, CALLS_SCHEMA_MIGRATION)
    conn.commit()
    logger.info('Migration: created call_sessions and call_participants tables')


def _run_call_feature_access_migration(conn, cursor) -> None:
    if migration_applied(cursor, CALL_FEATURE_ACCESS_MIGRATION[0]):
        return
    cursor.execute(
        '''
        CREATE TABLE IF NOT EXISTS call_feature_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        '''
    )
    cursor.execute(
        '''
        INSERT INTO call_feature_settings (key, value)
        VALUES ('allowlist_enabled', '1')
        ON CONFLICT(key) DO NOTHING
        '''
    )
    cursor.execute(
        '''
        CREATE TABLE IF NOT EXISTS call_feature_allowlist (
            user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            granted_by_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
            note TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        '''
    )
    cursor.execute(
        'CREATE INDEX IF NOT EXISTS idx_call_feature_allowlist_created ON call_feature_allowlist(created_at DESC)'
    )
    _record_migration(cursor, CALL_FEATURE_ACCESS_MIGRATION)
    conn.commit()
    logger.info('Migration: created call feature access tables')


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

        _run_messages_schema_migrations(conn, cursor)
        _run_users_schema_migrations(conn, cursor)
        _run_chats_schema_migrations(conn, cursor)
        _ensure_group_invite_requests_schema(cursor)
        _run_user_profile_normalization_migration(conn, cursor)
        _run_group_invite_requests_migration(conn, cursor)

        _validate_socket_rate_limits_schema(cursor)
        _record_migration(cursor, SOCKET_RATE_EVENT_SCOPE_MIGRATION)
        _run_saved_messages_backfill_migration(conn, cursor)
        _record_static_schema_migrations(cursor)
        _run_group_chats_schema_backfill_migration(conn, cursor)
        _run_group_owner_role_backfill_migration(conn, cursor)
        _run_new_feature_schema_migrations(conn, cursor)
        _run_calls_schema_migration(conn, cursor)
        _run_call_feature_access_migration(conn, cursor)
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
