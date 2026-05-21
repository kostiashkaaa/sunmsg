from pathlib import Path

from app.routes.dialog_request_handlers import (
    build_accept_request_socket_events,
    build_decline_request_socket_event,
    fetch_pending_dialog_requests_for_user,
    fetch_pending_outgoing_dialog_requests_for_user,
)
from tests._pg_test_db import connect_test_db


def _connect(db_path: Path):
    return connect_test_db(db_path)


def _prepare_schema(conn):
    conn.execute(
        '''
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            public_key TEXT NOT NULL,
            username TEXT NOT NULL,
            display_name TEXT NOT NULL
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE dialog_requests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            status TEXT NOT NULL
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


def test_fetch_pending_dialog_requests_for_user_filters_blocked_pairs(tmp_path):
    db_path = tmp_path / 'dialog-requests-pending.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES
                (1, 'pk-1', 'alice', 'Alice'),
                (2, 'pk-2', 'bob', 'Bob'),
                (3, 'pk-3', 'carol', 'Carol'),
                (4, 'pk-4', 'dave', 'Dave')
            '''
        )
        conn.execute(
            '''
            INSERT INTO dialog_requests (sender_id, receiver_id, status)
            VALUES
                (2, 1, 'pending'),
                (3, 1, 'pending'),
                (4, 1, 'accepted')
            '''
        )
        conn.execute(
            '''
            INSERT INTO block_list (blocker_id, blocked_id)
            VALUES
                (1, 3)
            '''
        )
        conn.commit()

        requests = fetch_pending_dialog_requests_for_user(conn, user_id=1)

    assert requests == [
        {
            'request_direction': 'incoming',
            'sender_public_key': 'pk-2',
            'sender_username': 'bob',
            'sender_display_name': 'Bob',
        }
    ]


def test_fetch_pending_outgoing_dialog_requests_for_user_filters_blocked_pairs(tmp_path):
    db_path = tmp_path / 'dialog-requests-outgoing.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute(
            '''
            INSERT INTO users (id, public_key, username, display_name)
            VALUES
                (1, 'pk-1', 'alice', 'Alice'),
                (2, 'pk-2', 'bob', 'Bob'),
                (3, 'pk-3', 'carol', 'Carol'),
                (4, 'pk-4', 'dave', 'Dave')
            '''
        )
        conn.execute(
            '''
            INSERT INTO dialog_requests (sender_id, receiver_id, status)
            VALUES
                (1, 2, 'pending'),
                (1, 3, 'pending'),
                (1, 4, 'accepted')
            '''
        )
        conn.execute(
            '''
            INSERT INTO block_list (blocker_id, blocked_id)
            VALUES
                (3, 1)
            '''
        )
        conn.commit()

        requests = fetch_pending_outgoing_dialog_requests_for_user(conn, user_id=1)

    assert requests == [
        {
            'request_direction': 'outgoing',
            'receiver_user_id': 2,
            'receiver_public_key': 'pk-2',
            'receiver_username': 'bob',
            'receiver_display_name': 'Bob',
        }
    ]


def test_build_accept_request_socket_events_builds_payloads_and_rooms():
    sender = {
        'id': 1,
        'username': 'alice',
        'display_name': 'Alice',
        'public_key': 'pk-1',
    }
    receiver = {
        'id': 2,
        'username': 'bob',
        'display_name': 'Bob',
        'public_key': 'pk-2',
    }
    avatar_calls: list[tuple[int, int]] = []

    def _fake_avatar(user, viewer_id):
        avatar_calls.append((int(user['id']), viewer_id))
        return f"avatar-{user['id']}-for-{viewer_id}"

    events = build_accept_request_socket_events(
        chat_id='chat-1',
        sender=sender,
        receiver=receiver,
        receiver_user_id=2,
        sender_public_key='pk-1',
        get_safe_avatar_url_func=_fake_avatar,
    )

    assert avatar_calls == [(1, 2), (2, 1)]
    assert events == [
        {
            'name': 'chat_created',
            'payload': {
                'chat_id': 'chat-1',
                'contact': {
                    'userId': 1,
                    'display_name': 'Alice',
                    'username': 'alice',
                    'public_key': 'pk-1',
                    'chatId': 'chat-1',
                    'last_message': None,
                    'unreadCount': 0,
                    'avatar_url': 'avatar-1-for-2',
                    'blocked_by_me': False,
                    'blocked_me': False,
                    'is_blocked': False,
                },
            },
            'room': 'pk-2',
        },
        {
            'name': 'chat_created',
            'payload': {
                'chat_id': 'chat-1',
                'contact': {
                    'userId': 2,
                    'display_name': 'Bob',
                    'username': 'bob',
                    'public_key': 'pk-2',
                    'chatId': 'chat-1',
                    'last_message': None,
                    'unreadCount': 0,
                    'avatar_url': 'avatar-2-for-1',
                    'blocked_by_me': False,
                    'blocked_me': False,
                    'is_blocked': False,
                },
            },
            'room': 'pk-1',
        },
        {
            'name': 'dialog_request_updated',
            'payload': {'sender_public_key': 'pk-1', 'action': 'accepted'},
            'room': 'pk-2',
        },
    ]


def test_build_decline_request_socket_event_builds_payload():
    event = build_decline_request_socket_event(
        sender_public_key='pk-1',
        sender_display_name='Bob',
        action='declined',
    )

    assert event == {
        'name': 'dialog_request_updated',
        'payload': {
            'action': 'declined',
            'sender_display_name': 'Bob',
        },
        'room': 'pk-1',
    }
