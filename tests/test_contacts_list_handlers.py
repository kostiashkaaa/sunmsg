from pathlib import Path
import time

from app.routes.contacts_list_handlers import fetch_contacts_for_user
from app.services.crypto import generate_chat_id
from tests._pg_test_db import connect_test_db


def _connect(db_path: Path):
    return connect_test_db(db_path)


def _prepare_schema(conn):
    conn.execute(
        '''
        CREATE TABLE chats (
            chat_id TEXT PRIMARY KEY,
            chat_name TEXT
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL,
            display_name TEXT NOT NULL,
            public_key TEXT NOT NULL,
            avatar_url TEXT,
            avatar_visibility TEXT,
            is_online INTEGER NOT NULL DEFAULT 0,
            hide_online_status INTEGER NOT NULL DEFAULT 0
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE contacts (
            user_id INTEGER NOT NULL,
            contact_id INTEGER NOT NULL,
            chat_id TEXT NOT NULL
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            message TEXT,
            is_read INTEGER NOT NULL DEFAULT 0,
            is_delivered INTEGER NOT NULL DEFAULT 0,
            created_at TEXT,
            deleted_by_sender INTEGER NOT NULL DEFAULT 0,
            deleted_by_receiver INTEGER NOT NULL DEFAULT 0
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE block_list (
            blocker_id INTEGER NOT NULL,
            blocked_id INTEGER NOT NULL
        )
        '''
    )
    conn.commit()


