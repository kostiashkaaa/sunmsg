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
