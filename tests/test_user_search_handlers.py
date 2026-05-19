from pathlib import Path

from app.routes.user_search_handlers import (
    build_search_users_payload,
    fetch_public_search_results,
)
from tests._pg_test_db import connect_test_db


def _connect(db_path: Path):
    return connect_test_db(db_path)


def _prepare_schema(conn):
    conn.execute(
        '''
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            public_key TEXT,
            username TEXT,
            display_name TEXT,
            avatar_url TEXT,
            avatar_visibility TEXT DEFAULT 'all',
            group_invite_privacy TEXT DEFAULT 'all',
            public_key_search_privacy TEXT DEFAULT 'all',
            is_public INTEGER NOT NULL DEFAULT 1
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
    conn.execute(
        '''
        CREATE TABLE contacts (
            user_id INTEGER NOT NULL,
            contact_id INTEGER NOT NULL,
            chat_id TEXT
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE dialog_requests (
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP
        )
        '''
    )
    conn.commit()


def _like_pattern(value: str) -> str:
    escaped = str(value or '').replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    return f'%{escaped}%'


def test_fetch_public_search_results_filters_private_and_blocked(tmp_path):
    db_path = tmp_path / 'user-search-public.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, is_public)
            VALUES
                (1, 'pk-1', 'owner', 'Owner', 1),
                (2, 'pk-2', 'alpha_one', 'Alpha One', 1),
                (3, 'pk-3', 'alpha_two', 'Alpha Two', 0),
                (4, 'pk-4', 'alpha_three', 'Alpha Three', 1)
            '''
        )
        conn.execute(
            '''
            INSERT INTO block_list (blocker_id, blocked_id)
            VALUES (1, 4)
            '''
        )
        conn.commit()

        results = fetch_public_search_results(conn, user_id=1, query='alpha')

    assert [item['userId'] for item in results] == [2]


def test_build_search_users_payload_short_query_returns_empty(tmp_path):
    db_path = tmp_path / 'user-search-short.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        payload = build_search_users_payload(
            conn,
            user_id=1,
            query='al',
            limit=20,
            offset=0,
            min_query_length=3,
            like_pattern_func=_like_pattern,
            get_safe_avatar_url_func=lambda row, viewer_id: dict(row).get('avatar_url'),
        )

    assert payload['success'] is True
    assert payload['results'] == []
    assert payload['min_query_length'] == 3


def test_build_search_users_payload_key_query_keeps_public_key(tmp_path):
    db_path = tmp_path / 'user-search-key.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        target_key = (
            '-----BEGIN PUBLIC KEY-----\n'
            'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtargetkeymaterial1234567890\n'
            '-----END PUBLIC KEY-----'
        )
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, avatar_url, is_public)
            VALUES
                (1, 'pk-1', 'owner', 'Owner', '/owner.png', 1),
                (2, ?, 'hidden_user', 'Hidden User', '/hidden.png', 0)
            ''',
            (target_key,),
        )
        conn.commit()

        payload = build_search_users_payload(
            conn,
            user_id=1,
            query=target_key,
            limit=5,
            offset=0,
            min_query_length=3,
            like_pattern_func=_like_pattern,
            get_safe_avatar_url_func=lambda row, viewer_id: dict(row).get('avatar_url'),
        )

    assert payload['success'] is True
    assert len(payload['results']) == 1
    assert payload['results'][0]['userId'] == 2
    assert payload['results'][0]['public_key'] == target_key


def test_build_search_users_payload_key_query_respects_public_key_privacy(tmp_path):
    db_path = tmp_path / 'user-search-key-privacy.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        target_key = (
            '-----BEGIN PUBLIC KEY-----\n'
            'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtargetkeymaterial1234567890\n'
            '-----END PUBLIC KEY-----'
        )
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, public_key_search_privacy, is_public)
            VALUES
                (1, 'pk-1', 'owner', 'Owner', 'all', 1),
                (2, ?, 'hidden_key', 'Hidden Key', 'nobody', 1)
            ''',
            (target_key,),
        )
        conn.commit()

        payload = build_search_users_payload(
            conn,
            user_id=1,
            query=target_key,
            limit=5,
            offset=0,
            min_query_length=3,
            like_pattern_func=_like_pattern,
            get_safe_avatar_url_func=lambda row, viewer_id: dict(row).get('avatar_url'),
        )

    assert payload['success'] is True
    assert payload['results'] == []