def test_fetch_contacts_for_user_builds_projection_and_block_flags(tmp_path):
    db_path = tmp_path / 'contacts-list-handlers.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (
                id, username, display_name, public_key, avatar_url, avatar_visibility, is_online, hide_online_status
            )
            VALUES
                (1, 'alice', 'Alice', 'pk-1', NULL, 'all', 0, 0),
                (2, 'bob', 'Bob', 'pk-2', NULL, 'all', 1, 0),
                (3, 'carol', 'Carol', 'pk-3', NULL, 'all', 1, 0)
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES
                (1, 2, 'chat-a'),
                (1, 3, 'chat-b')
            '''
        )
        conn.execute(
            '''
            INSERT INTO messages (
                chat_id, sender_id, receiver_id, message, is_read, is_delivered, created_at
            )
            VALUES
                ('chat-a', 2, 1, 'hi from bob', 0, 1, '2026-01-01 11:00:00'),
                ('chat-b', 3, 1, 'hi from carol', 1, 1, '2026-01-01 10:00:00')
            '''
        )
        conn.execute('INSERT INTO block_list (blocker_id, blocked_id) VALUES (1, 3)')
        conn.commit()

        ensured = {'count': 0}
        normalize_calls = []
        online_calls = []

        def _ensure_pinned(conn):
            ensured['count'] += 1
            conn.execute(
                '''
                CREATE TABLE IF NOT EXISTS pinned_chats (
                    user_id INTEGER NOT NULL,
                    chat_id TEXT NOT NULL,
                    pin_order INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (user_id, chat_id)
                )
                '''
            )
            conn.execute(
                '''
                INSERT OR REPLACE INTO pinned_chats (user_id, chat_id, pin_order)
                VALUES (1, 'chat-b', 0)
                '''
            )

        def _normalize_language(language, default='ru'):
            normalize_calls.append((language, default))
            return f"normalized-{language}"

        def _format_sidebar_time(raw, *, language):
            return f"{language}:{raw}"

        def _preview(raw, *, blocked_by_me, blocked_me, language):
            return f"{language}:{blocked_by_me}:{blocked_me}:{raw}"

        def _avatar(row, viewer_id):
            return f"avatar-{row['id']}-for-{viewer_id}"

        def _online(pub, *, persisted=False):
            online_calls.append((pub, persisted))
            return True

        contacts = fetch_contacts_for_user(
            1,
            conn,
            language='en',
            normalize_language_func=_normalize_language,
            ensure_pinned_chats_table_func=_ensure_pinned,
            format_sidebar_time_func=_format_sidebar_time,
            build_initial_last_message_preview_func=_preview,
            get_safe_avatar_url_func=_avatar,
            is_effectively_online_func=_online,
        )

    assert ensured['count'] == 1
    assert normalize_calls == [('en', 'ru')]
    assert len(contacts) == 3
    self_contact = next(item for item in contacts if item['userId'] == 1)
    blocked_contact = next(item for item in contacts if item['userId'] == 3)
    normal_contact = next(item for item in contacts if item['userId'] == 2)

    assert contacts[0]['userId'] == 1
    assert self_contact['display_name'] == '\u0418\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0435'
    assert self_contact['unreadCount'] == 0
    assert self_contact['is_saved_messages'] is True

    assert blocked_contact['userId'] == 3
    assert blocked_contact['blocked_by_me'] is True
    assert blocked_contact['blocked_me'] is False
    assert blocked_contact['is_blocked'] is True
    assert blocked_contact['is_online'] is False
    assert blocked_contact['sidebar_time_text'] == 'normalized-en:2026-01-01 10:00:00'
    assert blocked_contact['initial_last_message_preview'] == 'normalized-en:True:False:hi from carol'

    assert normal_contact['userId'] == 2
    assert normal_contact['blocked_by_me'] is False
    assert normal_contact['is_online'] is True
    assert normal_contact['avatar_url'] == 'avatar-2-for-1'
    assert normal_contact['unreadCount'] == 1
    assert online_calls == [('pk-1', False), ('pk-2', True)]


def test_fetch_contacts_for_user_applies_limit(tmp_path):
    db_path = tmp_path / 'contacts-list-handlers-limit.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (
                id, username, display_name, public_key, avatar_url, avatar_visibility, is_online, hide_online_status
            )
            VALUES
                (1, 'alice', 'Alice', 'pk-1', NULL, 'all', 0, 0),
                (2, 'bob', 'Bob', 'pk-2', NULL, 'all', 0, 0),
                (3, 'carol', 'Carol', 'pk-3', NULL, 'all', 0, 0)
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES
                (1, 2, 'chat-a'),
                (1, 3, 'chat-b')
            '''
        )
        conn.execute(
            '''
            CREATE TABLE pinned_chats (
                user_id INTEGER NOT NULL,
                chat_id TEXT NOT NULL,
                pin_order INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, chat_id)
            )
            '''
        )
        conn.execute(
            '''
            INSERT INTO pinned_chats (user_id, chat_id, pin_order)
            VALUES
                (1, 'chat-a', 0),
                (1, 'chat-b', 1)
            '''
        )
        conn.commit()

        contacts = fetch_contacts_for_user(
            1,
            conn,
            limit=1,
            language='ru',
            normalize_language_func=lambda language, default='ru': language,
            ensure_pinned_chats_table_func=lambda conn: None,
            format_sidebar_time_func=lambda raw, *, language: '',
            build_initial_last_message_preview_func=lambda raw, *, blocked_by_me, blocked_me, language: '',
            get_safe_avatar_url_func=lambda row, viewer_id: None,
            is_effectively_online_func=lambda pub, *, persisted=False: False,
        )

    assert len(contacts) == 1
    assert contacts[0]['userId'] == 1


