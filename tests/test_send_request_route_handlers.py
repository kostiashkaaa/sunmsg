
from app.routes.send_request_route_handlers import (
    process_send_request,
    process_send_request_route,
)
from app.db_backend import DatabaseError


def test_process_send_request_maps_db_error():
    def _raise_db_error(*args, **kwargs):
        raise DatabaseError('db-failed')

    result = process_send_request(
        None,
        sender_user_id=1,
        receiver_user_id=2,
        send_dialog_request_workflow_func=_raise_db_error,
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
    )

    assert result == {'status': 'db_error'}


def test_process_send_request_maps_known_statuses_and_ok_event():
    def _run_for(status, *, block_state=None, event=None, retry_after=None):
        def _workflow(*args, **kwargs):
            payload = {'status': status}
            if block_state is not None:
                payload['block_state'] = block_state
            if event is not None:
                payload['event'] = event
            if retry_after is not None:
                payload['retry_after'] = retry_after
            return payload

        return process_send_request(
            None,
            sender_user_id=1,
            receiver_user_id=2,
            send_dialog_request_workflow_func=_workflow,
            normalize_block_state_func=lambda state: state,
            build_block_state_func=lambda conn, a, b: {},
        )

    assert _run_for('receiver_missing') == {'status': 'receiver_missing'}
    assert _run_for('blocked', block_state={'is_blocked': True}) == {
        'status': 'blocked',
        'block_state': {'is_blocked': True},
    }
    assert _run_for('auto_decline') == {'status': 'auto_decline'}
    assert _run_for('cooldown') == {'status': 'cooldown', 'retry_after': 0}
    assert _run_for('cooldown', retry_after=33) == {'status': 'cooldown', 'retry_after': 33}
    assert _run_for('ok', event={'payload': {'x': 1}, 'room': 'pk-2'}) == {
        'status': 'ok',
        'event': {'payload': {'x': 1}, 'room': 'pk-2'},
    }


def test_process_send_request_route_validates_payload_and_delegates():
    assert process_send_request_route(
        None,
        sender_user_id=1,
        data=None,
        parse_int_func=int,
        process_send_request_func=lambda *args, **kwargs: {'status': 'ok'},
        send_dialog_request_workflow_func=lambda *args, **kwargs: {'status': 'ok'},
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
    ) == {'status': 'invalid_payload'}

    assert process_send_request_route(
        None,
        sender_user_id=1,
        data={},
        parse_int_func=lambda value: None,
        process_send_request_func=lambda *args, **kwargs: {'status': 'ok'},
        send_dialog_request_workflow_func=lambda *args, **kwargs: {'status': 'ok'},
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
    ) == {'status': 'invalid_payload'}

    assert process_send_request_route(
        None,
        sender_user_id=1,
        data={'contact_user_id': None},
        parse_int_func=lambda value: None,
        process_send_request_func=lambda *args, **kwargs: {'status': 'ok'},
        send_dialog_request_workflow_func=lambda *args, **kwargs: {'status': 'ok'},
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
    ) == {'status': 'invalid_contact_user_id'}

    assert process_send_request_route(
        None,
        sender_user_id=1,
        data={'contact_user_id': 1},
        parse_int_func=int,
        process_send_request_func=lambda *args, **kwargs: {'status': 'ok'},
        send_dialog_request_workflow_func=lambda *args, **kwargs: {'status': 'ok'},
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
    ) == {'status': 'self_request'}

    captured = {}

    def _delegate(conn, **kwargs):
        captured.update(kwargs)
        return {'status': 'ok', 'event': {'room': 'pk-2', 'payload': {'x': 1}}}

    result = process_send_request_route(
        object(),
        sender_user_id=1,
        data={'contact_user_id': '2'},
        parse_int_func=lambda value: int(value),
        process_send_request_func=_delegate,
        send_dialog_request_workflow_func=lambda *args, **kwargs: {'status': 'ok'},
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
    )

    assert captured['sender_user_id'] == 1
    assert captured['receiver_user_id'] == 2
    assert result == {'status': 'ok', 'event': {'room': 'pk-2', 'payload': {'x': 1}}}
