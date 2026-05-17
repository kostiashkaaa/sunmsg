import sqlite3

from app.routes.call_routes import (
    _normalize_ice_transport_policy,
    _parse_turn_urls,
    _user_belongs_to_call_chat,
)
from app.services.turn_pool import select_turn_relays


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


def test_normalize_ice_transport_policy_accepts_only_browser_values():
    assert _normalize_ice_transport_policy('relay') == 'relay'
    assert _normalize_ice_transport_policy(' all ') == 'all'
    assert _normalize_ice_transport_policy('public') == 'all'
    assert _normalize_ice_transport_policy('') == 'all'


def test_select_turn_relays_prefers_healthy_pool_entries_by_score():
    selection = select_turn_relays(
        pool_raw='''
        [
          {
            "id": "low",
            "urls": ["turn:low.example.com:3478?transport=udp"],
            "health_score": 50
          },
          {
            "id": "disabled",
            "urls": ["turn:disabled.example.com:3478?transport=udp"],
            "health_score": 100,
            "enabled": false
          },
          {
            "id": "dead",
            "urls": ["turn:dead.example.com:3478?transport=udp"],
            "health_score": 0
          },
          {
            "id": "high",
            "urls": [
              "turn:high.example.com:3478?transport=udp",
              "turns:high.example.com:5349?transport=tcp"
            ],
            "health_score": 95
          }
        ]
        ''',
        legacy_urls_raw='turn:legacy.example.com:3478?transport=udp',
        limit=2,
    )

    assert selection.source == 'pool'
    assert selection.pool_configured is True
    assert selection.selected_ids == ['high', 'low']
    assert selection.urls_count == 3


def test_select_turn_relays_falls_back_to_legacy_urls_when_pool_is_absent():
    selection = select_turn_relays(
        pool_raw='',
        legacy_urls_raw=(
            'turn:legacy.example.com:3478?transport=udp,'
            'https://example.com/not-turn'
        ),
        limit=2,
    )

    assert selection.source == 'legacy'
    assert selection.pool_configured is False
    assert selection.selected_ids == ['legacy']
    assert selection.urls_count == 1


def test_select_turn_relays_does_not_return_unhealthy_pool_relays():
    selection = select_turn_relays(
        pool_raw='[{"id":"dead","urls":["turn:dead.example.com:3478?transport=udp"],"score":0}]',
        legacy_urls_raw='turn:legacy.example.com:3478?transport=udp',
        limit=2,
    )

    assert selection.source == 'pool'
    assert selection.pool_configured is True
    assert selection.selected_ids == []
    assert selection.urls_count == 0


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
