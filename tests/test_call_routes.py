import sqlite3

from app.routes.call_routes import _parse_turn_urls, _user_belongs_to_call_chat


def test_parse_turn_urls_accepts_comma_separated_turn_and_turns_urls():
    urls = _parse_turn_urls(
        ' turn:turn.example.com:3478?transport=udp,'
        'turn:turn.example.com:3478?transport=tcp,'
        'turns:turn.example.com:5349?transport=tcp,'
        'https://example.com/not-turn '
    )

    assert urls == [
        'turn:turn.example.com:3478?transport=udp',
        'turn:turn.example.com:3478?transport=tcp',
        'turns:turn.example.com:5349?transport=tcp',
    ]


def test_user_belongs_to_call_chat_allows_incoming_callee_before_accept():
    conn = sqlite3.connect(':memory:')
    conn.row_factory = sqlite3.Row
    conn.executescript(
        '''
        CREATE TABLE call_sessions (
            call_id TEXT PRIMARY KEY,
            chat_id TEXT NOT NULL,
            initiator_id INTEGER NOT NULL,
            status TEXT NOT NULL
        );
        CREATE TABLE contacts (
            user_id INTEGER NOT NULL,
            contact_id INTEGER NOT NULL,
            chat_id TEXT NOT NULL
        );
        CREATE TABLE chat_members (
            chat_id TEXT NOT NULL,
            user_id INTEGER NOT NULL
        );
        INSERT INTO call_sessions (call_id, chat_id, initiator_id, status)
        VALUES ('call-1', 'chat-1', 1, 'ringing');
        INSERT INTO contacts (user_id, contact_id, chat_id)
        VALUES (1, 2, 'chat-1'), (2, 1, 'chat-1');
        '''
    )

    assert _user_belongs_to_call_chat(conn, call_id='call-1', user_id=2) is True
    assert _user_belongs_to_call_chat(conn, call_id='call-1', user_id=3) is False
