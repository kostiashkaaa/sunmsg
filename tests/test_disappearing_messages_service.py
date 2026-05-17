import sqlite3
import time

from app.services import disappearing_messages


def test_cleanup_expired_messages_notifies_chat_and_participant_rooms(monkeypatch, tmp_path):
    db_path = tmp_path / 'disappearing-service.db'
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(
        '''
        CREATE TABLE users (
            id INTEGER PRIMARY KEY,
            public_key TEXT NOT NULL
        );
        CREATE TABLE chat_members (
            user_id INTEGER NOT NULL,
            chat_id TEXT NOT NULL
        );
        CREATE TABLE messages (
            id INTEGER PRIMARY KEY,
            chat_id TEXT NOT NULL,
            sender_id INTEGER NOT NULL,
            receiver_id INTEGER,
            expires_at INTEGER
        );
        INSERT INTO users (id, public_key)
        VALUES (1, 'pk-sender'), (2, 'pk-receiver');
        INSERT INTO chat_members (user_id, chat_id)
        VALUES (1, 'chat-a'), (2, 'chat-a');
        '''
    )
    conn.execute(
        '''
        INSERT INTO messages (id, chat_id, sender_id, receiver_id, expires_at)
        VALUES (10, 'chat-a', 1, 2, ?);
        ''',
        (int(time.time()) - 5,),
    )
    conn.commit()
    conn.close()

    emitted = []

    def emit_func(event, payload, *, room):
        emitted.append((event, payload, room))

    # Re-opened connections from sqlite3.connect need row access by column name.
    original_connect = sqlite3.connect

    def connect_with_rows(path):
        handle = original_connect(path)
        handle.row_factory = sqlite3.Row
        return handle

    monkeypatch.setattr('app.database.get_db_connection', lambda: connect_with_rows(db_path))

    assert disappearing_messages.cleanup_expired_messages(emit_func=emit_func) == 1
    rooms = {room for event, payload, room in emitted if event == 'messages_expired' and payload['message_ids'] == [10]}
    assert rooms == {'chat-a', 'pk-sender', 'pk-receiver'}
