from app.routes.chat_presence_route_handlers import process_get_online_status


def test_process_get_online_status_validates_target():
    base_kwargs = {
        'parse_int_func': int,
        'fetch_user_func': lambda conn, target_user_id: None,
        'has_contact_func': lambda conn, current_user_id, target_user_id: False,
        'build_block_state_func': lambda conn, a, b: {},
        'serialize_block_state_func': lambda state: {'is_blocked': False},
        'is_effectively_online_func': lambda public_key, persisted: persisted,
        'get_safe_avatar_url_func': lambda user, viewer_id: None,
    }

    assert process_get_online_status(
        object(),
        current_user_id=1,
        target_raw=None,
        **base_kwargs,
    ) == {'status': 'invalid_target'}

    assert process_get_online_status(
        object(),
        current_user_id=1,
        target_raw='bad',
        **base_kwargs,
    ) == {'status': 'invalid_target'}


def test_process_get_online_status_maps_not_found_forbidden_blocked():
    def _fetch(conn, target_user_id):
        return {
            'is_online': 1,
            'last_seen': '2025-01-01 10:00:00',
            'public_key': 'pk-2',
            'hide_online_status': 0,
            'avatar_url': '/a.png',
            'avatar_visibility': 'all',
        }

    base_kwargs = {
        'parse_int_func': int,
        'fetch_user_func': _fetch,
        'build_block_state_func': lambda conn, a, b: {'is_blocked': True},
        'serialize_block_state_func': lambda state: state,
        'is_effectively_online_func': lambda public_key, persisted: persisted,
        'get_safe_avatar_url_func': lambda user, viewer_id: '/safe.png',
    }

    not_found = process_get_online_status(
        object(),
        current_user_id=1,
        target_raw='2',
        has_contact_func=lambda conn, current_user_id, target_user_id: True,
        fetch_user_func=lambda conn, target_user_id: None,
        **{k: v for k, v in base_kwargs.items() if k != 'fetch_user_func'},
    )
    assert not_found == {'status': 'not_found'}

    forbidden = process_get_online_status(
        object(),
        current_user_id=1,
        target_raw='2',
        has_contact_func=lambda conn, current_user_id, target_user_id: False,
        **base_kwargs,
    )
    assert forbidden == {'status': 'forbidden'}

    blocked = process_get_online_status(
        object(),
        current_user_id=1,
        target_raw='2',
        has_contact_func=lambda conn, current_user_id, target_user_id: True,
        **base_kwargs,
    )
    assert blocked == {'status': 'blocked', 'block_state': {'is_blocked': True}}


def test_process_get_online_status_builds_payload_with_visibility_rules():
    user = {
        'is_online': 1,
        'last_seen': '2025-01-01 10:00:00',
        'public_key': 'pk-2',
        'hide_online_status': 0,
        'avatar_url': '/a.png',
        'avatar_visibility': 'all',
    }

    visible = process_get_online_status(
        object(),
        current_user_id=1,
        target_raw='2',
        parse_int_func=int,
        fetch_user_func=lambda conn, target_user_id: dict(user),
        has_contact_func=lambda conn, current_user_id, target_user_id: True,
        build_block_state_func=lambda conn, a, b: {'is_blocked': False},
        serialize_block_state_func=lambda state: state,
        is_effectively_online_func=lambda public_key, persisted: True,
        get_safe_avatar_url_func=lambda row, viewer_id: '/safe.png',
    )
    assert visible['status'] == 'ok'
    assert visible['payload'] == {
        'success': True,
        'online': True,
        'last_seen': '2025-01-01 10:00:00',
        'avatar_url': '/safe.png',
    }

    hidden = process_get_online_status(
        object(),
        current_user_id=1,
        target_raw='2',
        parse_int_func=int,
        fetch_user_func=lambda conn, target_user_id: {**user, 'hide_online_status': 1},
        has_contact_func=lambda conn, current_user_id, target_user_id: True,
        build_block_state_func=lambda conn, a, b: {'is_blocked': False},
        serialize_block_state_func=lambda state: state,
        is_effectively_online_func=lambda public_key, persisted: True,
        get_safe_avatar_url_func=lambda row, viewer_id: '/safe.png',
    )
    assert hidden['status'] == 'ok'
    assert hidden['payload']['online'] is False
    assert hidden['payload']['last_seen'] is None
