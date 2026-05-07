from pathlib import Path

from app.services.group_authorization import (
    ACTION_BAN,
    ACTION_CHANGE_ROLE,
    ACTION_INVITE,
    ACTION_PIN,
    authorize_group_action,
)
from tests._pg_test_db import connect_test_db


def _connect(db_path: Path):
    return connect_test_db(db_path)


def _prepare_schema(conn):
    conn.execute('CREATE TABLE users (id INTEGER PRIMARY KEY, public_key TEXT, username TEXT, display_name TEXT)')
    conn.execute(
        '''
        CREATE TABLE chats (
            id INTEGER PRIMARY KEY,
            chat_id TEXT UNIQUE NOT NULL,
            chat_type TEXT NOT NULL DEFAULT 'group',
            created_by_user_id INTEGER
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE chat_members (
            user_id INTEGER NOT NULL,
            chat_id TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'member',
            PRIMARY KEY (user_id, chat_id)
        )
        '''
    )
    conn.commit()


def test_group_authorization_role_hierarchy_for_pin_and_invite(tmp_path):
    db_path = tmp_path / 'group-authz-hierarchy.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO chats (chat_id, chat_type, created_by_user_id) VALUES ('g1', 'group', 1)")
        conn.execute(
            '''
            INSERT INTO chat_members (user_id, chat_id, role)
            VALUES
                (1, 'g1', 'owner'),
                (2, 'g1', 'moderator'),
                (3, 'g1', 'member')
            '''
        )
        conn.commit()

    with _connect(db_path) as conn:
        owner_pin = authorize_group_action(conn, actor_user_id=1, chat_id='g1', action=ACTION_PIN)
        moderator_invite = authorize_group_action(conn, actor_user_id=2, chat_id='g1', action=ACTION_INVITE)
        member_invite = authorize_group_action(conn, actor_user_id=3, chat_id='g1', action=ACTION_INVITE)

    assert owner_pin.allowed is True
    assert moderator_invite.allowed is True
    assert member_invite.allowed is False


def test_group_authorization_disallows_moderator_ban_admin(tmp_path):
    db_path = tmp_path / 'group-authz-ban-admin.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO chats (chat_id, chat_type, created_by_user_id) VALUES ('g2', 'group', 1)")
        conn.execute(
            '''
            INSERT INTO chat_members (user_id, chat_id, role)
            VALUES
                (1, 'g2', 'owner'),
                (2, 'g2', 'admin'),
                (3, 'g2', 'moderator')
            '''
        )
        conn.commit()

    with _connect(db_path) as conn:
        decision = authorize_group_action(
            conn,
            actor_user_id=3,
            chat_id='g2',
            action=ACTION_BAN,
            target_user_id=2,
        )
    assert decision.allowed is False
    assert decision.reason == 'target_role_too_high'


def test_group_authorization_only_owner_can_assign_admin(tmp_path):
    db_path = tmp_path / 'group-authz-assign-admin.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO chats (chat_id, chat_type, created_by_user_id) VALUES ('g3', 'group', 1)")
        conn.execute(
            '''
            INSERT INTO chat_members (user_id, chat_id, role)
            VALUES
                (1, 'g3', 'owner'),
                (2, 'g3', 'admin'),
                (3, 'g3', 'member')
            '''
        )
        conn.commit()

    with _connect(db_path) as conn:
        by_admin = authorize_group_action(
            conn,
            actor_user_id=2,
            chat_id='g3',
            action=ACTION_CHANGE_ROLE,
            target_user_id=3,
            next_role='admin',
        )
        by_owner = authorize_group_action(
            conn,
            actor_user_id=1,
            chat_id='g3',
            action=ACTION_CHANGE_ROLE,
            target_user_id=3,
            next_role='admin',
        )
    assert by_admin.allowed is False
    assert by_owner.allowed is True
