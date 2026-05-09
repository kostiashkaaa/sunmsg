from __future__ import annotations

import sqlite3

from app.services import moderation as moderation_service
from app.services.group_chat_profile_service import build_group_chat_profile_payload


def _connect_in_memory() -> sqlite3.Connection:
    conn = sqlite3.connect(':memory:')
    conn.row_factory = sqlite3.Row
    conn.execute(
        '''
        CREATE TABLE chats (
            chat_id TEXT PRIMARY KEY,
            chat_name TEXT,
            chat_description TEXT,
            chat_avatar_url TEXT,
            created_by_user_id INTEGER
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT,
            display_name TEXT,
            public_key TEXT,
            avatar_url TEXT,
            avatar_visibility TEXT,
            is_online INTEGER,
            last_seen TEXT,
            hide_online_status INTEGER
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE chat_members (
            user_id INTEGER,
            chat_id TEXT,
            role TEXT
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE moderation_sanctions (
            id INTEGER PRIMARY KEY,
            subject_type TEXT,
            subject_id TEXT,
            action_type TEXT,
            reason_code TEXT,
            expires_at TEXT,
            status TEXT,
            created_at TEXT
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE moderation_appeals (
            id INTEGER PRIMARY KEY,
            sanction_id INTEGER,
            appellant_user_id INTEGER,
            state TEXT,
            created_at TEXT
        )
        '''
    )
    return conn


def test_build_group_chat_profile_payload_includes_members_permissions_and_appeal():
    conn = _connect_in_memory()
    chat_id = 'a' * 64
    try:
        conn.execute(
            '''
            INSERT INTO chats (chat_id, chat_name, chat_description, chat_avatar_url, created_by_user_id)
            VALUES (?, 'Core Team', 'desc', '/static/group.png', 1)
            ''',
            (chat_id,),
        )
        conn.execute(
            '''
            INSERT INTO users (id, username, display_name, public_key, avatar_url, avatar_visibility, is_online, last_seen, hide_online_status)
            VALUES
                (1, 'alice', 'Alice', 'pk-1', '/static/a.png', 'public', 1, NULL, 0),
                (2, 'bob', 'Bob', 'pk-2', '/static/b.png', 'public', 0, '2026-01-01 10:00:00', 0)
            '''
        )
        conn.execute(
            '''
            INSERT INTO chat_members (user_id, chat_id, role)
            VALUES
                (1, ?, 'owner'),
                (2, ?, 'member')
            ''',
            (chat_id, chat_id),
        )

        subject_id = moderation_service.make_group_member_subject_id(chat_id, 2)
        conn.execute(
            '''
            INSERT INTO moderation_sanctions (id, subject_type, subject_id, action_type, reason_code, expires_at, status, created_at)
            VALUES (10, ?, ?, 'mute_temp', 'flood', NULL, 'active', '2026-01-01 09:00:00')
            ''',
            (moderation_service.GROUP_MEMBER_SUBJECT_TYPE, subject_id),
        )
        conn.execute(
            '''
            INSERT INTO moderation_appeals (id, sanction_id, appellant_user_id, state, created_at)
            VALUES (11, 10, 2, 'submitted', '2026-01-01 09:10:00')
            '''
        )
        conn.commit()

        payload = build_group_chat_profile_payload(
            conn=conn,
            chat_id=chat_id,
            viewer_user_id=2,
            get_safe_avatar_url_func=lambda row, _: f"/safe/{row['user_id']}.png",
            is_effectively_online_func=lambda public_key, persisted=False: public_key == 'pk-2' or bool(persisted),
        )
    finally:
        conn.close()

    assert payload is not None
    assert payload['success'] is True
    assert payload['_group_profile'] is True
    assert payload['chat_id'] == chat_id
    assert payload['members_count'] == 2
    assert payload['my_role'] == 'member'
    assert payload['permissions']['can_invite'] is False
    assert payload['permissions']['can_change_group_settings'] is False
    assert payload['group_permissions']['members_can_send_messages'] is True
    assert payload['group_permissions']['members_can_add_members'] is False
    assert payload['group_permissions']['slow_mode_seconds'] == 0
    assert payload['my_active_group_sanction']['sanction_id'] == 10
    assert payload['my_pending_group_appeal']['appeal_id'] == 11
    assert [m['user_id'] for m in payload['members']] == [1, 2]
    assert payload['members'][0]['avatar_url'] == '/safe/1.png'
    assert payload['members'][1]['online'] is True


def test_build_group_chat_profile_payload_returns_none_when_chat_missing():
    conn = _connect_in_memory()
    try:
        payload = build_group_chat_profile_payload(
            conn=conn,
            chat_id='missing',
            viewer_user_id=1,
        )
    finally:
        conn.close()

    assert payload is None
