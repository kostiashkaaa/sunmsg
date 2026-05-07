from app.routes.public_card_route_handlers import (
    process_public_user_card_route,
    process_start_dialog_from_public_card_route,
)


def test_process_public_user_card_route_resolves_viewer_and_delegates():
    captured = {}

    def _resolve_viewer_context(conn):
        return 1, {'username': 'alice'}

    def _process_public_user_card(conn, **kwargs):
        captured.update(kwargs)
        return {'status': 'ok', 'profile': {'username': 'bob'}}

    result = process_public_user_card_route(
        object(),
        target_username='bob',
        resolve_viewer_context_func=_resolve_viewer_context,
        process_public_user_card_func=_process_public_user_card,
        resolve_public_user_card_context_func=lambda conn, **kwargs: {'status': 'ok'},
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
        get_safe_avatar_url_func=lambda payload, viewer_id: None,
    )

    assert captured['target_username'] == 'bob'
    assert captured['viewer_id'] == 1
    assert captured['viewer_row'] == {'username': 'alice'}
    assert result == {'status': 'ok', 'profile': {'username': 'bob'}}


def test_process_start_dialog_from_public_card_route_maps_session_expired():
    result = process_start_dialog_from_public_card_route(
        object(),
        target_username='bob',
        resolve_viewer_context_func=lambda conn: (None, None),
        process_start_dialog_from_public_card_func=lambda conn, **kwargs: {'status': 'request_sent'},
        start_dialog_from_public_card_workflow_func=lambda conn, **kwargs: {'status': 'request_sent'},
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
        send_dialog_request_workflow_func=lambda conn, **kwargs: {'status': 'ok'},
    )

    assert result == {'status': 'session_expired'}


def test_process_start_dialog_from_public_card_route_delegates_when_session_valid():
    captured = {}

    def _process_start(conn, **kwargs):
        captured.update(kwargs)
        return {'status': 'open_existing', 'viewer_username': 'alice', 'target_user_id': 2}

    result = process_start_dialog_from_public_card_route(
        object(),
        target_username='bob',
        resolve_viewer_context_func=lambda conn: (1, {'username': 'alice'}),
        process_start_dialog_from_public_card_func=_process_start,
        start_dialog_from_public_card_workflow_func=lambda conn, **kwargs: {'status': 'request_sent'},
        normalize_block_state_func=lambda state: state,
        build_block_state_func=lambda conn, a, b: {},
        send_dialog_request_workflow_func=lambda conn, **kwargs: {'status': 'ok'},
    )

    assert captured['target_username'] == 'bob'
    assert captured['viewer_id'] == 1
    assert captured['viewer_row'] == {'username': 'alice'}
    assert result == {'status': 'open_existing', 'viewer_username': 'alice', 'target_user_id': 2}
