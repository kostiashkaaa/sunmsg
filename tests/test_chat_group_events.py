from __future__ import annotations

from app.routes import chat_group_events


class _RowCursor:
    def __init__(self, row):
        self._row = row

    def fetchone(self):
        return self._row


class _ConnWithChatRow:
    def __init__(self, row):
        self._row = row

    def execute(self, _query, _params):
        return _RowCursor(self._row)


def test_emit_group_event_sends_to_chat_room_and_member_public_keys(monkeypatch):
    monkeypatch.setattr(
        chat_group_events,
        'list_chat_member_public_keys',
        lambda _conn, _chat_id: [
            {'public_key': 'pk-1'},
            {'public_key': ''},
            {'public_key': 'pk-2'},
        ],
    )
    emitted = []

    def _emit(event_name, payload, room=None):
        emitted.append((event_name, payload, room))

    payload = {'chat_id': 'chat-1', 'delta': 1}
    chat_group_events.emit_group_event(
        object(),
        chat_id='chat-1',
        event_name='group_members_updated',
        payload=payload,
        socketio_emit_func=_emit,
    )

    assert emitted == [
        ('group_members_updated', payload, 'chat-1'),
        ('group_members_updated', payload, 'pk-1'),
        ('group_members_updated', payload, 'pk-2'),
    ]


def test_emit_group_snapshot_builds_payload_and_emits(monkeypatch):
    monkeypatch.setattr(
        chat_group_events,
        'list_chat_member_public_keys',
        lambda _conn, _chat_id: [{'public_key': 'pk-1'}],
    )
    emitted = []

    def _emit(event_name, payload, room=None):
        emitted.append((event_name, payload, room))

    conn = _ConnWithChatRow(
        {
            'chat_id': 'chat-77',
            'chat_name': 'Team',
            'chat_description': 'desc',
            'chat_avatar_url': '/static/avatars/team.png',
        }
    )
    chat_group_events.emit_group_snapshot(
        conn,
        chat_id='chat-77',
        socketio_emit_func=_emit,
    )

    assert emitted[0][0] == 'group_chat_updated'
    assert emitted[0][2] == 'chat-77'
    assert emitted[0][1] == {
        'chat_id': 'chat-77',
        'chat_name': 'Team',
        'chat_description': 'desc',
        'chat_avatar_url': '/static/avatars/team.png',
        'chat_type': 'group',
    }
    assert emitted[1] == ('group_chat_updated', emitted[0][1], 'pk-1')


def test_emit_group_snapshot_skips_when_chat_missing(monkeypatch):
    monkeypatch.setattr(
        chat_group_events,
        'list_chat_member_public_keys',
        lambda _conn, _chat_id: [{'public_key': 'pk-1'}],
    )
    emitted = []

    conn = _ConnWithChatRow(None)
    chat_group_events.emit_group_snapshot(
        conn,
        chat_id='chat-404',
        socketio_emit_func=lambda *args, **kwargs: emitted.append((args, kwargs)),
    )

    assert emitted == []
