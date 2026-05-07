from app.routes.blocking_route_handlers import (
    process_get_blocked_users,
    process_block_user,
    process_block_user_route,
    process_unblock_user_route,
    process_unblock_user,
)


def test_process_block_user_maps_target_missing():
    result = process_block_user(
        object(),
        user_id=1,
        blocked_user_id=2,
        block_user_for_user_func=lambda conn, **kwargs: {'status': 'target_missing'},
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
        emit_block_state_events_func=lambda conn, a, b: None,
        logger_exception_func=lambda message: None,
    )

    assert result == {'status': 'target_missing'}


def test_process_block_user_maps_error_on_exception():
    logged = []

    def _raise(*args, **kwargs):
        raise RuntimeError('boom')

    result = process_block_user(
        object(),
        user_id=1,
        blocked_user_id=2,
        block_user_for_user_func=_raise,
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
        emit_block_state_events_func=lambda conn, a, b: None,
        logger_exception_func=lambda message: logged.append(message),
    )

    assert result == {'status': 'error'}
    assert logged == ['block_user error']


def test_process_block_user_returns_block_state_for_success():
    result = process_block_user(
        object(),
        user_id=1,
        blocked_user_id=2,
        block_user_for_user_func=lambda conn, **kwargs: {
            'status': 'ok',
            'block_state': {'is_blocked': True, 'blocked_by_me': True, 'blocked_me': False},
        },
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
        emit_block_state_events_func=lambda conn, a, b: None,
        logger_exception_func=lambda message: None,
    )

    assert result == {
        'status': 'ok',
        'block_state': {'is_blocked': True, 'blocked_by_me': True, 'blocked_me': False},
    }


def test_process_unblock_user_returns_block_state():
    calls = {}

    def _unblock(conn, **kwargs):
        calls.update(kwargs)
        return {'status': 'ok', 'block_state': {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False}}

    result = process_unblock_user(
        object(),
        user_id=1,
        blocked_user_id=2,
        unblock_user_for_user_func=_unblock,
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
        emit_block_state_events_func=lambda conn, a, b: None,
    )

    assert calls['user_id'] == 1
    assert calls['blocked_user_id'] == 2
    assert result == {
        'status': 'ok',
        'block_state': {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
    }


def test_process_get_blocked_users_returns_payload():
    calls = {}

    def _fetch(conn, *, user_id):
        calls['user_id'] = user_id
        return [{'userId': 2}, {'userId': 3}]

    result = process_get_blocked_users(
        object(),
        user_id=1,
        fetch_blocked_users_for_user_func=_fetch,
    )

    assert calls['user_id'] == 1
    assert result == {'status': 'ok', 'blocked_users': [{'userId': 2}, {'userId': 3}]}


def test_process_block_user_route_validates_and_delegates():
    assert process_block_user_route(
        object(),
        user_id=1,
        data={},
        parse_int_func=lambda value: None,
        process_block_user_func=lambda conn, **kwargs: {'status': 'ok'},
        block_user_for_user_func=lambda conn, **kwargs: {'status': 'ok', 'block_state': {}},
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
        emit_block_state_events_func=lambda conn, a, b: None,
        logger_exception_func=lambda message: None,
    ) == {'status': 'invalid_blocked_user_id'}

    assert process_block_user_route(
        object(),
        user_id=1,
        data={'blocked_user_id': 1},
        parse_int_func=int,
        process_block_user_func=lambda conn, **kwargs: {'status': 'ok'},
        block_user_for_user_func=lambda conn, **kwargs: {'status': 'ok', 'block_state': {}},
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
        emit_block_state_events_func=lambda conn, a, b: None,
        logger_exception_func=lambda message: None,
    ) == {'status': 'self_block_forbidden'}

    captured = {}

    def _delegate(conn, **kwargs):
        captured.update(kwargs)
        return {'status': 'ok', 'block_state': {'is_blocked': True}}

    result = process_block_user_route(
        object(),
        user_id=1,
        data={'blocked_user_id': '2'},
        parse_int_func=lambda value: int(value),
        process_block_user_func=_delegate,
        block_user_for_user_func=lambda conn, **kwargs: {'status': 'ok', 'block_state': {}},
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
        emit_block_state_events_func=lambda conn, a, b: None,
        logger_exception_func=lambda message: None,
    )

    assert captured['user_id'] == 1
    assert captured['blocked_user_id'] == 2
    assert result == {'status': 'ok', 'block_state': {'is_blocked': True}}


def test_process_unblock_user_route_validates_and_delegates():
    assert process_unblock_user_route(
        object(),
        user_id=1,
        data={},
        parse_int_func=lambda value: None,
        process_unblock_user_func=lambda conn, **kwargs: {'status': 'ok', 'block_state': {}},
        unblock_user_for_user_func=lambda conn, **kwargs: {'status': 'ok', 'block_state': {}},
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
        emit_block_state_events_func=lambda conn, a, b: None,
    ) == {'status': 'invalid_blocked_user_id'}

    captured = {}

    def _delegate(conn, **kwargs):
        captured.update(kwargs)
        return {'status': 'ok', 'block_state': {'is_blocked': False}}

    result = process_unblock_user_route(
        object(),
        user_id=1,
        data={'blocked_user_id': '2'},
        parse_int_func=lambda value: int(value),
        process_unblock_user_func=_delegate,
        unblock_user_for_user_func=lambda conn, **kwargs: {'status': 'ok', 'block_state': {}},
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
        emit_block_state_events_func=lambda conn, a, b: None,
    )

    assert captured['user_id'] == 1
    assert captured['blocked_user_id'] == 2
    assert result == {'status': 'ok', 'block_state': {'is_blocked': False}}