def test_fetch_contacts_for_user_skips_pinned_table_ddl_when_table_exists(tmp_path):
    db_path = tmp_path / 'contacts-list-handlers-no-ddl-when-pins-exist.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (
                id, username, display_name, public_key, avatar_url, avatar_visibility, is_online, hide_online_status
            )
            VALUES
                (1, 'alice', 'Alice', 'pk-1', NULL, 'all', 0, 0),
                (2, 'bob', 'Bob', 'pk-2', NULL, 'all', 0, 0)
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, 'chat-a')
            '''
        )
        conn.execute(
            '''
            CREATE TABLE pinned_chats (
                user_id INTEGER NOT NULL,
                chat_id TEXT NOT NULL,
                pin_order INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (user_id, chat_id)
            )
            '''
        )
        conn.execute(
            '''
            INSERT INTO pinned_chats (user_id, chat_id, pin_order)
            VALUES (1, 'chat-a', 0)
            '''
        )
        conn.commit()

        ensure_calls = {'count': 0}

        def _ensure_pinned(conn):
            ensure_calls['count'] += 1

        contacts = fetch_contacts_for_user(
            1,
            conn,
            language='ru',
            normalize_language_func=lambda language, default='ru': language,
            ensure_pinned_chats_table_func=_ensure_pinned,
            format_sidebar_time_func=lambda raw, *, language: '',
            build_initial_last_message_preview_func=lambda raw, *, blocked_by_me, blocked_me, language: '',
            get_safe_avatar_url_func=lambda row, viewer_id: None,
            is_effectively_online_func=lambda pub, *, persisted=False: False,
        )

    assert contacts
    assert ensure_calls['count'] == 0


def test_fetch_contacts_for_user_forces_zero_unread_for_saved_messages(tmp_path):
    db_path = tmp_path / 'contacts-list-handlers-saved-unread.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (
                id, username, display_name, public_key, avatar_url, avatar_visibility, is_online, hide_online_status
            )
            VALUES
                (1, 'alice', 'Alice', 'pk-1', NULL, 'all', 1, 0)
            '''
        )
        saved_chat_id = generate_chat_id('pk-1', 'pk-1')
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 1, ?)
            ''',
            (saved_chat_id,),
        )
        conn.execute(
            '''
            INSERT INTO messages (
                chat_id, sender_id, receiver_id, message, is_read, is_delivered, created_at
            )
            VALUES (?, 1, 1, 'self note', 0, 1, '2026-01-02 09:00:00')
            ''',
            (saved_chat_id,),
        )
        conn.commit()

        contacts = fetch_contacts_for_user(
            1,
            conn,
            language='ru',
            normalize_language_func=lambda language, default='ru': language,
            ensure_pinned_chats_table_func=lambda conn: None,
            format_sidebar_time_func=lambda raw, *, language: '',
            build_initial_last_message_preview_func=lambda raw, *, blocked_by_me, blocked_me, language: '',
            get_safe_avatar_url_func=lambda row, viewer_id: None,
            is_effectively_online_func=lambda pub, *, persisted=False: bool(persisted),
        )

    self_contact = next(item for item in contacts if item['userId'] == 1)
    assert self_contact['is_saved_messages'] is True
    assert self_contact['unreadCount'] == 0
    assert self_contact['message_count'] == 1


def test_fetch_contacts_for_user_renames_self_chat_to_saved_messages(tmp_path):
    db_path = tmp_path / 'contacts-list-handlers-self-chat.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (
                id, username, display_name, public_key, avatar_url, avatar_visibility, is_online, hide_online_status
            )
            VALUES
                (1, 'alice', 'Alice', 'pk-1', NULL, 'all', 1, 0)
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 1, 'self-chat')
            '''
        )
        conn.commit()

        contacts_ru = fetch_contacts_for_user(
            1,
            conn,
            language='ru',
            normalize_language_func=lambda language, default='ru': language,
            ensure_pinned_chats_table_func=lambda conn: None,
            format_sidebar_time_func=lambda raw, *, language: '',
            build_initial_last_message_preview_func=lambda raw, *, blocked_by_me, blocked_me, language: '',
            get_safe_avatar_url_func=lambda row, viewer_id: None,
            is_effectively_online_func=lambda pub, *, persisted=False: bool(persisted),
        )
        contacts_en = fetch_contacts_for_user(
            1,
            conn,
            language='en',
            normalize_language_func=lambda language, default='ru': language,
            ensure_pinned_chats_table_func=lambda conn: None,
            format_sidebar_time_func=lambda raw, *, language: '',
            build_initial_last_message_preview_func=lambda raw, *, blocked_by_me, blocked_me, language: '',
            get_safe_avatar_url_func=lambda row, viewer_id: None,
            is_effectively_online_func=lambda pub, *, persisted=False: bool(persisted),
        )

    assert contacts_ru[0]['display_name'] == '\u0418\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0435'
    assert contacts_en[0]['display_name'] == 'Saved Messages'


