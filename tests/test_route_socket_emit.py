from app.routes import socket_emit


def test_route_socket_emitter_uses_independent_db_connection(monkeypatch):
    connection_scope_calls = []

    def get_db_connection(*, request_scoped=True):
        connection_scope_calls.append(request_scoped)
        return object()

    def fake_emit_enveloped_socket_event(**kwargs):
        kwargs['get_db_connection_func']()
        return {
            'event_type': kwargs['event_type'],
            'payload': kwargs['payload'],
            'kwargs': kwargs['kwargs'],
        }

    monkeypatch.setattr(socket_emit, 'emit_enveloped_socket_event', fake_emit_enveloped_socket_event)

    emit_socket_event = socket_emit.build_route_socket_emitter(
        raw_emit_func=lambda *args, **kwargs: None,
        get_db_connection_func=get_db_connection,
        logger=None,
    )

    result = emit_socket_event('messages_read', {'chat_id': 'chat-a'}, room='pk-1')

    assert connection_scope_calls == [False]
    assert result == {
        'event_type': 'messages_read',
        'payload': {'chat_id': 'chat-a'},
        'kwargs': {'room': 'pk-1'},
    }
