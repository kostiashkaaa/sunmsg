def process_search_page(
    conn,
    *,
    user_id: int,
    raw_query: str | None,
    fetch_public_search_results_func,
):
    query = str(raw_query or '').strip()
    if not query:
        return {'status': 'empty', 'results': [], 'query': ''}

    results = fetch_public_search_results_func(conn, user_id=user_id, query=query)
    return {'status': 'ok', 'results': results, 'query': query}