def test_build_search_users_payload_sets_group_add_direct_flag(tmp_path):
    db_path = tmp_path / 'user-search-group-add-direct.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, group_invite_privacy, is_public)
            VALUES
                (1, 'pk-1', 'owner', 'Owner', 'all', 1),
                (2, 'pk-2', 'blocked_invite', 'Blocked Invite', 'nobody', 1),
                (3, 'pk-3', 'needs_contact', 'Needs Contact', 'contacts', 1),
                (4, 'pk-4', 'allowed_all', 'Allowed All', 'all', 1)
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (3, 1, 'chat-31')
            '''
        )
        conn.commit()

        payload = build_search_users_payload(
            conn,
            user_id=1,
            query='invite',
            limit=20,
            offset=0,
            min_query_length=3,
            like_pattern_func=_like_pattern,
            get_safe_avatar_url_func=lambda row, viewer_id: dict(row).get('avatar_url'),
        )
        by_username = {str(item['username']): item for item in payload['results']}

    assert by_username['blocked_invite']['can_group_add_direct'] is False

    with _connect(db_path) as conn:
        payload_contacts = build_search_users_payload(
            conn,
            user_id=1,
            query='needs',
            limit=20,
            offset=0,
            min_query_length=3,
            like_pattern_func=_like_pattern,
            get_safe_avatar_url_func=lambda row, viewer_id: dict(row).get('avatar_url'),
        )
    by_username_contacts = {str(item['username']): item for item in payload_contacts['results']}
    assert by_username_contacts['needs_contact']['can_group_add_direct'] is True


def test_build_search_users_payload_includes_relationship_status(tmp_path):
    db_path = tmp_path / 'user-search-relationship.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name, is_public)
            VALUES
                (1, 'pk-1', 'owner', 'Owner', 1),
                (2, 'pk-2', 'alpha_contact', 'Alpha Contact', 1),
                (3, 'pk-3', 'alpha_outgoing', 'Alpha Outgoing', 1),
                (4, 'pk-4', 'alpha_incoming', 'Alpha Incoming', 1),
                (5, 'pk-5', 'alpha_none', 'Alpha None', 1)
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, 'chat-12')
            '''
        )
        conn.execute(
            '''
            INSERT INTO dialog_requests (sender_id, receiver_id, status)
            VALUES
                (1, 3, 'pending'),
                (4, 1, 'pending'),
                (5, 1, 'declined')
            '''
        )
        conn.commit()

        payload = build_search_users_payload(
            conn,
            user_id=1,
            query='alpha',
            limit=20,
            offset=0,
            min_query_length=3,
            like_pattern_func=_like_pattern,
            get_safe_avatar_url_func=lambda row, viewer_id: dict(row).get('avatar_url'),
        )

    by_username = {str(item['username']): item for item in payload['results']}
    assert by_username['alpha_contact']['relationship_status'] == 'contact'
    assert by_username['alpha_contact']['is_contact'] is True
    assert by_username['alpha_contact']['chat_id'] == 'chat-12'
    assert by_username['alpha_outgoing']['relationship_status'] == 'outgoing_request'
    assert by_username['alpha_outgoing']['pending_outgoing_request'] is True
    assert by_username['alpha_incoming']['relationship_status'] == 'incoming_request'
    assert by_username['alpha_incoming']['pending_incoming_request'] is True
    assert by_username['alpha_incoming']['public_key'] == 'pk-4'
    assert by_username['alpha_none']['relationship_status'] == 'none'
    assert 'public_key' not in by_username['alpha_none']
