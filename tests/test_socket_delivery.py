from pathlib import Path

from app.sockets.delivery import collect_and_mark_delivered, emit_delivered_events
from tests._pg_test_db import connect_test_db


def _connect(db_path: Path):
    return connect_test_db(db_path)


def _prepare_schema(conn) -> None:
    conn.execute(
        '''
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            public_key TEXT
        )
        '''
    )
    conn.execute(
        '''
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY,
            chat_id TEXT NOT NULL,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER NOT NULL,
            message TEXT,
            is_delivered INTEGER NOT NULL DEFAULT 0
        )
        '''
    )
    conn.commit()


def test_collect_and_mark_delivered_updates_only_target_rows(tmp_path):
    db_path = tmp_path / 'socket-delivery.db'
    with _connect(db_path) as conn:
        _prepare_schema(conn)
        conn.execute("INSERT INTO users (id, public_key) VALUES (1, 'pk-1'), (2, 'pk-2')")
        conn.execute(
            '''
            INSERT INTO messages (id, chat_id, sender_id, receiver_id, message, is_delivered)
            VALUES
                (1, 'chat-a', 1, 2, 'm1', 0),
                (2, 'chat-a', 1, 2, 'm2', 0),
                (3, 'chat-b', 1, 2, 'm3', 0),
                (4, 'chat-a', 1, 2, 'm4', 1),
                (5, 'chat-a', 2, 1, 'm5', 0)
            '''
        )
        conn.commit()

        rows = collect_and_mark_delivered(conn, 2, chat_id='chat-a')
        conn.commit()

    assert [row['id'] for row in rows] == [1, 2]

    with _connect(db_path) as conn:
        status = conn.execute(
            '''
            SELECT id, is_delivered
            FROM messages
            ORDER BY id
            '''
        ).fetchall()

    status_by_id = {row['id']: int(row['is_delivered']) for row in status}
    assert status_by_id == {
        1: 1,
        2: 1,
        3: 0,
        4: 1,
        5: 0,
    }


def test_emit_delivered_events_groups_by_sender_and_chat():
    emitted = []

    def _emit(name, payload, **kwargs):
        emitted.append((name, payload, kwargs))

    rows = [
        {'id': 1, 'chat_id': 'chat-a', 'sender_public_key': 'pk-1'},
        {'id': 2, 'chat_id': 'chat-a', 'sender_public_key': 'pk-1'},
        {'id': 3, 'chat_id': 'chat-b', 'sender_public_key': 'pk-1'},
        {'id': 4, 'chat_id': 'chat-b', 'sender_public_key': 'pk-2'},
        {'id': 5, 'chat_id': 'chat-c', 'sender_public_key': ''},
    ]

    emit_delivered_events(rows, emit_func=_emit)

    assert emitted == [
        (
            'messages_delivered',
            {'chat_id': 'chat-a', 'message_ids': [1, 2]},
            {'room': 'pk-1'},
        ),
        (
            'messages_delivered',
            {'chat_id': 'chat-b', 'message_ids': [3]},
            {'room': 'pk-1'},
        ),
        (
            'messages_delivered',
            {'chat_id': 'chat-b', 'message_ids': [4]},
            {'room': 'pk-2'},
        ),
    ]
