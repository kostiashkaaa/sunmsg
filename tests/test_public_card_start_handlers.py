from pathlib import Path

from app.routes.public_card_start_handlers import (
    process_start_dialog_from_public_card,
    start_dialog_from_public_card_workflow,
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
            public_key TEXT NOT NULL,
            display_name TEXT NOT NULL,
            avatar_url TEXT,
            avatar_visibility TEXT DEFAULT 'all',
            is_public INTEGER NOT NULL DEFAULT 1,
            auto_decline_requests INTEGER NOT NULL DEFAULT 0
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


def test_start_dialog_from_public_card_workflow_returns_open_existing_for_contacts(tmp_path):
    db_path = tmp_path / 'public-card-start-open-existing.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, username, public_key, display_name, is_public)
            VALUES
                (1, 'alice', 'pk-1', 'Alice', 1),
                (2, 'bob', 'pk-2', 'Bob', 1)
            '''
        )
        conn.execute("INSERT INTO contacts (user_id, contact_id, chat_id) VALUES (1, 2, 'chat-12')")
        conn.commit()

        result = start_dialog_from_public_card_workflow(
            conn,
            viewer_id=1,
            viewer_row={'username': 'alice'},
            target_username='bob',
            normalize_block_state_func=lambda state: state,
            build_block_state_func=lambda conn, a, b: {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
            send_dialog_request_workflow_func=lambda **kwargs: {'status': 'ok', 'event': None},
        )

    assert result == {
        'status': 'open_existing',
        'viewer_username': 'alice',
        'target_user_id': 2,
    }


def test_start_dialog_from_public_card_workflow_returns_blocked(tmp_path):
    db_path = tmp_path / 'public-card-start-blocked.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, username, public_key, display_name, is_public)
            VALUES
                (1, 'alice', 'pk-1', 'Alice', 1),
                (2, 'bob', 'pk-2', 'Bob', 1)
            '''
        )
        conn.commit()

        result = start_dialog_from_public_card_workflow(
            conn,
            viewer_id=1,
            viewer_row={'username': 'alice'},
            target_username='bob',
            normalize_block_state_func=lambda state: state,
            build_block_state_func=lambda conn, a, b: {'is_blocked': True, 'blocked_by_me': True, 'blocked_me': False},
            send_dialog_request_workflow_func=lambda **kwargs: {'status': 'ok', 'event': None},
        )

    assert result == {'status': 'blocked'}


def test_start_dialog_from_public_card_workflow_sends_request_when_allowed(tmp_path):
    db_path = tmp_path / 'public-card-start-send-request.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, username, public_key, display_name, is_public, auto_decline_requests)
            VALUES
                (1, 'alice', 'pk-1', 'Alice', 1, 0),
                (2, 'bob', 'pk-2', 'Bob', 1, 0)
            '''
        )
        conn.commit()

        calls = []
        result = start_dialog_from_public_card_workflow(
            conn,
            viewer_id=1,
            viewer_row={'username': 'alice'},
            target_username='bob',
            normalize_block_state_func=lambda state: state,
            build_block_state_func=lambda conn, a, b: {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
            send_dialog_request_workflow_func=lambda *args, **kwargs: calls.append(kwargs) or {
                'status': 'ok',
                'event': {
                    'room': 'pk-2',
                    'payload': {'sender_public_key': 'pk-1'},
                },
            },
        )

    assert len(calls) == 1
    assert result == {
        'status': 'request_sent',
        'event': {
            'room': 'pk-2',
            'payload': {'sender_public_key': 'pk-1'},
        },
    }


def test_process_start_dialog_from_public_card_maps_workflow_statuses():
    def _process(status_payload):
        return process_start_dialog_from_public_card(
            object(),
            viewer_id=1,
            viewer_row={'username': 'alice'},
            target_username='bob',
            start_dialog_from_public_card_workflow_func=lambda conn, **kwargs: status_payload,
            normalize_block_state_func=lambda state: state,
            build_block_state_func=lambda conn, a, b: {},
            send_dialog_request_workflow_func=lambda **kwargs: {'status': 'ok'},
        )

    assert _process({'status': 'target_missing'}) == {'status': 'not_found'}
    assert _process({'status': 'target_private'}) == {'status': 'not_found'}
    assert _process({'status': 'open_self', 'viewer_username': 'alice'}) == {
        'status': 'open_self',
        'viewer_username': 'alice',
    }
    assert _process({'status': 'blocked'}) == {'status': 'blocked'}
    assert _process({'status': 'open_existing', 'viewer_username': 'alice', 'target_user_id': 2}) == {
        'status': 'open_existing',
        'viewer_username': 'alice',
        'target_user_id': 2,
    }
    assert _process({'status': 'auto_decline'}) == {'status': 'auto_decline'}
    assert _process({'status': 'request_sent', 'event': {'room': 'pk-2'}}) == {
        'status': 'request_sent',
        'event': {'room': 'pk-2'},
    }