def test_fetch_contacts_for_user_creates_missing_self_chat(tmp_path):
    db_path = tmp_path / 'contacts-list-handlers-self-chat-ensure.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (
                id, username, display_name, public_key, avatar_url, avatar_visibility, is_online, hide_online_status
            )
            VALUES
                (1, 'alice', 'Alice', 'pk-1', NULL, 'all', 1, 0)
            '''
        )
        conn.commit()

        contacts = fetch_contacts_for_user(
            1,
            conn,
            language='ru',
            normalize_language_func=lambda language, default='ru': language,
            ensure_pinned_chats_table_func=lambda conn: None,
            format_sidebar_time_func=lambda raw, *, language: '',
            build_initial_last_message_preview_func=lambda raw, *, blocked_by_me, blocked_me, language: '',
            get_safe_avatar_url_func=lambda row, viewer_id: None,
            is_effectively_online_func=lambda pub, *, persisted=False: bool(persisted),
        )

    assert len(contacts) == 1
    assert contacts[0]['display_name'] == '\u0418\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0435'
    assert contacts[0]['userId'] == 1


def test_fetch_contacts_for_user_keeps_saved_messages_when_self_contacts_hidden(tmp_path):
    db_path = tmp_path / 'contacts-list-handlers-self-chat-hidden.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (
                id, username, display_name, public_key, avatar_url, avatar_visibility, is_online, hide_online_status
            )
            VALUES
                (1, 'alice', 'Alice', 'pk-1', NULL, 'all', 1, 0)
            '''
        )
        conn.commit()

        contacts = fetch_contacts_for_user(
            1,
            conn,
            language='ru',
            normalize_language_func=lambda language, default='ru': language,
            ensure_pinned_chats_table_func=lambda conn: None,
            format_sidebar_time_func=lambda raw, *, language: '',
            build_initial_last_message_preview_func=lambda raw, *, blocked_by_me, blocked_me, language: '',
            get_safe_avatar_url_func=lambda row, viewer_id: None,
            is_effectively_online_func=lambda pub, *, persisted=False: bool(persisted),
            include_self_contact=False,
        )

    assert len(contacts) == 1
    assert contacts[0]['display_name'] == '\u0418\u0437\u0431\u0440\u0430\u043d\u043d\u043e\u0435'
    assert contacts[0]['userId'] == 1


