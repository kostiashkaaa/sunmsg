from app.routes.dialog_request_route_handlers import (
    process_accept_request,
    process_accept_request_route,
    process_decline_request,
    process_decline_request_route,
    process_get_dialog_requests,
)


def test_process_accept_request_maps_terminal_statuses():
    def _run(status_payload):
        return process_accept_request(
            object(),
            receiver_user_id=2,
            sender_public_key='pk-1',
            accept_dialog_request_workflow_func=lambda conn, **kwargs: status_payload,
            normalize_block_state_func=lambda state: state,
            build_block_state_func=lambda conn, a, b: {},
            generate_chat_id_func=lambda a, b: 'chat-1',
            default_chat_name='Private chat',
            build_accept_request_socket_events_func=lambda **kwargs: [],
            get_safe_avatar_url_func=lambda user, viewer_id: None,
        )

    assert _run({'status': 'sender_missing'}) == {'status': 'sender_missing'}
    assert _run({'status': 'blocked', 'block_state': {'is_blocked': True}}) == {
        'status': 'blocked',
        'block_state': {'is_blocked': True},
    }
    assert _run({'status': 'request_missing'}) == {'status': 'request_missing'}


def test_process_accept_request_builds_events_for_success():
    captured = {}

    def _build_events(**kwargs):
        captured.update(kwargs)
        return [{'name': 'chat_created', 'payload': {'chat_id': 'chat-1'}, 'room': 'pk-2'}]

    result = process_accept_request(
        object(),
        receiver_user_id=2,
        sender_public_key='pk-1',
        accept_dialog_request_workflow_func=lambda conn, **kwargs: {
            'status': 'ok',
            'chat_id': 'chat-1',
            'sender': {'id': 1, 'public_key': 'pk-1'},
            'user_info': {'id': 2, 'public_key': 'pk-2'},
            'sender_public_key': 'pk-1',
        },
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
        generate_chat_id_func=lambda a, b: 'chat-1',
        default_chat_name='Private chat',
        build_accept_request_socket_events_func=_build_events,
        get_safe_avatar_url_func=lambda user, viewer_id: None,
    )

    assert result == {
        'status': 'ok',
        'chat_id': 'chat-1',
        'events': [{'name': 'chat_created', 'payload': {'chat_id': 'chat-1'}, 'room': 'pk-2'}],
    }
    assert captured['chat_id'] == 'chat-1'
    assert captured['receiver_user_id'] == 2
    assert captured['sender_public_key'] == 'pk-1'


def test_process_decline_request_maps_status_and_optional_event():
    sender_missing = process_decline_request(
        object(),
        receiver_user_id=2,
        sender_public_key='pk-1',
        decline_dialog_request_workflow_func=lambda conn, **kwargs: {'status': 'sender_missing'},
        build_decline_request_socket_event_func=lambda **kwargs: {'unexpected': True},
        action='declined',
    )
    assert sender_missing == {'status': 'sender_missing'}

    without_update = process_decline_request(
        object(),
        receiver_user_id=2,
        sender_public_key='pk-1',
        decline_dialog_request_workflow_func=lambda conn, **kwargs: {'status': 'ok', 'updated': False},
        build_decline_request_socket_event_func=lambda **kwargs: {'unexpected': True},
        action='declined',
    )
    assert without_update == {'status': 'ok', 'event': None}

    with_update = process_decline_request(
        object(),
        receiver_user_id=2,
        sender_public_key='pk-1',
        decline_dialog_request_workflow_func=lambda conn, **kwargs: {
            'status': 'ok',
            'updated': True,
            'sender_public_key': 'pk-1',
            'sender_display_name': 'Bob',
        },
        build_decline_request_socket_event_func=lambda **kwargs: {'name': 'dialog_request_updated', 'payload': kwargs},
        action='declined',
    )
    assert with_update['status'] == 'ok'
    assert with_update['event']['name'] == 'dialog_request_updated'
    assert with_update['event']['payload']['action'] == 'declined'


def test_process_get_dialog_requests_maps_success_and_error():
    result = process_get_dialog_requests(
        object(),
        user_id=1,
        fetch_pending_dialog_requests_for_user_func=lambda conn, *, user_id: [{'sender_public_key': 'pk-2'}],
    )
    assert result == {'status': 'ok', 'dialog_requests': [{'sender_public_key': 'pk-2'}]}

    def _raise(*args, **kwargs):
        raise RuntimeError('db down')

    result = process_get_dialog_requests(
        object(),
        user_id=1,
        fetch_pending_dialog_requests_for_user_func=_raise,
    )
    assert result == {'status': 'error'}


def test_process_get_dialog_requests_merges_outgoing_requests():
    result = process_get_dialog_requests(
        object(),
        user_id=1,
        fetch_pending_dialog_requests_for_user_func=lambda conn, *, user_id: [
            {'request_direction': 'incoming', 'sender_public_key': 'pk-2'},
        ],
        fetch_pending_outgoing_dialog_requests_for_user_func=lambda conn, *, user_id: [
            {'request_direction': 'outgoing', 'receiver_public_key': 'pk-3'},
        ],
    )

    assert result == {
        'status': 'ok',
        'dialog_requests': [
            {'request_direction': 'incoming', 'sender_public_key': 'pk-2'},
            {'request_direction': 'outgoing', 'receiver_public_key': 'pk-3'},
        ],
    }


def test_process_accept_and_decline_request_route_delegate_with_sender_key():
    accept_captured = {}

    def _accept_delegate(conn, **kwargs):
        accept_captured.update(kwargs)
        return {'status': 'ok', 'chat_id': 'chat-1', 'events': []}

    accept_result = process_accept_request_route(
        object(),
        receiver_user_id=2,
        data={'sender_public_key': 'pk-1'},
        process_accept_request_func=_accept_delegate,
        accept_dialog_request_workflow_func=lambda conn, **kwargs: {'status': 'ok'},
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
        generate_chat_id_func=lambda a, b: 'chat-1',
        default_chat_name='Private chat',
        build_accept_request_socket_events_func=lambda **kwargs: [],
        get_safe_avatar_url_func=lambda user, viewer_id: None,
    )
    assert accept_result['status'] == 'ok'
    assert accept_captured['receiver_user_id'] == 2
    assert accept_captured['sender_public_key'] == 'pk-1'

    decline_captured = {}

    def _decline_delegate(conn, **kwargs):
        decline_captured.update(kwargs)
        return {'status': 'ok', 'event': None}

    decline_result = process_decline_request_route(
        object(),
        receiver_user_id=2,
        data={'sender_public_key': 'pk-1'},
        process_decline_request_func=_decline_delegate,
        decline_dialog_request_workflow_func=lambda conn, **kwargs: {'status': 'ok'},
        build_decline_request_socket_event_func=lambda **kwargs: {},
        action='declined',
    )
    assert decline_result == {'status': 'ok', 'event': None}
    assert decline_captured['receiver_user_id'] == 2
    assert decline_captured['sender_public_key'] == 'pk-1'
