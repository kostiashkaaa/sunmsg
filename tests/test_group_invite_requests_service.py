from __future__ import annotations

import sqlite3

from app.services import moderation as moderation_service
from app.services.group_invite_requests import accept_group_invite_request


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(':memory:')
    conn.row_factory = sqlite3.Row
    conn.executescript(
        '''
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            group_invite_privacy TEXT DEFAULT 'all'
        );
        CREATE TABLE contacts (
            user_id INTEGER,
            contact_id INTEGER
        );
        CREATE TABLE chats (
            chat_id TEXT PRIMARY KEY,
            chat_type TEXT
        );
        CREATE TABLE chat_members (
            user_id INTEGER,
            chat_id TEXT,
            role TEXT,
            added_by_user_id INTEGER,
            PRIMARY KEY (user_id, chat_id)
        );
        CREATE TABLE group_invite_requests (
            id INTEGER PRIMARY KEY,
            chat_id TEXT,
            inviter_user_id INTEGER,
            invitee_user_id INTEGER,
            status TEXT,
            responded_at TEXT
        );
        CREATE TABLE block_list (
            blocker_id INTEGER,
            blocked_id INTEGER
        );
        CREATE TABLE moderation_sanctions (
            id INTEGER PRIMARY KEY,
            subject_type TEXT,
            subject_id TEXT,
            action_type TEXT,
            reason_code TEXT,
            expires_at TEXT,
            status TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        '''
    )
    conn.execute("INSERT INTO users (id, group_invite_privacy) VALUES (1, 'all'), (2, 'all')")
    conn.execute("INSERT INTO chats (chat_id, chat_type) VALUES ('g1', 'group')")
    conn.execute("INSERT INTO chat_members (user_id, chat_id, role) VALUES (1, 'g1', 'owner')")
    conn.execute(
        '''
        INSERT INTO group_invite_requests (id, chat_id, inviter_user_id, invitee_user_id, status)
        VALUES (10, 'g1', 1, 2, 'pending')
        '''
    )
    return conn


def test_accept_group_invite_request_rejects_blocked_inviter():
    conn = _conn()
    conn.execute('INSERT INTO block_list (blocker_id, blocked_id) VALUES (2, 1)')

    result = accept_group_invite_request(conn, request_id=10, invitee_user_id=2)

    member = conn.execute("SELECT 1 FROM chat_members WHERE chat_id = 'g1' AND user_id = 2").fetchone()
    assert result == {'status': 'blocked'}
    assert member is None


def test_accept_group_invite_request_rejects_active_group_ban():
    conn = _conn()
    conn.execute(
        '''
        INSERT INTO moderation_sanctions (subject_type, subject_id, action_type, reason_code, status)
        VALUES (?, ?, 'ban_perma', 'manual', 'active')
        ''',
        (
            moderation_service.GROUP_MEMBER_SUBJECT_TYPE,
            moderation_service.make_group_member_subject_id('g1', 2),
        ),
    )

    result = accept_group_invite_request(conn, request_id=10, invitee_user_id=2)

    member = conn.execute("SELECT 1 FROM chat_members WHERE chat_id = 'g1' AND user_id = 2").fetchone()
    assert result['status'] == 'banned'
    assert member is None


def test_accept_group_invite_request_rechecks_privacy_deny():
    conn = _conn()
    conn.execute("UPDATE users SET group_invite_privacy = 'nobody' WHERE id = 2")

    result = accept_group_invite_request(conn, request_id=10, invitee_user_id=2)

    member = conn.execute("SELECT 1 FROM chat_members WHERE chat_id = 'g1' AND user_id = 2").fetchone()
    assert result == {'status': 'invite_denied'}
    assert member is None
