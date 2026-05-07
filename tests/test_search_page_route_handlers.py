from app.routes.search_page_route_handlers import process_search_page


def test_process_search_page_returns_empty_when_query_blank():
    result = process_search_page(
        object(),
        user_id=1,
        raw_query='   ',
        fetch_public_search_results_func=lambda conn, **kwargs: [{'userId': 2}],
    )

    assert result == {'status': 'empty', 'results': [], 'query': ''}


def test_process_search_page_fetches_results_for_non_empty_query():
    captured = {}

    def _fetch(conn, **kwargs):
        captured.update(kwargs)
        return [{'userId': 2}]

    result = process_search_page(
        object(),
        user_id=1,
        raw_query='  alpha  ',
        fetch_public_search_results_func=_fetch,
    )

    assert captured == {'user_id': 1, 'query': 'alpha'}
    assert result == {'status': 'ok', 'results': [{'userId': 2}], 'query': 'alpha'}
