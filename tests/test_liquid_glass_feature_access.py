import sqlite3

from app.services.liquid_glass_feature_access import (
    can_user_use_liquid_glass,
    grant_liquid_glass_access,
    liquid_glass_feature_state,
    revoke_liquid_glass_access,
    set_liquid_glass_allowlist_enabled,
)


def _conn():
    conn = sqlite3.connect(':memory:')
    conn.row_factory = sqlite3.Row
    conn.executescript(
        '''
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL,
            display_name TEXT NOT NULL,
            avatar_url TEXT
        );
        CREATE TABLE liquid_glass_feature_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_by_user_id INTEGER,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE liquid_glass_feature_allowlist (
            user_id INTEGER PRIMARY KEY,
            granted_by_user_id INTEGER,
            note TEXT NOT NULL DEFAULT '',
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        INSERT INTO users (id, username, display_name, avatar_url)
        VALUES (1, 'alice', 'Alice', ''), (2, 'bob', 'Bob', '');
        INSERT INTO liquid_glass_feature_settings (key, value)
        VALUES ('allowlist_enabled', '1');
        '''
    )
    return conn


def test_liquid_glass_allowlist_blocks_users_by_default():
    conn = _conn()

    assert can_user_use_liquid_glass(conn, user_id=1) is False


def test_liquid_glass_allowlist_grants_by_username_and_revokes():
    conn = _conn()

    granted = grant_liquid_glass_access(conn, identifier='@alice', granted_by_user_id=2, note='test')

    assert granted['user_id'] == 1
    assert can_user_use_liquid_glass(conn, user_id=1) is True
    state = liquid_glass_feature_state(conn)
    assert state['allowlist_enabled'] is True
    assert state['allowed_users'][0]['username'] == 'alice'
    assert state['allowed_users'][0]['note'] == 'test'

    assert revoke_liquid_glass_access(conn, user_id=1) is True
    assert can_user_use_liquid_glass(conn, user_id=1) is False


def test_liquid_glass_open_mode_allows_everyone():
    conn = _conn()

    set_liquid_glass_allowlist_enabled(conn, enabled=False, actor_user_id=1)

    assert can_user_use_liquid_glass(conn, user_id=1) is True
    assert can_user_use_liquid_glass(conn, user_id=2) is True
