import sqlite3
from datetime import datetime, timedelta, timezone

from app.services import moderation as moderation_service
from app.services.group_invite_links import consume_invite_link


def _conn():
    conn = sqlite3.connect(':memory:')
    conn.row_factory = sqlite3.Row
    conn.executescript(
        '''
        CREATE TABLE chats (
            chat_id TEXT PRIMARY KEY,
            chat_name TEXT,
            chat_avatar_url TEXT,
            chat_description TEXT
        );
        CREATE TABLE chat_members (
            user_id INTEGER NOT NULL,
            chat_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            PRIMARY KEY (user_id, chat_id)
        );
        CREATE TABLE group_invite_links (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            chat_id TEXT NOT NULL,
            token TEXT NOT NULL UNIQUE,
            created_by INTEGER NOT NULL,
            max_uses INTEGER DEFAULT NULL,
            uses_count INTEGER NOT NULL DEFAULT 0,
            expires_at TIMESTAMP DEFAULT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );
        '''
    )
    conn.execute(
        'INSERT INTO chats (chat_id, chat_name, chat_avatar_url, chat_description) VALUES (?, ?, ?, ?)',
        ('g1', 'Group', '', ''),
    )
    conn.execute(
        '''
        INSERT INTO group_invite_links (chat_id, token, created_by, max_uses, uses_count, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
        ''',
        ('g1', 'tok', 1, 1, 0),
    )
    return conn


def test_consume_invite_link_reserves_use_atomically_before_success():
    conn = _conn()

    result = consume_invite_link(conn, 'tok', 2)
    assert result == {'chat_id': 'g1', 'already_member': False}

    link = conn.execute('SELECT uses_count FROM group_invite_links WHERE token = ?', ('tok',)).fetchone()
    member = conn.execute('SELECT 1 FROM chat_members WHERE user_id = ? AND chat_id = ?', (2, 'g1')).fetchone()
    assert int(link['uses_count']) == 1
    assert member is not None


def test_consume_invite_link_does_not_add_member_after_limit_reached():
    conn = _conn()
    conn.execute('UPDATE group_invite_links SET uses_count = max_uses WHERE token = ?', ('tok',))

    result = consume_invite_link(conn, 'tok', 2)
    assert result is None

    member = conn.execute('SELECT 1 FROM chat_members WHERE user_id = ? AND chat_id = ?', (2, 'g1')).fetchone()
    assert member is None


def test_consume_invite_link_does_not_increment_for_existing_member():
    conn = _conn()
    conn.execute('INSERT INTO chat_members (user_id, chat_id, role) VALUES (?, ?, ?)', (2, 'g1', 'member'))

    result = consume_invite_link(conn, 'tok', 2)
    assert result == {'chat_id': 'g1', 'already_member': True}

    link = conn.execute('SELECT uses_count FROM group_invite_links WHERE token = ?', ('tok',)).fetchone()
    assert int(link['uses_count']) == 0


def test_consume_invite_link_removes_pending_member_if_link_expires_before_reserve():
    conn = _conn()
    expired_at = (datetime.now(timezone.utc).replace(tzinfo=None) - timedelta(seconds=1)).isoformat()
    conn.execute('UPDATE group_invite_links SET expires_at = ? WHERE token = ?', (expired_at, 'tok'))

    result = consume_invite_link(conn, 'tok', 2)
    assert result is None

    member = conn.execute('SELECT 1 FROM chat_members WHERE user_id = ? AND chat_id = ?', (2, 'g1')).fetchone()
    link = conn.execute('SELECT uses_count FROM group_invite_links WHERE token = ?', ('tok',)).fetchone()
    assert member is None
    assert int(link['uses_count']) == 0


def test_consume_invite_link_rejects_active_group_ban():
    conn = _conn()
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
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        '''
    )
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

    result = consume_invite_link(conn, 'tok', 2)

    member = conn.execute('SELECT 1 FROM chat_members WHERE user_id = ? AND chat_id = ?', (2, 'g1')).fetchone()
    link = conn.execute('SELECT uses_count FROM group_invite_links WHERE token = ?', ('tok',)).fetchone()
    assert result is not None
    assert result['blocked_by_group_ban'] is True
    assert member is None
    assert int(link['uses_count']) == 0
