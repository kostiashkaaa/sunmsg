from pathlib import Path

from app.routes.public_user_card_handlers import (
    process_public_user_card,
    resolve_public_user_card_context,
)
from tests._pg_test_db import connect_test_db


def _connect(db_path: Path):
    return connect_test_db(db_path)


def _prepare_schema(conn):
    conn.execute(
        '''
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            username TEXT NOT NULL,
            display_name TEXT NOT NULL,
            avatar_url TEXT,
            avatar_visibility TEXT DEFAULT 'all',
            is_public INTEGER NOT NULL DEFAULT 1,
            bio TEXT
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


def test_resolve_public_user_card_context_returns_target_missing(tmp_path):
    db_path = tmp_path / 'public-card-handler-missing.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)

        result = resolve_public_user_card_context(
            conn,
            target_username='missing',
            viewer_id=None,
            viewer_row=None,
            normalize_block_state_func=lambda state: state,
            build_block_state_func=lambda conn, a, b: {'is_blocked': False},
            get_safe_avatar_url_func=lambda payload, viewer_id: payload.get('avatar_url'),
        )

    assert result == {'status': 'target_missing'}


def test_resolve_public_user_card_context_hides_private_profile_for_guest(tmp_path):
    db_path = tmp_path / 'public-card-handler-private.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, username, display_name, is_public)
            VALUES (2, 'hidden_user', 'Hidden User', 0)
            '''
        )
        conn.commit()

        result = resolve_public_user_card_context(
            conn,
            target_username='hidden_user',
            viewer_id=None,
            viewer_row=None,
            normalize_block_state_func=lambda state: state,
            build_block_state_func=lambda conn, a, b: {'is_blocked': False},
            get_safe_avatar_url_func=lambda payload, viewer_id: payload.get('avatar_url'),
        )

    assert result == {'status': 'target_private'}


def test_resolve_public_user_card_context_returns_flags_for_contact(tmp_path):
    db_path = tmp_path / 'public-card-handler-contact.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, username, display_name, avatar_url, is_public, bio)
            VALUES
                (1, 'alice', 'Alice', '/a.png', 1, 'viewer'),
                (2, 'bob', 'Bob', '/b.png', 0, ' target ')
            '''
        )
        conn.execute(
            '''
            INSERT INTO contacts (user_id, contact_id, chat_id)
            VALUES (1, 2, 'chat-12')
            '''
        )
        conn.commit()

        result = resolve_public_user_card_context(
            conn,
            target_username='bob',
            viewer_id=1,
            viewer_row={'username': 'alice'},
            normalize_block_state_func=lambda state: {
                'is_blocked': bool((state or {}).get('is_blocked')),
                'blocked_by_me': bool((state or {}).get('blocked_by_me')),
                'blocked_me': bool((state or {}).get('blocked_me')),
            },
            build_block_state_func=lambda conn, a, b: {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
            get_safe_avatar_url_func=lambda payload, viewer_id: payload.get('avatar_url'),
        )

    assert result['status'] == 'ok'
    assert result['profile']['username'] == 'bob'
    assert result['profile']['bio'] == 'target'
    assert result['viewer']['username'] == 'alice'
    assert result['can_message'] is True
    assert result['can_open_chat'] is True
    assert result['can_send_request'] is False


def test_process_public_user_card_maps_not_found_statuses():
    result = process_public_user_card(
        object(),
        target_username='bob',
        viewer_id=1,
        viewer_row={'username': 'alice'},
        resolve_public_user_card_context_func=lambda conn, **kwargs: {'status': 'target_missing'},
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
        get_safe_avatar_url_func=lambda payload, viewer_id: None,
    )
    assert result == {'status': 'not_found'}

    result = process_public_user_card(
        object(),
        target_username='bob',
        viewer_id=1,
        viewer_row={'username': 'alice'},
        resolve_public_user_card_context_func=lambda conn, **kwargs: {'status': 'target_private'},
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
        get_safe_avatar_url_func=lambda payload, viewer_id: None,
    )
    # target_private returns a stub page (200) rather than 404 so the caller
    # can render a "this profile is private" message instead of a hard 404.
    assert result == {'status': 'private', 'username': 'bob'}


def test_process_public_user_card_returns_ok_payload():
    payload = {
        'status': 'ok',
        'profile': {'id': 2},
        'viewer': {'user_id': 1},
        'can_message': True,
        'can_open_chat': False,
        'can_send_request': True,
        'block_state': {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
    }
    result = process_public_user_card(
        object(),
        target_username='bob',
        viewer_id=1,
        viewer_row={'username': 'alice'},
        resolve_public_user_card_context_func=lambda conn, **kwargs: payload,
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
        get_safe_avatar_url_func=lambda payload, viewer_id: None,
    )
    assert result == payload
