from app.routes.search_users_route_handlers import process_search_users


def test_process_search_users_normalizes_query_and_clamps_pagination():
    captured = {}

    def _build_payload(conn, **kwargs):
        captured.update(kwargs)
        return {'success': True, 'results': []}

    result = process_search_users(
        object(),
        user_id=1,
        raw_query='  alpha  ',
        raw_limit='500',
        raw_offset='-50',
        parse_int_func=lambda value: int(value),
        build_search_users_payload_func=_build_payload,
        min_query_length=3,
        default_limit=20,
        max_limit=50,
        max_offset=500,
        like_pattern_func=lambda value: f'%{value}%',
        get_safe_avatar_url_func=lambda user, viewer_id: None,
    )

    assert result == {'success': True, 'results': []}
    assert captured['query'] == 'alpha'
    assert captured['limit'] == 50
    assert captured['offset'] == 0
    assert captured['user_id'] == 1


def test_process_search_users_uses_defaults_when_limit_offset_invalid():
    captured = {}

    def _build_payload(conn, **kwargs):
        captured.update(kwargs)
        return {'success': True, 'results': [{'userId': 2}]}

    result = process_search_users(
        object(),
        user_id=1,
        raw_query=None,
        raw_limit='bad',
        raw_offset=None,
        parse_int_func=lambda value: int(value) if str(value).isdigit() else None,
        build_search_users_payload_func=_build_payload,
        min_query_length=3,
        default_limit=20,
        max_limit=50,
        max_offset=500,
        like_pattern_func=lambda value: f'%{value}%',
        get_safe_avatar_url_func=lambda user, viewer_id: None,
    )

    assert result == {'success': True, 'results': [{'userId': 2}]}
    assert captured['query'] == ''
    assert captured['limit'] == 20
    assert captured['offset'] == 0


def test_process_search_users_normalizes_at_username_query():
    captured = {}

    def _build_payload(conn, **kwargs):
        captured.update(kwargs)
        return {'success': True, 'results': []}

    process_search_users(
        object(),
        user_id=7,
        raw_query='  @Alpha_One  ',
        raw_limit='20',
        raw_offset='0',
        parse_int_func=lambda value: int(value),
        build_search_users_payload_func=_build_payload,
        min_query_length=3,
        default_limit=20,
        max_limit=50,
        max_offset=500,
        like_pattern_func=lambda value: f'%{value}%',
        get_safe_avatar_url_func=lambda user, viewer_id: None,
    )

    assert captured['query'] == 'alpha_one'
