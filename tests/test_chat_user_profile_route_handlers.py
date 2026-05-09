from app.routes.chat_user_profile_route_handlers import process_get_user_profile


def _base_user(**overrides):
    payload = {
        'id': 2,
        'display_name': 'Bob',
        'username': 'bob',
        'public_key': 'pk-2',
        'avatar_url': '/avatar.png',
        'avatar_visibility': 'all',
        'is_public': 1,
        'is_online': 1,
        'hide_online_status': 0,
        'last_seen': '2025-01-01 10:00:00',
        'bio': 'Hello',
        'created_at': '2025-01-01 00:00:00',
    }
    payload.update(overrides)
    return payload


def _run(**overrides):
    kwargs = {
        'current_user_id': 1,
        'target_raw': '2',
        'parse_int_func': int,
        'fetch_user_func': lambda conn, target_user_id: _base_user(),
        'has_contact_func': lambda conn, current_user_id, target_user_id: True,
        'build_block_state_func': lambda conn, a, b: {'is_blocked': False, 'blocked_by_me': False, 'blocked_me': False},
        'serialize_block_state_func': lambda state: state,
        'fetch_conversation_stats_func': lambda conn, uid, target: {
            'photos': 1,
            'videos': 2,
            'audio': 3,
            'voices': 4,
            'files': 5,
            'links': 6,
        },
        'is_effectively_online_func': lambda public_key, persisted: True,
        'get_safe_avatar_url_func': lambda user, viewer_id: '/safe.png',
    }
    kwargs.update(overrides)
    return process_get_user_profile(object(), **kwargs)


def test_process_get_user_profile_validates_target_and_not_found():
    assert _run(target_raw=None) == {'status': 'invalid_target'}
    assert _run(target_raw='bad') == {'status': 'invalid_target'}
    assert _run(fetch_user_func=lambda conn, target_user_id: None) == {'status': 'not_found'}


def test_process_get_user_profile_returns_private_stub_for_non_contacts():
    result = _run(
        has_contact_func=lambda conn, current_user_id, target_user_id: False,
        fetch_user_func=lambda conn, target_user_id: _base_user(is_public=0),
    )
    assert result['status'] == 'ok'
    payload = result['payload']
    assert payload['success'] is True
    assert payload['restricted'] is True
    assert payload['private_profile'] is True
    assert payload['is_contact'] is False
    assert payload['can_send_request'] is False


def test_process_get_user_profile_returns_restricted_payload_when_blocked():
    result = _run(
        build_block_state_func=lambda conn, a, b: {'is_blocked': True, 'blocked_by_me': True, 'blocked_me': False},
    )
    assert result['status'] == 'ok'
    payload = result['payload']
    assert payload['restricted'] is True
    assert payload['private_profile'] is False
    assert payload['can_send_request'] is False
    assert payload['online'] is None
    assert payload['last_seen'] is None
    assert payload['bio'] == ''
    assert payload['stats'] == {'photos': 0, 'videos': 0, 'audio': 0, 'voices': 0, 'files': 0, 'links': 0}


def test_process_get_user_profile_returns_unrestricted_payload_for_contact():
    result = _run()
    assert result['status'] == 'ok'
    payload = result['payload']
    assert payload['restricted'] is False
    assert payload['private_profile'] is False
    assert payload['is_contact'] is True
    assert payload['can_send_request'] is False
    assert payload['online'] is True
    assert payload['last_seen'] == '2025-01-01 10:00:00'
    assert payload['avatar_url'] == '/safe.png'
    assert payload['stats'] == {'photos': 1, 'videos': 2, 'audio': 3, 'voices': 4, 'files': 5, 'links': 6}


def test_process_get_user_profile_handles_non_contact_public_and_hidden_status():
    public_non_contact = _run(
        has_contact_func=lambda conn, current_user_id, target_user_id: False,
    )
    assert public_non_contact['status'] == 'ok'
    assert public_non_contact['payload']['online'] is None
    assert public_non_contact['payload']['last_seen'] is None
    assert public_non_contact['payload']['can_send_request'] is True

    hidden_contact = _run(
        fetch_user_func=lambda conn, target_user_id: _base_user(hide_online_status=1),
    )
    assert hidden_contact['status'] == 'ok'
    assert hidden_contact['payload']['online'] is False
    assert hidden_contact['payload']['last_seen'] is None