def test_fetch_contacts_for_user_prioritizes_draft_preview_and_timestamp(tmp_path):
    db_path = tmp_path / 'contacts-list-handlers-drafts.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (
                id, username, display_name, public_key, avatar_url, avatar_visibility, is_online, hide_online_status
            )
            VALUES
                (1, 'alice', 'Alice', 'pk-1', NULL, 'all', 0, 0),
                (2, 'bob', 'Bob', 'pk-2', NULL, 'all', 0, 0),
                (3, 'carol', 'Carol', 'pk-3', NULL, 'all', 0, 0)
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES
                (1, 2, 'chat-a'),
                (1, 3, 'chat-b')
            '''
        )
        conn.execute(
            '''
            INSERT INTO messages (
                chat_id, sender_id, receiver_id, message, is_read, is_delivered, created_at
            )
            VALUES
                ('chat-a', 2, 1, 'old message', 1, 1, '2026-01-01 10:00:00'),
                ('chat-b', 3, 1, 'new message', 1, 1, '2026-01-01 11:00:00')
            '''
        )
        conn.execute(
            '''
            CREATE TABLE IF NOT EXISTS chat_drafts (
                user_id INTEGER NOT NULL,
                chat_id TEXT NOT NULL,
                draft_text TEXT NOT NULL,
                updated_at TEXT,
                PRIMARY KEY (user_id, chat_id)
            )
            '''
        )
        conn.execute(
            '''
            INSERT INTO chat_drafts (user_id, chat_id, draft_text, updated_at)
            VALUES (1, 'chat-a', 'draft text', '2026-01-01 12:00:00')
            ON CONFLICT (user_id, chat_id) DO UPDATE SET
                draft_text = EXCLUDED.draft_text,
                updated_at = EXCLUDED.updated_at
            '''
        )
        conn.commit()

        contacts = fetch_contacts_for_user(
            1,
            conn,
            language='ru',
            normalize_language_func=lambda language, default='ru': language,
            ensure_pinned_chats_table_func=lambda conn: None,
            format_sidebar_time_func=lambda raw, *, language: f"{language}:{raw}",
            build_initial_last_message_preview_func=lambda raw, *, blocked_by_me, blocked_me, language: raw or '',
            get_safe_avatar_url_func=lambda row, viewer_id: None,
            is_effectively_online_func=lambda pub, *, persisted=False: bool(persisted),
        )

    draft_contact = next(item for item in contacts if item['chatId'] == 'chat-a')
    assert draft_contact['has_draft'] is True
    assert draft_contact['draft_text'] == 'draft text'
    assert draft_contact['draft_updated_at'] == '2026-01-01 12:00:00'
    assert draft_contact['sidebar_time_text'] == 'ru:2026-01-01 12:00:00'


def test_fetch_contacts_for_user_ignores_expired_direct_messages_before_cleanup(tmp_path):
    db_path = tmp_path / 'contacts-list-handlers-expired-direct.db'
    now_ts = int(time.time())
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute('ALTER TABLE messages ADD COLUMN expires_at INTEGER')
        conn.execute(
            '''
            INSERT INTO users (
                id, username, display_name, public_key, avatar_url, avatar_visibility, is_online, hide_online_status
            )
            VALUES
                (1, 'alice', 'Alice', 'pk-1', NULL, 'all', 0, 0),
                (2, 'bob', 'Bob', 'pk-2', NULL, 'all', 0, 0)
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, 'chat-a')
            '''
        )
        conn.execute(
            '''
            INSERT INTO messages (
                chat_id, sender_id, receiver_id, message, is_read, is_delivered, created_at, expires_at
            )
            VALUES
                ('chat-a', 2, 1, 'still visible', 1, 1, '2026-01-01 10:00:00', NULL),
                ('chat-a', 2, 1, 'expired preview', 0, 1, '2026-01-01 10:05:00', ?)
            ''',
            (now_ts - 10,),
        )
        conn.commit()

        contacts = fetch_contacts_for_user(
            1,
            conn,
            language='ru',
            normalize_language_func=lambda language, default='ru': language,
            ensure_pinned_chats_table_func=lambda conn: None,
            format_sidebar_time_func=lambda raw, *, language: f"{language}:{raw}",
            build_initial_last_message_preview_func=lambda raw, *, blocked_by_me, blocked_me, language: raw or '',
            get_safe_avatar_url_func=lambda row, viewer_id: None,
            is_effectively_online_func=lambda pub, *, persisted=False: bool(persisted),
            include_self_contact=False,
        )

    contact = next(item for item in contacts if item['chatId'] == 'chat-a')
    assert contact['last_message'] == 'still visible'
    assert contact['last_message_time'] == '2026-01-01 10:00:00'
    assert contact['sidebar_time_text'] == 'ru:2026-01-01 10:00:00'
    assert contact['unreadCount'] == 0


def test_fetch_contacts_for_user_ignores_expired_group_messages_before_cleanup(tmp_path):
    db_path = tmp_path / 'contacts-list-handlers-expired-group.db'
    now_ts = int(time.time())
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute('ALTER TABLE chats ADD COLUMN chat_type TEXT')
        conn.execute('ALTER TABLE messages ADD COLUMN expires_at INTEGER')
        conn.execute(
            '''
            CREATE TABLE chat_members (
                user_id INTEGER NOT NULL,
                chat_id TEXT NOT NULL
            )
            '''
        )
        conn.execute(
            '''
            CREATE TABLE message_receipts (
                message_id INTEGER NOT NULL,
                user_id INTEGER NOT NULL,
                is_read INTEGER NOT NULL DEFAULT 0,
                is_delivered INTEGER NOT NULL DEFAULT 0,
                deleted_for_user INTEGER NOT NULL DEFAULT 0
            )
            '''
        )
        conn.execute(
            '''
            CREATE TABLE chat_drafts (
                user_id INTEGER NOT NULL,
                chat_id TEXT NOT NULL,
                draft_text TEXT NOT NULL,
                updated_at TEXT,
                PRIMARY KEY (user_id, chat_id)
            )
            '''
        )
        conn.execute(
            '''
            INSERT INTO users (
                id, username, display_name, public_key, avatar_url, avatar_visibility, is_online, hide_online_status
            )
            VALUES
                (1, 'alice', 'Alice', 'pk-1', NULL, 'all', 0, 0),
                (2, 'bob', 'Bob', 'pk-2', NULL, 'all', 0, 0)
            '''
        )
        conn.execute(
            '''
            INSERT INTO chats (chat_id, chat_name, chat_type)
            VALUES ('group-a', 'Group A', 'group')
            '''
        )
        conn.execute(
            '''
            INSERT INTO chat_members (user_id, chat_id)
            VALUES (1, 'group-a'), (2, 'group-a')
            '''
        )
        conn.execute(
            '''
            INSERT INTO messages (
                id, chat_id, sender_id, receiver_id, message, is_read, is_delivered, created_at, expires_at
            )
            VALUES
                (10, 'group-a', 2, 1, 'group visible', 1, 1, '2026-01-01 10:00:00', NULL),
                (11, 'group-a', 2, 1, 'group expired preview', 0, 1, '2026-01-01 10:05:00', ?)
            ''',
            (now_ts - 10,),
        )
        conn.execute(
            '''
            INSERT INTO message_receipts (message_id, user_id, is_read, is_delivered, deleted_for_user)
            VALUES
                (10, 1, 1, 1, 0),
                (11, 1, 0, 1, 0)
            '''
        )
        conn.commit()

        contacts = fetch_contacts_for_user(
            1,
            conn,
            language='ru',
            normalize_language_func=lambda language, default='ru': language,
            ensure_pinned_chats_table_func=lambda conn: conn.execute(
                '''
                CREATE TABLE IF NOT EXISTS pinned_chats (
                    user_id INTEGER NOT NULL,
                    chat_id TEXT NOT NULL,
                    pin_order INTEGER NOT NULL DEFAULT 0,
                    PRIMARY KEY (user_id, chat_id)
                )
                '''
            ),
            format_sidebar_time_func=lambda raw, *, language: f"{language}:{raw}",
            build_initial_last_message_preview_func=lambda raw, *, blocked_by_me, blocked_me, language: raw or '',
            get_safe_avatar_url_func=lambda row, viewer_id: None,
            is_effectively_online_func=lambda pub, *, persisted=False: bool(persisted),
            include_self_contact=False,
        )

    group_contact = next(item for item in contacts if item['chatId'] == 'group-a')
    assert group_contact['last_message'] == 'group visible'
    assert group_contact['last_message_time'] == '2026-01-01 10:00:00'
    assert group_contact['sidebar_time_text'] == 'ru:2026-01-01 10:00:00'
    assert group_contact['unreadCount'] == 0
